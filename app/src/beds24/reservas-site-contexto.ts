/**
 * Reserva paga do site no Beds24 (M8.3, desenho 2.1): o que a régua (`reservaDoSiteParaBeds24`) precisa, lido do banco
 * num lugar só. O "Simular" e a ficha (M8.3a) leem daqui, e o trabalhador do M8.3c vai ler também. Só leitura: sem trava
 * e sem rede. O vínculo usa a régua de `quartoVinculado` (o envio de calendário e a importação usam a mesma). O quarto
 * acessível à credencial e a moeda BRL dependem de ler o Beds24 e ficam com o trabalhador.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { quartoVinculado } from "@/calendario/envio";
import { listarContratos } from "@/contratos/repositorio";
import { beds24ReservasOperacoes, beds24ReservasSite, cancelamentosReserva, pagamentos, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { type ConfigReservasBeds24, lerConfigReservasBeds24, ligacaoDoImovel } from "./reservas-site-config";
import type { ContextoParaBeds24, ReservaParaBeds24 } from "./reservas-site-regras";

/** A reserva como a régua lê, mais o que identifica ela (nada do hóspede nem valor). */
export type ReservaLidaParaBeds24 = ReservaParaBeds24 & { id: string; codigo: string; imovelId: string; beds24Id: string | null };

export type LeituraParaBeds24 = {
  reserva: ReservaLidaParaBeds24;
  contexto: ContextoParaBeds24;
  config: ConfigReservasBeds24;
  acompanhamento: typeof beds24ReservasSite.$inferSelect | null;
};

/**
 * Lê a reserva e o contexto da régua: o pagamento com desfecho `reserva`, os contratos do imóvel, a ligação do imóvel
 * (D6), o cancelamento decidido, o quarto do vínculo único e válido, o acompanhamento e o id do Beds24 ligado a ela
 * (`reservas.beds24_id` ou o de uma operação real dela). `config` já lida evita reler. null = reserva fora da organização.
 */
export async function lerReservaParaBeds24(db: Db, org: string, reservaId: string, o: { agora: Date; config?: ConfigReservasBeds24 }): Promise<LeituraParaBeds24 | null> {
  if (!uuidValido(reservaId)) return null;
  const [r] = await db
    .select({ id: reservas.id, codigo: reservas.codigo, imovelId: reservas.imovelId, fonte: reservas.fonte, estado: reservas.estado, checkin: reservas.checkin, checkout: reservas.checkout, hospedes: reservas.hospedes, confirmadaEm: reservas.confirmadaEm, beds24Id: reservas.beds24Id })
    .from(reservas)
    .where(and(eq(reservas.id, reservaId), eq(reservas.organizacaoId, org)));
  if (!r) return null;
  const config = o.config ?? (await lerConfigReservasBeds24(db, org));
  const [pago] = await db.select({ id: pagamentos.id }).from(pagamentos).where(and(eq(pagamentos.organizacaoId, org), eq(pagamentos.reservaId, r.id), eq(pagamentos.desfecho, "reserva"))).limit(1);
  const [cancelado] = await db.select({ id: cancelamentosReserva.id }).from(cancelamentosReserva).where(and(eq(cancelamentosReserva.organizacaoId, org), eq(cancelamentosReserva.reservaId, r.id), eq(cancelamentosReserva.situacao, "cancelada"))).limit(1);
  const [acompanhamento] = await db.select().from(beds24ReservasSite).where(and(eq(beds24ReservasSite.organizacaoId, org), eq(beds24ReservasSite.reservaId, r.id)));
  // O id que uma operação real já recebeu do Beds24 (antes da fase 3 ele ainda não está na reserva).
  const [comId] = await db
    .select({ beds24Id: beds24ReservasOperacoes.beds24Id })
    .from(beds24ReservasOperacoes)
    .where(and(eq(beds24ReservasOperacoes.organizacaoId, org), eq(beds24ReservasOperacoes.reservaId, r.id), eq(beds24ReservasOperacoes.modo, "real"), isNotNull(beds24ReservasOperacoes.beds24Id)))
    .limit(1);
  const contratos = await listarContratos(db, org, r.imovelId);
  const ligacao = ligacaoDoImovel(config, r.imovelId);
  const contexto: ContextoParaBeds24 = {
    hoje: hojeISO("America/Sao_Paulo", o.agora),
    pagaPeloSite: Boolean(pago),
    contratos,
    ligacao: ligacao ? { ligadoEm: ligacao.ligadoEm } : null,
    cancelamentoDecidido: Boolean(cancelado),
    quartoDoVinculo: await quartoVinculado(db, org, r.imovelId),
    acompanhamento: acompanhamento ? { situacao: acompanhamento.situacao, quarto: acompanhamento.roomId, assinaturaEsperada: acompanhamento.assinaturaEsperada } : null,
    beds24Id: r.beds24Id ?? comId?.beds24Id ?? null,
  };
  return { reserva: r, contexto, config, acompanhamento: acompanhamento ?? null };
}
