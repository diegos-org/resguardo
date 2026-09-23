import type { TipoContrato } from "@/db/schema";

/** Regras puras de contratos: vigência, sobreposição e percentuais. Datas em "AAAA-MM-DD". */

export type ContratoVigencia = {
  id?: string;
  tipo: TipoContrato;
  comissaoBp: number | null;
  inicio: string;
  fim: string | null;
};

export const NOMES_TIPO: Record<TipoContrato, string> = {
  gestao_completa: "Gestão completa",
  gestao_online: "Gestão online",
  marketplace: "Marketplace",
};

/** Percentual sugerido por tipo (decisões de Diego). Marketplace: fórmula ainda pendente. */
export const COMISSAO_PADRAO_BP: Record<TipoContrato, number | null> = {
  gestao_completa: 1500,
  gestao_online: 1000,
  marketplace: null,
};

const dataOk = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);

export function vigenteEm(c: ContratoVigencia, dia: string): boolean {
  return c.inicio <= dia && (c.fim === null || dia <= c.fim);
}

/** Contrato que vale num dia. Nunca deve haver mais de um (garantido por `sobrepoe`). */
export function contratoVigente<T extends ContratoVigencia>(lista: readonly T[], dia: string): T | null {
  return lista.find((c) => vigenteEm(c, dia)) ?? null;
}

export function sobrepoe(a: ContratoVigencia, b: ContratoVigencia): boolean {
  const fimA = a.fim ?? "9999-12-31";
  const fimB = b.fim ?? "9999-12-31";
  return a.inicio <= fimB && b.inicio <= fimA;
}

/** "15" → 1500; "12,5" → 1250. Aceita até duas casas decimais, entre 0 e 100. */
export function percentualParaBp(texto: string): number | null {
  const t = texto.trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const bp = Math.round(Number(t) * 100);
  return bp >= 0 && bp <= 10000 ? bp : null;
}

export function bpParaTexto(bp: number | null): string {
  if (bp === null) return "a definir";
  return `${(bp / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

export type ErrosContrato = Partial<Record<"tipo" | "comissao" | "inicio" | "fim" | "geral", string>>;

export function validarContrato(
  entrada: Record<string, FormDataEntryValue | undefined>,
  existentes: readonly ContratoVigencia[],
): { ok: true; dados: ContratoVigencia & { observacoes: string } } | { ok: false; erros: ErrosContrato } {
  const erros: ErrosContrato = {};
  const txt = (k: string) => (typeof entrada[k] === "string" ? (entrada[k] as string).trim() : "");
  const tipo = txt("tipo") as TipoContrato;
  if (!(tipo in NOMES_TIPO)) erros.tipo = "Escolha o tipo de contrato.";

  let comissaoBp: number | null = null;
  const pct = txt("comissao");
  if (pct === "") {
    if (tipo !== "marketplace") erros.comissao = "Informe o percentual da empresa.";
  } else {
    comissaoBp = percentualParaBp(pct);
    if (comissaoBp === null) erros.comissao = "Percentual entre 0 e 100, até duas casas (ex.: 15 ou 12,5).";
  }

  const inicio = txt("inicio");
  const fim = txt("fim") || null;
  if (!dataOk(inicio)) erros.inicio = "Data de início inválida.";
  if (fim !== null && !dataOk(fim)) erros.fim = "Data de fim inválida.";
  if (!erros.inicio && !erros.fim && fim !== null && fim < inicio) erros.fim = "O fim deve ser igual ou depois do início.";

  if (Object.keys(erros).length === 0) {
    const novo = { tipo, comissaoBp, inicio, fim };
    const conflito = existentes.find((c) => sobrepoe(c, novo));
    if (conflito) {
      erros.geral = `Conflita com o contrato de ${conflito.inicio}${conflito.fim ? ` a ${conflito.fim}` : " (sem fim)"}. Encerre o contrato anterior antes.`;
    }
  }
  if (Object.keys(erros).length) return { ok: false, erros };
  return { ok: true, dados: { tipo, comissaoBp, inicio, fim, observacoes: txt("observacoes") } };
}
