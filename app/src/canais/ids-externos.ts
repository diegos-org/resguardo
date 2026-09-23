import { and, asc, eq } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { violouUnicidade } from "@/db/erros";
import { type Canal, CANAIS, idsExternos, imoveis } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";

export type IdExterno = typeof idsExternos.$inferSelect;

export const NOMES_CANAL: Record<Canal, string> = { beds24: "Beds24", airbnb: "Airbnb", booking: "Booking.com" };

export type EntradaIdExterno = { canal: string; idExterno: string; detalhe?: string };
export type ResultadoId = { ok: true; registro: IdExterno } | { ok: false; erro: string };

export function validarIdExterno(e: EntradaIdExterno): { ok: true; canal: Canal; idExterno: string; detalhe: string } | { ok: false; erro: string } {
  const canal = e.canal as Canal;
  if (!CANAIS.includes(canal)) return { ok: false, erro: "Escolha o canal." };
  const idExterno = e.idExterno.trim();
  const detalhe = (e.detalhe ?? "").trim();
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(idExterno)) return { ok: false, erro: "ID externo: 1 a 64 letras, números, ponto, hífen ou dois-pontos." };
  if (detalhe && !/^[A-Za-z0-9._:-]{1,64}$/.test(detalhe)) return { ok: false, erro: "Detalhe: 1 a 64 letras, números, ponto, hífen ou dois-pontos." };
  return { ok: true, canal, idExterno, detalhe };
}

export async function listarIdsExternos(db: Db, organizacaoId: string, imovelId: string): Promise<IdExterno[]> {
  if (!uuidValido(imovelId)) return [];
  return db
    .select()
    .from(idsExternos)
    .where(and(eq(idsExternos.organizacaoId, organizacaoId), eq(idsExternos.imovelId, imovelId)))
    .orderBy(asc(idsExternos.canal), asc(idsExternos.idExterno));
}

const rotulo = (r: { canal: Canal; idExterno: string; detalhe: string }) =>
  `${NOMES_CANAL[r.canal]} ${r.idExterno}${r.detalhe ? ` / ${r.detalhe}` : ""}`;

export async function adicionarIdExterno(
  db: Db,
  organizacaoId: string,
  imovelId: string,
  entrada: EntradaIdExterno,
  autorId: string | null,
): Promise<ResultadoId> {
  const v = validarIdExterno(entrada);
  if (!v.ok) return v;
  if (!uuidValido(imovelId)) return { ok: false, erro: "Imóvel não encontrado." };
  try {
    return await db.transaction(async (tx) => {
      const [im] = await tx
        .select({ id: imoveis.id })
        .from(imoveis)
        .where(and(eq(imoveis.id, imovelId), eq(imoveis.organizacaoId, organizacaoId)));
      if (!im) return { ok: false as const, erro: "Imóvel não encontrado." };
      const [registro] = await tx
        .insert(idsExternos)
        .values({ organizacaoId, imovelId, canal: v.canal, idExterno: v.idExterno, detalhe: v.detalhe })
        .returning();
      await registrarAuditoria(tx, {
        organizacaoId,
        usuarioId: autorId,
        acao: "idexterno.adicionar",
        entidade: "imovel",
        entidadeId: imovelId,
        mudancas: { idExterno: [null, rotulo(registro)] },
      });
      return { ok: true as const, registro };
    });
  } catch (e) {
    if (violouUnicidade(e)) return { ok: false, erro: "Este ID já está ligado a um imóvel." };
    throw e;
  }
}

export async function removerIdExterno(db: Db, organizacaoId: string, registroId: string, autorId: string | null): Promise<boolean> {
  if (!uuidValido(registroId)) return false;
  return db.transaction(async (tx) => {
    const [removido] = await tx
      .delete(idsExternos)
      .where(and(eq(idsExternos.id, registroId), eq(idsExternos.organizacaoId, organizacaoId)))
      .returning();
    if (!removido) return false;
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "idexterno.remover",
      entidade: "imovel",
      entidadeId: removido.imovelId,
      mudancas: { idExterno: [rotulo(removido), null] },
    });
    return true;
  });
}

/**
 * Traduz um ID de canal para o imóvel interno — usado pela sincronização (M3).
 * Procura primeiro com o detalhe exato; se não houver, aceita o mapeamento sem detalhe.
 */
export async function resolverImovel(db: Db, organizacaoId: string, canal: Canal, idExterno: string, detalhe = ""): Promise<string | null> {
  const linhas = await db
    .select({ imovelId: idsExternos.imovelId, detalhe: idsExternos.detalhe })
    .from(idsExternos)
    .where(and(eq(idsExternos.organizacaoId, organizacaoId), eq(idsExternos.canal, canal), eq(idsExternos.idExterno, idExterno)));
  return (linhas.find((l) => l.detalhe === detalhe) ?? linhas.find((l) => l.detalhe === ""))?.imovelId ?? null;
}
