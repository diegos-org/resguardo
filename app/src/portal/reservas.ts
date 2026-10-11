/**
 * Tabela de reservas do portal (M5.2): as reservas confirmadas do proprietário no período, pela
 * mesma regra de posse do resumo (`posse.ts`), com os valores do livro que caem no período.
 * Entra também a pendente ou cancelada que ainda tem valores em vigor no livro no período (já
 * movimentou dinheiro): o resumo conta esses valores, então a tabela mostra de onde vêm, marcada
 * "em conferência" (M4.8). A cancelada com valor retido pela política (M8.2c) é calculada como uma
 * confirmada e entra pela estada; a cancelada com devolução integral depois do repasse entra pelo
 * livro (o desconto no mês do cancelamento). As duas trazem a etiqueta.
 *
 * M8.2e: a reserva com disputa do pagamento sem decisão de quem arca (`contestacaoSemDecisaoSql`) fica "Em conferência
 * (disputa do pagamento)". As linhas da disputa (origem "contestacao_pagamento") não são valores da reserva: ficam fora da
 * tabela (estão no extrato, só com o código da reserva) e nunca a trazem para um mês.
 */
import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, not, or, sql, sum } from "drizzle-orm";
import { bloqueios, cancelamentosReserva, imoveis, lancamentos, type OrigemReserva, proprietarioImoveis, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { reservaCalculadaPeloMotor } from "@/financeiro/motor";
import { uuidValido } from "@/lib/ids";
import { ORIGEM_LANCAMENTO_CONTESTACAO } from "@/pagamentos/contestacao-regras";
import { contestacaoSemDecisaoSql, devolvidaNoProvedorSql, lancamentoEmVigor, reservaCalculadaSql, reservaDosDonos } from "./posse";

/**
 * definido: parte dele calculada; em_conferencia: parte pendente; em_conferencia_disputa (M8.2e): disputa do pagamento
 * sem decisão de quem arca (a parte ainda não repassada espera); sem_calculo: sem parte no livro.
 */
export type SituacaoReserva = "definido" | "em_conferencia" | "em_conferencia_disputa" | "sem_calculo";

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
  /** Reserva confirmada (ocupa noites). Cancelada ou pendente entra na lista só para explicar valor em vigor no livro. */
  confirmada: boolean;
  /** Reserva cancelada (não ocupa noites), inclusive a cancelada pela política com valor retido (M8.2c). */
  cancelada: boolean;
  /** Etiqueta da cancelada pela política (M8.2c); null nas demais. */
  etiqueta: string | null;
};

/** As etiquetas da reserva cancelada pela política de cancelamento do site (M8.2c), no portal e no PDF. */
export const ETIQUETA_CANCELADA_RETIDA = "Cancelada — valor retido pela política de cancelamento";
export const ETIQUETA_CANCELADA_DEVOLVIDA = "Cancelada com devolução ao hóspede";

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
      valorRetido: reservas.valorRetido,
      resolvida: reservas.conferenciaResolvidaEm,
      divergencia: reservas.divergenciaEm,
      // D21 (M8.2c): o Mercado Pago mostra devolvido o pagamento que confirmou a reserva, fora da política.
      devolvida: sql<boolean>`coalesce(${devolvidaNoProvedorSql()}, false)`,
      comDevolucao: sql<boolean>`exists (select 1 from ${cancelamentosReserva} c where c.reserva_id = ${reservas.id} and c.situacao = 'cancelada' and c.direito = 'integral')`,
      // M8.2e: disputa do pagamento sem decisão de quem arca.
      disputa: sql<boolean>`coalesce(${contestacaoSemDecisaoSql()}, false)`,
    })
    .from(reservas)
    .innerJoin(imoveis, eq(imoveis.id, reservas.imovelId))
    .where(
      and(
        eq(reservas.organizacaoId, organizacaoId),
        or(
          // Calculada pelo motor (confirmada, ou cancelada com valor retido): pela estada no período, pelo imóvel atual e
          // pela regra de posse.
          and(reservaCalculadaSql(), isNull(reservas.divergenciaEm), lt(reservas.checkin, o.periodo.fim), gt(reservas.checkout, o.periodo.inicio), inArray(reservas.imovelId, ids), reservaDosDonos(db, donos)),
          // Não calculada (pendente, cancelada sem valor retido), ou com divergência entre o cálculo e o dinheiro já
          // movimentado: pelo livro, como o resumo — a parte dele, em vigor, num dos imóveis escolhidos, com competência
          // no período (a estada ou o imóvel da reserva podem ter mudado depois).
          and(
            or(not(reservaCalculadaSql()), isNotNull(reservas.divergenciaEm)),
            inArray(
              reservas.id,
              db
                .select({ id: lancamentos.reservaId })
                .from(lancamentos)
                .where(
                  and(
                    eq(lancamentos.organizacaoId, organizacaoId),
                    eq(lancamentos.tipo, "direito_proprietario"),
                    ne(lancamentos.origem, ORIGEM_LANCAMENTO_CONTESTACAO),
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
  // Não confirmada ou divergente: o imóvel mostrado é o do livro (o da parte dele), não o atual da reserva — ela
  // pode ter passado para imóvel de outro dono depois de movimentar dinheiro.
  const peloLivro = (r: Pick<(typeof lista)[number], "estado" | "valorRetido" | "divergencia">) => !reservaCalculadaPeloMotor(r) || r.divergencia !== null;
  const naoConfirmadas = lista.filter(peloLivro).map((r) => r.id);
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
            ne(lancamentos.origem, ORIGEM_LANCAMENTO_CONTESTACAO),
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
        or(eq(lancamentos.tipo, "receita_bruta"), and(eq(lancamentos.tipo, "direito_proprietario"), ne(lancamentos.origem, ORIGEM_LANCAMENTO_CONTESTACAO), inArray(lancamentos.proprietarioId, donos))),
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
        ne(lancamentos.origem, ORIGEM_LANCAMENTO_CONTESTACAO),
        or(inArray(lancamentos.proprietarioId, donos), isNull(lancamentos.proprietarioId)),
        lancamentoEmVigor(db),
      ),
    );
  const valor = (id: string, tipo: string) => Number(valores.find((v) => v.reservaId === id && v.tipo === tipo)?.valor ?? 0);
  // `emConferencia`: a mesma regra de `lancamentoEmConferencia` (posse.ts) — não calculada pelo motor, divergente, ou
  // com o pagamento do site devolvido no Mercado Pago fora da política (D21) —, até ser dada por resolvida.
  const situacao = (id: string, emConferencia: boolean, resolvida: Date | null, disputa: boolean): SituacaoReserva => {
    // Com valores em vigor: dinheiro já movimentado, a conferir no painel (até ser dada por resolvida).
    if (emConferencia && !resolvida) return "em_conferencia";
    const d = partes.filter((p) => p.reservaId === id);
    // Já dada por resolvida: a decisão vale para a parte dela, mesmo "pendente".
    if (emConferencia) return d.length ? (disputa ? "em_conferencia_disputa" : "definido") : "sem_calculo";
    if (d.some((p) => p.estado === "pendente")) return "em_conferencia";
    // M8.2e: a parte calculada espera a decisão de quem arca na disputa do pagamento.
    return d.length ? (disputa ? "em_conferencia_disputa" : "definido") : "sem_calculo";
  };
  return lista.map(({ estado, valorRetido, resolvida, divergencia, devolvida, comDevolucao, disputa, ...r }) => {
    const livro = peloLivro({ estado, valorRetido, divergencia }) ? doLivro.find((x) => x.reservaId === r.id) : undefined;
    const calculada = reservaCalculadaPeloMotor({ estado, valorRetido });
    const retida = estado === "cancelada" && calculada;
    return {
      ...r,
      ...(livro ? { imovelId: livro.imovelId, imovelCodigo: livro.imovelCodigo } : {}),
      bruto: valor(r.id, "receita_bruta"),
      suaParte: valor(r.id, "direito_proprietario"),
      situacao: situacao(r.id, !calculada || divergencia !== null || devolvida === true, resolvida, disputa === true),
      confirmada: estado === "confirmada",
      cancelada: estado === "cancelada",
      etiqueta: retida ? ETIQUETA_CANCELADA_RETIDA : estado === "cancelada" && comDevolucao ? ETIQUETA_CANCELADA_DEVOLVIDA : null,
    };
  });
}

export type BloqueioPortal = { id: string; imovelId: string; inicio: string; fim: string; fonte: string };

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
    .select({ id: bloqueios.id, imovelId: bloqueios.imovelId, inicio: bloqueios.inicio, fim: bloqueios.fim, fonte: bloqueios.fonte, desde: sql<string>`to_char(${desde}, 'YYYY-MM-DD')` })
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
  return linhas.map((b) => ({ id: b.id, imovelId: b.imovelId, inicio: b.inicio < b.desde ? b.desde : b.inicio, fim: b.fim, fonte: b.fonte }));
}
