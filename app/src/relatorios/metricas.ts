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

/**
 * Noites ocupadas dentro de [inicio, fim), por imóvel, sem contar duas vezes a mesma noite (reservas sobrepostas no
 * mesmo imóvel — overbooking — contam uma vez) e sem contar noite que o proprietário bloqueou para uso próprio (ela
 * já saiu do denominador da ocupação). A mesma conta de `calcularOcupacao` no painel.
 */
export function noitesOcupadasNoIntervalo(
  reservas: readonly { imovelId: string; checkin: string; checkout: string }[],
  bloqueios: readonly { imovelId: string; inicio: string; fim: string }[],
  inicio: string,
  fim: string,
): number {
  const diasDe = (xs: readonly { imovelId: string; de: string; ate: string }[]) => {
    const porImovel = new Map<string, Set<number>>();
    for (const x of xs) {
      const de = Math.max(dias(x.de), dias(inicio));
      const ate = Math.min(dias(x.ate), dias(fim));
      const noites = porImovel.get(x.imovelId) ?? new Set<number>();
      for (let d = de; d < ate; d++) noites.add(d);
      porImovel.set(x.imovelId, noites);
    }
    return porImovel;
  };
  const ocupadas = diasDe(reservas.map((r) => ({ imovelId: r.imovelId, de: r.checkin, ate: r.checkout })));
  const bloqueadas = diasDe(bloqueios.map((b) => ({ imovelId: b.imovelId, de: b.inicio, ate: b.fim })));
  let total = 0;
  for (const [imovelId, noites] of ocupadas) {
    const bloq = bloqueadas.get(imovelId);
    for (const d of noites) if (!bloq?.has(d)) total++;
  }
  return total;
}

export type Posse = { desde: string | null; ate: string | null };

/**
 * Noites contadas de cada estadia dentro de [inicio, fim): só os trechos dados (a posse do imóvel), fora das noites
 * bloqueadas para uso próprio, e cada noite de cada imóvel uma vez — a noite que duas estadias sobrepostas disputam
 * (overbooking) fica com a que entrou primeiro (check-in; empate, a ordem da lista). Devolve na ordem da lista. A soma é a
 * mesma de `noitesOcupadasNoIntervalo`; por estadia, dá o bruto das noites contadas sem contar a mesma noite duas vezes.
 */
export function noitesContadasPorEstadia(
  estadias: readonly { imovelId: string; checkin: string; trechos: readonly { inicio: string; fim: string }[] }[],
  bloqueios: readonly { imovelId: string; inicio: string; fim: string }[],
  inicio: string,
  fim: string,
): number[] {
  const bloqueadas = new Map<string, Set<number>>();
  for (const b of bloqueios) {
    const noites = bloqueadas.get(b.imovelId) ?? new Set<number>();
    for (let d = Math.max(dias(b.inicio), dias(inicio)); d < Math.min(dias(b.fim), dias(fim)); d++) noites.add(d);
    bloqueadas.set(b.imovelId, noites);
  }
  const tomadas = new Map<string, Set<number>>();
  const resultado = estadias.map(() => 0);
  const ordem = estadias.map((e, i) => [e, i] as const).sort(([a, i], [b, j]) => a.checkin.localeCompare(b.checkin) || i - j);
  for (const [e, i] of ordem) {
    const minhas = tomadas.get(e.imovelId) ?? new Set<number>();
    const bloq = bloqueadas.get(e.imovelId);
    for (const t of e.trechos) {
      for (let d = Math.max(dias(t.inicio), dias(inicio)); d < Math.min(dias(t.fim), dias(fim)); d++) {
        if (bloq?.has(d) || minhas.has(d)) continue;
        minhas.add(d);
        resultado[i]++;
      }
    }
    tomadas.set(e.imovelId, minhas);
  }
  return resultado;
}

/**
 * Os trechos de [inicio, fim) que caem dentro dos intervalos de posse (uma estadia ou um bloqueio que atravessa a troca
 * de dono conta, para cada dono, só os dias em que o imóvel era dele). Posses em sequência, sem sobreposição.
 */
export function trechosNaPosse(inicio: string, fim: string, posses: readonly Posse[]): { inicio: string; fim: string }[] {
  return posses.flatMap((p) => {
    const de = p.desde && p.desde > inicio ? p.desde : inicio;
    const ate = p.ate && p.ate < fim ? p.ate : fim;
    return ate > de ? [{ inicio: de, fim: ate }] : [];
  });
}

/**
 * Intervalos de posse de um imóvel pelos proprietários de um relatório: o histórico de "proprietario.imoveis" (quem
 * ganhou e quem perdeu o imóvel, e quando, em ordem) mais os vínculos atuais. Perda sem ganho registrado = posse desde
 * sempre até a perda; ganho sem perda = posse aberta; vínculo atual sem histórico = posse desde o vínculo; nada
 * registrado = o período inteiro, até o dia em que outro dono foi vinculado (o vínculo antigo é apagado na troca).
 * Um imóvel que sai e volta ao mesmo dono fica com dois intervalos.
 */
export function intervalosDePosse(
  imovelId: string,
  donoIds: readonly string[],
  vinculos: readonly { imovelId: string; proprietarioId: string; dia: string }[],
  historico: readonly { proprietarioId: string; mudancas: unknown; dia: string }[],
): Posse[] {
  const doImovel = vinculos.filter((v) => v.imovelId === imovelId);
  const meus = doImovel.filter((v) => donoIds.includes(v.proprietarioId)).map((v) => v.dia).sort();
  const outros = doImovel.filter((v) => !donoIds.includes(v.proprietarioId)).map((v) => v.dia).sort();
  const intervalos: Posse[] = [];
  let aberto: string | undefined;
  for (const h of historico) {
    if (!donoIds.includes(h.proprietarioId)) continue;
    const m = (h.mudancas as { imoveis?: unknown } | null)?.imoveis;
    if (!Array.isArray(m) || m.length !== 2 || !Array.isArray(m[0]) || !Array.isArray(m[1])) continue;
    const tinha = (m[0] as unknown[]).includes(imovelId);
    const tem = (m[1] as unknown[]).includes(imovelId);
    if (tem && !tinha && aberto === undefined) aberto = h.dia;
    else if (tinha && !tem && (aberto !== undefined || !intervalos.length)) {
      intervalos.push({ desde: aberto ?? null, ate: h.dia });
      aberto = undefined;
    }
  }
  if (aberto !== undefined) intervalos.push({ desde: aberto, ate: null });
  else if (meus.length && !intervalos.some((i) => i.ate === null)) intervalos.push({ desde: meus[0], ate: null });
  if (!intervalos.length) intervalos.push({ desde: null, ate: outros[0] ?? null });
  return intervalos;
}

export type DadosDoMes = {
  mes: MesISO;
  /**
   * Sua parte menos as despesas do imóvel, em centavos; null = mês sem dado no sistema. No mês parcial, só até o dia:
   * a parte de cada reserva proporcional às noites já passadas, mais o que não é reserva e menos as despesas até o dia.
   */
  resultado: number | null;
  /**
   * Bruto das noites ocupadas contadas abaixo, em centavos: o bruto de cada estadia no livro (em vigor; sem lançamento,
   * o valor da reserva) rateado igual por noite (a mesma conta do livro), só das noites contadas — dentro da posse e do
   * período (no mês parcial, até o dia), fora das bloqueadas e sem repetir a noite que duas estadias disputam. Assim a
   * diária média divide bruto e noites do mesmo conjunto. O dinheiro da capa segue o livro, sem recorte.
   */
  bruto: number;
  /**
   * Noites ocupadas dentro do período: estadias confirmadas nos imóveis do relatório, independentemente de em que livro
   * está o dinheiro (cancelada ou pendente não ocupa noite), só as noites dentro da posse do imóvel (`trechosNaPosse`),
   * cada noite de cada imóvel contada uma vez e fora das bloqueadas (`noitesOcupadasNoIntervalo`).
   */
  noitesOcupadas: number;
  /** Reservas confirmadas com ao menos uma noite no período (M5.8: quadro "reservas e estadia média"). */
  reservas: number;
  /** Noites do período considerado por imóvel (mês inteiro; no mês parcial, só até o dia). */
  noitesDoPeriodo: number;
  imoveis: number;
  /**
   * Noites de imóvel que existiam para vender no período: por imóvel, só os dias em que ele era do proprietário
   * (`diasDeImovel`). Igual a `noitesDoPeriodo × imoveis` quando todos eram dele o período inteiro.
   */
  diasImovel: number;
  /** Noites bloqueadas para uso próprio pelo proprietário no período (M5.5). */
  noitesBloqueadas: number;
};

/**
 * Noites de imóvel dentro do período, contando cada imóvel só enquanto era do proprietário: a partir de `desde` (null =
 * desde sempre) e antes de `ate` (null = até hoje; o dono antigo deixa de contar no dia em que o seguinte foi vinculado).
 * Imóvel ligado depois do fim do período, ou cuja posse acabou antes do começo dele, não conta.
 */
export function diasDeImovel(imoveis: readonly { desde: string | null; ate?: string | null }[], inicio: string, fim: string): number {
  return imoveis.reduce((s, i) => {
    const de = Math.max(dias(inicio), i.desde ? dias(i.desde) : dias(inicio));
    const ate = Math.min(dias(fim), i.ate ? dias(i.ate) : dias(fim));
    return s + Math.max(0, ate - de);
  }, 0);
}

export type Ocupacao = { ocupadas: number; disponiveis: number; bloqueadas: number; percentual: number | null };

/** Ocupação = ocupadas ÷ (noites de imóvel no período de posse − bloqueadas). Sem noite disponível: percentual null ("não se aplica"). */
export function ocupacao(d: Pick<DadosDoMes, "noitesOcupadas" | "diasImovel" | "noitesBloqueadas">): Ocupacao {
  const disponiveis = Math.max(0, d.diasImovel - d.noitesBloqueadas);
  return { ocupadas: d.noitesOcupadas, disponiveis, bloqueadas: d.noitesBloqueadas, percentual: disponiveis > 0 ? Math.round((d.noitesOcupadas / disponiveis) * 100) : null };
}

/** Bruto ÷ noites ocupadas (centavos, arredondado); sem noite, null. É o ADR do setor. */
export const diariaMedia = (bruto: number, noites: number): number | null => (noites > 0 ? Math.round(bruto / noites) : null);

/**
 * Receita por noite disponível (RevPAN/RevPAR do setor, M5.8): bruto ÷ noites disponíveis (ocupadas ou não), em
 * centavos; junta ocupação e diária num número só. Sem noite disponível, null.
 */
export const receitaPorNoiteDisponivel = (bruto: number, disponiveis: number): number | null => (disponiveis > 0 ? Math.round(bruto / disponiveis) : null);

/** Estadia média no período: noites ÷ reservas, com uma casa ("2,6"); sem reserva, null. */
export const estadiaMedia = (noites: number, reservas: number): string | null => (reservas > 0 ? (noites / reservas).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : null);

export type Variacao = { tipo: "percentual"; valor: number } | { tipo: "diferenca"; valor: number } | null;

/** Variação do resultado: percentual sobre o anterior; anterior zero → diferença em R$; anterior sem dado → null. */
export function variacao(atual: number, anterior: number | null): Variacao {
  if (anterior === null) return null;
  if (anterior === 0) return { tipo: "diferenca", valor: atual };
  return { tipo: "percentual", valor: Math.round(((atual - anterior) / Math.abs(anterior)) * 100) };
}

export type PontoDaSerie = { mes: MesISO; resultado: number | null; atual: boolean };

/** Ponto do gráfico de ocupação (M5.8): ocupação em % e diária média do mês; null = sem dado (ou sem noite disponível / ocupada). */
/**
 * Um mês do gráfico de ocupação. `semDado`: o mês não está no sistema (hachura, "sem dado no sistema"). Com dado e
 * `ocupacao` null, o mês não teve noite à venda (todo bloqueado para uso próprio ou fora da posse): ocupação não se
 * aplica — nunca confundido com falta de dado.
 */
export type PontoOcupacao = { mes: MesISO; ocupacao: number | null; diaria: number | null; atual: boolean; semDado: boolean };

/** Os 12 meses até `mes` com ocupação (%) e diária média; mês sem dado no sistema → nulls e `semDado`. */
export function serieOcupacaoDe12(meses: ReadonlyMap<MesISO, DadosDoMes | null>, mes: MesISO): PontoOcupacao[] {
  return Array.from({ length: 12 }, (_, i) => somarMeses(mes, i - 11)).map((m) => {
    const d = meses.get(m) ?? null;
    return { mes: m, ocupacao: d ? ocupacao(d).percentual : null, diaria: d ? diariaMedia(d.bruto, d.noitesOcupadas) : null, atual: m === mes, semDado: !d };
  });
}

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
 * Os seis quadros dos "Números do mês" (página 2), em três linhas de dois: noites ocupadas e ocupação; diária média;
 * receita por noite disponível; reservas e estadia média; comparação com o mês anterior; comparação com o mesmo mês
 * do ano anterior. `parcialAte`: dia do mês até onde os números valem (mês corrente). (M5.8: "noites ocupadas" no
 * lugar de "noites", que Diego achou ambíguo; RevPAN e estadia média a pedido dele em 5/10.)
 */
export function quadrosDoMes(o: { atual: DadosDoMes; anterior: DadosDoMes | null; anoAnterior: DadosDoMes | null; parcialAte: number | null }): Quadro[] {
  const a = o.atual;
  const oc = ocupacao(a);
  const ate = o.parcialAte !== null ? ` até ${o.parcialAte}/${Number(a.mes.slice(5, 7))}` : "";
  const noites: Quadro = {
    valor: `${a.noitesOcupadas} ${a.noitesOcupadas === 1 ? "noite ocupada" : "noites ocupadas"}${ate}`,
    legenda:
      oc.percentual === null
        ? `ocupação não se aplica: ${oc.bloqueadas > 0 ? "todas as noites bloqueadas para seu uso" : "nenhuma noite disponível no período"}`
        : `${pct(oc.percentual)} de ocupação: ${oc.ocupadas} de ${oc.disponiveis} noites disponíveis${oc.bloqueadas > 0 ? ` (${oc.bloqueadas} bloqueada${oc.bloqueadas === 1 ? "" : "s"} para seu uso)` : ""}`,
    semDado: false,
  };
  const dm = diariaMedia(a.bruto, a.noitesOcupadas);
  const diaria: Quadro = dm === null ? { valor: "sem reserva no mês", legenda: "diária média: aparece quando houver noite ocupada", semDado: true } : { valor: formatBRL(dm), legenda: "diária média por noite ocupada, com limpeza (bruto ÷ noites ocupadas)", semDado: false };
  const rpn = receitaPorNoiteDisponivel(a.bruto, oc.disponiveis);
  const porNoiteDisponivel: Quadro =
    rpn === null
      ? { valor: "não se aplica", legenda: "receita por noite disponível: sem noite disponível no período", semDado: true }
      : { valor: formatBRL(rpn), legenda: `receita por noite disponível (RevPAN): bruto ÷ ${oc.disponiveis} ${oc.disponiveis === 1 ? "noite disponível" : "noites disponíveis"}, ocupadas ou não — ocupação e diária num número só`, semDado: false };
  const em = estadiaMedia(a.noitesOcupadas, a.reservas);
  const reservas: Quadro =
    em === null
      ? { valor: "nenhuma reserva", legenda: `nenhuma reserva confirmada com noite no ${ate ? "período" : "mês"}`, semDado: true }
      : { valor: `${a.reservas} ${a.reservas === 1 ? "reserva" : "reservas"}${ate}`, legenda: `estadia média de ${em} ${em === "1,0" ? "noite" : "noites"} por reserva no ${ate ? "período" : "mês"} (${a.noitesOcupadas} ${a.noitesOcupadas === 1 ? "noite" : "noites"} ÷ ${a.reservas} ${a.reservas === 1 ? "reserva" : "reservas"})`, semDado: false };
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
    porNoiteDisponivel,
    reservas,
    comparar(o.anterior, nomeDoMes(anterior), `${nomeDoMes(anterior)} não está no sistema; a comparação começa quando houver`),
    comparar(o.anoAnterior, nomeDoMes(anoAnterior), `${nomeDoMes(anoAnterior)} não está no sistema; a comparação ano a ano começa quando houver`),
  ];
}
