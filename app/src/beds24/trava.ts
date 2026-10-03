import { and, eq, gt, ne, sql } from "drizzle-orm";
import { beds24Envios } from "@/db/schema";
import type { Db } from "@/db/types";

/**
 * Importação e envio leem e gravam o mesmo calendário local (observações e estado enviado), então
 * compartilham uma única trava por organização: nunca rodam ao mesmo tempo. Sem isso, uma importação
 * que leu o Beds24 antes de uma escrita do envio poderia gravar depois dela uma foto velha como se fosse nova.
 */
export const chaveTravaBeds24 = (org: string) => `beds24:${org}`;

/** Envio "executando" mais novo que isto está entre a escrita externa e o registro final; mais velho é considerado interrompido. */
export const JANELA_ENVIO_EM_ANDAMENTO_MS = 10 * 60_000;

/** Tenta a trava da organização dentro da transação atual; `false` = outra operação do Beds24 em andamento. */
export async function tentarTravaBeds24(tx: Db, org: string): Promise<boolean> {
  const trava = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${chaveTravaBeds24(org)})) as obtida`);
  return (trava as { rows: { obtida: boolean }[] }).rows[0]?.obtida === true;
}

/** Há um envio entre a escrita externa e o registro final (fase sem trava)? Importação e outro envio esperam. */
export async function envioEmAndamento(tx: Db, org: string, agora: Date, excetoEnvioId?: string): Promise<boolean> {
  const condicoes = [eq(beds24Envios.organizacaoId, org), eq(beds24Envios.situacao, "executando"), gt(beds24Envios.iniciadoEm, new Date(agora.getTime() - JANELA_ENVIO_EM_ANDAMENTO_MS))];
  if (excetoEnvioId) condicoes.push(ne(beds24Envios.id, excetoEnvioId));
  const emAndamento = await tx.select({ id: beds24Envios.id }).from(beds24Envios).where(and(...condicoes)).limit(1);
  return emAndamento.length > 0;
}
