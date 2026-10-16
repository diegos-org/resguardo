/**
 * Calendário próprio do site (M7.6): regras puras da escolha de datas, sem banco e sem rede. O campo de
 * datas do navegador (`CampoDatas`) e a rota de noites ocupadas usam estas mesmas funções.
 *
 * Datas são dias de calendário "AAAA-MM-DD" (nunca `Date` local: nada de fuso deslocando um dia). A
 * semana começa na segunda-feira, como em todos os calendários do sistema (`PRIMEIRO_DIA_DA_SEMANA`, decisão de
 * Diego em 16/10/2026, M7.22); antes, no M7.6, começava no domingo. As noites de uma estadia vão da entrada
 * até o dia anterior à saída: o dia de saída pode ser uma noite ocupada (a saída é de manhã e outra
 * pessoa pode entrar no mesmo dia). Estadia mínima e outras regras de venda não entram aqui — o
 * servidor confere e explica na consulta.
 */
import { diasEntre, somarDias } from "@/imoveis/regras-venda";
import { DIAS_DA_SEMANA_CURTOS, DIAS_SEMANA, posicaoNaSemana } from "@/lib/datas";

export const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const;
/**
 * Cabeçalho das colunas (`DIAS_DA_SEMANA_CURTOS`, com o nome inteiro em `DIAS_SEMANA`), de lib/datas.ts: indexado pelo
 * número do dia (0 = domingo) e mostrado na ordem de `DIAS_NA_ORDEM`, de segunda a domingo.
 */
export { DIAS_DA_SEMANA_CURTOS, DIAS_SEMANA };

/** Quantos meses o calendário mostra a partir do mês de hoje (inclusive). */
export const MESES_A_FRENTE = 18;
/** Maior intervalo que a rota de noites ocupadas aceita por pedido (dois meses lado a lado). */
export const MAXIMO_DIAS_OCUPACAO = 62;

export const RECUSAS = {
  passada: "Essa data já passou.",
  ocupada: "Essa noite já está ocupada.",
  cruza: "Há noites ocupadas nesse intervalo.",
  fim: "O último dia do calendário só pode ser a saída. Para datas mais adiante, fale com a equipe.",
} as const;

export function dataISOValida(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

export const inicioDoMes = (d: string) => `${d.slice(0, 7)}-01`;

/** Primeiro dia do mês `n` meses depois (ou antes, com `n` negativo) do mês de `d`. */
export function somarMeses(d: string, n: number): string {
  const total = Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1 + n;
  const ano = Math.floor(total / 12);
  return `${String(ano).padStart(4, "0")}-${String(total - ano * 12 + 1).padStart(2, "0")}-01`;
}

/** Primeiro dia que o calendário já não mostra: o mês de hoje mais `MESES_A_FRENTE` meses. */
export const limiteDoCalendario = (hoje: string) => somarMeses(hoje, MESES_A_FRENTE);

/** Meses (primeiro dia) de `de` até `ate`, inclusive. */
export function mesesEntre(de: string, ate: string): string[] {
  const meses: string[] = [];
  for (let m = inicioDoMes(de); m <= inicioDoMes(ate) && meses.length < 240; m = somarMeses(m, 1)) meses.push(m);
  return meses;
}

/**
 * Semanas do mês, de segunda a domingo (desde 16/10/2026, decisão de Diego; antes, de domingo a sábado); `null` nos dias
 * que são de outro mês.
 */
export function semanasDoMes(mes: string): (string | null)[][] {
  const primeiro = inicioDoMes(mes);
  const dias = Array.from({ length: diasEntre(primeiro, somarMeses(primeiro, 1)) }, (_, i) => somarDias(primeiro, i));
  const celulas: (string | null)[] = [...Array<null>(posicaoNaSemana(primeiro)).fill(null), ...dias];
  while (celulas.length % 7) celulas.push(null);
  return Array.from({ length: celulas.length / 7 }, (_, i) => celulas.slice(i * 7, i * 7 + 7));
}

/** "outubro de 2026". */
export const nomeDoMes = (d: string) => `${MESES[Number(d.slice(5, 7)) - 1]} de ${d.slice(0, 4)}`;
/** "12/10/2026", como no campo. */
export const dataCurta = (d: string) => d.split("-").reverse().join("/");
/** "12 de outubro de 2026", para leitores de tela. */
export const dataPorExtenso = (d: string) => `${Number(d.slice(8, 10))} de ${nomeDoMes(d)}`;

/** Alguma noite de `entrada` até a véspera de `saida` está ocupada? */
export const cruzaOcupada = (entrada: string, saida: string, ocupadas: ReadonlySet<string>) => [...ocupadas].some((n) => n >= entrada && n < saida);

/** Última saída possível a partir da entrada: a primeira noite ocupada desde a entrada (null = sem limite conhecido). */
export function ultimaSaidaPossivel(entrada: string, ocupadas: ReadonlySet<string>): string | null {
  let primeira: string | null = null;
  for (const n of ocupadas) if (n >= entrada && (primeira === null || n < primeira)) primeira = n;
  return primeira;
}

export type Datas = { entrada: string; saida: string };
/** O que o próximo clique escolhe. Sem entrada, é sempre a entrada. */
export type Etapa = "entrada" | "saida";
/** `ultimoDia`: o último dia que o calendário mostra; ele só serve de saída (sem ele, a entrada nele não teria saída). */
export type Contexto = { hoje: string; ocupadas: ReadonlySet<string>; ultimoDia?: string };
export type Escolha = { datas: Datas; etapa: Etapa | "pronta"; recusa: string | null };

const etapaEfetiva = (datas: Datas, etapa: Etapa): Etapa => (etapa === "saida" && datas.entrada ? "saida" : "entrada");

/**
 * Um clique num dia. Escolhendo a saída, um dia depois da entrada vira a saída (se nenhuma noite do
 * intervalo estiver ocupada; senão a escolha é recusada e a entrada fica); um dia igual ou anterior à
 * entrada recomeça a escolha por ele. Escolhendo a entrada, uma noite ocupada é recusada; a saída
 * anterior é descartada e o próximo clique escolhe a saída.
 */
export function escolherDia(datas: Datas, dia: string, etapa: Etapa, c: Contexto): Escolha {
  if (dia < c.hoje) return { datas, etapa: etapaEfetiva(datas, etapa), recusa: RECUSAS.passada };
  if (etapaEfetiva(datas, etapa) === "saida" && dia > datas.entrada) {
    if (cruzaOcupada(datas.entrada, dia, c.ocupadas)) return { datas, etapa: "saida", recusa: RECUSAS.cruza };
    return { datas: { entrada: datas.entrada, saida: dia }, etapa: "pronta", recusa: null };
  }
  if (c.ocupadas.has(dia)) return { datas, etapa: etapaEfetiva(datas, etapa), recusa: RECUSAS.ocupada };
  if (c.ultimoDia && dia >= c.ultimoDia) return { datas, etapa: etapaEfetiva(datas, etapa), recusa: RECUSAS.fim };
  return { datas: { entrada: dia, saida: "" }, etapa: "saida", recusa: null };
}

export type SituacaoDia = {
  hoje: boolean;
  passada: boolean;
  /** Noite ocupada (reserva, bloqueio ou agenda fechada). */
  ocupada: boolean;
  /** Ocupada, mas serve de dia de saída para a entrada escolhida. */
  soSaida: boolean;
  /** Um clique neste dia é aceito (sem recusa). */
  disponivel: boolean;
  entrada: boolean;
  saida: boolean;
  /** Entre a entrada e a saída (ou o dia em prévia, escolhendo a saída). */
  noIntervalo: boolean;
};

/** Como o calendário mostra um dia. `previa`: o dia sob o ponteiro ou o foco, escolhendo a saída. */
export function situacaoDoDia(dia: string, datas: Datas, etapa: Etapa, c: Contexto, previa?: string | null): SituacaoDia {
  const passada = dia < c.hoje;
  const ocupada = c.ocupadas.has(dia);
  const naSaida = etapaEfetiva(datas, etapa) === "saida";
  const ateOnde = naSaida ? ultimaSaidaPossivel(datas.entrada, c.ocupadas) : null;
  const serveDeSaida = (d: string) => naSaida && d > datas.entrada && (ateOnde === null || d <= ateOnde);
  const fim = previa && serveDeSaida(previa) ? previa : datas.saida;
  return {
    hoje: dia === c.hoje,
    passada,
    ocupada,
    soSaida: ocupada && serveDeSaida(dia),
    disponivel: !passada && (naSaida && dia > datas.entrada ? serveDeSaida(dia) : !ocupada && !(c.ultimoDia && dia >= c.ultimoDia)),
    entrada: dia === datas.entrada,
    saida: !!datas.saida && dia === datas.saida,
    noIntervalo: !!datas.entrada && !!fim && dia > datas.entrada && dia < fim,
  };
}

/** Nome do dia para leitores de tela: "12 de outubro de 2026, ocupada". */
export function rotuloDoDia(dia: string, s: SituacaoDia): string {
  const partes = [dataPorExtenso(dia)];
  if (s.hoje) partes.push("hoje");
  if (s.entrada) partes.push("entrada");
  if (s.saida) partes.push("saída");
  if (s.passada) partes.push("já passou");
  else if (s.soSaida) partes.push("ocupada, pode ser o dia de saída");
  else if (s.ocupada) partes.push("ocupada");
  else if (!s.disponivel) partes.push("indisponível, há noites ocupadas no caminho");
  return partes.join(", ");
}
