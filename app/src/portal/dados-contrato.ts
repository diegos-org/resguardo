/**
 * Dados do cadastro que o "Como funciona" mostra junto do texto (M5.6): o contrato em vigor de cada imóvel do
 * proprietário (tipo, comissão, desde quando) e a periodicidade de repasse escolhida. Uma regra, um lugar: o texto
 * não repete o que está no cadastro.
 */
import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { NOMES_TIPO } from "@/contratos/regras";
import { contratos, imoveis, proprietarioImoveis } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import type { RegrasRepasses } from "@/repasses/periodicidade";
import { type PeriodicidadeDoDono, periodicidadeDoProprietario } from "@/repasses/proprietario";

export type DadosDoProprietario = {
  proprietarioId: string;
  imoveis: { codigo: string; nome: string; contrato: { tipo: string; comissao: string | null; desde: string } | null }[];
  periodicidade: PeriodicidadeDoDono | null;
};

/** Comissão em pontos-base → "15%" / "12,5%". */
export const comissaoTexto = (bp: number | null): string | null => (bp === null ? null : `${(bp / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);

export async function dadosDoProprietario(db: Db, organizacaoId: string, proprietarioId: string, hoje: string, regras?: RegrasRepasses): Promise<DadosDoProprietario> {
  if (!uuidValido(proprietarioId)) return { proprietarioId, imoveis: [], periodicidade: null };
  const meus = await db
    .select({ id: imoveis.id, codigo: imoveis.codigo, nome: imoveis.nome })
    .from(proprietarioImoveis)
    .innerJoin(imoveis, and(eq(imoveis.id, proprietarioImoveis.imovelId), eq(imoveis.organizacaoId, organizacaoId)))
    .where(eq(proprietarioImoveis.proprietarioId, proprietarioId))
    .orderBy(asc(imoveis.codigo));
  const vigentes = meus.length
    ? await db
        .select()
        .from(contratos)
        .where(and(eq(contratos.organizacaoId, organizacaoId), inArray(contratos.imovelId, meus.map((m) => m.id)), lte(contratos.inicio, hoje), or(isNull(contratos.fim), gte(contratos.fim, hoje))))
    : [];
  const porImovel = new Map(vigentes.map((c) => [c.imovelId, c]));
  const periodicidade = await periodicidadeDoProprietario(db, organizacaoId, proprietarioId, hoje, regras);
  return {
    proprietarioId,
    imoveis: meus.map((m) => {
      const c = porImovel.get(m.id);
      return { codigo: m.codigo, nome: m.nome, contrato: c ? { tipo: NOMES_TIPO[c.tipo], comissao: comissaoTexto(c.comissaoBp), desde: c.inicio } : null };
    }),
    periodicidade,
  };
}
