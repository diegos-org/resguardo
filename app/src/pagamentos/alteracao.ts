/**
 * Alteração de reserva paga pelo site (M8.2d; desenho §5.4): datas, número de pessoas ou valor, só antes da entrada e só
 * pela equipe, no painel. A prévia e o "segurar" partem da mesma montagem (`montarAlteracao`); o "Aplicar" de uma alteração
 * segurada confere o retrato gravado e o dinheiro de agora (`montarAplicacao`, nunca cota de novo). O coração é
 * `aplicarNaTransacao`, chamado por "segurar e aplicar", "Aplicar" e pela aprovação da diferença (`confirmacao.ts`).
 *
 * - **Aumento**: as novas noites ficam seguradas por uma reserva-pedido (fonte "alteracao") pelo prazo próprio
 *   (`minutosHoldAlteracao`) e o hóspede paga a diferença na página da reserva; a aprovação aplica (num savepoint), mesmo
 *   depois do prazo se as noites ainda estiverem livres e nada mais mudou; senão o pagamento fica sem reserva e vai para
 *   "Devolver ao hóspede".
 * - **Redução**: a diferença segue a política aceita no pagamento que confirmou a reserva, como um cancelamento naquele
 *   momento, contando da entrada que conta (`entradaQueConta`); integral = devolvida (depois de aplicar), nenhum = retida.
 * - **Mesmo valor**: só as datas (ou as pessoas) mudam.
 *
 * Três fases, como o cancelamento: releitura dos pagamentos sem trava (fase 0); travas (cotação → motor da reserva), o
 * vencimento preguiçoso, a montagem sob as travas, a assinatura da prévia e as escritas (fase 1); os pedidos de devolução
 * ao Mercado Pago fora da transação (fase 2). Nenhuma nota guarda dado pessoal; a auditoria com valores mora na entidade
 * `alteracao`, e as observações da reserva só levam datas e pessoas.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { lerRegrasCalendario } from "@/calendario/regras-config";
import { versoesLegaisAtuais } from "@/configuracoes/paginas-legais";
import { type DecisaoPolitica, decidirPelaPolitica, entradaQueConta, regrasComPadrao } from "@/configuracoes/politica-cancelamento";
import { contratoVigente } from "@/contratos/regras";
import { travaOcupada, violouUnicidade } from "@/db/erros";
import {
  alteracoesReserva,
  type BaseCancelamento,
  CANAIS_PEDIDO_ALTERACAO,
  type CanalPedidoAlteracao,
  type ComponentesDaAlteracao,
  type CotacaoDaAlteracao,
  devolucoesPagamento,
  imoveis,
  MOTIVOS_CANCELAMENTO_EMPRESA,
  MOTIVOS_EXCECAO,
  MOTIVOS_VALOR_ALTERACAO,
  type MotivoCancelamentoEmpresa,
  type MotivoExcecao,
  type MotivoValorAlteracao,
  type OrigemValorAlteracao,
  pagamentos,
  QUEM_PEDE_ALTERACAO,
  type QuemPedeAlteracao,
  type ResultadoDaAlteracao,
  reservas,
  type SituacaoDevolucao,
  type SituacaoPagamento,
} from "@/db/schema";
import type { Db } from "@/db/types";
import { dadosDoMotor } from "@/financeiro/aplicar";
import { calcularReserva, type PendenciaDoCalculo } from "@/financeiro/motor";
import { travarMotorDaReserva } from "@/financeiro/trava";
import { ERRO_DADOS_PESSOAIS, textoSemDadosPessoais } from "@/lib/dados-pessoais";
import { hojeISO, instanteLocal } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { formatBRL } from "@/lib/money";
import { acordoVigente, lerHorariosReservas } from "@/reservas/horarios";
import { dataValida, noites } from "@/reservas/regras";
import { avisoDoPagamento, cancelarPortador, dadosDoSite, FONTE_ALTERACAO, type Reserva, sincronizarReserva } from "@/reservas/repositorio";
import { politicaDoPagamento } from "@/site/aceites";
import { CONFLITO_AGENDA_EXTERNA, consultarDisponibilidade, noitesLivres } from "@/site/disponibilidade";
import { lancamentosDoMotor } from "./acerto-cancelamento";
import { expirarSeVencida } from "./alteracao-prazo";
import { dividirDevolucao, noitesNovas, type Rumo, rumoDa, situacaoEfetiva, valorNovo } from "./alteracao-regras";
import { inicioDoPrazoDePedirDevolucao, inicioDoPrazoDeReleitura } from "./andamento";
import { sincronizarAvisosDoPagamento } from "./avisos-devolucao";
import { diaBr, diaHoraBr, type EscolhaDaEquipe, escolhaDaEquipe, momentosDaEntrada, NOMES_BASE_CANCELAMENTO, NOMES_MOTIVO_EMPRESA, releituraDosPagamentos, TEXTO_OCUPADO } from "./cancelamento";
import { cancelarNoProvedor } from "./conferencia";
import type { Decisao } from "./confirmacao";
import { tentarDevolucao } from "./devolucao";
import { FUSO_PAGAMENTO, taxaDaReserva } from "./liberacao";
import { pendenciaDoMotor, podeCobrar } from "./oferta";
import type { Cobranca, ProvedorPagamento } from "./provedor";
import { emAndamento, NOMES_SITUACAO_PAGAMENTO } from "./situacoes";
import {
  type Alteracao,
  alteracaoAtiva,
  carenciaNoTravado,
  chaveEmVoo,
  cotacaoDaAlteracao,
  type Devolucao,
  devolucaoInexplicada,
  devolucoesDoPagamento,
  devolvidoPeloSistema,
  integralIntocada,
  lerCotacaoSemTravar,
  type Pagamento,
  pagamentosDaReserva,
  saldoPrincipal,
  type Travado,
  travarCotacao,
  valorPagoAprovado,
} from "./travas";

export { expirarAlteracoesVencidas, expirarSeVencida } from "./alteracao-prazo";

// ---------------------------------------------------------------- tipos

export type ValorDaAlteracao =
  | { origem: "cotacao" }
  | { origem: "mantido"; motivo: MotivoValorAlteracao; nota: string }
  | { origem: "digitado"; valor: number; motivo: MotivoValorAlteracao; nota: string };

export type EntradaAlteracao = {
  checkin: string;
  checkout: string;
  hospedes: number;
  valor: ValorDaAlteracao;
  quemPede: QuemPedeAlteracao;
  /** Obrigatório quando a SCL propõe. */
  motivoEmpresa: MotivoCancelamentoEmpresa | null;
  /** Quando a SCL recebeu o pedido do hóspede (ou, quando ela propõe, agora). */
  recebidoEm: Date;
  /** Obrigatório quando o hóspede pede. */
  canal: CanalPedidoAlteracao | null;
  /** Onde está o pedido (0..300, sem dado pessoal). */
  nota: string;
  /** Só na redução (como no M8.2c): "politica" | "excecao" | "integral"/"nenhum" (sem política). */
  decisao: "politica" | "excecao" | "integral" | "nenhum";
  motivoExcecao: MotivoExcecao | null;
  motivoDecisao: string;
};

export type CodigoRecusaAlteracao =
  | "nao_encontrada"
  | "nao_paga_pelo_site"
  | "nao_confirmada"
  | "estadia_iniciada"
  | "em_andamento"
  | "contestado"
  | "devolvido_fora"
  | "devolucao_em_andamento"
  | "ha_cancelamento"
  | "ha_alteracao"
  | "sem_mudanca"
  | "sem_efeito"
  | "duas_pontas"
  | "indisponivel"
  | "sem_leitura"
  | "a_confirmar"
  | "sem_calculo"
  | "financeiro_movimentado"
  | "em_conferencia"
  | "sem_cobranca"
  | "sem_saldo"
  | "dados"
  | "decisao_obrigatoria"
  | "integral_nao_se_nega"
  | "previa_mudou"
  | "reserva_mudou"
  | "noites_ocupadas"
  | "nao_segurada"
  | "ocupado";

/** Uma recusa. `escolha`: o que a equipe pode escolher na redução onde a política não decide (exceção ou sem política). */
export type RecusaAlteracao = { ok: false; codigo: CodigoRecusaAlteracao; erro: string; escolha?: EscolhaDaEquipe | null; conflito?: string | null };
const recusa = (codigo: CodigoRecusaAlteracao, erro: string): RecusaAlteracao => ({ ok: false, codigo, erro });

/** Como sai a devolução de cada pagamento numa redução: pedida ao Mercado Pago, ou pelo painel dele / por fora (mais de 78 dias). */
export type ParteDaDevolucao = {
  pagamentoId: string;
  forma: "pix" | "cartao";
  valor: number;
  taxa: number | null;
  rota: "pedida" | "fora_do_prazo";
  /** D13: a devolução espera o Mercado Pago liberar este pagamento (e informar a taxa) antes de ser pedida. */
  aguardaLiberacao: boolean;
  liberacaoPrevista: Date | null;
  /** O pagamento: o que confirmou a reserva, ou a diferença de uma alteração anterior (e quando foi feito). */
  pagoEm: Date;
};

export type Componentes = ComponentesDaAlteracao;
type PoliticaDaReserva = { versao: number; data: string; diasReembolsoIntegral: number; arrependimentoAteEntrada: boolean } | null;

export type PreviaAlteracao = {
  /** A alteração (só na prévia do "Aplicar" de uma segurada). */
  alteracaoId: string | null;
  reservaId: string;
  reservaCodigo: string;
  antes: { checkin: string; checkout: string; hospedes: number | null; valor: number };
  depois: { checkin: string; checkout: string; hospedes: number; valor: number };
  cotacao: CotacaoDaAlteracao;
  origemValor: OrigemValorAlteracao;
  motivoValor: MotivoValorAlteracao | null;
  /** valor depois − valor de agora (com sinal). */
  diferenca: number;
  rumo: Rumo;
  /** O dinheiro que a reserva guarda depois (o valor bruto do motor; `valorNovo`). */
  valorNovo: number;
  quemPede: QuemPedeAlteracao;
  noitesNovas: { inicio: string; fim: string } | null;
  holdMinutos: number;
  /** Até quando as datas estão seguradas (só na prévia do "Aplicar"). */
  holdAte: Date | null;
  /** D1: a entrada que chega primeiro (a de antes ou a nova): o prazo das datas seguradas nunca passa dela. */
  limiteDoPrazo?: Date | null;
  entradaDaPolitica: string;
  decisao: DecisaoPolitica | null;
  direito: "integral" | "nenhum" | null;
  base: BaseCancelamento | null;
  escolha: EscolhaDaEquipe | null;
  valorADevolver: number;
  politica: PoliticaDaReserva;
  partes: ParteDaDevolucao[];
  financeiro: {
    antes: Componentes;
    depois: Componentes;
    porMes: { mes: string; antes: Componentes; depois: Componentes }[];
    /** A taxa do Mercado Pago atribuída à parte devolvida (sai da reserva); null fora da redução com devolução ou com a taxa desconhecida. */
    taxaDevolvida: number | null;
    taxaDesconhecida: boolean;
  };
  leitura: { pagamentoId: string; em: Date | null; situacao: SituacaoPagamento; devolvidoLido: number }[];
  avisos: string[];
  assinatura: string;
  /** O texto do BotaoConfirmar. */
  pergunta: string;
};

// ---------------------------------------------------------------- textos

export const TEXTO_PREVIA_MUDOU_ALTERACAO = "O cálculo mudou desde a prévia (reserva, pagamento, leitura do Mercado Pago, preços ou agenda): calcule de novo antes de seguir.";
export const TEXTO_NAO_CONFIRMADA = "Só uma reserva confirmada pelo site pode ser alterada por aqui.";
export const TEXTO_NAO_PAGA = "Esta reserva não foi paga pelo site: a alteração por aqui é só para reservas pagas pelo site.";
export const TEXTO_CONTESTADO_ALTERACAO = "Pagamento contestado no Mercado Pago: a alteração espera a contestação (M8.2e).";
export const TEXTO_DEVOLVIDO_FORA =
  "O Mercado Pago mostra parte deste pagamento devolvida fora do sistema ou uma situação que o sistema não reconhece: confira no painel do Mercado Pago e use Conferir agora antes de alterar.";
export const TEXTO_DEVOLUCAO_EM_ANDAMENTO = "Há uma devolução desta reserva esperando o Mercado Pago: espere ela se resolver (use Conferir agora) antes de alterar de novo.";
export const TEXTO_HA_CANCELAMENTO = "Há um pedido de cancelamento desta reserva: decida ou descarte o pedido antes de alterar.";
export const TEXTO_SEM_MUDANCA = "As datas, o número de pessoas e o valor são os mesmos de agora: não há o que alterar.";
export const TEXTO_SEM_EFEITO = "Pela política, a diferença não é devolvida e nada muda; para dar o desconto, use a exceção.";
export const TEXTO_DUAS_PONTAS = "A alteração acrescenta noites antes e depois da estadia ao mesmo tempo: faça em duas alterações (primeiro um lado, depois o outro).";
export const TEXTO_A_CONFIRMAR =
  "O valor das novas datas fica a confirmar (preço sem leitura atual, estadia longa ou capacidade não cadastrada): mantenha o valor atual ou digite o valor, com o motivo.";
export const TEXTO_SEM_LEITURA_ALTERACAO = "Não conferimos a agenda mais recente das novas noites (leitura do Beds24 velha): atualize a leitura e calcule de novo.";
export const TEXTO_FINANCEIRO_MOVIMENTADO = "Esta reserva já movimentou dinheiro (parte num repasse ou lançamento realizado): a alteração pelo sistema não é feita; registre um ajuste.";
export const TEXTO_EM_CONFERENCIA = "Esta reserva está em conferência: resolva a conferência antes de alterar.";
export const TEXTO_RESERVA_MUDOU = "A reserva mudou depois que as datas foram seguradas: desista desta alteração e prepare outra.";
export const TEXTO_MOMENTO_ALTERACAO = "Informe quando o pedido chegou (não pode ser no futuro nem antes do pagamento).";
export const TEXTO_SEM_POLITICA_ALTERACAO =
  "Este pagamento foi feito sem o aceite das páginas legais (antes de 9/10): o sistema não calcula a devolução da diferença. Escolha o que fazer e escreva o motivo.";
export const TEXTO_INTEGRAL_DA_DIFERENCA = "Pela política aceita, o hóspede tem direito à devolução da diferença: a equipe não decide outra coisa.";
export const TEXTO_EMPRESA_DEVOLVE_DIFERENCA = "Quando a SCL propõe a alteração, a diferença é devolvida ao hóspede (com ou sem a política aceita): a equipe não decide outra coisa.";
export const TEXTO_EM_ANDAMENTO_DIFERENCA = "Há um pagamento da diferença em andamento: espere ele terminar.";
export const TEXTO_SO_REDUCAO = "A alteração com diferença a pagar vale quando o hóspede paga a diferença na página da reserva: só segure as datas.";

/** A estadia já começou: o texto do D1, com a entrada. */
export const textoEstadiaIniciada = (entradaEm: Date, fuso = FUSO_PAGAMENTO) =>
  `A estadia já começou (entrada em ${diaHoraBr(entradaEm, fuso)}): a alteração pelo sistema vale só antes da entrada. Para mais noites, faça uma nova reserva (no painel, com o pagamento registrado, ou pelo site quando a estadia mínima permitir). A saída antecipada não tem devolução pela política e a reserva fica como está: as noites seguem ocupadas e a limpeza de saída fica na data original.`;
const textoHaAlteracao = (holdAte: Date | null, fuso: string, agora: Date) =>
  `Já há uma alteração com as datas seguradas${holdAte ? ` até ${prazoBr(holdAte, agora, fuso)}` : ""}: aplique, espere o pagamento da diferença ou desista dela antes de preparar outra.`;

/** Por que o motor não fecharia o cálculo nas novas datas (o motivo do `sem_calculo`). */
const PENDENCIAS: Record<PendenciaDoCalculo, string> = {
  sem_valor: "sem valor da estadia",
  sem_contrato: "sem contrato de gestão vigente na nova entrada",
  marketplace: "imóvel do marketplace",
  sem_proprietario: "imóvel sem proprietário cadastrado",
  varios_proprietarios: "imóvel com mais de um proprietário",
  recebimento_nao_empresa: "quem recebe as reservas do site neste imóvel não é a empresa",
  calculo_pendente: "o financeiro ficaria com acerto pendente",
};

export const NOMES_ORIGEM_VALOR: Record<OrigemValorAlteracao, string> = { cotacao: "cotação do site", mantido: "valor atual mantido", digitado: "valor digitado" };
export const NOMES_MOTIVO_VALOR: Record<MotivoValorAlteracao, string> = {
  alteracao_pela_scl: "A SCL propôs a alteração",
  cortesia_comercial: "Cortesia comercial",
  erro_da_scl: "Erro da SCL",
  acordo_com_hospede: "Acordo com o hóspede",
  preco_a_confirmar: "Preço a confirmar",
  outro: "Outro",
};

const LIMITE_NOTA = 300;
/** Folga do relógio para o momento do pedido informado à mão (o formulário manda só a hora e o minuto). */
const FOLGA_MOMENTO_MS = 59_000;
const VALOR_MAXIMO = 1_000_000_000;
const ZERO: Componentes = { bruto: 0, taxa: 0, comissao: 0, parte: 0 };

const fmt = (d: Date, fuso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, ...o }).format(d);
const horaBr = (d: Date, fuso = FUSO_PAGAMENTO) => fmt(d, fuso, { hour: "2-digit", minute: "2-digit" });
/** Um prazo: "HH:MM" quando acaba hoje (no fuso), senão "dd/mm às HH:MM" (o prazo das datas vai até 48 horas). */
export const prazoBr = (d: Date, agora: Date, fuso = FUSO_PAGAMENTO) =>
  hojeISO(fuso, d) === hojeISO(fuso, agora) ? horaBr(d, fuso) : `${fmt(d, fuso, { day: "2-digit", month: "2-digit" })} às ${horaBr(d, fuso)}`;
/** O prazo das datas seguradas de uma alteração nova: o tempo da configuração, nunca depois do limite (D1, a entrada). */
const prazoDasDatas = (agora: Date, minutos: number, limite: Date | null | undefined) => {
  const ate = new Date(agora.getTime() + minutos * 60_000);
  return limite && limite.getTime() < ate.getTime() ? limite : ate;
};
/** "dd/mm" de uma data AAAA-MM-DD. */
const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const minuto = (d: Date) => Math.floor(d.getTime() / 60_000);
const pessoas = (n: number | null) => (n === null ? "pessoas não informadas" : `${n} ${n === 1 ? "pessoa" : "pessoas"}`);
const nNoites = (n: number) => `${n} ${n === 1 ? "noite" : "noites"}`;
/** "dd/mm–dd/mm (N noites, P pessoas)". */
export const estadiaEmTexto = (e: { checkin: string; checkout: string; hospedes: number | null }) => `${dataBr(e.checkin)}–${dataBr(e.checkout)} (${nNoites(noites(e.checkin, e.checkout))}, ${pessoas(e.hospedes)})`;
const mesmasDatas = (a: { checkin: string; checkout: string }, b: { checkin: string; checkout: string }) => a.checkin === b.checkin && a.checkout === b.checkout;

// ---------------------------------------------------------------- localização e releitura (fase 0)

/** A reserva, o pagamento que a confirmou e todos os pagamentos com o dinheiro dela: uma leitura, sem trava. */
async function localizar(db: Db, organizacaoId: string, reservaId: string) {
  if (!uuidValido(reservaId)) return null;
  const [r] = await db.select({ id: reservas.id, estado: reservas.estado }).from(reservas).where(and(eq(reservas.id, reservaId), eq(reservas.organizacaoId, organizacaoId)));
  if (!r) return null;
  const ps = await db
    .select({ id: pagamentos.id, cotacaoId: pagamentos.cotacaoId, idProvedor: pagamentos.idProvedor, criadoEm: pagamentos.criadoEm, desfecho: pagamentos.desfecho })
    .from(pagamentos)
    .where(and(eq(pagamentos.reservaId, r.id), eq(pagamentos.organizacaoId, organizacaoId), inArray(pagamentos.desfecho, ["reserva", "alteracao"])));
  return { reserva: r, p0: ps.find((x) => x.desfecho === "reserva") ?? null, pagamentos: ps };
}

// ---------------------------------------------------------------- conferências comuns (§5.4.1, regras 1 a 7)

type Contexto = {
  t: Travado;
  r: Reserva;
  p0: Pagamento;
  daReserva: Pagamento[];
  fuso: string;
  horaEntrada: string;
  cadastrado: boolean;
  entradaEm: Date;
  /** Uma tentativa sem resposta há mais de 85 dias (só aviso). */
  andandoAntiga: boolean;
};

/**
 * A reserva confirmada pelo site, o pagamento que a confirmou, sem cancelamento nem outra alteração segurada, sem
 * pagamento em andamento, com o dinheiro de cada pagamento explicado (sem contestação, devolução de fora do sistema,
 * devolução em voo ou à espera da liberação) e antes da entrada (D1). `aplicando`: a alteração segurada que está sendo
 * aplicada (não conta como "outra").
 */
async function conferirReserva(db: Db, organizacaoId: string, t: Travado, agora: Date, o: { aplicando?: Alteracao } = {}): Promise<{ ok: true; c: Contexto } | RecusaAlteracao> {
  const r = t.reserva;
  const fuso = t.imovel.fuso || FUSO_PAGAMENTO;
  // 1. A reserva confirmada pelo site.
  if (r.estado !== "confirmada" || r.fonte !== "site") return recusa("nao_confirmada", TEXTO_NAO_CONFIRMADA);
  // 2. O pagamento que a confirmou (a política é a dele).
  const p0 = t.tentativas.find((x) => x.desfecho === "reserva");
  if (!p0) return recusa("nao_paga_pelo_site", TEXTO_NAO_PAGA);
  // 5. Um cancelamento ativo (pedido ou decidido).
  if (t.cancelamento) return recusa("ha_cancelamento", TEXTO_HA_CANCELAMENTO);
  // 6. Outra alteração com as datas seguradas (pela situação que vale agora).
  const ativa = alteracaoAtiva(t, agora, carenciaNoTravado(t, agora));
  if (ativa && ativa.id !== o.aplicando?.id) return recusa("ha_alteracao", textoHaAlteracao(ativa.holdAte, fuso, agora));
  // 3. Uma tentativa sem resposta dentro do prazo de leitura: espera. Fora dele, só o aviso da prévia.
  const inicioLeitura = inicioDoPrazoDeReleitura(agora).getTime();
  const andando = t.tentativas.find((x) => emAndamento(x.situacao) && x.criadoEm.getTime() >= inicioLeitura && x.alteracaoId !== (o.aplicando?.id ?? "-"));
  if (andando) return recusa("em_andamento", avisoDoPagamento({ id: andando.id, forma: andando.forma, situacao: andando.situacao, pixExpiraEm: andando.pixExpiraEm, desfecho: andando.desfecho }, fuso, "alterar"));
  const andandoAntiga = t.tentativas.some((x) => emAndamento(x.situacao) && x.criadoEm.getTime() < inicioLeitura);
  // 4. O dinheiro de cada pagamento da reserva, pela leitura gravada, e as devoluções dele.
  const daReserva = pagamentosDaReserva(t);
  for (const p of daReserva) {
    if (p.situacao === "contestado") return recusa("contestado", TEXTO_CONTESTADO_ALTERACAO);
    const devs = devolucoesDoPagamento(t, p.id);
    // O devolvido por inteiro pelas nossas devoluções (quitado, sem saldo) não é devolução de fora do sistema.
    const situacaoConhecida = p.situacao === "aprovado" || p.situacao === "devolvido_parcial" || devolvidoPeloSistema(p, devs);
    if (devolucaoInexplicada(p, devs) || p.avisos.includes("situacao_desconhecida") || !situacaoConhecida) return recusa("devolvido_fora", TEXTO_DEVOLVIDO_FORA);
    if (devs.some((d) => chaveEmVoo(d) && d.ultimoCodigo !== "aguardando_liberacao")) return recusa("devolucao_em_andamento", TEXTO_DEVOLUCAO_EM_ANDAMENTO);
    if (devs.some((d) => d.avisos.includes("devolucao_a_menor") && !devs.some((y) => y.origemDevolucaoId === d.id))) return recusa("devolucao_em_andamento", TEXTO_DEVOLUCAO_EM_ANDAMENTO);
    const esperando = devs.find((d) => d.situacao === "pedida" && d.ultimoCodigo === "aguardando_liberacao");
    if (esperando)
      return recusa(
        "devolucao_em_andamento",
        `A devolução de ${formatBRL(esperando.valor)} espera o Mercado Pago liberar o pagamento${p.liberacaoPrevistaEm ? ` (previsto para ${diaBr(p.liberacaoPrevistaEm)})` : ""}: depois disso a reserva pode ser alterada de novo.`,
      );
    if (devs.some(chaveEmVoo)) return recusa("devolucao_em_andamento", TEXTO_DEVOLUCAO_EM_ANDAMENTO);
    // Pedida e ainda não enviada (a fase 2 não chegou ao Mercado Pago, ou sem provedor): a rotina e o "Conferir agora" a
    // pedem; outra redução esbarraria nela (uma pedida por pagamento).
    if (devs.some((d) => d.situacao === "pedida")) return recusa("devolucao_em_andamento", TEXTO_DEVOLUCAO_EM_ANDAMENTO);
  }
  // 7. D1: só antes do instante da entrada atual.
  const entrada = await momentosDaEntrada(db, organizacaoId, { imovelId: t.imovel.id, checkin: r.checkin, fuso });
  if (agora.getTime() >= entrada.entradaEm.getTime()) return recusa("estadia_iniciada", textoEstadiaIniciada(entrada.entradaEm, fuso));
  return { ok: true, c: { t, r, p0, daReserva, fuso, horaEntrada: entrada.horaEntrada, cadastrado: entrada.cadastrado, entradaEm: entrada.entradaEm, andandoAntiga } };
}

/** Regra 12: nada do motor da reserva movimentou dinheiro (sob D1 nunca acontece; é a guarda). */
async function conferirMotor(db: Db, organizacaoId: string, r: Reserva, travar: boolean): Promise<RecusaAlteracao | null> {
  const motor = await lancamentosDoMotor(db, organizacaoId, r.id, { travar });
  if (motor.ativos.some((a) => a.estado === "realizado" || a.estado === "conciliado") || motor.pagos.size || motor.aPagar.length) return recusa("financeiro_movimentado", TEXTO_FINANCEIRO_MOVIMENTADO);
  if (r.divergenciaEm && !r.conferenciaResolvidaEm) return recusa("em_conferencia", TEXTO_EM_CONFERENCIA);
  return null;
}

/** D1 em todo caminho que aplica: a menor das duas entradas ainda no futuro, a nova entrada hoje ou depois e nenhum mês passado. */
async function conferirDatasNoFuturo(db: Db, organizacaoId: string, t: Travado, a: Pick<Alteracao, "checkinAntes" | "checkinDepois" | "checkoutDepois">, agora: Date): Promise<RecusaAlteracao | null> {
  const fuso = t.imovel.fuso || FUSO_PAGAMENTO;
  const primeira = a.checkinDepois < a.checkinAntes ? a.checkinDepois : a.checkinAntes;
  const entrada = await momentosDaEntrada(db, organizacaoId, { imovelId: t.imovel.id, checkin: primeira, fuso });
  const hoje = hojeISO(fuso, agora);
  if (agora.getTime() >= entrada.entradaEm.getTime() || a.checkinDepois < hoje || a.checkinDepois.slice(0, 7) < hoje.slice(0, 7)) return recusa("estadia_iniciada", textoEstadiaIniciada(entrada.entradaEm, fuso));
  return null;
}

// ---------------------------------------------------------------- a redução pela política (D7)

type Decidida = { decisao: DecisaoPolitica; direito: "integral" | "nenhum"; base: BaseCancelamento; escolha: EscolhaDaEquipe | null; politica: PoliticaDaReserva };

/**
 * A decisão da redução: a política aceita no pagamento que confirmou a reserva, contando da entrada que conta, como um
 * cancelamento naquele momento, sobre a diferença. A equipe só escolhe onde a política não decide (a exceção, com motivo
 * da lista e nota; sem política, devolver ou não, com motivo). A SCL propondo, sempre devolve. Integral nunca se nega.
 */
async function decidirReducao(
  db: Db,
  organizacaoId: string,
  c: Contexto,
  d: { diferenca: number; recebidoEm: Date; quemPede: QuemPedeAlteracao; decisao: EntradaAlteracao["decisao"]; motivoExcecao: MotivoExcecao | null; motivoDecisao: string },
): Promise<{ ok: true; x: Decidida } | RecusaAlteracao> {
  const politica = await politicaDoPagamento(db, organizacaoId, c.p0.id);
  const regras = politica ? regrasComPadrao(politica.regras) : null;
  const entradaPolitica = {
    regras: politica?.regras ?? null,
    checkin: entradaQueConta(c.t.cotacao.checkin, c.r.checkin),
    entradaAtual: c.r.checkin,
    horaEntrada: c.horaEntrada,
    fuso: c.fuso,
    aprovadoEm: c.p0.aprovadoEm ?? c.p0.criadoEm,
    pedidoRecebidoEm: d.recebidoEm,
    valorBase: -d.diferenca,
  };
  const empresa = d.quemPede === "empresa";
  const calculada = decidirPelaPolitica({ ...entradaPolitica, quemCancela: empresa ? "empresa" : "hospede" });
  const decisao: DecisaoPolitica = empresa && calculada.calculado === "sem_politica" ? { ...calculada, calculado: "integral", base: "empresa", valorADevolver: -d.diferenca } : calculada;
  const escolha = escolhaDaEquipe(decisao.calculado);
  const decidida = (codigo: CodigoRecusaAlteracao, erro: string): RecusaAlteracao => ({ ...recusa(codigo, erro), escolha });
  let direito: "integral" | "nenhum";
  let base: BaseCancelamento;
  if (decisao.calculado === "sem_politica") {
    if ((d.decisao !== "integral" && d.decisao !== "nenhum") || !d.motivoDecisao) return decidida("decisao_obrigatoria", TEXTO_SEM_POLITICA_ALTERACAO);
    direito = d.decisao;
    base = "sem_politica";
  } else if (decisao.calculado === "nenhum") {
    if (d.decisao === "excecao") {
      if (!d.motivoExcecao || !d.motivoDecisao) return decidida("dados", "Na exceção, escolha o motivo da lista e escreva a nota (obrigatória, sem dados pessoais).");
      direito = "integral";
      base = "excecao";
    } else if (d.decisao === "politica" || d.decisao === "nenhum") {
      direito = "nenhum";
      base = decisao.base;
    } else return decidida("dados", "Pela política aceita a diferença não é devolvida: para devolver, escolha a exceção, com o motivo.");
  } else {
    if (d.decisao !== "politica") return decidida("integral_nao_se_nega", politica ? TEXTO_INTEGRAL_DA_DIFERENCA : TEXTO_EMPRESA_DEVOLVE_DIFERENCA);
    direito = "integral";
    base = decisao.base;
  }
  return {
    ok: true,
    x: { decisao, direito, base, escolha, politica: politica && regras ? { versao: politica.versao, data: politica.data, diasReembolsoIntegral: regras.diasReembolsoIntegral, arrependimentoAteEntrada: regras.arrependimentoAteEntrada } : null },
  };
}

/** As partes da devolução de uma redução integral: entre os pagamentos da reserva, cada um até o principal que ainda dá para devolver dele. */
function partesDaDevolucao(t: Travado, daReserva: readonly Pagamento[], valor: number, agora: Date): ParteDaDevolucao[] | null {
  if (valor <= 0) return [];
  const inicioPedido = inicioDoPrazoDePedirDevolucao(agora).getTime();
  const divididas = dividirDevolucao(
    valor,
    daReserva.map((p) => ({
      id: p.id,
      criadoEm: p.criadoEm,
      saldoPrincipal: saldoPrincipal(p, devolucoesDoPagamento(t, p.id)),
      podeSairAgora: p.criadoEm.getTime() >= inicioPedido && !!p.liberacaoConfirmadaEm && p.taxa !== null,
    })),
  );
  if (!divididas) return null;
  return divididas.map((x) => {
    const p = daReserva.find((y) => y.id === x.pagamentoId)!;
    const devs = devolucoesDoPagamento(t, p.id);
    const intocada = integralIntocada(p, { id: "nova", valor: x.valor }, devs);
    return {
      pagamentoId: p.id,
      forma: p.forma,
      valor: x.valor,
      taxa: p.taxa,
      rota: p.criadoEm.getTime() < inicioPedido ? "fora_do_prazo" : "pedida",
      aguardaLiberacao: !intocada && (!p.liberacaoConfirmadaEm || p.taxa === null),
      liberacaoPrevista: p.liberacaoPrevistaEm,
      pagoEm: p.aprovadoEm ?? p.criadoEm,
    };
  });
}

// ---------------------------------------------------------------- o financeiro da prévia (regra 17)

type Linha = { tipo: string; competencia: string; valor: number };
/** Os lançamentos do motor por mês e componente (a taxa com o sinal do livro: negativa). */
function porMes(linhas: readonly Linha[]): Map<string, Componentes> {
  const m = new Map<string, Componentes>();
  for (const l of linhas) {
    const mes = l.competencia.slice(0, 7);
    const x = m.get(mes) ?? { ...ZERO };
    if (l.tipo === "receita_bruta") x.bruto += l.valor;
    else if (l.tipo === "taxa_canal") x.taxa += l.valor;
    else if (l.tipo === "comissao") x.comissao += l.valor;
    else if (l.tipo === "direito_proprietario") x.parte += l.valor;
    else continue;
    m.set(mes, x);
  }
  return m;
}
const somar = (xs: Iterable<Componentes>): Componentes => {
  const t = { ...ZERO };
  for (const x of xs) {
    t.bruto += x.bruto;
    t.taxa += x.taxa;
    t.comissao += x.comissao;
    t.parte += x.parte;
  }
  return t;
};
function compararMeses(antes: Map<string, Componentes>, depois: Map<string, Componentes>) {
  const meses = [...new Set([...antes.keys(), ...depois.keys()])].sort();
  return meses.map((mes) => ({ mes, antes: antes.get(mes) ?? { ...ZERO }, depois: depois.get(mes) ?? { ...ZERO } }));
}

/** O cálculo puro do motor da reserva com outros dados (as datas, o valor e a taxa de depois), nos contratos da entrada. */
async function calculoDoMotor(db: Db, organizacaoId: string, r: Reserva, x: { checkin: string; checkout: string; valorBruto: number | null; taxaCanal: number | null }) {
  const d = await dadosDoMotor(db, organizacaoId, r.imovelId, x.checkin);
  const { lancamentos } = calcularReserva({ id: r.id, codigo: r.codigo, imovelId: r.imovelId, origem: r.origem, estado: "confirmada", checkin: x.checkin, checkout: x.checkout, valorBruto: x.valorBruto, taxaCanal: x.taxaCanal, recebimento: r.recebimento }, d.contratos, d.donos, d.regras, d.recebimentoDoImovel);
  return { linhas: porMes(lancamentos), contrato: contratoVigente(d.contratos, x.checkin) };
}

// ---------------------------------------------------------------- a montagem (prévia e "segurar")

/** O que a montagem precisa guardar para gravar a alteração (além da prévia). */
type Montada = {
  c: Contexto;
  e: EntradaAlteracao;
  previa: PreviaAlteracao;
  recebidoEm: Date;
  canal: CanalPedidoAlteracao | null;
  nota: string;
  motivoValorNota: string;
  motivoDecisao: string;
  motivoExcecao: MotivoExcecao | null;
  motivoEmpresa: MotivoCancelamentoEmpresa | null;
};

/** Notas curtas sem dado pessoal; null = ok. */
function problemaDasNotas(notas: string[]): string | null {
  for (const n of notas) {
    if (n.length > LIMITE_NOTA) return `Cada nota tem até ${LIMITE_NOTA} caracteres.`;
    if (textoSemDadosPessoais(n) === null) return ERRO_DADOS_PESSOAIS;
  }
  return null;
}

/**
 * A alteração, com todas as conferências (§5.4.1), sobre o retrato da cotação (travado no "segurar"; lido sem trava na
 * prévia). Uma função para a prévia e o "segurar": as duas nunca discordam, e a assinatura da prévia é conferida sob as
 * travas.
 */
async function montarAlteracao(db: Db, organizacaoId: string, t: Travado, e: EntradaAlteracao, agora: Date, extras: { travar: boolean; provedor: ProvedorPagamento | null }): Promise<{ ok: true; m: Montada } | RecusaAlteracao> {
  const conferida = await conferirReserva(db, organizacaoId, t, agora);
  if (!conferida.ok) return conferida;
  const { c } = conferida;
  const { r, fuso } = c;
  // 15 e 16 (dados de entrada, antes do resto): listas fechadas, notas sem dado pessoal, o momento do pedido.
  const nota = (e.nota ?? "").trim();
  const motivoDecisao = (e.motivoDecisao ?? "").trim();
  const motivoValorNota = e.valor.origem === "cotacao" ? "" : (e.valor.nota ?? "").trim();
  const problema = problemaDasNotas([nota, motivoDecisao, motivoValorNota]);
  if (problema) return recusa("dados", problema);
  if (!(QUEM_PEDE_ALTERACAO as readonly string[]).includes(e.quemPede)) return recusa("dados", "Escolha quem pede a alteração.");
  if (!["politica", "excecao", "integral", "nenhum"].includes(e.decisao)) return recusa("dados", "Escolha a decisão.");
  if (e.motivoExcecao !== null && !(MOTIVOS_EXCECAO as readonly string[]).includes(e.motivoExcecao)) return recusa("dados", "Escolha o motivo da exceção.");
  let canal: CanalPedidoAlteracao | null = null;
  let motivoEmpresa: MotivoCancelamentoEmpresa | null = null;
  if (e.quemPede === "hospede") {
    if (!e.canal || !(CANAIS_PEDIDO_ALTERACAO as readonly string[]).includes(e.canal)) return recusa("dados", "Informe como o pedido chegou (WhatsApp, e-mail, telefone, pessoalmente ou outro).");
    canal = e.canal;
  } else {
    if (!e.motivoEmpresa || !(MOTIVOS_CANCELAMENTO_EMPRESA as readonly string[]).includes(e.motivoEmpresa)) return recusa("dados", "Escolha o motivo da SCL (apartamento sem condições, força maior ou outro).");
    motivoEmpresa = e.motivoEmpresa;
  }
  const recebidoEm = e.quemPede === "empresa" ? agora : e.recebidoEm;
  if (!(recebidoEm instanceof Date) || Number.isNaN(recebidoEm.getTime()) || recebidoEm.getTime() < c.p0.criadoEm.getTime() || recebidoEm.getTime() > agora.getTime() + FOLGA_MOMENTO_MS) return recusa("dados", TEXTO_MOMENTO_ALTERACAO);
  // O valor: a origem e o motivo (do valor mantido ou digitado).
  if (!["cotacao", "mantido", "digitado"].includes(e.valor.origem)) return recusa("dados", "Escolha de onde vem o valor novo.");
  if (e.valor.origem !== "cotacao") {
    if (!(MOTIVOS_VALOR_ALTERACAO as readonly string[]).includes(e.valor.motivo)) return recusa("dados", "Escolha o motivo do valor.");
    if (!motivoValorNota) return recusa("dados", "Escreva a nota do motivo do valor (obrigatória, sem dados pessoais).");
  }
  if (e.valor.origem === "digitado" && (!Number.isSafeInteger(e.valor.valor) || e.valor.valor < 1 || e.valor.valor > VALOR_MAXIMO)) return recusa("dados", "Digite o valor novo (maior que zero).");
  if (r.valorBruto === null) return recusa("dados", "A reserva está sem valor: corrija antes de alterar.");
  // 7 (o resto) e 8. As datas e as pessoas.
  if (!dataValida(e.checkin) || !dataValida(e.checkout) || e.checkout <= e.checkin) return recusa("dados", "Informe as novas datas (a saída depois da entrada).");
  const hoje = hojeISO(fuso, agora);
  if (e.checkin < hoje) return recusa("dados", "A nova entrada não pode ser antes de hoje.");
  // D1 na nova entrada: hoje, só antes do horário de entrada (a alteração vale só antes da entrada). A entrada de agora
  // já foi conferida (a estadia que já começou tem o texto dela).
  const entradaNova = instanteLocal(e.checkin, c.horaEntrada, fuso);
  if (agora.getTime() >= entradaNova.getTime()) return recusa("dados", `A nova entrada (hoje) já passou do horário de entrada (${c.horaEntrada}): escolha uma data a partir de amanhã.`);
  const limiteDoPrazo = entradaNova.getTime() < c.entradaEm.getTime() ? entradaNova : c.entradaEm;
  const [im] = await db.select({ capacidade: imoveis.capacidade }).from(imoveis).where(eq(imoveis.id, t.imovel.id));
  if (!Number.isInteger(e.hospedes) || e.hospedes < 1) return recusa("dados", "Informe quantas pessoas.");
  if (im?.capacidade && e.hospedes > im.capacidade) return recusa("dados", `Este apartamento recebe até ${im.capacidade} pessoas.`);
  if (!im?.capacidade && e.hospedes !== r.hospedes) return recusa("dados", "A capacidade deste apartamento não está cadastrada: cadastre-a antes de mudar o número de pessoas.");
  const antes = { checkin: r.checkin, checkout: r.checkout };
  const depois = { checkin: e.checkin, checkout: e.checkout };
  const novas = noitesNovas(antes, depois);
  if (novas === "duas_pontas") return recusa("duas_pontas", TEXTO_DUAS_PONTAS);
  const mesmaEstadia = mesmasDatas(antes, depois) && e.hospedes === r.hospedes;
  if (mesmaEstadia && e.valor.origem === "mantido") return recusa("sem_mudanca", TEXTO_SEM_MUDANCA);
  // 9. A cotação das datas novas (sem contar a própria reserva) e as noites acrescentadas.
  const d = await consultarDisponibilidade(db, organizacaoId, { imovel: t.imovel.codigo, entrada: e.checkin, saida: e.checkout, hospedes: String(e.hospedes) }, agora, { propria: { reservaId: r.id, checkin: r.checkin, checkout: r.checkout } });
  if (d.situacao === "invalida") return recusa("dados", d.motivos.join(" ") || "Confira as novas datas e o número de pessoas.");
  if (d.situacao === "indisponivel") return recusa("indisponivel", d.motivos.join(" ") || "As novas datas não estão disponíveis.");
  const cotacao: CotacaoDaAlteracao = {
    diarias: d.cotacao?.diarias ?? null,
    limpeza: d.cotacao?.limpeza ?? null,
    hospedeExtra: d.cotacao?.hospedeExtra ?? null,
    valorCheio: d.cotacao?.valorCheio ?? null,
    desconto: d.cotacao?.desconto ?? 0,
    total: d.cotacao?.total ?? null,
    situacao: d.situacao,
    leituraEm: d.leituraEm?.toISOString() ?? null,
  };
  if (e.valor.origem === "cotacao" && (d.situacao !== "disponivel" || cotacao.total === null)) return recusa("a_confirmar", TEXTO_A_CONFIRMAR);
  if (novas) {
    const livres = await noitesLivres(db, organizacaoId, t.imovel.id, novas.inicio, novas.fim, { excetoReservaIds: [r.id], exigirLeituraAtual: true, agora });
    if (!livres.livres) return livres.motivo === "sem_leitura" ? recusa("sem_leitura", TEXTO_SEM_LEITURA_ALTERACAO) : recusa("noites_ocupadas", textoNoitesOcupadas(livres.conflito));
  }
  // 10. O valor novo e a diferença.
  const valorDepois = e.valor.origem === "cotacao" ? cotacao.total! : e.valor.origem === "mantido" ? r.valorBruto : e.valor.valor;
  const diferenca = valorDepois - r.valorBruto;
  if (mesmaEstadia && diferenca === 0) return recusa("sem_mudanca", TEXTO_SEM_MUDANCA);
  const rumo = rumoDa(diferenca);
  // 11. O motor em seco nas datas novas.
  const pendencia = await pendenciaDoMotor(db, organizacaoId, t.imovel.id, e.checkin, e.checkout, valorDepois);
  if (pendencia) return recusa("sem_calculo", `Nas novas datas o financeiro não calcula a reserva (${PENDENCIAS[pendencia]}): resolva antes de alterar.`);
  // 12. Dinheiro já movimentado ou conferência aberta (guardas).
  const motor = await conferirMotor(db, organizacaoId, r, extras.travar);
  if (motor) return motor;
  // 13. Aumento: o pagamento pelo site precisa poder cobrar agora.
  if (rumo === "aumento") {
    const gate = extras.provedor ? await podeCobrar(db, organizacaoId, process.env, agora, { provedor: extras.provedor }).catch(() => null) : null;
    if (!gate?.ok) return recusa("sem_cobranca", `O pagamento pelo site não pode cobrar agora (${gate && !gate.ok ? gate.texto : "o pagamento no site está desligado"}): a diferença não pode ser paga pelo site.`);
  }
  // 14. Redução: a política aceita (como um cancelamento naquele momento) e as partes da devolução.
  let decidida: Decidida | null = null;
  let partes: ParteDaDevolucao[] = [];
  let valorADevolver = 0;
  if (rumo === "reducao") {
    const x = await decidirReducao(db, organizacaoId, c, { diferenca, recebidoEm, quemPede: e.quemPede, decisao: e.decisao, motivoExcecao: e.motivoExcecao, motivoDecisao });
    if (!x.ok) return x;
    decidida = x.x;
    if (decidida.direito === "nenhum" && mesmaEstadia) return { ...recusa("sem_efeito", TEXTO_SEM_EFEITO), escolha: decidida.escolha };
    if (decidida.direito === "integral") {
      valorADevolver = -diferenca;
      const p = partesDaDevolucao(t, c.daReserva, valorADevolver, agora);
      if (!p) return recusa("sem_saldo", `O que ainda se pode devolver dos pagamentos desta reserva não cobre a diferença de ${formatBRL(valorADevolver)}: confira as devoluções no quadro do pagamento ou registre um ajuste.`);
      partes = p;
    }
  }
  const regras = await lerRegrasCalendario(db, organizacaoId);
  const previa = await completarPrevia(db, organizacaoId, c, {
    alteracaoId: null,
    depois: { checkin: e.checkin, checkout: e.checkout, hospedes: e.hospedes, valor: valorDepois },
    cotacao,
    origemValor: e.valor.origem,
    motivoValor: e.valor.origem === "cotacao" ? null : e.valor.motivo,
    diferenca,
    quemPede: e.quemPede,
    noitesNovas: novas,
    holdMinutos: regras.site.minutosHoldAlteracao,
    holdAte: null,
    limiteDoPrazo,
    decidida,
    valorADevolver,
    partes,
    recebidoEm,
    assinar: (extra) => [
      ...extra,
      cotacao.total,
      cotacao.situacao,
      cotacao.leituraEm ? minuto(new Date(cotacao.leituraEm)) : null,
      e.valor.origem,
      e.quemPede === "hospede" ? minuto(recebidoEm) : null,
      e.quemPede,
      e.decisao,
      e.motivoExcecao,
    ],
    agora,
  });
  return { ok: true, m: { c, e, previa, recebidoEm, canal, nota, motivoValorNota, motivoDecisao, motivoExcecao: decidida?.base === "excecao" ? e.motivoExcecao : null, motivoEmpresa } };
}

const textoNoitesOcupadas = (conflito: string | null) =>
  `As novas noites já estão ocupadas (${conflito === "bloqueio" ? "bloqueio" : conflito === CONFLITO_AGENDA_EXTERNA ? "agenda do Beds24" : conflito ? `reserva ${conflito}` : "outra reserva"}).`;

/**
 * O resto da prévia, comum à montagem nova e à do "Aplicar": o financeiro antes e depois por mês, a leitura de cada
 * pagamento, os avisos (§5.4.2), a assinatura e a pergunta do BotaoConfirmar.
 */
async function completarPrevia(
  db: Db,
  organizacaoId: string,
  c: Contexto,
  x: {
    alteracaoId: string | null;
    depois: PreviaAlteracao["depois"];
    cotacao: CotacaoDaAlteracao;
    origemValor: OrigemValorAlteracao;
    motivoValor: MotivoValorAlteracao | null;
    diferenca: number;
    quemPede: QuemPedeAlteracao;
    noitesNovas: { inicio: string; fim: string } | null;
    holdMinutos: number;
    holdAte: Date | null;
    limiteDoPrazo?: Date | null;
    decidida: Decidida | null;
    valorADevolver: number;
    partes: ParteDaDevolucao[];
    recebidoEm: Date;
    assinar: (base: unknown[]) => unknown[];
    agora: Date;
  },
): Promise<PreviaAlteracao> {
  const { t, r, fuso } = c;
  const rumo = rumoDa(x.diferenca);
  const direito = x.decidida?.direito ?? null;
  const novo = valorNovo({ valorAntes: r.valorBruto ?? 0, valorDepois: x.depois.valor, diferenca: x.diferenca, direito });
  // A taxa da reserva depois: a soma das conhecidas menos a atribuída à parte devolvida (D19); no aumento, a da diferença
  // só é conhecida depois do pagamento.
  const agoraTaxa = taxaDaReserva(t);
  const depoisTaxa = direito === "integral" ? taxaDaReserva(t, { partes: x.partes }) : agoraTaxa;
  const taxaDepois = depoisTaxa.conhecida ? depoisTaxa.taxa : null;
  const antesMotor = await calculoDoMotor(db, organizacaoId, r, { checkin: r.checkin, checkout: r.checkout, valorBruto: r.valorBruto, taxaCanal: r.taxaCanal });
  const depoisMotor = await calculoDoMotor(db, organizacaoId, r, { checkin: x.depois.checkin, checkout: x.depois.checkout, valorBruto: novo, taxaCanal: taxaDepois });
  const meses = compararMeses(antesMotor.linhas, depoisMotor.linhas);
  const taxaDevolvida = direito === "integral" && agoraTaxa.conhecida && !agoraTaxa.desconhecida ? agoraTaxa.taxa - depoisTaxa.taxa : null;
  const financeiro: PreviaAlteracao["financeiro"] = { antes: somar(antesMotor.linhas.values()), depois: somar(depoisMotor.linhas.values()), porMes: meses, taxaDevolvida, taxaDesconhecida: depoisTaxa.desconhecida || rumo === "aumento" };
  const leitura = c.daReserva.map((p) => ({ pagamentoId: p.id, em: p.consultadoEm, situacao: p.situacao, devolvidoLido: p.devolvidoLido }));
  const entradaDaPolitica = entradaQueConta(t.cotacao.checkin, r.checkin);
  const politica = x.decidida?.politica ?? (await politicaDaReserva(db, organizacaoId, c.p0.id));
  const antes = { checkin: r.checkin, checkout: r.checkout, hospedes: r.hospedes, valor: r.valorBruto ?? 0 };

  // Os avisos da prévia (avisar em vez de supor).
  const avisos: string[] = [];
  const mudaDatas = !mesmasDatas(antes, x.depois);
  if (antesMotor.contrato && depoisMotor.contrato && antesMotor.contrato.comissaoBp !== depoisMotor.contrato.comissaoBp)
    avisos.push(`Na nova entrada vale outro contrato (comissão de ${(depoisMotor.contrato.comissaoBp ?? 0) / 100}% em vez de ${(antesMotor.contrato.comissaoBp ?? 0) / 100}%): a divisão muda.`);
  if (rumo === "aumento" && politica) {
    const vigentes = await versoesLegaisAtuais(db, organizacaoId);
    if (vigentes && vigentes.cancelamento !== politica.versao)
      avisos.push(
        `A Política de cancelamento em vigor é a versão ${vigentes.cancelamento}; esta reserva continua seguindo a versão ${politica.versao}, aceita no pagamento. Na página da reserva, o hóspede aceita os Termos e a Privacidade em vigor e vê que a política dele continua a ${politica.versao}.`,
      );
  }
  if (x.alteracaoId === null && (x.noitesNovas || rumo === "aumento")) {
    const ate = prazoDasDatas(x.agora, x.holdMinutos, x.limiteDoPrazo);
    avisos.push(
      x.limiteDoPrazo && ate.getTime() === x.limiteDoPrazo.getTime()
        ? `As novas datas ficam seguradas só até ${prazoBr(ate, x.agora, fuso)}, o horário da entrada (a alteração vale só antes da entrada); o Pix da diferença não estende esse prazo.`
        : `As novas datas ficam seguradas por ${x.holdMinutos} minutos (Configurações → Calendário e preços, "alteração de reserva paga pelo site"); o Pix da diferença estende esse prazo.`,
    );
  }
  if (rumo === "reducao")
    avisos.push(`A política conta da entrada de ${dataBr(entradaDaPolitica)} (${entradaDaPolitica === t.cotacao.checkin ? "a original" : "a atual, que é anterior à original"}).`);
  for (const p of x.partes) {
    const pago = diaBr(p.pagoEm, fuso);
    if (p.rota === "fora_do_prazo")
      avisos.push(`Pagamento de ${pago} com mais de 78 dias: a devolução de ${formatBRL(p.valor)} sai pelo painel do Mercado Pago (cartão, depois confirme aqui) ou por fora (Pix).`);
    else if (p.aguardaLiberacao)
      avisos.push(
        `A devolução de ${formatBRL(p.valor)} é pedida ao Mercado Pago quando ele liberar o pagamento de ${pago}${p.liberacaoPrevista ? ` (previsto para ${diaBr(p.liberacaoPrevista, fuso)})` : ""}: antes disso o sistema não pede. No teste, registre a liberação à mão no quadro do pagamento.`,
      );
    const pg = c.daReserva.find((y) => y.id === p.pagamentoId);
    if (pg && pg.forma === "cartao" && valorPagoAprovado(pg) > pg.valor)
      avisos.push(`O hóspede pagou parcelado com juros: a devolução é da diferença do valor da reserva (${formatBRL(p.valor)}); os juros seguem as regras do cartão.`);
  }
  if (direito === "integral" && taxaDevolvida !== null && taxaDevolvida > 0)
    avisos.push(`A taxa do Mercado Pago sobre a parte devolvida (${formatBRL(taxaDevolvida)}) sai da reserva; o que o Mercado Pago não devolver dessa taxa fica com a SCL.`);
  if (rumo === "reducao" && direito === "nenhum") {
    avisos.push(
      `${quemDecidiu(x.decidida?.base ?? null, politica ? ` (versão ${politica.versao}, contando da entrada de ${dataBr(entradaDaPolitica)})` : "")}, o hóspede não recebe a diferença de ${formatBRL(-x.diferenca)}: o valor da reserva continua ${formatBRL(antes.valor)}, dividido como uma reserva normal.`,
    );
    if (noites(x.depois.checkin, x.depois.checkout) < noites(antes.checkin, antes.checkout) || mudaDatas)
      avisos.push(`As noites liberadas voltam à venda; ${decididaPelaPolitica(x.decidida?.base ?? null) ? "pela política " : ""}o hóspede não recebe a diferença de ${formatBRL(-x.diferenca)}.`);
  }
  if (direito === "integral" && (x.decidida?.base === "empresa" || x.decidida?.base === "excecao")) avisos.push("A SCL arca com a taxa que não voltar da parte devolvida.");
  if (x.quemPede === "empresa" && rumo === "aumento" && x.origemValor === "cotacao") avisos.push(`A alteração é proposta pela SCL: cobrar ${formatBRL(x.diferenca)} do hóspede?`);
  if (x.origemValor === "cotacao" && x.cotacao.total !== null) {
    const nAntes = noites(antes.checkin, antes.checkout);
    const nDepois = noites(x.depois.checkin, x.depois.checkout);
    if (nDepois < nAntes && x.diferenca > 0) avisos.push(`Menos noites e valor maior pela cotação de hoje (${formatBRL(x.cotacao.total)}): confira ou mantenha o valor atual.`);
    if (nDepois > nAntes && x.diferenca < 0) avisos.push(`Mais noites e valor menor pela cotação de hoje (${formatBRL(x.cotacao.total)}): confira ou mantenha o valor atual.`);
  }
  if (mudaDatas) {
    const horarios = (await lerHorariosReservas(db, organizacaoId, [r.id])).get(r.id);
    if (acordoVigente(horarios, "entrada", r) || acordoVigente(horarios, "saida", r)) avisos.push("O combinado de horário de entrada e saída desta reserva deixa de valer com as datas novas: registre de novo, se for o caso.");
    if (x.depois.checkout !== antes.checkout) avisos.push(`A limpeza de saída muda para ${dataBr(x.depois.checkout)} (a já confirmada volta a pedida).`);
    avisos.push("Depois de aplicada, mude o bloqueio no Beds24: feche as novas datas e reabra as antigas.");
  }
  if (x.origemValor !== "cotacao" && x.cotacao.total !== null)
    avisos.push(`Cotação do site para as novas datas: ${formatBRL(x.cotacao.total)}; valor usado: ${formatBRL(x.depois.valor)} (${x.motivoValor ? NOMES_MOTIVO_VALOR[x.motivoValor] : NOMES_ORIGEM_VALOR[x.origemValor]}).`);
  if (rumo === "aumento") avisos.push("A taxa do pagamento da diferença fica conhecida depois do pagamento.");
  if (depoisTaxa.desconhecida) avisos.push("A taxa de um pagamento desta reserva ainda não foi informada pelo Mercado Pago: a divisão usa as taxas conhecidas até ele informar.");
  if (c.andandoAntiga) avisos.push("Há uma tentativa de pagamento sem resposta há mais de 85 dias: confira no painel do Mercado Pago que ela não foi aprovada.");
  for (const l of leitura) avisos.push(l.em ? `Leitura do Mercado Pago de ${diaHoraBr(l.em)}: ${NOMES_SITUACAO_PAGAMENTO[l.situacao].toLowerCase()}.` : "Ainda sem leitura do Mercado Pago deste pagamento.");

  const assinatura = createHash("sha1")
    .update(
      JSON.stringify(
        x.assinar([
          antes,
          x.depois,
          x.diferenca,
          entradaDaPolitica,
          x.decidida ? [x.decidida.decisao.calculado, x.decidida.direito, x.decidida.base] : null,
          x.valorADevolver,
          x.partes.map((p) => [p.pagamentoId, p.valor, p.rota, p.aguardaLiberacao]),
          financeiro.antes,
          financeiro.depois,
          politica?.versao ?? null,
          c.daReserva.map((p) => [p.id, p.situacao, p.devolvidoLido, p.devolucaoEmAndamentoLida, p.devolvidoForaReconhecido, p.taxa, p.liberacaoConfirmadaEm ? 1 : 0]),
        ]),
      ),
    )
    .digest("hex")
    .slice(0, 16);

  const previa: PreviaAlteracao = {
    alteracaoId: x.alteracaoId,
    reservaId: r.id,
    reservaCodigo: r.codigo,
    antes,
    depois: x.depois,
    cotacao: x.cotacao,
    origemValor: x.origemValor,
    motivoValor: x.motivoValor,
    diferenca: x.diferenca,
    rumo,
    valorNovo: novo,
    quemPede: x.quemPede,
    noitesNovas: x.noitesNovas,
    holdMinutos: x.holdMinutos,
    holdAte: x.holdAte,
    limiteDoPrazo: x.limiteDoPrazo ?? null,
    entradaDaPolitica,
    decisao: x.decidida?.decisao ?? null,
    direito,
    base: x.decidida?.base ?? null,
    escolha: x.decidida?.escolha ?? null,
    valorADevolver: x.valorADevolver,
    politica,
    partes: x.partes,
    financeiro,
    leitura,
    avisos,
    assinatura,
    pergunta: "",
  };
  previa.pergunta = perguntaDaAlteracao(previa, fuso, x.agora);
  return previa;
}

/** A política aceita no pagamento que confirmou a reserva (versão, data e prazos), para os textos. */
async function politicaDaReserva(db: Db, organizacaoId: string, p0Id: string): Promise<PoliticaDaReserva> {
  const p = await politicaDoPagamento(db, organizacaoId, p0Id);
  if (!p) return null;
  const regras = regrasComPadrao(p.regras);
  return { versao: p.versao, data: p.data, diasReembolsoIntegral: regras.diasReembolsoIntegral, arrependimentoAteEntrada: regras.arrependimentoAteEntrada };
}

/** A política decidiu a diferença (o prazo, o arrependimento, o pedido fora do prazo); as outras bases são decisão da equipe ou da SCL. */
const decididaPelaPolitica = (base: BaseCancelamento | null) => base === "prazo" || base === "arrependimento" || base === "fora_do_prazo" || base === "estadia_iniciada";
/** A abertura das frases da equipe sobre a diferença (a pergunta, os avisos): "Pela política" só quando foi ela. */
function quemDecidiu(base: BaseCancelamento | null, contando: string): string {
  if (base === "excecao") return "Por exceção";
  if (base === "empresa") return "Como a alteração é proposta pela SCL";
  if (decididaPelaPolitica(base)) return `Pela política${contando}`;
  return base === "sem_politica" ? "Por decisão da equipe (pagamento sem política aceita)" : "Por decisão da equipe";
}
/** O motivo gravado na devolução da diferença (lista de devoluções, auditoria): quem decidiu, como na pergunta. */
const motivoDaDevolucao = (codigo: string, base: BaseCancelamento | null) =>
  `Alteração da reserva ${codigo}: devolução da diferença ${base === "excecao" ? "por exceção" : base === "empresa" ? "proposta pela SCL" : decididaPelaPolitica(base) ? "pela política" : "por decisão da equipe"}`;

/** O texto do BotaoConfirmar de cada caso (§9.2): o que muda, o dinheiro e o que fica a fazer. */
export function perguntaDaAlteracao(p: PreviaAlteracao, fuso: string, agora: Date): string {
  const depois = `${dataBr(p.depois.checkin)} a ${dataBr(p.depois.checkout)}`;
  // As OTAs e as noites liberadas só quando as datas mudam (só as pessoas ou o valor não mexem no calendário).
  const mudaDatas = p.antes.checkin !== p.depois.checkin || p.antes.checkout !== p.depois.checkout;
  const contando = p.politica ? ` (versão ${p.politica.versao}, contando da entrada de ${dataBr(p.entradaDaPolitica)})` : "";
  if (p.rumo === "aumento") {
    const ate = p.holdAte ?? prazoDasDatas(agora, p.holdMinutos, p.limiteDoPrazo);
    return [
      `Segurar as novas datas (${depois}, ${nNoites(noites(p.depois.checkin, p.depois.checkout))}, ${pessoas(p.depois.hospedes)}) até ${prazoBr(ate, agora, fuso)} e liberar para o hóspede pagar a diferença de ${formatBRL(p.diferenca)} na página da reserva?`,
      ...(p.quemPede === "empresa" ? ["A alteração é proposta pela SCL: confirme que o hóspede paga a diferença."] : []),
      `Até o pagamento, a reserva continua como está (${dataBr(p.antes.checkin)} a ${dataBr(p.antes.checkout)}).`,
      mudaDatas ? "Quando ele pagar, a alteração vale sozinha; depois, mude o bloqueio nas OTAs (no Beds24)." : "Quando ele pagar, a alteração vale sozinha.",
    ].join(" ");
  }
  if (p.rumo === "reducao" && p.direito === "integral") {
    const fora = p.partes.some((x) => x.rota === "fora_do_prazo");
    const espera = p.partes.find((x) => x.rota === "pedida" && x.aguardaLiberacao);
    const como = fora
      ? "pelo painel do Mercado Pago ou por fora (pagamento com mais de 78 dias)"
      : `pelo Mercado Pago${espera ? `, quando ele liberar o pagamento${espera.liberacaoPrevista ? ` (previsto para ${diaBr(espera.liberacaoPrevista, fuso)})` : ""}` : ""}`;
    return [
      `Confirme que o hóspede aceitou por escrito: novas datas ${depois}, ${pessoas(p.depois.hospedes)}, novo valor ${formatBRL(p.depois.valor)} (antes ${formatBRL(p.antes.valor)}).`,
      `${quemDecidiu(p.base, contando)}, a diferença de ${formatBRL(p.valorADevolver)} é devolvida ${como}.`,
      ...(p.financeiro.taxaDevolvida !== null ? [`A taxa do Mercado Pago sobre a parte devolvida (${formatBRL(p.financeiro.taxaDevolvida)}) sai da reserva; o que ele não devolver fica com a SCL.`] : []),
      "Aplicar agora? A alteração não se desfaz por aqui.",
    ].join(" ");
  }
  if (p.rumo === "reducao")
    return `Confirme que o hóspede aceitou por escrito: novas datas ${depois}, ${pessoas(p.depois.hospedes)}. ${quemDecidiu(p.base, contando)}, a diferença de ${formatBRL(-p.diferenca)} não é devolvida: o valor da reserva continua ${formatBRL(p.antes.valor)}, dividido como uma reserva normal${mudaDatas ? ", e as noites liberadas voltam à venda" : ""}. Aplicar agora? A alteração não se desfaz por aqui.`;
  return `Confirme que o hóspede aceitou por escrito: novas datas ${depois}, ${pessoas(p.depois.hospedes)}, mesmo valor (${formatBRL(p.antes.valor)}). Aplicar agora? A alteração não se desfaz por aqui.`;
}

// ---------------------------------------------------------------- a montagem do "Aplicar" de uma segurada

/**
 * O "Aplicar" de uma alteração segurada (sem aumento): o retrato gravado (datas, pessoas, valor, diferença, cotação,
 * retrato da política, momento do pedido) e o dinheiro de agora (leituras, devoluções, D1, motor, a decisão com as
 * entradas gravadas — tem de dar a mesma —, as partes e as noites acrescentadas fora da própria reserva-pedido). Nunca cota
 * de novo: uma leitura nova do Beds24 ou um preço mudado durante o prazo não impedem aplicar.
 */
async function montarAplicacao(db: Db, organizacaoId: string, t: Travado, a: Alteracao, agora: Date, travar: boolean): Promise<{ ok: true; c: Contexto; previa: PreviaAlteracao } | RecusaAlteracao> {
  const conferida = await conferirReserva(db, organizacaoId, t, agora, { aplicando: a });
  if (!conferida.ok) return conferida;
  const { c } = conferida;
  const efetiva = situacaoEfetiva(a, agora, carenciaNoTravado(t, agora)(a));
  if (efetiva !== "segurada") return recusa("nao_segurada", textoNaoSegurada(efetiva));
  if (rumoDa(a.diferenca) === "aumento") return recusa("dados", TEXTO_SO_REDUCAO);
  if (!reservaComoNoRetrato(c.r, a)) return recusa("reserva_mudou", TEXTO_RESERVA_MUDOU);
  const datas = await conferirDatasNoFuturo(db, organizacaoId, t, a, agora);
  if (datas) return datas;
  const motor = await conferirMotor(db, organizacaoId, c.r, travar);
  if (motor) return motor;
  let decidida: Decidida | null = null;
  let partes: ParteDaDevolucao[] = [];
  let valorADevolver = 0;
  if (rumoDa(a.diferenca) === "reducao") {
    // A decisão com as entradas gravadas: o mesmo momento, quem pede e a escolha da equipe (tem de dar a gravada).
    const decisaoGravada: EntradaAlteracao["decisao"] = a.base === "excecao" ? "excecao" : a.calculado === "sem_politica" ? (a.direito ?? "nenhum") : "politica";
    const x = await decidirReducao(db, organizacaoId, c, { diferenca: a.diferenca, recebidoEm: a.pedidoRecebidoEm, quemPede: a.quemPede, decisao: decisaoGravada, motivoExcecao: a.motivoExcecao, motivoDecisao: a.motivoDecisao || "-" });
    if (!x.ok || x.x.direito !== a.direito || x.x.base !== a.base) return recusa("previa_mudou", TEXTO_PREVIA_MUDOU_ALTERACAO);
    decidida = x.x;
    if (decidida.direito === "integral") {
      valorADevolver = -a.diferenca;
      const p = partesDaDevolucao(t, c.daReserva, valorADevolver, agora);
      if (!p) return recusa("sem_saldo", `O que ainda se pode devolver dos pagamentos desta reserva não cobre a diferença de ${formatBRL(valorADevolver)}: confira as devoluções no quadro do pagamento ou registre um ajuste.`);
      partes = p;
    }
  }
  if (a.noitesNovasInicio && a.noitesNovasFim) {
    const livres = await noitesLivres(db, organizacaoId, t.imovel.id, a.noitesNovasInicio, a.noitesNovasFim, { excetoReservaIds: [c.r.id, ...(a.holdReservaId ? [a.holdReservaId] : [])], exigirLeituraAtual: false, agora });
    if (!livres.livres) return recusa("noites_ocupadas", textoNoitesOcupadas(livres.conflito));
  }
  const previa = await completarPrevia(db, organizacaoId, c, {
    alteracaoId: a.id,
    depois: { checkin: a.checkinDepois, checkout: a.checkoutDepois, hospedes: a.hospedesDepois, valor: a.valorDepois },
    cotacao: a.cotacao,
    origemValor: a.origemValor,
    motivoValor: a.motivoValor,
    diferenca: a.diferenca,
    quemPede: a.quemPede,
    noitesNovas: a.noitesNovasInicio && a.noitesNovasFim ? { inicio: a.noitesNovasInicio, fim: a.noitesNovasFim } : null,
    holdMinutos: 0,
    holdAte: a.holdAte,
    decidida,
    valorADevolver,
    partes,
    recebidoEm: a.pedidoRecebidoEm,
    // A assinatura da aplicação: o retrato gravado (o que decide: situação, prazo, datas, valor, diferença, política) e o
    // dinheiro de agora; nunca uma cotação nova. Não a última mudança: marcar o hóspede avisado ou as OTAs atualizadas
    // (sem mexer no dinheiro, nas datas ou na política) não invalida o "Aplicar".
    assinar: (extra) => [
      a.id,
      a.situacao,
      a.holdAte?.toISOString() ?? null,
      a.pagamentoId,
      a.checkinDepois,
      a.checkoutDepois,
      a.hospedesDepois,
      a.valorDepois,
      a.diferenca,
      a.politicaVersao,
      a.calculado,
      a.direito,
      a.base,
      a.valorADevolver,
      ...extra,
    ],
    agora,
  });
  return { ok: true, c, previa };
}

const textoNaoSegurada = (s: string) =>
  s === "aplicada" ? "Esta alteração já foi aplicada." : s === "desistida" ? "A equipe já desistiu desta alteração." : "O prazo das datas desta alteração acabou: as novas datas voltaram à venda. Prepare outra alteração.";

/** A reserva continua como no retrato da alteração (datas, pessoas e valor de antes). */
const reservaComoNoRetrato = (r: Reserva, a: Alteracao) => r.checkin === a.checkinAntes && r.checkout === a.checkoutAntes && r.hospedes === a.hospedesAntes && r.valorBruto === a.valorAntes;

// ---------------------------------------------------------------- aplicar (o coração, §5.4.4)

/** O cálculo novo não pôde ser aplicado (a reserva já movimentou dinheiro): nada é aplicado pela metade. */
export class ErroAlteracaoProtegida extends Error {
  constructor() {
    super("A reserva já movimentou dinheiro: o financeiro não foi atualizado.");
  }
}

/**
 * Dentro das travas (cotação → alterações → motor da reserva): escreve a alteração na reserva. Confere de novo, em todo
 * caminho, a reserva confirmada sem cancelamento, igual ao retrato, D1 e o motor; as noites acrescentadas (com a leitura
 * atual do Beds24 só na aprovação tardia); cancela a reserva-pedido; grava as datas, as pessoas, o valor e a taxa pela
 * porta única da sincronização (o motor estorna as linhas antigas no próprio mês, com o id da alteração no motivo, e lança
 * as novas); grava o resultado por mês e componente; na redução integral, cria as devoluções (depois de a reserva mudar).
 * Lança `ErroAlteracaoProtegida` quando o motor protegeu o livro (quem chama desfaz a transação ou o savepoint).
 */
async function aplicarNaTransacao(
  tx: Db,
  organizacaoId: string,
  t: Travado,
  a: Alteracao,
  agora: Date,
  o: { tardia: boolean; autorId: string | null; pagamento: Pagamento | null; fin?: { taxa: number | null }; partes: ParteDaDevolucao[] },
): Promise<{ ok: true; devolucoes: Devolucao[] } | RecusaAlteracao> {
  const r = t.reserva;
  // 1. As conferências de todo caminho.
  if (r.estado !== "confirmada") return recusa("nao_confirmada", TEXTO_NAO_CONFIRMADA);
  if (t.cancelamento) return recusa("ha_cancelamento", TEXTO_HA_CANCELAMENTO);
  if (!reservaComoNoRetrato(r, a)) return recusa("reserva_mudou", TEXTO_RESERVA_MUDOU);
  const datas = await conferirDatasNoFuturo(tx, organizacaoId, t, a, agora);
  if (datas) return datas;
  const motor = await conferirMotor(tx, organizacaoId, r, true);
  if (motor) return motor;
  // 2. As noites acrescentadas, fora da própria reserva e da reserva-pedido dela.
  if (a.noitesNovasInicio && a.noitesNovasFim) {
    const livres = await noitesLivres(tx, organizacaoId, t.imovel.id, a.noitesNovasInicio, a.noitesNovasFim, { excetoReservaIds: [r.id, ...(a.holdReservaId ? [a.holdReservaId] : [])], exigirLeituraAtual: o.tardia, agora });
    if (!livres.livres) return livres.motivo === "sem_leitura" ? recusa("sem_leitura", TEXTO_SEM_LEITURA_ALTERACAO) : { ...recusa("noites_ocupadas", textoNoitesOcupadas(livres.conflito)), conflito: livres.conflito };
  }
  // 3. A reserva-pedido sai (as noites passam a ser da própria reserva).
  await cancelarPortador(tx, organizacaoId, a, o.autorId, agora, "alteração da reserva aplicada");
  // 4. A taxa da reserva: a soma das conhecidas, menos a atribuída à parte devolvida (redução), mais a da diferença (aumento).
  const direito = a.direito;
  const reducaoIntegral = rumoDa(a.diferenca) === "reducao" && direito === "integral";
  const p = o.pagamento;
  const contas = p ? { tentativas: t.tentativas.map((x) => (x.id === p.id ? { ...x, desfecho: "alteracao" as const, taxa: o.fin?.taxa ?? x.taxa } : x)), devolucoes: t.devolucoes } : t;
  const taxa = taxaDaReserva(contas, reducaoIntegral ? { partes: o.partes } : {});
  const novo = valorNovo(a);
  const taxaCanal = taxa.conhecida ? taxa.taxa : null;
  const valorLiquido = taxaCanal === null ? null : novo - taxaCanal;
  // 5. As datas, as pessoas e o valor novos, pela porta única da sincronização (fonte "site"). Sem valor nas observações.
  const antesMotor = await lancamentosDoMotor(tx, organizacaoId, r.id, { travar: true });
  const observacoes = `${r.observacoes}${r.observacoes ? "\n" : ""}Alterada em ${diaBr(agora)}: de ${estadiaEmTexto({ checkin: a.checkinAntes, checkout: a.checkoutAntes, hospedes: a.hospedesAntes })} para ${estadiaEmTexto({ checkin: a.checkinDepois, checkout: a.checkoutDepois, hospedes: a.hospedesDepois })}.`;
  const s = await sincronizarReserva(
    tx,
    organizacaoId,
    "site",
    r.idFonte!,
    { ...dadosDoSite(r), checkin: a.checkinDepois, checkout: a.checkoutDepois, hospedes: a.hospedesDepois, valorBruto: novo, taxaCanal, valorLiquido, observacoes },
    o.autorId,
    agora,
    { motivoEstorno: `Alteração ${a.id} da reserva ${r.codigo}: recalculado` },
  );
  if (!s.ok) return recusa("dados", Object.values(s.erros)[0] ?? "Não deu para gravar a alteração na reserva.");
  if (s.financeiroNaoAtualizado) throw new ErroAlteracaoProtegida();
  Object.assign(r, s.reserva);
  const depoisMotor = await lancamentosDoMotor(tx, organizacaoId, r.id, { travar: true });
  const resultado: ResultadoDaAlteracao = { meses: compararMeses(porMes(antesMotor.ativos), porMes(depoisMotor.ativos)) };
  // 6. A alteração aplicada (final).
  const mudanca = { situacao: "aplicada" as const, aplicadaEm: agora, aplicadaPor: o.autorId, aplicadaTardia: o.tardia, taxaDepois: taxaCanal, resultado, valorADevolver: reducaoIntegral ? -a.diferenca : a.valorADevolver, atualizadoEm: agora };
  await tx.update(alteracoesReserva).set(mudanca).where(eq(alteracoesReserva.id, a.id));
  Object.assign(a, mudanca);
  // 7. Redução integral: as devoluções, depois de a reserva mudar (uma por pagamento, com o teto conferido sob a trava).
  const criadas: Devolucao[] = [];
  if (reducaoIntegral) {
    for (const parte of o.partes) {
      const pg = t.tentativas.find((x) => x.id === parte.pagamentoId);
      if (!pg) continue;
      if (parte.valor > saldoPrincipal(pg, devolucoesDoPagamento(t, pg.id))) throw new Error("Devolução acima do que ainda se pode devolver do pagamento.");
      const [d] = await tx
        .insert(devolucoesPagamento)
        .values({
          organizacaoId,
          pagamentoId: pg.id,
          motivo: motivoDaDevolucao(r.codigo, a.base),
          valor: parte.valor,
          origem: "alteracao",
          alteracaoId: a.id,
          situacao: parte.rota === "pedida" ? "pedida" : "recusada",
          proximaTentativaEm: parte.rota === "pedida" ? agora : null,
          falhas: 0,
          avisos: parte.rota === "fora_do_prazo" ? ["devolucao_fora_do_prazo"] : [],
          autorId: o.autorId,
          criadoEm: agora,
          atualizadoEm: agora,
        })
        .returning();
      t.devolucoes.push(d);
      criadas.push(d);
      await sincronizarAvisosDoPagamento(tx, t, pg, agora);
      await registrarAuditoria(tx, { organizacaoId, usuarioId: o.autorId, acao: "pagamento.devolver", entidade: "pagamento", entidadeId: pg.id, mudancas: { devolucao: [null, d.situacao], valor: [null, parte.valor], alteracao: [null, a.id] } });
    }
  }
  // 8. A auditoria da reserva (o valor bruto só aparece para quem lê o financeiro).
  await registrarAuditoria(tx, {
    organizacaoId,
    usuarioId: o.autorId,
    acao: "reserva.alterar",
    entidade: "reserva",
    entidadeId: r.id,
    mudancas: { checkin: [a.checkinAntes, a.checkinDepois], checkout: [a.checkoutAntes, a.checkoutDepois], hospedes: [a.hospedesAntes, a.hospedesDepois], valorBruto: [a.valorAntes, novo], alteracao: [null, a.id] },
  });
  await registrarAuditoria(tx, { organizacaoId, usuarioId: o.autorId, acao: "alteracao.aplicar", entidade: "alteracao", entidadeId: a.id, mudancas: { situacao: ["segurada", "aplicada"], tardia: [null, o.tardia], diferenca: [null, a.diferenca] } });
  return { ok: true, devolucoes: criadas };
}

/** Uma recusa no meio da transação: desfaz tudo (a alteração e a reserva-pedido gravadas antes) e volta como resposta. */
class RecusaNaTransacao extends Error {
  constructor(readonly recusa: RecusaAlteracao) {
    super(recusa.erro);
  }
}

// ---------------------------------------------------------------- prévia, segurar, aplicar, desistir (as ações)

/** A prévia de uma alteração nova: a releitura da fase 0 (com provedor) e a mesma montagem, sem travar nada. */
export async function previaDaAlteracao(db: Db, organizacaoId: string, reservaId: string, e: EntradaAlteracao, provedor: ProvedorPagamento | null, agora: Date = new Date()): Promise<{ ok: true; previa: PreviaAlteracao } | RecusaAlteracao> {
  const alvo = await localizar(db, organizacaoId, reservaId);
  if (!alvo) return recusa("nao_encontrada", "Reserva não encontrada.");
  if (!alvo.p0) return recusa("nao_paga_pelo_site", TEXTO_NAO_PAGA);
  await releituraDosPagamentos(db, organizacaoId, alvo.pagamentos, provedor, agora);
  const t = await lerCotacaoSemTravar(db, organizacaoId, alvo.p0.cotacaoId);
  if (!t) return recusa("nao_encontrada", "Reserva não encontrada.");
  const m = await montarAlteracao(db, organizacaoId, t, e, agora, { travar: false, provedor });
  return m.ok ? { ok: true, previa: m.m.previa } : m;
}

/** A prévia do "Aplicar" de uma alteração segurada: o retrato gravado mais o estado do dinheiro de agora (nunca cota de novo). */
export async function previaDaAplicacao(db: Db, organizacaoId: string, alteracaoId: string, provedor: ProvedorPagamento | null, agora: Date = new Date()): Promise<{ ok: true; previa: PreviaAlteracao } | RecusaAlteracao> {
  const ref = await cotacaoDaAlteracao(db, organizacaoId, alteracaoId);
  if (!ref) return recusa("nao_encontrada", "Alteração não encontrada.");
  const alvo = await localizar(db, organizacaoId, ref.reservaId);
  if (alvo) await releituraDosPagamentos(db, organizacaoId, alvo.pagamentos, provedor, agora);
  const t = await lerCotacaoSemTravar(db, organizacaoId, ref.cotacaoId);
  const a = t?.alteracoes.find((x) => x.id === alteracaoId);
  if (!t || !a) return recusa("nao_encontrada", "Alteração não encontrada.");
  const m = await montarAplicacao(db, organizacaoId, t, a, agora, false);
  return m.ok ? { ok: true, previa: m.previa } : m;
}

/** Fase 2: os pedidos de devolução ao Mercado Pago, fora da transação (a rotina e o "Conferir agora" retomam se falhar aqui). */
async function pedirDevolucoes(db: Db, organizacaoId: string, devs: readonly Devolucao[], provedor: ProvedorPagamento | null, agora: Date): Promise<SituacaoDevolucao[]> {
  const situacoes: SituacaoDevolucao[] = [];
  for (const d of devs) {
    if (d.situacao !== "pedida" || !provedor) {
      situacoes.push(d.situacao);
      continue;
    }
    try {
      situacoes.push((await tentarDevolucao(db, organizacaoId, d.id, provedor, agora)) ?? "pedida");
    } catch {
      situacoes.push("pedida");
    }
  }
  return situacoes;
}

/**
 * Segura as novas datas (e, sem aumento, com `o.aplicar`, já aplica) — as três fases, no topo do arquivo. `assinatura` é
 * obrigatória: a da prévia que a equipe viu; diferente = `previa_mudou`. Autorização (reserva:editar + financeiro:editar)
 * conferida por quem chama.
 */
export async function segurarAlteracao(
  db: Db,
  organizacaoId: string,
  reservaId: string,
  e: EntradaAlteracao,
  autorId: string | null,
  provedor: ProvedorPagamento | null,
  agora: Date,
  assinatura: string,
  o: { aplicar: boolean } = { aplicar: false },
): Promise<{ ok: true; alteracaoId: string; situacao: "segurada" | "aplicada"; holdAte: Date | null; devolucoes: SituacaoDevolucao[] } | RecusaAlteracao> {
  const alvo = await localizar(db, organizacaoId, reservaId);
  if (!alvo) return recusa("nao_encontrada", "Reserva não encontrada.");
  if (!alvo.p0) return recusa("nao_paga_pelo_site", TEXTO_NAO_PAGA);
  // Fase 0: a releitura (sem trava; o provedor nunca é chamado com trava aberta).
  await releituraDosPagamentos(db, organizacaoId, alvo.pagamentos, provedor, agora);
  const cotacaoId = alvo.p0.cotacaoId;
  let feito: { ok: true; alteracaoId: string; situacao: "segurada" | "aplicada"; holdAte: Date | null; devolucoes: Devolucao[] } | RecusaAlteracao;
  try {
    feito = await db.transaction(async (tx) => {
      // Fase 1: travas (cotação → motor) e só então a montagem, sob elas.
      const t = await travarCotacao(tx, organizacaoId, cotacaoId);
      if (!t) return recusa("nao_encontrada", "Reserva não encontrada.");
      await travarMotorDaReserva(tx, organizacaoId, t.reserva.id);
      await expirarSeVencida(tx, organizacaoId, t, agora, autorId);
      const montada = await montarAlteracao(tx, organizacaoId, t, e, agora, { travar: true, provedor });
      if (!montada.ok) return montada;
      const { m } = montada;
      if (!assinatura || assinatura !== m.previa.assinatura) return recusa("previa_mudou", TEXTO_PREVIA_MUDOU_ALTERACAO);
      if (o.aplicar && m.previa.rumo === "aumento") return recusa("dados", TEXTO_SO_REDUCAO);
      const a = await gravarAlteracao(tx, organizacaoId, m, autorId, agora, { semPortador: o.aplicar });
      t.alteracoes.push(a);
      if (!o.aplicar) return { ok: true as const, alteracaoId: a.id, situacao: "segurada" as const, holdAte: a.holdAte, devolucoes: [] };
      const aplicada = await aplicarNaTransacao(tx, organizacaoId, t, a, agora, { tardia: false, autorId, pagamento: null, partes: m.previa.partes });
      if (!aplicada.ok) throw new RecusaNaTransacao(aplicada);
      return { ok: true as const, alteracaoId: a.id, situacao: "aplicada" as const, holdAte: a.holdAte, devolucoes: aplicada.devolucoes };
    });
  } catch (erro) {
    if (erro instanceof RecusaNaTransacao) return erro.recusa;
    if (erro instanceof ErroAlteracaoProtegida) return recusa("financeiro_movimentado", TEXTO_FINANCEIRO_MOVIMENTADO);
    if (travaOcupada(erro)) return recusa("ocupado", TEXTO_OCUPADO);
    // Outra alteração segurada ao mesmo tempo (índice único da segurada por reserva).
    if (violouUnicidade(erro, "alteracoes_reserva_uma_segurada")) return recusa("ha_alteracao", "Esta reserva acabou de receber outra alteração: atualize a página.");
    // Uma devolução pedida do mesmo pagamento (uma por pagamento): a regra 4 já recusa; o índice é a última guarda.
    if (violouUnicidade(erro, "devolucoes_pagamento_uma_pedida")) return recusa("devolucao_em_andamento", TEXTO_DEVOLUCAO_EM_ANDAMENTO);
    throw erro;
  }
  if (!feito.ok) return feito;
  // Fase 2: os pedidos ao Mercado Pago (esperam sozinhos enquanto o pagamento não foi liberado, D13).
  const devolucoes = await pedirDevolucoes(db, organizacaoId, feito.devolucoes, provedor, agora);
  return { ok: true, alteracaoId: feito.alteracaoId, situacao: feito.situacao, holdAte: feito.holdAte, devolucoes };
}

/** Grava a alteração segurada (o retrato, a política, a assinatura e o prazo) e a reserva-pedido das noites novas. */
async function gravarAlteracao(tx: Db, organizacaoId: string, m: Montada, autorId: string | null, agora: Date, o: { semPortador: boolean }): Promise<Alteracao> {
  const { c, previa } = m;
  const r = c.r;
  const holdAte = prazoDasDatas(agora, previa.holdMinutos, previa.limiteDoPrazo);
  const decisao = previa.decisao;
  const [a] = await tx
    .insert(alteracoesReserva)
    .values({
      organizacaoId,
      reservaId: r.id,
      cotacaoId: c.t.cotacao.id,
      pagamentoId: c.p0.id,
      situacao: "segurada",
      quemPede: previa.quemPede,
      motivoEmpresa: m.motivoEmpresa,
      pedidoRecebidoEm: m.recebidoEm,
      canal: m.canal,
      nota: m.nota,
      checkinAntes: previa.antes.checkin,
      checkoutAntes: previa.antes.checkout,
      hospedesAntes: previa.antes.hospedes,
      valorAntes: previa.antes.valor,
      checkinDepois: previa.depois.checkin,
      checkoutDepois: previa.depois.checkout,
      hospedesDepois: previa.depois.hospedes,
      valorDepois: previa.depois.valor,
      origemValor: previa.origemValor,
      motivoValor: previa.motivoValor,
      motivoValorNota: m.motivoValorNota,
      cotacao: previa.cotacao,
      diferenca: previa.diferenca,
      entradaDaPolitica: previa.entradaDaPolitica,
      noitesNovasInicio: previa.noitesNovas?.inicio ?? null,
      noitesNovasFim: previa.noitesNovas?.fim ?? null,
      holdAte,
      politicaVersao: previa.rumo === "reducao" ? (previa.politica?.versao ?? null) : null,
      diasReembolsoIntegral: previa.rumo === "reducao" ? (previa.politica?.diasReembolsoIntegral ?? null) : null,
      arrependimentoAteEntrada: previa.rumo === "reducao" ? (previa.politica?.arrependimentoAteEntrada ?? null) : null,
      integralAte: decisao?.integralAte ?? null,
      arrependimentoAte: decisao?.arrependimentoAte ?? null,
      calculado: decisao?.calculado ?? null,
      direito: previa.direito,
      base: previa.base,
      motivoExcecao: m.motivoExcecao,
      motivoDecisao: previa.rumo === "reducao" ? m.motivoDecisao : "",
      valorADevolver: previa.rumo === "reducao" ? previa.valorADevolver : null,
      assinatura: previa.assinatura,
      criadaPor: autorId,
      criadoEm: agora,
      atualizadoEm: agora,
    })
    .returning();
  if (previa.noitesNovas && !o.semPortador) {
    const portador = await sincronizarReserva(
      tx,
      organizacaoId,
      FONTE_ALTERACAO,
      a.id,
      {
        imovelId: r.imovelId,
        origem: "site",
        estado: "pedido",
        reservadaEm: agora,
        checkin: previa.noitesNovas.inicio,
        checkout: previa.noitesNovas.fim,
        hospedes: previa.depois.hospedes,
        hospedeNome: `Alteração ${r.codigo}`,
        hospedeEmail: "",
        hospedeTelefone: "",
        hospedeOrigem: "",
        moeda: "BRL",
        valorBruto: null,
        taxaCanal: null,
        valorLiquido: null,
        codigoCanal: "",
        observacoes: `Datas seguradas para a alteração da reserva ${r.codigo} até ${fmt(holdAte, c.fuso, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}; somem sozinhas se a alteração não for concluída.`,
      },
      autorId,
      agora,
    );
    if (!portador.ok) throw new RecusaNaTransacao(recusa("dados", Object.values(portador.erros)[0] ?? "Não deu para segurar as novas datas."));
    await tx.update(alteracoesReserva).set({ holdReservaId: portador.reserva.id }).where(eq(alteracoesReserva.id, a.id));
    a.holdReservaId = portador.reserva.id;
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "alteracao.segurar", entidade: "alteracao", entidadeId: a.id, mudancas: { reserva: [null, r.codigo], ate: [null, holdAte.toISOString()] } });
  }
  await registrarAuditoria(tx, {
    organizacaoId,
    usuarioId: autorId,
    acao: "alteracao.preparar",
    entidade: "alteracao",
    entidadeId: a.id,
    mudancas: { de: [null, `${previa.antes.checkin}/${previa.antes.checkout}/${previa.antes.hospedes ?? "-"}`], para: [null, `${previa.depois.checkin}/${previa.depois.checkout}/${previa.depois.hospedes}`], diferenca: [null, previa.diferenca] },
  });
  return a;
}

/**
 * "Aplicar a alteração" (sem aumento) de uma alteração segurada pela equipe, com a assinatura da prévia da aplicação —
 * as três fases. Autorização (reserva:editar + financeiro:editar) conferida por quem chama.
 */
export async function aplicarAlteracaoPelaEquipe(
  db: Db,
  organizacaoId: string,
  alteracaoId: string,
  autorId: string | null,
  provedor: ProvedorPagamento | null,
  agora: Date,
  assinatura: string,
): Promise<{ ok: true; devolucoes: SituacaoDevolucao[] } | RecusaAlteracao> {
  const ref = await cotacaoDaAlteracao(db, organizacaoId, alteracaoId);
  if (!ref) return recusa("nao_encontrada", "Alteração não encontrada.");
  const alvo = await localizar(db, organizacaoId, ref.reservaId);
  if (alvo) await releituraDosPagamentos(db, organizacaoId, alvo.pagamentos, provedor, agora);
  let feito: { ok: true; devolucoes: Devolucao[] } | RecusaAlteracao;
  try {
    feito = await db.transaction(async (tx) => {
      const t = await travarCotacao(tx, organizacaoId, ref.cotacaoId);
      if (!t) return recusa("nao_encontrada", "Alteração não encontrada.");
      await travarMotorDaReserva(tx, organizacaoId, t.reserva.id);
      await expirarSeVencida(tx, organizacaoId, t, agora, autorId);
      const a = t.alteracoes.find((x) => x.id === alteracaoId);
      if (!a) return recusa("nao_encontrada", "Alteração não encontrada.");
      const m = await montarAplicacao(tx, organizacaoId, t, a, agora, true);
      if (!m.ok) return m;
      if (!assinatura || assinatura !== m.previa.assinatura) return recusa("previa_mudou", TEXTO_PREVIA_MUDOU_ALTERACAO);
      const aplicada = await aplicarNaTransacao(tx, organizacaoId, t, a, agora, { tardia: false, autorId, pagamento: null, partes: m.previa.partes });
      if (!aplicada.ok) throw new RecusaNaTransacao(aplicada);
      return aplicada;
    });
  } catch (erro) {
    if (erro instanceof RecusaNaTransacao) return erro.recusa;
    if (erro instanceof ErroAlteracaoProtegida) return recusa("financeiro_movimentado", TEXTO_FINANCEIRO_MOVIMENTADO);
    if (travaOcupada(erro)) return recusa("ocupado", TEXTO_OCUPADO);
    if (violouUnicidade(erro, "devolucoes_pagamento_uma_pedida")) return recusa("devolucao_em_andamento", TEXTO_DEVOLUCAO_EM_ANDAMENTO);
    throw erro;
  }
  if (!feito.ok) return feito;
  return { ok: true, devolucoes: await pedirDevolucoes(db, organizacaoId, feito.devolucoes, provedor, agora) };
}

/**
 * "Desistir da alteração" (com o motivo): a alteração segurada fica desistida, as novas noites voltam à venda e o Pix da
 * diferença ainda pendente é cancelado no Mercado Pago depois da transação. Com um pagamento da diferença em andamento
 * (criando, incerto, cartão em análise ou processando), espera. Um Pix pago no meio vira aprovação tardia
 * (`alteracao_desistida`, sem reserva) e vai para "Devolver ao hóspede".
 */
export async function desistirDaAlteracao(db: Db, organizacaoId: string, alteracaoId: string, motivoBruto: string, autorId: string | null, provedor: ProvedorPagamento | null, agora: Date = new Date()): Promise<{ ok: true } | RecusaAlteracao> {
  const motivo = (motivoBruto ?? "").trim();
  if (!motivo) return recusa("dados", "Escreva o motivo da desistência (sem dados pessoais).");
  const problema = problemaDasNotas([motivo]);
  if (problema) return recusa("dados", problema);
  const ref = await cotacaoDaAlteracao(db, organizacaoId, alteracaoId);
  if (!ref) return recusa("nao_encontrada", "Alteração não encontrada.");
  let feito: { ok: true; cancelar: { id: string; idProvedor: string }[] } | RecusaAlteracao;
  try {
    feito = await db.transaction(async (tx) => {
      const t = await travarCotacao(tx, organizacaoId, ref.cotacaoId);
      if (!t) return recusa("nao_encontrada", "Alteração não encontrada.");
      await travarMotorDaReserva(tx, organizacaoId, t.reserva.id);
      await expirarSeVencida(tx, organizacaoId, t, agora, autorId);
      const a = t.alteracoes.find((x) => x.id === alteracaoId);
      if (!a) return recusa("nao_encontrada", "Alteração não encontrada.");
      if (a.situacao !== "segurada") return recusa("nao_segurada", textoNaoSegurada(a.situacao));
      const inicioLeitura = inicioDoPrazoDeReleitura(agora).getTime();
      const daAlteracao = t.tentativas.filter((x) => x.alteracaoId === a.id);
      if (daAlteracao.some((x) => x.criadoEm.getTime() >= inicioLeitura && (x.situacao === "criando" || x.situacao === "incerta" || (x.forma === "cartao" && x.situacao === "pendente" && x.etapaCartao !== "desafio"))))
        return recusa("em_andamento", TEXTO_EM_ANDAMENTO_DIFERENCA);
      const mudanca = { situacao: "desistida" as const, desistidaEm: agora, desistidaPor: autorId, desistenciaMotivo: motivo, atualizadoEm: agora };
      await tx.update(alteracoesReserva).set(mudanca).where(eq(alteracoesReserva.id, a.id));
      Object.assign(a, mudanca);
      await cancelarPortador(tx, organizacaoId, a, autorId, agora, "a equipe desistiu da alteração");
      await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "alteracao.desistir", entidade: "alteracao", entidadeId: a.id, mudancas: { situacao: ["segurada", "desistida"] } });
      // As tentativas da diferença ainda pendentes no Mercado Pago: canceladas lá depois da transação (quem pediu: o sistema).
      const pendentes = daAlteracao.filter((x) => x.situacao === "pendente" && x.idProvedor);
      const semQuem = pendentes.filter((x) => !x.cancelamentoPor).map((x) => x.id);
      if (semQuem.length) await tx.update(pagamentos).set({ cancelamentoPor: "sistema", atualizadoEm: agora }).where(and(inArray(pagamentos.id, semQuem), isNull(pagamentos.cancelamentoPor)));
      return { ok: true as const, cancelar: pendentes.map((x) => ({ id: x.id, idProvedor: x.idProvedor! })) };
    });
  } catch (erro) {
    if (travaOcupada(erro)) return recusa("ocupado", TEXTO_OCUPADO);
    throw erro;
  }
  if (!feito.ok) return feito;
  if (provedor && feito.cancelar.length) await cancelarNoProvedor(db, organizacaoId, feito.cancelar, provedor, agora).catch(() => 0);
  return { ok: true };
}

// ---------------------------------------------------------------- a aprovação da diferença (D10, dentro de confirmacao.ts)

const semReserva = (m: string, detalhe?: string | null): Decisao => ({ desfecho: null, desfechoMotivo: null, motivoSemReserva: detalhe ? `${m}:${detalhe}` : m, confirmou: false, avisos: [] });

/** O valor aprovado é a diferença da alteração? (A mesma régua de `valorConfere` da reserva, sobre a diferença.) */
type ValorConfere = (c: Cobranca | null, p: Pick<Pagamento, "valor" | "forma" | "parcelas">, total: number) => boolean;

/**
 * Dentro da transação da aprovação (`decidirAprovacao`, com as travas da cotação já tomadas): o pagamento da diferença
 * aplica a alteração segurada; aprovado depois do prazo, aplica só se nada mais mudou (a reserva igual ao retrato, nenhuma
 * alteração depois desta, sem cancelamento, as datas ainda no futuro) e as noites novas estiverem livres na leitura atual do
 * Beds24. Senão, o pagamento fica sem reserva com o motivo, e vai para "Devolver ao hóspede". A aplicação roda num savepoint:
 * uma recusa ou o livro protegido desfazem só ela (a leitura do pagamento continua gravada; nenhuma aprovação fica sem desfecho).
 */
export async function decidirAprovacaoDaAlteracao(tx: Db, organizacaoId: string, t: Travado, p: Pagamento, c: Cobranca | null, fin: { taxa: number | null; liquido: number | null }, agora: Date, valorConfere: ValorConfere): Promise<Decisao> {
  const r = t.reserva;
  // 1. Dinheiro real no ambiente de teste: nunca aplica.
  if (p.aoVivo === true || c?.aoVivo === true) return semReserva("ao_vivo");
  // 2 a 6. A alteração desta tentativa, o valor, outra tentativa que já aplicou, a alteração desfeita, a reserva mudada.
  const a = t.alteracoes.find((x) => x.id === p.alteracaoId);
  if (!a) return semReserva("outro");
  if (!valorConfere(c, p, a.diferenca)) return semReserva("valor_divergente");
  if (t.tentativas.some((x) => x.id !== p.id && x.alteracaoId === a.id && x.desfecho === "alteracao") || a.situacao === "aplicada") return semReserva("outra_tentativa");
  if (a.situacao === "desistida") return semReserva("alteracao_desistida");
  if (r.estado === "cancelada" || t.cancelamento?.situacao === "cancelada") return semReserva("cancelada_pela_equipe");
  if (r.estado !== "confirmada" || t.cancelamento) return semReserva("alteracao_reserva_mudou");
  // 7. O vencimento preguiçoso (sem provedor), na ordem das travas: o motor da reserva antes da reserva-pedido.
  await travarMotorDaReserva(tx, organizacaoId, r.id);
  await expirarSeVencida(tx, organizacaoId, t, agora);
  let tardia: boolean;
  if (a.situacao === "segurada") tardia = false;
  else if (a.situacao === "expirada") {
    // 8. Depois do prazo: só com a reserva igual ao retrato e nenhuma alteração da reserva criada depois desta.
    if (!reservaComoNoRetrato(r, a) || t.alteracoes.some((x) => x.id !== a.id && x.criadoEm.getTime() > a.criadoEm.getTime())) return semReserva("alteracao_reserva_mudou");
    tardia = true;
  } else return semReserva("outro");
  // O retrato muda junto com a aplicação: num savepoint desfeito, ele volta ao que era.
  const retrato = { reserva: { ...r }, alteracao: { ...a }, devolucoes: t.devolucoes.length };
  try {
    return await tx.transaction(async (sp) => {
      const r2 = await aplicarNaTransacao(sp, organizacaoId, t, a, agora, { tardia, autorId: null, pagamento: p, fin: { taxa: fin.taxa }, partes: [] });
      if (!r2.ok) throw new RecusaNaTransacao(r2);
      await registrarAuditoria(sp, { organizacaoId, usuarioId: null, acao: "pagamento.alteracao", entidade: "pagamento", entidadeId: p.id, mudancas: { alteracao: [null, a.id], tardia: [null, tardia] } });
      return { desfecho: "alteracao" as const, desfechoMotivo: tardia ? "alteracao_tardia" : "alteracao", motivoSemReserva: null, confirmou: false, avisos: [], alterou: a.id };
    });
  } catch (erro) {
    Object.assign(r, retrato.reserva);
    Object.assign(a, retrato.alteracao);
    t.devolucoes.splice(retrato.devolucoes);
    // 9. As recusas viram o motivo do pagamento sem reserva; o livro protegido também (nada aplicado pela metade).
    if (erro instanceof ErroAlteracaoProtegida) return semReserva("alteracao_nao_aplicada", "financeiro_movimentado");
    if (erro instanceof RecusaNaTransacao) {
      const x = erro.recusa;
      if (x.codigo === "noites_ocupadas") return semReserva("alteracao_noites_ocupadas", x.conflito ?? null);
      if (x.codigo === "sem_leitura") return semReserva("alteracao_sem_leitura");
      if (x.codigo === "reserva_mudou" || x.codigo === "ha_cancelamento" || x.codigo === "nao_confirmada") return semReserva("alteracao_reserva_mudou");
      return semReserva("alteracao_nao_aplicada", x.codigo);
    }
    throw erro;
  }
}

// ---------------------------------------------------------------- OTAs e "mensagem enviada ao hóspede"

type Resultado = { ok: true } | { ok: false; erro: string };

/** "Datas atualizadas nas OTAs" (reserva:editar): uma vez, na alteração aplicada. O M8.3 grava sozinho quando chegar. */
export async function marcarOtaAtualizada(db: Db, organizacaoId: string, alteracaoId: string, autorId: string | null, agora: Date = new Date()): Promise<Resultado> {
  if (!uuidValido(alteracaoId)) return { ok: false, erro: "Alteração não encontrada." };
  const [a] = await db.select().from(alteracoesReserva).where(and(eq(alteracoesReserva.id, alteracaoId), eq(alteracoesReserva.organizacaoId, organizacaoId)));
  if (!a) return { ok: false, erro: "Alteração não encontrada." };
  if (a.situacao !== "aplicada") return { ok: false, erro: "Só uma alteração aplicada muda o bloqueio nas OTAs." };
  if (a.otaAtualizadaEm) return { ok: false, erro: `O bloqueio já foi marcado como mudado em ${diaBr(a.otaAtualizadaEm)}.` };
  const [feito] = await db
    .update(alteracoesReserva)
    .set({ otaAtualizadaEm: agora, otaAtualizadaPor: autorId, atualizadoEm: agora })
    .where(and(eq(alteracoesReserva.id, a.id), isNull(alteracoesReserva.otaAtualizadaEm)))
    .returning({ id: alteracoesReserva.id });
  if (!feito) return { ok: false, erro: "O bloqueio já foi marcado como mudado." };
  await registrarAuditoria(db, { organizacaoId, usuarioId: autorId, acao: "alteracao.ota_atualizada", entidade: "alteracao", entidadeId: a.id, mudancas: { otaAtualizadaEm: [null, agora.toISOString()] } });
  return { ok: true };
}

export type MensagemDaAlteracao = "proposta" | "confirmacao" | "devolucao";

const COLUNAS_AVISADO = {
  proposta: { em: alteracoesReserva.hospedeAvisadoPropostaEm, marca: (em: Date, por: string | null) => ({ hospedeAvisadoPropostaEm: em, hospedeAvisadoPropostaPor: por }) },
  confirmacao: { em: alteracoesReserva.hospedeAvisadoConfirmacaoEm, marca: (em: Date, por: string | null) => ({ hospedeAvisadoConfirmacaoEm: em, hospedeAvisadoConfirmacaoPor: por }) },
  devolucao: { em: alteracoesReserva.hospedeAvisadoDevolucaoEm, marca: (em: Date, por: string | null) => ({ hospedeAvisadoDevolucaoEm: em, hospedeAvisadoDevolucaoPor: por }) },
} as const;

/** Marca uma mensagem da alteração como enviada, uma vez (`por` null = o sistema, pelo envio automático do M9.2). Devolve se marcou agora. */
export async function marcarAvisadoDaAlteracao(db: Db, organizacaoId: string, alteracaoId: string, qual: MensagemDaAlteracao, por: string | null, agora: Date): Promise<boolean> {
  const col = COLUNAS_AVISADO[qual];
  const [feito] = await db
    .update(alteracoesReserva)
    .set({ ...col.marca(agora, por), atualizadoEm: agora })
    .where(and(eq(alteracoesReserva.id, alteracaoId), eq(alteracoesReserva.organizacaoId, organizacaoId), isNull(col.em)))
    .returning({ id: alteracoesReserva.id });
  if (feito) await registrarAuditoria(db, { organizacaoId, usuarioId: por, acao: "alteracao.hospede_avisado", entidade: "alteracao", entidadeId: alteracaoId, mudancas: { qual: [null, qual] } });
  return Boolean(feito);
}

/**
 * "Mensagem enviada ao hóspede" de uma alteração (reserva:editar): a proposta (qualquer alteração), a confirmação (aplicada)
 * ou a devolução feita (todas as devoluções dela realizadas). Uma vez por mensagem.
 */
export async function marcarHospedeAvisadoDaAlteracao(db: Db, organizacaoId: string, alteracaoId: string, qual: MensagemDaAlteracao, autorId: string, agora: Date = new Date()): Promise<Resultado> {
  if (!uuidValido(alteracaoId) || !(qual in COLUNAS_AVISADO)) return { ok: false, erro: "Alteração não encontrada." };
  const [a] = await db.select().from(alteracoesReserva).where(and(eq(alteracoesReserva.id, alteracaoId), eq(alteracoesReserva.organizacaoId, organizacaoId)));
  if (!a) return { ok: false, erro: "Alteração não encontrada." };
  if (qual !== "proposta" && a.situacao !== "aplicada") return { ok: false, erro: "A alteração ainda não foi aplicada." };
  if (qual === "devolucao") {
    const devs = (await db.select({ situacao: devolucoesPagamento.situacao }).from(devolucoesPagamento).where(eq(devolucoesPagamento.alteracaoId, a.id))).filter((d) => d.situacao !== "substituida");
    if (!devs.length || devs.some((d) => d.situacao !== "confirmada" && d.situacao !== "por_fora")) return { ok: false, erro: "A devolução ainda não foi feita." };
  }
  if (!(await marcarAvisadoDaAlteracao(db, organizacaoId, a.id, qual, autorId, agora))) return { ok: false, erro: "Esta mensagem já foi marcada como enviada." };
  return { ok: true };
}

/** Os nomes para os textos do painel. */
export const NOMES_QUEM_PEDE: Record<QuemPedeAlteracao, string> = { hospede: "o hóspede pediu", empresa: "a SCL propõe" };
export { NOMES_BASE_CANCELAMENTO, NOMES_MOTIVO_EMPRESA };
