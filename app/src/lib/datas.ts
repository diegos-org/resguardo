/** Data de hoje ("AAAA-MM-DD") no fuso informado (padrão: São Paulo). */
export function hojeISO(fuso = "America/Sao_Paulo", agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

/** "AAAA-MM-DD" mais (ou menos) `dias` dias do calendário. */
export function somarDias(dataISO: string, dias: number): string {
  const d = new Date(`${dataISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Diferença (ms) entre o relógio local do fuso e o UTC naquele instante. */
function deslocamento(instante: number, fuso: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: fuso, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(instante))
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - instante;
}

/** O instante em que é `hora` ("HH:MM") do dia `dataISO` no fuso informado. */
export function instanteLocal(dataISO: string, hora: string, fuso: string): Date {
  const [a, m, d] = dataISO.split("-").map(Number);
  const [h, min] = hora.split(":").map(Number);
  const relogio = Date.UTC(a, m - 1, d, h, min);
  const t = relogio - deslocamento(relogio, fuso);
  return new Date(relogio - deslocamento(t, fuso));
}
