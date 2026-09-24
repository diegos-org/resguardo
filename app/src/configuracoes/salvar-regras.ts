import type { Db } from "@/db/types";
import { recalcularReservas, type ResultadoRecalculo } from "@/financeiro/aplicar";
import type { RegrasMotor } from "@/financeiro/motor";
import { gravarConfig } from "./armazem";

/**
 * Grava as regras financeiras e recalcula, na MESMA transação, as reservas com entrada de
 * hoje em diante (o passado e o dinheiro já movimentado não mudam). Tudo-ou-nada.
 */
export async function salvarRegrasFinanceiras(
  db: Db,
  organizacaoId: string,
  regras: RegrasMotor,
  autorId: string | null,
): Promise<{ mudou: boolean; recalculo: ResultadoRecalculo | null }> {
  return db.transaction(async (tx) => {
    const mudancas = await gravarConfig(tx, organizacaoId, "regras_financeiras", { base: regras.base, recebimento: { ...regras.recebimento } }, autorId);
    if (!Object.keys(mudancas).length) return { mudou: false, recalculo: null };
    const recalculo = await recalcularReservas(tx, organizacaoId, {}, autorId, regras);
    return { mudou: true, recalculo };
  });
}
