/**
 * Regras financeiras da organização (M1.7): base da comissão e quem recebe, por canal, quando
 * o imóvel não tem configuração própria. Sem nada gravado, vale `REGRAS_PADRAO` (confirmado
 * por Diego em 24/09). O motor sempre lê daqui — uma regra, um lugar.
 *
 * Cada mudança vira uma VERSÃO com a data em que passa a valer ("desde"), e cada reserva usa
 * a versão vigente na sua data de entrada. Assim, reprocessar uma reserva antiga (ex.: nova
 * sincronização do Beds24) usa a regra da época, nunca a de hoje. Antes da primeira versão,
 * vale `REGRAS_PADRAO`.
 */
import { ORIGENS_RESERVA, type OrigemReserva } from "@/db/schema";
import type { Db } from "@/db/types";
import { REGRAS_PADRAO, type RegrasMotor } from "@/financeiro/motor";
import { hojeISO } from "@/lib/datas";
import { lerConfig } from "./armazem";

export const OPCOES_RECEBIMENTO = ["split", "empresa", "a_confirmar"] as const;
export const OPCOES_BASE = ["liquido_canal", "bruto"] as const;
/** Maior prazo aceito para o canal pagar o proprietário (dias depois do check-in). */
export const PRAZO_MAXIMO = 60;

const PRAZOS_PADRAO = REGRAS_PADRAO.prazoPagamento!;
const prazoValido = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= PRAZO_MAXIMO;

/** Prazo do canal (dias depois do check-in) nestas regras; sem o campo (versão antiga), o padrão. null = sem regra. */
export function prazoDoCanal(regras: RegrasMotor, origem: OrigemReserva): number | null {
  const p = regras.prazoPagamento;
  return p && origem in p ? p[origem] : PRAZOS_PADRAO[origem];
}

/**
 * Prazo do canal para uma reserva, pela data de entrada (a versão da época, como as outras regras). Sem prazo na versão
 * da época (null), vale o da versão atual: o prazo descreve quando o canal paga, então um canal configurado hoje resolve
 * a reserva antiga que atravessa o início do sistema (apontamento do Codex no PR do M4.12). Prazo explícito da época fica.
 */
export function prazoDoCanalNaData(versoes: readonly VersaoRegras[], data: string, origem: OrigemReserva): number | null {
  return prazoDoCanal(regrasNaData(versoes, data), origem) ?? prazoDoCanal(versoes.at(-1) ?? REGRAS_PADRAO, origem);
}

/** Monta regras válidas a partir de um valor qualquer; o que faltar ou vier errado fica no padrão (null explícito = sem prazo). */
export function normalizarRegras(v: Record<string, unknown> | null): RegrasMotor {
  const base = OPCOES_BASE.includes(v?.base as never) ? (v!.base as RegrasMotor["base"]) : REGRAS_PADRAO.base;
  const rec = (v?.recebimento ?? {}) as Record<string, unknown>;
  const recebimento = Object.fromEntries(
    ORIGENS_RESERVA.map((o) => [o, OPCOES_RECEBIMENTO.includes(rec[o] as never) ? rec[o] : REGRAS_PADRAO.recebimento[o]]),
  ) as RegrasMotor["recebimento"];
  const pz = (v?.prazoPagamento ?? {}) as Record<string, unknown>;
  const prazoPagamento = Object.fromEntries(
    ORIGENS_RESERVA.map((o) => [o, pz[o] === null ? null : prazoValido(pz[o]) ? pz[o] : PRAZOS_PADRAO[o]]),
  ) as Record<OrigemReserva, number | null>;
  return { base, recebimento, prazoPagamento };
}

/** Lê do formulário; devolve null se algum valor não é uma opção válida. Campo de prazo ausente = padrão; vazio = sem regra. */
export function lerFormRegras(form: Record<string, unknown>): RegrasMotor | null {
  const base = form.base;
  if (!OPCOES_BASE.includes(base as never)) return null;
  const recebimento: Partial<Record<OrigemReserva, RegrasMotor["recebimento"][OrigemReserva]>> = {};
  const prazoPagamento: Partial<Record<OrigemReserva, number | null>> = {};
  for (const o of ORIGENS_RESERVA) {
    const r = form[`recebimento_${o}`];
    if (!OPCOES_RECEBIMENTO.includes(r as never)) return null;
    recebimento[o] = r as RegrasMotor["recebimento"][OrigemReserva];
    const p = form[`prazo_${o}`];
    if (p === undefined) prazoPagamento[o] = PRAZOS_PADRAO[o];
    else if (typeof p === "string" && p.trim() === "") prazoPagamento[o] = null;
    else {
      const n = typeof p === "string" && /^\d{1,2}$/.test(p.trim()) ? Number(p.trim()) : p;
      if (!prazoValido(n)) return null;
      prazoPagamento[o] = n;
    }
  }
  return { base: base as RegrasMotor["base"], recebimento: recebimento as RegrasMotor["recebimento"], prazoPagamento: prazoPagamento as Record<OrigemReserva, number | null> };
}

export type VersaoRegras = RegrasMotor & { desde: string };

/** Versões gravadas, em ordem de data (valores inválidos são descartados). */
export function versoesDe(v: Record<string, unknown> | null): VersaoRegras[] {
  const lista = Array.isArray(v?.versoes) ? (v!.versoes as Record<string, unknown>[]) : [];
  return lista
    .filter((x) => x && typeof x.desde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.desde))
    .map((x) => ({ desde: x.desde as string, ...normalizarRegras(x) }))
    .sort((a, b) => a.desde.localeCompare(b.desde));
}

/** Regra vigente numa data: a última versão com `desde` ≤ data; antes de todas, o padrão. */
export function regrasNaData(versoes: readonly VersaoRegras[], data: string): RegrasMotor {
  const v = versoes.filter((x) => x.desde <= data).at(-1);
  return v ? { base: v.base, recebimento: v.recebimento, prazoPagamento: v.prazoPagamento } : REGRAS_PADRAO;
}

/** Regras vigentes na data (padrão: hoje). O motor passa a data de entrada da reserva. */
export async function lerRegrasFinanceiras(db: Db, organizacaoId: string, data: string = hojeISO()): Promise<RegrasMotor> {
  return regrasNaData(await lerVersoesRegras(db, organizacaoId), data);
}

export async function lerVersoesRegras(db: Db, organizacaoId: string): Promise<VersaoRegras[]> {
  return versoesDe(await lerConfig(db, organizacaoId, "regras_financeiras"));
}
