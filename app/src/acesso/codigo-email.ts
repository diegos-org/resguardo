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
import { and, desc, eq, gte, isNull, lt, type SQL, sql } from "drizzle-orm";
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
  if (!emailValido(email)) return "invalido";
  return emitirCodigo(db, correio, email, o, {
    autorizado: () => podeEntrar(db, email, o.adminEmails),
    mensagem: async (codigo) => {
      const empresa = await nomeDaEmpresaPorEmail(db, email);
      return {
        assunto: `Seu código de acesso: ${codigo}`,
        texto: `Seu código para entrar no sistema da ${empresa} é ${codigo}.\n\nEle vale por 10 minutos e só pode ser usado uma vez.\nSe você não pediu este código, ignore este e-mail.`,
      };
    },
  });
}

/** Sem ":" — o escopo vai na frente do e-mail ("hospede:<e-mail>"), então um e-mail nunca pode imitar outro escopo. */
export const emailValido = (email: string) => /^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/.test(email) && email.length <= 200;

/**
 * Escopo do código: o login da equipe/proprietários (sem escopo), o portal do hóspede (M9.1) e o
 * cadastro público do marketplace (M12.3) guardam códigos separados — um não serve para entrar no
 * outro, e cada um tem seu limite (inclusive o teto geral por hora: abuso num não trava o outro).
 */
export type EscopoCodigo = "hospede" | "cadastro";
const chaveDoCodigo = (email: string, escopo?: EscopoCodigo) => (escopo ? `${escopo}:${email}` : email);

/**
 * Parte comum do envio do código (e-mail já normalizado e válido): retenção, quem pode receber,
 * limites, envio e troca do código anterior.
 */
export async function emitirCodigo(
  db: Db,
  correio: Correio,
  email: string,
  o: Pick<OpcoesCodigo, "segredo" | "agora" | "gerar"> & { escopo?: EscopoCodigo; maxGeralPorHora?: number },
  c: { autorizado: () => Promise<boolean>; mensagem: (codigo: string) => Promise<{ assunto: string; texto: string }> },
): Promise<ResultadoPedido> {
  const agora = o.agora ?? new Date();
  const umaHoraAtras = new Date(agora.getTime() - 60 * 60 * 1000);
  const chave = chaveDoCodigo(email, o.escopo);

  // Retenção: códigos antigos não servem para nada.
  await db.delete(codigosLogin).where(lt(codigosLogin.criadoEm, new Date(agora.getTime() - RETENCAO_MS)));
  if (!(await c.autorizado())) return "sem-acesso";

  const codigo = (o.gerar ?? gerarCodigoNumerico)();
  // Teto geral por escopo: códigos do mesmo tipo ("hospede:…", "cadastro:…" ou sem prefixo).
  const doEscopo = o.escopo ? sql`${codigosLogin.email} like ${`${o.escopo}:%`}` : sql`${codigosLogin.email} not like ${"%:%"}`;
  // Reserva a vaga ANTES de chamar o provedor, sob uma trava do escopo: pedidos simultâneos são
  // contados um depois do outro e não passam dos limites. A reserva nasce inválida (não serve para
  // entrar) e só vale depois que o e-mail sai; se o envio falhar, ela é apagada — o código anterior
  // continua valendo e o pedido não conta no limite.
  const reserva = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`codigo-escopo:${o.escopo ?? "login"}`}))`);
    const contar = async (f: SQL) =>
      (
        await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(codigosLogin)
          .where(and(gte(codigosLogin.criadoEm, umaHoraAtras), f))
      )[0].n;
    if ((await contar(eq(codigosLogin.email, chave))) >= MAX_CODIGOS_POR_HORA) return null;
    if ((await contar(doEscopo)) >= (o.maxGeralPorHora ?? MAX_CODIGOS_GERAL_POR_HORA)) return null;
    const [r] = await tx
      .insert(codigosLogin)
      .values({ email: chave, codigoHash: hmac(o.segredo, chave, codigo), expiraEm: new Date(agora.getTime() + VALIDADE_MS), criadoEm: agora, invalidadoEm: agora })
      .returning({ id: codigosLogin.id });
    return r.id;
  });
  if (!reserva) return "limite";

  const { assunto, texto } = await c.mensagem(codigo);
  try {
    await correio.enviar({ para: email, assunto, texto });
  } catch (e) {
    await db.delete(codigosLogin).where(eq(codigosLogin.id, reserva));
    throw e;
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`codigo-login:${chave}`}))`);
    // O novo passa a valer; os anteriores ainda válidos deixam de valer.
    await tx
      .update(codigosLogin)
      .set({ invalidadoEm: agora })
      .where(and(eq(codigosLogin.email, chave), isNull(codigosLogin.usadoEm), isNull(codigosLogin.invalidadoEm)));
    await tx.update(codigosLogin).set({ invalidadoEm: null }).where(eq(codigosLogin.id, reserva));
  });
  return "enviado";
}

export type ResultadoVerificacao = { ok: true; email: string } | { ok: false; motivo: "invalido" | "expirado" | "bloqueado" };

/** Confere o código. Acertou: marca como usado. Errou: conta tentativa; na 5ª, invalida. */
export async function verificarCodigo(
  db: Db,
  emailBruto: string,
  codigoBruto: string,
  o: Pick<OpcoesCodigo, "segredo" | "agora"> & { escopo?: EscopoCodigo },
): Promise<ResultadoVerificacao> {
  const email = normalizarEmail(emailBruto);
  if (!emailValido(email)) return { ok: false, motivo: "invalido" };
  const chave = chaveDoCodigo(email, o.escopo);
  const codigo = codigoBruto.replace(/\s/g, "");
  const agora = o.agora ?? new Date();
  return db.transaction(async (tx) => {
    const [atual] = await tx
      .select()
      .from(codigosLogin)
      .where(and(eq(codigosLogin.email, chave), isNull(codigosLogin.usadoEm), isNull(codigosLogin.invalidadoEm)))
      .orderBy(desc(codigosLogin.criadoEm))
      .limit(1)
      .for("update");
    if (!atual) return { ok: false as const, motivo: "invalido" as const };
    if (atual.expiraEm.getTime() <= agora.getTime()) {
      await tx.update(codigosLogin).set({ invalidadoEm: agora }).where(eq(codigosLogin.id, atual.id));
      return { ok: false as const, motivo: "expirado" as const };
    }
    const esperado = Buffer.from(atual.codigoHash, "hex");
    const recebido = Buffer.from(hmac(o.segredo, chave, codigo), "hex");
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
