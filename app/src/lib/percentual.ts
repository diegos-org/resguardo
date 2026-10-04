/** Percentuais como pontos-base inteiros (1500 = 15%), para contratos, taxas e pesos. */

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
