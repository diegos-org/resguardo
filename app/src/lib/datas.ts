/** O fuso do sistema quando nada diz outro (o horário de Brasília): o padrão de `hojeISO` e de `horaNoFuso`. */
export const FUSO_PADRAO = "America/Sao_Paulo";

/** Data de hoje ("AAAA-MM-DD") no fuso informado (padrão: São Paulo). */
export function hojeISO(fuso = FUSO_PADRAO, agora: Date = new Date()): string {
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

/** Hora guardada: "HH:MM" com dois dígitos, de 00:00 a 23:59 (a única cópia da expressão). */
export const HORA_VALIDA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** O `pattern` do campo de hora (o navegador já ancora no começo e no fim): aceita "15:00" e "9:00". */
export const PADRAO_DO_CAMPO_HORA = "([01]?\\d|2[0-3]):[0-5]\\d";

/**
 * Lê uma hora digitada ou guardada e devolve "HH:MM" com dois dígitos: "15:00", "9:00", "15h", "15h30" e "9h05" valem.
 * Fora disso ("25:00", "15:7", "15", vazio, texto), null: quem chama avisa, sem adivinhar a hora.
 */
export function lerHora(t: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2})|h(\d{2})?)$/.exec(t.trim().toLowerCase());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? m[3] ?? "0");
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * Hora para pessoas, sempre "HH:MM" ("15:00", "09:00", "15:30"): a escrita única da página da casa, da cotação e de
 * Minha reserva. Decisão de Diego em 16/10/2026 (M7.22): 15:00 em tudo. Antes, no M7.20, a cotação e Minha reserva
 * escreviam a hora cheia como "15h" e a página da casa, como "15:00". O que não é hora sai como está.
 */
export const escreverHora = (h: string) => lerHora(h) ?? h;

/** A hora de um instante no fuso ("15:05", "00:05"), em 24 horas: nunca AM/PM nem "24:05". */
export function horaNoFuso(d: Date, fuso = FUSO_PADRAO): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}
