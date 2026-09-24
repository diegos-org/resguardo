/**
 * Usuários da equipe (M1.7): quem entra no painel e com que papel. Proprietários entram por
 * convite (M1.4) e não são geridos aqui. Travas: ninguém muda o próprio papel nem se
 * desativa, e sempre sobra pelo menos um administrador ativo.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { temConvitePendente, travarEmail } from "@/convites/convites";
import { normalizarEmail } from "@/acesso/entrada";
import { violouUnicidade } from "@/db/erros";
import { usuarios } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";

export const PAPEIS_EQUIPE = ["admin", "operacao"] as const;
export type PapelEquipe = (typeof PAPEIS_EQUIPE)[number];
export const NOMES_PAPEL: Record<string, string> = { admin: "Administrador", operacao: "Operação", proprietario: "Proprietário", hospede: "Hóspede" };

export type Usuario = typeof usuarios.$inferSelect;
export type Resultado = { ok: true } | { ok: false; erro: string };

export async function listarUsuarios(db: Db, organizacaoId: string): Promise<Usuario[]> {
  return db.select().from(usuarios).where(eq(usuarios.organizacaoId, organizacaoId)).orderBy(asc(usuarios.papel), asc(sql`lower(${usuarios.nome})`));
}

export async function criarUsuarioEquipe(
  db: Db,
  organizacaoId: string,
  bruto: { nome: string; email: string; papel: string },
  autorId: string | null,
): Promise<Resultado> {
  const nome = bruto.nome.trim();
  const email = normalizarEmail(bruto.email);
  if (!nome || nome.length > 80) return { ok: false, erro: "Informe o nome (até 80 caracteres)." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return { ok: false, erro: "E-mail inválido." };
  if (!PAPEIS_EQUIPE.includes(bruto.papel as PapelEquipe)) return { ok: false, erro: "Escolha o papel." };
  const CONVITE = "Este e-mail tem um convite de proprietário pendente. Cancele o convite antes, ou use outro e-mail.";
  try {
    const r = await db.transaction(async (tx) => {
      // Mesma trava do convite: os dois não podem nascer ao mesmo tempo para o mesmo e-mail.
      await travarEmail(tx, email);
      if (await temConvitePendente(tx, email)) return { ok: false as const, erro: CONVITE };
      const [u] = await tx.insert(usuarios).values({ organizacaoId, nome, email, papel: bruto.papel as PapelEquipe }).returning();
      await registrarAuditoria(tx, {
        organizacaoId,
        usuarioId: autorId,
        acao: "usuario.criar",
        entidade: "usuario",
        entidadeId: u.id,
        mudancas: { nome: [null, nome], email: [null, email], papel: [null, u.papel] },
      });
      return { ok: true as const };
    });
    return r;
  } catch (e) {
    if (violouUnicidade(e, "usuarios_email_unico")) return { ok: false, erro: "Este e-mail já tem acesso ao sistema." };
    throw e;
  }
}

export async function alterarUsuario(
  db: Db,
  organizacaoId: string,
  id: string,
  mudanca: { papel?: string; ativo?: boolean; nome?: string },
  autorId: string,
): Promise<Resultado> {
  if (!uuidValido(id)) return { ok: false, erro: "Usuário não encontrado." };
  if (mudanca.papel !== undefined && !PAPEIS_EQUIPE.includes(mudanca.papel as PapelEquipe)) return { ok: false, erro: "Papel inválido." };
  if (mudanca.nome !== undefined && (!mudanca.nome.trim() || mudanca.nome.trim().length > 80)) return { ok: false, erro: "Informe o nome (até 80 caracteres)." };
  return db.transaction(async (tx) => {
    // Trava a equipe inteira: duas alterações simultâneas não podem deixar a empresa sem admin.
    const equipe = await tx
      .select()
      .from(usuarios)
      .where(and(eq(usuarios.organizacaoId, organizacaoId), sql`${usuarios.papel} in ('admin', 'operacao')`))
      .orderBy(asc(usuarios.id))
      .for("update");
    const u = equipe.find((x) => x.id === id);
    if (!u) return { ok: false as const, erro: "Usuário não encontrado." };
    if (id === autorId && ((mudanca.papel !== undefined && mudanca.papel !== u.papel) || mudanca.ativo === false)) {
      return { ok: false as const, erro: "Você não pode mudar o seu próprio papel nem se desativar." };
    }
    const depois = { papel: (mudanca.papel as PapelEquipe | undefined) ?? u.papel, ativo: mudanca.ativo ?? u.ativo, nome: mudanca.nome?.trim() ?? u.nome };
    const adminsAtivos = equipe.filter((x) => (x.id === id ? depois.papel === "admin" && depois.ativo : x.papel === "admin" && x.ativo)).length;
    if (adminsAtivos === 0) return { ok: false as const, erro: "É preciso ter pelo menos um administrador ativo." };
    const mudancas: Record<string, [unknown, unknown]> = {};
    for (const k of ["papel", "ativo", "nome"] as const) if (u[k] !== depois[k]) mudancas[k] = [u[k], depois[k]];
    if (!Object.keys(mudancas).length) return { ok: true as const };
    await tx.update(usuarios).set(depois).where(eq(usuarios.id, id));
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "usuario.alterar", entidade: "usuario", entidadeId: id, mudancas });
    return { ok: true as const };
  });
}
