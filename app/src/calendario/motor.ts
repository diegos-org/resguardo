/**
 * Motor de calendário e preços (M3.7). Puro: sem banco e sem rede. Para cada noite do
 * horizonte decide o que o SCL considera oficial — preço de referência, preço a enviar,
 * preço final esperado após a última hora, estadia mínima (ajustada às sobras) e máxima,
 * bloqueio — e compara com a última leitura do Beds24 e com o último envio do SCL.
 *
 * Regras (requisitos/operations/CALENDARIO-PRECOS-OPERACAO.md):
 * - preço explícito de período (cadastro do imóvel) substitui qualquer automatismo;
 * - senão, preço base × o MAIOR multiplicador aplicável (eventos, feriadões), nunca somados;
 * - última hora: percentual por antecedência da noite, com piso por imóvel na diária final;
 *   a referência é sempre recalculada do cadastro — repetir a execução nunca acumula cortes;
 * - mínimo por entrada: o maior entre semana normal, cadastro do imóvel, evento e feriadão
 *   (período explícito com mínimo substitui); evento ou feriadão que já tem reserva confirmada no
 *   período deixa de contar nas noites livres dele, que voltam ao mínimo normal (regra de 6/10; o
 *   preço do evento continua); sobras: mínimo ≤ noites livres seguidas;
 * - bloqueio: só o que o SCL criou vai como "blackout"; o SCL só reabre o que ele mesmo fechou.
 * Nada aqui afirma disponibilidade para venda nem preço final nas OTAs.
 */
import type { EstadoReserva } from "@/db/schema";
import { diaDaSemana, diasEntre, periodoDaNoite, precoDaNoite, somarDias, type Periodo, type RegrasVenda } from "@/imoveis/regras-venda";
import { formatBRL } from "@/lib/money";
import { ocupaInventario } from "@/reservas/regras";
import { type BloqueioEnvio, ehBloqueioEnvio, type FaixaEnvio } from "@/beds24/tipos";
import { centesimosParaMultiplicador, type Evento, type Feriado, type RegrasCalendario } from "./regras-config";
import type { FontePrecos } from "@/imoveis/fonte-precos";

export type ImovelPlano = { id: string; regras: RegrasVenda; periodos: readonly Periodo[]; pisos: readonly [number | null, number | null]; /** Fonte de preços (M3.9): scl, beds24 ou manual. */ fontePrecos: FontePrecos };
export type ObservacaoPlano = { data: string; preco: number | null; minimoNoites: number | null; maximoNoites: number | null; livres: number | null; bloqueio: string | null; observadoEm: Date };
export type EnviadoPlano = { data: string; preco: number | null; minimo: number | null; maximo: number | null; bloqueio: string | null; bloqueioAnterior?: string | null; confirmado: boolean; enviadoEm: Date; envioId?: string | null };
export type OcupacaoPlano = { checkin: string; checkout: string; estado: EstadoReserva };
export type BloqueioPlano = { inicio: string; fim: string; fonte: string };
export type Janela = { nome: string; inicio: string; fim: string };

export type FontePreco = "periodo" | "evento" | "feriado" | "base" | "sem_preco" | "beds24";
export type AcaoNoite = "enviar" | "igual" | "sem_dados";

export type LinhaPlano = {
  data: string;
  antecedencia: number;
  fontePreco: FontePreco;
  motivoPreco: string;
  precoReferencia: number | null;
  faixaUltimaHora: number | null;
  percentualUltimaHora: number;
  piso: number | null;
  precoEnviar: number | null;
  precoFinalEsperado: number | null;
  minimoRegra: number | null;
  motivoMinimo: string;
  /** Noites livres seguidas a partir desta (0 = ocupada; null = livre até o fim dos dados). */
  livresSeguidas: number | null;
  minimoEnviar: number | null;
  maximoEnviar: number;
  reservas: number;
  bloqueioScl: boolean;
  bloqueioEnviar: BloqueioEnvio | undefined;
  /** Restrição que o Beds24 tinha antes do blackout do SCL (noCheckIn etc.), devolvida na reabertura. */
  bloqueioAnterior: string | null;
  /** O blackout que o SCL aplicou sumiu ou foi trocado no Beds24: o SCL deixa de considerá-lo seu. */
  posseBloqueioEncerrada: boolean;
  observacao: ObservacaoPlano | null;
  enviado: EnviadoPlano | null;
  acao: AcaoNoite;
  /** Resumo da regra aplicada, para o histórico. */
  regra: string;
  avisos: string[];
};

export const reduzir = (valor: number, pct: number) => Math.round((valor * (100 - pct)) / 100);
/** Menor preço de referência que, reduzido em `pct`, não fica abaixo do piso. */
export const elevarParaPiso = (piso: number, pct: number) => Math.ceil((piso * 100) / (100 - pct));

/** Janelas de feriadão (noites, inclusive) pelo dia da semana do feriado; janelas vizinhas se unem. */
export function janelasDeFeriado(feriados: readonly Feriado[]): Janela[] {
  const brutas: Janela[] = [];
  for (const f of feriados) {
    const dia = diaDaSemana(f.data);
    const faixa = dia === 4 ? [-1, 3] : dia === 5 ? [-1, 2] : dia === 1 ? [-3, 0] : dia === 2 ? [-4, 0] : null;
    if (!faixa) continue;
    brutas.push({ nome: f.nome || f.data, inicio: somarDias(f.data, faixa[0]), fim: somarDias(f.data, faixa[1]) });
  }
  brutas.sort((a, b) => a.inicio.localeCompare(b.inicio));
  const janelas: Janela[] = [];
  for (const j of brutas) {
    const ultima = janelas.at(-1);
    if (ultima && j.inicio <= somarDias(ultima.fim, 1)) {
      if (j.fim > ultima.fim) ultima.fim = j.fim;
      if (!ultima.nome.includes(j.nome)) ultima.nome = `${ultima.nome} + ${j.nome}`;
    } else janelas.push({ ...j });
  }
  return janelas;
}

/** Feriadões e eventos que valem para o imóvel. Uma regra, um lugar: o motor e a carga das reservas leem daqui. */
export function periodosEspeciais(regras: RegrasCalendario, imovelId: string): { janelas: Janela[]; eventos: Evento[] } {
  const aplica = (todos: boolean, lista: readonly string[]) => todos || lista.includes(imovelId);
  return {
    janelas: aplica(regras.janelaFeriado.todosImoveis, regras.janelaFeriado.imoveis) ? janelasDeFeriado(regras.feriados) : [],
    eventos: regras.eventos.filter((ev) => aplica(ev.todosImoveis, ev.imoveis)),
  };
}

/**
 * Noites cujas reservas o motor precisa ver para a regra de 6/10: o intervalo pedido, estendido até o
 * começo e o fim de cada feriadão ou evento com mínimo (e a regra ligada) que toca o intervalo. Uma
 * reserva confirmada antes de hoje, ou antes da entrada consultada, ainda faz parte do período.
 */
export function intervaloDasReservas(regras: RegrasCalendario, imovelId: string, inicio: string, fim: string): { inicio: string; fim: string } {
  const { janelas, eventos } = periodosEspeciais(regras, imovelId);
  const periodos = [
    ...(regras.janelaFeriado.minimoNormalComReserva ? janelas : []),
    ...eventos.filter((ev) => ev.estadiaMinima !== null && ev.minimoNormalComReserva),
  ].filter((p) => p.inicio <= fim && inicio <= p.fim);
  return {
    inicio: periodos.reduce((m, p) => (p.inicio < m ? p.inicio : m), inicio),
    fim: periodos.reduce((m, p) => (p.fim > m ? p.fim : m), fim),
  };
}

const normalizarBloqueio = (b: string | null | undefined) => (b === null || b === undefined || b === "none" ? "none" : b);
const brl = (c: number) => formatBRL(c);

export type EntradaPlano = {
  imovel: ImovelPlano;
  regras: RegrasCalendario;
  hoje: string;
  /** Primeira e última noite a planejar (inclusive); noites antes de hoje são ignoradas. */
  inicio: string;
  fim: string;
  /** Última noite com dados de ocupação carregados (para medir sobras além do fim). */
  fimDados?: string;
  /** Reservas do imóvel; para a regra de 6/10, também as do período inteiro de cada feriadão/evento (`intervaloDasReservas`). */
  reservas: readonly OcupacaoPlano[];
  bloqueios: readonly BloqueioPlano[];
  observacoes: readonly ObservacaoPlano[];
  enviados: readonly EnviadoPlano[];
};

export function planejarCalendario(e: EntradaPlano): LinhaPlano[] {
  const inicio = e.inicio < e.hoje ? e.hoje : e.inicio;
  if (e.fim < inicio) return [];
  const fimDados = e.fimDados && e.fimDados > e.fim ? e.fimDados : e.fim;
  const { imovel, regras } = e;
  const { janelas, eventos } = periodosEspeciais(regras, imovel.id);
  // Regra de 6/10: só reserva confirmada no período conta (consulta, pedido do site e pendente não bastam).
  const temReservaConfirmada = (de: string, ate: string) => e.reservas.some((r) => r.estado === "confirmada" && r.checkin <= ate && de < r.checkout);
  const observadas = new Map(e.observacoes.map((o) => [o.data, o]));
  const enviadas = new Map(e.enviados.map((o) => [o.data, o]));
  const maximo = imovel.regras.estadiaMaxima ?? regras.estadiaMaxima;

  // Ocupação dia a dia até o fim dos dados; sobras contadas de trás para a frente.
  const totalDias = diasEntre(inicio, fimDados) + 1;
  const reservasNaNoite = (d: string) => e.reservas.filter((r) => ocupaInventario(r.estado) && r.checkin <= d && d < r.checkout).length;
  const bloqueioSclNaNoite = (d: string) => e.bloqueios.some((b) => b.fonte !== "beds24" && b.inicio <= d && d < b.fim);
  const bloqueioExternoNaNoite = (d: string) => e.bloqueios.some((b) => b.fonte === "beds24" && b.inicio <= d && d < b.fim);
  const livres: (number | null)[] = Array.from({ length: totalDias });
  let seguidas: number | null = null; // null = livre até o fim dos dados carregados
  for (let n = totalDias - 1; n >= 0; n--) {
    const d = somarDias(inicio, n);
    const ocupada = reservasNaNoite(d) > 0 || bloqueioSclNaNoite(d) || bloqueioExternoNaNoite(d);
    seguidas = ocupada ? 0 : seguidas === null ? null : seguidas + 1;
    livres[n] = seguidas;
  }

  const linhas: LinhaPlano[] = [];
  for (let n = 0; n <= diasEntre(inicio, e.fim); n++) {
    const data = somarDias(inicio, n);
    const antecedencia = diasEntre(e.hoje, data);
    const avisos: string[] = [];
    const periodo = periodoDaNoite(imovel.periodos, data);
    // Preço de referência: período explícito > maior multiplicador > base. Com fonte "manual" (M3.9) vale o
    // cadastro como está — sem multiplicadores e sem os limites mínimo/máximo do preço dinâmico, que também são
    // um ajuste automático; com fonte "beds24" o SCL só lê (tratado mais abaixo).
    const fonte = imovel.fontePrecos;
    const base = precoDaNoite(fonte === "manual" ? { ...imovel.regras, precoDinamico: false } : imovel.regras, imovel.periodos, data);
    let fontePreco: FontePreco = base.fonte;
    let motivoPreco = base.fonte === "periodo" ? `Período ${base.periodo}` : base.fonte === "base" ? "Preço base" : "Sem preço cadastrado";
    let precoReferencia = base.valor;
    if (fonte === "manual" && base.valor !== null) motivoPreco += " (preços digitados: sem eventos, feriadões, última hora nem limites do preço dinâmico)";
    if (fonte === "scl" && base.valor !== null && base.fonte === "base") {
      const candidatos = [
        ...eventos.filter((ev) => ev.inicio <= data && data <= ev.fim).map((ev) => ({ nome: `Evento ${ev.nome}`, fonte: "evento" as const, mult: ev.multiplicador })),
        ...janelas.filter((j) => j.inicio <= data && data <= j.fim).map((j) => ({ nome: `Feriadão ${j.nome}`, fonte: "feriado" as const, mult: regras.janelaFeriado.multiplicador })),
      ].filter((c) => c.mult > 100);
      const maior = candidatos.reduce<(typeof candidatos)[number] | null>((m, c) => (!m || c.mult > m.mult ? c : m), null);
      if (maior) {
        precoReferencia = Math.round((base.valor * maior.mult) / 100);
        fontePreco = maior.fonte;
        motivoPreco = `${maior.nome} (${centesimosParaMultiplicador(maior.mult)}× a base)`;
        if (candidatos.length > 1) motivoPreco += "; multiplicadores não somam, vale o maior";
      } else if (base.ajustado) motivoPreco = "Preço base (limitado ao piso/teto)";
    }
    // Fonte "beds24": o preço é o lido do Beds24 (proprietário ou ferramenta dele); o SCL nunca envia preço.
    // Sem leitura, a noite fica sem preço (o site não vende) — nunca um palpite do cadastro.
    const lidoDoBeds24 = fonte === "beds24" ? (observadas.get(data)?.preco ?? null) : null;
    if (fonte === "beds24") {
      fontePreco = "beds24";
      precoReferencia = null;
      motivoPreco = lidoDoBeds24 !== null ? "Preço definido no Beds24 (o SCL só lê)" : "Preço definido no Beds24, ainda sem leitura";
      if (lidoDoBeds24 === null) avisos.push("Sem preço lido do Beds24 para esta noite: fica indisponível para venda no site até a próxima leitura. O SCL não envia preço para este imóvel.");
    } else if (precoReferencia === null) avisos.push("Preço não cadastrado no SCL: nenhum preço será enviado para esta noite.");
    else if (precoReferencia <= 0) avisos.push("Preço zero: conferir antes de qualquer envio.");

    // Última hora: percentual pela antecedência da noite; piso por imóvel na diária final. Só com preços do SCL.
    const uh = regras.ultimaHora;
    const faixa = fonte !== "scl" || uh.aplicadoPor === "desligada" ? -1 : uh.faixas.findIndex((f) => f.deDias <= antecedencia && antecedencia <= f.ateDias);
    const pct = faixa >= 0 ? uh.faixas[faixa].percentual : 0;
    const piso = faixa >= 0 ? imovel.pisos[faixa] : null;
    let precoEnviar = precoReferencia;
    let precoFinalEsperado = fonte === "beds24" ? lidoDoBeds24 : precoReferencia;
    let motivoUltimaHora = "";
    if (precoReferencia !== null && pct > 0) {
      const reduzido = reduzir(precoReferencia, pct);
      if (uh.aplicadoPor === "beds24") {
        if (piso === null) {
          precoFinalEsperado = reduzido;
          motivoUltimaHora = `Beds24 aplica ${pct}% sem piso cadastrado`;
          avisos.push(`Piso da ${faixa + 1}ª faixa de última hora não cadastrado: o desconto nativo de ${pct}% pode ficar abaixo do desejado.`);
        } else if (reduzido < piso) {
          precoEnviar = Math.max(precoReferencia, elevarParaPiso(piso, pct));
          precoFinalEsperado = reduzir(precoEnviar, pct);
          motivoUltimaHora = `Beds24 aplica ${pct}%; referência elevada para proteger o piso de ${brl(piso)}`;
        } else {
          precoFinalEsperado = reduzido;
          motivoUltimaHora = `Beds24 aplica ${pct}% (piso ${brl(piso)} respeitado)`;
        }
      } else if (piso === null) {
        motivoUltimaHora = `Última hora ${pct}% não aplicada: piso não cadastrado`;
        avisos.push(`Piso da ${faixa + 1}ª faixa de última hora não cadastrado: a redução de ${pct}% não foi aplicada.`);
      } else {
        precoEnviar = Math.max(piso, reduzido);
        precoFinalEsperado = precoEnviar;
        motivoUltimaHora = precoEnviar === piso && reduzido < piso ? `SCL aplica ${pct}% limitado ao piso de ${brl(piso)}` : `SCL aplica ${pct}%`;
      }
    }

    // Mínimo por entrada e sobras.
    const dia = diaDaSemana(data);
    let minimoRegra: number | null;
    let motivoMinimo: string;
    if (periodo?.estadiaMinima != null) {
      minimoRegra = periodo.estadiaMinima;
      motivoMinimo = `Período ${periodo.nome}`;
    } else {
      // Regra de 6/10, decidida noite a noite: se um evento ou feriadão desta noite (com a regra ligada) já tem
      // reserva confirmada no seu período, todos os mínimos especiais com a regra ligada saem desta noite — um
      // feriadão dentro do Réveillon não segura 3 noites onde o Réveillon já cedeu. Os de regra desligada
      // (temporadas longas) continuam.
      const especiais = [
        ...eventos.filter((ev) => ev.estadiaMinima !== null && ev.inicio <= data && data <= ev.fim)
          .map((ev) => ({ v: ev.estadiaMinima!, nome: `Evento ${ev.nome}`, ligada: ev.minimoNormalComReserva, inicio: ev.inicio, fim: ev.fim })),
        ...janelas.filter((j) => j.inicio <= data && data <= j.fim)
          .map((j) => ({ v: regras.janelaFeriado.estadiaMinima, nome: `Feriadão ${j.nome}`, ligada: regras.janelaFeriado.minimoNormalComReserva, inicio: j.inicio, fim: j.fim })),
      ];
      const comReserva = especiais.filter((c) => c.ligada && temReservaConfirmada(c.inicio, c.fim)).map((c) => c.nome);
      const cedem = comReserva.length > 0;
      const candidatos: { v: number; nome: string }[] = [
        { v: regras.minimoPorDia[dia], nome: "Semana normal" },
        ...(imovel.regras.estadiaMinima !== null ? [{ v: imovel.regras.estadiaMinima, nome: "Cadastro do imóvel" }] : []),
        ...especiais.filter((c) => !(cedem && c.ligada)),
      ];
      const maior = candidatos.reduce((m, c) => (c.v > m.v ? c : m));
      minimoRegra = maior.v;
      motivoMinimo = maior.nome;
      if (cedem && especiais.some((c) => c.ligada && c.v > maior.v)) motivoMinimo += `; ${comReserva.join(" e ")} já tem reserva confirmada: noites livres com o mínimo normal`;
    }
    const livresSeguidas = livres[n] ?? null;
    let minimoEnviar = minimoRegra;
    if (minimoRegra !== null && livresSeguidas !== null && livresSeguidas > 0 && livresSeguidas < minimoRegra) {
      minimoEnviar = livresSeguidas;
      motivoMinimo += `; sobra de ${livresSeguidas} noite(s) até a próxima reserva/bloqueio`;
    }
    // Mínimo acima do máximo é impossível de cumprir (e o Beds24 pode recusar): envia o máximo como mínimo e avisa.
    if (minimoEnviar !== null && minimoEnviar > maximo) {
      avisos.push(`Mínimo (${minimoEnviar}) acima do máximo (${maximo}): enviado mínimo igual ao máximo; conferir o cadastro.`);
      minimoEnviar = maximo;
    }

    // Ocupação, bloqueio e observação externa.
    const reservas = reservasNaNoite(data);
    const bloqueioScl = bloqueioSclNaNoite(data);
    const observacao = observadas.get(data) ?? null;
    const enviado = enviadas.get(data) ?? null;
    // Bloqueio do SCL: fecha ("blackout") e, ao ser removido, devolve a noite ao que havia antes — a
    // restrição que já existia no Beds24 (noCheckIn etc.) ou "none". Reabrir só quando a leitura atual
    // ainda mostra o blackout que o SCL aplicou: uma restrição posta no Beds24 depois ou a falta de
    // leitura nunca é apagada.
    let bloqueioEnviar: BloqueioEnvio | undefined;
    let bloqueioAnterior: string | null = null;
    let posseBloqueioEncerrada = false;
    const leituraAposEnvio = observacao !== null && (enviado === null || observacao.observadoEm.getTime() >= enviado.enviadoEm.getTime());
    if (bloqueioScl) {
      bloqueioEnviar = "blackout";
      // O que havia antes: a restrição da leitura mais nova que o último envio (senão a do último envio
      // confirmado). Se o que se vê é um blackout (o do SCL, ou uma tentativa ainda em aberto), ou não há
      // leitura nova de uma tentativa em aberto, vale o que o SCL guardou ao fechar. Leitura "none" zera:
      // a restrição antiga já não existe, e não deve voltar num ciclo novo de bloqueio.
      const atual = normalizarBloqueio(leituraAposEnvio ? observacao!.bloqueio : enviado?.confirmado ? enviado.bloqueio : null);
      if (ehBloqueioEnvio(atual) && atual !== "none" && atual !== "blackout") bloqueioAnterior = atual;
      else if (atual === "blackout" || (!leituraAposEnvio && enviado !== null && !enviado.confirmado)) bloqueioAnterior = enviado?.bloqueioAnterior ?? null;
      else bloqueioAnterior = null;
    } else if (enviado?.bloqueio === "blackout") {
      const atual = leituraAposEnvio ? observacao!.bloqueio : undefined;
      if (atual === "blackout") bloqueioEnviar = ehBloqueioEnvio(enviado.bloqueioAnterior) && enviado.bloqueioAnterior !== "blackout" ? enviado.bloqueioAnterior : "none";
      else if (atual === undefined) avisos.push("Bloqueio do SCL removido, mas sem leitura recente do Beds24: a reabertura espera a próxima leitura.");
      else {
        // Leitura mais nova mostra que o blackout do SCL já não está lá: a posse acaba aqui, e um
        // blackout futuro nessa noite é tratado como externo (nunca reaberto pelo SCL).
        posseBloqueioEncerrada = true;
        if (normalizarBloqueio(atual) === "none") avisos.push("Bloqueio do SCL removido e já reaberto no Beds24: nada a enviar; o SCL deixa de considerar esse bloqueio como seu.");
        else if (atual === enviado.bloqueioAnterior) avisos.push(`Bloqueio do SCL removido e a restrição anterior ("${atual}") já está de volta no Beds24: nada a enviar.`);
        else avisos.push(`Bloqueio do SCL removido, mas o Beds24 tem a restrição "${atual}" nesta noite: não é apagada, e o SCL deixa de considerar o bloqueio como seu; confira no Beds24.`);
      }
    }
    if (reservas > 1) avisos.push("Mais de uma reserva ocupa esta noite.");
    if (reservas > 0 && bloqueioScl) avisos.push("Reserva e bloqueio se sobrepõem nesta noite.");
    if (!observacao) avisos.push("Sem leitura do Beds24 para esta noite.");
    else {
      if ((reservas > 0 || bloqueioScl) && observacao.livres !== null && observacao.livres > 0) avisos.push("Beds24 informou unidades livres, mas há reserva ou bloqueio no SCL: conferir.");
      // Overbooking (M8.3c, desenho 4.4): o Beds24 informa unidades negativas quando há mais reservas que unidades. Vale com
      // ou sem reserva no SCL (a do SCL pode ser uma das que se sobrepõem): é o aviso de "0 unidades" levado ao negativo.
      if (observacao.livres !== null && observacao.livres < 0) avisos.push("Beds24 informa unidades negativas (overbooking): há mais reservas que unidades nesta noite; resolva no Beds24 com o hóspede ou com o canal.");
      if (observacao.bloqueio === "blackout" && !bloqueioScl && enviado?.bloqueio !== "blackout") avisos.push("Beds24 tem bloqueio (blackout) sem bloqueio no SCL: o SCL não reabre o que não fechou; confira.");
      else if (observacao.livres === 0 && reservas === 0 && !bloqueioScl && !bloqueioExternoNaNoite(data) && observacao.bloqueio !== "blackout") avisos.push("Beds24 informa 0 unidades sem reserva ou bloqueio no SCL: confira a importação antes de vender.");
    }

    // Comparação: observação mais recente que o último envio vale; senão vale o envio confirmado.
    const observacaoValida = observacao && (!enviado || observacao.observadoEm.getTime() >= enviado.enviadoEm.getTime()) ? observacao : null;
    // Campo que não vai (preço ou mínimo ausentes) não entra na comparação: senão a noite ficaria "enviar" para sempre.
    const igualObs = observacaoValida !== null && (precoEnviar === null || observacaoValida.preco === precoEnviar) && (minimoEnviar === null || observacaoValida.minimoNoites === minimoEnviar) && observacaoValida.maximoNoites === maximo
      && (bloqueioEnviar === undefined || normalizarBloqueio(observacaoValida.bloqueio) === bloqueioEnviar);
    const igualEnviado = enviado !== null && enviado.confirmado && (precoEnviar === null || enviado.preco === precoEnviar) && (minimoEnviar === null || enviado.minimo === minimoEnviar) && enviado.maximo === maximo
      && (bloqueioEnviar === undefined || normalizarBloqueio(enviado.bloqueio) === bloqueioEnviar);
    const nadaAEnviar = precoEnviar === null && minimoEnviar === null && bloqueioEnviar === undefined;
    const acao: AcaoNoite = nadaAEnviar ? "sem_dados" : igualObs || (observacaoValida === null && igualEnviado) ? "igual" : "enviar";
    if (acao === "enviar" && observacaoValida && igualEnviado) avisos.push("Beds24 difere do último envio confirmado pelo SCL: o SCL reenvia o valor oficial.");

    const textoBloqueio = bloqueioEnviar === "blackout" ? (bloqueioAnterior ? `bloqueio do SCL (antes: "${bloqueioAnterior}")` : "bloqueio do SCL")
      : bloqueioEnviar === "none" ? "reabre bloqueio do SCL" : bloqueioEnviar ? `reabre bloqueio do SCL e devolve "${bloqueioEnviar}"` : "";
    const regra = [motivoPreco, motivoUltimaHora, `mín. ${minimoEnviar ?? "—"} (${motivoMinimo})`, `máx. ${maximo}`, textoBloqueio].filter(Boolean).join(" · ");
    linhas.push({
      data, antecedencia, fontePreco, motivoPreco, precoReferencia, faixaUltimaHora: faixa >= 0 ? faixa : null, percentualUltimaHora: pct, piso,
      precoEnviar, precoFinalEsperado, minimoRegra, motivoMinimo, livresSeguidas, minimoEnviar, maximoEnviar: maximo,
      reservas, bloqueioScl, bloqueioEnviar, bloqueioAnterior, posseBloqueioEncerrada, observacao, enviado, acao, regra, avisos,
    });
  }
  return linhas;
}

type Carga = { preco?: number; minimo?: number; maximo?: number; bloqueio?: BloqueioEnvio };
const cargaDe = (l: LinhaPlano): Carga => ({
  ...(l.precoEnviar !== null ? { preco: l.precoEnviar } : {}),
  ...(l.minimoEnviar !== null ? { minimo: l.minimoEnviar } : {}),
  maximo: l.maximoEnviar,
  ...(l.bloqueioEnviar !== undefined ? { bloqueio: l.bloqueioEnviar } : {}),
});
const mesmaCarga = (a: Carga, b: Carga) => a.preco === b.preco && a.minimo === b.minimo && a.maximo === b.maximo && a.bloqueio === b.bloqueio;

/** Noites a enviar agrupadas em faixas consecutivas com os mesmos valores (payload menor, mesma semântica). */
export function faixasDeEnvio(linhas: readonly LinhaPlano[]): FaixaEnvio[] {
  const faixas: FaixaEnvio[] = [];
  for (const l of linhas) {
    if (l.acao !== "enviar") continue;
    const carga = cargaDe(l);
    const ultima = faixas.at(-1);
    if (ultima && somarDias(ultima.to, 1) === l.data && mesmaCarga(ultima, carga)) ultima.to = l.data;
    else faixas.push({ from: l.data, to: l.data, ...carga });
  }
  return faixas;
}

export type ResumoPlano = { noites: number; enviar: number; iguais: number; semDados: number; ocupadas: number; comAvisos: number };
export function resumirPlano(linhas: readonly LinhaPlano[]): ResumoPlano {
  return {
    noites: linhas.length,
    enviar: linhas.filter((l) => l.acao === "enviar").length,
    iguais: linhas.filter((l) => l.acao === "igual").length,
    semDados: linhas.filter((l) => l.acao === "sem_dados").length,
    ocupadas: linhas.filter((l) => l.reservas > 0 || l.bloqueioScl).length,
    comAvisos: linhas.filter((l) => l.avisos.length > 0).length,
  };
}
