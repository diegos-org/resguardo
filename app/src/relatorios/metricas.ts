/**
 * Números do mês do relatório mensal (M5.7), regras puras e testadas. Nada é estimado: métrica sem dado no período
 * inteiro diz "sem dado no sistema"; ocupação sem noite disponível é "não se aplica" (nunca 0 ÷ 0); comparação com
 * base zero vira diferença em R$, nunca percentual; mês parcial compara nada (mostraria queda falsa) e conta as noites
 * disponíveis só até o dia. Dinheiro em centavos inteiros.
 */
import { formatBRL } from "@/lib/money";

/** "AAAA-MM". */
export type MesISO = string;

export const mesISO = (ano: number, mes: number): MesISO => `${ano}-${String(mes).padStart(2, "0")}`;

export function somarMeses(m: MesISO, n: number): MesISO {
  const [ano, mes] = m.split("-").map(Number);
  const total = ano * 12 + (mes - 1) + n;
  return mesISO(Math.floor(total / 12), (total % 12) + 1);
}

export const diasDoMes = (m: MesISO): number => {
  const [ano, mes] = m.split("-").map(Number);
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
};

/** Primeiro dia do mês e primeiro dia do mês seguinte (fim exclusivo), como ISO. */
export const limitesDe = (m: MesISO): { inicio: string; fim: string } => ({ inicio: `${m}-01`, fim: `${somarMeses(m, 1)}-01` });

const NOMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
/** "outubro de 2026". */
export const nomeDoMes = (m: MesISO): string => `${NOMES[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;
/** "out/26" (rótulo do gráfico). */
export const mesCurto = (m: MesISO): string => `${NOMES[Number(m.slice(5, 7)) - 1].slice(0, 3)}/${m.slice(2, 4)}`;

const dias = (d: string): number => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

/** Noites de uma estada (check-in → check-out) dentro de [inicio, fim), fim exclusivo. */
export function noitesNoIntervalo(checkin: string, checkout: string, inicio: string, fim: string): number {
  const de = Math.max(dias(checkin), dias(inicio));
  const ate = Math.min(dias(checkout), dias(fim));
  return Math.max(0, ate - de);
}

/**
 * Noites bloqueadas dentro de [inicio, fim), por imóvel, sem contar duas vezes a mesma noite (bloqueios que se
 * sobrepõem no mesmo imóvel contam uma vez).
 */
export function noitesBloqueadas(bloqueios: readonly { imovelId: string; inicio: string; fim: string }[], inicio: string, fim: string): number {
  const porImovel = new Map<string, Set<number>>();
  for (const b of bloqueios) {
    const de = Math.max(dias(b.inicio), dias(inicio));
    const ate = Math.min(dias(b.fim), dias(fim));
    const noites = porImovel.get(b.imovelId) ?? new Set<number>();
    for (let d = de; d < ate; d++) noites.add(d);
    porImovel.set(b.imovelId, noites);
  }
  return [...porImovel.values()].reduce((s, n) => s + n.size, 0);
}

export type DadosDoMes = {
  mes: MesISO;
  /** Sua parte menos as despesas do imóvel, em centavos; null = mês sem dado no sistema. */
  resultado: number | null;
  /** Bruto das reservas (parte do mês), em centavos. */
  bruto: number;
  noitesOcupadas: number;
  /** Noites do período considerado por imóvel (mês inteiro; no mês parcial, só até o dia). */
  noitesDoPeriodo: number;
  imoveis: number;
  /** Noites bloqueadas para uso próprio pelo proprietário no período (M5.5). */
  noitesBloqueadas: number;
};

export type Ocupacao = { ocupadas: number; disponiveis: number; bloqueadas: number; percentual: number | null };

/** Ocupação = ocupadas ÷ (noites do período × imóveis − bloqueadas). Sem noite disponível: percentual null ("não se aplica"). */
export function ocupacao(d: Pick<DadosDoMes, "noitesOcupadas" | "noitesDoPeriodo" | "imoveis" | "noitesBloqueadas">): Ocupacao {
  const disponiveis = Math.max(0, d.noitesDoPeriodo * d.imoveis - d.noitesBloqueadas);
  return { ocupadas: d.noitesOcupadas, disponiveis, bloqueadas: d.noitesBloqueadas, percentual: disponiveis > 0 ? Math.round((d.noitesOcupadas / disponiveis) * 100) : null };
}

/** Bruto ÷ noites ocupadas (centavos, arredondado); sem noite, null. */
export const diariaMedia = (bruto: number, noites: number): number | null => (noites > 0 ? Math.round(bruto / noites) : null);

export type Variacao = { tipo: "percentual"; valor: number } | { tipo: "diferenca"; valor: number } | null;

/** Variação do resultado: percentual sobre o anterior; anterior zero → diferença em R$; anterior sem dado → null. */
export function variacao(atual: number, anterior: number | null): Variacao {
  if (anterior === null) return null;
  if (anterior === 0) return { tipo: "diferenca", valor: atual };
  return { tipo: "percentual", valor: Math.round(((atual - anterior) / Math.abs(anterior)) * 100) };
}

export type PontoDaSerie = { mes: MesISO; resultado: number | null; atual: boolean };

/** Os 12 meses até `mes` (inclusive), com o resultado de cada um ou null (sem dado). */
export function serieDe12(resultados: ReadonlyMap<MesISO, number | null>, mes: MesISO): PontoDaSerie[] {
  return Array.from({ length: 12 }, (_, i) => somarMeses(mes, i - 11)).map((m) => ({ mes: m, resultado: resultados.get(m) ?? null, atual: m === mes }));
}

/** Soma do resultado de janeiro até `mes` (só meses com dado); `desde` é o primeiro mês com dado. null = nenhum. */
export function acumuladoDoAno(resultados: ReadonlyMap<MesISO, number | null>, mes: MesISO): { valor: number; desde: MesISO } | null {
  const ano = mes.slice(0, 4);
  const meses = [...resultados.entries()].filter(([m, r]) => m.startsWith(ano) && m <= mes && r !== null).sort(([a], [b]) => a.localeCompare(b));
  if (!meses.length) return null;
  return { valor: meses.reduce((s, [, r]) => s + (r ?? 0), 0), desde: meses[0][0] };
}

/** Escala do gráfico em R$ mil: teto e passo "redondos" para o maior valor da série (mínimo 1 mil). */
export function escalaEmMil(maximoCentavos: number): { teto: number; passo: number } {
  const maxMil = Math.max(1, maximoCentavos / 100_000);
  const passos = [1, 2, 4, 5, 10, 20, 25, 50, 100, 200, 500, 1000];
  const passo = passos.find((p) => maxMil / p <= 4) ?? 1000 * Math.ceil(maxMil / 4000);
  return { teto: Math.max(passo, Math.ceil(maxMil / passo) * passo), passo };
}

export type Quadro = { valor: string; legenda: string; semDado: boolean };

const pct = (v: number) => `${v}%`;
const sinal = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "");
const brlAbs = (v: number) => formatBRL(Math.abs(v));

/**
 * Os quatro quadros dos "Números do mês" (página 2): noites e ocupação; diária média; comparação com o mês anterior;
 * comparação com o mesmo mês do ano anterior. `parcialAte`: dia do mês até onde os números valem (mês corrente).
 */
export function quadrosDoMes(o: { atual: DadosDoMes; anterior: DadosDoMes | null; anoAnterior: DadosDoMes | null; parcialAte: number | null }): Quadro[] {
  const a = o.atual;
  const oc = ocupacao(a);
  const ate = o.parcialAte !== null ? ` até ${o.parcialAte}/${Number(a.mes.slice(5, 7))}` : "";
  const noites: Quadro = {
    valor: `${a.noitesOcupadas} ${a.noitesOcupadas === 1 ? "noite" : "noites"}${ate}`,
    legenda:
      oc.percentual === null
        ? `ocupação não se aplica: ${oc.bloqueadas > 0 ? "todas as noites bloqueadas para seu uso" : "nenhuma noite disponível no período"}`
        : `${pct(oc.percentual)} de ocupação: ${oc.ocupadas} de ${oc.disponiveis} noites disponíveis${oc.bloqueadas > 0 ? ` (${oc.bloqueadas} bloqueada${oc.bloqueadas === 1 ? "" : "s"} para seu uso)` : ""}`,
    semDado: false,
  };
  const dm = diariaMedia(a.bruto, a.noitesOcupadas);
  const diaria: Quadro = dm === null ? { valor: "sem reserva no mês", legenda: "diária média: aparece quando houver noite ocupada", semDado: true } : { valor: formatBRL(dm), legenda: "diária média por noite, com limpeza (bruto ÷ noites)", semDado: false };
  const comparar = (outro: DadosDoMes | null, rotulo: string, semDado: string): Quadro => {
    if (o.parcialAte !== null) return { valor: "mês em andamento", legenda: `sem comparação com ${rotulo} até o mês terminar (os números valem até ${o.parcialAte}/${Number(a.mes.slice(5, 7))})`, semDado: true };
    if (!outro || outro.resultado === null || a.resultado === null) return { valor: "sem dado no sistema", legenda: semDado, semDado: true };
    const v = variacao(a.resultado, outro.resultado)!;
    const ocOutro = ocupacao(outro).percentual;
    const ocupacoes = oc.percentual !== null && ocOutro !== null ? `; ocupação de ${pct(ocOutro)} para ${pct(oc.percentual)}` : "";
    if (v.tipo === "diferenca") return { valor: `${sinal(v.valor)} ${brlAbs(v.valor)}`.trim(), legenda: `${rotulo} sem resultado (R$ 0,00), por isso a diferença em reais${ocupacoes}`, semDado: false };
    return { valor: `${sinal(v.valor)}${Math.abs(v.valor)}%`, legenda: `resultado comparado a ${rotulo} (${formatBRL(outro.resultado)})${ocupacoes}`, semDado: false };
  };
  const anterior = somarMeses(a.mes, -1);
  const anoAnterior = somarMeses(a.mes, -12);
  return [
    noites,
    diaria,
    comparar(o.anterior, nomeDoMes(anterior), `${nomeDoMes(anterior)} não está no sistema; a comparação começa quando houver`),
    comparar(o.anoAnterior, nomeDoMes(anoAnterior), `${nomeDoMes(anoAnterior)} não está no sistema; a comparação ano a ano começa quando houver`),
  ];
}
