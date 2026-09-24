import { registrarAuditoria } from "@/auditoria/auditoria";
import type { Db } from "@/db/types";
import { recalcularReservas, type ResultadoRecalculo } from "@/financeiro/aplicar";
import type { RegrasMotor } from "@/financeiro/motor";
import { hojeISO } from "@/lib/datas";
import { gravarConfig, lerConfig, travarConfig } from "./armazem";
import { regrasNaData, versoesDe } from "./regras-financeiras";

/**
 * Grava as regras financeiras como uma versão que vale **de hoje em diante** (uma versão já
 * criada hoje é substituída) e recalcula, na MESMA transação, as reservas com entrada de
 * hoje em diante. As reservas anteriores continuam com a versão da época. Tudo-ou-nada.
 */
export async function salvarRegrasFinanceiras(
  db: Db,
  organizacaoId: string,
  regras: RegrasMotor,
  autorId: string | null,
): Promise<{ mudou: boolean; recalculo: ResultadoRecalculo | null }> {
  const hoje = hojeISO();
  return db.transaction(async (tx) => {
    await travarConfig(tx, organizacaoId, "regras_financeiras");
    const versoes = versoesDe(await lerConfig(tx, organizacaoId, "regras_financeiras"));
    const atual = regrasNaData(versoes, hoje);
    const mudancas: Record<string, [unknown, unknown]> = {};
    if (atual.base !== regras.base) mudancas.base = [atual.base, regras.base];
    for (const [o, r] of Object.entries(regras.recebimento)) {
      const antes = atual.recebimento[o as keyof RegrasMotor["recebimento"]];
      if (antes !== r) mudancas[`recebimento.${o}`] = [antes, r];
    }
    if (!Object.keys(mudancas).length) return { mudou: false, recalculo: null };
    const novas = [...versoes.filter((v) => v.desde !== hoje), { desde: hoje, base: regras.base, recebimento: { ...regras.recebimento } }];
    await gravarConfig(tx, organizacaoId, "regras_financeiras", { versoes: novas }, autorId, false);
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "configuracao.regras_financeiras",
      entidade: "configuracao",
      entidadeId: organizacaoId,
      mudancas: { ...mudancas, valeDesde: [null, hoje] },
    });
    // Sem passar regras: cada reserva lê a versão vigente na sua entrada (todas ≥ hoje aqui).
    const recalculo = await recalcularReservas(tx, organizacaoId, {}, autorId);
    return { mudou: true, recalculo };
  });
}
