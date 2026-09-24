/**
 * Regras financeiras da organização (M1.7): base da comissão e quem recebe, por canal, quando
 * o imóvel não tem configuração própria. Sem nada gravado, vale `REGRAS_PADRAO` (confirmado
 * por Diego em 24/09). O motor sempre lê daqui — uma regra, um lugar.
 */
import { ORIGENS_RESERVA, type OrigemReserva } from "@/db/schema";
import type { Db } from "@/db/types";
import { REGRAS_PADRAO, type RegrasMotor } from "@/financeiro/motor";
import { lerConfig } from "./armazem";

export const OPCOES_RECEBIMENTO = ["split", "empresa", "a_confirmar"] as const;
export const OPCOES_BASE = ["liquido_canal", "bruto"] as const;

/** Monta regras válidas a partir de um valor qualquer; o que faltar ou vier errado fica no padrão. */
export function normalizarRegras(v: Record<string, unknown> | null): RegrasMotor {
  const base = OPCOES_BASE.includes(v?.base as never) ? (v!.base as RegrasMotor["base"]) : REGRAS_PADRAO.base;
  const rec = (v?.recebimento ?? {}) as Record<string, unknown>;
  const recebimento = Object.fromEntries(
    ORIGENS_RESERVA.map((o) => [o, OPCOES_RECEBIMENTO.includes(rec[o] as never) ? rec[o] : REGRAS_PADRAO.recebimento[o]]),
  ) as RegrasMotor["recebimento"];
  return { base, recebimento };
}

/** Lê do formulário; devolve null se algum valor não é uma opção válida. */
export function lerFormRegras(form: Record<string, unknown>): RegrasMotor | null {
  const base = form.base;
  if (!OPCOES_BASE.includes(base as never)) return null;
  const recebimento: Partial<Record<OrigemReserva, RegrasMotor["recebimento"][OrigemReserva]>> = {};
  for (const o of ORIGENS_RESERVA) {
    const r = form[`recebimento_${o}`];
    if (!OPCOES_RECEBIMENTO.includes(r as never)) return null;
    recebimento[o] = r as RegrasMotor["recebimento"][OrigemReserva];
  }
  return { base: base as RegrasMotor["base"], recebimento: recebimento as RegrasMotor["recebimento"] };
}

export async function lerRegrasFinanceiras(db: Db, organizacaoId: string): Promise<RegrasMotor> {
  return normalizarRegras(await lerConfig(db, organizacaoId, "regras_financeiras"));
}
