/**
 * Login por código enviado por e-mail (M1.3): 6 dígitos, uso único, válido por 10 minutos,
 * no máximo 5 tentativas por código e 5 códigos por hora por e-mail (e um teto geral por
 * hora). O banco guarda só o HMAC do código (com o segredo do ambiente).
 *
 * Contra descobrir quem tem acesso: a tela responde sempre igual e o trabalho todo (banco
 * e envio) roda DEPOIS da resposta (`after`), então nem erro do provedor nem tempo de
 * resposta diferenciam um e-mail do outro. E-mail sem acesso não grava nada no banco.
 *
 * O código novo só substitui o anterior depois que o e-mail saiu: se o envio falhar, o
 * código anterior continua valendo e o pedido não conta no limite.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { codigosLogin, usuarios } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Correio } from "@/email/correio";
import { temConvitePendente } from "@/convites/convites";
import { nomeDaEmpresaPorEmail } from "@/configuracoes/empresa";
import { normalizarEmail } from "./entrada";

export const VALIDADE_MS = 10 * 60 * 1000;
export const MAX_TENTATIVAS = 5;
export const MAX_CODIGOS_POR_HORA = 5;
/** Teto geral de e-mails de código por hora (protege a cota do provedor). */
export const MAX_CODIGOS_GERAL_POR_HORA = 300;
/** Códigos são apagados depois de 1 dia (já não valem há muito tempo). */
export const RETENCAO_MS = 24 * 60 * 60 * 1000;

const hmac = (segredo: string, email: string, codigo: string) => createHmac("sha256", segredo).update(`${email}:${codigo}`).digest("hex");

export function gerarCodigoNumerico(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Pode entrar: usuário cadastrado e ativo, e-mail de ADMIN_EMAILS (primeiro acesso) ou com convite pendente. */
export async function podeEntrar(db: Db, email: string, adminEmails: readonly string[]): Promise<boolean> {
  const [u] = await db.select({ ativo: usuarios.ativo }).from(usuarios).where(eq(sql`lower(${usuarios.email})`, email));
  if (u) return u.ativo;
  if (adminEmails.map(normalizarEmail).includes(email)) return true;
  return temConvitePendente(db, email);
}

export type OpcoesCodigo = {
  segredo: string;
  adminEmails: readonly string[];
  agora?: Date;
  gerar?: () => string;
};

/** Resultado interno (para testes e registro) — a tela nunca mostra a diferença. */
export type ResultadoPedido = "enviado" | "limite" | "sem-acesso" | "invalido";

export async function pedirCodigo(db: Db, correio: Correio, emailBruto: string, o: OpcoesCodigo): Promise<ResultadoPedido> {
  const email = normalizarEmail(emailBruto);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return "invalido";
  const agora = o.agora ?? new Date();
  const umaHoraAtras = new Date(agora.getTime() - 60 * 60 * 1000);

  // Retenção: códigos antigos não servem para nada.
  await db.delete(codigosLogin).where(lt(codigosLogin.criadoEm, new Date(agora.getTime() - RETENCAO_MS)));
  if (!(await podeEntrar(db, email, o.adminEmails))) return "sem-acesso";

  const contar = async (c?: ReturnType<typeof eq>) =>
    (
      await db
        .select({ n: sql<number>`count(*)::int` })
        .from(codigosLogin)
        .where(and(gte(codigosLogin.criadoEm, umaHoraAtras), c))
    )[0].n;
  if ((await contar(eq(codigosLogin.email, email))) >= MAX_CODIGOS_POR_HORA) return "limite";
  if ((await contar()) >= MAX_CODIGOS_GERAL_POR_HORA) return "limite";

  const codigo = (o.gerar ?? gerarCodigoNumerico)();
  const empresa = await nomeDaEmpresaPorEmail(db, email);
  // Envia primeiro: se falhar (lança), nada muda no banco.
  await correio.enviar({
    para: email,
    assunto: `Seu código de acesso: ${codigo}`,
    texto: `Seu código para entrar no sistema da ${empresa} é ${codigo}.\n\nEle vale por 10 minutos e só pode ser usado uma vez.\nSe você não pediu este código, ignore este e-mail.`,
  });
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`codigo-login:${email}`}))`);
    await tx
      .update(codigosLogin)
      .set({ invalidadoEm: agora })
      .where(and(eq(codigosLogin.email, email), isNull(codigosLogin.usadoEm), isNull(codigosLogin.invalidadoEm)));
    await tx.insert(codigosLogin).values({
      email,
      codigoHash: hmac(o.segredo, email, codigo),
      expiraEm: new Date(agora.getTime() + VALIDADE_MS),
      criadoEm: agora,
    });
  });
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
