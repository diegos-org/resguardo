/**
 * De quem é uma reserva no portal (uma regra, um lugar: resumo, tabela e calendário usam esta).
 *
 * A reserva é de quem tem a parte do proprietário *em vigor* no livro (nem estorno, nem
 * estornada): se o imóvel foi A→B→A, a parte antiga de A, já estornada, não faz a reserva de B ser
 * de A. A ainda sem cálculo no financeiro só é do dono atual se a entrada é do dia em que ele
 * passou a ter o imóvel em diante (data do vínculo) e o imóvel não tem outro dono no livro: na
 * dúvida, o portal esconde — nunca mostra o histórico de outra pessoa.
 */
import { type AnyColumn, and, eq, exists, gt, gte, isNotNull, isNull, lt, ne, not, notInArray, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { cancelamentosReserva, contestacoesPagamento, devolucoesPagamento, lancamentos, pagamentos, proprietarioImoveis, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { ORIGEM_LANCAMENTO_CONTESTACAO } from "@/pagamentos/contestacao-regras";

/** Lançamento em vigor: não é estorno e não foi estornado. */
export function lancamentoEmVigor(db: Db) {
  const estorno = alias(lancamentos, "estorno");
  return and(isNull(lancamentos.estornoDe), not(exists(db.select({ um: sql`1` }).from(estorno).where(eq(estorno.estornoDe, lancamentos.id)))));
}

/**
 * Condição sobre `reservas`: a reserva que o motor calcula — confirmada, ou cancelada com valor retido pela política
 * (M8.2c). Gêmeo SQL de `reservaCalculadaPeloMotor` (`financeiro/motor.ts`): os dois mudam juntos.
 */
export const reservaCalculadaSql = () => sql`(${reservas.estado} = 'confirmada' or (${reservas.estado} = 'cancelada' and coalesce(${reservas.valorRetido}, 0) > 0))`;

/**
 * Condição sobre `reservas` (D21, M8.2c; M8.2d): algum pagamento do site com o dinheiro da reserva (o que a confirmou e as
 * diferenças de alteração) mostra no Mercado Pago devolvido além do que as nossas devoluções e o reconhecido explicam —
 * mais devolvido lido do que o reconhecido devolvido fora mais as nossas (confirmadas, cada uma pelo que voltou até o
 * valor dela, e as pedidas possivelmente no provedor: enviadas, com a chave em dúvida ou aceita), ou devolvido sem nada
 * nosso nem reconhecido — fora do cancelamento pela política com devolução integral. O dinheiro já voltou ao hóspede: a
 * parte do proprietário fica em conferência e não é repassada. Gêmeo TS: `devolucaoInexplicada` (`pagamentos/travas.ts`),
 * por pagamento, em `devolvidaNoProvedor` (`pagamentos/consultas.ts`). O aviso `devolvido_por_fora` é saída disto, nunca
 * entrada.
 */
export const devolvidaNoProvedorSql = () => sql`(exists (select 1 from ${pagamentos} p where p.reserva_id = ${reservas.id} and p.desfecho in ('reserva', 'alteracao')
    and (p.devolvido_lido > p.devolvido_fora_reconhecido + (select coalesce(sum(case
            when d.situacao = 'confirmada' then least(coalesce(d.valor_confirmado, d.valor), d.valor)
            when d.situacao = 'pedida' and d.tentativas > 0 and (d.chave_aceita or d.chave_em_duvida) then d.valor
            else 0 end), 0) from ${devolucoesPagamento} d where d.pagamento_id = p.id)
      or (p.situacao in ('devolvido', 'devolvido_parcial') and p.devolvido_fora_reconhecido = 0 and not exists (select 1 from ${devolucoesPagamento} d
            where d.pagamento_id = p.id and (d.situacao = 'confirmada' or (d.situacao = 'pedida' and d.tentativas > 0 and (d.chave_aceita or d.chave_em_duvida)))))))
  and not exists (select 1 from ${cancelamentosReserva} c where c.reserva_id = ${reservas.id} and c.situacao = 'cancelada' and c.direito = 'integral'))`;

/**
 * Condição sobre `reservas` (M8.2e): a reserva está **em conferência por disputa do pagamento** — um pagamento com o
 * dinheiro dela (desfecho `reserva` ou `alteracao`) tem uma disputa não duplicada `aberta`/`a_confirmar` com valor em
 * risco > 0 sem decisão de quem arca, ou `perdida` com perda a dividir > 0 (o valor perdido menos as devoluções
 * substituídas por ela, `perdaADividir`) sem a decisão. Gêmeo TS: `contestacaoSemDecisao`
 * (`pagamentos/contestacao-regras.ts`): os dois mudam juntos. Lê só `contestacoes_pagamento` (o valor em risco é gravado
 * sob a trava a cada mudança): o motor e o recálculo nunca gravam ali.
 *
 * C2 (registro de decisão de 11/10/2026): a disputa **não** entra em `lancamentoEmConferencia`, que trava o fechamento
 * inteiro do proprietário (e uma disputa dura até 6 meses). A parte presa fica "a liberar" (`classificarParte`), fora do
 * fechamento (`foraDoFechamento`) com o motivo próprio, e vai para o repasse seguinte; as outras partes seguem.
 */
export const contestacaoSemDecisaoSql = () => sql`(exists (select 1 from ${contestacoesPagamento} cp join ${pagamentos} cpp on cpp.id = cp.pagamento_id
    where cpp.reserva_id = ${reservas.id} and cpp.desfecho in ('reserva', 'alteracao') and not cp.duplicata_possivel and cp.decisao_versao = 0
      and ((cp.situacao in ('aberta', 'a_confirmar') and cp.valor_em_risco > 0)
        or (cp.situacao = 'perdida' and coalesce(cp.valor_perdido, 0) > coalesce((select sum(greatest(d.valor, 0)) from ${devolucoesPagamento} d where d.contestacao_id = cp.id), 0)))))`;

/**
 * Lançamento em conferência (uma regra, um lugar: portal, PDF, fechamento do mês e Início): o
 * pendente, e o do motor de uma reserva que o motor não calcula mais (pendente/cancelada sem valor
 * retido) mas ficou em vigor porque já movimentou dinheiro, com divergência, ou cujo pagamento do site
 * o Mercado Pago mostra devolvido fora do cancelamento pela política (D21). Sai da conferência quando
 * a reserva é confirmada de novo ou quando alguém dá a conferência por resolvida no painel (depois do
 * ajuste manual; no cancelamento com a parte já repassada, o próprio sistema dá por resolvida).
 */
const daReservaNaoConfirmada = (resolvida: boolean) =>
  and(
    eq(lancamentos.origem, "motor"),
    sql`${lancamentos.reservaId} in (select ${reservas.id} from ${reservas} where (not ${reservaCalculadaSql()} or ${reservas.divergenciaEm} is not null or ${devolvidaNoProvedorSql()}) and ${reservas.conferenciaResolvidaEm} is ${sql.raw(resolvida ? "not null" : "null")})`,
  );

/** Lançamento do motor de reserva não confirmada cuja conferência foi dada por resolvida. */
export function lancamentoDeConferenciaResolvida() {
  return sql`coalesce(${daReservaNaoConfirmada(true)}, false)`;
}

export function lancamentoEmConferencia() {
  // A decisão tomada na reserva vale para todos os lançamentos do motor dela, inclusive os que já
  // nasceram "pendente" (ex.: quem recebe a confirmar); os pendentes de outras origens continuam.
  return and(or(eq(lancamentos.estado, "pendente"), daReservaNaoConfirmada(false)), sql`not ${lancamentoDeConferenciaResolvida()}`);
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

/**
 * Reservas que contam no período, com o imóvel em que contam (a mesma regra no Início, na aba
 * Apartamentos, no portal e no PDF): confirmadas pela estada e pelo imóvel atual; confirmada com
 * divergência entre o cálculo e o dinheiro já movimentado (M4.8) conta pelo livro — imóvel e mês
 * dos valores em vigor —, porque é lá que os valores dela estão. A cancelada pela política com o
 * acerto no mês do cancelamento (espelhada, M8.2c) também conta pelo livro, só nos meses dos
 * lançamentos do motor (os que ficaram como estavam): o mês que já movimentou dinheiro não muda; o
 * mês do cancelamento mostra o espelho, mas não conta a reserva de novo. Com `donos`, só as deles
 * (regra de posse; pelo livro: a parte deles).
 */
export async function reservasQueContam(
  db: Db,
  organizacaoId: string,
  o: { imovelIds: readonly string[]; periodo: { inicio: string; fim: string }; donos?: readonly string[] },
): Promise<{ id: string; imovelId: string }[]> {
  if (!o.imovelIds.length || (o.donos && !o.donos.length)) return [];
  const ids = [...o.imovelIds];
  const [pelaEstada, peloLivro] = await Promise.all([
    db
      .select({ id: reservas.id, imovelId: reservas.imovelId })
      .from(reservas)
      .where(
        and(
          eq(reservas.organizacaoId, organizacaoId),
          eq(reservas.estado, "confirmada"),
          isNull(reservas.divergenciaEm),
          inArray(reservas.imovelId, ids),
          lt(reservas.checkin, o.periodo.fim),
          gt(reservas.checkout, o.periodo.inicio),
          o.donos ? reservaDosDonos(db, o.donos) : undefined,
        ),
      ),
    db
      .selectDistinct({ id: reservas.id, imovelId: lancamentos.imovelId })
      .from(lancamentos)
      .innerJoin(reservas, eq(reservas.id, lancamentos.reservaId))
      .where(
        and(
          eq(lancamentos.organizacaoId, organizacaoId),
          or(
            and(eq(reservas.estado, "confirmada"), isNotNull(reservas.divergenciaEm)),
            and(
              eq(reservas.estado, "cancelada"),
              eq(lancamentos.origem, "motor"),
              sql`exists (select 1 from ${cancelamentosReserva} c where c.reserva_id = ${reservas.id} and c.situacao = 'cancelada' and c.espelhado)`,
            ),
          ),
          o.donos ? and(eq(lancamentos.tipo, "direito_proprietario"), inArray(lancamentos.proprietarioId, [...o.donos])) : eq(lancamentos.tipo, "receita_bruta"),
          // M8.2e: a linha da disputa do pagamento (mês corrente da decisão) não é estadia: nunca faz a reserva contar no mês dela.
          ne(lancamentos.origem, ORIGEM_LANCAMENTO_CONTESTACAO),
          inArray(lancamentos.imovelId, ids),
          gte(lancamentos.competencia, o.periodo.inicio),
          lt(lancamentos.competencia, o.periodo.fim),
          lancamentoEmVigor(db),
        ),
      ),
  ]);
  const vistas = new Set<string>();
  return [...pelaEstada, ...peloLivro.map((x) => ({ id: x.id, imovelId: x.imovelId as string }))].filter((x) => !vistas.has(x.id) && vistas.add(x.id));
}
