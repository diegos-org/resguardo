/**
 * Convites de proprietário (M1.4).
 * - O admin cria o convite para um proprietário + e-mail: gera um link com token aleatório
 *   (o banco guarda só o SHA-256). Vale 7 dias, uma vez só, e pode ser revogado.
 * - Um convite novo para o mesmo proprietário e e-mail revoga o anterior ainda pendente.
 * - O aceite acontece no primeiro login com AQUELE e-mail (código ou Google), vindo do
 *   link: aí nasce o usuário "proprietario" ligado a esse proprietário. Quem tem só o link,
 *   sem acesso ao e-mail, não entra.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { convites, proprietarios, proprietarioUsuarios, usuarios } from "@/db/schema";
import type { Db } from "@/db/types";
import { registrarAceiteDoConvite } from "@/portal/aceites";
import { normalizarEmail } from "@/acesso/entrada";
import { uuidValido } from "@/lib/ids";

export const VALIDADE_CONVITE_MS = 7 * 24 * 60 * 60 * 1000;

export type Convite = typeof convites.$inferSelect;
export type SituacaoConvite = "pendente" | "aceito" | "revogado" | "vencido";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const tokenValido = (t: string) => /^[A-Za-z0-9_-]{43}$/.test(t);

export function situacao(c: Pick<Convite, "aceitoEm" | "revogadoEm" | "expiraEm">, agora = new Date()): SituacaoConvite {
  if (c.aceitoEm) return "aceito";
  if (c.revogadoEm) return "revogado";
  if (c.expiraEm.getTime() <= agora.getTime()) return "vencido";
  return "pendente";
}

/** Trava por e-mail (até o fim da transação) usada ao criar convite e usuário da equipe. */
export async function travarEmail(db: Db, email: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`acesso-email:${normalizarEmail(email)}`}))`);
}

export type ResultadoCriacao = { ok: true; convite: Convite; token: string } | { ok: false; erro: string };

export async function criarConvite(
  db: Db,
  organizacaoId: string,
  proprietarioId: string,
  emailBruto: string,
  autorId: string | null,
  agora = new Date(),
): Promise<ResultadoCriacao> {
  const email = normalizarEmail(emailBruto);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return { ok: false, erro: "E-mail inválido." };
  if (!uuidValido(proprietarioId)) return { ok: false, erro: "Proprietário não encontrado." };
  return db.transaction(async (tx) => {
    await travarEmail(tx, email);
    const [p] = await tx
      .select({ id: proprietarios.id, ativo: proprietarios.ativo })
      .from(proprietarios)
      .where(and(eq(proprietarios.id, proprietarioId), eq(proprietarios.organizacaoId, organizacaoId)))
      .for("update");
    if (!p) return { ok: false as const, erro: "Proprietário não encontrado." };
    if (!p.ativo) return { ok: false as const, erro: "Proprietário inativo: reative antes de convidar." };
    // E-mail que já é da equipe não pode virar acesso de proprietário.
    const [u] = await tx.select().from(usuarios).where(eq(sql`lower(${usuarios.email})`, email));
    if (u && (u.papel !== "proprietario" || u.organizacaoId !== organizacaoId)) {
      return { ok: false as const, erro: "Este e-mail já é usado por outro tipo de acesso." };
    }
    await tx
      .update(convites)
      .set({ revogadoEm: agora, revogadoPor: autorId })
      .where(and(eq(convites.proprietarioId, proprietarioId), eq(convites.email, email), isNull(convites.aceitoEm), isNull(convites.revogadoEm)));
    const token = randomBytes(32).toString("base64url");
    const [convite] = await tx
      .insert(convites)
      .values({ organizacaoId, proprietarioId, email, tokenHash: hashToken(token), expiraEm: new Date(agora.getTime() + VALIDADE_CONVITE_MS), criadoPor: autorId, criadoEm: agora })
      .returning();
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "convite.criar",
      entidade: "proprietario",
      entidadeId: proprietarioId,
      mudancas: { convite: [null, `para ${email}, vale até ${convite.expiraEm.toISOString().slice(0, 10)}`] },
    });
    return { ok: true as const, convite, token };
  });
}

export async function revogarConvite(db: Db, organizacaoId: string, conviteId: string, autorId: string | null, agora = new Date()): Promise<boolean> {
  if (!uuidValido(conviteId)) return false;
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(convites)
      .where(and(eq(convites.id, conviteId), eq(convites.organizacaoId, organizacaoId)))
      .for("update");
    if (!c || c.aceitoEm || c.revogadoEm) return false;
    await tx.update(convites).set({ revogadoEm: agora, revogadoPor: autorId }).where(eq(convites.id, c.id));
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "convite.revogar",
      entidade: "proprietario",
      entidadeId: c.proprietarioId,
      mudancas: { convite: [`para ${c.email}`, "revogado"] },
    });
    return true;
  });
}

export async function listarConvites(db: Db, organizacaoId: string, proprietarioId: string): Promise<Convite[]> {
  if (!uuidValido(proprietarioId)) return [];
  return db
    .select()
    .from(convites)
    .where(and(eq(convites.organizacaoId, organizacaoId), eq(convites.proprietarioId, proprietarioId)))
    .orderBy(desc(convites.criadoEm));
}

/** Para a página do link: o convite do token, se ainda pendente (senão, o motivo). */
export async function lerConvite(
  db: Db,
  token: string,
  agora = new Date(),
): Promise<{ ok: true; convite: Convite; nomeProprietario: string } | { ok: false; motivo: SituacaoConvite | "invalido" }> {
  if (!tokenValido(token)) return { ok: false, motivo: "invalido" };
  const [linha] = await db
    .select({ c: convites, nome: proprietarios.nome })
    .from(convites)
    .innerJoin(proprietarios, eq(proprietarios.id, convites.proprietarioId))
    .where(eq(convites.tokenHash, hashToken(token)));
  if (!linha) return { ok: false, motivo: "invalido" };
  const s = situacao(linha.c, agora);
  return s === "pendente" ? { ok: true, convite: linha.c, nomeProprietario: linha.nome } : { ok: false, motivo: s };
}

/** Existe convite pendente para este e-mail? (para poder mandar o código de login). */
export async function temConvitePendente(db: Db, emailBruto: string, agora = new Date()): Promise<boolean> {
  const email = normalizarEmail(emailBruto);
  const [c] = await db
    .select({ id: convites.id })
    .from(convites)
    .where(and(eq(convites.email, email), isNull(convites.aceitoEm), isNull(convites.revogadoEm), gt(convites.expiraEm, agora)))
    .limit(1);
  return Boolean(c);
}

/**
 * Aceita o convite do token para o e-mail JÁ VERIFICADO (login por código ou Google).
 * Cria (ou reaproveita) o usuário proprietário e o liga ao proprietário. Retorna o id do
 * usuário, ou null se o token não vale para este e-mail. `aceiteComoFunciona`: número da versão do
 * "Como funciona" que a pessoa marcou como lida e aceita na página do convite (M5.6).
 */
export async function aceitarConvite(db: Db, token: string, emailVerificado: string, agora = new Date(), aceiteComoFunciona: number | null = null): Promise<string | null> {
  if (!tokenValido(token)) return null;
  const email = normalizarEmail(emailVerificado);
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(convites).where(eq(convites.tokenHash, hashToken(token))).for("update");
    if (!c || situacao(c, agora) !== "pendente" || c.email !== email) return null;
    const [p] = await tx.select().from(proprietarios).where(eq(proprietarios.id, c.proprietarioId));
    if (!p || !p.ativo || p.organizacaoId !== c.organizacaoId) return null;

    let [u] = await tx.select().from(usuarios).where(eq(sql`lower(${usuarios.email})`, email));
    if (u && (u.papel !== "proprietario" || u.organizacaoId !== c.organizacaoId)) return null;
    if (u && !u.ativo) return null; // acesso desativado pelo admin: convite não reativa
    if (!u) {
      [u] = await tx.insert(usuarios).values({ organizacaoId: c.organizacaoId, email, nome: p.nome, papel: "proprietario" }).returning();
    }
    await tx.insert(proprietarioUsuarios).values({ proprietarioId: p.id, usuarioId: u.id }).onConflictDoNothing();
    await tx.update(convites).set({ aceitoEm: agora, aceitoPor: u.id }).where(eq(convites.id, c.id));
    await registrarAuditoria(tx, {
      organizacaoId: c.organizacaoId,
      usuarioId: u.id,
      acao: "convite.aceitar",
      entidade: "proprietario",
      entidadeId: p.id,
      mudancas: { convite: [`para ${email}`, "aceito"] },
    });
    // M5.6: "li e aceito" marcado na página do convite — vale só se a versão ainda é a publicada.
    if (aceiteComoFunciona !== null) await registrarAceiteDoConvite(tx, { organizacaoId: c.organizacaoId, proprietarioId: p.id, usuarioId: u.id, versao: aceiteComoFunciona }, agora);
    return u.id;
  });
}
