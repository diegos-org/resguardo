/**
 * M8.2d: as entradas que uma reserva paga pelo site já teve pelas alterações aplicadas (antes e depois de cada uma), para
 * `entradaQueConta`: adiantar a entrada uma vez encurta os prazos da política para sempre, e adiar depois não os reabre.
 * Só as alterações aplicadas mudaram a reserva (a segurada, a vencida e a desistida, não).
 */
import { and, eq } from "drizzle-orm";
import { alteracoesReserva } from "@/db/schema";
import type { Db } from "@/db/types";

type ComEntradas = { situacao: string; checkinAntes: string; checkinDepois: string };

/** As entradas das alterações aplicadas (as já carregadas, como as da trava da cotação). */
export const entradasDasAlteracoes = (alteracoes: readonly ComEntradas[]): string[] =>
  alteracoes.filter((a) => a.situacao === "aplicada").flatMap((a) => [a.checkinAntes, a.checkinDepois]);

/** As entradas das alterações aplicadas de uma reserva, lidas do banco. */
export async function entradasDaReserva(db: Db, organizacaoId: string, reservaId: string): Promise<string[]> {
  const linhas = await db
    .select({ situacao: alteracoesReserva.situacao, checkinAntes: alteracoesReserva.checkinAntes, checkinDepois: alteracoesReserva.checkinDepois })
    .from(alteracoesReserva)
    .where(and(eq(alteracoesReserva.reservaId, reservaId), eq(alteracoesReserva.organizacaoId, organizacaoId), eq(alteracoesReserva.situacao, "aplicada")));
  return entradasDasAlteracoes(linhas);
}
