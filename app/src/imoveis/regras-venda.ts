/**
 * Regras de venda e preço do imóvel (M2.6). Puro: sem banco. O site (M7/M8), a sincronização
 * com o Beds24 (M3.7) e o simulador do painel usam estas mesmas funções — uma regra, um lugar.
 *
 * Datas "AAAA-MM-DD"; noites de `checkin` até o dia anterior ao `checkout`. Dinheiro em centavos.
 * Faltou preço de alguma noite? A cotação fica pendente com aviso — nunca chuta um valor.
 */

export type RegrasVenda = {
  estadiaMinima: number | null;
  estadiaMaxima: number | null;
  antecedenciaMinima: number | null;
  janelaMaxima: number | null;
  diasChegada: readonly number[];
  diasSaida: readonly number[];
  precoBase: number | null;
  precoDinamico: boolean;
  precoMinimo: number | null;
  precoMaximo: number | null;
  taxaLimpeza: number | null;
  hospedeExtraValor: number | null;
  hospedeExtraAPartirDe: number | null;
};

export type Periodo = { id?: string; nome: string; inicio: string; fim: string; precoNoite: number | null; estadiaMinima: number | null };

export const DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;

const DIA_MS = 86_400_000;
const utc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
export const somarDias = (d: string, n: number) => new Date(utc(d) + n * DIA_MS).toISOString().slice(0, 10);
export const diasEntre = (a: string, b: string) => Math.round((utc(b) - utc(a)) / DIA_MS);
export const diaDaSemana = (d: string) => new Date(utc(d)).getUTCDay();

export function periodoDaNoite(periodos: readonly Periodo[], noite: string): Periodo | undefined {
  return periodos.find((p) => p.inicio <= noite && noite <= p.fim);
}

export type PrecoNoite = { data: string; valor: number | null; fonte: "periodo" | "base" | "evento" | "feriado" | "sem_preco" | "beds24"; periodo?: string; ajustado?: boolean };

/**
 * Preço de uma noite: exceção do período, senão o preço base. Com o preço dinâmico ligado, o
 * preço base é mantido entre o mínimo e o máximo. Preço explícito de período é uma
 * exceção manual e preserva seu valor, inclusive acima do teto geral.
 */
export function precoDaNoite(r: RegrasVenda, periodos: readonly Periodo[], noite: string): PrecoNoite {
  const p = periodoDaNoite(periodos, noite);
  const bruto = p?.precoNoite ?? r.precoBase;
  if (bruto === null) return { data: noite, valor: null, fonte: "sem_preco" };
  let valor = bruto;
  if (r.precoDinamico && p?.precoNoite == null) {
    if (r.precoMinimo !== null && valor < r.precoMinimo) valor = r.precoMinimo;
    if (r.precoMaximo !== null && valor > r.precoMaximo) valor = r.precoMaximo;
  }
  return { data: noite, valor, fonte: p?.precoNoite != null ? "periodo" : "base", periodo: p?.nome, ajustado: valor !== bruto || undefined };
}

/** Estadia mínima que vale para uma entrada: a do período da noite de entrada, senão a geral. */
export function estadiaMinimaNaEntrada(r: RegrasVenda, periodos: readonly Periodo[], checkin: string): number | null {
  return periodoDaNoite(periodos, checkin)?.estadiaMinima ?? r.estadiaMinima;
}

/** Tudo o que impede a estadia, em linguagem simples. Lista vazia = pode. */
export function verificarEstadia(r: RegrasVenda, periodos: readonly Periodo[], checkin: string, checkout: string, hoje: string): string[] {
  const problemas: string[] = [];
  const noites = diasEntre(checkin, checkout);
  if (!(noites > 0)) return ["A saída precisa ser depois da entrada."];
  const minima = estadiaMinimaNaEntrada(r, periodos, checkin);
  if (minima !== null && noites < minima) {
    const p = periodoDaNoite(periodos, checkin);
    problemas.push(`Estadia mínima de ${minima} noite(s)${p?.estadiaMinima != null ? ` em ${p.nome}` : ""}.`);
  }
  if (r.estadiaMaxima !== null && noites > r.estadiaMaxima) problemas.push(`Estadia máxima de ${r.estadiaMaxima} noite(s).`);
  const ate = diasEntre(hoje, checkin);
  if (ate < 0) problemas.push("A entrada já passou.");
  else if (r.antecedenciaMinima !== null && ate < r.antecedenciaMinima) problemas.push(`Precisa reservar com ${r.antecedenciaMinima} dia(s) de antecedência.`);
  if (r.janelaMaxima !== null && ate > r.janelaMaxima) problemas.push(`Aceita reservas só até ${r.janelaMaxima} dias à frente.`);
  if (r.diasChegada.length && !r.diasChegada.includes(diaDaSemana(checkin))) {
    problemas.push(`Entrada só em: ${r.diasChegada.map((d) => DIAS_SEMANA[d]).join(", ")}.`);
  }
  if (r.diasSaida.length && !r.diasSaida.includes(diaDaSemana(checkout))) {
    problemas.push(`Saída só em: ${r.diasSaida.map((d) => DIAS_SEMANA[d]).join(", ")}.`);
  }
  return problemas;
}

export type Cotacao = {
  noites: PrecoNoite[];
  diarias: number | null;
  limpeza: number;
  hospedeExtra: number;
  total: number | null;
  avisos: string[];
};

/** Valor da estadia pelo cadastro (base e períodos): diárias + limpeza + hóspede extra por noite. */
export function cotarEstadia(r: RegrasVenda, periodos: readonly Periodo[], checkin: string, checkout: string, hospedes: number): Cotacao {
  const n = Math.max(0, diasEntre(checkin, checkout));
  return cotarNoites(r, Array.from({ length: n }, (_, i) => precoDaNoite(r, periodos, somarDias(checkin, i))), hospedes);
}

/**
 * Valor da estadia a partir dos preços já decididos de cada noite (ex.: os do motor de
 * calendário, com eventos e última hora). Sem preço em alguma noite → total null.
 */
export function cotarNoites(r: RegrasVenda, noites: readonly PrecoNoite[], hospedes: number): Cotacao {
  const n = noites.length;
  const avisos: string[] = [];
  const semPreco = noites.filter((x) => x.valor === null);
  if (semPreco.length) avisos.push(`Sem preço definido para ${semPreco.length} noite(s): cadastre o preço base ou um período.`);
  const diarias = semPreco.length ? null : noites.reduce((s, x) => s + (x.valor ?? 0), 0);
  const limpeza = r.taxaLimpeza ?? 0;
  if (r.taxaLimpeza === null) avisos.push("Taxa de limpeza não cadastrada: considerada zero.");
  let hospedeExtra = 0;
  if (r.hospedeExtraValor !== null && r.hospedeExtraAPartirDe !== null && hospedes >= r.hospedeExtraAPartirDe) {
    hospedeExtra = (hospedes - r.hospedeExtraAPartirDe + 1) * r.hospedeExtraValor * n;
  }
  if (noites.some((x) => x.ajustado)) avisos.push("Algumas noites foram ajustadas ao preço mínimo/máximo.");
  return { noites: [...noites], diarias, limpeza, hospedeExtra, total: diarias === null ? null : diarias + limpeza + hospedeExtra, avisos };
}
