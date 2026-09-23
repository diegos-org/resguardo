/**
 * Login por código enviado por e-mail (M1.3): 6 dígitos, uso único, válido por 10 minutos,
 * no máximo 5 tentativas por código e 5 códigos por hora por e-mail. Pedir um código novo
 * invalida o anterior. O banco guarda só o HMAC do código (com o segredo do ambiente).
 *
 * A resposta a "pedir código" é sempre a mesma, exista ou não o e-mail — não dá para
 * descobrir quem tem acesso. Só quem pode entrar (cadastrado e ativo, ou em ADMIN_EMAILS)
 * recebe e-mail de verdade.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { codigosLogin, usuarios } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Correio } from "@/email/correio";
import { normalizarEmail } from "./entrada";

export const VALIDADE_MS = 10 * 60 * 1000;
export const MAX_TENTATIVAS = 5;
export const MAX_CODIGOS_POR_HORA = 5;

const hmac = (segredo: string, email: string, codigo: string) => createHmac("sha256", segredo).update(`${email}:${codigo}`).digest("hex");

export function gerarCodigoNumerico(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Pode entrar: usuário cadastrado e ativo, ou e-mail de ADMIN_EMAILS (primeiro acesso). */
export async function podeEntrar(db: Db, email: string, adminEmails: readonly string[]): Promise<boolean> {
  const [u] = await db.select({ ativo: usuarios.ativo }).from(usuarios).where(eq(sql`lower(${usuarios.email})`, email));
  if (u) return u.ativo;
  return adminEmails.map(normalizarEmail).includes(email);
}

export type OpcoesCodigo = {
  segredo: string;
  adminEmails: readonly string[];
  agora?: Date;
  gerar?: () => string;
};

/** Resultado para a tela: sempre "enviado", salvo excesso de pedidos (que não revela nada). */
export type ResultadoPedido = "enviado" | "limite";

export async function pedirCodigo(db: Db, correio: Correio, emailBruto: string, o: OpcoesCodigo): Promise<ResultadoPedido> {
  const email = normalizarEmail(emailBruto);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "enviado";
  const agora = o.agora ?? new Date();
  const codigo = (o.gerar ?? gerarCodigoNumerico)();

  const deveEnviar = await db.transaction(async (tx) => {
    // Um pedido por e-mail de cada vez (contagem do limite sem corrida).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`codigo-login:${email}`}))`);
    const umaHoraAtras = new Date(agora.getTime() - 60 * 60 * 1000);
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(codigosLogin)
      .where(and(eq(codigosLogin.email, email), gte(codigosLogin.criadoEm, umaHoraAtras)));
    if (n >= MAX_CODIGOS_POR_HORA) return "limite" as const;
    // Registra o pedido mesmo para quem não pode entrar: o limite vale igual para todos.
    await tx
      .update(codigosLogin)
      .set({ invalidadoEm: agora })
      .where(and(eq(codigosLogin.email, email), isNull(codigosLogin.usadoEm), isNull(codigosLogin.invalidadoEm)));
    const pode = await podeEntrar(tx, email, o.adminEmails);
    await tx.insert(codigosLogin).values({
      email,
      codigoHash: hmac(o.segredo, email, pode ? codigo : `${codigo}:sem-acesso:${randomInt(0, 1e9)}`),
      expiraEm: new Date(agora.getTime() + VALIDADE_MS),
      criadoEm: agora,
      invalidadoEm: pode ? null : agora,
    });
    return pode;
  });
  if (deveEnviar === "limite") return "limite";
  if (deveEnviar) {
    await correio.enviar({
      para: email,
      assunto: `Seu código de acesso: ${codigo}`,
      texto: `Seu código para entrar no painel da Sua Casa Leblon é ${codigo}.\n\nEle vale por 10 minutos e só pode ser usado uma vez.\nSe você não pediu este código, ignore este e-mail.`,
    });
  }
  return "enviado";
}

export type ResultadoVerificacao = { ok: true; email: string } | { ok: false; motivo: "invalido" | "expirado" | "bloqueado" };

/** Confere o código. Acertou: marca como usado. Errou: conta tentativa; na 5ª, invalida. */
export async function verificarCodigo(db: Db, emailBruto: string, codigoBruto: string, o: Pick<OpcoesCodigo, "segredo" | "agora">): Promise<ResultadoVerificacao> {
  const email = normalizarEmail(emailBruto);
  const codigo = codigoBruto.replace(/\s/g, "");
  const agora = o.agora ?? new Date();
  return db.transaction(async (tx) => {
    const [atual] = await tx
      .select()
      .from(codigosLogin)
      .where(and(eq(codigosLogin.email, email), isNull(codigosLogin.usadoEm), isNull(codigosLogin.invalidadoEm)))
      .orderBy(desc(codigosLogin.criadoEm))
      .limit(1)
      .for("update");
    if (!atual) return { ok: false as const, motivo: "invalido" as const };
    if (atual.expiraEm.getTime() <= agora.getTime()) {
      await tx.update(codigosLogin).set({ invalidadoEm: agora }).where(eq(codigosLogin.id, atual.id));
      return { ok: false as const, motivo: "expirado" as const };
    }
    const esperado = Buffer.from(atual.codigoHash, "hex");
    const recebido = Buffer.from(hmac(o.segredo, email, codigo), "hex");
    if (/^\d{6}$/.test(codigo) && esperado.length === recebido.length && timingSafeEqual(esperado, recebido)) {
      await tx.update(codigosLogin).set({ usadoEm: agora }).where(eq(codigosLogin.id, atual.id));
      return { ok: true as const, email };
    }
    const tentativas = atual.tentativas + 1;
    const esgotou = tentativas >= MAX_TENTATIVAS;
    await tx
      .update(codigosLogin)
      .set({ tentativas, ...(esgotou ? { invalidadoEm: agora } : {}) })
      .where(eq(codigosLogin.id, atual.id));
    return { ok: false as const, motivo: esgotou ? ("bloqueado" as const) : ("invalido" as const) };
  });
}
