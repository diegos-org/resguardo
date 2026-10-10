/**
 * Pagamento no site (M8.2a) — a ordem única das travas, num lugar só: imóvel (FOR NO KEY UPDATE) → reserva (FOR NO KEY
 * UPDATE) → cotação → tentativas da cotação (por id) → devoluções → cancelamento ativo da reserva (M8.2c) → motor
 * (`travarMotorDaReserva`) → (documentos legais, disjuntor, livro). Toda transação que aplica um pagamento (aviso,
 * página, rotina, painel) entra por aqui, com tempo-limite de espera, e chamada ao provedor nunca acontece com trava
 * aberta.
 *
 * O retrato travado (`Travado`) é o que as funções seguintes da mesma transação leem: quem grava uma linha que está
 * nele atualiza o retrato junto (`Object.assign`, ou troca o campo; uma devolução nova entra em `devolucoes`), como
 * `aplicarLeitura` faz com a tentativa.
 *
 * O imóvel e a reserva são travados com NO KEY UPDATE (não FOR UPDATE): serializam os caminhos do pagamento e do hold
 * entre si e com quem trava a mesma linha para mudá-la (bloqueios, contratos, confirmar ou cancelar à mão), mas não
 * bloqueiam o FOR KEY SHARE que o Postgres toma na linha ao conferir as chaves estrangeiras de quem grava lançamentos,
 * itens de repasse, limpezas ou pagamentos dela. Com FOR UPDATE, uma transação daqui que depois espera a trava do
 * motor (taxa tardia, estorno da liberação) e outra que tem essa trava e grava lançamentos ou itens de repasse da
 * reserva (recálculo, repasse) entravam em impasse 40P01. Os UPDATEs de reserva feitos nessas transações só mudam
 * colunas fora das chaves únicas (id, organização + código, organização + id do Beds24), então ficam em NO KEY UPDATE;
 * e as releituras da reserva na mesma transação (gravar a taxa, confirmar o pedido pago) usam o mesmo modo — uma
 * releitura FOR UPDATE subiria a trava e traria o impasse de volta.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { cancelamentosReserva, cotacoes, devolucoesPagamento, imoveis, pagamentos, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";

/** 55P03 (lock_timeout) ou 40P01 (impasse): a ação responde "ocupado" e nada foi pedido ao provedor. */
export { travaOcupada } from "@/db/erros";

export type Pagamento = typeof pagamentos.$inferSelect;
export type Devolucao = typeof devolucoesPagamento.$inferSelect;
export type CotacaoTravada = typeof cotacoes.$inferSelect;
export type ReservaTravada = typeof reservas.$inferSelect;
export type Cancelamento = typeof cancelamentosReserva.$inferSelect;

export type Travado = {
  imovel: { id: string; codigo: string; nome: string; fuso: string };
  reserva: ReservaTravada;
  cotacao: CotacaoTravada;
  /** Todas as tentativas da cotação, travadas, em ordem de id. */
  tentativas: Pagamento[];
  /** Devoluções dessas tentativas, travadas, em ordem de id. */
  devolucoes: Devolucao[];
  /** Cancelamento ativo (pedido ou cancelada) da reserva, travado depois das devoluções. Quem grava atualiza este campo. */
  cancelamento: Cancelamento | null;
};

/** A devolução do pagamento (no M8.2c, uma por pagamento — índice único). O M8.2d muda só esta regra. */
export const devolucaoDoPagamento = (t: Pick<Travado, "devolucoes">, pagamentoId: string): Devolucao | undefined => t.devolucoes.find((d) => d.pagamentoId === pagamentoId);

/** Espera máxima por uma trava (como no envio ao Beds24): passou disso, a transação desiste com erro 55P03. */
export async function limitarEspera(tx: Db): Promise<void> {
  await tx.execute(sql`set local lock_timeout = '15s'`);
}

/**
 * Trava a cotação (com o pedido dela) para aplicar um pagamento, na ordem única. null = cotação desta organização
 * não existe ou nunca foi segurada (sem pedido). Quem chama já está numa transação.
 */
export async function travarCotacao(tx: Db, organizacaoId: string, cotacaoId: string): Promise<Travado | null> {
  return lerCotacao(tx, organizacaoId, cotacaoId, true);
}

/**
 * O mesmo retrato de `travarCotacao`, sem trava nenhuma (a prévia do cancelamento, M8.2c: calcula com o que está gravado
 * agora; o cancelamento confere tudo de novo sob as travas, pela assinatura da prévia).
 */
export async function lerCotacaoSemTravar(db: Db, organizacaoId: string, cotacaoId: string): Promise<Travado | null> {
  return lerCotacao(db, organizacaoId, cotacaoId, false);
}

async function lerCotacao(tx: Db, organizacaoId: string, cotacaoId: string, travar: boolean): Promise<Travado | null> {
  if (!uuidValido(cotacaoId)) return null;
  if (travar) await limitarEspera(tx);
  const [antes] = await tx.select({ imovelId: cotacoes.imovelId, reservaId: cotacoes.reservaId }).from(cotacoes).where(and(eq(cotacoes.id, cotacaoId), eq(cotacoes.organizacaoId, organizacaoId)));
  if (!antes?.reservaId) return null;
  const qImovel = tx.select({ id: imoveis.id, codigo: imoveis.codigo, nome: imoveis.nome, fuso: imoveis.fuso }).from(imoveis).where(eq(imoveis.id, antes.imovelId));
  const [imovel] = travar ? await qImovel.for("no key update") : await qImovel;
  const qReserva = tx.select().from(reservas).where(and(eq(reservas.id, antes.reservaId), eq(reservas.organizacaoId, organizacaoId)));
  const [reserva] = travar ? await qReserva.for("no key update") : await qReserva;
  const qCotacao = tx.select().from(cotacoes).where(eq(cotacoes.id, cotacaoId));
  const [cotacao] = travar ? await qCotacao.for("update") : await qCotacao;
  // O pedido de uma cotação nunca muda depois de segurada; se mudou entre a leitura e a trava, nada é aplicado.
  if (!imovel || !reserva || !cotacao || cotacao.reservaId !== reserva.id) return null;
  const qTentativas = tx.select().from(pagamentos).where(eq(pagamentos.cotacaoId, cotacaoId)).orderBy(asc(pagamentos.id));
  const tentativas = travar ? await qTentativas.for("update") : await qTentativas;
  let devolucoes: Devolucao[] = [];
  if (tentativas.length) {
    const q = tx
      .select()
      .from(devolucoesPagamento)
      .where(inArray(devolucoesPagamento.pagamentoId, tentativas.map((t) => t.id)))
      .orderBy(asc(devolucoesPagamento.id));
    devolucoes = travar ? await q.for("update") : await q;
  }
  // M8.2c: o cancelamento ativo da reserva (no máximo um, pelo índice único), depois das devoluções.
  const qCancelamento = tx
    .select()
    .from(cancelamentosReserva)
    .where(and(eq(cancelamentosReserva.reservaId, reserva.id), eq(cancelamentosReserva.organizacaoId, organizacaoId), inArray(cancelamentosReserva.situacao, ["pedido", "cancelada"])));
  const [cancelamento] = travar ? await qCancelamento.for("update") : await qCancelamento;
  return { imovel, reserva, cotacao, tentativas, devolucoes, cancelamento: cancelamento ?? null };
}
