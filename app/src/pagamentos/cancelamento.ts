/**
 * Cancelamento de reserva paga pelo site, pela política (M8.2c; desenho §5.4).
 *
 * Quem decide é a Política de cancelamento na versão aceita pelo hóspede ao pagar (`decidirPelaPolitica`), no momento em
 * que a SCL recebeu o pedido: devolução integral ou nada. A equipe só escolhe
 * onde a política não decide: a exceção (integral quando a política não dá nada, com motivo da lista e nota) e o caso sem
 * política (pagamento sem o aceite). Um direito integral nunca vira "nada": o não comparecimento é recusado com um pedido
 * ativo, e o pedido do hóspede que chega depois do início da estadia sem direito a devolução é saída antecipada, não
 * cancelamento.
 *
 * Três fases:
 * - **Fase 0** (sem trava): releitura forçada do pagamento no Mercado Pago, quando dá. Uma decisão integral de um pagamento
 *   ainda dentro do prazo de leitura exige que essa leitura tenha sido aplicada (`sem_leitura` sem ela).
 * - **Fase 1** (uma transação): trava a cotação (imóvel → reserva → cotação → tentativas → devoluções → cancelamento), depois
 *   o motor da reserva, e só então decide (`montarDecisao`, a mesma da prévia) e confere a assinatura da prévia. Grava o
 *   cancelamento, a reserva e a cotação canceladas, o resultado no livro (`acertarResultado`) e a devolução (pedida, fora do
 *   prazo, já devolvida ou nenhuma). Trava ocupada (55P03, 40P01) responde "ocupado": nada foi pedido ao provedor.
 * - **Fase 2** (fora da transação): o pedido da devolução ao Mercado Pago (`tentarDevolucao`); a rotina e o "Conferir
 *   agora" o retomam se falhar aqui.
 *
 * Depois de uma alteração (M8.2d): os prazos contam da entrada que conta (`entradaQueConta`: a menor entre a da cotação
 * original e a atual) e "a estadia começou" conta da atual; a política é a aceita no pagamento que confirmou a reserva. A
 * base é o que ainda se pode devolver de cada pagamento da reserva (o pago menos as outras devoluções e o reconhecido
 * devolvido fora pelo painel do Mercado Pago, D17); uma devolução do cancelamento por pagamento com saldo. O cancelamento
 * integral absorve a devolução de uma alteração que nunca chegou ao Mercado Pago (fica `substituida`, D23), e todo
 * cancelamento (com ou sem devolução) desiste de uma alteração com as datas seguradas sem pagamento da diferença em
 * andamento (com ele, o cancelamento espera). Recusa enquanto uma devolução da reserva tem
 * a chave em voo, ou uma devolvida a menos não tem o restante resolvido.
 *
 * O pedido (do hóspede em Minha reserva, com o horário do servidor travado; ou registrado pela equipe), o descarte, a
 * marca das OTAs e a de "mensagem enviada ao hóspede" também moram aqui. Nenhuma nota guarda dado pessoal
 * (`textoSemDadosPessoais`); a auditoria nunca copia notas nem nomes.
 */
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { lerConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import { DIAS_ARREPENDIMENTO, type DecisaoPolitica, decidirPelaPolitica, entradaQueConta, HORA_ENTRADA_PADRAO, horaDeEntrada, type QuemCancela, regrasComPadrao } from "@/configuracoes/politica-cancelamento";
import { travaOcupada, violouUnicidade } from "@/db/erros";
import {
  alteracoesReserva,
  type BaseCancelamento,
  CANAIS_PEDIDO_CANCELAMENTO,
  cancelamentosReserva,
  type CanalPedidoCancelamento,
  cotacoes,
  devolucoesPagamento,
  imoveisDetalhes,
  lancamentos,
  MOTIVOS_CANCELAMENTO_EMPRESA,
  MOTIVOS_EXCECAO,
  type MotivoCancelamentoEmpresa,
  type MotivoExcecao,
  pagamentos,
  QUEM_CANCELA_RESERVA,
  reservas,
  type SituacaoDevolucao,
  type SituacaoPagamento,
  usuarios,
} from "@/db/schema";
import type { Db } from "@/db/types";
import { travarMotorDaReserva } from "@/financeiro/trava";
import { ERRO_DADOS_PESSOAIS, textoSemDadosPessoais } from "@/lib/dados-pessoais";
import { diaHoraNoFuso as diaHoraBr, diaMesBr, diaMesNoFuso as diaBr, hojeISO, instanteLocal } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { formatBRL } from "@/lib/money";
import { repasseAPagarDaReservaDados } from "@/repasses/recebimentos";
import { avisoDoPagamento, cancelarPortador } from "@/reservas/repositorio";
import { politicaDoPagamento } from "@/site/aceites";
import { acertarCaixaDaDevolucao, acertarResultado, auditoriaDoDevolvido, fatoDoDevolvidoNoPainel, lancamentosDoMotor } from "./acerto-cancelamento";
import { expirarSeVencida } from "./alteracao-prazo";
import { situacaoEfetiva } from "./alteracao-regras";
import { inicioDoPrazoDePedirDevolucao, inicioDoPrazoDeReleitura } from "./andamento";
import { sincronizarAvisosDoPagamento, trocarAvisosDaDevolucao } from "./avisos-devolucao";
import { cancelarNoProvedor, conferirTentativa } from "./conferencia";
import { registrarEventoDaContestacao } from "./contestacao-leitura";
import { contestacaoNaoFinal, disputaDoPagamento, MOTIVO_CANCELAMENTO_CONTESTACAO, TEXTO_CONTESTACAO_PERDIDA, TEXTO_DISPUTA_EM_CURSO_CANCELAMENTO } from "./contestacao-regras";
import { ERRO_FORA_SEM_VALOR, PRAZO_DEVOLUCAO_CARTAO_DIAS, tentarDevolucao } from "./devolucao";
import { entradasDasAlteracoes } from "./entradas";
import { FUSO_PAGAMENTO, taxaCanalDaReserva } from "./liberacao";
import type { ProvedorPagamento } from "./provedor";
import { type CodigoAviso, emAndamento, NOMES_SITUACAO_PAGAMENTO } from "./situacoes";
import {
  type Alteracao,
  carenciaNoTravado,
  chaveEmVoo,
  comprometido,
  comprometidoNoPagamento,
  type Cancelamento,
  contestacoesDoPagamento,
  type Devolucao,
  devolucaoInexplicada,
  devolucoesDoPagamento,
  devolvidoForaSemValor,
  devolvidoPeloSistema,
  devolvidoProprio,
  lerCotacaoSemTravar,
  type Pagamento,
  pagamentosDaReserva,
  saldoDevolvivel,
  type Travado,
  travarCotacao,
  valorPagoAprovado,
} from "./travas";

export type EntradaCancelamento = {
  /** Sem pedido registrado: obrigatório. Pedido da equipe: o registrado, ou um novo com `motivoMomento`. Pedido pelo site: ignorado (travado). */
  recebidoEm: Date | null;
  /** Obrigatório (1..300) quando muda o momento registrado pela equipe. */
  motivoMomento: string;
  canal: CanalPedidoCancelamento | null;
  quemCancela: QuemCancela;
  motivoEmpresa: MotivoCancelamentoEmpresa | null;
  /** "politica" = o calculado; "excecao" = integral quando a política dá nenhum; "integral"/"nenhum" só sem política. */
  decisao: "politica" | "excecao" | "integral" | "nenhum";
  /** Obrigatório na exceção. */
  motivoExcecao: MotivoExcecao | null;
  /** Obrigatório na exceção e sem política (1..300). */
  motivoDecisao: string;
  /** 0..300 */
  nota: string;
  /**
   * D17: o valor que o painel do Mercado Pago mostra devolvido fora do sistema, por pagamento (o id dele → centavos),
   * quando a leitura não diz quanto (obrigatório só nesse caso; depois de um aumento, cada pagamento tem o seu).
   */
  valoresForaInformados?: Readonly<Record<string, number>>;
};

export type CodigoRecusaCancelamento =
  | "nao_encontrada"
  | "nao_paga_pelo_site"
  | "ja_cancelada"
  | "em_andamento"
  | "devolvido_em_parte"
  | "devolvido_fora_sem_valor"
  | "devolucao_a_menor"
  | "ha_alteracao"
  | "contestado"
  | "contestacao_perdida"
  | "sem_disputa"
  | "sem_leitura"
  | "repasse_a_pagar"
  | "estadia_encerrada"
  | "estadia_iniciada"
  | "ha_pedido"
  | "dados"
  | "decisao_obrigatoria"
  | "integral_nao_se_nega"
  | "cedo_para_nao_comparecimento"
  | "previa_mudou"
  | "ocupado";

/** Como a devolução sai: pedida ao Mercado Pago agora; pelo painel dele ou por fora (pagamento com mais de 78 dias); já devolvida; nenhuma. */
export type RotaDevolucao = "pedida" | "fora_do_prazo" | "ja_devolvida" | "nenhuma";

export type Previa = {
  decisao: DecisaoPolitica;
  direito: "integral" | "nenhum";
  base: BaseCancelamento;
  rota: RotaDevolucao;
  valorPago: number;
  valorADevolver: number;
  valorRetido: number;
  /** O momento que a política conta, o canal e a política aceita (versão e data da publicação). */
  recebidoEm: Date;
  canal: CanalPedidoCancelamento | null;
  politica: { versao: number; data: string; diasReembolsoIntegral: number; arrependimentoAteEntrada: boolean } | null;
  componentes: {
    comissao: number;
    parteProprietario: number;
    taxa: number | null;
    /** Partes já pagas (repasse pago, ou realizada à mão): entram como desconto no próximo repasse. */
    jaRepassada: { lancamentoId: string; valor: number; repasseId: string; repasse: string; pagoEm: string }[];
    /** O que o proprietário teria pela política (retenção) e deixa de receber (exceção / SCL cancela). */
    perdaDoProprietario: number;
    /** Ajustes (M4.5) ligados à reserva: não são mexidos. */
    ajustes: { id: string; descricao: string; valor: number }[];
  };
  leitura: { em: Date | null; situacao: SituacaoPagamento; devolvidoLido: number; emAndamento: boolean };
  /**
   * M8.2d: a devolução de cada pagamento da reserva com saldo (o que a confirmou e as diferenças), a rota dela, as
   * devoluções de alteração que ela absorve (nunca chegaram ao Mercado Pago) e o reconhecido devolvido fora pelo painel.
   */
  pagamentos?: { pagamentoId: string; forma: "pix" | "cartao"; valor: number; rota: Exclude<RotaDevolucao, "nenhuma">; substitui: string[]; foraReconhecido: number }[];
  descartados: { em: Date; canal: CanalPedidoCancelamento | null; por: string | null; motivo: string }[];
  avisos: string[];
  assinatura: string;
  /** O texto do BotaoConfirmar. */
  pergunta: string;
};

/**
 * O que a equipe pode escolher onde a política não decide: a exceção (devolver tudo quando a política não dá nada) ou,
 * sem política aceita, devolver tudo ou não devolver; null = nada a escolher (a política dá o integral).
 */
export type EscolhaDaEquipe = "excecao" | "sem_politica";
export const escolhaDaEquipe = (calculado: DecisaoPolitica["calculado"]): EscolhaDaEquipe | null =>
  calculado === "sem_politica" ? "sem_politica" : calculado === "nenhum" ? "excecao" : null;

/**
 * Uma recusa. `escolha` vem nas recusas de depois da decisão pela política (a tela oferece a exceção, ou a escolha sem
 * política, também quando a recusa chega antes de uma prévia: saída antecipada, pagamento já devolvido no painel do
 * Mercado Pago); sem ela, a recusa veio antes de decidir.
 */
/** Um pagamento da reserva com parte devolvida pelo painel do Mercado Pago sem a leitura dizer quanto (D17): a equipe informa o valor dele. */
export type PagamentoSemValorFora = { pagamentoId: string; rotulo: string };
type Recusa = { ok: false; codigo: CodigoRecusaCancelamento; erro: string; escolha?: EscolhaDaEquipe | null; foraSemValor?: PagamentoSemValorFora[] };
const recusa = (codigo: CodigoRecusaCancelamento, erro: string): Recusa => ({ ok: false, codigo, erro });

export const TEXTO_PREVIA_MUDOU = "O cálculo mudou desde a prévia (pagamento, pedido, repasse ou leitura do Mercado Pago mudaram): calcule de novo antes de cancelar.";
export const TEXTO_OCUPADO = "Muitas mudanças nesta reserva agora: tente de novo em instantes.";
export const TEXTO_SEM_LEITURA = "Não deu para conferir o pagamento no Mercado Pago agora: tente de novo em instantes.";
/** Depois do TEXTO_SEM_LEITURA: com um pedido registrado, o horário dele fica; digitado só no formulário, nada foi guardado. */
const SEM_LEITURA_PEDIDO_REGISTRADO = " O horário do pedido já está registrado e não muda.";
const SEM_LEITURA_PEDIDO_NAO_GUARDADO = ' O horário do pedido ainda não está guardado: registre o pedido ("Registrar pedido de cancelamento") para ele não se perder.';
export const TEXTO_EMPRESA_SEMPRE_INTEGRAL = "Quando a SCL cancela, o hóspede recebe o valor integral pago (com ou sem a política aceita): a equipe não decide outra coisa.";
export const TEXTO_SEM_POLITICA = "Este pagamento foi feito sem o aceite das páginas legais (antes de 9/10): o sistema não calcula a devolução. Escolha o que fazer e escreva o motivo.";
export const TEXTO_INTEGRAL_NAO_SE_NEGA = "Pela política aceita, o hóspede tem direito ao valor integral: a equipe não decide outra coisa.";
export const TEXTO_DEVOLVIDO_EM_PARTE =
  "O Mercado Pago mostra uma devolução em andamento ou uma situação que o sistema não reconhece neste pagamento: o cancelamento espera isso se resolver. Confira no painel do Mercado Pago e use Conferir agora.";
export const TEXTO_DEVOLUCAO_EM_VOO = "Há uma devolução desta reserva esperando o Mercado Pago: espere ela ser confirmada (use Conferir agora) antes de cancelar.";
export const TEXTO_DEVOLUCAO_A_MENOR =
  "O Mercado Pago devolveu menos do que foi pedido numa devolução desta reserva: peça o restante ao Mercado Pago ou registre o restante por fora antes de cancelar.";
export const TEXTO_FORA_SEM_VALOR =
  "O Mercado Pago mostra parte deste pagamento devolvida pelo painel, sem informar quanto: informe o valor que aparece no painel do Mercado Pago (de cada pagamento pedido) antes de cancelar.";
export const TEXTO_ALTERACAO_EM_ANDAMENTO =
  "Há uma alteração desta reserva com o pagamento da diferença em andamento: espere o pagamento terminar ou desista da alteração antes de cancelar.";
/**
 * Disputa do pagamento em curso (M8.2e): o cancelamento pela política espera o resultado. Registro de decisão (11/10/2026):
 * antes, "Pagamento contestado no Mercado Pago: o cancelamento espera a contestação (M8.2e)."; agora o texto do desenho,
 * que aponta o pedido do hóspede (vale pelo horário em que chegou) e a ação "Cancelar a reserva contestada".
 */
export const TEXTO_CONTESTADO = TEXTO_DISPUTA_EM_CURSO_CANCELAMENTO;
/** Disputa perdida (M8.2e): o valor já voltou ao hóspede por ela; não se cancela pela política (recusa `contestacao_perdida`). */
export const TEXTO_CONTESTADO_PERDIDA = TEXTO_CONTESTACAO_PERDIDA;
export const TEXTO_MOMENTO = "Informe quando o pedido chegou (não pode ser no futuro nem antes do pagamento).";

/** A base da decisão, em palavras (painel; nunca vai ao hóspede assim). */
export const NOMES_BASE_CANCELAMENTO: Record<BaseCancelamento, string> = {
  prazo: "pedido dentro do prazo de reembolso integral",
  arrependimento: `direito de arrependimento (${DIAS_ARREPENDIMENTO} dias)`,
  empresa: "a SCL cancela",
  excecao: "exceção",
  sem_politica: "pagamento sem a política aceita",
  fora_do_prazo: "pedido depois do prazo de reembolso integral",
  estadia_iniciada: "pedido depois do início da estadia",
  nao_comparecimento: "não comparecimento",
  contestacao: "disputa do pagamento (cancelada sem devolução pelo sistema)",
};
export const NOMES_CANAL_PEDIDO: Record<CanalPedidoCancelamento, string> = { site: "pelo hóspede, no site", whatsapp: "WhatsApp", email: "E-mail", telefone: "Telefone", presencial: "Pessoalmente", outro: "Outro" };
export const NOMES_MOTIVO_EXCECAO: Record<MotivoExcecao, string> = { erro_da_scl: "Erro da SCL", forca_maior: "Força maior", cortesia_comercial: "Cortesia comercial", saude_ou_familia: "Saúde ou família", outro: "Outro" };
export const NOMES_MOTIVO_EMPRESA: Record<MotivoCancelamentoEmpresa, string> = { imovel_sem_condicoes: "o apartamento ficou sem condições de receber o hóspede", forca_maior: "força maior", outro: "outro motivo" };

const LIMITE_NOTA = 300;
/** Folga do relógio para o momento do pedido informado à mão (o formulário manda só a hora e o minuto). */
const FOLGA_MOMENTO_MS = 59_000;
/** Um pedido registrado mais de 48 h depois de chegar pede conferência. */
const REGISTRO_TARDIO_MS = 48 * 3_600_000;

/** "dd/mm" e "dd/mm às HH:MM" no fuso (padrão: São Paulo, o fuso do pagamento): as escritas únicas de lib/datas. */
export { diaBr, diaHoraBr };
const dataIsoBr = diaMesBr;
const minuto = (d: Date) => Math.floor(d.getTime() / 60_000);
const emVigor = () => and(isNull(lancamentos.estornoDe), sql`not exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`);

/**
 * O pagamento que confirmou a reserva (desfecho "reserva") e a cotação dele, e todos os pagamentos com o dinheiro da
 * reserva (M8.2d: também as diferenças de alteração): uma leitura, sem trava.
 */
async function localizar(db: Db, organizacaoId: string, reservaId: string) {
  if (!uuidValido(reservaId)) return null;
  const [r] = await db.select({ id: reservas.id, estado: reservas.estado }).from(reservas).where(and(eq(reservas.id, reservaId), eq(reservas.organizacaoId, organizacaoId)));
  if (!r) return null;
  const daReserva = await db
    .select({ id: pagamentos.id, cotacaoId: pagamentos.cotacaoId, idProvedor: pagamentos.idProvedor, criadoEm: pagamentos.criadoEm, desfecho: pagamentos.desfecho })
    .from(pagamentos)
    .where(and(eq(pagamentos.reservaId, r.id), eq(pagamentos.organizacaoId, organizacaoId), inArray(pagamentos.desfecho, ["reserva", "alteracao"])));
  const p = daReserva.find((x) => x.desfecho === "reserva");
  return { reserva: r, pagamento: p ?? null, pagamentos: daReserva };
}

const NAO_PAGA = 'Esta reserva não foi paga pelo site: cancele pelo botão "Cancelar reserva" de sempre.';

/**
 * Fase 0 (e a releitura da prévia): lê de novo no Mercado Pago, forçado, cada pagamento da reserva quando ainda dá (dentro
 * do prazo de leitura). true = todo pagamento dentro do prazo teve uma leitura que bateu com a tentativa aplicada agora.
 * Também relê as tentativas em andamento das cotações deles (criando, incerta, pendente; dentro do prazo), sem contar no
 * resultado: o Pix da diferença de uma alteração que venceu pelo prazo (sem chamar o provedor) fica pendente até alguém o
 * ler, e sem esta leitura recusaria o cancelamento e a alteração com um prazo que já acabou.
 */
export async function releituraDosPagamentos(
  db: Db,
  organizacaoId: string,
  ps: readonly { id: string; idProvedor: string | null; criadoEm: Date; cotacaoId?: string }[],
  provedor: ProvedorPagamento | null,
  agora: Date,
): Promise<boolean> {
  let todas = true;
  const inicio = inicioDoPrazoDeReleitura(agora).getTime();
  for (const p of ps) {
    if (p.criadoEm.getTime() < inicio) continue;
    if (!provedor || !p.idProvedor) {
      todas = false;
      continue;
    }
    try {
      const r = await conferirTentativa(db, organizacaoId, p.id, provedor, agora, { forcar: true, origem: "painel" });
      if (!(r.ok && r.aplicada === true)) todas = false;
    } catch {
      todas = false;
    }
  }
  const cotacoes = [...new Set(ps.map((p) => p.cotacaoId).filter((x): x is string => !!x))];
  if (provedor && cotacoes.length) {
    const emAndamento = await db
      .select({ id: pagamentos.id, criadoEm: pagamentos.criadoEm })
      .from(pagamentos)
      .where(and(eq(pagamentos.organizacaoId, organizacaoId), inArray(pagamentos.cotacaoId, cotacoes), inArray(pagamentos.situacao, ["criando", "incerta", "pendente"])));
    for (const x of emAndamento) {
      if (x.criadoEm.getTime() < inicio || ps.some((p) => p.id === x.id)) continue;
      try {
        await conferirTentativa(db, organizacaoId, x.id, provedor, agora, { forcar: true, origem: "painel" });
      } catch {
        // Sem a leitura, vale o que está gravado (a recusa de sempre aponta o pagamento em andamento).
      }
    }
  }
  return todas;
}

/** Nomes dos usuários (para os textos do painel: quem registrou, quem descartou). */
async function nomesDe(db: Db, organizacaoId: string, ids: (string | null)[]): Promise<Map<string, string>> {
  const validos = [...new Set(ids.filter((x): x is string => !!x && uuidValido(x)))];
  if (!validos.length) return new Map();
  const linhas = await db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(and(eq(usuarios.organizacaoId, organizacaoId), inArray(usuarios.id, validos)));
  return new Map(linhas.map((l) => [l.id, l.nome]));
}

/**
 * O instante da entrada da reserva (o horário de entrada do imóvel no dia da entrada, no fuso do imóvel; sem cadastro,
 * 15:00) e a partir de quando o não comparecimento vale (a tolerância de Configurações → Pagamento no site). Uma regra
 * só: a decisão (`montarDecisao`) confere por ela e o formulário da ficha mostra o horário dela. `cadastrado` = o imóvel
 * tem a linha dos detalhes (sem ela, a prévia avisa que vale o padrão).
 */
export async function momentosDaEntrada(
  db: Db,
  organizacaoId: string,
  d: { imovelId: string; checkin: string; fuso: string },
): Promise<{ horaEntrada: string; cadastrado: boolean; entradaEm: Date; naoComparecimentoApos: Date }> {
  const [detalhe] = await db.select({ hora: imoveisDetalhes.checkinAPartirDe }).from(imoveisDetalhes).where(eq(imoveisDetalhes.imovelId, d.imovelId));
  const horaEntrada = horaDeEntrada(detalhe?.hora);
  const entradaEm = instanteLocal(d.checkin, horaEntrada, d.fuso);
  const horas = (await lerConfigPagamentoSite(db, organizacaoId)).naoComparecimentoHoras;
  return { horaEntrada, cadastrado: !!detalhe, entradaEm, naoComparecimentoApos: new Date(entradaEm.getTime() + horas * 3_600_000) };
}

/** A devolução de um pagamento no cancelamento (M8.2d: uma por pagamento da reserva com saldo). */
type Parte = { p: Pagamento; valor: number; rota: Exclude<RotaDevolucao, "nenhuma">; absorver: Devolucao[]; reconhecido: number };

type Montada = {
  t: Travado;
  p: Pagamento;
  /** As devoluções do cancelamento integral, por pagamento (vazio sem devolução). */
  partes: Parte[];
  /** O reconhecido devolvido fora de cada pagamento da reserva (D17), gravado no cancelamento. */
  reconhecidos: Map<string, number>;
  /** A alteração com as datas seguradas, sem pagamento da diferença em andamento: o cancelamento (integral ou não) desiste dela. */
  alteracaoADesistir: Alteracao | null;
  /** O pedido ativo (situação "pedido"), quando há. */
  ativo: Cancelamento | null;
  /** O momento corrigido pelo financeiro (o registrado antes), quando mudou. */
  registradoOriginal: Date | null;
  motivoMomento: string;
  nota: string;
  motivoDecisao: string;
  motivoExcecao: MotivoExcecao | null;
  motivoEmpresa: MotivoCancelamentoEmpresa | null;
  quemCancela: QuemCancela;
  previa: Previa;
};

/**
 * A decisão, com todas as conferências (§5.4.1), a partir do retrato da cotação (travado na fase 1; lido sem trava na
 * prévia). Uma função só para a prévia e o cancelamento: os dois nunca discordam, e a assinatura da prévia é conferida
 * sob as travas.
 */
async function montarDecisao(db: Db, organizacaoId: string, t: Travado, e: EntradaCancelamento, agora: Date, extras: { leituraAplicada: boolean; travar: boolean }): Promise<{ ok: true; m: Montada } | Recusa> {
  const r = t.reserva;
  const fuso = t.imovel.fuso || FUSO_PAGAMENTO;
  // 1. A reserva confirmada (e ainda sem cancelamento decidido).
  if (r.estado === "cancelada" || t.cancelamento?.situacao === "cancelada") {
    const em = t.cancelamento?.canceladaEm ?? r.canceladaEm;
    return recusa("ja_cancelada", `Esta reserva já foi cancelada${em ? ` em ${diaBr(em)}` : ""}.`);
  }
  if (r.estado !== "confirmada") return recusa("nao_encontrada", "Só uma reserva confirmada pode ser cancelada por aqui.");
  // 2. O pagamento que a confirmou (a política é a dele) e todos os do dinheiro da reserva (M8.2d: as diferenças também).
  const p = t.tentativas.find((x) => x.desfecho === "reserva");
  if (!p) return recusa("nao_paga_pelo_site", NAO_PAGA);
  const daReserva = pagamentosDaReserva(t);
  // 3. Uma alteração com as datas seguradas (M8.2d): com o pagamento da diferença em andamento, espera; sem ele, o
  // cancelamento desiste dela (com ou sem devolução: a reserva cancelada não muda mais de datas, e as novas noites voltam
  // à venda na hora, sem esperar o prazo delas vencer).
  const inicioLeitura = inicioDoPrazoDeReleitura(agora).getTime();
  const carencia = carenciaNoTravado(t, agora);
  const segurada = t.alteracoes.find((a) => situacaoEfetiva(a, agora, carencia(a)) === "segurada") ?? null;
  if (segurada && t.tentativas.some((x) => x.alteracaoId === segurada.id && ((emAndamento(x.situacao) && x.criadoEm.getTime() >= inicioLeitura) || (x.forma === "cartao" && x.situacao === "pendente" && x.etapaCartao === "analise"))))
    return recusa("ha_alteracao", TEXTO_ALTERACAO_EM_ANDAMENTO);
  // Tentativa sem resposta dentro do prazo de leitura: espera. Fora dele, só o aviso da prévia.
  const andando = t.tentativas.find((x) => emAndamento(x.situacao) && x.criadoEm.getTime() >= inicioLeitura);
  if (andando) return recusa("em_andamento", avisoDoPagamento({ id: andando.id, forma: andando.forma, situacao: andando.situacao, pixExpiraEm: andando.pixExpiraEm, desfecho: andando.desfecho }, fuso, "cancelar"));
  const andandoAntiga = t.tentativas.some((x) => emAndamento(x.situacao) && x.criadoEm.getTime() < inicioLeitura);
  // 4. O que o Mercado Pago mostra de cada pagamento (pela leitura gravada) e as devoluções dele. M8.2e: a disputa de
  // qualquer pagamento da reserva (uma regra, um lugar: `disputaDoPagamento`, de qualquer origem — também o MED registrado
  // num Pix aprovado e o caso tardio só da Chargebacks API): em curso, espera o resultado; perdida, recusa própria.
  const disputas = daReserva.map((x) => disputaDoPagamento(t, x.id));
  if (disputas.includes("em_curso")) return recusa("contestado", TEXTO_CONTESTADO);
  if (disputas.includes("perdida")) return recusa("contestacao_perdida", TEXTO_CONTESTADO_PERDIDA);
  if (daReserva.some((x) => x.situacao === "contestado")) return recusa("contestado", TEXTO_CONTESTADO);
  for (const x of daReserva) {
    const devs = devolucoesDoPagamento(t, x.id);
    if (devs.some(chaveEmVoo)) return recusa("em_andamento", TEXTO_DEVOLUCAO_EM_VOO);
    if (devs.some((d) => d.avisos.includes("devolucao_a_menor") && !devs.some((y) => y.origemDevolucaoId === d.id))) return recusa("devolucao_a_menor", TEXTO_DEVOLUCAO_A_MENOR);
  }
  const emParte = daReserva.some((x) => x.devolucaoEmAndamentoLida || x.avisos.includes("situacao_desconhecida") || (x.situacao !== "aprovado" && x.situacao !== "devolvido" && x.situacao !== "devolvido_parcial"));
  if (emParte) return recusa("devolvido_em_parte", TEXTO_DEVOLVIDO_EM_PARTE);
  // D17: o devolvido pelo painel do Mercado Pago fora do sistema fica reconhecido no cancelamento (da leitura, ou do valor
  // que a equipe informa quando a leitura não diz quanto).
  // Cada pagamento com o seu valor (depois de um aumento, a reserva tem mais de um): faltando algum, a recusa diz quais.
  const reconhecidos = new Map<string, number>();
  const semValor: Pagamento[] = [];
  for (const x of daReserva) {
    const devs = devolucoesDoPagamento(t, x.id);
    if (x.situacao === "devolvido" || !devolucaoInexplicada(x, devs)) {
      reconhecidos.set(x.id, x.devolvidoForaReconhecido);
      continue;
    }
    if (devolvidoForaSemValor(x, devs)) {
      const informado = e.valoresForaInformados && Object.hasOwn(e.valoresForaInformados, x.id) ? e.valoresForaInformados[x.id] : undefined;
      if (informado === undefined) {
        semValor.push(x);
        continue;
      }
      const teto = valorPagoAprovado(x) - comprometidoNoPagamento(devs);
      if (!Number.isSafeInteger(informado) || informado < 1 || informado > teto) return recusa("dados", ERRO_FORA_SEM_VALOR);
      reconhecidos.set(x.id, Math.max(x.devolvidoForaReconhecido, informado));
    } else reconhecidos.set(x.id, Math.max(x.devolvidoForaReconhecido, x.devolvidoLido - devolvidoProprio(devs)));
  }
  if (semValor.length)
    return {
      ...recusa("devolvido_fora_sem_valor", TEXTO_FORA_SEM_VALOR),
      foraSemValor: semValor.map((x) => ({ pagamentoId: x.id, rotulo: `${x.forma === "cartao" ? "Cartão" : "Pix"} de ${diaBr(x.aprovadoEm ?? x.criadoEm, fuso)} (${formatBRL(valorPagoAprovado(x))})` })),
    };
  // 15 (antes do resto: é dado de entrada). Listas fechadas e notas sem dado pessoal.
  const nota = e.nota.trim();
  const motivoDecisao = e.motivoDecisao.trim();
  const motivoMomento = e.motivoMomento.trim();
  for (const n of [nota, motivoDecisao, motivoMomento]) {
    if (n.length > LIMITE_NOTA) return recusa("dados", `Cada nota tem até ${LIMITE_NOTA} caracteres.`);
    if (textoSemDadosPessoais(n) === null) return recusa("dados", ERRO_DADOS_PESSOAIS);
  }
  if (!(QUEM_CANCELA_RESERVA as readonly string[]).includes(e.quemCancela)) return recusa("dados", "Escolha quem cancela.");
  if (!["politica", "excecao", "integral", "nenhum"].includes(e.decisao)) return recusa("dados", "Escolha a decisão.");
  if (e.canal !== null && !(CANAIS_PEDIDO_CANCELAMENTO as readonly string[]).includes(e.canal)) return recusa("dados", "Escolha como o pedido chegou.");
  if (e.motivoEmpresa !== null && !(MOTIVOS_CANCELAMENTO_EMPRESA as readonly string[]).includes(e.motivoEmpresa)) return recusa("dados", "Escolha o motivo da SCL.");
  if (e.motivoExcecao !== null && !(MOTIVOS_EXCECAO as readonly string[]).includes(e.motivoExcecao)) return recusa("dados", "Escolha o motivo da exceção.");
  // 5. Estadia terminada sem pedido ativo: não se cancela. Com o pedido, vale o momento dele.
  const ativo = t.cancelamento?.situacao === "pedido" ? t.cancelamento : null;
  if (hojeISO(fuso, agora) > r.checkout && !ativo)
    return recusa("estadia_encerrada", "A estadia já terminou e não há pedido de cancelamento registrado: não se cancela; registre um ajuste se precisar.");
  // 6. O momento que a política conta.
  const dentro = (x: Date) => !Number.isNaN(x.getTime()) && x.getTime() >= p.criadoEm.getTime() && x.getTime() <= agora.getTime() + FOLGA_MOMENTO_MS;
  let recebidoEm: Date;
  let canal: CanalPedidoCancelamento | null;
  let registradoOriginal: Date | null = null;
  if (e.quemCancela !== "hospede") {
    // A SCL cancela ou não comparecimento: o momento é agora (o pedido do hóspede, se houver, fica gravado como chegou).
    recebidoEm = agora;
    canal = ativo?.canal ?? null;
  } else if (ativo?.canal === "site") {
    // Pedido feito pelo hóspede em Minha reserva: horário do servidor, travado.
    recebidoEm = ativo.pedidoRecebidoEm;
    canal = "site";
  } else if (ativo) {
    canal = e.canal && e.canal !== "site" ? e.canal : ativo.canal;
    const registrado = ativo.pedidoRecebidoEm;
    if (e.recebidoEm && minuto(e.recebidoEm) !== minuto(registrado)) {
      if (!motivoMomento) return recusa("dados", "Escreva por que o horário do pedido foi corrigido (obrigatório, sem dados pessoais).");
      if (!dentro(e.recebidoEm)) return recusa("dados", TEXTO_MOMENTO);
      recebidoEm = e.recebidoEm;
      registradoOriginal = registrado;
    } else recebidoEm = registrado;
  } else {
    if (!e.recebidoEm || !dentro(e.recebidoEm)) return recusa("dados", TEXTO_MOMENTO);
    if (!e.canal || e.canal === "site") return recusa("dados", "Informe como o pedido chegou (WhatsApp, e-mail, telefone, pessoalmente ou outro).");
    recebidoEm = e.recebidoEm;
    canal = e.canal;
  }
  // O horário de entrada do imóvel (sem cadastro, o padrão), a tolerância do não comparecimento e a política aceita no pagamento.
  const entrada = await momentosDaEntrada(db, organizacaoId, { imovelId: t.imovel.id, checkin: r.checkin, fuso });
  const { horaEntrada, entradaEm } = entrada;
  // 7. Não comparecimento: nunca com um pedido ativo (vale o pedido), e só depois da tolerância editável.
  if (e.quemCancela === "nao_comparecimento") {
    if (ativo) return recusa("ha_pedido", `Há um pedido de cancelamento do hóspede recebido em ${diaHoraBr(ativo.pedidoRecebidoEm)}: não é não comparecimento. Cancele como pedido do hóspede (vale o horário do pedido).`);
    if (agora.getTime() < entrada.naoComparecimentoApos.getTime())
      return recusa("cedo_para_nao_comparecimento", `Não comparecimento só depois de ${diaHoraBr(entrada.naoComparecimentoApos, fuso)} (o hóspede pode chegar atrasado e avisar).`);
  }
  // 8. A SCL cancela: o motivo dela.
  if (e.quemCancela === "empresa" && !e.motivoEmpresa) return recusa("dados", "Escolha o motivo da SCL (apartamento sem condições, força maior ou outro).");
  const politica = await politicaDoPagamento(db, organizacaoId, p.id);
  // M8.2d: a base é o que ainda se pode devolver de cada pagamento da reserva, com o reconhecido devolvido fora e sem as
  // devoluções de alteração que nunca chegaram ao Mercado Pago (o cancelamento integral as absorve, D23).
  const absorviveis = (x: Pagamento) =>
    devolucoesDoPagamento(t, x.id).filter((d) => d.origem === "alteracao" && ((d.situacao === "pedida" && d.tentativas === 0) || (d.situacao === "recusada" && !d.chaveEmDuvida && !d.chaveAceita)));
  const saldoDe = (x: Pagamento) => {
    const fora = absorviveis(x).map((d) => d.id);
    return saldoDevolvivel({ ...x, devolvidoForaReconhecido: reconhecidos.get(x.id) ?? x.devolvidoForaReconhecido }, devolucoesDoPagamento(t, x.id).filter((d) => !fora.includes(d.id)));
  };
  const valorPago = daReserva.reduce((soma, x) => soma + Math.max(0, saldoDe(x)), 0);
  // A política conta da entrada que conta (a menor entre a da cotação original e a atual); "a estadia começou", da atual.
  const entradaPolitica = {
    regras: politica?.regras ?? null,
    checkin: entradaQueConta(t.cotacao.checkin, r.checkin, entradasDasAlteracoes(t.alteracoes)),
    entradaAtual: r.checkin,
    horaEntrada,
    fuso,
    aprovadoEm: p.aprovadoEm ?? p.criadoEm,
    pedidoRecebidoEm: recebidoEm,
    valorBase: valorPago,
  };
  const calculada = decidirPelaPolitica({ ...entradaPolitica, quemCancela: e.quemCancela });
  // D5: a SCL cancela → sempre integral, também num pagamento sem a política aceita (a escolha "sem política" é só do
  // pedido do hóspede; a SCL nunca fica com o dinheiro de uma reserva que ela mesma cancelou).
  const decisao: DecisaoPolitica =
    e.quemCancela === "empresa" && calculada.calculado === "sem_politica" ? { ...calculada, calculado: "integral", base: "empresa", valorADevolver: valorPago } : calculada;
  // Daqui em diante, toda recusa diz o que a equipe pode escolher (a tela oferece a exceção mesmo sem prévia).
  const escolha = escolhaDaEquipe(decisao.calculado);
  const recusaDecidida = (codigo: CodigoRecusaCancelamento, erro: string): Recusa => ({ ...recusa(codigo, erro), escolha });
  // 9. A decisão final: só onde a política não decide.
  let direito: "integral" | "nenhum";
  let base: BaseCancelamento;
  if (decisao.calculado === "sem_politica") {
    if ((e.decisao !== "integral" && e.decisao !== "nenhum") || !motivoDecisao) return recusaDecidida("decisao_obrigatoria", TEXTO_SEM_POLITICA);
    direito = e.decisao;
    base = "sem_politica";
  } else if (decisao.calculado === "nenhum") {
    if (e.decisao === "excecao") {
      if (!e.motivoExcecao || !motivoDecisao) return recusaDecidida("dados", "Na exceção, escolha o motivo da lista e escreva a nota (obrigatória, sem dados pessoais).");
      direito = "integral";
      base = "excecao";
    } else if (e.decisao === "politica" || e.decisao === "nenhum") {
      direito = "nenhum";
      base = decisao.base;
    } else return recusaDecidida("dados", "Pela política aceita não há devolução: para devolver tudo, escolha a exceção, com o motivo.");
  } else {
    if (e.decisao !== "politica") return recusaDecidida("integral_nao_se_nega", politica ? TEXTO_INTEGRAL_NAO_SE_NEGA : TEXTO_EMPRESA_SEMPRE_INTEGRAL);
    direito = "integral";
    base = decisao.base;
  }
  // Devolvido por inteiro fora do sistema (painel do Mercado Pago) com "sem devolução": a equipe registra a devolução. O
  // devolvido por inteiro pelas nossas devoluções (a diferença de um aumento devolvida numa redução, M8.2d) não conta: quitado.
  if (daReserva.some((x) => x.situacao === "devolvido" && !devolvidoPeloSistema(x, devolucoesDoPagamento(t, x.id))) && direito === "nenhum")
    return recusaDecidida("decisao_obrigatoria", "O Mercado Pago já mostra este pagamento devolvido por inteiro: registre como devolução integral (pela política ou por exceção, com o motivo).");
  // D17: sem devolução pela política, com dinheiro já devolvido pelo painel do Mercado Pago fora do sistema: nunca suposto.
  const foraDoSistema = daReserva.find((x) => devolucaoInexplicada(x, devolucoesDoPagamento(t, x.id)));
  if (foraDoSistema && direito === "nenhum") {
    const fora = (reconhecidos.get(foraDoSistema.id) ?? 0) || foraDoSistema.devolvidoLido;
    return recusaDecidida(
      "decisao_obrigatoria",
      `O Mercado Pago mostra ${formatBRL(fora)} devolvidos pelo painel, fora do sistema, e a política não dá devolução: decida por exceção (devolução integral) ou registre um ajuste.`,
    );
  }
  // 10. Saída antecipada não é cancelamento (a exceção, com o motivo, continua possível).
  if (e.quemCancela === "hospede" && decisao.comecou && direito === "nenhum")
    return recusaDecidida(
      "estadia_iniciada",
      `O pedido chegou depois do início da estadia (${diaHoraBr(entradaEm, fuso)}): pela política não há devolução e a reserva continua como está (saída antecipada não é cancelamento). Descarte o pedido com o motivo, se for o caso.`,
    );
  // 11. Integral de um pagamento ainda no prazo de leitura: só com a leitura de agora aplicada (de cada um).
  if (direito === "integral" && daReserva.some((x) => x.criadoEm.getTime() >= inicioLeitura) && !extras.leituraAplicada)
    return recusaDecidida("sem_leitura", `${TEXTO_SEM_LEITURA}${ativo ? SEM_LEITURA_PEDIDO_REGISTRADO : e.quemCancela === "hospede" ? SEM_LEITURA_PEDIDO_NAO_GUARDADO : ""}`);
  // 12. Os componentes (sob a trava do motor na fase 1) e a parte num repasse ainda não pago.
  const motor = await lancamentosDoMotor(db, organizacaoId, r.id, { travar: extras.travar });
  const somar = (tipo: string) => motor.ativos.filter((a) => a.tipo === tipo).reduce((s, a) => s + a.valor, 0);
  const comissao = somar("comissao");
  const parteProprietario = somar("direito_proprietario");
  if (direito === "integral") {
    const preso = await repasseAPagarDaReservaDados(db, organizacaoId, r.id);
    if (preso)
      return recusaDecidida(
        "repasse_a_pagar",
        `A parte desta reserva já compõe o repasse ${preso.tipo === "antecipado" ? "antecipado" : preso.tipo === "fechamento" ? "do fechamento" : "por fora"} de ${dataIsoBr(preso.data)}, ainda não pago: estorne esse repasse (o proprietário recebe o resto no próximo) e então cancele. Se ele já foi pago de fato, marque-o como pago antes — a parte paga é descontada no próximo repasse.`,
      );
  }
  const jaRepassada = motor.ativos
    .filter((a) => a.tipo === "direito_proprietario" && a.valor > 0 && (motor.pagos.has(a.id) || a.estado === "realizado" || a.estado === "conciliado"))
    .map((a) => {
      const pago = motor.pagos.get(a.id);
      return { lancamentoId: a.id, valor: a.valor, repasseId: pago?.repasseId ?? "", repasse: pago?.data ?? "", pagoEm: pago?.dataPagamento ?? "" };
    });
  let perdaDoProprietario = 0;
  if (direito === "integral" && base === "excecao") perdaDoProprietario = parteProprietario;
  else if (direito === "integral" && base === "empresa" && politica) {
    // O que o hóspede teria pela política se o pedido fosse dele: o pedido registrado, no horário dele (um pedido no
    // prazo já dava o integral); sem pedido, agora. Sem devolução, o proprietário receberia a parte.
    if (decidirPelaPolitica({ ...entradaPolitica, pedidoRecebidoEm: ativo?.pedidoRecebidoEm ?? recebidoEm, quemCancela: "hospede" }).calculado === "nenhum") perdaDoProprietario = parteProprietario;
  }
  const ajustes = await db
    .select({ id: lancamentos.id, descricao: lancamentos.descricao, valor: lancamentos.valor })
    .from(lancamentos)
    .where(and(eq(lancamentos.organizacaoId, organizacaoId), eq(lancamentos.reservaId, r.id), eq(lancamentos.tipo, "ajuste"), emVigor()))
    .orderBy(asc(lancamentos.criadoEm));
  // 13 e 14. Os valores e a rota de cada devolução (uma por pagamento da reserva com saldo).
  const valorADevolver = direito === "integral" ? valorPago : 0;
  // Retido: o valor de cada pagamento menos o principal das devoluções de alteração decididas (a absorvível continua, sem devolução).
  const retido = daReserva.reduce((soma, x) => {
    const daAlteracao = devolucoesDoPagamento(t, x.id).filter((d) => d.origem === "alteracao");
    return soma + Math.max(0, x.valor - comprometidoNoPagamento(daAlteracao));
  }, 0);
  const valorRetido = direito === "nenhum" ? retido : 0;
  const rotaDe = (x: Pagamento): Exclude<RotaDevolucao, "nenhuma"> =>
    x.situacao === "devolvido" ? "ja_devolvida" : x.criadoEm.getTime() < inicioDoPrazoDePedirDevolucao(agora).getTime() ? "fora_do_prazo" : "pedida";
  const partes: Parte[] =
    direito === "integral"
      ? daReserva
          .map((x) => ({ p: x, valor: Math.max(0, saldoDe(x)), rota: rotaDe(x), absorver: absorviveis(x), reconhecido: reconhecidos.get(x.id) ?? x.devolvidoForaReconhecido }))
          .filter((x) => x.valor > 0)
      : [];
  const rota: RotaDevolucao = direito === "nenhum" ? "nenhuma" : (partes.find((x) => x.p.id === p.id)?.rota ?? partes[0]?.rota ?? rotaDe(p));

  // Pedidos descartados (ficam no histórico) e os nomes de quem registrou e descartou.
  const descartadas = await db
    .select()
    .from(cancelamentosReserva)
    .where(and(eq(cancelamentosReserva.organizacaoId, organizacaoId), eq(cancelamentosReserva.reservaId, r.id), eq(cancelamentosReserva.situacao, "descartado")))
    .orderBy(asc(cancelamentosReserva.criadoEm));
  const nomes = await nomesDe(db, organizacaoId, [ativo?.pedidoPor ?? null, ...descartadas.map((x) => x.descartadoPor)]);
  const descartados = descartadas.map((x) => ({ em: x.pedidoRecebidoEm, canal: x.canal, por: x.descartadoPor ? (nomes.get(x.descartadoPor) ?? null) : null, motivo: x.descarteMotivo, descartadoEm: x.descartadoEm }));

  const regras = politica ? regrasComPadrao(politica.regras) : null;
  const componentes: Previa["componentes"] = { comissao, parteProprietario, taxa: daReserva.length > 1 ? taxaCanalDaReserva(t) : p.taxa, jaRepassada, perdaDoProprietario, ajustes };
  const leitura: Previa["leitura"] = { em: p.consultadoEm, situacao: p.situacao, devolvidoLido: p.devolvidoLido, emAndamento: p.devolucaoEmAndamentoLida };
  const descontoJaRepassado = jaRepassada.reduce((s, x) => s + x.valor, 0);

  // Os avisos da prévia (avisar em vez de supor).
  const avisos: string[] = [];
  if (decisao.calculado === "sem_politica") avisos.push(TEXTO_SEM_POLITICA);
  if (fuso !== FUSO_PAGAMENTO) avisos.push("A política conta no horário de Brasília e este imóvel está em outro fuso: confira as datas.");
  if (!entrada.cadastrado) avisos.push(`Este imóvel não tem horário de entrada cadastrado: vale o padrão ${HORA_ENTRADA_PADRAO}.`);
  if (direito === "nenhum" && p.taxa === null) avisos.push("A taxa do Mercado Pago ainda não foi informada: a divisão usa taxa zero até ele informar (aviso no Início).");
  if (direito === "nenhum" && r.valorBruto !== retido)
    avisos.push(
      `O valor retido (${formatBRL(retido)}, o que o hóspede pagou) é diferente do valor da reserva (${formatBRL(r.valorBruto ?? 0)}): a divisão muda.${motor.movidos.size ? " Como a parte já foi repassada, a reserva fica em conferência para um ajuste manual." : ""}`,
    );
  for (const x of partes)
    for (const d of x.absorver)
      avisos.push(`Inclui a devolução da alteração de ${diaBr(d.criadoEm)} ainda não pedida ao Mercado Pago (${formatBRL(d.valor)}): ela passa a fazer parte da devolução do cancelamento.`);
  for (const x of partes)
    if (x.reconhecido > x.p.devolvidoForaReconhecido || x.reconhecido > 0)
      avisos.push(`O Mercado Pago já mostra ${formatBRL(x.reconhecido)} devolvidos pelo painel dele neste pagamento: a devolução do cancelamento é do restante (${formatBRL(x.valor)}).`);
  if (segurada) avisos.push(`A alteração preparada em ${diaBr(segurada.criadoEm)} (datas seguradas) é desfeita pelo cancelamento: as novas datas voltam à venda.`);
  if (direito === "integral" && perdaDoProprietario > 0)
    avisos.push(
      `O proprietário deixa de receber ${formatBRL(perdaDoProprietario)} que receberia pela política (sem devolução, o valor seria dividido normalmente).${descontoJaRepassado > 0 ? ` ${formatBRL(descontoJaRepassado)} já repassados serão descontados no próximo repasse dele.` : ""}`,
    );
  if (ajustes.length)
    avisos.push(`Esta reserva tem ${ajustes.length} ajuste(s) manual(is) (${formatBRL(ajustes.reduce((s, a) => s + a.valor, 0))}): o cancelamento não mexe neles. Revise depois.`);
  if (rota === "fora_do_prazo")
    avisos.push(
      "O pagamento tem mais de 78 dias: o sistema não pede mais a devolução ao Mercado Pago (não daria tempo de conferir). Depois de cancelar, devolva pelo painel do Mercado Pago (cartão) e confirme aqui, ou faça a devolução por fora (Pix).",
    );
  const idadeMs = agora.getTime() - (p.aprovadoEm ?? p.criadoEm).getTime();
  if (direito === "integral" && p.forma === "pix" && idadeMs > 90 * 86_400_000)
    avisos.push("Pix com mais de 90 dias: pela regra do Banco Central, o Mercado Pago pode não conseguir devolver; a devolução por fora (Pix da conta da empresa) fica liberada.");
  if (direito === "integral" && p.forma === "cartao" && idadeMs > PRAZO_DEVOLUCAO_CARTAO_DIAS * 86_400_000) avisos.push("Cartão com mais de 180 dias: o Mercado Pago não devolve mais; a devolução será por fora.");
  if (direito === "integral" && rota === "pedida" && p.forma === "cartao" && !p.liberacaoConfirmadaEm)
    avisos.push("Cartão ainda não liberado pelo Mercado Pago: a devolução pode precisar de saldo disponível na conta do Mercado Pago.");
  if (direito === "integral")
    for (const x of jaRepassada)
      avisos.push(
        x.repasseId
          ? `${formatBRL(x.valor)} da parte do proprietário já foram repassados (repasse de ${dataIsoBr(x.repasse)}, pago em ${dataIsoBr(x.pagoEm)}): o cancelamento lança agora o desconto, que sai do próximo repasse dele.`
          : `${formatBRL(x.valor)} da parte do proprietário já foram pagos: o cancelamento lança agora o desconto, que sai do próximo repasse dele.`,
      );
  if (ativo && ativo.canal !== "site" && ativo.criadoEm.getTime() - ativo.pedidoRecebidoEm.getTime() > REGISTRO_TARDIO_MS)
    avisos.push("O pedido foi registrado mais de dois dias depois de chegar: confira a data e a hora na mensagem do hóspede.");
  if (registradoOriginal && ativo)
    avisos.push(`Momento do pedido corrigido: registrado ${diaHoraBr(registradoOriginal).replace(" às ", " ")} por ${(ativo.pedidoPor && nomes.get(ativo.pedidoPor)) || "a equipe"}; usado ${diaHoraBr(recebidoEm).replace(" às ", " ")} (${motivoMomento}).`);
  for (const x of descartados)
    avisos.push(`Pedido de ${diaHoraBr(x.em)} (${x.canal ? NOMES_CANAL_PEDIDO[x.canal] : "sem canal"}) descartado por ${x.por ?? "a equipe"}${x.descartadoEm ? ` em ${diaBr(x.descartadoEm)}` : ""}: ${x.motivo}`);
  if (descartados.some((x) => x.canal === "site" && x.em.getTime() < recebidoEm.getTime()))
    avisos.push(`Há um pedido pelo site de ${diaHoraBr(descartados.filter((x) => x.canal === "site").at(-1)!.em)} descartado como desistência: confira antes de usar um horário posterior.`);
  if (andandoAntiga) avisos.push("Há uma tentativa de pagamento sem resposta há mais de 85 dias: confira no painel do Mercado Pago que ela não foi aprovada.");
  avisos.push(leitura.em ? `Leitura do Mercado Pago de ${diaHoraBr(leitura.em)}: ${NOMES_SITUACAO_PAGAMENTO[leitura.situacao].toLowerCase()}.` : "Ainda sem leitura do Mercado Pago deste pagamento.");

  const assinatura = createHash("sha1")
    .update(
      JSON.stringify([
        direito,
        base,
        rota,
        valorPago,
        valorADevolver,
        valorRetido,
        politica?.versao ?? null,
        // A SCL ou o não comparecimento contam "agora": o minuto muda entre a prévia e o clique sem mudar a decisão.
        e.quemCancela === "hospede" ? minuto(recebidoEm) : null,
        e.quemCancela,
        e.decisao,
        e.motivoExcecao,
        comissao,
        parteProprietario,
        p.taxa,
        jaRepassada.map((x) => [x.lancamentoId, x.valor, x.repasseId, x.pagoEm]),
        leitura.situacao,
        leitura.devolvidoLido,
        leitura.emAndamento,
        // O pedido ativo e os descartados: um pedido registrado ou descartado entre a prévia e o clique muda a prévia
        // (sem isto, o descarte de um pedido da equipe com o mesmo minuto e canal passaria como pedido novo).
        ativo?.id ?? null,
        descartadas.map((x) => x.id),
        // M8.2d: cada pagamento da reserva (leitura, devoluções) e as partes da devolução.
        daReserva.map((x) => [x.id, x.situacao, x.devolvidoLido, x.devolucaoEmAndamentoLida, x.devolvidoForaReconhecido, comprometidoNoPagamento(devolucoesDoPagamento(t, x.id))]),
        partes.map((x) => [x.p.id, x.valor, x.rota, x.absorver.map((d) => d.id), x.reconhecido]),
        segurada?.id ?? null,
      ]),
    )
    .digest("hex")
    .slice(0, 16);

  const previa: Previa = {
    decisao,
    direito,
    base,
    rota,
    valorPago,
    valorADevolver,
    valorRetido,
    recebidoEm,
    canal,
    politica: politica && regras ? { versao: politica.versao, data: politica.data, diasReembolsoIntegral: regras.diasReembolsoIntegral, arrependimentoAteEntrada: regras.arrependimentoAteEntrada } : null,
    componentes,
    leitura,
    descartados: descartados.map(({ em, canal: c, por, motivo }) => ({ em, canal: c, por, motivo })),
    pagamentos: partes.map((x) => ({ pagamentoId: x.p.id, forma: x.p.forma, valor: x.valor, rota: x.rota, substitui: x.absorver.map((d) => d.id), foraReconhecido: x.reconhecido })),
    avisos,
    assinatura,
    pergunta: perguntaDoCancelamento({ codigo: r.codigo, checkin: r.checkin, direito, base, rota, valorADevolver, valorRetido: retido, comissao, parteProprietario, perdaDoProprietario, descontoJaRepassado, quemCancela: e.quemCancela }),
  };
  return {
    ok: true,
    m: { t, p, partes, reconhecidos, alteracaoADesistir: segurada, ativo, registradoOriginal, motivoMomento, nota, motivoDecisao, motivoExcecao: base === "excecao" ? e.motivoExcecao : null, motivoEmpresa: e.quemCancela === "empresa" ? e.motivoEmpresa : null, quemCancela: e.quemCancela, previa },
  };
}

/** O texto do BotaoConfirmar do cancelamento (§9.2): o valor, a base, a rota e a perda do proprietário. */
export function perguntaDoCancelamento(x: {
  codigo: string;
  checkin: string;
  direito: "integral" | "nenhum";
  base: BaseCancelamento;
  rota: RotaDevolucao;
  valorADevolver: number;
  valorRetido: number;
  comissao: number;
  parteProprietario: number;
  perdaDoProprietario: number;
  descontoJaRepassado: number;
  quemCancela: QuemCancela;
}): string {
  const prefixo = x.quemCancela === "nao_comparecimento" ? "Confirme que o hóspede não chegou e não avisou de atraso. " : "";
  const base = NOMES_BASE_CANCELAMENTO[x.base];
  if (x.direito === "nenhum")
    return `${prefixo}Cancelar a reserva ${x.codigo} sem devolução? Base: ${base}. O valor pago (${formatBRL(x.valorRetido)}) fica retido e é dividido como uma reserva normal: a parte do proprietário fica disponível depois da data de entrada original (${dataIsoBr(x.checkin)}) e da liberação do Mercado Pago. As datas voltam à venda no site; nas OTAs, siga o aviso do Início (no Beds24, mude para Cancelado; não apague). O cancelamento não pode ser desfeito.`;
  const como = x.rota === "pedida" ? " pelo Mercado Pago" : x.rota === "fora_do_prazo" ? " — a devolução sai pelo painel do Mercado Pago ou por fora" : x.rota === "ja_devolvida" ? " — o Mercado Pago já devolveu" : "";
  return [
    `${prefixo}Cancelar a reserva ${x.codigo} e devolver ao hóspede ${formatBRL(x.valorADevolver)} (o valor integral pago)${como}?`,
    `Base: ${base}.`,
    `A parte do proprietário (${formatBRL(x.parteProprietario)}) e a comissão (${formatBRL(x.comissao)}) saem do financeiro; a taxa do Mercado Pago que não voltar fica com a SCL.`,
    ...(x.perdaDoProprietario > 0 ? [`O proprietário deixa de receber ${formatBRL(x.perdaDoProprietario)} que receberia pela política.`] : []),
    ...(x.descontoJaRepassado > 0 ? [`${formatBRL(x.descontoJaRepassado)} já repassados ao proprietário são descontados no próximo repasse dele.`] : []),
    "As datas voltam à venda no site; nas OTAs, siga o aviso do Início (no Beds24, mude para Cancelado; não apague). O cancelamento não pode ser desfeito.",
  ].join(" ");
}

/**
 * A prévia do cancelamento: a mesma releitura da fase 0 (com provedor) e a mesma decisão, sem travar nada. A assinatura
 * dela vai no cancelamento (`cancelarReservaPaga`), que confere tudo de novo sob as travas.
 */
export async function previaDoCancelamento(
  db: Db,
  organizacaoId: string,
  reservaId: string,
  e: EntradaCancelamento,
  provedor: ProvedorPagamento | null,
  agora: Date = new Date(),
): Promise<{ ok: true; previa: Previa } | Recusa> {
  const alvo = await localizar(db, organizacaoId, reservaId);
  if (!alvo) return recusa("nao_encontrada", "Reserva não encontrada.");
  if (!alvo.pagamento) return alvo.reserva.estado === "cancelada" ? recusa("ja_cancelada", "Esta reserva já foi cancelada.") : recusa("nao_paga_pelo_site", NAO_PAGA);
  const leituraAplicada = await releituraDosPagamentos(db, organizacaoId, alvo.pagamentos, provedor, agora);
  const t = await lerCotacaoSemTravar(db, organizacaoId, alvo.pagamento.cotacaoId);
  if (!t) return recusa("nao_encontrada", "Reserva não encontrada.");
  const r = await montarDecisao(db, organizacaoId, t, e, agora, { leituraAplicada, travar: false });
  return r.ok ? { ok: true, previa: r.m.previa } : r;
}

/**
 * Cancela a reserva paga pelo site pela política (as três fases, no topo do arquivo). `assinatura` é obrigatória: a da
 * prévia que a equipe viu; diferente (ou vazia) = `previa_mudou`. Autorização (reserva:editar + financeiro:editar)
 * conferida por quem chama.
 */
export async function cancelarReservaPaga(
  db: Db,
  organizacaoId: string,
  reservaId: string,
  e: EntradaCancelamento,
  autorId: string | null,
  provedor: ProvedorPagamento | null,
  agora: Date,
  assinatura: string,
): Promise<{ ok: true; cancelamentoId: string; direito: "integral" | "nenhum"; devolucao: SituacaoDevolucao | null; devolucoes?: SituacaoDevolucao[] } | Recusa> {
  const alvo = await localizar(db, organizacaoId, reservaId);
  if (!alvo) return recusa("nao_encontrada", "Reserva não encontrada.");
  if (!alvo.pagamento) return alvo.reserva.estado === "cancelada" ? recusa("ja_cancelada", "Esta reserva já foi cancelada.") : recusa("nao_paga_pelo_site", NAO_PAGA);
  // Fase 0: a releitura (sem trava; o provedor nunca é chamado com trava aberta).
  const leituraAplicada = await releituraDosPagamentos(db, organizacaoId, alvo.pagamentos, provedor, agora);
  const cotacaoId = alvo.pagamento.cotacaoId;
  let feito:
    | { ok: true; cancelamentoId: string; direito: "integral" | "nenhum"; devolucaoId: string | null; situacao: SituacaoDevolucao | null; pedidas: string[]; cancelarNoMp: { id: string; idProvedor: string }[] }
    | Recusa;
  try {
    feito = await db.transaction(async (tx) => {
      // Fase 1: travas (cotação → motor) e só então a decisão, sob elas.
      const t = await travarCotacao(tx, organizacaoId, cotacaoId);
      if (!t) return recusa("nao_encontrada", "Reserva não encontrada.");
      await travarMotorDaReserva(tx, organizacaoId, t.reserva.id);
      // M8.2d: a alteração com o prazo das datas (e a carência) vencido vence agora, antes da decisão (sem provedor).
      await expirarSeVencida(tx, organizacaoId, t, agora, autorId);
      const montada = await montarDecisao(tx, organizacaoId, t, e, agora, { leituraAplicada, travar: true });
      if (!montada.ok) return montada;
      const { m } = montada;
      if (!assinatura || assinatura !== m.previa.assinatura) return recusa("previa_mudou", TEXTO_PREVIA_MUDOU);
      return gravarCancelamento(tx, organizacaoId, m, autorId, agora);
    });
  } catch (erro) {
    if (travaOcupada(erro)) return recusa("ocupado", TEXTO_OCUPADO);
    // Outro pedido ou cancelamento da mesma reserva gravado ao mesmo tempo (índice único do ativo).
    if (violouUnicidade(erro, "cancelamentos_reserva_um_ativo")) return recusa("ja_cancelada", "Esta reserva acabou de receber outro pedido ou cancelamento: atualize a página.");
    throw erro;
  }
  if (!feito.ok) return feito;
  // Fase 2: os pedidos ao Mercado Pago, fora da transação (a rotina e o "Conferir agora" retomam se falhar aqui), e o
  // cancelamento no provedor das tentativas da diferença de uma alteração desfeita pelo cancelamento.
  let situacao = feito.situacao;
  const devolucoes: SituacaoDevolucao[] = [];
  if (provedor) {
    for (const id of feito.pedidas) {
      try {
        const s2 = await tentarDevolucao(db, organizacaoId, id, provedor, agora);
        if (id === feito.devolucaoId) situacao = s2 ?? situacao;
        devolucoes.push(s2 ?? "pedida");
      } catch {
        /* fica pedida: a rotina tenta de novo */
        devolucoes.push("pedida");
      }
    }
    if (feito.cancelarNoMp.length) await cancelarNoProvedor(db, organizacaoId, feito.cancelarNoMp, provedor, agora).catch(() => 0);
  }
  return { ok: true, cancelamentoId: feito.cancelamentoId, direito: feito.direito, devolucao: situacao, devolucoes };
}

/** As escritas da fase 1 (§5.4.2, passos 4 a 9), com o retrato `t` sempre atualizado junto. */
async function gravarCancelamento(tx: Db, organizacaoId: string, m: Montada, autorId: string | null, agora: Date) {
  const { t, p, previa } = m;
  const r = t.reserva;
  const politica = previa.politica;
  // 4. O cancelamento (o pedido ativo vira a linha do cancelamento; sem pedido, uma linha nova), com o retrato.
  const comum = {
    situacao: "cancelada" as const,
    quemCancela: m.quemCancela,
    motivoEmpresa: m.motivoEmpresa,
    motivoExcecao: m.motivoExcecao,
    motivoDecisao: m.motivoDecisao,
    nota: m.nota,
    politicaVersao: politica?.versao ?? null,
    diasReembolsoIntegral: politica?.diasReembolsoIntegral ?? null,
    arrependimentoAteEntrada: politica?.arrependimentoAteEntrada ?? null,
    integralAte: previa.decisao.integralAte,
    arrependimentoAte: previa.decisao.arrependimentoAte,
    entradaEm: previa.decisao.entradaEm,
    calculado: previa.decisao.calculado,
    direito: previa.direito,
    base: previa.base,
    valorPago: previa.valorPago,
    valorADevolver: previa.valorADevolver,
    canceladaEm: agora,
    canceladaPor: autorId,
    atualizadoEm: agora,
  };
  let linha: Cancelamento;
  if (m.ativo) {
    [linha] = await tx
      .update(cancelamentosReserva)
      .set({
        ...comum,
        // Pedido da equipe: o canal pode ter sido corrigido; o horário só com o motivo (auditado). O do site nunca muda.
        ...(m.ativo.canal !== "site" && m.quemCancela === "hospede" ? { canal: previa.canal } : {}),
        ...(m.registradoOriginal ? { pedidoRegistradoOriginalEm: m.registradoOriginal, motivoMomento: m.motivoMomento, pedidoRecebidoEm: previa.recebidoEm } : {}),
      })
      .where(eq(cancelamentosReserva.id, m.ativo.id))
      .returning();
  } else {
    [linha] = await tx
      .insert(cancelamentosReserva)
      .values({ organizacaoId, reservaId: r.id, pagamentoId: p.id, pedidoRecebidoEm: previa.recebidoEm, canal: m.quemCancela === "hospede" ? previa.canal : null, pedidoPor: autorId, criadoEm: agora, ...comum })
      .returning();
  }
  t.cancelamento = linha;
  // 5. A reserva cancelada (colunas fora das chaves: a trava NO KEY UPDATE já tomada basta).
  const mudancaReserva = { estado: "cancelada" as const, canceladaEm: agora, confirmadaEm: null, conferenciaResolvidaEm: null, valorRetido: previa.direito === "nenhum" ? previa.valorRetido : null, atualizadoEm: agora };
  await tx.update(reservas).set(mudancaReserva).where(eq(reservas.id, r.id));
  Object.assign(r, mudancaReserva);
  // 6. A cotação (exibição e defesa: uma aprovação tardia de outra tentativa já é "outra tentativa").
  await tx.update(cotacoes).set({ estado: "cancelada", atualizadaEm: agora }).where(eq(cotacoes.id, t.cotacao.id));
  t.cotacao.estado = "cancelada";
  // 7. Auditoria (nunca as notas, nunca nomes).
  await registrarAuditoria(tx, {
    organizacaoId,
    usuarioId: autorId,
    acao: "reserva.cancelar",
    entidade: "reserva",
    entidadeId: r.id,
    mudancas: { estado: ["confirmada", "cancelada"], motivo: [null, "cancelamento pela política (pagamento no site)"], cancelamento: [null, linha.id] },
  });
  await registrarAuditoria(tx, {
    organizacaoId,
    usuarioId: autorId,
    acao: "pagamento.cancelamento",
    entidade: "pagamento",
    entidadeId: p.id,
    mudancas: {
      direito: [null, previa.direito],
      base: [null, previa.base],
      valor: [null, previa.valorADevolver],
      politica: [null, politica ? `v${politica.versao}` : null],
      recebidoEm: [m.registradoOriginal?.toISOString() ?? null, previa.recebidoEm.toISOString()],
    },
  });
  // 8. O resultado, todo agora (o lado do proprietário também).
  await acertarResultado(tx, organizacaoId, t, p, { direito: previa.direito }, autorId, agora);
  // 9. O caixa, pela rota da devolução de cada pagamento da reserva (M8.2d: uma por pagamento com saldo).
  const motivo = `Cancelamento da reserva ${r.codigo} pela política`;
  const pedidas: string[] = [];
  const cancelarNoMp: { id: string; idProvedor: string }[] = [];
  let principal: Devolucao | null = null;
  // A alteração com as datas seguradas e sem pagamento da diferença em andamento é desfeita pelo cancelamento (D23, F18),
  // com devolução ou sem: a reserva cancelada não muda mais de datas.
  if (m.alteracaoADesistir) cancelarNoMp.push(...(await desistirPeloCancelamento(tx, organizacaoId, t, m.alteracaoADesistir, autorId, agora)));
  if (previa.direito === "nenhum") {
    const [c] = await tx.update(cancelamentosReserva).set({ caixaLancadoEm: agora, atualizadoEm: agora }).where(eq(cancelamentosReserva.id, linha.id)).returning();
    Object.assign(linha, c);
  } else {
    for (const parte of m.partes) {
      const x = parte.p;
      // D17: o devolvido pelo painel do Mercado Pago fora do sistema, reconhecido agora (só cresce, auditado).
      if (parte.reconhecido !== x.devolvidoForaReconhecido) {
        await tx.update(pagamentos).set({ devolvidoForaReconhecido: parte.reconhecido, atualizadoEm: agora }).where(eq(pagamentos.id, x.id));
        await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.devolvido_fora_reconhecido", entidade: "pagamento", entidadeId: x.id, mudancas: { devolvidoForaReconhecido: [x.devolvidoForaReconhecido, parte.reconhecido] } });
        x.devolvidoForaReconhecido = parte.reconhecido;
      }
      // D23: a devolução da alteração que nunca chegou ao Mercado Pago passa a fazer parte desta (nunca apagada).
      for (const d of parte.absorver) {
        await tx.update(devolucoesPagamento).set({ situacao: "substituida", proximaTentativaEm: null, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, d.id));
        d.situacao = "substituida";
        d.proximaTentativaEm = null;
        await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.devolucao_substituida", entidade: "pagamento", entidadeId: x.id, mudancas: { devolucao: [d.id, "substituida"], cancelamento: [null, linha.id] } });
      }
      const nova = async (v: Partial<typeof devolucoesPagamento.$inferInsert> & { situacao: SituacaoDevolucao }) => {
        const [d] = await tx
          .insert(devolucoesPagamento)
          .values({ organizacaoId, pagamentoId: x.id, motivo, valor: parte.valor, origem: "cancelamento", cancelamentoId: linha.id, autorId, criadoEm: agora, atualizadoEm: agora, ...v })
          .returning();
        t.devolucoes.push(d);
        return d;
      };
      let d: Devolucao;
      if (parte.rota === "ja_devolvida") {
        // D15: o dinheiro já voltou pelo painel do Mercado Pago. O dia do caixa é o da primeira leitura que viu "devolvido".
        const auditoria = x.devolvidoVistoEm ? null : await auditoriaDoDevolvido(tx, organizacaoId, x.id);
        const fato = fatoDoDevolvidoNoPainel(x, auditoria, agora);
        const proprio = devolvidoProprio(devolucoesDoPagamento(t, x.id));
        const lido = x.devolvidoLido - proprio - parte.reconhecido;
        d = await nova({ situacao: "confirmada", confirmadaEm: x.devolvidoVistoEm ?? auditoria ?? agora, confirmadaPor: "leitura", valorConfirmado: lido > 0 ? lido : null });
        const caixa = await acertarCaixaDaDevolucao(tx, organizacaoId, t, x, d, fato, agora, autorId);
        await trocarAvisosDaDevolucao(tx, d, { ligar: [...(fato.aviso ? [fato.aviso] : []), ...caixa.avisos] }, agora);
      } else if (parte.rota === "fora_do_prazo") {
        // D12: nenhuma chamada ao Mercado Pago (não daria tempo de conferir); a equipe devolve pelo painel dele ou por fora.
        d = await nova({ situacao: "recusada", falhas: 0, proximaTentativaEm: null, avisos: ["devolucao_fora_do_prazo"] });
      } else {
        d = await nova({ situacao: "pedida", proximaTentativaEm: agora });
        pedidas.push(d.id);
      }
      // A devolução que a resposta mostra: a do pagamento que confirmou a reserva (no M8.2c, a única), senão a primeira.
      if (x.id === p.id || !principal) principal = d;
      await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.devolver", entidade: "pagamento", entidadeId: x.id, mudancas: { devolucao: [null, d.situacao], valor: [null, parte.valor] } });
    }
    // As devoluções já realizadas que esperavam a liberação para o caixa: a reserva cancelada com devolução integral não
    // recebe mais nada, então se acertam sem lançar (M8.2c: nada entrou, nada sai).
    for (const x of pagamentosDaReserva(t))
      for (const d of devolucoesDoPagamento(t, x.id))
        if (!d.caixaLancadoEm && (d.situacao === "confirmada" || d.situacao === "por_fora") && d.origem !== "sem_reserva") await acertarCaixaDaDevolucao(tx, organizacaoId, t, x, d, { data: hojeISO(FUSO_PAGAMENTO, agora), estado: "realizado", origem: "manual" }, agora, autorId);
  }
  // Os avisos de cada pagamento: os dele mais a união dos das devoluções (o "devolvido por fora" sai quando a devolução nossa o explica).
  for (const x of pagamentosDaReserva(t)) {
    if (!devolucaoInexplicada(x, devolucoesDoPagamento(t, x.id)) && x.avisos.includes("devolvido_por_fora")) {
      const avisos = x.avisos.filter((a) => a !== "devolvido_por_fora") as CodigoAviso[];
      await tx.update(pagamentos).set({ avisos, atualizadoEm: agora }).where(eq(pagamentos.id, x.id));
      x.avisos = avisos;
    }
    await sincronizarAvisosDoPagamento(tx, t, x, agora);
  }
  const fim: Devolucao | null = principal;
  return { ok: true as const, cancelamentoId: linha.id, direito: previa.direito, devolucaoId: fim?.id ?? null, situacao: fim?.situacao ?? null, pedidas, cancelarNoMp };
}

/**
 * O cancelamento desfaz a alteração com as datas seguradas (sem pagamento da diferença em andamento, D23): a
 * alteração fica desistida, a reserva-pedido que segurava as novas noites é cancelada (FOR NO KEY UPDATE, depois do motor
 * da reserva) e as tentativas da diferença ainda pendentes no Mercado Pago voltam para serem canceladas lá depois da
 * transação. Sob as travas de quem chama.
 */
async function desistirPeloCancelamento(tx: Db, organizacaoId: string, t: Travado, a: Alteracao, autorId: string | null, agora: Date): Promise<{ id: string; idProvedor: string }[]> {
  const mudanca = { situacao: "desistida" as const, desistidaEm: agora, desistidaPor: autorId, desistenciaMotivo: "cancelamento da reserva", atualizadoEm: agora };
  await tx.update(alteracoesReserva).set(mudanca).where(eq(alteracoesReserva.id, a.id));
  Object.assign(a, mudanca);
  await cancelarPortador(tx, organizacaoId, a, autorId, agora, "alteração desfeita pelo cancelamento da reserva");
  await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "alteracao.desistir", entidade: "alteracao", entidadeId: a.id, mudancas: { situacao: ["segurada", "desistida"], motivo: [null, "cancelamento da reserva"] } });
  return t.tentativas.filter((x) => x.alteracaoId === a.id && x.situacao === "pendente" && x.idProvedor).map((x) => ({ id: x.id, idProvedor: x.idProvedor! }));
}

// ---------------------------------------------------------------- pedido, descarte, OTAs e "avisado" (§5.4.4)

type Resultado = { ok: true } | { ok: false; erro: string };
const JA_HA_PEDIDO = (em: Date) => `Já há um pedido registrado em ${diaHoraBr(em)}.`;

/** Nota curta (0..300) sem dado pessoal; obrigatória quando pedida. */
function problemaDaNota(nota: string, obrigatoria: boolean): string | null {
  if (obrigatoria && !nota) return "Escreva o motivo (sem dados pessoais).";
  if (nota.length > LIMITE_NOTA) return `A nota tem até ${LIMITE_NOTA} caracteres.`;
  if (textoSemDadosPessoais(nota) === null) return ERRO_DADOS_PESSOAIS;
  return null;
}

/**
 * Registrar um pedido de cancelamento que chegou por outro canal (WhatsApp, e-mail, telefone, pessoalmente…) — reserva:editar.
 * O momento (o que a política conta) entre a criação do pagamento e agora; nota opcional, sem dado pessoal.
 */
export async function registrarPedidoDeCancelamento(
  db: Db,
  organizacaoId: string,
  reservaId: string,
  d: { recebidoEm: Date; canal: Exclude<CanalPedidoCancelamento, "site">; nota: string },
  autorId: string,
  agora: Date = new Date(),
): Promise<Resultado> {
  if (!(CANAIS_PEDIDO_CANCELAMENTO as readonly string[]).includes(d.canal) || (d.canal as string) === "site") return { ok: false, erro: "Escolha como o pedido chegou." };
  const nota = d.nota.trim();
  const problema = problemaDaNota(nota, false);
  if (problema) return { ok: false, erro: problema };
  if (!(d.recebidoEm instanceof Date) || Number.isNaN(d.recebidoEm.getTime())) return { ok: false, erro: TEXTO_MOMENTO };
  const alvo = await localizar(db, organizacaoId, reservaId);
  if (!alvo) return { ok: false, erro: "Reserva não encontrada." };
  if (!alvo.pagamento) return { ok: false, erro: "Esta reserva não foi paga pelo site." };
  const cotacaoId = alvo.pagamento.cotacaoId;
  try {
    return await db.transaction(async (tx) => {
      const t = await travarCotacao(tx, organizacaoId, cotacaoId);
      const p = t?.tentativas.find((x) => x.desfecho === "reserva");
      if (!t || !p) return { ok: false as const, erro: "Reserva não encontrada." };
      if (t.cancelamento?.situacao === "cancelada" || t.reserva.estado === "cancelada") return { ok: false as const, erro: "Esta reserva já foi cancelada." };
      if (t.reserva.estado !== "confirmada") return { ok: false as const, erro: "Só uma reserva confirmada recebe pedido de cancelamento." };
      if (t.cancelamento) return { ok: false as const, erro: JA_HA_PEDIDO(t.cancelamento.pedidoRecebidoEm) };
      if (d.recebidoEm.getTime() < p.criadoEm.getTime() || d.recebidoEm.getTime() > agora.getTime() + FOLGA_MOMENTO_MS) return { ok: false as const, erro: TEXTO_MOMENTO };
      const [linha] = await tx
        .insert(cancelamentosReserva)
        .values({ organizacaoId, reservaId: t.reserva.id, pagamentoId: p.id, situacao: "pedido", pedidoRecebidoEm: d.recebidoEm, canal: d.canal, quemCancela: "hospede", nota, pedidoPor: autorId, criadoEm: agora, atualizadoEm: agora })
        .returning();
      t.cancelamento = linha;
      await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "reserva.cancelamento_pedido", entidade: "reserva", entidadeId: t.reserva.id, mudancas: { canal: [null, d.canal], recebidoEm: [null, d.recebidoEm.toISOString()] } });
      return { ok: true as const };
    });
  } catch (erro) {
    if (travaOcupada(erro)) return { ok: false, erro: TEXTO_OCUPADO };
    if (violouUnicidade(erro, "cancelamentos_reserva_um_ativo")) {
      const [c] = await db.select().from(cancelamentosReserva).where(and(eq(cancelamentosReserva.reservaId, reservaId), inArray(cancelamentosReserva.situacao, ["pedido", "cancelada"])));
      return { ok: false, erro: c ? (c.situacao === "cancelada" ? "Esta reserva já foi cancelada." : JA_HA_PEDIDO(c.pedidoRecebidoEm)) : "Já há um pedido registrado." };
    }
    throw erro;
  }
}

/**
 * Descartar um pedido de cancelamento (nunca apagado: fica no histórico da ficha e da prévia). Pedido feito pelo hóspede
 * no site: só quem tem `financeiro:editar`, e só como desistência do hóspede (por onde e quando ele desistiu). Os outros:
 * reserva:editar (conferido por quem chama).
 */
export async function descartarPedidoDeCancelamento(
  db: Db,
  organizacaoId: string,
  reservaId: string,
  d: { motivo: string; desistencia?: { canal: CanalPedidoCancelamento; em: Date } },
  autor: { id: string; podeFinanceiro: boolean },
  agora: Date = new Date(),
): Promise<Resultado> {
  const motivo = d.motivo.trim();
  const problema = problemaDaNota(motivo, true);
  if (problema) return { ok: false, erro: problema };
  const alvo = await localizar(db, organizacaoId, reservaId);
  if (!alvo?.pagamento) return { ok: false, erro: "Não há pedido de cancelamento aberto nesta reserva." };
  const cotacaoId = alvo.pagamento.cotacaoId;
  try {
    return await db.transaction(async (tx) => {
      const t = await travarCotacao(tx, organizacaoId, cotacaoId);
      const c = t?.cancelamento;
      if (!t || !c || c.situacao !== "pedido") return { ok: false as const, erro: "Não há pedido de cancelamento aberto nesta reserva." };
      let descarteMotivo = motivo;
      let desistencia: { canal: CanalPedidoCancelamento; em: Date } | null = null;
      if (c.canal === "site") {
        if (!autor.podeFinanceiro) return { ok: false as const, erro: "Pedido feito pelo hóspede no site: só quem cuida do financeiro descarta, como desistência do hóspede." };
        const x = d.desistencia;
        const valida =
          !!x &&
          (CANAIS_PEDIDO_CANCELAMENTO as readonly string[]).includes(x.canal) &&
          x.em instanceof Date &&
          !Number.isNaN(x.em.getTime()) &&
          x.em.getTime() >= c.pedidoRecebidoEm.getTime() &&
          x.em.getTime() <= agora.getTime() + FOLGA_MOMENTO_MS;
        if (!valida) return { ok: false as const, erro: "Informe por onde e quando o hóspede desistiu do pedido (depois do pedido e não no futuro)." };
        desistencia = x!;
        descarteMotivo = `O hóspede desistiu do pedido: ${motivo}`.slice(0, LIMITE_NOTA);
      }
      await tx
        .update(cancelamentosReserva)
        .set({ situacao: "descartado", descartadoEm: agora, descartadoPor: autor.id, descarteMotivo, desistenciaCanal: desistencia?.canal ?? null, desistenciaEm: desistencia?.em ?? null, atualizadoEm: agora })
        .where(eq(cancelamentosReserva.id, c.id));
      t.cancelamento = null;
      await registrarAuditoria(tx, {
        organizacaoId,
        usuarioId: autor.id,
        acao: "reserva.cancelamento_descartado",
        entidade: "reserva",
        entidadeId: t.reserva.id,
        mudancas: { situacao: ["pedido", "descartado"], ...(desistencia ? { desistencia: [null, `${desistencia.canal} em ${desistencia.em.toISOString()}`] } : {}) },
      });
      return { ok: true as const };
    });
  } catch (erro) {
    if (travaOcupada(erro)) return { ok: false, erro: TEXTO_OCUPADO };
    throw erro;
  }
}

/**
 * "Datas reabertas nas OTAs" (reserva:editar): uma vez, no cancelamento decidido. O texto do que fazer é da tarefa das OTAs
 * (M8.3b, `beds24/reservas-site-tarefas.ts`); o M8.3c grava a marca sozinho (`por` nulo) quando o cancelamento da reserva
 * criada pelo sistema for conferido.
 */
export async function marcarOtaLiberada(db: Db, organizacaoId: string, reservaId: string, autorId: string | null, agora: Date = new Date()): Promise<Resultado> {
  if (!uuidValido(reservaId)) return { ok: false, erro: "Reserva não encontrada." };
  const [c] = await db
    .select()
    .from(cancelamentosReserva)
    .where(and(eq(cancelamentosReserva.organizacaoId, organizacaoId), eq(cancelamentosReserva.reservaId, reservaId), eq(cancelamentosReserva.situacao, "cancelada")));
  if (!c) return { ok: false, erro: "Esta reserva não tem cancelamento pela política." };
  if (c.otaLiberadaEm) return { ok: false, erro: `As datas já foram marcadas como reabertas em ${diaBr(c.otaLiberadaEm)}.` };
  const [feito] = await db
    .update(cancelamentosReserva)
    .set({ otaLiberadaEm: agora, otaLiberadaPor: autorId, atualizadoEm: agora })
    .where(and(eq(cancelamentosReserva.id, c.id), isNull(cancelamentosReserva.otaLiberadaEm)))
    .returning({ id: cancelamentosReserva.id });
  if (!feito) return { ok: false, erro: "As datas já foram marcadas como reabertas." };
  await registrarAuditoria(db, { organizacaoId, usuarioId: autorId, acao: "reserva.ota_liberada", entidade: "reserva", entidadeId: reservaId, mudancas: { otaLiberadaEm: [null, agora.toISOString()] } });
  return { ok: true };
}

export type MensagemAoHospede = "pedido" | "decisao" | "devolucao";

/** A coluna "quando" de cada mensagem e o que gravar ao marcar (quando e quem). */
const COLUNAS_AVISADO = {
  pedido: { em: cancelamentosReserva.hospedeAvisadoPedidoEm, marca: (em: Date, por: string | null) => ({ hospedeAvisadoPedidoEm: em, hospedeAvisadoPedidoPor: por }) },
  decisao: { em: cancelamentosReserva.hospedeAvisadoDecisaoEm, marca: (em: Date, por: string | null) => ({ hospedeAvisadoDecisaoEm: em, hospedeAvisadoDecisaoPor: por }) },
  devolucao: { em: cancelamentosReserva.hospedeAvisadoDevolucaoEm, marca: (em: Date, por: string | null) => ({ hospedeAvisadoDevolucaoEm: em, hospedeAvisadoDevolucaoPor: por }) },
} as const;

/**
 * Marca uma mensagem ao hóspede como enviada, uma vez (`por` null = o sistema, pelo envio automático do M9.2). Devolve se
 * marcou agora. Usado pelo botão "Mensagem enviada ao hóspede" e pelo envio automático.
 */
export async function marcarAvisado(db: Db, organizacaoId: string, cancelamentoId: string, qual: MensagemAoHospede, por: string | null, agora: Date): Promise<boolean> {
  const col = COLUNAS_AVISADO[qual];
  const [feito] = await db
    .update(cancelamentosReserva)
    .set({ ...col.marca(agora, por), atualizadoEm: agora })
    .where(and(eq(cancelamentosReserva.id, cancelamentoId), eq(cancelamentosReserva.organizacaoId, organizacaoId), isNull(col.em)))
    .returning({ id: cancelamentosReserva.id, reservaId: cancelamentosReserva.reservaId });
  if (feito) await registrarAuditoria(db, { organizacaoId, usuarioId: por, acao: "reserva.hospede_avisado", entidade: "reserva", entidadeId: feito.reservaId, mudancas: { qual: [null, qual] } });
  return Boolean(feito);
}

/**
 * "Mensagem enviada ao hóspede" (reserva:editar): o pedido recebido (pedido ou cancelamento ativo), a decisão (cancelada)
 * ou a devolução feita (confirmada ou por fora). Uma vez por mensagem.
 */
export async function marcarHospedeAvisado(db: Db, organizacaoId: string, reservaId: string, qual: MensagemAoHospede, autorId: string, agora: Date = new Date()): Promise<Resultado> {
  if (!uuidValido(reservaId) || !(qual in COLUNAS_AVISADO)) return { ok: false, erro: "Reserva não encontrada." };
  const [c] = await db
    .select()
    .from(cancelamentosReserva)
    .where(and(eq(cancelamentosReserva.organizacaoId, organizacaoId), eq(cancelamentosReserva.reservaId, reservaId), inArray(cancelamentosReserva.situacao, ["pedido", "cancelada"])));
  if (!c) return { ok: false, erro: "Esta reserva não tem pedido nem cancelamento pela política." };
  if (qual !== "pedido" && c.situacao !== "cancelada") return { ok: false, erro: "O cancelamento ainda não foi decidido." };
  if (qual === "devolucao") {
    // M8.2d: uma devolução por pagamento da reserva; a mensagem é da devolução toda (todas feitas; a substituída não conta).
    const devs = (await db.select({ situacao: devolucoesPagamento.situacao }).from(devolucoesPagamento).where(eq(devolucoesPagamento.cancelamentoId, c.id))).filter((d) => d.situacao !== "substituida");
    if (!devs.length || devs.some((d) => d.situacao !== "confirmada" && d.situacao !== "por_fora")) return { ok: false, erro: "A devolução ainda não foi feita." };
  }
  if (!(await marcarAvisado(db, organizacaoId, c.id, qual, autorId, agora))) return { ok: false, erro: "Esta mensagem já foi marcada como enviada." };
  return { ok: true };
}

// ---------------------------------------------------------------- cancelar a reserva contestada (M8.2e)

export const TEXTO_SEM_DISPUTA_PARA_CANCELAR = "Esta reserva não tem disputa do pagamento aberta com valor em risco: cancele pela política.";
export const TEXTO_CONTESTADA_SO_ANTES_DA_ENTRADA = (entrada: Date, fuso: string) =>
  `Só antes do horário de entrada (${diaHoraBr(entrada, fuso)}): depois dele, a reserva segue e a disputa decide (registre quem arca e o resultado no quadro da disputa).`;
const NOTA_CONTESTADA_OBRIGATORIA = "Escreva por que cancelar a reserva contestada (obrigatória, sem dados pessoais).";

/** O cancelamento é o da rota "Cancelar a reserva contestada" (sem devolução pelo sistema): a página do hóspede mostra "em conferência". */
export const canceladaPelaDisputa = (c: Pick<Cancelamento, "base"> | null | undefined) => c?.base === MOTIVO_CANCELAMENTO_CONTESTACAO;

/** A prévia de "Cancelar a reserva contestada": o pago, o valor retido (o que o motor divide), a pergunta e a assinatura. */
export type PreviaContestada = {
  valorPago: number;
  valorRetido: number;
  /** As disputas não finais da reserva com valor em risco (a razão desta rota). */
  disputas: { contestacaoId: string; pagamentoId: string; valorEmRisco: number }[];
  avisos: string[];
  assinatura: string;
  /** O texto do BotaoConfirmar. */
  pergunta: string;
};

type MontadaContestada = { t: Travado; p: Pagamento; ativo: Cancelamento | null; alteracaoADesistir: Alteracao | null; previa: PreviaContestada };

/**
 * As conferências de "Cancelar a reserva contestada" sobre o retrato da cotação (travado na ação; lido sem trava na
 * prévia): a reserva confirmada e paga pelo site; uma disputa não final, não duplicada e com valor em risco num pagamento
 * da reserva; antes do horário de entrada; e as recusas do M8.2c que não dependem da política (tentativa em andamento,
 * alteração com o pagamento da diferença em andamento, devolução com a chave em voo, parte num repasse ainda a pagar).
 * O valor retido = o pago (o principal) dos pagamentos da reserva menos o devolvido realizado (as devoluções confirmadas ou
 * por fora e o reconhecido devolvido fora).
 */
async function montarContestada(db: Db, organizacaoId: string, t: Travado, agora: Date): Promise<{ ok: true; m: MontadaContestada } | Recusa> {
  const r = t.reserva;
  const fuso = t.imovel.fuso || FUSO_PAGAMENTO;
  if (r.estado === "cancelada" || t.cancelamento?.situacao === "cancelada") {
    const em = t.cancelamento?.canceladaEm ?? r.canceladaEm;
    return recusa("ja_cancelada", `Esta reserva já foi cancelada${em ? ` em ${diaBr(em)}` : ""}.`);
  }
  if (r.estado !== "confirmada") return recusa("nao_encontrada", "Só uma reserva confirmada pode ser cancelada por aqui.");
  const p = t.tentativas.find((x) => x.desfecho === "reserva");
  if (!p) return recusa("nao_paga_pelo_site", NAO_PAGA);
  const daReserva = pagamentosDaReserva(t);
  const disputas = daReserva.flatMap((x) =>
    contestacoesDoPagamento(t, x.id)
      .filter((l) => contestacaoNaoFinal(l.situacao) && !l.duplicataPossivel && l.valorEmRisco > 0)
      .map((l) => ({ contestacaoId: l.id, pagamentoId: x.id, valorEmRisco: l.valorEmRisco })),
  );
  if (!disputas.length) return recusa("sem_disputa", TEXTO_SEM_DISPUTA_PARA_CANCELAR);
  const entrada = await momentosDaEntrada(db, organizacaoId, { imovelId: t.imovel.id, checkin: r.checkin, fuso });
  if (agora.getTime() >= entrada.entradaEm.getTime()) return recusa("estadia_iniciada", TEXTO_CONTESTADA_SO_ANTES_DA_ENTRADA(entrada.entradaEm, fuso));
  const inicioLeitura = inicioDoPrazoDeReleitura(agora).getTime();
  const carencia = carenciaNoTravado(t, agora);
  const segurada = t.alteracoes.find((a) => situacaoEfetiva(a, agora, carencia(a)) === "segurada") ?? null;
  if (segurada && t.tentativas.some((x) => x.alteracaoId === segurada.id && ((emAndamento(x.situacao) && x.criadoEm.getTime() >= inicioLeitura) || (x.forma === "cartao" && x.situacao === "pendente" && x.etapaCartao === "analise"))))
    return recusa("ha_alteracao", TEXTO_ALTERACAO_EM_ANDAMENTO);
  const andando = t.tentativas.find((x) => emAndamento(x.situacao) && x.criadoEm.getTime() >= inicioLeitura);
  if (andando) return recusa("em_andamento", avisoDoPagamento({ id: andando.id, forma: andando.forma, situacao: andando.situacao, pixExpiraEm: andando.pixExpiraEm, desfecho: andando.desfecho }, fuso, "cancelar"));
  for (const x of daReserva) if (devolucoesDoPagamento(t, x.id).some(chaveEmVoo)) return recusa("em_andamento", TEXTO_DEVOLUCAO_EM_VOO);
  const preso = await repasseAPagarDaReservaDados(db, organizacaoId, r.id);
  if (preso)
    return recusa(
      "repasse_a_pagar",
      `A parte desta reserva já compõe o repasse ${preso.tipo === "antecipado" ? "antecipado" : preso.tipo === "fechamento" ? "do fechamento" : "por fora"} de ${dataIsoBr(preso.data)}, ainda não pago: estorne esse repasse (o proprietário recebe o resto no próximo) e então cancele.`,
    );
  // O pago e o retido: o principal de cada pagamento da reserva menos o que já voltou ao hóspede (realizado) e menos o que a
  // reserva ainda deve a ele pela disputa (as devoluções substituídas por uma disputa não final: o acerto do cancelamento ou
  // da alteração já as tirou do resultado, e o dinheiro volta ao hóspede pela disputa, ou volta a ser devido se a SCL
  // ganhar). Nunca mais que o valor da reserva de agora (depois de uma alteração): o resto é do hóspede.
  const realizado = (x: Pagamento) =>
    x.devolvidoForaReconhecido + devolucoesDoPagamento(t, x.id).filter((d) => d.situacao === "confirmada" || d.situacao === "por_fora").reduce((s, d) => s + comprometido(d), 0);
  const naoFinais = new Set(t.contestacoes.filter((l) => contestacaoNaoFinal(l.situacao)).map((l) => l.id));
  const substituido = (x: Pagamento) =>
    devolucoesDoPagamento(t, x.id)
      .filter((d) => d.contestacaoId !== null && naoFinais.has(d.contestacaoId) && (d.situacao === "recusada" || d.situacao === "pedida"))
      .reduce((s, d) => s + d.valor, 0);
  const valorPago = daReserva.reduce((s, x) => s + valorPagoAprovado(x), 0);
  const retidoDosPagamentos = daReserva.reduce((s, x) => s + Math.max(0, x.valor - realizado(x) - substituido(x)), 0);
  const valorRetido = r.valorBruto === null ? retidoDosPagamentos : Math.min(retidoDosPagamentos, Math.max(0, r.valorBruto));
  const ativo = t.cancelamento?.situacao === "pedido" ? t.cancelamento : null;
  const avisos: string[] = [];
  if (segurada) avisos.push(`A alteração preparada em ${diaBr(segurada.criadoEm)} (datas seguradas) é desfeita pelo cancelamento: as novas datas voltam à venda.`);
  if (r.valorBruto !== valorRetido)
    avisos.push(`O valor retido (${formatBRL(valorRetido)}, o que o hóspede pagou menos o que já voltou a ele) é diferente do valor da reserva (${formatBRL(r.valorBruto ?? 0)}): a divisão muda.`);
  if (ativo) avisos.push(`O pedido de cancelamento do hóspede recebido em ${diaHoraBr(ativo.pedidoRecebidoEm)} vira este cancelamento (o horário fica registrado).`);
  const assinatura = createHash("sha1")
    .update(
      JSON.stringify([
        "contestada",
        valorPago,
        valorRetido,
        daReserva.map((x) => [x.id, x.situacao, x.devolvidoForaReconhecido, comprometidoNoPagamento(devolucoesDoPagamento(t, x.id))]),
        disputas.map((d) => [d.contestacaoId, d.valorEmRisco]),
        ativo?.id ?? null,
        segurada?.id ?? null,
      ]),
    )
    .digest("hex")
    .slice(0, 16);
  const pergunta = [
    `Cancelar a reserva ${r.codigo} sem devolução pelo sistema?`,
    `O pagamento está em disputa: o valor pago (${formatBRL(valorRetido)}) fica retido e é dividido como uma reserva cancelada sem devolução; se o hóspede ganhar a disputa, o dinheiro volta a ele por ela (e a decisão de quem arca vale sobre o valor perdido).`,
    "As datas voltam à venda no site; nas OTAs, siga o aviso do Início (no Beds24, mude para Cancelado; não apague). O cancelamento não pode ser desfeito.",
  ].join(" ");
  return { ok: true, m: { t, p, ativo, alteracaoADesistir: segurada, previa: { valorPago, valorRetido, disputas, avisos, assinatura, pergunta } } };
}

/** A prévia de "Cancelar a reserva contestada" (sem trava): as mesmas conferências; a assinatura vai na ação. */
export async function previaDoCancelamentoContestado(db: Db, organizacaoId: string, reservaId: string, agora: Date = new Date()): Promise<{ ok: true; previa: PreviaContestada } | Recusa> {
  const alvo = await localizar(db, organizacaoId, reservaId);
  if (!alvo) return recusa("nao_encontrada", "Reserva não encontrada.");
  if (!alvo.pagamento) return alvo.reserva.estado === "cancelada" ? recusa("ja_cancelada", "Esta reserva já foi cancelada.") : recusa("nao_paga_pelo_site", NAO_PAGA);
  const t = await lerCotacaoSemTravar(db, organizacaoId, alvo.pagamento.cotacaoId);
  if (!t) return recusa("nao_encontrada", "Reserva não encontrada.");
  const m = await montarContestada(db, organizacaoId, t, agora);
  return m.ok ? { ok: true, previa: m.m.previa } : m;
}

/**
 * "Cancelar a reserva contestada (sem devolução pelo sistema)" (★ decisão 6; `reserva:editar` e `financeiro:editar`,
 * conferidos por quem chama; `BotaoConfirmar` com a pergunta da prévia e nota obrigatória). Grava um cancelamento com o
 * motivo `contestacao` (quem cancela: a SCL; base `contestacao`), sem decisão pela política: a reserva fica `cancelada` com
 * `valor_retido` (o pago menos o devolvido realizado) e nenhuma devolução é criada — o dinheiro volta ao titular pela
 * disputa, se ele ganhar. O motor divide o retido como no M8.2c ("Dinheiro retido (sem devolução)"). A tarefa das OTAs
 * (M8.3b: mudar para Cancelado no Beds24, sem apagar) entra no Início sozinha (o cancelamento sem a marca) e a página do
 * hóspede mostra a reserva cancelada "em conferência" (`canceladaPelaDisputa`). A disputa segue igual: perdida, a decisão de quem arca vale
 * sobre o valor perdido; ganha, o banco deu a cobrança por válida e o retido continua dividido como numa reserva cancelada
 * sem devolução. Assinatura da prévia diferente = `previa_mudou`; trava ocupada = `ocupado`.
 */
export async function cancelarReservaContestada(
  db: Db,
  organizacaoId: string,
  reservaId: string,
  e: { nota: string; assinatura: string },
  autorId: string | null,
  provedor: ProvedorPagamento | null,
  agora: Date = new Date(),
): Promise<{ ok: true; cancelamentoId: string; valorRetido: number } | Recusa> {
  const nota = e.nota.trim();
  if (!nota) return recusa("dados", NOTA_CONTESTADA_OBRIGATORIA);
  if (nota.length > LIMITE_NOTA) return recusa("dados", `A nota tem até ${LIMITE_NOTA} caracteres.`);
  if (textoSemDadosPessoais(nota) === null) return recusa("dados", ERRO_DADOS_PESSOAIS);
  const alvo = await localizar(db, organizacaoId, reservaId);
  if (!alvo) return recusa("nao_encontrada", "Reserva não encontrada.");
  if (!alvo.pagamento) return alvo.reserva.estado === "cancelada" ? recusa("ja_cancelada", "Esta reserva já foi cancelada.") : recusa("nao_paga_pelo_site", NAO_PAGA);
  const cotacaoId = alvo.pagamento.cotacaoId;
  let feito: { ok: true; cancelamentoId: string; valorRetido: number; cancelarNoMp: { id: string; idProvedor: string }[] } | Recusa;
  try {
    feito = await db.transaction(async (tx) => {
      const t = await travarCotacao(tx, organizacaoId, cotacaoId);
      if (!t) return recusa("nao_encontrada", "Reserva não encontrada.");
      await travarMotorDaReserva(tx, organizacaoId, t.reserva.id);
      await expirarSeVencida(tx, organizacaoId, t, agora, autorId);
      const montada = await montarContestada(tx, organizacaoId, t, agora);
      if (!montada.ok) return montada;
      const { m } = montada;
      if (!e.assinatura || e.assinatura !== m.previa.assinatura) return recusa("previa_mudou", TEXTO_PREVIA_MUDOU);
      return gravarCancelamentoContestado(tx, organizacaoId, m, nota, autorId, agora);
    });
  } catch (erro) {
    if (travaOcupada(erro)) return recusa("ocupado", TEXTO_OCUPADO);
    if (violouUnicidade(erro, "cancelamentos_reserva_um_ativo")) return recusa("ja_cancelada", "Esta reserva acabou de receber outro pedido ou cancelamento: atualize a página.");
    throw erro;
  }
  if (!feito.ok) return feito;
  // Fora da transação: o cancelamento no provedor das tentativas da diferença de uma alteração desfeita.
  if (provedor && feito.cancelarNoMp.length) await cancelarNoProvedor(db, organizacaoId, feito.cancelarNoMp, provedor, agora).catch(() => 0);
  return { ok: true, cancelamentoId: feito.cancelamentoId, valorRetido: feito.valorRetido };
}

/** As escritas de "Cancelar a reserva contestada", com o retrato sempre atualizado junto. */
async function gravarCancelamentoContestado(tx: Db, organizacaoId: string, m: MontadaContestada, nota: string, autorId: string | null, agora: Date) {
  const { t, p, previa } = m;
  const r = t.reserva;
  const comum = {
    situacao: "cancelada" as const,
    quemCancela: "empresa" as const,
    motivoEmpresa: null,
    motivoExcecao: null,
    motivoDecisao: "",
    nota,
    calculado: null,
    direito: "nenhum" as const,
    base: MOTIVO_CANCELAMENTO_CONTESTACAO as "contestacao",
    valorPago: previa.valorPago,
    valorADevolver: 0,
    canceladaEm: agora,
    canceladaPor: autorId,
    // Sem devolução: o caixa do cancelamento fica acertado (o dinheiro volta ao titular pela disputa, se ele ganhar).
    caixaLancadoEm: agora,
    atualizadoEm: agora,
  };
  let linha: Cancelamento;
  if (m.ativo) [linha] = await tx.update(cancelamentosReserva).set(comum).where(eq(cancelamentosReserva.id, m.ativo.id)).returning();
  else [linha] = await tx.insert(cancelamentosReserva).values({ organizacaoId, reservaId: r.id, pagamentoId: p.id, pedidoRecebidoEm: agora, canal: null, pedidoPor: autorId, criadoEm: agora, ...comum }).returning();
  t.cancelamento = linha;
  const mudancaReserva = { estado: "cancelada" as const, canceladaEm: agora, confirmadaEm: null, conferenciaResolvidaEm: null, valorRetido: previa.valorRetido, atualizadoEm: agora };
  await tx.update(reservas).set(mudancaReserva).where(eq(reservas.id, r.id));
  Object.assign(r, mudancaReserva);
  await tx.update(cotacoes).set({ estado: "cancelada", atualizadaEm: agora }).where(eq(cotacoes.id, t.cotacao.id));
  t.cotacao.estado = "cancelada";
  await registrarAuditoria(tx, {
    organizacaoId,
    usuarioId: autorId,
    acao: "reserva.cancelar",
    entidade: "reserva",
    entidadeId: r.id,
    mudancas: { estado: ["confirmada", "cancelada"], motivo: [null, "cancelamento da reserva contestada (disputa do pagamento, sem devolução pelo sistema)"], cancelamento: [null, linha.id] },
  });
  await registrarAuditoria(tx, {
    organizacaoId,
    usuarioId: autorId,
    acao: "pagamento.cancelamento",
    entidade: "pagamento",
    entidadeId: p.id,
    mudancas: { direito: [null, "nenhum"], base: [null, MOTIVO_CANCELAMENTO_CONTESTACAO], valor: [null, 0], valorRetido: [null, previa.valorRetido] },
  });
  // O resultado: o motor divide o retido como uma reserva normal (o "Dinheiro retido (sem devolução)" do M8.2c).
  await acertarResultado(tx, organizacaoId, t, p, { direito: "nenhum" }, autorId, agora);
  const cancelarNoMp = m.alteracaoADesistir ? await desistirPeloCancelamento(tx, organizacaoId, t, m.alteracaoADesistir, autorId, agora) : [];
  // A linha do tempo de cada disputa que segue aberta e a auditoria da disputa.
  for (const d of previa.disputas)
    await registrarEventoDaContestacao(tx, d.contestacaoId, { fonte: "equipe", tipo: "cancelamento", antes: { reserva: "confirmada" }, depois: { reserva: "cancelada", valorRetido: previa.valorRetido }, usuarioId: autorId }, agora);
  await registrarAuditoria(tx, {
    organizacaoId,
    usuarioId: autorId,
    acao: "contestacao.cancelar_reserva",
    entidade: "pagamento",
    entidadeId: p.id,
    mudancas: { cancelamento: [null, linha.id], valorRetido: [null, previa.valorRetido], contestacoes: [null, previa.disputas.map((d) => d.contestacaoId).join(",")] },
  });
  return { ok: true as const, cancelamentoId: linha.id, valorRetido: previa.valorRetido, cancelarNoMp };
}
