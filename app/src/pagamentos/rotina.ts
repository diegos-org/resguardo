/**
 * Pagamento no site (M8.2a) — a rotina e o "Conferir agora" do painel: confere os pagamentos que ainda esperam
 * alguma coisa do provedor, uma transação curta por tentativa (leitura sempre fora dela). A rotina de holds chama
 * isto ANTES de vencer holds, para nunca vencer um pedido cujo Pix já foi pago.
 *
 * - tentativas `criando`, `incerta` ou `pendente` (as sem order são procuradas pela referência);
 * - aprovadas ainda sem taxa ou sem liberação (só a que confirmou a reserva lança recebimento), dos últimos 85 dias
 *   (depois, a equipe registra à mão);
 * - devoluções pedidas cuja próxima tentativa chegou (relê a order antes; chave nova a cada pedido), só de pagamentos
 *   dos últimos 85 dias: depois disso a order não aparece mais, a rotina para de ler e liga o aviso
 *   `devolucao_fora_do_prazo` (uma vez), para a equipe resolver pelo painel do Mercado Pago;
 * - Pix pendentes que sobraram numa cotação já confirmada (cancelados no provedor);
 * - uma vez por dia, os pagamentos dos últimos 85 dias (o provedor só consulta orders de até três meses) com desfecho (reserva, devolução ou devolução por fora) e
 *   os aprovados sem reserva à espera da devolução: devolução ou contestação feita por fora (ou devolução em dobro)
 *   vira aviso, nunca estorno automático.
 *
 * O cron da Vercel só roda no deploy de produção, onde o pagamento fica desligado: no teste (prévias), tudo isto
 * roda pelo "Conferir agora" do painel (e a página do hóspede confere o próprio Pix). A limpeza dos avisos com mais
 * de 90 dias roda na rotina do site, em qualquer ambiente (fora desta função, que o painel também chama).
 */
import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { devolucoesPagamento, pagamentos } from "@/db/schema";
import type { Db } from "@/db/types";
import { cancelarNoProvedor, conferirTentativa } from "./conferencia";
import { tentarDevolucao } from "./devolucao";
import { apagarEventosAntigos } from "./eventos";
import { type ProvedorPagamento, RETENCAO_ORDERS_DIAS } from "./provedor";
import { expirarHoldsVencidos, type ResumoExpiracao } from "@/site/cotacoes";

/**
 * Por quanto tempo os pagamentos com desfecho são relidos uma vez por dia (devolução e contestação feitas no painel do
 * Mercado Pago): dentro do prazo em que o provedor ainda consulta a order (três meses), com folga. Contestação depois
 * disso é do M8.2e, por outro caminho.
 */
export const RELER_RESERVA_DIAS = RETENCAO_ORDERS_DIAS - 5;
export const RELER_RESERVA_A_CADA_MS = 24 * 3_600_000;
/** Aprovado há mais de um dia à espera da taxa ou da liberação: relido a cada 6 h. */
export const ESPERA_LIBERACAO_MS = 6 * 3_600_000;

export type ResumoConferencia = { conferidas: number; mudaram: number; devolucoes: number; canceladas: number; falhas: number };

/** Confere o que está pendente. `organizacaoId` null = todas as empresas (rotina). */
export async function conferirPendentes(db: Db, organizacaoId: string | null, provedor: ProvedorPagamento, agora: Date = new Date()): Promise<ResumoConferencia> {
  const resumo: ResumoConferencia = { conferidas: 0, mudaram: 0, devolucoes: 0, canceladas: 0, falhas: 0 };
  const daOrg = organizacaoId ? eq(pagamentos.organizacaoId, organizacaoId) : undefined;
  // Prazo único das leituras que se repetem (diária, taxa e liberação, devoluções): o provedor só consulta orders de até
  // três meses; depois disso a leitura nunca traria nada e só gastaria o limite de chamadas.
  const corte = new Date(agora.getTime() - RELER_RESERVA_DIAS * 86_400_000);
  const alvos = await db
    .select({ id: pagamentos.id, organizacaoId: pagamentos.organizacaoId })
    .from(pagamentos)
    .where(
      and(
        daOrg,
        or(
          inArray(pagamentos.situacao, ["criando", "incerta", "pendente"]),
          and(
            inArray(pagamentos.situacao, ["aprovado", "devolvido_parcial"]),
            or(isNull(pagamentos.taxa), and(eq(pagamentos.desfecho, "reserva"), or(isNull(pagamentos.liberacaoConfirmadaEm), eq(pagamentos.liberacaoOrigem, "manual")))),
            // Taxa ou liberação que nunca chegou: depois do prazo do provedor, fica para a equipe (registro à mão).
            gte(pagamentos.criadoEm, corte),
            // No primeiro dia, a cada volta; depois, a cada 6 h (no teste o sinal de liberação nunca chega).
            or(
              gte(pagamentos.aprovadoEm, new Date(agora.getTime() - 24 * 3_600_000)),
              isNull(pagamentos.consultadoEm),
              lt(pagamentos.consultadoEm, new Date(agora.getTime() - ESPERA_LIBERACAO_MS)),
            ),
          ),
          and(
            // O que confirmou a reserva, o que já foi devolvido (pelo Mercado Pago ou por fora: devolução em dobro) e o
            // aprovado sem reserva à espera da devolução (devolvido pelo painel do Mercado Pago, por exemplo): relidos
            // uma vez por dia.
            or(
              inArray(pagamentos.desfecho, ["reserva", "devolucao", "por_fora"]),
              and(isNull(pagamentos.desfecho), inArray(pagamentos.situacao, ["aprovado", "devolvido_parcial", "contestado"])),
            ),
            gte(pagamentos.criadoEm, corte),
            or(isNull(pagamentos.consultadoEm), lt(pagamentos.consultadoEm, new Date(agora.getTime() - RELER_RESERVA_A_CADA_MS))),
          ),
        ),
      ),
    )
    .orderBy(pagamentos.criadoEm);
  for (const a of alvos) {
    try {
      const r = await conferirTentativa(db, a.organizacaoId, a.id, provedor, agora, { origem: "rotina" });
      if (!r.ok) resumo.falhas++;
      else if (r.consultou) {
        resumo.conferidas++;
        if (r.mudou) resumo.mudaram++;
      }
    } catch {
      resumo.falhas++;
    }
  }

  // Pix pendente que sobrou numa cotação já confirmada por outro pagamento: cancelar no provedor.
  const sobrando = await db
    .select({ id: pagamentos.id, organizacaoId: pagamentos.organizacaoId, idProvedor: pagamentos.idProvedor })
    .from(pagamentos)
    .where(
      and(
        daOrg,
        eq(pagamentos.situacao, "pendente"),
        isNotNull(pagamentos.idProvedor),
        sql`exists (select 1 from ${pagamentos} p2 where p2.cotacao_id = ${pagamentos.cotacaoId} and p2.id <> ${pagamentos.id} and p2.desfecho = 'reserva')`,
      ),
    );
  for (const x of sobrando) {
    try {
      resumo.canceladas += await cancelarNoProvedor(db, x.organizacaoId, [{ id: x.id, idProvedor: x.idProvedor! }], provedor, agora);
    } catch {
      resumo.falhas++;
    }
  }

  // Devoluções: o mesmo prazo. Fora dele, nada se lê (a confirmação nunca chegaria): só o aviso, uma vez.
  const foraDoPrazo = sql`jsonb_build_array(${"devolucao_fora_do_prazo"}::text)`;
  await db
    .update(pagamentos)
    .set({ avisos: sql`${pagamentos.avisos} || ${foraDoPrazo}`, atualizadoEm: agora })
    .where(
      and(
        daOrg,
        lt(pagamentos.criadoEm, corte),
        sql`not (${pagamentos.avisos} @> ${foraDoPrazo})`,
        sql`exists (select 1 from ${devolucoesPagamento} d where d.pagamento_id = ${pagamentos.id} and d.situacao = 'pedida')`,
      ),
    );
  const devolucoes = await db
    .select({ id: devolucoesPagamento.id, organizacaoId: devolucoesPagamento.organizacaoId })
    .from(devolucoesPagamento)
    .innerJoin(pagamentos, eq(pagamentos.id, devolucoesPagamento.pagamentoId))
    .where(
      and(
        organizacaoId ? eq(devolucoesPagamento.organizacaoId, organizacaoId) : undefined,
        eq(devolucoesPagamento.situacao, "pedida"),
        or(isNull(devolucoesPagamento.proximaTentativaEm), lte(devolucoesPagamento.proximaTentativaEm, agora)),
        gte(pagamentos.criadoEm, corte),
      ),
    );
  for (const d of devolucoes) {
    try {
      const s = await tentarDevolucao(db, d.organizacaoId, d.id, provedor, agora);
      if (s === "confirmada") resumo.devolucoes++;
    } catch {
      resumo.falhas++;
    }
  }
  return resumo;
}

/**
 * A rotina do site (a de holds, a cada 10 min): primeiro confere os pagamentos e só depois vence os holds, para
 * nunca vencer um pedido cujo Pix já foi pago. Sem provedor (pagamento desligado, como no deploy de produção), só
 * vence os holds — a carência de um pagamento em andamento continua valendo. Em qualquer caso, apaga os avisos do
 * Mercado Pago com mais de 90 dias (o webhook grava no deploy de produção).
 */
export async function rotinaDoSite(db: Db, provedor: ProvedorPagamento | null, agora: Date = new Date()): Promise<{ pagamentos: ResumoConferencia | null; holds: ResumoExpiracao; eventosApagados: number }> {
  const pagamentos = provedor ? await conferirPendentes(db, null, provedor, agora) : null;
  const holds = await expirarHoldsVencidos(db, null, agora);
  return { pagamentos, holds, eventosApagados: await apagarEventosAntigos(db, agora) };
}
