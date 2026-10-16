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

/** Uma data guardada ("AAAA-MM-DD") para pessoas: "16/10/2026". Sem fuso: a data já é o dia. O que não é data sai como está. */
export function dataBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Uma data guardada ("AAAA-MM-DD") sem o ano: "16/10". O que não é data sai como está. */
export function diaMesBr(iso: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[2]}/${m[1]}` : iso;
}

/** O dia de um instante no fuso (padrão: São Paulo): "16/10/2026". */
export const dataNoFuso = (d: Date, fuso = FUSO_PADRAO) => dataBr(hojeISO(fuso, d));

/** O dia de um instante no fuso, sem o ano: "16/10". */
export const diaMesNoFuso = (d: Date, fuso = FUSO_PADRAO) => diaMesBr(hojeISO(fuso, d));

/**
 * Dia e hora de um instante no fuso, com o ano: "16/10/2026 às 15:05" (painel, PDFs e e-mails à equipe). Sem vírgula e
 * sem segundos; o " às " é montado aqui, sem depender da versão do ICU.
 */
export const dataHoraNoFuso = (d: Date, fuso = FUSO_PADRAO) => `${dataNoFuso(d, fuso)} às ${horaNoFuso(d, fuso)}`;

/** Dia e hora de um instante no fuso, sem o ano: "16/10 às 15:05" (os prazos e os registros que o hóspede vê). */
export const diaHoraNoFuso = (d: Date, fuso = FUSO_PADRAO) => `${diaMesBr(hojeISO(fuso, d))} às ${horaNoFuso(d, fuso)}`;

/** Como dizer o fuso ao lado de uma hora: "horário de Brasília" no padrão, "horário do local do imóvel" nos outros. */
export const rotuloDoFuso = (fuso: string) => (fuso === FUSO_PADRAO ? "horário de Brasília" : "horário do local do imóvel");

/**
 * O dia da semana de uma data guardada ("AAAA-MM-DD"), sem fuso: 0 = domingo … 6 = sábado. É o número guardado nas regras
 * (dias de entrada e de saída, mínimo por dia, dia do repasse semanal) e não muda com a ordem em que a semana aparece.
 */
export const diaDaSemana = (d: string) => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))).getUTCDay();

/**
 * O primeiro dia da semana nos calendários e nas listas de dias: segunda-feira (1). Decisão de Diego em 16/10/2026 (M7.22):
 * a semana começa na segunda em todos os calendários, por ser "visualmente muito mais prático" no Brasil. Antes, o
 * calendário de datas do site (M7.6) e as listas de dias começavam no domingo.
 */
export const PRIMEIRO_DIA_DA_SEMANA = 1;

/** Os números dos dias na ordem em que a semana aparece: [1, 2, 3, 4, 5, 6, 0] (de segunda a domingo). */
export const DIAS_NA_ORDEM: readonly number[] = Array.from({ length: 7 }, (_, i) => (PRIMEIRO_DIA_DA_SEMANA + i) % 7);

/** A coluna da data na semana mostrada: 0 na segunda … 6 no domingo. */
export const posicaoNaSemana = (d: string) => (diaDaSemana(d) - PRIMEIRO_DIA_DA_SEMANA + 7) % 7;

/** Nomes dos dias, todos indexados pelo número guardado (0 = domingo); para mostrar na ordem da semana, `DIAS_NA_ORDEM`. */
export const DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;
/** Os nomes inteiros, como nas frases do repasse semanal ("toda segunda-feira"). */
export const NOMES_DIA_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"] as const;
/** O cabeçalho das colunas do calendário de datas do site e os rótulos curtos ("sex 16/10"). */
export const DIAS_DA_SEMANA_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;
/** A letra do dia sobre o número, nos calendários do mês do painel e do portal. */
export const LETRAS_DA_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"] as const;

/** Sábado ou domingo. */
export const fimDeSemana = (d: string) => diaDaSemana(d) === 0 || diaDaSemana(d) === 6;

/** O rótulo curto de uma data: "sex 16/10" (agenda da equipe, Limpezas e a tela da profissional). */
export const diaCurto = (d: string) => `${DIAS_DA_SEMANA_CURTOS[diaDaSemana(d)]} ${diaMesBr(d)}`;

/** O dia da semana e a data com o ano: "sex, 16/10/2026" (Minha reserva). Sem Intl: o mesmo texto em qualquer servidor. */
export const diaDaSemanaEData = (d: string) => `${DIAS_DA_SEMANA_CURTOS[diaDaSemana(d)]}, ${dataBr(d)}`;
