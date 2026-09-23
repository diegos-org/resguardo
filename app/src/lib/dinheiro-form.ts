/** "1.234,56" / "1234,56" / "1234.56" / "1234" → centavos. Vazio → null. Inválido → undefined. */
export function reaisParaCentavos(texto: string): number | null | undefined {
  const t = texto.trim().replace(/^R\$\s*/, "");
  if (t === "") return null;
  let normal: string;
  if (/^\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(t)) normal = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d+(,\d{1,2})?$/.test(t)) normal = t.replace(",", ".");
  else if (/^\d+(\.\d{1,2})?$/.test(t)) normal = t;
  else return undefined;
  const [inteiro, frac = ""] = normal.split(".");
  const centavos = Number(inteiro) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(centavos) ? centavos : undefined;
}

export function centavosParaCampo(c: number | null): string {
  if (c === null) return "";
  return `${Math.trunc(c / 100)},${String(c % 100).padStart(2, "0")}`;
}
