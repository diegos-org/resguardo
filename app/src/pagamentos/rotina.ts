/**
 * Pagamento no site (M8.2a) — a rotina e o "Conferir agora" do painel: confere os pagamentos que ainda esperam
 * alguma coisa do provedor, uma transação curta por tentativa (leitura sempre fora dela). A rotina de holds chama
 * isto ANTES de vencer holds, para nunca vencer um pedido cujo Pix já foi pago.
 *
 * - tentativas `criando`, `incerta` ou `pendente` (as sem order são procuradas pela referência);
 * - aprovadas ainda sem taxa ou sem liberação (só a que confirmou a reserva lança recebimento);
 * - devoluções pedidas cuja próxima tentativa chegou (relê a order antes; chave nova a cada pedido);
 * - Pix pendentes que sobraram numa cotação já confirmada (cancelados no provedor);
 * - uma vez por dia, os pagamentos com desfecho `reserva` (e os aprovados sem reserva à espera da devolução) dos
 *   últimos 180 dias: devolução ou contestação feita por fora vira aviso, nunca estorno automático;
 * - limpeza dos avisos com mais de 90 dias.
 */
import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { devolucoesPagamento, pagamentos } from "@/db/schema";
import type { Db } from "@/db/types";
import { cancelarNoProvedor, conferirTentativa } from "./conferencia";
import { tentarDevolucao } from "./devolucao";
import { apagarEventosAntigos } from "./eventos";
import type { ProvedorPagamento } from "./provedor";
import { expirarHoldsVencidos, type ResumoExpiracao } from "@/site/cotacoes";

/** Por quanto tempo os pagamentos que confirmaram uma reserva são relidos (janela de devolução e contestação). */
export const RELER_RESERVA_DIAS = 180;
export const RELER_RESERVA_A_CADA_MS = 24 * 3_600_000;
/** Aprovado há mais de um dia à espera da taxa ou da liberação: relido a cada 6 h. */
export const ESPERA_LIBERACAO_MS = 6 * 3_600_000;

export type ResumoConferencia = { conferidas: number; mudaram: number; devolucoes: number; canceladas: number; falhas: number; eventosApagados: number };

/** Confere o que está pendente. `organizacaoId` null = todas as empresas (rotina). */
export async function conferirPendentes(db: Db, organizacaoId: string | null, provedor: ProvedorPagamento, agora: Date = new Date()): Promise<ResumoConferencia> {
  const resumo: ResumoConferencia = { conferidas: 0, mudaram: 0, devolucoes: 0, canceladas: 0, falhas: 0, eventosApagados: 0 };
  const daOrg = organizacaoId ? eq(pagamentos.organizacaoId, organizacaoId) : undefined;
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
            // No primeiro dia, a cada volta; depois, a cada 6 h (no teste o sinal de liberação nunca chega).
            or(
              gte(pagamentos.aprovadoEm, new Date(agora.getTime() - 24 * 3_600_000)),
              isNull(pagamentos.consultadoEm),
              lt(pagamentos.consultadoEm, new Date(agora.getTime() - ESPERA_LIBERACAO_MS)),
            ),
          ),
          sql`${pagamentos.avisos} @> '["taxa_perdida_desconhecida"]'::jsonb`,
          and(
            // O que confirmou a reserva, e o aprovado sem reserva à espera da devolução (devolvido pelo painel do
            // Mercado Pago, por exemplo): relidos uma vez por dia.
            or(eq(pagamentos.desfecho, "reserva"), and(isNull(pagamentos.desfecho), inArray(pagamentos.situacao, ["aprovado", "devolvido_parcial"]))),
            gte(pagamentos.criadoEm, new Date(agora.getTime() - RELER_RESERVA_DIAS * 86_400_000)),
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

  const devolucoes = await db
    .select({ id: devolucoesPagamento.id, organizacaoId: devolucoesPagamento.organizacaoId })
    .from(devolucoesPagamento)
    .where(
      and(
        organizacaoId ? eq(devolucoesPagamento.organizacaoId, organizacaoId) : undefined,
        eq(devolucoesPagamento.situacao, "pedida"),
        or(isNull(devolucoesPagamento.proximaTentativaEm), lte(devolucoesPagamento.proximaTentativaEm, agora)),
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
  resumo.eventosApagados = await apagarEventosAntigos(db, agora);
  return resumo;
}

/**
 * A rotina do site (a de holds, a cada 10 min): primeiro confere os pagamentos e só depois vence os holds, para
 * nunca vencer um pedido cujo Pix já foi pago. Sem provedor (pagamento desligado), só vence os holds — a carência
 * de um pagamento em andamento continua valendo.
 */
export async function rotinaDoSite(db: Db, provedor: ProvedorPagamento | null, agora: Date = new Date()): Promise<{ pagamentos: ResumoConferencia | null; holds: ResumoExpiracao }> {
  const pagamentos = provedor ? await conferirPendentes(db, null, provedor, agora) : null;
  return { pagamentos, holds: await expirarHoldsVencidos(db, null, agora) };
}
