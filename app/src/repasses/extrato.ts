/**
 * Extrato do proprietário (M4.10): a parte dele em cada reserva, por mês de competência (o
 * lançamento "direito_proprietario" do motor, M4.2), e a situação de cada parte — uma regra, um
 * lugar: o portal, o painel, o repasse antecipado e o fechamento do mês leem daqui.
 *
 * - **informação**: o canal pagou o proprietário direto (`split`, padrão do Airbnb): não entra em
 *   repasse nenhum.
 * - **a liberar**: a empresa recebe, mas ainda falta algo — quem recebe a confirmar, reserva em
 *   conferência, check-in ainda não aconteceu ou o dinheiro ainda não está registrado com a
 *   empresa (recebimento da reserva, M4.4/M8.2 ou à mão). Cada caso com o motivo escrito.
 * - **disponível**: check-in já passou (entrada ≤ ontem, no fuso do imóvel) e o dinheiro está com a
 *   empresa; entra no próximo repasse e ainda não compôs nenhum.
 * - **repassado**: já saiu num repasse (fechamento ou antecipado) que está em vigor. Se a parte foi
 *   recalculada depois de um fechamento antigo (migração 0049), o repasse incluiu o valor de então
 *   (`repasse.valor`) e a `diferenca` é acertada, ou descontada, pelo fechamento mensal (pelo acerto).
 * - **desconto de cancelamento** (M8.2c): a parte negativa lançada quando uma reserva paga pelo site é cancelada com
 *   devolução integral depois de a parte do proprietário já ter sido repassada (`repasses/descontos.ts`). Fica
 *   disponível na hora e o próximo repasse, de qualquer tipo, a desconta.
 * - **parte anulada pelo cancelamento** (M8.2c): o mês movimentou dinheiro, mas a parte nunca foi paga ao proprietário;
 *   o espelho dela no mês do cancelamento a anula. A parte e o espelho (o "estorno") ficam disponíveis juntos, sem
 *   esperar nada, e entram juntos no próximo repasse, somando zero: nem desconto do que ele não recebeu, nem pagamento
 *   do que voltou ao hóspede.
 * - **em conferência por disputa do pagamento** (M8.2e): a parte ainda não repassada de uma reserva com disputa sem
 *   decisão de quem arca (`contestacaoSemDecisaoSql`) fica a liberar, com o motivo próprio; a já repassada não muda.
 * - **linhas da disputa** (M8.2e, C4, `ehLinhaDeContestacao`): o valor segurado do proprietário (parte negativa, origem
 *   "contestacao_pagamento"), a reversão e o ajuste seguem a parte dele na mesma reserva — esperam junto enquanto alguma
 *   parte não repassada está a liberar; disponíveis quando as partes já foram repassadas ou estão disponíveis. Só o
 *   código da reserva (nunca o nome do hóspede).
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { lerConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import { lerVersoesRegras } from "@/configuracoes/regras-financeiras";
import { contestacoesPagamento, type EstadoLancamento, imoveis, lancamentos, type OrigemReserva, repasseItens, repasses, reservas, type SituacaoRepasse, type TipoRepasse } from "@/db/schema";
import type { Db } from "@/db/types";
import { hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { formatBRL } from "@/lib/money";
import { liberacoesDoSiteComAlvo } from "@/pagamentos/andamento";
import {
  MOTIVO_PARTE_EM_CONFERENCIA,
  MOTIVO_SEGURADO_JUNTO,
  ORIGEM_LANCAMENTO_CONTESTACAO,
  type QuemArcaContestacao,
  ROTULO_DISPUTA_PROPRIETARIO,
  type SituacaoContestacao,
} from "@/pagamentos/contestacao-regras";
import { contestacaoSemDecisaoSql, lancamentoEmConferencia, lancamentoEmVigor } from "@/portal/posse";
import { espelhoAnulaAParte, parteAnuladaPeloEspelho } from "./descontos";
import { dataBr, ladoDoInicio, type PagamentoDaReserva, pagamentoDe, quemRecebeDe } from "./inicio";
import { dinheiroComAEmpresa, type RecebidoDaReserva, recebidoPorReserva } from "./recebimentos";
import { lerInicioDoSistema } from "./regras-config";

export type QuemRecebeParte = "empresa" | "split" | "a_confirmar";
export type SituacaoParte = "informacao" | "a_liberar" | "disponivel" | "repassado";
export const NOMES_SITUACAO_PARTE: Record<SituacaoParte, string> = { informacao: "Paga pelo canal", a_liberar: "A liberar", disponivel: "Disponível", repassado: "Repassada" };

export type RepasseDaParte = {
  id: string;
  tipo: TipoRepasse;
  data: string;
  situacao: SituacaoRepasse;
  dataPagamento: string | null;
  /** O que este repasse incluiu desta parte (o item). Igual ao valor da parte, salvo recálculo depois de fechamento antigo. */
  valor: number;
};

export type ParteBruta = {
  lancamentoId: string;
  proprietarioId: string;
  reservaId: string;
  codigoReserva: string;
  imovelId: string;
  codigoImovel: string;
  /** Mês de competência ("AAAA-MM-01"). */
  competencia: string;
  /** Parte do proprietário neste mês (valor do lançamento). */
  valor: number;
  /** Efeito no acerto: 0 quando o canal paga direto (split) ou quando está pendente. */
  efeitoSaldo: number;
  estado: EstadoLancamento;
  checkin: string;
  checkout: string;
  hospede: string;
  origem: OrigemReserva;
  /** Hoje, no fuso do imóvel. */
  hoje: string;
  recebido: RecebidoDaReserva;
  /** Data em que o canal pagou a reserva (M4.12): pela regra do canal (split) ou pelo recebimento completo (empresa); null = sem data. */
  pagamento: PagamentoDaReserva | null;
  emConferencia: boolean;
  repasse: RepasseDaParte | null;
  /**
   * Reserva paga pelo site (M8.2a): o dinheiro entra quando o Mercado Pago libera. `prevista` = data prevista da
   * liberação (AAAA-MM-DD, São Paulo), null = a confirmar. Ausente = não é reserva paga pelo site.
   */
  liberacaoSite?: { prevista: string | null; daDiferenca?: boolean } | null;
  /** Origem do lançamento da parte ("motor"; "cancelamento" = o espelho da parte no mês do cancelamento, M8.2c). */
  origemLancamento?: string;
  /** A reserva foi cancelada pela política sem devolução (valor retido, M8.2c): dividida como uma reserva normal. */
  canceladaComRetencao?: boolean;
  /**
   * Cancelamento com devolução integral de um mês que movimentou dinheiro sem a parte ter sido paga ao proprietário
   * (M8.2c, `espelhoAnulaAParte`): `anulada` = a parte original; `estorno` = o espelho dela, que a anula. Ausente = não é
   * esse caso (o espelho de uma parte já paga é o desconto).
   */
  anulacao?: "anulada" | "estorno";
  /**
   * M8.2e: a reserva está em conferência por disputa do pagamento (alguma disputa sem decisão de quem arca,
   * `contestacaoSemDecisaoSql`): a parte ainda não repassada fica a liberar. Ausente = não.
   */
  contestacaoSemDecisao?: boolean;
  /** M8.2e: os fatos da disputa de uma linha da disputa (`ehLinhaDeContestacao`); ausente nas outras partes. */
  disputa?: DisputaDaLinha;
  /**
   * M8.2e: numa linha da disputa, alguma outra parte do proprietário na mesma reserva, ainda não repassada, está a liberar:
   * a linha espera junto (`partesDoProprietario` calcula; nunca a parte presa e o valor descontado ao mesmo tempo).
   */
  seguradoJunto?: boolean;
};

/** Variante da linha da disputa para o proprietário (extrato, PDF, e-mail, relatório): segurado até o resultado, definitivo (perdida) ou devolvido. */
export type VarianteDaDisputa = "segurado" | "definitivo" | "devolvido";
export const varianteDaDisputa = (situacao: SituacaoContestacao | null | undefined): VarianteDaDisputa =>
  situacao === "perdida" ? "definitivo" : situacao === "ganha" || situacao === "sem_efeito" ? "devolvido" : "segurado";

/**
 * O que o proprietário pode ver da disputa de uma linha (lista branca: nunca a nota interna, o número do caso, o motivo do
 * Mercado Pago ou dado do hóspede). `causa` é o nome da causa registrada (Configurações → Pagamento no site);
 * `explicacao`, a explicação ao proprietário escrita pela equipe (pode ser vazia).
 */
export type DisputaDaLinha = {
  contestacaoId: string;
  situacao: SituacaoContestacao;
  /** Dia do resultado confirmado (AAAA-MM-DD); null antes dele (e no "sem efeito"). */
  resultadoEm: string | null;
  quemArca: QuemArcaContestacao | null;
  causa: string | null;
  /** O valor em disputa da versão em vigor da decisão e a parte do proprietário nela (centavos). */
  exposicao: number | null;
  parteProprietario: number | null;
  explicacao: string;
  /** Qual linha da disputa é esta, pela chave (`linhaDaChave`); ausente = sem a chave (o texto segue só o sinal do valor). */
  linha?: LinhaDaDisputaDoProprietario;
};

/**
 * Qual linha do proprietário da disputa é esta, pela chave dela (revisão de 11/10): a versão N da decisão (`…:proprietario:vN`,
 * só a diferença para a anterior), com o valor segurado antes e depois dela e se é a versão em vigor (`ultima`); a reversão
 * da ganha (`…:proprietario:reverte`); o ajuste da perdida (`…:proprietario:final`; `comVersoes` = havia valor segurado antes
 * dele); ou o espelho do "Encerrar sem efeito" (`…:sem_efeito:<lançamento>`). Cada linha é descrita pelo valor dela.
 */
export type LinhaDaDisputaDoProprietario =
  | { tipo: "versao"; versao: number; ultima: boolean; antes: number; depois: number }
  | { tipo: "reverte" }
  | { tipo: "final"; comVersoes: boolean }
  | { tipo: "sem_efeito" };

const CHAVE_VERSAO_DO_PROPRIETARIO = /:proprietario:v([1-9]\d*)$/;

/**
 * A linha da disputa pela chave (pura): `versoes` = as linhas de versão do proprietário em vigor da mesma disputa (número
 * e valor com sinal: o débito é negativo). O valor segurado depois da versão N é a soma dos débitos até ela.
 */
export function linhaDaChave(chave: string, versoes: readonly { versao: number; valor: number }[]): LinhaDaDisputaDoProprietario | undefined {
  const m = CHAVE_VERSAO_DO_PROPRIETARIO.exec(chave);
  if (m) {
    const n = Number(m[1]);
    const ate = (k: number) => versoes.filter((v) => v.versao <= k).reduce((t, v) => t - v.valor, 0);
    return { tipo: "versao", versao: n, ultima: !versoes.some((v) => v.versao > n), antes: ate(n - 1), depois: ate(n) };
  }
  if (chave.endsWith(":proprietario:reverte")) return { tipo: "reverte" };
  if (chave.endsWith(":proprietario:final")) return { tipo: "final", comVersoes: versoes.length > 0 };
  if (/:sem_efeito:[^:]+$/.test(chave)) return { tipo: "sem_efeito" };
  return undefined;
}

/** A parte é uma linha da disputa do pagamento (M8.2e): o valor segurado, a reversão ou o ajuste, origem "contestacao_pagamento". */
export const ehLinhaDeContestacao = (p: Pick<ParteBruta, "origemLancamento">) => p.origemLancamento === ORIGEM_LANCAMENTO_CONTESTACAO;

/**
 * O desconto da parte já repassada de uma reserva cancelada com devolução integral (M8.2c): parte negativa, origem
 * "cancelamento", que não é o estorno de uma parte nunca paga (esse só anula a parte e não desconta nada).
 */
export const ehDescontoDeCancelamento = (p: Pick<ParteBruta, "valor" | "origemLancamento" | "anulacao">) => p.valor < 0 && p.origemLancamento === "cancelamento" && p.anulacao !== "estorno";

export type Parte = ParteBruta & {
  quemRecebe: QuemRecebeParte;
  situacao: SituacaoParte;
  motivo: string;
  /** Repassada: valor atual menos o que o repasse incluiu (recálculo depois do repasse). Positiva é acertada, negativa descontada, pelo fechamento mensal. */
  diferenca: number;
};

/**
 * A regra única de disponibilidade (pura). `inicioDoSistema` (M4.11): reserva de antes do início já foi acertada fora
 * dele — enquanto a parte não estiver marcada ("por_fora"), fica a liberar, nunca disponível: nem antecipado nem
 * fechamento a pagam, mesmo que a reserva antiga apareça (importada, recebida) depois da marcação. "De antes" é pela
 * data em que o canal pagou a reserva (M4.12, `ladoDoInicio`), não pelo mês da noite.
 */
export function classificarParte(p: ParteBruta, inicioDoSistema: string | null = null): Parte {
  const quemRecebe: QuemRecebeParte = quemRecebeDe(p);
  const lado = ladoDoInicio(p, inicioDoSistema);
  const com = (situacao: SituacaoParte, motivo: string, diferenca = 0): Parte => ({ ...p, quemRecebe, situacao, motivo, diferenca });
  if (p.repasse) {
    const r = p.repasse;
    const pago = r.situacao === "pago" ? ` (pago${r.dataPagamento ? ` em ${dataBr(r.dataPagamento)}` : ""})` : r.situacao === "a_pagar" ? " (a pagar)" : "";
    // Parte recalculada depois do repasse (só por fechamento antigo, migração 0049): o repasse incluiu o valor de
    // então; a diferença não fica escondida — está no acerto do mês e vai para o próximo fechamento mensal.
    const diferenca = p.valor - r.valor;
    const recalculo = diferenca === 0 ? "" : ` Recalculada depois: o repasse incluiu ${formatBRL(r.valor)}; a diferença de ${formatBRL(Math.abs(diferenca))} ${diferenca > 0 ? "a mais é acertada" : "a menos é descontada"} pelo fechamento mensal.`;
    // M4.11: parte de antes do início do sistema, já acertada fora dele — nunca entra em outro repasse.
    if (r.tipo === "por_fora") return com("repassado", `Acertada por fora, antes do início do sistema (até ${dataBr(r.data)}).${recalculo}`, diferenca);
    if (p.anulacao === "estorno") return com("repassado", `${estornoDe(p)}: anulou a parte ${r.tipo === "fechamento" ? "no fechamento" : "no repasse"} de ${dataBr(r.data)}${pago}.`, diferenca);
    if (ehDescontoDeCancelamento(p)) return com("repassado", `${descontoDe(p)}: descontado ${r.tipo === "fechamento" ? "no fechamento" : "no repasse"} de ${dataBr(r.data)}${pago}.`, diferenca);
    // M8.2e: a linha da disputa saiu (o débito descontado, a reversão devolvida) num repasse.
    if (ehLinhaDeContestacao(p))
      return com("repassado", `${textoDaLinhaDaDisputa(p)} ${p.valor < 0 ? "Descontado" : "Devolvido"} ${r.tipo === "fechamento" ? "no fechamento" : "no repasse"} de ${dataBr(r.data)}${pago}.`, diferenca);
    return com("repassado", `${r.tipo === "fechamento" ? "No fechamento" : "Repasse"} de ${dataBr(r.data)}${pago}.${recalculo}`, diferenca);
  }
  // M8.2c: a parte nunca paga e o espelho que a anula não esperam nada (somam zero; nenhum dinheiro sai): disponíveis
  // juntos, na hora, para o próximo repasse de qualquer tipo levar os dois — nunca um sem o outro.
  if (p.anulacao === "estorno") return com("disponivel", `${estornoDe(p)}: anula a parte no próximo repasse (nada a descontar).`);
  if (p.anulacao === "anulada")
    return com("disponivel", `Reserva ${p.codigoReserva} cancelada com devolução integral ao hóspede antes de esta parte ser repassada: ela e o estorno no mês do cancelamento se anulam no próximo repasse (nada a receber).`);
  // M8.2c: o desconto da parte já repassada nunca espera nada (o dinheiro já saiu para o proprietário e já voltou ao
  // hóspede): disponível na hora, para o próximo repasse de qualquer tipo descontá-lo.
  if (ehDescontoDeCancelamento(p)) return com("disponivel", `${descontoDe(p)}: sai do próximo repasse.`);
  // M8.2e (C4): a linha da disputa segue a parte do proprietário na mesma reserva — espera junto enquanto alguma parte
  // não repassada está a liberar (nada sai de outros repasses); senão, disponível: o próximo repasse de qualquer tipo a leva.
  if (ehLinhaDeContestacao(p)) {
    if (p.seguradoJunto) return com("a_liberar", `${textoDaLinhaDaDisputa(p)} ${maiuscula(MOTIVO_SEGURADO_JUNTO)}.`);
    return com("disponivel", `${textoDaLinhaDaDisputa(p)} ${p.valor < 0 ? "Sai do próximo repasse." : "Volta no próximo repasse."}`);
  }
  if (quemRecebe === "a_confirmar") return com("a_liberar", "Quem recebe o dinheiro desta reserva ainda está a confirmar pela empresa: fica fora de qualquer repasse até definir.");
  if (quemRecebe === "split") {
    const quando = p.pagamento ? ` (${p.pagamento.data <= p.hoje ? "pago" : "previsto"} em ${dataBr(p.pagamento.data)}, ${p.pagamento.prazo === 0 ? "no check-in" : `${p.pagamento.prazo} dia(s) depois do check-in`})` : "";
    if (lado === "antes") return com("informacao", `O canal pagou sua parte direto a você${quando}, antes do início do sistema (${dataBr(inicioDoSistema!)}): já acertada por fora.`);
    return com("informacao", `O canal paga sua parte direto a você${quando}: não entra em repasse.`);
  }
  if (lado === "antes") return com("a_liberar", `Reserva paga antes do início do sistema (${dataBr(inicioDoSistema!)})${p.pagamento ? `, em ${dataBr(p.pagamento.data)}` : ""}: já acertada por fora; aguarda a marcação em Financeiro → Repasses.`);
  if (lado === "indefinido") return com("a_liberar", `Reserva que atravessa o início do sistema (${dataBr(inicioDoSistema!)}) sem data de pagamento: registre o recebimento completo com a data em que o canal pagou — antes do início, a reserva inteira é acertada por fora; a partir dele, entra inteira no sistema.`);
  if (p.emConferencia) return com("a_liberar", "Reserva em conferência: a empresa precisa esclarecer os valores antes do repasse.");
  // M8.2e: disputa do pagamento sem decisão de quem arca — a parte espera a decisão (C2: fora do fechamento, nunca o trava).
  if (p.contestacaoSemDecisao) return com("a_liberar", MOTIVO_PARTE_EM_CONFERENCIA);
  if (p.checkin >= p.hoje && p.canceladaComRetencao)
    return com("a_liberar", `Reserva cancelada sem devolução ao hóspede (política de cancelamento): o valor retido é dividido como uma reserva normal. Libera depois da data de entrada original (${dataBr(p.checkin)}), com o dinheiro já com a empresa.`);
  // Reserva paga pelo site com dinheiro ainda no Mercado Pago (M8.2d, §7): depois de um aumento, toda a parte espera o
  // pagamento da diferença (uma regra de dinheiro por reserva), e o texto diz qual pagamento falta.
  const doSite = p.liberacaoSite && !dinheiroComAEmpresa(p.recebido) ? p.liberacaoSite : null;
  const daDiferenca = doSite?.daDiferenca === true;
  if (p.checkin >= p.hoje) {
    if (doSite)
      return com(
        "a_liberar",
        `Libera depois do check-in (${dataBr(p.checkin)}) e da liberação do pagamento${daDiferenca ? " da diferença" : ""} pelo Mercado Pago (${doSite.prevista ? `prevista para ${dataBr(doSite.prevista)}` : "a confirmar"}).`,
      );
    return com("a_liberar", `Libera depois do check-in (${dataBr(p.checkin)}), com o dinheiro já com a empresa.`);
  }
  if (!dinheiroComAEmpresa(p.recebido)) {
    if (doSite) {
      const quando = doSite.prevista
        ? `o Mercado Pago libera ${daDiferenca ? "o pagamento da diferença " : ""}em ${dataBr(doSite.prevista)}`
        : daDiferenca
          ? "liberação do pagamento da diferença pelo Mercado Pago a confirmar"
          : "liberação do Mercado Pago a confirmar";
      return com("a_liberar", `Reserva paga pelo site: ${quando}; nunca se repassa o que ainda não entrou.`);
    }
    return com(
      "a_liberar",
      p.recebido.recebido <= 0
        ? "A empresa ainda não registrou o recebimento desta reserva: nunca se repassa o que ainda não entrou."
        : `Recebido ${formatBRL(p.recebido.recebido)} de ${formatBRL(p.recebido.devido)}: libera quando o restante entrar.`,
    );
  }
  return com("disponivel", "Disponível para o próximo repasse.");
}

const maiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const porcento = (parte: number, total: number) => `${((parte * 100) / total).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

/**
 * O texto de uma linha da disputa para o proprietário (extrato, portal, PDF): só o código da reserva, o valor, a variante
 * (segurado, definitivo ou devolvido), a causa registrada e a explicação ao proprietário — nunca a nota interna, o número
 * do caso nem o nome do hóspede. Uma regra, um lugar: `classificarParte` e o relatório leem daqui.
 *
 * Revisão de 11/10: cada linha diz o valor dela (`linha`, pela chave). "Mudar quem arca" e "Atualizar o valor segurado"
 * lançam só a diferença numa linha nova: a versão N diz "o valor segurado passa de R$ a para R$ b" e se a diferença é mais
 * segurado ou volta ao proprietário; a versão antiga (não mais em vigor) não leva a causa nem a proporção, que são as da
 * decisão em vigor.
 */
export function textoDaLinhaDaDisputa(p: Pick<ParteBruta, "codigoReserva" | "valor" | "disputa">): string {
  const d = p.disputa;
  const inicio = `${ROTULO_DISPUTA_PROPRIETARIO} da reserva ${p.codigoReserva}`;
  const variante = varianteDaDisputa(d?.situacao);
  const quando = d?.resultadoEm ? ` em ${ddmm(d.resultadoEm)}` : "";
  const valor = Math.abs(p.valor);
  const linha = d?.linha;
  const versao = linha?.tipo === "versao" ? linha : null;
  const seguinte = versao && versao.versao > 1 ? versao : null;
  const antiga = versao !== null && !versao.ultima;
  // A causa e a explicação são as da decisão em vigor: nunca numa versão que já não vale.
  const causa = !antiga && d?.causa ? ` Causa registrada: ${d.causa}.` : "";
  const explicacao = !antiga && d?.explicacao.trim() ? ` ${d.explicacao.trim().replace(/([^.!?])$/, "$1.")}` : "";
  const passa = (v: { antes: number; depois: number }) => `o valor segurado passa de ${formatBRL(v.antes)} para ${formatBRL(v.depois)}`;
  if (variante === "definitivo") {
    const perdeu = `a SCL perdeu a disputa${quando}`;
    if (seguinte) return `${inicio}: com a decisão atualizada antes do resultado, ${passa(seguinte)} (${p.valor < 0 ? `mais ${formatBRL(valor)} descontados` : `${formatBRL(valor)} de volta a você`}); ficou definitivo (${perdeu}).${causa}${explicacao}`;
    if (antiga) return `${inicio}: ${formatBRL(valor)} segurados pela primeira decisão (atualizada depois), em desconto definitivo (${perdeu}).`;
    if (linha?.tipo === "final" && linha.comVersoes && p.valor < 0) return `${inicio}: ajuste do desconto definitivo (${perdeu}; o valor perdido ficou maior que o segurado).${causa}${explicacao}`;
    return p.valor < 0
      ? `${inicio}: desconto definitivo (${perdeu}).${causa}${explicacao}`
      : `${inicio}: ajuste do desconto definitivo (${perdeu}; o valor perdido ficou menor que o segurado).${causa}${explicacao}`;
  }
  if (variante === "devolvido") {
    const porque = d?.situacao === "sem_efeito" ? "a disputa foi encerrada sem efeito" : `a SCL ganhou a disputa${quando}`;
    const de = (v: { antes: number; depois: number }) => `(de ${formatBRL(v.antes)} para ${formatBRL(v.depois)})`;
    if (seguinte)
      return p.valor < 0
        ? `${inicio}: mais ${formatBRL(valor)} segurados com a decisão atualizada ${de(seguinte)}, devolvidos depois (${porque}).`
        : `${inicio}: ${formatBRL(valor)} devolvidos com a decisão atualizada ${de(seguinte)}, antes do resultado (${porque}).`;
    if (linha?.tipo === "sem_efeito" && p.valor < 0) return `${inicio}: ${formatBRL(valor)} que tinham voltado a você com a decisão atualizada saem de novo (${porque}; somadas, as linhas desta disputa dão zero).`;
    return p.valor > 0 ? `${inicio}: valor segurado devolvido (${porque}).` : `${inicio}: ${formatBRL(valor)} segurados, devolvidos depois (${porque}).`;
  }
  const proporcao =
    d?.quemArca === "proprietario"
      ? " — o valor em disputa inteiro, que inclui a comissão e a taxa do pagamento"
      : d?.quemArca === "proporcional" && d.exposicao && d.exposicao > 0 && d.parteProprietario !== null
        ? ` — ${porcento(d.parteProprietario, d.exposicao)} do valor em disputa (${formatBRL(d.exposicao)}), a proporção da sua parte`
        : "";
  const seGanhar = " Se a SCL ganhar a disputa, o valor volta no repasse seguinte.";
  if (seguinte) {
    const emVigor = seguinte.ultima && seguinte.depois > 0 ? proporcao : "";
    const diferenca = p.valor < 0 ? `; mais ${formatBRL(valor)} segurados dos seus próximos repasses até o resultado` : `: ${formatBRL(valor)} voltam a você`;
    const depois = seguinte.ultima ? (seguinte.depois > 0 ? seGanhar : " Nada fica segurado de você.") : "";
    return `${inicio}: com a decisão atualizada, ${passa(seguinte)}${emVigor}${diferenca}.${depois}${causa}${explicacao}`;
  }
  if (antiga) return `${inicio}: ${formatBRL(valor)} segurados dos seus próximos repasses até o resultado, pela primeira decisão (atualizada depois).`;
  if (p.valor > 0) return `${inicio}: ajuste do valor segurado: ${formatBRL(valor)} voltam a você.${causa}${explicacao}`;
  return `${inicio}: ${formatBRL(valor)} segurados dos seus próximos repasses até o resultado${proporcao}.${seGanhar}${causa}${explicacao}`;
}

const descontoDe = (p: Pick<ParteBruta, "codigoReserva">) => `Desconto da sua parte já repassada da reserva ${p.codigoReserva} (cancelada com devolução integral ao hóspede)`;
const estornoDe = (p: Pick<ParteBruta, "codigoReserva">) => `Estorno da sua parte da reserva ${p.codigoReserva} (cancelada com devolução integral ao hóspede antes de a parte ser repassada)`;

/**
 * `ajusteNoFechamento`: soma das diferenças de recálculo das partes repassadas — acertada (ou descontada) pelo fechamento
 * mensal, que pode já ter acontecido. `acertadoPorFora` (M4.11): partes de antes do início do sistema, pagas fora dele —
 * à parte do "já repassado", que é o que o sistema pagou.
 */
export type ResumoPartes = { aLiberar: number; disponivel: number; repassadoAPagar: number; repassadoPago: number; informacao: number; ajusteNoFechamento: number; acertadoPorFora: number };

export function resumirPartes(partes: readonly Parte[]): ResumoPartes {
  const r: ResumoPartes = { aLiberar: 0, disponivel: 0, repassadoAPagar: 0, repassadoPago: 0, informacao: 0, ajusteNoFechamento: 0, acertadoPorFora: 0 };
  for (const p of partes) {
    if (p.situacao === "a_liberar") r.aLiberar += p.valor;
    else if (p.situacao === "disponivel") r.disponivel += p.valor;
    else if (p.situacao === "informacao") r.informacao += p.valor;
    else {
      // Repassado conta o que o repasse incluiu; a diferença do recálculo vai à parte.
      if (p.repasse?.tipo === "por_fora") r.acertadoPorFora += p.valor - p.diferenca;
      else if (p.repasse?.situacao === "pago") r.repassadoPago += p.valor - p.diferenca;
      else r.repassadoAPagar += p.valor - p.diferenca;
      r.ajusteNoFechamento += p.diferenca;
    }
  }
  return r;
}

/**
 * Partes do proprietário em vigor no livro, classificadas. `agora` define "hoje" no fuso de cada
 * imóvel. Em sequência (não Promise.all): roda também dentro de transação, numa conexão só.
 */
export async function partesDoProprietario(db: Db, organizacaoId: string, proprietarioId: string, agora: Date = new Date(), o: { reservaIds?: readonly string[] } = {}): Promise<Parte[]> {
  if (!uuidValido(proprietarioId)) return [];
  const reservaIds = o.reservaIds?.filter(uuidValido);
  if (reservaIds && !reservaIds.length) return [];
  const linhas = await db
    .select({
      lancamentoId: lancamentos.id,
      reservaId: lancamentos.reservaId,
      imovelId: lancamentos.imovelId,
      competencia: lancamentos.competencia,
      valor: lancamentos.valor,
      efeitoSaldo: lancamentos.efeitoSaldo,
      estado: lancamentos.estado,
      emConferencia: sql<boolean>`coalesce(${lancamentoEmConferencia()}, false)`,
      origemLancamento: lancamentos.origem,
      chaveOrigem: lancamentos.chaveOrigem,
      // M8.2e: a reserva em conferência por disputa do pagamento (a regra única, gêmea de `contestacaoSemDecisao`).
      contestacaoSemDecisao: sql<boolean>`coalesce(${contestacaoSemDecisaoSql()}, false)`,
      canceladaComRetencao: sql<boolean>`(${reservas.estado} = 'cancelada' and coalesce(${reservas.valorRetido}, 0) > 0)`,
      // M8.2c: a parte nunca paga e o espelho que a anula (a mesma regra da lista de descontos e do aviso do Início).
      estorno: sql<boolean>`(${lancamentos.origem} = 'cancelamento' and ${lancamentos.valor} < 0 and ${espelhoAnulaAParte()})`,
      anulada: sql<boolean>`(${lancamentos.origem} <> 'cancelamento' and ${parteAnuladaPeloEspelho()})`,
      codigoReserva: reservas.codigo,
      checkin: reservas.checkin,
      checkout: reservas.checkout,
      hospede: reservas.hospedeNome,
      origem: reservas.origem,
      codigoImovel: imoveis.codigo,
      fuso: imoveis.fuso,
    })
    .from(lancamentos)
    .innerJoin(reservas, eq(reservas.id, lancamentos.reservaId))
    .innerJoin(imoveis, eq(imoveis.id, lancamentos.imovelId))
    .where(
      and(
        eq(lancamentos.organizacaoId, organizacaoId),
        eq(lancamentos.tipo, "direito_proprietario"),
        eq(lancamentos.proprietarioId, proprietarioId),
        lancamentoEmVigor(db),
        reservaIds ? inArray(lancamentos.reservaId, reservaIds) : undefined,
      ),
    )
    .orderBy(asc(reservas.checkin), asc(reservas.codigo), asc(lancamentos.competencia));
  if (!linhas.length) return [];
  const itens = await db
    .select({ lancamentoId: repasseItens.lancamentoId, id: repasses.id, tipo: repasses.tipo, data: repasses.data, situacao: repasses.situacao, dataPagamento: repasses.dataPagamento, valor: repasseItens.valor })
    .from(repasseItens)
    .innerJoin(repasses, eq(repasses.id, repasseItens.repasseId))
    .where(and(eq(repasseItens.organizacaoId, organizacaoId), inArray(repasseItens.lancamentoId, linhas.map((l) => l.lancamentoId)), isNull(repasseItens.liberadoEm)));
  const porLancamento = new Map(itens.map((i) => [i.lancamentoId, { id: i.id, tipo: i.tipo, data: i.data, situacao: i.situacao, dataPagamento: i.dataPagamento, valor: i.valor } satisfies RepasseDaParte]));
  const recebidos = await recebidoPorReserva(db, organizacaoId, [...new Set(linhas.map((l) => l.reservaId!))]);
  const doSite = await liberacoesDoSiteComAlvo(db, organizacaoId, [...new Set(linhas.map((l) => l.reservaId!))]);
  const inicioDoSistema = await lerInicioDoSistema(db, organizacaoId);
  const versoes = await lerVersoesRegras(db, organizacaoId);
  const disputas = await disputasDasLinhas(db, organizacaoId, linhas.filter((l) => l.origemLancamento === ORIGEM_LANCAMENTO_CONTESTACAO).map((l) => l.chaveOrigem));
  const brutas = linhas.map(
    (l): ParteBruta => ({
        lancamentoId: l.lancamentoId,
        proprietarioId,
        reservaId: l.reservaId!,
        codigoReserva: l.codigoReserva,
        imovelId: l.imovelId!,
        codigoImovel: l.codigoImovel,
        competencia: l.competencia,
        valor: l.valor,
        efeitoSaldo: l.efeitoSaldo,
        estado: l.estado,
        checkin: l.checkin,
        checkout: l.checkout,
        // M8.2e: nas linhas da disputa, só o código da reserva (nunca o nome do hóspede).
        hospede: l.origemLancamento === ORIGEM_LANCAMENTO_CONTESTACAO ? "" : l.hospede,
        origem: l.origem,
        hoje: hojeISO(l.fuso, agora),
        recebido: recebidos.get(l.reservaId!) ?? { recebido: 0, devido: 0 },
        pagamento: pagamentoDe({ quemRecebe: quemRecebeDe(l), origem: l.origem, checkin: l.checkin }, recebidos.get(l.reservaId!) ?? { recebido: 0, devido: 0 }, versoes),
        emConferencia: l.emConferencia === true,
        repasse: porLancamento.get(l.lancamentoId) ?? null,
        liberacaoSite: doSite.has(l.reservaId!) ? liberacaoDaParte(doSite.get(l.reservaId!)!) : null,
        origemLancamento: l.origemLancamento,
        canceladaComRetencao: l.canceladaComRetencao === true,
        ...(l.estorno === true ? { anulacao: "estorno" as const } : l.anulada === true ? { anulacao: "anulada" as const } : {}),
        ...(l.contestacaoSemDecisao === true ? { contestacaoSemDecisao: true } : {}),
        ...(disputas.has(l.chaveOrigem) ? { disputa: disputas.get(l.chaveOrigem)! } : {}),
      }),
  );
  // Primeiro as partes da reserva; depois as linhas da disputa, que seguem a parte do proprietário na mesma reserva (C4):
  // esperam junto enquanto alguma parte não repassada dela está a liberar.
  const partes = new Map(brutas.filter((p) => !ehLinhaDeContestacao(p)).map((p) => [p.lancamentoId, classificarParte(p, inicioDoSistema)]));
  const aLiberar = new Set([...partes.values()].filter((p) => p.situacao === "a_liberar").map((p) => p.reservaId));
  return brutas.map((p) => partes.get(p.lancamentoId) ?? classificarParte({ ...p, seguradoJunto: aLiberar.has(p.reservaId) }, inicioDoSistema));
}

/**
 * Os fatos da disputa de cada linha da disputa, pela chave (`mercadopago:<pagamento>:contestacao:<contestação>:…`), só o
 * que o proprietário pode ver (`DisputaDaLinha`), com o nome da causa pela configuração em vigor e qual linha é (`linha`,
 * pelas linhas de versão do proprietário em vigor da mesma disputa, lidas do livro: um repasse pode levar só uma delas).
 * Uma regra, um lugar: o extrato, os itens do repasse (painel, portal, e-mail) e o relatório leem daqui.
 */
export async function disputasDasLinhas(db: Db, organizacaoId: string, chaves: readonly string[]): Promise<Map<string, DisputaDaLinha>> {
  const idDe = (chave: string) => chave.split(":")[3] ?? "";
  const ids = [...new Set(chaves.map(idDe).filter(uuidValido))];
  if (!ids.length) return new Map();
  const linhas = await db
    .select({
      id: contestacoesPagamento.id,
      situacao: contestacoesPagamento.situacao,
      resultadoEm: contestacoesPagamento.resultadoEm,
      quemArca: contestacoesPagamento.quemArca,
      causa: contestacoesPagamento.causa,
      exposicao: contestacoesPagamento.exposicao,
      parteProprietario: contestacoesPagamento.parteProprietario,
      explicacao: contestacoesPagamento.explicacaoProprietario,
    })
    .from(contestacoesPagamento)
    .where(and(eq(contestacoesPagamento.organizacaoId, organizacaoId), inArray(contestacoesPagamento.id, ids)));
  if (!linhas.length) return new Map();
  const causas = (await lerConfigPagamentoSite(db, organizacaoId)).causasContestacao;
  // As linhas de versão do proprietário em vigor de cada disputa (a diferença de cada versão; o débito é negativo).
  const doLivro = await db
    .select({ chave: lancamentos.chaveOrigem, valor: lancamentos.valor })
    .from(lancamentos)
    .where(
      and(
        eq(lancamentos.organizacaoId, organizacaoId),
        eq(lancamentos.tipo, "direito_proprietario"),
        eq(lancamentos.origem, ORIGEM_LANCAMENTO_CONTESTACAO),
        inArray(sql<string>`split_part(${lancamentos.chaveOrigem}, ':', 4)`, linhas.map((c) => c.id)),
        sql`${lancamentos.chaveOrigem} ~ ':proprietario:v[1-9][0-9]*$'`,
        lancamentoEmVigor(db),
      ),
    );
  const versoes = new Map<string, { versao: number; valor: number }[]>();
  for (const v of doLivro) {
    const m = CHAVE_VERSAO_DO_PROPRIETARIO.exec(v.chave);
    if (m) versoes.set(idDe(v.chave), [...(versoes.get(idDe(v.chave)) ?? []), { versao: Number(m[1]), valor: v.valor }]);
  }
  const porId = new Map(
    linhas.map((c) => [
      c.id,
      {
        contestacaoId: c.id,
        situacao: c.situacao,
        resultadoEm: c.situacao === "sem_efeito" ? null : c.resultadoEm,
        quemArca: c.quemArca,
        causa: c.causa ? (causas[c.causa]?.nome ?? null) : null,
        exposicao: c.exposicao,
        parteProprietario: c.parteProprietario,
        explicacao: c.explicacao,
      } satisfies DisputaDaLinha,
    ]),
  );
  return new Map(
    chaves
      .filter((k) => porId.has(idDe(k)))
      .map((k) => {
        const linha = linhaDaChave(k, versoes.get(idDe(k)) ?? []);
        return [k, { ...porId.get(idDe(k))!, ...(linha ? { linha } : {}) }] as const;
      }),
  );
}

/** A liberação prevista do site como a parte a leva (o dia em São Paulo; "da diferença" quando só ela falta). */
const liberacaoDaParte = (x: { prevista: Date | null; daDiferenca: boolean }) => ({ prevista: x.prevista ? hojeISO("America/Sao_Paulo", x.prevista) : null, daDiferenca: x.daDiferenca });

/** Só as partes disponíveis (as que um repasse antecipado reúne). */
export async function partesDisponiveis(db: Db, organizacaoId: string, proprietarioId: string, agora: Date = new Date()): Promise<Parte[]> {
  return (await partesDoProprietario(db, organizacaoId, proprietarioId, agora)).filter((p) => p.situacao === "disponivel");
}
