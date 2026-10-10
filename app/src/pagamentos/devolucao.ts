/**
 * Pagamento no site (M8.2a) — devolução do pagamento que ficou sem reserva (design "Devolução na parte (a)"); M8.2c — a
 * devolução do cancelamento pela política (origem `cancelamento`), pelo mesmo motor; M8.2d — várias devoluções por
 * pagamento (a da diferença de uma alteração, origem `alteracao`; o restante de uma que o Mercado Pago devolveu a menos;
 * o restante de um pagamento já devolvido em parte).
 *
 * A equipe escolhe, com confirmação: devolver pelo Mercado Pago ou registrar a devolução feita por fora. Sob a trava da
 * cotação, todo caminho que cria, pede de novo, registra por fora, pede o restante ou confirma um valor confere o teto
 * (D12): o comprometido das outras devoluções mais esta nunca passa do pago menos o reconhecido devolvido fora. No máximo
 * uma devolução `pedida` por pagamento (índice único). Pelo provedor: `pedida` até a leitura da order confirmar; cada
 * pedido novo usa chave nova, gravada antes (com o formato do corpo, D29), e relê a order antes (já devolvida = a leitura
 * confirma; devolução em andamento = não pede de novo). Recusa e resposta incerta contam do mesmo jeito; a terceira só vira
 * "recusada" (aviso) depois de reler a order sem nenhuma devolução NOVA desde o pedido: com ela, continua pedida e a
 * leitura confirma. A resposta "aguarde" (outra devolução em andamento ou espera pedida pelo Mercado Pago) não conta: a
 * chave fica em dúvida e a rotina tenta de novo depois, relendo a order. Pedido ACEITO pelo provedor: nada se envia de
 * novo, só a leitura confirma (pelo id da nossa devolução, pelo valor somado desde o pedido, ou porque completou o
 * pagamento); três leituras sem a devolução viram aviso, e ela continua pedida. Só a leitura que mostra que a NOSSA
 * devolução (o id gravado) falhou a solta (`aplicarLeitura`).
 *
 * Devolução que o sistema não explica (D21): a order mostra mais devolvido do que as nossas devoluções (confirmadas ou
 * possivelmente no provedor) e o reconhecido explicam, ou está contestada — a devolução automática para (aviso; devolver
 * por cima devolveria a mais). Com a chave em dúvida de um pedido de parte do valor e o excesso cabendo nele, não para: o
 * reenvio com a mesma chave deixa o adaptador reconhecer a repetição (resposta perdida, F13).
 *
 * D13: a devolução de parte do valor do dinheiro da reserva (a da alteração, o restante de um cancelamento, o restante de
 * uma a menor) só é pedida ao Mercado Pago depois de ele liberar o pagamento, com a taxa conhecida — conferido antes de
 * qualquer leitura e de novo sob a trava, quando a chave é gravada. Até lá fica pedida com `aguardando_liberacao`, sem
 * chave; passada a data prevista (ou 35 dias da aprovação, sem previsão), aviso. A integral de um pagamento intocado sai
 * como sempre.
 *
 * Por fora: só depois de reler a order no provedor (devolução que o sistema não pediu, em andamento, contestada ou outra
 * situação = recusa), só numa devolução nunca enviada ou recusada sem chave em dúvida (D16), e só o valor que a devolução
 * deve. A taxa que não voltou é derivada do que entrou (a integral de um pagamento, M8.2c), ou a atribuída ao principal
 * devolvido (D19). Pelo Mercado Pago, a taxa que não voltar a equipe informa depois da confirmação ("Registrar taxa que
 * não voltou"): vira despesa da empresa, com a reserva quando o dinheiro é dela.
 *
 * Cartão (M8.2b, regra apertada no M8.2c): devolve-se pelo Mercado Pago (integral = o pago, com os juros quando ele
 * mostra). Por fora, só quando a devolução pelo Mercado Pago não deu de vez (recusa definitiva, a nossa devolução falhou
 * na leitura, ou a equipe registrou a recusa no painel do Mercado Pago) ou o pagamento passou dos 180 dias em que o
 * Mercado Pago ainda devolve: senão a cobrança ficaria no cartão do hóspede e uma contestação devolveria de novo.
 *
 * Pagamento velho (M8.2c, D12): o sistema não pede devolução ao Mercado Pago de um pagamento com mais de 78 dias (não daria
 * tempo de conferir). A equipe devolve pelo painel do Mercado Pago e confirma aqui, registra a recusa do painel, para uma
 * devolução pedida que ficou sem resposta, ou devolve por fora.
 *
 * As ações da equipe recebem a devolução pelo id (`{ devolucaoId }`, resolvida com o filtro da organização) ou, como o
 * quadro de antes do M8.2d, pelo pagamento (`{ pagamentoId }` ou o id em texto: a devolução dele que a ação alcança).
 */
import { and, eq, like, or } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { categoriaDaTaxaPerdida } from "@/configuracoes/pagamento-site";
import { devolucoesPagamento, lancamentos, pagamentos, type SituacaoDevolucao } from "@/db/schema";
import type { Db } from "@/db/types";
import { estornar, lancar, LancamentoInvalido } from "@/financeiro/ledger";
import { ERRO_DADOS_PESSOAIS, textoSemDadosPessoais } from "@/lib/dados-pessoais";
import { hojeISO, instanteLocal } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { formatBRL } from "@/lib/money";
import { dataValida } from "@/reservas/regras";
import { acertarCaixaDaDevolucao, congelarTaxaAtribuida } from "./acerto-cancelamento";
import { inicioDoPrazoDePedirDevolucao, inicioDoPrazoDeReleitura } from "./andamento";
import { avisosDaDevolucao, sincronizarAvisosDoPagamento, trocarAvisosDaDevolucao } from "./avisos-devolucao";
import { conferirTentativa } from "./conferencia";
import { FUSO_PAGAMENTO, recebimentosDoPagamento } from "./liberacao";
import { type Cobranca, type ProvedorPagamento, RECUSAS_DEFINITIVAS, type ResultadoDevolucao, RETENCAO_ORDERS_DIAS, valorPagoNaOrder } from "./provedor";
import { type CodigoAviso, MAXIMO_FALHAS_DEVOLUCAO, origemDeDevolucaoConhecida, textoMotivoSemReserva } from "./situacoes";
import {
  cabeNoPagamento,
  comprometido,
  comprometidoNoPagamento,
  type ContextoDaDevolucao,
  cotacaoDaDevolucao,
  type Devolucao,
  devolucaoInexplicada,
  devolucoesDoPagamento,
  devolvidoForaSemValor,
  devolvidoProprio,
  dinheiroDaReserva,
  esperaLiberacao,
  integralIntocada,
  jurosDaDevolucao,
  type Pagamento,
  possivelmenteNoProvedor,
  saldoDevolvivel,
  situacaoExplicada,
  taxaAtribuidaDaDevolucao,
  type Travado,
  travarCotacao,
  valorPagoAprovado,
} from "./travas";

export { chaveSaidaDevolucao } from "./acerto-cancelamento";
export { cabeNoPagamento, esperaLiberacao } from "./travas";
export { MAXIMO_FALHAS_DEVOLUCAO };
/** Espera entre uma tentativa de devolução e a seguinte (a rotina relê a order antes). */
export const ESPERA_DEVOLUCAO_MS = 10 * 60_000;
export const chaveDevolucao = (devolucaoId: string, n: number) => `devolucao:${devolucaoId}:${n}`;
/** Por quantos dias depois da aprovação o Mercado Pago ainda devolve um pagamento com cartão. */
export const PRAZO_DEVOLUCAO_CARTAO_DIAS = 180;
/** D13: sem a data prevista da liberação, quantos dias depois da aprovação a espera pela liberação vira aviso. */
export const DIAS_LIBERACAO_SEM_PREVISAO = 35;
export const ERRO_POR_FORA_CARTAO =
  "Pagamento com cartão: devolva pelo Mercado Pago. A devolução por fora só é registrada quando o Mercado Pago recusou a devolução de vez (ou a recusa no painel do Mercado Pago foi registrada aqui) ou o pagamento passou de 180 dias (a cobrança ficaria no cartão do hóspede e uma contestação poderia devolver de novo).";
/** O pedido já foi enviado e ainda pode sair pelo Mercado Pago (D16): a devolução por fora não é registrada. */
export const ERRO_POR_FORA_CHAVE_ENVIADA =
  "O pedido desta devolução já foi enviado ao Mercado Pago e ainda pode sair por lá: a devolução por fora não é registrada. Espere a leitura (Conferir agora) ou, passado o prazo de leitura, pare a devolução pedida.";
/** Limite das notas da equipe (devolução por fora, confirmação, recusa no painel, parada, correção da taxa). */
const LIMITE_NOTA = 300;

/** Os avisos de uma devolução (M8.2d); sem a coluna (um objeto montado à mão), os do pagamento. */
const avisosDa = (p: { avisos: readonly string[] }, dev: { avisos?: readonly string[] } | undefined): readonly string[] => dev?.avisos ?? p.avisos;

/**
 * Cartão: a devolução por fora é permitida? Uma regra para todas as origens (o quadro do pagamento usa a mesma). Só quando:
 * - a devolução ficou recusada por uma recusa definitiva do Mercado Pago (`RECUSAS_DEFINITIVAS`; "não encontrado" só vale
 *   dentro do prazo de leitura — depois dele, a order some da consulta e isso não diz nada);
 * - a equipe registrou que o painel do Mercado Pago recusou a devolução;
 * - a leitura mostrou que a NOSSA devolução (o id gravado) falhou e o sistema a soltou (recusada, com o id e o aviso dela);
 * - o pagamento passou dos 180 dias em que o Mercado Pago ainda devolve.
 * Saldo insuficiente, espera, três respostas incertas, `ja_devolvido`, `valor_excede` e a recusada do pagamento com mais de
 * 78 dias (nada foi pedido) nunca abrem. Pix: sempre (as outras condições continuam em quem chama).
 */
export function porForaPermitidoNoCartao(
  p: Pick<Pagamento, "forma" | "avisos" | "aprovadoEm"> & { criadoEm?: Date },
  dev: (Pick<Devolucao, "situacao" | "ultimoCodigo" | "recusaNoPainelEm" | "idProvedor"> & { avisos?: readonly string[] }) | undefined,
  agora: Date,
): boolean {
  if (p.forma !== "cartao") return true;
  if (p.aprovadoEm && p.aprovadoEm.getTime() + PRAZO_DEVOLUCAO_CARTAO_DIAS * 86_400_000 < agora.getTime()) return true;
  if (!dev) return false;
  if (dev.recusaNoPainelEm) return true;
  if (dev.situacao !== "recusada") return false;
  const naJanela = !!p.criadoEm && p.criadoEm.getTime() >= inicioDoPrazoDeReleitura(agora).getTime();
  if (dev.ultimoCodigo && RECUSAS_DEFINITIVAS.includes(dev.ultimoCodigo) && (dev.ultimoCodigo !== "nao_encontrado" || naJanela)) return true;
  // Solta pela leitura: o id da devolução que falhou fica gravado (um pedido novo da equipe o apaga) e o aviso dela, ligado.
  return dev.idProvedor !== null && avisosDa(p, dev).includes("devolucao_falhou");
}

/**
 * Despesa da taxa que o provedor não devolveu: uma por devolução (`#N` a cada correção). As despesas antigas (M8.2a)
 * ficam com a chave de antes (`mercadopago:<pagamento>:taxa_perdida`); a taxa já registrada nunca é lançada de novo.
 */
export const chaveTaxaPerdida = (pagamentoId: string, devolucaoId: string, n = 1) => `mercadopago:${pagamentoId}:devolucao:${devolucaoId}:taxa_perdida${n > 1 ? `#${n}` : ""}`;

/** `devolucaoId`: a linha nova que a ação criou (o restante pedido ao Mercado Pago, M8.2d). */
export type ResultadoAcaoPagamento = { ok: true; situacao?: SituacaoDevolucao; mensagem?: string; devolucaoId?: string } | { ok: false; erro: string };

/**
 * Qual devolução a ação da equipe alcança: pelo id (o quadro do pagamento do M8.2d) ou pelo pagamento (o quadro de antes:
 * a devolução dele que a ação alcança; um texto é o id do pagamento).
 */
export type AlvoDaDevolucao = { devolucaoId: string } | { pagamentoId: string };
const comoAlvo = (a: AlvoDaDevolucao | string): AlvoDaDevolucao => (typeof a === "string" ? { pagamentoId: a } : a);

/** Nota da equipe: até 300 caracteres, sem dado pessoal. null = vale; senão, o texto da recusa. */
function problemaDaNota(nota: string, obrigatoria: boolean): string | null {
  if (obrigatoria && !nota) return "Escreva a nota (sem dados pessoais).";
  if (nota.length > LIMITE_NOTA) return `A nota passa de ${LIMITE_NOTA} caracteres.`;
  if (textoSemDadosPessoais(nota) === null) return ERRO_DADOS_PESSOAIS;
  return null;
}

async function cotacaoDoPagamento(db: Db, organizacaoId: string, pagamentoId: string): Promise<string | null> {
  if (!uuidValido(pagamentoId)) return null;
  const [p] = await db.select({ cotacaoId: pagamentos.cotacaoId }).from(pagamentos).where(and(eq(pagamentos.id, pagamentoId), eq(pagamentos.organizacaoId, organizacaoId)));
  return p?.cotacaoId ?? null;
}

/** A cotação, o pagamento e (pelo id) a devolução do alvo, desta organização; null = não encontrado. */
async function resolverAlvo(db: Db, organizacaoId: string, alvo: AlvoDaDevolucao): Promise<{ cotacaoId: string; pagamentoId: string; devolucaoId: string | null } | null> {
  if ("devolucaoId" in alvo) {
    const d = await cotacaoDaDevolucao(db, organizacaoId, alvo.devolucaoId);
    return d ? { ...d, devolucaoId: alvo.devolucaoId } : null;
  }
  const cotacaoId = await cotacaoDoPagamento(db, organizacaoId, alvo.pagamentoId);
  return cotacaoId ? { cotacaoId, pagamentoId: alvo.pagamentoId, devolucaoId: null } : null;
}

/**
 * A devolução do alvo entre as vivas do pagamento: pelo id; pelo pagamento, a mais nova que a ação alcança (`preferir`),
 * senão a mais nova (no M8.2c, a única).
 */
function devolucaoDoAlvo(devs: readonly Devolucao[], devolucaoId: string | null, preferir: (d: Devolucao) => boolean = () => true): Devolucao | undefined {
  if (devolucaoId) return devs.find((d) => d.id === devolucaoId);
  const ordem = [...devs].reverse();
  return ordem.find(preferir) ?? ordem[0];
}

/** A espera pela liberação passou da data prevista (ou de 35 dias da aprovação, sem previsão). */
export const liberacaoAtrasada = (p: Pick<Pagamento, "liberacaoPrevistaEm" | "aprovadoEm" | "criadoEm">, agora: Date) =>
  agora.getTime() > (p.liberacaoPrevistaEm?.getTime() ?? (p.aprovadoEm ?? p.criadoEm).getTime() + DIAS_LIBERACAO_SEM_PREVISAO * 86_400_000);

/**
 * O excesso que as outras devoluções nossas e o reconhecido não explicam, dado o devolvido lido. Esta devolução o explica
 * só quando o pedido dela, de parte do valor, pode já estar no Mercado Pago e o excesso cabe nele (a resposta perdida: o
 * reenvio com a mesma chave deixa o adaptador reconhecer a repetição). Um pedido integral que tivesse saído levaria a order
 * a devolvida, nunca a uma parte.
 */
function explicadaPorEsta(dev: Devolucao, excesso: number, semValores: boolean): boolean {
  return possivelmenteNoProvedor(dev) && !dev.chaveAceita && dev.corpoIntegral === false && (semValores || excesso <= dev.valor);
}

/**
 * Pelo pagamento sem reserva: a devolução principal dele (não um restante). Uma de origem que esta versão não conhece
 * também conta, para a ação recusar por ela (nunca criar outra por cima).
 */
const principalSemReserva = (devs: readonly Devolucao[]) => devs.find((d) => d.origemDevolucaoId === null && (d.origem === "sem_reserva" || !origemDeDevolucaoConhecida(d.origem)));

/** O devolvido lido numa leitura, válido (0 sem a lista). */
const devolvidoDa = (c: Pick<Cobranca, "devolvido">) => (Number.isSafeInteger(c.devolvido) && c.devolvido > 0 ? c.devolvido : 0);

/** Liga/desliga avisos numa devolução e refaz a união no pagamento, sob as travas de quem chama. */
async function avisosNaDevolucao(tx: Db, t: Travado, p: Pagamento, dev: Devolucao, o: { ligar?: CodigoAviso[]; desligar?: CodigoAviso[] }, agora: Date): Promise<void> {
  await trocarAvisosDaDevolucao(tx, dev, o, agora);
  await sincronizarAvisosDoPagamento(tx, t, p, agora);
}

async function adiarDevolucao(db: Db, devolucaoId: string, agora: Date): Promise<void> {
  await db.update(devolucoesPagamento).set({ proximaTentativaEm: new Date(agora.getTime() + ESPERA_DEVOLUCAO_MS), atualizadoEm: agora }).where(eq(devolucoesPagamento.id, devolucaoId));
}

/**
 * A devolução automática para (recusada, com o aviso dela): devolução que o sistema não pediu, contestação ou outra
 * situação na order. Devolver agora poderia devolver a mais, ou correr com a contestação.
 */
async function pararDevolucao(db: Db, organizacaoId: string, cotacaoId: string, devolucaoId: string, agora: Date, motivo?: string): Promise<void> {
  await db.transaction(async (tx) => {
    const t = await travarCotacao(tx, organizacaoId, cotacaoId);
    const dev = t?.devolucoes.find((x) => x.id === devolucaoId);
    // Pedido aceito pelo provedor nunca para (ainda pode sair): só a leitura o resolve.
    if (!t || !dev || dev.situacao !== "pedida" || dev.chaveAceita) return;
    await tx.update(devolucoesPagamento).set({ situacao: "recusada", proximaTentativaEm: null, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
    dev.situacao = "recusada";
    dev.proximaTentativaEm = null;
    const p = t.tentativas.find((x) => x.id === dev.pagamentoId)!;
    await avisosNaDevolucao(tx, t, p, dev, { ligar: ["devolucao_parada"] }, agora);
    await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "pagamento.devolucao_parada", entidade: "pagamento", entidadeId: p.id, mudancas: { devolucao: ["pedida", "recusada"], ...(motivo ? { motivo: [null, motivo] } : {}) } });
  });
}

/**
 * Pedido já aceito pelo provedor e a order ainda sem a devolução: nada se envia (só a leitura confirma). Conta a
 * leitura; da terceira em diante, aviso para a equipe conferir no Mercado Pago. Continua pedida.
 */
async function esperarAceita(db: Db, organizacaoId: string, cotacaoId: string, devolucaoId: string, agora: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const t = await travarCotacao(tx, organizacaoId, cotacaoId);
    const dev = t?.devolucoes.find((x) => x.id === devolucaoId);
    if (!t || !dev || dev.situacao !== "pedida" || !dev.chaveAceita) return;
    const falhas = dev.falhas + 1;
    await tx.update(devolucoesPagamento).set({ falhas, proximaTentativaEm: new Date(agora.getTime() + ESPERA_DEVOLUCAO_MS), atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
    dev.falhas = falhas;
    if (falhas >= MAXIMO_FALHAS_DEVOLUCAO) await avisosNaDevolucao(tx, t, t.tentativas.find((x) => x.id === dev.pagamentoId)!, dev, { ligar: ["devolucao_sem_confirmacao"] }, agora);
  });
}

/**
 * D13: a devolução espera a liberação do pagamento (sem chave, sem envio). Sob a trava: confere de novo, grava o código
 * `aguardando_liberacao`, a próxima volta (a data prevista, se vier depois) e, passada a previsão, o aviso.
 */
async function esperarLiberacao(db: Db, organizacaoId: string, cotacaoId: string, devolucaoId: string, agora: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const t = await travarCotacao(tx, organizacaoId, cotacaoId);
    const dev = t?.devolucoes.find((x) => x.id === devolucaoId);
    const p = dev && t?.tentativas.find((x) => x.id === dev.pagamentoId);
    if (!t || !dev || !p || dev.situacao !== "pedida" || !esperaLiberacao(p, dev, devolucoesDoPagamento(t, p.id))) return;
    const proxima = new Date(Math.max(agora.getTime() + ESPERA_DEVOLUCAO_MS, p.liberacaoPrevistaEm?.getTime() ?? 0));
    await tx.update(devolucoesPagamento).set({ ultimoCodigo: "aguardando_liberacao", proximaTentativaEm: proxima, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
    Object.assign(dev, { ultimoCodigo: "aguardando_liberacao" as const, proximaTentativaEm: proxima });
    if (liberacaoAtrasada(p, agora)) await avisosNaDevolucao(tx, t, p, dev, { ligar: ["devolucao_aguardando_liberacao_atrasada"] }, agora);
  });
}

/** Lê, sem trava, a devolução, o pagamento dela e as devoluções vivas do pagamento (antes de reler a order). */
async function lerDevolucao(db: Db, organizacaoId: string, devolucaoId: string) {
  if (!uuidValido(devolucaoId)) return null;
  const [d] = await db
    .select({ dev: devolucoesPagamento, p: pagamentos })
    .from(devolucoesPagamento)
    .innerJoin(pagamentos, eq(pagamentos.id, devolucoesPagamento.pagamentoId))
    .where(and(eq(devolucoesPagamento.id, devolucaoId), eq(devolucoesPagamento.organizacaoId, organizacaoId)));
  if (!d) return null;
  const devs = devolucoesDoPagamento({ devolucoes: await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.pagamentoId, d.p.id)) }, d.p.id);
  return { dev: d.dev, p: d.p, devs, outras: devs.filter((x) => x.id !== d.dev.id) };
}

/**
 * Um pedido de devolução ao provedor (rotina e painel): relê a order antes (já devolvida = a leitura confirma; devolução
 * em andamento = espera), grava a chave nova (e o formato do corpo) antes de chamar, chama fora de transação e registra o
 * resultado. A confirmação vem da leitura. Devolução de origem que esta versão não conhece, ou que o Mercado Pago devolveu
 * a menos (a espera para, a equipe resolve), não é tocada. A de parte do valor espera a liberação do pagamento (D13).
 */
export async function tentarDevolucao(db: Db, organizacaoId: string, devolucaoId: string, provedor: ProvedorPagamento, agora: Date = new Date()): Promise<SituacaoDevolucao | null> {
  const lido = await lerDevolucao(db, organizacaoId, devolucaoId);
  if (!lido) return null;
  const { dev, p, devs, outras } = lido;
  if (dev.situacao !== "pedida" || !p.idProvedor || !origemDeDevolucaoConhecida(dev.origem) || dev.avisos.includes("devolucao_a_menor")) return dev.situacao;
  // D13, antes de qualquer leitura: a de parte do valor só sai com o pagamento liberado e a taxa conhecida.
  if (esperaLiberacao(p, dev, devs)) {
    await esperarLiberacao(db, organizacaoId, p.cotacaoId, devolucaoId, agora);
    return (await situacaoDaDevolucao(db, devolucaoId)) ?? null;
  }
  // Antes de pedir de novo: a order já diz devolvida? Então a leitura confirma e nada é reenviado.
  let cobranca: Cobranca | null;
  try {
    cobranca = await provedor.consultar(p.idProvedor);
  } catch {
    // Sem leitura não se pede: tenta de novo na próxima volta.
    await adiarDevolucao(db, devolucaoId, agora);
    return "pedida";
  }
  const reler = (c: Cobranca) => conferirTentativa(db, organizacaoId, p.id, provedor, agora, { forcar: true, origem: "rotina", cobranca: c });
  const situacaoLida = cobranca ? situacaoExplicada(cobranca, p, devs) : null;
  const devolvidoLido = cobranca ? devolvidoDa(cobranca) : 0;
  const excesso = devolvidoLido - p.devolvidoForaReconhecido - devolvidoProprio(outras);
  const semValores = !!cobranca && devolvidoLido === 0 && (situacaoLida === "devolvido_parcial" || situacaoLida === "devolvido" || cobranca.detalhe === "processed/refunded") && devolvidoProprio(outras) === 0 && p.devolvidoForaReconhecido === 0;
  if (cobranca && situacaoLida === "devolvido") {
    await reler(cobranca);
    const s = await situacaoDaDevolucao(db, devolucaoId);
    // A order inteira devolvida e esta não foi confirmada por ela (devolução que o sistema não explica): nada mais se pede.
    if (s === "pedida" && !possivelmenteNoProvedor(dev)) await pararDevolucao(db, organizacaoId, p.cotacaoId, devolucaoId, agora);
    return (await situacaoDaDevolucao(db, devolucaoId)) ?? "pedida";
  }
  // Devolução já em andamento no provedor (um pedido anterior cuja resposta se perdeu): espera, sem pedir de novo.
  if (cobranca?.devolucaoEmAndamento) {
    await adiarDevolucao(db, devolucaoId, agora);
    return "pedida";
  }
  // Pedido já aceito pelo provedor: nada se envia de novo (nem com a mesma chave) e ele nunca para sozinho, qualquer que
  // seja a leitura (em parte, contestada...): a devolução aceita ainda pode sair, e parar abriria o registro por fora (em
  // dobro). A leitura é aplicada (confirma pelo id, pelo valor ou pela situação, ou solta a nossa devolução que falhou);
  // três sem a devolução viram aviso.
  if (dev.chaveAceita) {
    if (cobranca) await reler(cobranca);
    await esperarAceita(db, organizacaoId, p.cotacaoId, devolucaoId, agora);
    return (await situacaoDaDevolucao(db, devolucaoId)) ?? null;
  }
  // Contestada, ou devolução que o sistema não explica: a leitura é aplicada e a devolução automática para (nunca o resto
  // por cima). A resposta perdida de um pedido de parte do valor em dúvida não para: o reenvio com a mesma chave a reconhece.
  if (cobranca && (cobranca.situacao === "contestado" || ((excesso > 0 || semValores) && !explicadaPorEsta(dev, excesso, semValores)))) {
    await reler(cobranca);
    await pararDevolucao(db, organizacaoId, p.cotacaoId, devolucaoId, agora);
    return (await situacaoDaDevolucao(db, devolucaoId)) ?? null;
  }
  // Só se pede com a order relida aprovada (ou devolvida em parte pelas nossas devoluções) e a mesma da tentativa (id e
  // referência). Qualquer outra leitura (desconhecida, recusada, cancelada, vencida, pendente, de outra referência) é
  // aplicada e a devolução automática para com aviso: a situação local pode estar velha, e o pedido não sai por cima dela.
  const repeticao = (excesso > 0 || semValores) && explicadaPorEsta(dev, excesso, semValores);
  if (cobranca && ((situacaoLida !== "aprovado" && situacaoLida !== "devolvido_parcial" && !repeticao) || cobranca.idProvedor !== p.idProvedor || cobranca.referencia !== p.referencia)) {
    await reler(cobranca);
    await pararDevolucao(db, organizacaoId, p.cotacaoId, devolucaoId, agora);
    return (await situacaoDaDevolucao(db, devolucaoId)) ?? null;
  }
  // O corpo do pedido: o mesmo da chave em dúvida (D29); com chave nova, vazio só na integral de um pagamento intocado.
  const corpoIntegralProvavel = dev.chaveEmDuvida && dev.chaveAtual ? dev.corpoIntegral !== false : integralIntocada(p, dev, devs);
  if (cobranca && !corpoIntegralProvavel && !cobranca.idTransacao) {
    // A devolução de parte do valor precisa da transação do pagamento: sem ela, nada se envia (a equipe confere no painel).
    await reler(cobranca);
    await pararDevolucao(db, organizacaoId, p.cotacaoId, devolucaoId, agora, "o Mercado Pago não informou a transação do pagamento");
    return (await situacaoDaDevolucao(db, devolucaoId)) ?? null;
  }
  let res: ResultadoDevolucao;
  let chaveRepetida = false;
  let conhecidas: string[] = [];
  if (!cobranca) res = { situacao: "recusada", idDevolucao: null, mensagem: "O Mercado Pago não encontrou o pagamento.", codigo: "nao_encontrado" };
  else {
    // Grava a chave antes de chamar, sob as travas. Depois de uma resposta incerta, a MESMA chave de novo (o pedido
    // anterior pode ter sido aceito: o provedor não devolve duas vezes pela mesma chave), com o mesmo corpo; senão, chave nova.
    const reserva = await db.transaction(async (tx) => {
      const t = await travarCotacao(tx, organizacaoId, p.cotacaoId);
      const d = t?.devolucoes.find((x) => x.id === devolucaoId);
      // Sob a trava: ainda pedida, a vez dela chegou e ninguém pediu desde a leitura (painel e rotina ao mesmo tempo).
      if (!t || !d || d.situacao !== "pedida" || d.chaveAceita || d.tentativas !== dev.tentativas || (d.proximaTentativaEm && d.proximaTentativaEm.getTime() > agora.getTime())) return null;
      const pt = t.tentativas.find((x) => x.id === d.pagamentoId);
      if (!pt) return null;
      const vivas = devolucoesDoPagamento(t, pt.id);
      const outrasT = vivas.filter((x) => x.id !== d.id);
      // D13 de novo, sob a trava: a liberação pode ter sido estornada entre a leitura e aqui.
      if (esperaLiberacao(pt, d, vivas)) return "espera" as const;
      // O pagamento ainda está aprovado (ou devolvido em parte pelas nossas devoluções), sem devolução que o sistema não
      // explique, e a devolução ainda cabe nele. Uma leitura que cruzou (Conferir agora, aviso) pode tê-lo mudado depois
      // da releitura acima: então nada se pede por cima, e para.
      const excessoGravado = pt.devolvidoLido - pt.devolvidoForaReconhecido - devolvidoProprio(outrasT);
      const semValoresGravado = pt.devolvidoLido === 0 && pt.situacao === "devolvido_parcial" && devolvidoProprio(outrasT) === 0 && pt.devolvidoForaReconhecido === 0;
      const inexplicada = (excessoGravado > 0 || semValoresGravado) && !explicadaPorEsta(d, excessoGravado, semValoresGravado);
      // O teto (D12): o comprometido das outras mais esta nunca passa do pago menos o reconhecido devolvido fora (e uma
      // devolução sem valor positivo nunca sai).
      const cabeNoTeto = d.valor > 0 && comprometidoNoPagamento(outrasT) + d.valor <= valorPagoAprovado(pt) - pt.devolvidoForaReconhecido;
      if ((pt.situacao !== "aprovado" && pt.situacao !== "devolvido_parcial") || inexplicada || !cabeNoPagamento(d, pt, t) || !cabeNoTeto) {
        await tx.update(devolucoesPagamento).set({ situacao: "recusada", proximaTentativaEm: null, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, d.id));
        d.situacao = "recusada";
        await avisosNaDevolucao(tx, t, pt, d, { ligar: ["devolucao_parada"] }, agora);
        await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "pagamento.devolucao_parada", entidade: "pagamento", entidadeId: pt.id, mudancas: { devolucao: ["pedida", "recusada"] } });
        return null;
      }
      // D12: a devolução do dinheiro da reserva (cancelamento e alteração) só é pedida ao Mercado Pago com folga para
      // conferir que saiu (pagamento com até 78 dias). Passou disso entre um envio e outro (espera, resposta incerta,
      // recusa clara): nada mais se envia. Com a chave em dúvida (um envio anterior pode ter sido aceito), continua pedida e
      // só a leitura segue, até os 85 dias (depois, "Parar a devolução pedida"); sem dúvida, nada está no Mercado Pago:
      // fica recusada, com o aviso, para a equipe devolver pelo painel dele (cartão) ou por fora (Pix).
      if (d.origem !== "sem_reserva" && pt.criadoEm.getTime() < inicioDoPrazoDePedirDevolucao(agora).getTime()) {
        if (d.chaveEmDuvida) {
          await tx.update(devolucoesPagamento).set({ proximaTentativaEm: new Date(agora.getTime() + ESPERA_DEVOLUCAO_MS), atualizadoEm: agora }).where(eq(devolucoesPagamento.id, d.id));
          return null;
        }
        await tx.update(devolucoesPagamento).set({ situacao: "recusada", proximaTentativaEm: null, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, d.id));
        d.situacao = "recusada";
        await avisosNaDevolucao(tx, t, pt, d, { ligar: ["devolucao_fora_do_prazo"] }, agora);
        await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "pagamento.devolucao_fora_do_prazo", entidade: "pagamento", entidadeId: pt.id, mudancas: { devolucao: ["pedida", "recusada"] } });
        return null;
      }
      const repetida = Boolean(d.chaveEmDuvida && d.chaveAtual);
      const proxima = d.tentativas + 1;
      const usar = repetida ? d.chaveAtual! : chaveDevolucao(d.id, proxima);
      const corpoIntegral = repetida ? d.corpoIntegral !== false : integralIntocada(pt, d, vivas);
      if (!corpoIntegral && !cobranca.idTransacao) return null;
      // A integral de um pagamento intocado registra o que a order relida mostra como pago (a devolução integral devolve
      // isso, não o da cotação); a de parte do valor nunca muda de valor (D29). A chave já fica "em dúvida" antes do envio:
      // se o processo cair depois de o provedor aceitar (e antes de gravar o resultado), o próximo envio repete a MESMA
      // chave, com o mesmo corpo. Só uma recusa clara tira a dúvida.
      const valor = corpoIntegral && !repetida ? valorPagoNaOrder(cobranca) : d.valor;
      await tx
        .update(devolucoesPagamento)
        .set({ tentativas: proxima, chaveAtual: usar, chaveEmDuvida: true, corpoIntegral, valor, proximaTentativaEm: new Date(agora.getTime() + ESPERA_DEVOLUCAO_MS), atualizadoEm: agora })
        .where(eq(devolucoesPagamento.id, d.id));
      Object.assign(d, { tentativas: proxima, chaveAtual: usar, chaveEmDuvida: true, corpoIntegral, valor });
      // D19: a taxa atribuída ao principal desta devolução fica congelada quando a chave é gravada (com a taxa conhecida).
      await congelarTaxaAtribuida(tx, pt, d, vivas, agora);
      if (d.avisos.includes("devolucao_aguardando_liberacao_atrasada")) await avisosNaDevolucao(tx, t, pt, d, { desligar: ["devolucao_aguardando_liberacao_atrasada"] }, agora);
      return { chave: usar, repetida, corpoIntegral, valor, conhecidas: outrasT.map((x) => x.idProvedor).filter((x): x is string => !!x) };
    });
    if (reserva === "espera") {
      await esperarLiberacao(db, organizacaoId, p.cotacaoId, devolucaoId, agora);
      return (await situacaoDaDevolucao(db, devolucaoId)) ?? null;
    }
    if (reserva === null) return situacaoDaDevolucao(db, devolucaoId);
    chaveRepetida = reserva.repetida;
    conhecidas = reserva.conhecidas;
    res = await provedor.devolver(cobranca, reserva.chave, reserva.corpoIntegral ? null : reserva.valor, { repetida: chaveRepetida, conhecidas });
  }
  // Antes de dar a devolução por recusada (a terceira recusa ou resposta incerta), a order é relida: a resposta pode
  // ter cruzado com um pedido que saiu. undefined = não deu para ler (então não se desiste).
  const falhou = res.situacao === "recusada" || res.situacao === "incerta";
  let releitura: Cobranca | null | undefined;
  if (falhou && dev.falhas + 1 >= MAXIMO_FALHAS_DEVOLUCAO) {
    try {
      releitura = await provedor.consultar(p.idProvedor);
    } catch {
      releitura = undefined;
    }
  }
  /** Uma devolução NOVA desde o pedido: mais devolvido do que as nossas outras e o reconhecido, em andamento, ou a order inteira devolvida quando esta completaria o pagamento. */
  const devolucaoNova = (r: Cobranca) =>
    r.devolucaoEmAndamento ||
    devolvidoDa(r) > p.devolvidoForaReconhecido + devolvidoProprio(outras) ||
    (situacaoExplicada(r, p, devs) === "devolvido" && comprometidoNoPagamento(outras.filter((x) => x.situacao === "confirmada")) + p.devolvidoForaReconhecido + dev.valor === valorPagoAprovado(p));
  await db.transaction(async (tx) => {
    const t = await travarCotacao(tx, organizacaoId, p.cotacaoId);
    const d = t?.devolucoes.find((x) => x.id === devolucaoId);
    if (!t || !d || d.situacao !== "pedida") return;
    const pt = t.tentativas.find((x) => x.id === d.pagamentoId)!;
    // O código da resposta (lista fechada) fica guardado em toda resposta: o quadro do pagamento explica a espera ou a recusa.
    const ultimoCodigo = res.codigo;
    if (res.situacao === "confirmada" || res.situacao === "pedida") {
      // Aceito pelo provedor: daí em diante nada se envia de novo (a order pode demorar a mostrar a devolução; um envio
      // novo poderia devolver de novo). Só a leitura confirma; as falhas recomeçam a contar as leituras sem a devolução.
      // O id é o da devolução que ESTE pedido criou (ou nenhum, quando a resposta não deixa saber qual): só ele solta o
      // pedido se a leitura o mostrar falho.
      await tx.update(devolucoesPagamento).set({ chaveEmDuvida: true, chaveAceita: true, falhas: 0, ultimoCodigo, idProvedor: res.idDevolucao, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, d.id));
      return;
    }
    if (res.situacao === "aguarde") {
      // "Aguarde" (outra devolução em andamento no Mercado Pago, ou espera pedida por ele): nada foi aceito por esta chave
      // e não conta falha — nunca leva à desistência nem abre a devolução por fora. A chave continua em dúvida (o próximo
      // envio repete a mesma) e não fica aceita. A próxima volta relê a order antes.
      await tx.update(devolucoesPagamento).set({ chaveEmDuvida: true, ultimoCodigo, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, d.id));
      return;
    }
    // D15: o restante de uma devolução que o Mercado Pago fez a menos, recusado com "valor acima do que se pode devolver"
    // ou "não permitido" (com chave nova: nada desta chave está lá): o restante pode já ter saído pelo painel dele, ou não
    // sair mais pelo sistema. Nada se pede de novo sozinho; fica recusado com o aviso de a menor, e a equipe confere no
    // painel do Mercado Pago (confirma com o valor visto, registra por fora, a recusa do painel ou um ajuste).
    if (res.situacao === "recusada" && d.origemDevolucaoId && !chaveRepetida && (res.codigo === "valor_excede" || res.codigo === "nao_permitido")) {
      await tx
        .update(devolucoesPagamento)
        .set({ situacao: "recusada", falhas: d.falhas + 1, chaveEmDuvida: false, ultimoCodigo, proximaTentativaEm: null, atualizadoEm: agora })
        .where(eq(devolucoesPagamento.id, d.id));
      Object.assign(d, { situacao: "recusada" as const, falhas: d.falhas + 1, chaveEmDuvida: false, ultimoCodigo, proximaTentativaEm: null });
      await avisosNaDevolucao(tx, t, pt, d, { ligar: ["devolucao_a_menor"] }, agora);
      await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "pagamento.devolucao_a_menor", entidade: "pagamento", entidadeId: pt.id, mudancas: { restante: [null, d.valor], recusa: [null, ultimoCodigo] } });
      return;
    }
    // Recusada (`ja_devolvido` inclusive: a próxima leitura decide) ou incerta (o pedido pode ter saído): conta; só desiste
    // com a releitura sem nenhuma devolução nova desde o pedido.
    const falhas = d.falhas + 1;
    const semSinalDeDevolucao = releitura === null || (releitura !== undefined && !devolucaoNova(releitura));
    const desistiu = falhas >= MAXIMO_FALHAS_DEVOLUCAO && semSinalDeDevolucao;
    await tx
      .update(devolucoesPagamento)
      // Incerta: o próximo envio repete a chave. Recusa clara de uma chave nova: o próximo leva chave nova. Uma chave que
      // já estava em dúvida continua em dúvida mesmo recusada agora (a recusa pode vir antes de o provedor conferir a
      // chave, e o pedido anterior com ela pode ter saído): só a desistência, com a order relida sem sinal de
      // devolução, deixa a equipe pedir com chave nova.
      .set({ falhas, chaveEmDuvida: res.situacao === "incerta" || chaveRepetida, ultimoCodigo, ...(desistiu ? { situacao: "recusada" as const, proximaTentativaEm: null } : {}), atualizadoEm: agora })
      .where(eq(devolucoesPagamento.id, d.id));
    if (desistiu) {
      d.situacao = "recusada";
      await avisosNaDevolucao(tx, t, pt, d, { ligar: ["devolucao_falhou"] }, agora);
      await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "pagamento.devolucao_recusada", entidade: "pagamento", entidadeId: pt.id, mudancas: { devolucao: ["pedida", "recusada"] } });
    }
  });
  // A confirmação só vem da leitura da order.
  if (res.situacao === "confirmada" || res.situacao === "pedida") await conferirTentativa(db, organizacaoId, p.id, provedor, agora, { forcar: true, origem: "rotina" });
  else if (releitura && devolucaoNova(releitura)) await conferirTentativa(db, organizacaoId, p.id, provedor, agora, { forcar: true, origem: "rotina", cobranca: releitura });
  return (await situacaoDaDevolucao(db, devolucaoId)) ?? null;
}

async function situacaoDaDevolucao(db: Db, devolucaoId: string): Promise<SituacaoDevolucao | null> {
  const [d] = await db.select({ situacao: devolucoesPagamento.situacao }).from(devolucoesPagamento).where(eq(devolucoesPagamento.id, devolucaoId));
  return d?.situacao ?? null;
}

/** Trava a cotação do alvo e entrega o retrato, o pagamento, as devoluções vivas dele e a devolução do alvo. */
async function comAlvo<T>(
  db: Db,
  organizacaoId: string,
  alvo: AlvoDaDevolucao,
  preferir: ((d: Devolucao) => boolean) | undefined,
  f: (tx: Db, t: Travado, p: Pagamento, dev: Devolucao | undefined, devs: Devolucao[]) => Promise<T>,
): Promise<T | { ok: false; erro: string }> {
  const r = await resolverAlvo(db, organizacaoId, alvo);
  if (!r) return { ok: false, erro: "devolucaoId" in alvo ? "Devolução não encontrada." : "Pagamento não encontrado." };
  return db.transaction(async (tx) => {
    const t = await travarCotacao(tx, organizacaoId, r.cotacaoId);
    const p = t?.tentativas.find((x) => x.id === r.pagamentoId);
    if (!t || !p) return { ok: false as const, erro: "Pagamento não encontrado." };
    const devs = devolucoesDoPagamento(t, p.id);
    const dev = devolucaoDoAlvo(devs, r.devolucaoId, preferir);
    if (r.devolucaoId && !dev) return { ok: false as const, erro: "Devolução não encontrada." };
    return f(tx, t, p, dev, devs);
  });
}

/**
 * A devolução pode ser pedida de novo ao Mercado Pago (ou registrada por fora) agora? Sob a trava. Devolve o motivo da
 * recusa, ou null. Uma regra por origem: sem reserva (M8.2a, também o restante de um pagamento já devolvido em parte),
 * cancelamento (M8.2c) e alteração (M8.2d). Por fora também vale para o pagamento sem reserva contestado (a releitura no
 * provedor decide antes e só aceita com a contestação resolvida).
 */
function recusaDoPedido(p: Pagamento, dev: Devolucao | undefined, devs: readonly Devolucao[], t: ContextoDaDevolucao, porFora: boolean, agora: Date): string | null {
  const origem = dev?.origem ?? (dinheiroDaReserva(p) ? "cancelamento" : "sem_reserva");
  if (!origemDeDevolucaoConhecida(origem)) return "Esta devolução foi registrada por uma versão mais nova do sistema: resolva por ela.";
  if (dev?.situacao === "substituida") return "Esta devolução foi substituída pela do cancelamento da reserva.";
  if (origem === "sem_reserva") {
    const situacoes = porFora ? ["aprovado", "contestado", "devolvido_parcial"] : ["aprovado", "devolvido_parcial"];
    if (!situacoes.includes(p.situacao)) return "Só um pagamento aprovado (e ainda não devolvido) pode ser devolvido.";
    if (p.desfecho !== null) return "Este pagamento já tem desfecho.";
    if (p.motivoSemReserva === null) return "Este pagamento ainda está sendo conferido ou confirmou a reserva: não se devolve na parte (a).";
    const aberta = devs.find((x) => x.situacao === "pedida");
    if (aberta && (aberta.id !== dev?.id || !porFora || aberta.tentativas > 0)) return "Já há uma devolução pedida ao Mercado Pago para este pagamento.";
  } else {
    const cabe = origem === "cancelamento" ? t.cancelamento?.situacao === "cancelada" && t.cancelamento.direito === "integral" : t.alteracoes.some((a) => a.id === dev?.alteracaoId && a.situacao === "aplicada");
    if (!dinheiroDaReserva(p) || !cabe)
      return origem === "cancelamento"
        ? 'Este pagamento já tem desfecho: confirmou a reserva. A devolução sai pelo cancelamento da reserva ("Cancelar a reserva" no quadro Pagamento no site).'
        : "Esta devolução não cabe mais neste pagamento: a alteração dela não foi aplicada.";
    const emParteExplicada = p.situacao === "devolvido_parcial" && !devolucaoInexplicada(p, devs);
    if (p.situacao !== "aprovado" && !emParteExplicada) return "Só um pagamento aprovado (e ainda não devolvido) pode ser devolvido.";
    if (!dev) return "A devolução deste cancelamento não foi registrada: confira o quadro Pagamento no site.";
  }
  if (dev) {
    // Por fora (D16): só numa devolução nunca enviada ao Mercado Pago (esperando a liberação, fora do prazo, um restante
    // novo) ou recusada. Pedir de novo: só a recusada.
    const podeSer = dev.situacao === "recusada" || (porFora && dev.situacao === "pedida" && dev.tentativas === 0);
    if (!podeSer) {
      if (porFora && dev.situacao === "pedida" && dev.origem === "alteracao") return ERRO_POR_FORA_CHAVE_ENVIADA;
      if (dev.origem === "cancelamento") return "A devolução deste cancelamento já está pedida ou feita.";
      if (dev.origem === "alteracao") return "Esta devolução já está pedida ou feita.";
      return porFora ? "A devolução deste pagamento já foi registrada." : "A devolução deste pagamento já foi feita.";
    }
    // Um pedido que o Mercado Pago aceitou ainda pode sair por lá: registrar por fora devolveria em dobro.
    if (porFora && dev.chaveAceita)
      return "O Mercado Pago aceitou um pedido de devolução deste pagamento, que ainda pode sair por lá: a devolução por fora não é registrada. Confira no painel do Mercado Pago; se lá a devolução aparecer recusada, use Conferir agora.";
    // Parada com a chave ainda em dúvida (D16): aquele pedido pode estar no Mercado Pago. A recusada depois de três
    // respostas incertas também tem a chave em dúvida, mas só desiste com a order relida sem nenhuma devolução nova desde
    // o pedido (M8.2a), e a por fora relê a order de novo antes (`recusaPeloProvedor`): fica aberta, como no M8.2a.
    if (porFora && dev.situacao === "recusada" && dev.chaveEmDuvida && dev.avisos.includes("devolucao_parada")) return ERRO_POR_FORA_CHAVE_ENVIADA;
    // O restante que o Mercado Pago recusou (D15: valor acima do que se pode devolver, ou não permitido) não se pede de
    // novo: pedir de novo daria a mesma recusa. A equipe confere no painel dele (confirma o que vê, ou registra por fora).
    if (!porFora && dev.situacao === "recusada" && dev.avisos.includes("devolucao_a_menor"))
      return 'O Mercado Pago recusou o pedido deste restante: confira no painel do Mercado Pago e use "Confirmar devolução feita no painel do Mercado Pago" (com o valor visto) ou registre o restante devolvido por fora.';
  }
  if (porFora && !porForaPermitidoNoCartao(p, dev, agora)) return ERRO_POR_FORA_CARTAO;
  if (!porFora && origem !== "sem_reserva" && p.criadoEm.getTime() < inicioDoPrazoDePedirDevolucao(agora).getTime())
    return "O pagamento tem mais de 78 dias: devolva pelo painel do Mercado Pago e confirme aqui, ou por fora.";
  return null;
}

export const ERRO_FORA_SEM_VALOR = "O Mercado Pago não informou quanto já foi devolvido: informe o valor que aparece no painel dele.";

/**
 * D17: quanto do pagamento a equipe reconhece como devolvido fora do sistema (painel do Mercado Pago), para o restante: o
 * que a leitura mostra além das nossas devoluções; sem o valor na leitura, o que a equipe informa (o painel do Mercado
 * Pago). Só cresce. Sem devolução inexplicada, o de antes.
 */
function reconhecidoFora(p: Pagamento, devs: readonly Devolucao[], informado: number | undefined): { ok: true; valor: number } | { ok: false; erro: string } {
  if (!devolucaoInexplicada(p, devs)) return { ok: true, valor: p.devolvidoForaReconhecido };
  if (devolvidoForaSemValor(p, devs)) {
    if (informado === undefined) return { ok: false, erro: ERRO_FORA_SEM_VALOR };
    const teto = valorPagoAprovado(p) - comprometidoNoPagamento(devs);
    if (!Number.isSafeInteger(informado) || informado < 1 || informado > teto) return { ok: false, erro: `Informe o valor devolvido pelo painel do Mercado Pago (de R$ 0,01 a ${formatBRL(teto)}).` };
    return { ok: true, valor: Math.max(p.devolvidoForaReconhecido, informado) };
  }
  return { ok: true, valor: Math.max(p.devolvidoForaReconhecido, p.devolvidoLido - devolvidoProprio(devs)) };
}

async function gravarReconhecido(tx: Db, organizacaoId: string, p: Pagamento, valor: number, autorId: string | null, agora: Date): Promise<void> {
  if (valor === p.devolvidoForaReconhecido) return;
  await tx.update(pagamentos).set({ devolvidoForaReconhecido: valor, atualizadoEm: agora }).where(eq(pagamentos.id, p.id));
  await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.devolvido_fora_reconhecido", entidade: "pagamento", entidadeId: p.id, mudancas: { devolvidoForaReconhecido: [p.devolvidoForaReconhecido, valor] } });
  p.devolvidoForaReconhecido = valor;
}

/** O teto (D12), sob a trava: o comprometido das outras mais `valor` nunca passa do pago menos o reconhecido devolvido fora. */
const cabeNoTeto = (p: Pagamento, outras: readonly Devolucao[], valor: number) => comprometidoNoPagamento(outras) + valor <= valorPagoAprovado(p) - p.devolvidoForaReconhecido;
const ERRO_TETO = "Esta devolução passaria do que ainda se pode devolver deste pagamento (o pago menos as outras devoluções): confira o quadro Pagamento no site.";

/**
 * O pagamento ficou completo pelas devoluções (o Mercado Pago o mostra devolvido inteiro, ou o reconhecido mais as
 * devoluções realizadas alcançam o pago): o desfecho do pagamento sem reserva (§5.9).
 */
const pagamentoCompleto = (p: Pagamento, devs: readonly Devolucao[]) =>
  p.situacao === "devolvido" || p.devolvidoForaReconhecido + devs.filter((d) => d.situacao === "confirmada" || d.situacao === "por_fora").reduce((s, d) => s + comprometido(d), 0) >= valorPagoAprovado(p);

/** O desfecho do pagamento sem reserva quando ele fica completo: por fora se alguma parte saiu por fora; senão, devolução. */
export async function desfechoSemReserva(tx: Db, p: Pagamento, devs: readonly Devolucao[], o: { motivo: string; autorId: string | null }, agora: Date): Promise<boolean> {
  if (p.desfecho !== null || !pagamentoCompleto(p, devs)) return false;
  const desfecho = devs.some((d) => d.situacao === "por_fora") ? ("por_fora" as const) : ("devolucao" as const);
  await tx.update(pagamentos).set({ desfecho, desfechoMotivo: o.motivo, desfechoPor: o.autorId, desfechoEm: agora, atualizadoEm: agora }).where(eq(pagamentos.id, p.id));
  Object.assign(p, { desfecho, desfechoMotivo: o.motivo, desfechoPor: o.autorId, desfechoEm: agora });
  return true;
}

/**
 * Devolver pelo Mercado Pago. A equipe confirma na tela; autorização conferida por quem chama.
 * - `{ devolucaoId }`: pedir de novo uma devolução recusada (de qualquer origem conhecida), com chave nova.
 * - `{ pagamentoId }` (ou o id em texto): no pagamento sem reserva, cria a devolução do que falta (o integral, ou o restante
 *   de um pagamento já devolvido em parte, D17, com `valorForaInformado` quando o Mercado Pago não diz quanto) ou pede de
 *   novo a dele; no dinheiro da reserva, pede de novo a recusada dele (a linha nasce no cancelamento ou na alteração).
 */
export async function devolverPeloProvedor(
  db: Db,
  organizacaoId: string,
  alvoBruto: AlvoDaDevolucao | string,
  autorId: string | null,
  provedor: ProvedorPagamento,
  agora: Date = new Date(),
  o: { valorForaInformado?: number } = {},
): Promise<ResultadoAcaoPagamento> {
  const alvo = comoAlvo(alvoBruto);
  const r = await comAlvo(db, organizacaoId, alvo, (d) => d.situacao === "pedida" || d.situacao === "recusada", async (tx, t, p, devAlvo, devs) => {
    // Pelo pagamento sem reserva: a devolução principal dele (sem reserva, não um restante), se houver.
    const dev = "devolucaoId" in alvo ? devAlvo : p.desfecho === null && !dinheiroDaReserva(p) ? principalSemReserva(devs) : devAlvo;
    const recusa = recusaDoPedido(p, dev, devs, t, false, agora);
    if (recusa) return { ok: false as const, erro: recusa };
    const outras = devs.filter((x) => x.id !== dev?.id);
    let valor = dev?.valor ?? 0;
    if (!dev || dev.origem === "sem_reserva") {
      // D17: o restante do pagamento sem reserva, com o devolvido fora do sistema reconhecido agora.
      const fora = reconhecidoFora(p, devs, o.valorForaInformado);
      if (!fora.ok) return fora;
      await gravarReconhecido(tx, organizacaoId, p, fora.valor, autorId, agora);
      valor = saldoDevolvivel(p, outras);
      if (valor <= 0) return { ok: false as const, erro: "Não há mais nada a devolver deste pagamento." };
    }
    if (!cabeNoTeto(p, outras, valor)) return { ok: false as const, erro: ERRO_TETO };
    let id: string;
    if (dev) {
      // Devolução que desistiu depois de 3 recusas (relida a order, sem sinal de devolução), parada, ou solta pela leitura:
      // a equipe pede de novo, com chave nova (as falhas recomeçam; a numeração das chaves continua). Pedido que o provedor
      // já aceitou nunca ganha chave nova: continua só à espera da leitura. O id da devolução anterior sai (só a devolução
      // do pedido novo solta este pedido). O restante sem reserva pode mudar de valor (nada dele está no Mercado Pago).
      const [linha] = await tx
        .update(devolucoesPagamento)
        .set({ situacao: "pedida", falhas: 0, valor, chaveEmDuvida: dev.chaveAceita, ...(dev.chaveAceita ? {} : { idProvedor: null }), ultimoCodigo: null, proximaTentativaEm: agora, autorId, atualizadoEm: agora })
        .where(eq(devolucoesPagamento.id, dev.id))
        .returning();
      Object.assign(dev, linha);
      id = dev.id;
      await avisosNaDevolucao(tx, t, p, dev, { desligar: ["devolucao_falhou", "devolucao_parada", "devolucao_fora_do_prazo"] }, agora);
    } else {
      const motivo = textoMotivoSemReserva(p.motivoSemReserva) ?? "Pagamento sem reserva.";
      const [linha] = await tx
        .insert(devolucoesPagamento)
        .values({ organizacaoId, pagamentoId: p.id, motivo, valor, situacao: "pedida", proximaTentativaEm: agora, autorId, criadoEm: agora, atualizadoEm: agora })
        .returning();
      t.devolucoes.push(linha);
      id = linha.id;
      await sincronizarAvisosDoPagamento(tx, t, p, agora);
    }
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.devolver", entidade: "pagamento", entidadeId: p.id, mudancas: { devolucao: [dev?.situacao ?? null, "pedida"], valor: [null, valor] } });
    return { ok: true as const, id };
  });
  if (!r.ok) return r;
  const situacao = await tentarDevolucao(db, organizacaoId, r.id, provedor, agora);
  return { ok: true, situacao: situacao ?? "pedida" };
}

/**
 * "Pedir o restante ao Mercado Pago" (D15, `financeiro:editar`): a devolução que o Mercado Pago confirmou a menos (com o
 * aviso) ganha a devolução do restante (o pedido menos o que voltou), com chave nova e o valor explícito; o aviso da de
 * origem sai. Uma por devolução (índice único). Conferido o teto sob a trava; depois, o pedido (`tentarDevolucao`).
 */
export async function pedirRestanteDaDevolucao(db: Db, organizacaoId: string, devolucaoId: string, autorId: string | null, provedor: ProvedorPagamento, agora: Date = new Date()): Promise<ResultadoAcaoPagamento> {
  let r: { ok: true; id: string } | { ok: false; erro: string };
  try {
    r = await comAlvo(db, organizacaoId, { devolucaoId }, undefined, async (tx, t, p, dev, devs) => {
      if (!dev || dev.situacao !== "confirmada" || !dev.avisos.includes("devolucao_a_menor") || dev.valorConfirmado === null)
        return { ok: false as const, erro: "Só uma devolução que o Mercado Pago fez a menos tem o restante pedido." };
      if (t.devolucoes.some((x) => x.origemDevolucaoId === dev.id)) return { ok: false as const, erro: "O restante desta devolução já foi registrado." };
      const valor = dev.valor - dev.valorConfirmado;
      if (valor <= 0) return { ok: false as const, erro: "Esta devolução não tem restante." };
      if (devs.some((x) => x.situacao === "pedida")) return { ok: false as const, erro: "Já há uma devolução pedida ao Mercado Pago para este pagamento." };
      if (!cabeNoTeto(p, devs, valor)) return { ok: false as const, erro: ERRO_TETO };
      const [linha] = await tx
        .insert(devolucoesPagamento)
        .values({
          organizacaoId,
          pagamentoId: p.id,
          origem: dev.origem,
          cancelamentoId: dev.cancelamentoId,
          alteracaoId: dev.alteracaoId,
          origemDevolucaoId: dev.id,
          valor,
          situacao: "pedida",
          motivo: `Restante da devolução de ${hojeISO(FUSO_PAGAMENTO, dev.criadoEm).split("-").reverse().slice(0, 2).join("/")}`,
          proximaTentativaEm: agora,
          autorId,
          criadoEm: agora,
          atualizadoEm: agora,
        })
        .returning();
      t.devolucoes.push(linha);
      await avisosNaDevolucao(tx, t, p, dev, { desligar: ["devolucao_a_menor"] }, agora);
      await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.devolucao_restante", entidade: "pagamento", entidadeId: p.id, mudancas: { restante: [null, valor], devolucao: [null, dev.id] } });
      return { ok: true as const, id: linha.id };
    });
  } catch (erro) {
    if (violouUnicidadeDaDevolucao(erro)) return { ok: false, erro: "O restante desta devolução já foi registrado." };
    throw erro;
  }
  if (!r.ok) return r;
  const situacao = await tentarDevolucao(db, organizacaoId, r.id, provedor, agora);
  return { ok: true, situacao: situacao ?? "pedida", devolucaoId: r.id };
}

const violouUnicidadeDaDevolucao = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code === "23505" || x?.cause?.code === "23505";
};

export const ERRO_POR_FORA_SEM_CONFERIR =
  "Não deu para conferir no Mercado Pago se a devolução já foi feita por lá. Sem essa conferência, a devolução feita por fora não é registrada (para o hóspede não receber duas vezes): tente de novo em instantes.";

/**
 * Recusa da devolução por fora pelo que o provedor mostra agora (D16): devolvido por inteiro, uma devolução que o sistema
 * não pediu, em andamento, contestado, ou outra situação que não aprovado (ou devolvido em parte pelas nossas
 * devoluções); null = pode.
 */
function recusaPeloProvedor(c: Cobranca, p: Pagamento, devs: readonly Devolucao[]): string | null {
  const situacao = situacaoExplicada(c, p, devs);
  if (situacao === "devolvido") return "O Mercado Pago mostra este pagamento como devolvido: a devolução por fora não é registrada, para o hóspede não receber duas vezes. Confira no painel do Mercado Pago.";
  const lido = { situacao: situacao ?? p.situacao, devolvidoLido: devolvidoDa(c), devolvidoForaReconhecido: p.devolvidoForaReconhecido };
  if (devolucaoInexplicada(lido, devs))
    return "O Mercado Pago mostra uma devolução deste pagamento que o sistema não pediu: a devolução por fora não é registrada, para o hóspede não receber duas vezes. Confira no painel do Mercado Pago e use Conferir agora.";
  if (c.devolucaoEmAndamento) return "O Mercado Pago mostra uma devolução em andamento neste pagamento: espere ela concluir (use Conferir agora) em vez de devolver por fora.";
  if (c.situacao === "contestado") return "Este pagamento está contestado no Mercado Pago: o dinheiro pode voltar ao hóspede pela contestação. Resolva pelo painel do Mercado Pago, sem devolver por fora.";
  if (situacao !== "aprovado" && situacao !== "devolvido_parcial") return "O Mercado Pago não mostra este pagamento como aprovado agora: confira no painel do Mercado Pago antes de registrar a devolução por fora.";
  return null;
}

/**
 * Lança a despesa da taxa que não voltou (empresa, realizada), na categoria da aba Pagamento no site: o imóvel e, quando o
 * dinheiro é da reserva (cancelamento, alteração e o restante delas), a reserva. Sob as travas de quem chama. Devolve o
 * lançamento, ou o erro da categoria (arquivada).
 */
async function lancarTaxaPerdida(tx: Db, organizacaoId: string, t: Travado, p: Pagamento, valor: number, data: string, chave: string, autorId: string | null): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  const categoria = await categoriaDaTaxaPerdida(tx, organizacaoId, autorId);
  if (!categoria.ok) return categoria;
  const [l] = await lancar(
    tx,
    organizacaoId,
    [
      {
        tipo: "despesa_empresa",
        descricao: `Taxa do pagamento do site que o Mercado Pago não devolveu (cotação ${t.cotacao.codigo}, reserva ${t.reserva.codigo})`,
        valor: -valor,
        montante: valor,
        efeitoSaldo: 0,
        competencia: data,
        dataCaixa: data,
        estado: "realizado",
        imovelId: t.imovel.id,
        reservaId: dinheiroDaReserva(p) ? t.reserva.id : null,
        categoriaId: categoria.id,
        origem: "manual",
        chaveOrigem: chave,
      },
    ],
    autorId,
  );
  return { ok: true, id: l.id };
}

/**
 * A devolução é a integral do pagamento, a única dele (o mundo do M8.2a e do M8.2c): nada reconhecido fora, nenhuma outra
 * viva, e o corpo vazio (ou o valor do pago; ou uma linha antiga, de antes do formato do corpo).
 */
const integralDoPagamento = (p: Pagamento, dev: Devolucao, devs: readonly Devolucao[]) =>
  devs.every((x) => x.id === dev.id) &&
  p.devolvidoForaReconhecido === 0 &&
  (dev.corpoIntegral === true || dev.valor >= valorPagoAprovado(p) || (dev.corpoIntegral === null && dev.origem !== "alteracao" && dev.origemDevolucaoId === null));

/** Esta devolução completa o pagamento (o reconhecido e as realizadas, com ela, alcançam o pago). */
const completaOPagamento = (p: Pagamento, dev: Devolucao, devs: readonly Devolucao[]) =>
  p.devolvidoForaReconhecido + devs.filter((x) => x.id !== dev.id && (x.situacao === "confirmada" || x.situacao === "por_fora")).reduce((s, x) => s + comprometido(x), 0) + comprometido(dev) >= valorPagoAprovado(p);

/** O montante em vigor da saída de caixa desta devolução (0 sem saída). */
async function saidaDaDevolucao(tx: Db, organizacaoId: string, dev: Devolucao): Promise<number> {
  if (!dev.saidaLancamentoId) return 0;
  const [l] = await tx.select({ montante: lancamentos.montante, estornoDe: lancamentos.estornoDe }).from(lancamentos).where(and(eq(lancamentos.id, dev.saidaLancamentoId), eq(lancamentos.organizacaoId, organizacaoId)));
  return l?.montante ?? 0;
}

/**
 * A taxa que não voltou numa devolução feita por fora, derivada (§6.2): na integral do pagamento, o devolvido menos o que
 * entrou (os recebimentos em vigor) ou menos o líquido informado quando nada entrou (M8.2c); na que completa o pagamento
 * com o recebimento lançado, o devolvido menos a saída do caixa; nas outras, a taxa atribuída ao principal (D19), com os
 * juros quando ela cruza o valor da reserva. Taxa divergente ou nada conhecido: null (aviso, a equipe informa).
 */
async function taxaPerdidaDerivada(tx: Db, organizacaoId: string, p: Pagamento, dev: Devolucao, devs: readonly Devolucao[], agora: Date): Promise<number | null> {
  const devolvido = dev.porForaValor ?? dev.valor;
  const recebidos = (await recebimentosDoPagamento(tx, organizacaoId, p.id)).emVigor.filter((l) => l.estado === "realizado" || l.estado === "conciliado");
  const soma = recebidos.reduce((s, l) => s + (l.montante ?? 0), 0);
  let taxa: number | null = null;
  if (integralDoPagamento(p, dev, devs)) {
    if (soma > 0 && !p.avisos.includes("taxa_divergente")) taxa = devolvido - soma;
    else if (soma === 0 && p.liquido !== null) taxa = devolvido - p.liquido;
  } else if (completaOPagamento(p, dev, devs) && soma > 0 && dev.caixaLancadoEm) {
    if (!p.avisos.includes("taxa_divergente")) taxa = devolvido - (await saidaDaDevolucao(tx, organizacaoId, dev));
  } else if (p.taxa !== null && !p.avisos.includes("taxa_divergente")) {
    const atribuida = await congelarTaxaAtribuida(tx, p, dev, devs, agora);
    taxa = atribuida === null ? null : atribuida + jurosDaDevolucao(p, dev, devs);
  }
  return taxa !== null && taxa < 0 ? null : taxa;
}

/**
 * Devolução feita por fora (Pix da conta da empresa, por exemplo): data até hoje, o valor que a devolução deve e nota (sem
 * dado pessoal). Alvo: a devolução (pelo id), o restante de uma que o Mercado Pago fez a menos (`restanteDe`, uma linha
 * nova) ou o pagamento (sem reserva: a devolução dele, nova com o restante do pagamento, D17; com o reconhecimento do que
 * o painel do Mercado Pago já devolveu). Antes, a order é relida no provedor (fora de transação): outra order (id ou
 * referência diferentes), devolvida, com devolução que o sistema não pediu, em andamento ou contestada = recusa; sem
 * conseguir ler (ou sem provedor), recusa também. A leitura é aplicada (pode confirmar uma devolução pedida). Escreve só na
 * linha dela (D16: nunca enviada, ou recusada sem a chave em dúvida). A taxa que não voltou é derivada
 * (`taxaPerdidaDerivada`); o caixa da devolução da reserva fica lançado com a data informada (o desfecho continua o da
 * reserva); o pagamento sem reserva ganha o desfecho quando fica completo.
 */
export async function registrarDevolucaoPorFora(
  db: Db,
  organizacaoId: string,
  alvoBruto: AlvoDaDevolucao | { restanteDe: string } | string,
  d: { data: string; valor: number; nota: string; valorForaInformado?: number },
  autorId: string | null,
  provedor: ProvedorPagamento | null,
  agora: Date = new Date(),
): Promise<ResultadoAcaoPagamento> {
  if (!dataValida(d.data)) return { ok: false, erro: "Data da devolução inválida." };
  if (d.data > hojeISO(FUSO_PAGAMENTO, agora)) return { ok: false, erro: "A data da devolução não pode ser no futuro." };
  if (!Number.isSafeInteger(d.valor) || d.valor <= 0) return { ok: false, erro: "Informe o valor devolvido (maior que zero)." };
  const nota = d.nota.trim();
  const problema = problemaDaNota(nota, false);
  if (problema) return { ok: false, erro: problema };
  const restanteDe = typeof alvoBruto === "object" && "restanteDe" in alvoBruto ? alvoBruto.restanteDe : null;
  const alvo: AlvoDaDevolucao = restanteDe ? { devolucaoId: restanteDe } : comoAlvo(alvoBruto as AlvoDaDevolucao | string);
  const resolvido = await resolverAlvo(db, organizacaoId, alvo);
  if (!resolvido) return { ok: false, erro: "devolucaoId" in alvo ? "Devolução não encontrada." : "Pagamento não encontrado." };
  const [lido] = await db.select({ idProvedor: pagamentos.idProvedor, referencia: pagamentos.referencia, criadoEm: pagamentos.criadoEm }).from(pagamentos).where(and(eq(pagamentos.id, resolvido.pagamentoId), eq(pagamentos.organizacaoId, organizacaoId)));
  if (!lido) return { ok: false, erro: "Pagamento não encontrado." };
  if (!provedor) return { ok: false, erro: ERRO_POR_FORA_SEM_CONFERIR };
  if (!lido.idProvedor) return { ok: false, erro: "Este pagamento não tem identificação no Mercado Pago para conferir: confira no painel do Mercado Pago." };
  let cobranca: Cobranca | null;
  try {
    cobranca = await provedor.consultar(lido.idProvedor);
  } catch {
    return { ok: false, erro: ERRO_POR_FORA_SEM_CONFERIR };
  }
  // Order não encontrada: dentro do prazo de releitura, nada se registra sem conferir. Passado esse prazo (o Mercado Pago
  // só guarda a order por RETENCAO_ORDERS_DIAS; o cartão depois dos 180 dias em que ele devolve cai sempre aqui), não
  // há mais o que reler: vale o que o sistema já conferiu enquanto ela existia, com as regras locais de sempre.
  const semOrderParaReler = !cobranca && lido.criadoEm.getTime() < inicioDoPrazoDeReleitura(agora).getTime();
  if (!cobranca && !semOrderParaReler) return { ok: false, erro: "O Mercado Pago não encontrou este pagamento: confira no painel do Mercado Pago antes de registrar a devolução por fora." };
  if (cobranca) {
    // O que o provedor mostra também vale para o sistema (situação nova, devolução pedida que saiu…).
    try {
      await conferirTentativa(db, organizacaoId, resolvido.pagamentoId, provedor, agora, { forcar: true, origem: "painel", cobranca });
    } catch {
      // A recusa abaixo vem da leitura, não da aplicação.
    }
    // A order lida precisa ser a deste pagamento (id e referência): a de outra tentativa não diz nada sobre esta.
    if (cobranca.idProvedor !== lido.idProvedor || cobranca.referencia !== lido.referencia)
      return { ok: false, erro: "A resposta do Mercado Pago não bate com este pagamento (referência ou identificação diferentes): nada foi registrado. Confira no painel do Mercado Pago." };
  }
  return comAlvo(db, organizacaoId, alvo, (x) => x.situacao === "pedida" || x.situacao === "recusada", async (tx, t, p, devAlvo, devs) => {
    // A devolução do alvo: o restante (nova), a do id, ou a do pagamento (sem reserva: a principal dele, ou nova).
    let dev: Devolucao | undefined;
    let devido: number;
    let reconhecido = p.devolvidoForaReconhecido;
    if (restanteDe) {
      const origem = devAlvo;
      if (!origem || origem.situacao !== "confirmada" || !origem.avisos.includes("devolucao_a_menor") || origem.valorConfirmado === null)
        return { ok: false as const, erro: "Só uma devolução que o Mercado Pago fez a menos tem o restante registrado por fora." };
      if (t.devolucoes.some((x) => x.origemDevolucaoId === origem.id)) return { ok: false as const, erro: "O restante desta devolução já foi registrado." };
      devido = origem.valor - origem.valorConfirmado;
      // A regra do cartão vale para o restante (uma linha nova, nunca enviada): só com o cartão aberto para a por fora.
      if (!porForaPermitidoNoCartao(p, undefined, agora)) return { ok: false as const, erro: ERRO_POR_FORA_CARTAO };
    } else {
      dev = "devolucaoId" in alvo ? devAlvo : p.desfecho === null && !dinheiroDaReserva(p) ? principalSemReserva(devs) : devAlvo;
      const recusa = recusaDoPedido(p, dev, devs, t, true, agora);
      if (recusa) return { ok: false as const, erro: recusa };
      if (!dev || dev.origem === "sem_reserva") {
        // D17: o restante, com o que o painel do Mercado Pago já devolveu reconhecido (gravado só se o valor bater). Sem
        // order para reler (passou do tempo em que o Mercado Pago a guarda), vale o último pago que o sistema conferiu.
        const fora = reconhecidoFora(p, devs, d.valorForaInformado);
        if (!fora.ok) return fora;
        reconhecido = fora.valor;
        devido = saldoDevolvivel({ ...p, devolvidoForaReconhecido: reconhecido }, devs.filter((x) => x.id !== dev?.id));
      } else devido = dev.valor;
    }
    // O que o Mercado Pago mostra agora (com o devolvido pelo painel dele já reconhecido, no restante sem reserva).
    if (cobranca) {
      const peloProvedor = recusaPeloProvedor(cobranca, { ...p, devolvidoForaReconhecido: reconhecido }, devs);
      if (peloProvedor) return { ok: false as const, erro: peloProvedor };
    }
    if (d.valor !== devido)
      return {
        ok: false as const,
        erro: `A devolução por fora registra o valor desta devolução: ${formatBRL(devido)}${!cobranca && !restanteDe && (!dev || dev.origem === "sem_reserva") ? " (o último conferido no Mercado Pago)" : ""}.`,
      };
    const outras = devs.filter((x) => x.id !== dev?.id);
    if (!cabeNoTeto({ ...p, devolvidoForaReconhecido: reconhecido }, outras, d.valor)) return { ok: false as const, erro: ERRO_TETO };
    // A devolução não pode ser de antes do pagamento existir (o pagamento foi criado neste dia, em São Paulo).
    const criadoNoDia = hojeISO(FUSO_PAGAMENTO, p.criadoEm);
    if (d.data < criadoNoDia) return { ok: false as const, erro: `A data da devolução não pode ser antes do pagamento (${criadoNoDia.split("-").reverse().join("/")}). Confira a data.` };
    await gravarReconhecido(tx, organizacaoId, p, reconhecido, autorId, agora);
    const motivo = textoMotivoSemReserva(p.motivoSemReserva) ?? "Pagamento sem reserva.";
    const valores = { situacao: "por_fora" as const, porForaData: d.data, porForaValor: d.valor, porForaNota: nota, proximaTentativaEm: null, chaveEmDuvida: false, autorId, atualizadoEm: agora };
    let linha: Devolucao;
    if (dev) {
      [linha] = await tx.update(devolucoesPagamento).set(valores).where(eq(devolucoesPagamento.id, dev.id)).returning();
      Object.assign(dev, linha);
      linha = dev;
    } else {
      const origem = restanteDe ? devAlvo! : null;
      [linha] = await tx
        .insert(devolucoesPagamento)
        .values({
          organizacaoId,
          pagamentoId: p.id,
          motivo: origem ? `Restante da devolução de ${hojeISO(FUSO_PAGAMENTO, origem.criadoEm).split("-").reverse().slice(0, 2).join("/")}` : motivo,
          valor: d.valor,
          ...(origem ? { origem: origem.origem, cancelamentoId: origem.cancelamentoId, alteracaoId: origem.alteracaoId, origemDevolucaoId: origem.id } : {}),
          ...valores,
          criadoEm: agora,
        })
        .returning();
      t.devolucoes.push(linha);
      if (origem) await trocarAvisosDaDevolucao(tx, origem, { desligar: ["devolucao_a_menor"] }, agora);
    }
    const vivas = devolucoesDoPagamento(t, p.id);
    const daReserva = linha.origem !== "sem_reserva";
    // O caixa da devolução da reserva (o desfecho continua o da reserva), com a data informada; antes da taxa derivada.
    const caixa = daReserva ? await acertarCaixaDaDevolucao(tx, organizacaoId, t, p, linha, { data: d.data, estado: "realizado", origem: "manual" }, agora, autorId) : { avisos: [] };
    const taxa = await taxaPerdidaDerivada(tx, organizacaoId, p, linha, vivas, agora);
    let semTaxa = taxa === null;
    if (taxa !== null && linha.taxaPerdida === null) {
      let despesa: string | null = null;
      if (taxa > 0) {
        const l = await lancarTaxaPerdida(tx, organizacaoId, t, p, taxa, d.data, chaveTaxaPerdida(p.id, linha.id), autorId);
        if (l.ok) despesa = l.id;
        else semTaxa = true;
      }
      if (!semTaxa) {
        await tx.update(devolucoesPagamento).set({ taxaPerdida: taxa, despesaLancamentoId: despesa, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, linha.id));
        Object.assign(linha, { taxaPerdida: taxa, despesaLancamentoId: despesa });
      }
    }
    if (!daReserva) await desfechoSemReserva(tx, p, vivas, { motivo: nota || motivo, autorId }, agora);
    // O aviso de a menor do restante que o Mercado Pago recusou (D15) sai: o restante foi devolvido por fora.
    await trocarAvisosDaDevolucao(
      tx,
      linha,
      {
        desligar: [
          "devolucao_falhou",
          "devolucao_parada",
          "devolucao_sem_confirmacao",
          "devolucao_fora_do_prazo",
          "devolucao_aguardando_liberacao_atrasada",
          "devolucao_a_menor",
          ...(semTaxa ? [] : (["taxa_perdida_desconhecida"] as CodigoAviso[])),
        ],
        ligar: [...(semTaxa ? (["taxa_perdida_desconhecida"] as CodigoAviso[]) : []), ...caixa.avisos.filter((a) => a !== "taxa_perdida_desconhecida")],
      },
      agora,
    );
    await sincronizarAvisosDoPagamento(tx, t, p, agora);
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "pagamento.devolucao_por_fora",
      entidade: "pagamento",
      entidadeId: p.id,
      mudancas: { ...(p.desfecho === "por_fora" && !daReserva ? { desfecho: [null, "por_fora"] } : {}), devolucao: [null, `${d.valor} em ${d.data}`], ...(semTaxa ? {} : { taxaPerdida: [null, taxa] }) },
    });
    return { ok: true as const, situacao: "por_fora" as const };
  });
}

/** A data e a nota de um registro da equipe (confirmação ou recusa no painel do Mercado Pago). */
function problemaDoRegistro(d: { data: string; nota: string }, agora: Date): string | null {
  if (!dataValida(d.data)) return "Data inválida.";
  if (d.data > hojeISO(FUSO_PAGAMENTO, agora)) return "A data não pode ser no futuro.";
  return problemaDaNota(d.nota.trim(), true);
}

/** A leitura não tem como confirmar esta devolução (aceita sem aparecer, a menor, parada, ou situação desconhecida). */
const semConfirmacaoPelaLeitura = (p: Pagamento, dev: Devolucao, devs: readonly Devolucao[]) => {
  const avisos = avisosDaDevolucao(p, dev, devs.every((x) => x.id === dev.id));
  return avisos.includes("devolucao_sem_confirmacao") || avisos.includes("devolucao_a_menor") || avisos.includes("devolucao_parada") || p.avisos.includes("situacao_desconhecida");
};

/**
 * "Confirmar devolução feita no painel do Mercado Pago" (M8.2c, `financeiro:editar`): a equipe viu no painel do Mercado
 * Pago a devolução concluída e o sistema não tem como ver (pagamento fora do prazo de leitura; ou a leitura não confirma:
 * devolução aceita sem aparecer, a menor, parada, situação que o sistema não reconhece). Com o valor que o painel mostra
 * (até o pedido; menos que o pedido = confirmada por esse valor, com o aviso de a menor, D15). Nunca numa devolução que
 * nunca foi pedida (esperando a liberação). Com provedor, a order é relida antes (fora de transação): se ela confirma
 * sozinha, vale a leitura. Sem provedor, só quando a order com certeza não existe mais. Lança o caixa da devolução da
 * reserva com a data informada (realizado) e liga o aviso da taxa.
 */
export async function confirmarDevolucaoVistaNoProvedor(
  db: Db,
  organizacaoId: string,
  alvoBruto: AlvoDaDevolucao | string,
  d: { data: string; nota: string; valor?: number },
  autorId: string | null,
  provedor: ProvedorPagamento | null,
  agora: Date = new Date(),
): Promise<ResultadoAcaoPagamento> {
  const problema = problemaDoRegistro(d, agora);
  if (problema) return { ok: false, erro: problema };
  const nota = d.nota.trim();
  const alvo = comoAlvo(alvoBruto);
  const r = await resolverAlvo(db, organizacaoId, alvo);
  if (!r) return { ok: false, erro: "devolucaoId" in alvo ? "Devolução não encontrada." : "Pagamento não encontrado." };
  const [lido] = await db.select().from(pagamentos).where(and(eq(pagamentos.id, r.pagamentoId), eq(pagamentos.organizacaoId, organizacaoId)));
  if (!lido) return { ok: false, erro: "Pagamento não encontrado." };
  const vivasLidas = devolucoesDoPagamento({ devolucoes: await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.pagamentoId, lido.id)) }, lido.id);
  const devLida = devolucaoDoAlvo(vivasLidas, r.devolucaoId, (x) => x.situacao === "pedida" || x.situacao === "recusada");
  const NAO_HA = "Não há devolução pedida ou recusada para confirmar neste pagamento.";
  if (!devLida || (devLida.situacao !== "pedida" && devLida.situacao !== "recusada")) return { ok: false, erro: NAO_HA };
  // Nada foi pedido ao Mercado Pago (a devolução espera a liberação do pagamento): não há o que confirmar no painel dele.
  if (devLida.tentativas === 0 && devLida.ultimoCodigo === "aguardando_liberacao")
    return { ok: false, erro: "Esta devolução ainda não foi pedida ao Mercado Pago (espera a liberação do pagamento): não há devolução dela no painel dele para confirmar." };
  if (d.valor !== undefined && (!Number.isSafeInteger(d.valor) || d.valor < 1 || d.valor > devLida.valor))
    return { ok: false, erro: `Informe o valor que o painel do Mercado Pago mostra (até ${formatBRL(devLida.valor)}).` };
  const foraDaLeitura = lido.criadoEm.getTime() < inicioDoPrazoDeReleitura(agora).getTime();
  const semLeitura = semConfirmacaoPelaLeitura(lido, devLida, vivasLidas);
  const AINDA_CONFERE = "O Mercado Pago ainda deixa conferir este pagamento: use Conferir agora (a confirmação vem da leitura).";
  if (!foraDaLeitura && !semLeitura) return { ok: false, erro: AINDA_CONFERE };
  if (!provedor) {
    // Sem como reler: só quando a order com certeza não existe mais (passou do tempo em que o Mercado Pago a guarda).
    if (lido.criadoEm.getTime() >= agora.getTime() - RETENCAO_ORDERS_DIAS * 86_400_000) return { ok: false, erro: ERRO_POR_FORA_SEM_CONFERIR };
  } else if (lido.idProvedor) {
    let cobranca: Cobranca | null;
    try {
      cobranca = await provedor.consultar(lido.idProvedor);
    } catch {
      return { ok: false, erro: ERRO_POR_FORA_SEM_CONFERIR };
    }
    if (cobranca) {
      try {
        await conferirTentativa(db, organizacaoId, lido.id, provedor, agora, { forcar: true, origem: "painel", cobranca });
      } catch {
        return { ok: false, erro: ERRO_POR_FORA_SEM_CONFERIR };
      }
      if ((await situacaoDaDevolucao(db, devLida.id)) === "confirmada") return { ok: true, situacao: "confirmada", mensagem: "O Mercado Pago já mostra a devolução: confirmada pela leitura." };
      // A order ainda aparece e não confirma: sem aviso, a confirmação vem da leitura (Conferir agora), também depois do
      // prazo de leitura, enquanto o Mercado Pago ainda mostra a order. Com um dos avisos, a leitura não tem como
      // confirmar, dentro ou fora do prazo: a equipe confirma o que vê no painel dele.
      if (!semLeitura) return { ok: false, erro: AINDA_CONFERE };
    }
  }
  return comAlvo(db, organizacaoId, { devolucaoId: devLida.id }, undefined, async (tx, t, p, dev, devs) => {
    if (!dev || (dev.situacao !== "pedida" && dev.situacao !== "recusada")) return { ok: false as const, erro: NAO_HA };
    if (!origemDeDevolucaoConhecida(dev.origem) || !cabeNoPagamento(dev, p, t)) return { ok: false as const, erro: "Esta devolução não cabe mais neste pagamento: confira o quadro Pagamento no site." };
    if (d.data < hojeISO(FUSO_PAGAMENTO, dev.criadoEm)) return { ok: false as const, erro: `A data não pode ser antes de a devolução ser registrada (${hojeISO(FUSO_PAGAMENTO, dev.criadoEm).split("-").reverse().join("/")}).` };
    const valor = d.valor ?? dev.valor;
    const outras = devs.filter((x) => x.id !== dev.id);
    if (!cabeNoTeto(p, outras, valor)) return { ok: false as const, erro: ERRO_TETO };
    const aMenor = valor < dev.valor;
    const antes = dev.situacao;
    const mudanca = {
      situacao: "confirmada" as const,
      confirmadaEm: instanteLocal(d.data, "12:00", FUSO_PAGAMENTO),
      confirmadaPor: "equipe" as const,
      confirmadaNota: nota,
      valorConfirmado: d.valor === undefined ? dev.valorConfirmado : valor,
      chaveEmDuvida: false,
      chaveAceita: false,
      proximaTentativaEm: null,
      autorId,
      atualizadoEm: agora,
    };
    const [linha] = await tx.update(devolucoesPagamento).set(mudanca).where(eq(devolucoesPagamento.id, dev.id)).returning();
    Object.assign(dev, linha);
    if (aMenor && dev.taxaAtribuida !== null) {
      // D15: a taxa atribuída congela de novo, uma vez, no que de fato voltou.
      dev.taxaAtribuida = null;
      await tx.update(devolucoesPagamento).set({ taxaAtribuida: null }).where(eq(devolucoesPagamento.id, dev.id));
    }
    let caixa: CodigoAviso[] = [];
    if (dev.origem === "sem_reserva") await desfechoSemReserva(tx, p, devs, { motivo: dev.motivo, autorId }, agora);
    else caixa = (await acertarCaixaDaDevolucao(tx, organizacaoId, t, p, dev, { data: d.data, estado: "realizado", origem: "manual" }, agora, autorId)).avisos;
    await trocarAvisosDaDevolucao(
      tx,
      dev,
      {
        desligar: ["devolucao_fora_do_prazo", "devolucao_sem_confirmacao", "devolucao_falhou", "devolucao_parada", "devolucao_aguardando_liberacao_atrasada", ...(aMenor ? [] : (["devolucao_a_menor"] as CodigoAviso[]))],
        ligar: [...(dev.taxaPerdida === null ? (["taxa_perdida_desconhecida"] as CodigoAviso[]) : []), ...(aMenor ? (["devolucao_a_menor"] as CodigoAviso[]) : []), ...caixa],
      },
      agora,
    );
    await sincronizarAvisosDoPagamento(tx, t, p, agora);
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "pagamento.devolucao_confirmada_pela_equipe",
      entidade: "pagamento",
      entidadeId: p.id,
      mudancas: { devolucao: [antes, "confirmada"], data: [null, d.data], ...(d.valor !== undefined ? { valor: [null, valor] } : {}) },
    });
    return { ok: true as const, situacao: "confirmada" as const };
  });
}

/**
 * A recusa do painel pode ser registrada (uma regra; o quadro do pagamento lê daqui): devolução recusada; pedida sem aceite
 * depois do prazo de leitura; ou pedida e aceita que a leitura nunca confirmou (aviso de sem confirmação, da devolução) —
 * a que falhou sem o sistema saber o id dela, que nada solta sozinho — com a última leitura sem nada devolvido além das
 * outras devoluções nossas e nada em andamento.
 */
export function podeRegistrarRecusaNoPainel(
  p: Pick<Pagamento, "criadoEm" | "situacao" | "avisos" | "devolvidoLido" | "devolucaoEmAndamentoLida"> & { devolvidoForaReconhecido?: number },
  dev: (Devolucao | (Omit<Devolucao, "avisos"> & { avisos?: string[] })) | undefined,
  agora: Date,
  outras: readonly Devolucao[] = [],
): boolean {
  if (!dev || !origemDeDevolucaoConhecida(dev.origem) || dev.recusaNoPainelEm || dev.situacao === "substituida") return false;
  if (dev.situacao === "recusada") return true;
  if (dev.situacao !== "pedida") return false;
  if (!dev.chaveAceita) return p.criadoEm.getTime() < inicioDoPrazoDeReleitura(agora).getTime();
  const explicado = (p.devolvidoForaReconhecido ?? 0) + devolvidoProprio(outras);
  return avisosDaDevolucao(p, dev, outras.length === 0).includes("devolucao_sem_confirmacao") && (p.situacao === "aprovado" || p.situacao === "devolvido_parcial") && p.devolvidoLido <= explicado && !p.devolucaoEmAndamentoLida;
}

/**
 * "Registrar que o Mercado Pago recusou a devolução no painel" (M8.2c, `financeiro:editar`): a devolução ficou recusada
 * aqui (ou pedida sem aceite, depois do prazo de leitura; ou aceita e nunca confirmada, `podeRegistrarRecusaNoPainel`) e
 * o painel do Mercado Pago também recusou. Sai da espera (recusada, chaves desligadas) e libera a devolução por fora no
 * cartão. Data e nota (sem dado pessoal), auditadas.
 */
export async function registrarRecusaNoPainel(db: Db, organizacaoId: string, alvoBruto: AlvoDaDevolucao | string, d: { data: string; nota: string }, autorId: string | null, agora: Date = new Date()): Promise<ResultadoAcaoPagamento> {
  const problema = problemaDoRegistro(d, agora);
  if (problema) return { ok: false, erro: problema };
  const nota = d.nota.trim();
  return comAlvo(db, organizacaoId, comoAlvo(alvoBruto), (x) => x.situacao === "pedida" || x.situacao === "recusada", async (tx, t, p, dev, devs) => {
    if (dev?.recusaNoPainelEm) return { ok: false as const, erro: "A recusa do painel do Mercado Pago já foi registrada." };
    if (!dev || !podeRegistrarRecusaNoPainel(p, dev, agora, devs.filter((x) => x.id !== dev.id)))
      return { ok: false as const, erro: "Só uma devolução recusada (ou pedida, sem aceite, depois do prazo de leitura do Mercado Pago; ou aceita que o Mercado Pago nunca confirmou) pode ter a recusa do painel registrada." };
    if (d.data < hojeISO(FUSO_PAGAMENTO, dev.criadoEm)) return { ok: false as const, erro: "A data não pode ser antes de a devolução ser registrada." };
    const [linha] = await tx
      .update(devolucoesPagamento)
      .set({ situacao: "recusada", proximaTentativaEm: null, chaveEmDuvida: false, chaveAceita: false, recusaNoPainelEm: instanteLocal(d.data, "12:00", FUSO_PAGAMENTO), recusaNoPainelPor: autorId, recusaNoPainelNota: nota, atualizadoEm: agora })
      .where(eq(devolucoesPagamento.id, dev.id))
      .returning();
    Object.assign(dev, linha);
    await avisosNaDevolucao(tx, t, p, dev, { desligar: ["devolucao_sem_confirmacao"], ligar: ["devolucao_falhou"] }, agora);
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.devolucao_recusada_no_painel", entidade: "pagamento", entidadeId: p.id, mudancas: { recusaNoPainel: [null, d.data] } });
    return { ok: true as const, situacao: "recusada" as const };
  });
}

/**
 * "Parar a devolução pedida" (M8.2c, `financeiro:editar`): uma devolução ainda pedida quando o pagamento já saiu do prazo
 * de leitura (o sistema não confere mais). Sem pedido aceito nem em dúvida, para direto. Com ele, só quando o Mercado Pago
 * não acha mais a order e a equipe escreve que o painel não mostra devolução nenhuma. Depois disso, a devolução por fora
 * (Pix) e os caminhos do cartão ficam abertos.
 */
export async function pararDevolucaoPedida(db: Db, organizacaoId: string, alvoBruto: AlvoDaDevolucao | string, d: { nota: string }, autorId: string | null, provedor: ProvedorPagamento | null, agora: Date = new Date()): Promise<ResultadoAcaoPagamento> {
  const nota = d.nota.trim();
  const alvo = comoAlvo(alvoBruto);
  const r = await resolverAlvo(db, organizacaoId, alvo);
  if (!r) return { ok: false, erro: "devolucaoId" in alvo ? "Devolução não encontrada." : "Pagamento não encontrado." };
  const [lido] = await db.select().from(pagamentos).where(and(eq(pagamentos.id, r.pagamentoId), eq(pagamentos.organizacaoId, organizacaoId)));
  if (!lido) return { ok: false, erro: "Pagamento não encontrado." };
  const devLida = devolucaoDoAlvo(devolucoesDoPagamento({ devolucoes: await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.pagamentoId, lido.id)) }, lido.id), r.devolucaoId, (x) => x.situacao === "pedida");
  const FORA = "Só se para uma devolução pedida depois do prazo de leitura do Mercado Pago (85 dias): antes disso, o sistema confere sozinho.";
  if (!devLida || devLida.situacao !== "pedida" || lido.criadoEm.getTime() >= inicioDoPrazoDeReleitura(agora).getTime()) return { ok: false, erro: FORA };
  const comAceite = devLida.chaveAceita || devLida.chaveEmDuvida;
  const problema = problemaDaNota(nota, comAceite);
  if (problema) return { ok: false, erro: comAceite && !nota ? "Escreva a nota: o que o painel do Mercado Pago mostra (nenhuma devolução saiu)." : problema };
  if (comAceite) {
    // Pedido que o Mercado Pago pode ter aceito: só com a order fora da leitura dele (nada mais vai aparecer por aqui).
    if (!provedor || !lido.idProvedor) return { ok: false, erro: ERRO_POR_FORA_SEM_CONFERIR };
    let cobranca: Cobranca | null;
    try {
      cobranca = await provedor.consultar(lido.idProvedor);
    } catch {
      return { ok: false, erro: ERRO_POR_FORA_SEM_CONFERIR };
    }
    if (cobranca) return { ok: false, erro: "O Mercado Pago ainda mostra este pagamento: a devolução aceita ainda pode aparecer por lá. Use Conferir agora." };
  }
  return comAlvo(db, organizacaoId, { devolucaoId: devLida.id }, undefined, async (tx, _t, p, dev) => {
    if (!dev || dev.situacao !== "pedida" || dev.chaveAceita !== devLida.chaveAceita || dev.chaveEmDuvida !== devLida.chaveEmDuvida) return { ok: false as const, erro: FORA };
    const [linha] = await tx
      .update(devolucoesPagamento)
      .set({ situacao: "recusada", proximaTentativaEm: null, chaveAceita: false, chaveEmDuvida: false, paradaEm: agora, paradaNota: nota, atualizadoEm: agora })
      .where(eq(devolucoesPagamento.id, dev.id))
      .returning();
    Object.assign(dev, linha);
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.devolucao_parada_pela_equipe", entidade: "pagamento", entidadeId: p.id, mudancas: { devolucao: ["pedida", "recusada"] } });
    return { ok: true as const, situacao: "recusada" as const };
  });
}

/**
 * Teto da taxa que não voltou, por devolução (D19):
 * - por fora: o valor devolvido por fora;
 * - a integral do pagamento (o M8.2a e o M8.2c): a taxa da aprovação mais os juros do parcelamento pagos pelo hóspede (o
 *   pago − o valor), quando a taxa é conhecida; sem ela, o valor devolvido;
 * - a que completa o pagamento com o recebimento lançado: o devolvido menos a saída do caixa (inclui os juros);
 * - a que completa um pagamento cujo dinheiro nunca entrou: a taxa mais os juros, menos a já registrada nas outras;
 * - as outras: a taxa atribuída ao principal dela, mais os juros se ela cruza o valor da reserva.
 * E, por pagamento, a soma das taxas que não voltaram nunca passa da taxa mais os juros.
 */
async function tetoDaTaxa(tx: Db, organizacaoId: string, p: Pagamento, dev: Devolucao, devs: readonly Devolucao[]): Promise<{ teto: number; erro: (valor: number) => string }> {
  const conferir = "Confira o valor (em reais, com vírgula: ex.: 18,06).";
  if (dev.situacao === "por_fora") {
    const teto = dev.porForaValor ?? dev.valor;
    return { teto, erro: (v) => `A taxa que não voltou (${formatBRL(v)}) não pode passar do valor devolvido por fora (${formatBRL(teto)}). ${conferir}` };
  }
  const devolvido = dev.valorConfirmado ?? dev.valor;
  const juros = Math.max(0, valorPagoAprovado(p) - p.valor);
  const outras = devs.filter((x) => x.id !== dev.id);
  const jaRegistrada = outras.reduce((s, x) => s + (x.taxaPerdida ?? 0), 0);
  if (integralDoPagamento(p, dev, devs)) {
    if (p.taxa !== null) {
      const teto = p.taxa + juros;
      return {
        teto,
        erro: (v) =>
          juros > 0
            ? `A taxa que não voltou (${formatBRL(v)}) não pode passar da taxa que o Mercado Pago cobrou neste pagamento mais os juros do parcelamento (${formatBRL(teto)}). ${conferir}`
            : `A taxa que não voltou (${formatBRL(v)}) não pode passar da taxa que o Mercado Pago cobrou neste pagamento (${formatBRL(teto)}). ${conferir}`,
      };
    }
    return { teto: devolvido, erro: (v) => `A taxa que não voltou (${formatBRL(v)}) não pode passar do valor do pagamento (${formatBRL(devolvido)}), devolvido ao hóspede. ${conferir}` };
  }
  let teto: number;
  if (completaOPagamento(p, dev, devs) && dev.saidaLancamentoId) teto = devolvido - (await saidaDaDevolucao(tx, organizacaoId, dev));
  else if (completaOPagamento(p, dev, devs) && p.taxa !== null) teto = p.taxa + juros - jaRegistrada;
  else {
    const atribuida = dev.taxaAtribuida ?? taxaAtribuidaDaDevolucao(p, dev, devs);
    teto = atribuida === null ? devolvido : atribuida + jurosDaDevolucao(p, dev, devs);
  }
  // Por pagamento: a soma das taxas que não voltaram nunca passa da taxa da aprovação mais os juros.
  const doPagamento = p.taxa === null ? null : p.taxa + juros - jaRegistrada;
  if (doPagamento !== null && doPagamento < teto) teto = doPagamento;
  teto = Math.max(0, teto);
  return {
    teto,
    erro: (v) =>
      `A taxa que não voltou (${formatBRL(v)}) não pode passar da taxa do Mercado Pago sobre a parte devolvida nesta devolução (${formatBRL(teto)}${doPagamento !== null ? `; a taxa deste pagamento, menos a já registrada nas outras devoluções, é ${formatBRL(Math.max(0, doPagamento))}` : ""}). ${conferir}`,
  };
}

/** Dia da despesa da taxa: o da confirmação da devolução, ou a data da devolução por fora. */
const diaDaTaxa = (dev: Devolucao, agora: Date) => (dev.situacao === "por_fora" && dev.porForaData ? dev.porForaData : hojeISO(FUSO_PAGAMENTO, dev.confirmadaEm ?? agora));

/**
 * Taxa (e juros do parcelamento, se o Mercado Pago tirou da SCL) que não voltou, informada pela equipe depois da
 * devolução confirmada ou feita por fora (o provedor só informa a tarifa da aprovação, não o que voltou). Valor em
 * centavos, zero se voltou toda, e nunca mais que o teto (`tetoDaTaxa`). Vira despesa da empresa na categoria da aba
 * Pagamento no site, com chave própria por devolução (idempotente), e o aviso dela sai. Uma vez por devolução; para mudar,
 * "Corrigir taxa que não voltou".
 */
export async function registrarTaxaPerdida(db: Db, organizacaoId: string, alvoBruto: AlvoDaDevolucao | string, valor: number, autorId: string | null, agora: Date = new Date()): Promise<ResultadoAcaoPagamento> {
  if (!Number.isSafeInteger(valor) || valor < 0) return { ok: false, erro: "Informe a taxa que não voltou, em reais (zero se voltou toda)." };
  const realizada = (x: Devolucao) => x.situacao === "confirmada" || x.situacao === "por_fora";
  return comAlvo(db, organizacaoId, comoAlvo(alvoBruto), (x) => realizada(x) && x.taxaPerdida === null, async (tx, t, p, dev, devs) => {
    if (!dev || !realizada(dev)) return { ok: false as const, erro: "A taxa que não voltou se registra depois da devolução confirmada pelo Mercado Pago (ou feita por fora)." };
    if (dev.taxaPerdida !== null) return { ok: false as const, erro: `A taxa que não voltou já foi registrada (${formatBRL(dev.taxaPerdida)}): para mudar, use "Corrigir taxa que não voltou".` };
    // Um valor acima do teto é quase sempre digitação (ex.: 1806 por 18,06). Avisa com os dois valores, nunca grava.
    const { teto, erro } = await tetoDaTaxa(tx, organizacaoId, p, dev, devs);
    if (valor > teto) return { ok: false as const, erro: erro(valor) };
    let despesaLancamentoId: string | null = null;
    if (valor > 0) {
      const l = await lancarTaxaPerdida(tx, organizacaoId, t, p, valor, diaDaTaxa(dev, agora), chaveTaxaPerdida(p.id, dev.id), autorId);
      if (!l.ok) return { ok: false as const, erro: l.erro };
      despesaLancamentoId = l.id;
    }
    await tx.update(devolucoesPagamento).set({ taxaPerdida: valor, despesaLancamentoId, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
    Object.assign(dev, { taxaPerdida: valor, despesaLancamentoId });
    await avisosNaDevolucao(tx, t, p, dev, { desligar: ["taxa_perdida_desconhecida"] }, agora);
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.taxa_perdida", entidade: "pagamento", entidadeId: p.id, mudancas: { taxaPerdida: [null, valor] } });
    return { ok: true as const };
  });
}

/**
 * "Corrigir taxa que não voltou" (M8.2c, `financeiro:editar`): a despesa do pagamento do site não se estorna em Despesas
 * (chave `mercadopago:`); aqui a atual é estornada, com o motivo, e a nova é lançada com a chave seguinte (`#N`). O mesmo teto.
 */
export async function corrigirTaxaPerdida(db: Db, organizacaoId: string, alvoBruto: AlvoDaDevolucao | string, valor: number, motivo: string, autorId: string | null, agora: Date = new Date()): Promise<ResultadoAcaoPagamento> {
  if (!Number.isSafeInteger(valor) || valor < 0) return { ok: false, erro: "Informe a taxa que não voltou, em reais (zero se voltou toda)." };
  const m = motivo.trim();
  const problema = problemaDaNota(m, true);
  if (problema) return { ok: false, erro: !m ? "Informe o motivo da correção." : problema };
  return comAlvo(db, organizacaoId, comoAlvo(alvoBruto), (x) => x.taxaPerdida !== null, async (tx, t, p, dev, devs) => {
    if (!dev || dev.taxaPerdida === null) return { ok: false as const, erro: "Ainda não há taxa que não voltou registrada para corrigir." };
    if (dev.taxaPerdida === valor) return { ok: false as const, erro: `A taxa que não voltou já está registrada com ${formatBRL(valor)}.` };
    // O teto sem a taxa atual desta devolução (ela é a que muda).
    const { teto, erro } = await tetoDaTaxa(tx, organizacaoId, p, dev, devs);
    if (valor > teto) return { ok: false as const, erro: erro(valor) };
    const dia = diaDaTaxa(dev, agora);
    if (dev.despesaLancamentoId) {
      try {
        await estornar(tx, organizacaoId, dev.despesaLancamentoId, `Taxa que não voltou corrigida: ${m}`, autorId, hojeISO(FUSO_PAGAMENTO, agora));
      } catch (e) {
        // Já estornada (por um caminho antigo): segue para lançar a nova.
        if (!(e instanceof LancamentoInvalido)) throw e;
      }
    }
    let despesaLancamentoId: string | null = null;
    if (valor > 0) {
      // A próxima chave livre desta devolução (a primeira é sem número; as correções, #2, #3…).
      const base = chaveTaxaPerdida(p.id, dev.id);
      const usadas = new Set(
        (await tx.select({ chave: lancamentos.chaveOrigem }).from(lancamentos).where(and(eq(lancamentos.organizacaoId, organizacaoId), or(eq(lancamentos.chaveOrigem, base), like(lancamentos.chaveOrigem, `${base}#%`))))).map((l) => l.chave),
      );
      let n = 2;
      while (usadas.has(chaveTaxaPerdida(p.id, dev.id, n))) n++;
      const l = await lancarTaxaPerdida(tx, organizacaoId, t, p, valor, dia, chaveTaxaPerdida(p.id, dev.id, n), autorId);
      if (!l.ok) return { ok: false as const, erro: l.erro };
      despesaLancamentoId = l.id;
    }
    const antes = dev.taxaPerdida;
    await tx.update(devolucoesPagamento).set({ taxaPerdida: valor, despesaLancamentoId, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
    Object.assign(dev, { taxaPerdida: valor, despesaLancamentoId });
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.taxa_perdida_corrigida", entidade: "pagamento", entidadeId: p.id, mudancas: { taxaPerdida: [antes, valor] } });
    return { ok: true as const };
  });
}

/** O que o quadro do pagamento oferece para UMA devolução (M8.2d), pelas mesmas regras do domínio. */
export type AcoesDaDevolucao = {
  conferir: boolean;
  pedirDeNovo: boolean;
  porFora: boolean;
  confirmarVista: boolean;
  registrarRecusaNoPainel: boolean;
  parar: boolean;
  registrarTaxa: boolean;
  corrigirTaxa: boolean;
  pedirRestante: boolean;
  restantePorFora: boolean;
};

/**
 * As ações de uma devolução, calculadas pelas mesmas regras que o domínio confere sob a trava (o botão só aparece quando
 * daria certo pelo que o sistema sabe; a releitura no Mercado Pago ainda decide a por fora e a confirmação).
 */
export function acoesDaDevolucao(p: Pagamento, dev: Devolucao, devs: readonly Devolucao[], t: ContextoDaDevolucao, agora: Date): AcoesDaDevolucao {
  const conhecida = origemDeDevolucaoConhecida(dev.origem) && dev.situacao !== "substituida";
  const foraDaLeitura = p.criadoEm.getTime() < inicioDoPrazoDeReleitura(agora).getTime();
  const aMenorSemRestante =
    conhecida && dev.situacao === "confirmada" && dev.avisos.includes("devolucao_a_menor") && dev.valorConfirmado !== null && !devs.some((x) => x.origemDevolucaoId === dev.id) && !devs.some((x) => x.situacao === "pedida");
  return {
    conferir: p.idProvedor !== null,
    pedirDeNovo: conhecida && dev.situacao === "recusada" && recusaDoPedido(p, dev, devs, t, false, agora) === null,
    porFora: conhecida && (dev.situacao === "recusada" || (dev.situacao === "pedida" && dev.tentativas === 0)) && recusaDoPedido(p, dev, devs, t, true, agora) === null,
    confirmarVista:
      conhecida &&
      cabeNoPagamento(dev, p, t) &&
      (dev.situacao === "pedida" || dev.situacao === "recusada") &&
      !(dev.tentativas === 0 && dev.ultimoCodigo === "aguardando_liberacao") &&
      (foraDaLeitura || semConfirmacaoPelaLeitura(p, dev, devs)),
    registrarRecusaNoPainel: podeRegistrarRecusaNoPainel(p, dev, agora, devs.filter((x) => x.id !== dev.id)),
    parar: conhecida && dev.situacao === "pedida" && foraDaLeitura,
    registrarTaxa: (dev.situacao === "confirmada" || dev.situacao === "por_fora") && dev.taxaPerdida === null,
    corrigirTaxa: dev.taxaPerdida !== null,
    pedirRestante: aMenorSemRestante,
    restantePorFora: aMenorSemRestante && porForaPermitidoNoCartao(p, undefined, agora),
  };
}
