import { and, asc, eq, inArray } from "drizzle-orm";
import { calcularMudancas, registrarAuditoria } from "@/auditoria/auditoria";
import { anuncios, idsExternos, imoveis, imoveisDetalhes } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { validarAnuncio } from "./regras";

export type Anuncio = typeof anuncios.$inferSelect;
export async function listarAnuncios(db: Db, org: string) {
  // Consultas em lote: não cresce o número de consultas conforme a quantidade de imóveis.
  const [lista, referencias, vinculos] = await Promise.all([
    db.select({ id: imoveis.id, codigo: imoveis.codigo, nome: imoveis.nome, descricao: imoveis.descricao, ativo: imoveis.ativo, publico: imoveis.publico, precoBase: imoveisDetalhes.precoBase })
      .from(imoveis).leftJoin(imoveisDetalhes, and(eq(imoveisDetalhes.imovelId, imoveis.id), eq(imoveisDetalhes.organizacaoId, org)))
      .where(eq(imoveis.organizacaoId, org)).orderBy(asc(imoveis.codigo)),
    db.select().from(anuncios).where(eq(anuncios.organizacaoId, org)),
    db.select({ imovelId: idsExternos.imovelId, canal: idsExternos.canal, idExterno: idsExternos.idExterno })
      .from(idsExternos).where(and(eq(idsExternos.organizacaoId, org), inArray(idsExternos.canal, ["airbnb", "booking"]))),
  ]);
  return lista.map(i => ({ ...i, anuncios: referencias.filter(a => a.imovelId === i.id), vinculos: vinculos.filter(v => v.imovelId === i.id) }));
}

export async function salvarAnuncio(db: Db, org: string, imovelId: string, e: Record<string, unknown>, autorId: string | null): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (!uuidValido(imovelId)) return { ok: false, erro: "Imóvel não encontrado." };
  const v = validarAnuncio(e);
  if (!v.ok) return v;
  if (typeof e.versao !== "string" || !/^\d+$/.test(e.versao) || !Number.isSafeInteger(Number(e.versao))) return { ok: false, erro: "Recarregue a página antes de salvar." };
  return db.transaction(async tx => {
    const [im] = await tx.select({ id: imoveis.id }).from(imoveis).where(and(eq(imoveis.id, imovelId), eq(imoveis.organizacaoId, org))).for("update");
    if (!im) return { ok: false as const, erro: "Imóvel não encontrado." };
    const onde = and(eq(anuncios.organizacaoId, org), eq(anuncios.imovelId, imovelId), eq(anuncios.canal, v.dados.canal));
    const [antes] = await tx.select().from(anuncios).where(onde);
    if (Number(e.versao) !== (antes?.versao ?? 0)) return { ok: false as const, erro: "Este anúncio mudou em outra tela. Recarregue a página e confira antes de salvar." };
    const agora = new Date();
    const dados = { ...v.dados, conferidoEm: e.conferido === "on" ? agora : null, atualizadoEm: agora, versao: (antes?.versao ?? 0) + 1 };
    if (antes) await tx.update(anuncios).set(dados).where(onde);
    else await tx.insert(anuncios).values({ ...dados, organizacaoId: org, imovelId });
    await registrarAuditoria(tx, { organizacaoId: org, usuarioId: autorId, acao: "anuncio.salvar", entidade: "imovel", entidadeId: imovelId, mudancas: calcularMudancas(antes ?? null, dados) });
    return { ok: true as const };
  });
}
