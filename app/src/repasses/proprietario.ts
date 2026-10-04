/**
 * Periodicidade de cada proprietário (M4.10): a escolha dele (portal ou painel) ou o padrão do tipo
 * de contrato dos imóveis dele; a próxima data prevista de repasse; e a gravação da escolha, com
 * histórico. Vale a partir do próximo repasse: nada já gerado muda.
 */
import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { contratos, proprietarioImoveis, proprietarios, type TipoContrato } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { descreverPeriodicidade, NOMES_PERIODICIDADE, type PeriodicidadeRepasse, periodicidadeEfetiva, periodicidadeValida, proximaDataDeRepasse, type RegrasRepasses } from "./periodicidade";
import { lerRegrasRepasses } from "./regras-config";

export type PeriodicidadeDoDono = {
  proprietarioId: string;
  /** O que o proprietário escolheu; null = padrão do contrato. */
  escolha: PeriodicidadeRepasse | null;
  efetiva: PeriodicidadeRepasse;
  nome: string;
  descricao: string;
  tiposContrato: TipoContrato[];
  /** Próximo dia de repasse depois de `hoje`. */
  proximaData: string;
};

/** Tipos dos contratos vigentes em `hoje` nos imóveis do proprietário (sem repetição). */
export async function tiposDeContratoDoProprietario(db: Db, organizacaoId: string, proprietarioId: string, hoje: string): Promise<TipoContrato[]> {
  if (!uuidValido(proprietarioId)) return [];
  const meus = await db.select({ imovelId: proprietarioImoveis.imovelId }).from(proprietarioImoveis).where(eq(proprietarioImoveis.proprietarioId, proprietarioId));
  if (!meus.length) return [];
  const linhas = await db
    .selectDistinct({ tipo: contratos.tipo })
    .from(contratos)
    .where(and(eq(contratos.organizacaoId, organizacaoId), inArray(contratos.imovelId, meus.map((m) => m.imovelId)), lte(contratos.inicio, hoje), or(isNull(contratos.fim), gte(contratos.fim, hoje))));
  return linhas.map((l) => l.tipo);
}

export async function periodicidadeDoProprietario(db: Db, organizacaoId: string, proprietarioId: string, hoje: string, regras?: RegrasRepasses): Promise<PeriodicidadeDoDono | null> {
  if (!uuidValido(proprietarioId)) return null;
  const [dono] = await db
    .select({ id: proprietarios.id, escolha: proprietarios.periodicidadeRepasse })
    .from(proprietarios)
    .where(and(eq(proprietarios.id, proprietarioId), eq(proprietarios.organizacaoId, organizacaoId)));
  if (!dono) return null;
  const r = regras ?? (await lerRegrasRepasses(db, organizacaoId));
  const tiposContrato = await tiposDeContratoDoProprietario(db, organizacaoId, proprietarioId, hoje);
  const escolha = periodicidadeValida(dono.escolha) ? dono.escolha : null;
  const efetiva = periodicidadeEfetiva(escolha, tiposContrato, r);
  return { proprietarioId, escolha, efetiva, nome: NOMES_PERIODICIDADE[efetiva], descricao: descreverPeriodicidade(efetiva, r), tiposContrato, proximaData: proximaDataDeRepasse(hoje, efetiva, r) };
}

/** Grava a escolha (null volta ao padrão do contrato). `peloProprietario` só muda o texto do histórico. */
export async function escolherPeriodicidade(
  db: Db,
  organizacaoId: string,
  proprietarioId: string,
  escolha: PeriodicidadeRepasse | null,
  autorId: string | null,
  o: { peloProprietario?: boolean } = {},
): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (escolha !== null && !periodicidadeValida(escolha)) return { ok: false, erro: "Escolha uma das periodicidades." };
  if (!uuidValido(proprietarioId)) return { ok: false, erro: "Proprietário não encontrado." };
  return db.transaction(async (tx) => {
    const [dono] = await tx
      .select({ id: proprietarios.id, escolha: proprietarios.periodicidadeRepasse })
      .from(proprietarios)
      .where(and(eq(proprietarios.id, proprietarioId), eq(proprietarios.organizacaoId, organizacaoId)))
      .for("update");
    if (!dono) return { ok: false as const, erro: "Proprietário não encontrado." };
    if ((dono.escolha ?? null) === escolha) return { ok: true as const };
    await tx.update(proprietarios).set({ periodicidadeRepasse: escolha, atualizadoEm: new Date() }).where(eq(proprietarios.id, proprietarioId));
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "proprietario.periodicidade",
      entidade: "proprietario",
      entidadeId: proprietarioId,
      mudancas: { periodicidadeRepasse: [dono.escolha ?? "padrão do contrato", `${escolha ?? "padrão do contrato"}${o.peloProprietario ? " (escolha do proprietário no portal)" : ""}`] },
    });
    return { ok: true as const };
  });
}
