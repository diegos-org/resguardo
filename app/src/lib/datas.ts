/** Data de hoje ("AAAA-MM-DD") no fuso informado (padrão: São Paulo). */
export function hojeISO(fuso = "America/Sao_Paulo", agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}
