/**
 * Pagamento no site (M8.2d) — os avisos de cada devolução e a união deles no pagamento. Com várias devoluções por
 * pagamento, cada uma guarda os seus (`devolucoes_pagamento.avisos`: falhou, parada, sem confirmação, fora do prazo, a
 * menor, taxa que não voltou, data a conferir, liberação atrasada); o pagamento leva a união deles, recalculada numa
 * escrita só, mais os avisos que são dele (`pagamentos.avisos`). Sob as travas de quem chama; o retrato é atualizado junto.
 */
import { eq } from "drizzle-orm";
import { devolucoesPagamento, pagamentos } from "@/db/schema";
import type { Db } from "@/db/types";
import { AVISOS_DE_DEVOLUCAO, type CodigoAviso } from "./situacoes";
import type { Devolucao, Pagamento, Travado } from "./travas";

const DA_DEVOLUCAO: readonly string[] = AVISOS_DE_DEVOLUCAO;
const iguais = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Liga e desliga avisos da devolução numa escrita só (sem repetir); devolve se mudou. */
export async function trocarAvisosDaDevolucao(tx: Db, dev: Devolucao, o: { ligar?: readonly CodigoAviso[]; desligar?: readonly CodigoAviso[] }, agora: Date): Promise<boolean> {
  const avisos = new Set(dev.avisos);
  for (const a of o.desligar ?? []) avisos.delete(a);
  for (const a of o.ligar ?? []) avisos.add(a);
  const lista = [...avisos];
  if (iguais(lista, dev.avisos)) return false;
  await tx.update(devolucoesPagamento).set({ avisos: lista, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
  dev.avisos = lista;
  return true;
}

/**
 * Os avisos da devolução; a ÚNICA devolução viva do pagamento também lê os do pagamento (antes do M8.2d eles moravam nele,
 * e a união é a mesma). Com várias, só os dela: um aviso de outra devolução nunca abre uma ação nesta.
 */
export const avisosDaDevolucao = (p: { avisos: readonly string[] }, dev: { avisos?: readonly string[] }, unica: boolean): readonly string[] =>
  unica ? [...(dev.avisos ?? []), ...p.avisos] : (dev.avisos ?? []);

/** Os avisos do pagamento com a união dos avisos das devoluções vivas dele (puro). */
export function avisosComDevolucoes(avisosDoPagamento: readonly string[], devs: readonly Pick<Devolucao, "pagamentoId" | "situacao" | "avisos">[], pagamentoId: string): string[] {
  const proprios = avisosDoPagamento.filter((a) => !DA_DEVOLUCAO.includes(a));
  const dasDevolucoes = devs.filter((d) => d.pagamentoId === pagamentoId && d.situacao !== "substituida").flatMap((d) => d.avisos);
  return [...new Set([...proprios, ...dasDevolucoes])];
}

/** Recalcula e grava os avisos do pagamento (os dele mais a união dos das devoluções), numa escrita só. */
export async function sincronizarAvisosDoPagamento(tx: Db, t: Pick<Travado, "devolucoes">, p: Pagamento, agora: Date): Promise<void> {
  const lista = avisosComDevolucoes(p.avisos, t.devolucoes, p.id);
  if (iguais(lista, p.avisos)) return;
  await tx.update(pagamentos).set({ avisos: lista, atualizadoEm: agora }).where(eq(pagamentos.id, p.id));
  p.avisos = lista;
}
