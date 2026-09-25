import { and, eq } from "drizzle-orm";
import { proprietarioImoveis, proprietarios, proprietarioUsuarios, imoveis, profissionaisLimpeza, usuarios } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Sessao } from "./politica";

/**
 * Monta a `Sessao` de autorização a partir do banco. Usuário inativo ou
 * inexistente → null. Para proprietários, resolve os imóveis pelos vínculos
 * explícitos usuário → proprietário ATIVO → imóvel (só da mesma organização).
 */
export async function carregarSessao(db: Db, usuarioId: string, o?: { emitidaEm: number | null }): Promise<Sessao | null> {
  const [u] = await db.select().from(usuarios).where(eq(usuarios.id, usuarioId));
  if (!u || !u.ativo) return null;
  // Login de antes de o acesso mudar (e-mail trocado, acesso devolvido): não vale mais.
  if (o && u.sessaoValidaDesde && (o.emitidaEm === null || o.emitidaEm < u.sessaoValidaDesde.getTime())) return null;

  let imovelIds: string[] = [];
  if (u.papel === "proprietario") {
    const linhas = await db
      .selectDistinct({ id: imoveis.id })
      .from(proprietarioUsuarios)
      // Proprietário desativado (cliente que saiu) não dá mais acesso a nada.
      .innerJoin(
        proprietarios,
        and(eq(proprietarios.id, proprietarioUsuarios.proprietarioId), eq(proprietarios.ativo, true), eq(proprietarios.organizacaoId, u.organizacaoId)),
      )
      .innerJoin(proprietarioImoveis, eq(proprietarioImoveis.proprietarioId, proprietarioUsuarios.proprietarioId))
      .innerJoin(imoveis, and(eq(imoveis.id, proprietarioImoveis.imovelId), eq(imoveis.organizacaoId, u.organizacaoId)))
      .where(eq(proprietarioUsuarios.usuarioId, u.id));
    imovelIds = linhas.map((l) => l.id).sort();
  }

  if (u.papel === "limpeza") {
    // Profissional arquivada (ou sem vínculo) não entra: o acesso é dela, não do e-mail.
    const [p] = await db
      .select({ id: profissionaisLimpeza.id })
      .from(profissionaisLimpeza)
      .where(and(eq(profissionaisLimpeza.usuarioId, u.id), eq(profissionaisLimpeza.organizacaoId, u.organizacaoId), eq(profissionaisLimpeza.ativo, true)));
    if (!p) return null;
    return { usuarioId: u.id, organizacaoId: u.organizacaoId, papel: u.papel, imovelIds, profissionalId: p.id };
  }

  return { usuarioId: u.id, organizacaoId: u.organizacaoId, papel: u.papel, imovelIds };
}
