import { and, eq, gt, ne, sql } from "drizzle-orm";
import { beds24Envios, beds24ReservasOperacoes } from "@/db/schema";
import type { Db } from "@/db/types";

/**
 * Importação e envio leem e gravam o mesmo calendário local (observações e estado enviado), então
 * compartilham uma única trava por organização: nunca rodam ao mesmo tempo. Sem isso, uma importação
 * que leu o Beds24 antes de uma escrita do envio poderia gravar depois dela uma foto velha como se fosse nova.
 * O envio de reservas do site (M8.3) usa a mesma trava: a ordem única de quem toca o Beds24 e o imóvel é
 * `beds24:<org>` → imóvel → reserva → cancelamento → alterações (desenho 3.6).
 */
export const chaveTravaBeds24 = (org: string) => `beds24:${org}`;

/** Envio "executando" mais novo que isto está entre a escrita externa e o registro final; mais velho é considerado interrompido. */
export const JANELA_ENVIO_EM_ANDAMENTO_MS = 10 * 60_000;

/**
 * Operação de reserva do site "enviando" mais nova que isto (M8.3, desenho 3.6) está entre a escrita externa e o registro
 * final: os 300 s da rotina mais uma folga. Contada pelo relógio do banco, o mesmo que grava `iniciado_em`.
 */
export const JANELA_RESERVA_EM_ANDAMENTO_MINUTOS = 6;

/** Tenta a trava da organização dentro da transação atual; `false` = outra operação do Beds24 em andamento. */
export async function tentarTravaBeds24(tx: Db, org: string): Promise<boolean> {
  const trava = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${chaveTravaBeds24(org)})) as obtida`);
  return (trava as { rows: { obtida: boolean }[] }).rows[0]?.obtida === true;
}

/** O que está escrevendo no Beds24 fora da trava: o envio de calendário (M3.7) ou o envio de uma reserva do site (M8.3). */
export type CausaEscritaBeds24 = "calendario" | "reserva";

/**
 * Há uma escrita no Beds24 entre a escrita externa e o registro final (a fase sem trava)? Junta o envio de calendário
 * `executando` (janela de 10 min a partir de `agora`) e as operações de reserva do site `enviando` com `iniciado_em` nos
 * últimos 6 min do relógio do banco. Devolve a causa (para a mensagem) ou null. Importação, envio de calendário, bloqueios,
 * vínculo e fonte de preços esperam; `excetoEnvioId` é a própria execução do envio que pergunta.
 */
export async function escritaBeds24EmAndamento(tx: Db, org: string, o: { agora?: Date; excetoEnvioId?: string } = {}): Promise<CausaEscritaBeds24 | null> {
  const agora = o.agora ?? new Date();
  const condicoes = [eq(beds24Envios.organizacaoId, org), eq(beds24Envios.situacao, "executando"), gt(beds24Envios.iniciadoEm, new Date(agora.getTime() - JANELA_ENVIO_EM_ANDAMENTO_MS))];
  if (o.excetoEnvioId) condicoes.push(ne(beds24Envios.id, o.excetoEnvioId));
  const [envio] = await tx.select({ id: beds24Envios.id }).from(beds24Envios).where(and(...condicoes)).limit(1);
  if (envio) return "calendario";
  const [reserva] = await tx
    .select({ id: beds24ReservasOperacoes.id })
    .from(beds24ReservasOperacoes)
    .where(and(eq(beds24ReservasOperacoes.organizacaoId, org), eq(beds24ReservasOperacoes.situacao, "enviando"), sql`${beds24ReservasOperacoes.iniciadoEm} > now() - make_interval(mins => ${JANELA_RESERVA_EM_ANDAMENTO_MINUTOS})`))
    .limit(1);
  return reserva ? "reserva" : null;
}

export const MENSAGEM_ENVIO_EM_ANDAMENTO = "Há um envio de calendário e preços em andamento. Aguarde alguns minutos e tente de novo.";
/**
 * A reserva do site sendo enviada, sem a palavra "Beds24": esta mensagem chega também ao proprietário (o bloqueio de uso
 * próprio pelo portal passa por `esperarEnvioBeds24`).
 */
export const MENSAGEM_RESERVA_EM_ANDAMENTO = "Há um envio de reserva do site aos canais em andamento. Aguarde alguns minutos e tente de novo.";
/** A mesma causa para a equipe (importação e envio de calendário, só no painel). */
export const MENSAGEM_RESERVA_EM_ANDAMENTO_EQUIPE = "Há um envio de reserva do site ao Beds24 em andamento. Aguarde alguns minutos e tente de novo.";

/** A causa em poucas palavras, para o registro "não rodou" das rotinas diárias (página Sistema). `trava`: a trava ocupada. */
export const CAUSA_EM_ANDAMENTO: Record<CausaEscritaBeds24 | "trava", string> = {
  trava: "outra importação ou envio do Beds24 em andamento",
  calendario: "envio de calendário e preços ao Beds24 em andamento",
  reserva: "envio de reserva do site ao Beds24 em andamento",
};

/**
 * Para edições locais que o envio planeja a partir delas (bloqueios manuais, vínculo Beds24, fonte de preços): espera a
 * trava do Beds24 dentro da transação atual e devolve a mensagem de recusa se um envio (de calendário ou de reserva do
 * site) está entre a escrita externa e o registro final (fase sem trava); null quando pode seguir. Quem chama pega esta
 * trava antes de travar o imóvel (ordem única, desenho 3.6).
 */
export async function esperarEnvioBeds24(tx: Db, org: string, agora = new Date()): Promise<string | null> {
  await tx.execute(sql`set local lock_timeout = '15s'`);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${chaveTravaBeds24(org)}))`);
  const causa = await escritaBeds24EmAndamento(tx, org, { agora });
  return causa === "calendario" ? MENSAGEM_ENVIO_EM_ANDAMENTO : causa === "reserva" ? MENSAGEM_RESERVA_EM_ANDAMENTO : null;
}
