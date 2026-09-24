/**
 * Tabela de reservas do portal (M5.2): as reservas confirmadas do proprietário no período, pela
 * mesma regra de posse do resumo (`posse.ts`), com os valores do livro que caem no período.
 * Entra também a pendente ou cancelada que ainda tem valores em vigor no livro no período (já
 * movimentou dinheiro): o resumo conta esses valores, então a tabela mostra de onde vêm, marcada
 * "em conferência" (M4.8).
 */
import { and, asc, eq, gt, gte, inArray, isNull, lt, ne, or, sql, sum } from "drizzle-orm";
import { bloqueios, imoveis, lancamentos, type OrigemReserva, proprietarioImoveis, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { lancamentoEmVigor, reservaDosDonos } from "./posse";

/** definido: parte dele calculada; em_conferencia: parte pendente; sem_calculo: sem parte no livro. */
export type SituacaoReserva = "definido" | "em_conferencia" | "sem_calculo";

export type ReservaPortal = {
  id: string;
  codigo: string;
  imovelId: string;
  imovelCodigo: string;
  checkin: string;
  checkout: string;
  hospede: string;
  /** Origem informada pelo hóspede (cidade/país); vazio = não informada (nunca deduzida). */
  origemHospede: string;
  canal: OrigemReserva;
  /** Valores do livro com competência no período (estadas entre meses são divididas pelas noites). */
  bruto: number;
  suaParte: number;
  situacao: SituacaoReserva;
};

export async function reservasDoPortal(
  db: Db,
  organizacaoId: string,
  o: { proprietarioIds: readonly string[]; imovelIds: readonly string[]; periodo: { inicio: string; fim: string } },
): Promise<ReservaPortal[]> {
  const donos = o.proprietarioIds.filter(uuidValido);
  const ids = o.imovelIds.filter(uuidValido);
  if (!donos.length || !ids.length) return [];
  const lista = await db
    .select({
      id: reservas.id,
      codigo: reservas.codigo,
      imovelId: reservas.imovelId,
      imovelCodigo: imoveis.codigo,
      checkin: reservas.checkin,
      checkout: reservas.checkout,
      hospede: reservas.hospedeNome,
      origemHospede: reservas.hospedeOrigem,
      canal: reservas.origem,
      estado: reservas.estado,
      resolvida: reservas.conferenciaResolvidaEm,
    })
    .from(reservas)
    .innerJoin(imoveis, eq(imoveis.id, reservas.imovelId))
    .where(
      and(
        eq(reservas.organizacaoId, organizacaoId),
        or(
          // Confirmada: pela estada no período, pelo imóvel atual e pela regra de posse.
          and(eq(reservas.estado, "confirmada"), lt(reservas.checkin, o.periodo.fim), gt(reservas.checkout, o.periodo.inicio), inArray(reservas.imovelId, ids), reservaDosDonos(db, donos)),
          // Não confirmada com valores em vigor (já movimentou dinheiro): pelo livro, como o resumo —
          // a parte dele, em vigor, num dos imóveis escolhidos, com competência no período (a estada
          // ou o imóvel da reserva podem ter mudado depois).
          and(
            ne(reservas.estado, "confirmada"),
            inArray(
              reservas.id,
              db
                .select({ id: lancamentos.reservaId })
                .from(lancamentos)
                .where(
                  and(
                    eq(lancamentos.organizacaoId, organizacaoId),
                    eq(lancamentos.tipo, "direito_proprietario"),
                    inArray(lancamentos.proprietarioId, donos),
                    inArray(lancamentos.imovelId, ids),
                    gte(lancamentos.competencia, o.periodo.inicio),
                    lt(lancamentos.competencia, o.periodo.fim),
                    lancamentoEmVigor(db),
                  ),
                ),
            ),
          ),
        ),
      ),
    )
    .orderBy(asc(reservas.checkin), asc(imoveis.codigo));
  if (!lista.length) return [];
  const reservaIds = lista.map((r) => r.id);
  // Não confirmada: o imóvel mostrado é o do livro (o da parte dele), não o atual da reserva — ela
  // pode ter passado para imóvel de outro dono depois de movimentar dinheiro.
  const naoConfirmadas = lista.filter((r) => r.estado !== "confirmada").map((r) => r.id);
  const doLivro = naoConfirmadas.length
    ? await db
        .selectDistinct({ reservaId: lancamentos.reservaId, imovelId: imoveis.id, imovelCodigo: imoveis.codigo })
        .from(lancamentos)
        .innerJoin(imoveis, eq(imoveis.id, lancamentos.imovelId))
        .where(
          and(
            eq(lancamentos.organizacaoId, organizacaoId),
            inArray(lancamentos.reservaId, naoConfirmadas),
            eq(lancamentos.tipo, "direito_proprietario"),
            inArray(lancamentos.proprietarioId, donos),
            inArray(lancamentos.imovelId, ids),
            gte(lancamentos.competencia, o.periodo.inicio),
            lt(lancamentos.competencia, o.periodo.fim),
            lancamentoEmVigor(db),
          ),
        )
    : [];

  // Valores no período: bruto da reserva e a parte dele (só a lançada para ele).
  const valores = await db
    .select({ reservaId: lancamentos.reservaId, tipo: lancamentos.tipo, valor: sum(lancamentos.valor) })
    .from(lancamentos)
    .where(
      and(
        eq(lancamentos.organizacaoId, organizacaoId),
        inArray(lancamentos.reservaId, reservaIds),
        gte(lancamentos.competencia, o.periodo.inicio),
        lt(lancamentos.competencia, o.periodo.fim),
        or(eq(lancamentos.tipo, "receita_bruta"), and(eq(lancamentos.tipo, "direito_proprietario"), inArray(lancamentos.proprietarioId, donos))),
      ),
    )
    .groupBy(lancamentos.reservaId, lancamentos.tipo);
  // Situação pela parte do proprietário em vigor (dele, ou ainda sem dono no imóvel dele).
  const partes = await db
    .select({ reservaId: lancamentos.reservaId, estado: lancamentos.estado })
    .from(lancamentos)
    .where(
      and(
        eq(lancamentos.organizacaoId, organizacaoId),
        inArray(lancamentos.reservaId, reservaIds),
        eq(lancamentos.tipo, "direito_proprietario"),
        or(inArray(lancamentos.proprietarioId, donos), isNull(lancamentos.proprietarioId)),
        lancamentoEmVigor(db),
      ),
    );
  const valor = (id: string, tipo: string) => Number(valores.find((v) => v.reservaId === id && v.tipo === tipo)?.valor ?? 0);
  const situacao = (id: string, estado: string, resolvida: Date | null): SituacaoReserva => {
    // Não confirmada com valores em vigor: dinheiro já movimentado, a conferir no painel (até ser dada por resolvida).
    if (estado !== "confirmada" && !resolvida) return "em_conferencia";
    const d = partes.filter((p) => p.reservaId === id);
    // Não confirmada já dada por resolvida: a decisão vale para a parte dela, mesmo "pendente".
    if (estado !== "confirmada") return d.length ? "definido" : "sem_calculo";
    if (d.some((p) => p.estado === "pendente")) return "em_conferencia";
    return d.length ? "definido" : "sem_calculo";
  };
  return lista.map(({ estado, resolvida, ...r }) => {
    const livro = estado !== "confirmada" ? doLivro.find((x) => x.reservaId === r.id) : undefined;
    return {
      ...r,
      ...(livro ? { imovelId: livro.imovelId, imovelCodigo: livro.imovelCodigo } : {}),
      bruto: valor(r.id, "receita_bruta"),
      suaParte: valor(r.id, "direito_proprietario"),
      situacao: situacao(r.id, estado, resolvida),
    };
  });
}

export type BloqueioPortal = { id: string; imovelId: string; inicio: string; fim: string };

/**
 * Bloqueios dos imóveis dele no período, só do tempo em que o imóvel é dele (da data do vínculo em
 * diante, como as reservas sem cálculo): bloqueio do dono anterior não aparece, e o que atravessa
 * a troca aparece só a partir da data do vínculo.
 */
export async function bloqueiosDoPortal(
  db: Db,
  organizacaoId: string,
  o: { proprietarioIds: readonly string[]; imovelIds: readonly string[]; periodo: { inicio: string; fim: string } },
): Promise<BloqueioPortal[]> {
  const donos = o.proprietarioIds.filter(uuidValido);
  const ids = o.imovelIds.filter(uuidValido);
  if (!donos.length || !ids.length) return [];
  const desde = sql<string>`(${proprietarioImoveis.criadoEm} at time zone 'America/Sao_Paulo')::date`;
  const linhas = await db
    .select({ id: bloqueios.id, imovelId: bloqueios.imovelId, inicio: bloqueios.inicio, fim: bloqueios.fim, desde: sql<string>`to_char(${desde}, 'YYYY-MM-DD')` })
    .from(bloqueios)
    .innerJoin(proprietarioImoveis, and(eq(proprietarioImoveis.imovelId, bloqueios.imovelId), inArray(proprietarioImoveis.proprietarioId, donos)))
    .where(
      and(
        eq(bloqueios.organizacaoId, organizacaoId),
        inArray(bloqueios.imovelId, ids),
        lt(bloqueios.inicio, o.periodo.fim),
        gt(bloqueios.fim, o.periodo.inicio),
        sql`${bloqueios.fim} > ${desde}`,
      ),
    )
    .orderBy(asc(bloqueios.inicio));
  return linhas.map((b) => ({ id: b.id, imovelId: b.imovelId, inicio: b.inicio < b.desde ? b.desde : b.inicio, fim: b.fim }));
}
