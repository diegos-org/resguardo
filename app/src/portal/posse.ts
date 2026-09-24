/**
 * De quem é uma reserva no portal (uma regra, um lugar: resumo, tabela e calendário usam esta).
 *
 * A reserva é de quem tem a parte do proprietário *em vigor* no livro (nem estorno, nem
 * estornada): se o imóvel foi A→B→A, a parte antiga de A, já estornada, não faz a reserva de B ser
 * de A. A ainda sem cálculo no financeiro só é do dono atual se a entrada é do dia em que ele
 * passou a ter o imóvel em diante (data do vínculo) e o imóvel não tem outro dono no livro: na
 * dúvida, o portal esconde — nunca mostra o histórico de outra pessoa.
 */
import { type AnyColumn, and, eq, exists, isNotNull, isNull, not, notInArray, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { lancamentos, proprietarioImoveis, reservas } from "@/db/schema";
import type { Db } from "@/db/types";

/** Lançamento em vigor: não é estorno e não foi estornado. */
export function lancamentoEmVigor(db: Db) {
  const estorno = alias(lancamentos, "estorno");
  return and(isNull(lancamentos.estornoDe), not(exists(db.select({ um: sql`1` }).from(estorno).where(eq(estorno.estornoDe, lancamentos.id)))));
}

/**
 * Lançamento em conferência (uma regra, um lugar: portal, PDF, fechamento do mês e Início): o
 * pendente, e o do motor de uma reserva que deixou de estar confirmada (pendente/cancelada) mas
 * ficou em vigor porque já movimentou dinheiro. Sai da conferência quando a reserva é confirmada de
 * novo ou quando alguém dá a conferência por resolvida no painel (depois do ajuste manual).
 */
export function lancamentoEmConferencia() {
  return or(
    eq(lancamentos.estado, "pendente"),
    and(
      eq(lancamentos.origem, "motor"),
      sql`${lancamentos.reservaId} in (select ${reservas.id} from ${reservas} where ${reservas.estado} <> 'confirmada' and ${reservas.conferenciaResolvidaEm} is null)`,
    ),
  );
}

/** Condição sobre `reservas`: a reserva é de um destes proprietários (ver o topo do arquivo). */
export function reservaDosDonos(db: Db, donos: readonly string[]) {
  const ativo = lancamentoEmVigor(db);
  const direito = (deles: boolean) =>
    db
      .select({ um: sql`1` })
      .from(lancamentos)
      .where(
        and(
          eq(lancamentos.reservaId, reservas.id),
          eq(lancamentos.tipo, "direito_proprietario"),
          ativo,
          deles ? inArray(lancamentos.proprietarioId, [...donos]) : and(isNotNull(lancamentos.proprietarioId), notInArray(lancamentos.proprietarioId, [...donos])),
        ),
      );
  // Vínculo de um destes donos com o imóvel desde antes da entrada (data no fuso de São Paulo).
  const donoDesde = db
    .select({ um: sql`1` })
    .from(proprietarioImoveis)
    .where(
      and(
        eq(proprietarioImoveis.imovelId, reservas.imovelId),
        inArray(proprietarioImoveis.proprietarioId, [...donos]),
        sql`${reservas.checkin} >= (${proprietarioImoveis.criadoEm} at time zone 'America/Sao_Paulo')::date`,
      ),
    );
  return or(exists(direito(true)), and(not(exists(direito(false))), exists(donoDesde)));
}

/**
 * Condição: a data (`data`) é do período em que o imóvel é de um destes donos (data do vínculo em
 * diante, no fuso de São Paulo). Para o que não tem dono no livro: só conta para o dono atual o
 * que é do tempo dele.
 */
export function noPeriodoDosDonos(donos: readonly string[], imovel: AnyColumn, data: AnyColumn) {
  return sql`exists (select 1 from ${proprietarioImoveis} where ${proprietarioImoveis.imovelId} = ${imovel} and ${inArray(proprietarioImoveis.proprietarioId, [...donos])} and ${data} >= (${proprietarioImoveis.criadoEm} at time zone 'America/Sao_Paulo')::date)`;
}
