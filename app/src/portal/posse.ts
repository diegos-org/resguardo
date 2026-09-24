/**
 * De quem é uma reserva no portal (uma regra, um lugar: resumo, tabela e calendário usam esta).
 *
 * A reserva é de quem tem a parte do proprietário *em vigor* no livro (nem estorno, nem
 * estornada): se o imóvel foi A→B→A, a parte antiga de A, já estornada, não faz a reserva de B ser
 * de A. A ainda sem cálculo no financeiro só é do dono atual se o imóvel nunca teve outro dono no
 * livro: sem histórico de posse, não dá para saber de quem era, e o portal nunca mostra o
 * histórico de outra pessoa.
 */
import { and, eq, exists, isNotNull, isNull, not, notInArray, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { lancamentos, reservas } from "@/db/schema";
import type { Db } from "@/db/types";

/** Lançamento em vigor: não é estorno e não foi estornado. */
export function lancamentoEmVigor(db: Db) {
  const estorno = alias(lancamentos, "estorno");
  return and(isNull(lancamentos.estornoDe), not(exists(db.select({ um: sql`1` }).from(estorno).where(eq(estorno.estornoDe, lancamentos.id)))));
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
  const outroDonoNoImovel = db
    .select({ um: sql`1` })
    .from(lancamentos)
    .where(and(eq(lancamentos.imovelId, reservas.imovelId), isNotNull(lancamentos.proprietarioId), notInArray(lancamentos.proprietarioId, [...donos])));
  return or(exists(direito(true)), and(not(exists(direito(false))), not(exists(outroDonoNoImovel))));
}
