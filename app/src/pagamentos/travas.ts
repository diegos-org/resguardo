/**
 * Pagamento no site (M8.2a) — a ordem única das travas, num lugar só: imóvel (FOR UPDATE) → reserva → cotação →
 * tentativas da cotação (por id) → devoluções. Motor e livro travam depois, como já fazem. Toda transação que
 * aplica um pagamento (aviso, página, rotina, painel) entra por aqui, com tempo-limite de espera: nada espera em
 * círculo, e chamada ao provedor nunca acontece com trava aberta.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { cotacoes, devolucoesPagamento, imoveis, pagamentos, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";

export type Pagamento = typeof pagamentos.$inferSelect;
export type Devolucao = typeof devolucoesPagamento.$inferSelect;
export type CotacaoTravada = typeof cotacoes.$inferSelect;
export type ReservaTravada = typeof reservas.$inferSelect;

export type Travado = {
  imovel: { id: string; codigo: string; nome: string; fuso: string };
  reserva: ReservaTravada;
  cotacao: CotacaoTravada;
  /** Todas as tentativas da cotação, travadas, em ordem de id. */
  tentativas: Pagamento[];
  /** Devoluções dessas tentativas, travadas, em ordem de id. */
  devolucoes: Devolucao[];
};

/** Espera máxima por uma trava (como no envio ao Beds24): passou disso, a transação desiste com erro 55P03. */
export async function limitarEspera(tx: Db): Promise<void> {
  await tx.execute(sql`set local lock_timeout = '15s'`);
}

/**
 * Trava a cotação (com o pedido dela) para aplicar um pagamento, na ordem única. null = cotação desta organização
 * não existe ou nunca foi segurada (sem pedido). Quem chama já está numa transação.
 */
export async function travarCotacao(tx: Db, organizacaoId: string, cotacaoId: string): Promise<Travado | null> {
  if (!uuidValido(cotacaoId)) return null;
  await limitarEspera(tx);
  const [antes] = await tx.select({ imovelId: cotacoes.imovelId, reservaId: cotacoes.reservaId }).from(cotacoes).where(and(eq(cotacoes.id, cotacaoId), eq(cotacoes.organizacaoId, organizacaoId)));
  if (!antes?.reservaId) return null;
  const [imovel] = await tx.select({ id: imoveis.id, codigo: imoveis.codigo, nome: imoveis.nome, fuso: imoveis.fuso }).from(imoveis).where(eq(imoveis.id, antes.imovelId)).for("update");
  const [reserva] = await tx.select().from(reservas).where(and(eq(reservas.id, antes.reservaId), eq(reservas.organizacaoId, organizacaoId))).for("update");
  const [cotacao] = await tx.select().from(cotacoes).where(eq(cotacoes.id, cotacaoId)).for("update");
  // O pedido de uma cotação nunca muda depois de segurada; se mudou entre a leitura e a trava, nada é aplicado.
  if (!imovel || !reserva || !cotacao || cotacao.reservaId !== reserva.id) return null;
  const tentativas = await tx.select().from(pagamentos).where(eq(pagamentos.cotacaoId, cotacaoId)).orderBy(asc(pagamentos.id)).for("update");
  const devolucoes = tentativas.length
    ? await tx
        .select()
        .from(devolucoesPagamento)
        .where(inArray(devolucoesPagamento.pagamentoId, tentativas.map((t) => t.id)))
        .orderBy(asc(devolucoesPagamento.id))
        .for("update")
    : [];
  return { imovel, reserva, cotacao, tentativas, devolucoes };
}
