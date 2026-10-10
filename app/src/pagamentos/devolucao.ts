/**
 * Pagamento no site (M8.2a) — devolução do pagamento que ficou sem reserva (design "Devolução na parte (a)"); M8.2c — a
 * devolução do cancelamento pela política (origem `cancelamento`), pelo mesmo motor.
 *
 * A equipe escolhe, com confirmação: devolver pelo Mercado Pago (integral) ou registrar a devolução feita por
 * fora. As duas exigem, sob a trava da tentativa, desfecho vazio, decisão "sem reserva" gravada e nenhuma
 * devolução pedida (no cancelamento: a reserva cancelada com direito integral e a devolução dele recusada). Pelo provedor:
 * `pedida` até a leitura da order dizer devolvido; cada pedido novo usa chave
 * nova, gravada antes, e relê a order antes (já devolvida = confirmada; devolução em andamento = não pede de novo).
 * Recusa e resposta incerta contam do mesmo jeito; a terceira só vira "recusada" (aviso) depois de reler a order sem
 * nenhum sinal de devolução (feita, em parte ou em andamento): com sinal, continua pedida e a leitura confirma. Assim
 * uma devolução que só recebe respostas incertas não fica "pedida" para sempre, e uma que saiu nunca é dada por
 * recusada. A resposta "aguarde" (M8.2c: outra devolução em andamento ou espera pedida pelo Mercado Pago) não conta: a
 * chave fica em dúvida, nada fica aceito e a rotina tenta de novo depois, relendo a order. Pedido ACEITO pelo provedor:
 * nada se envia de novo (nem com outra chave, nem num pedido novo da equipe), só a leitura confirma (pela situação ou,
 * M8.2c, pelo valor das devoluções confirmadas); três leituras sem a devolução viram aviso, e ela continua pedida,
 * qualquer que seja a leitura (nunca para sozinha: parar abriria o registro por fora, em dobro). Só a leitura que mostra
 * que a NOSSA devolução (o id gravado) falhou a solta (`aplicarLeitura`). Order devolvida em parte ou contestada antes de
 * pedir (pedido ainda não aceito): a leitura é aplicada e a devolução para (aviso; devolver o inteiro devolveria a mais).
 * O pedido só sai com a order relida aprovada e a mesma da tentativa; qualquer outra leitura também para (aviso).
 * Por fora: só depois de reler a order no provedor (devolvida, em andamento ou contestada = recusa), e só o valor
 * integral; a taxa que não voltou é derivada do que entrou (M8.2c). Pelo Mercado Pago, a taxa que não voltar a equipe
 * informa depois da confirmação ("Registrar taxa que não voltou"): vira despesa da empresa.
 *
 * Cartão (M8.2b, regra apertada no M8.2c): devolve-se pelo Mercado Pago (integral = o pago, com os juros quando ele
 * mostra). Por fora, só quando a devolução pelo Mercado Pago não deu de vez (recusa definitiva, a nossa devolução falhou
 * na leitura, ou a equipe registrou a recusa no painel do Mercado Pago) ou o pagamento passou dos 180 dias em que o
 * Mercado Pago ainda devolve: senão a cobrança ficaria no cartão do hóspede e uma contestação devolveria de novo.
 *
 * Pagamento velho (M8.2c, D12): o sistema não pede devolução ao Mercado Pago de um pagamento com mais de 78 dias (não daria
 * tempo de conferir). A equipe devolve pelo painel do Mercado Pago e confirma aqui, registra a recusa do painel, para uma
 * devolução pedida que ficou sem resposta, ou devolve por fora.
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
import { acertarCaixa } from "./acerto-cancelamento";
import { inicioDoPrazoDePedirDevolucao, inicioDoPrazoDeReleitura } from "./andamento";
import { conferirTentativa } from "./conferencia";
import { FUSO_PAGAMENTO, recebimentosDoPagamento } from "./liberacao";
import { type Cobranca, type ProvedorPagamento, RECUSAS_DEFINITIVAS, type ResultadoDevolucao, RETENCAO_ORDERS_DIAS, valorPagoNaOrder } from "./provedor";
import { type CodigoAviso, MAXIMO_FALHAS_DEVOLUCAO, origemDeDevolucaoConhecida, textoMotivoSemReserva } from "./situacoes";
import { type Cancelamento, type Devolucao, devolucaoDoPagamento, type Pagamento, type Travado, travarCotacao } from "./travas";

export { chaveSaidaDevolucao } from "./acerto-cancelamento";
export { MAXIMO_FALHAS_DEVOLUCAO };
/** Espera entre uma tentativa de devolução e a seguinte (a rotina relê a order antes). */
export const ESPERA_DEVOLUCAO_MS = 10 * 60_000;
export const chaveDevolucao = (devolucaoId: string, n: number) => `devolucao:${devolucaoId}:${n}`;
/** Por quantos dias depois da aprovação o Mercado Pago ainda devolve um pagamento com cartão. */
export const PRAZO_DEVOLUCAO_CARTAO_DIAS = 180;
export const ERRO_POR_FORA_CARTAO =
  "Pagamento com cartão: devolva pelo Mercado Pago. A devolução por fora só é registrada quando o Mercado Pago recusou a devolução de vez (ou a recusa no painel do Mercado Pago foi registrada aqui) ou o pagamento passou de 180 dias (a cobrança ficaria no cartão do hóspede e uma contestação poderia devolver de novo).";
/** Limite das notas da equipe (devolução por fora, confirmação, recusa no painel, parada, correção da taxa). */
const LIMITE_NOTA = 300;

/**
 * Cartão: a devolução por fora é permitida? Uma regra para as duas origens (o quadro do pagamento usa a mesma). Só quando:
 * - a devolução ficou recusada por uma recusa definitiva do Mercado Pago (`RECUSAS_DEFINITIVAS`; "não encontrado" só vale
 *   dentro do prazo de leitura — depois dele, a order some da consulta e isso não diz nada);
 * - a equipe registrou que o painel do Mercado Pago recusou a devolução;
 * - a leitura mostrou que a NOSSA devolução (o id gravado) falhou e o sistema a soltou (recusada, com o id e o aviso);
 * - o pagamento passou dos 180 dias em que o Mercado Pago ainda devolve.
 * Saldo insuficiente, espera, três respostas incertas e a recusada do pagamento com mais de 78 dias (nada foi pedido)
 * nunca abrem. Pix: sempre (as outras condições continuam em `recusaDaDevolucao`).
 */
export function porForaPermitidoNoCartao(
  p: Pick<Pagamento, "forma" | "avisos" | "aprovadoEm"> & { criadoEm?: Date },
  dev: Pick<Devolucao, "situacao" | "ultimoCodigo" | "recusaNoPainelEm" | "idProvedor"> | undefined,
  agora: Date,
): boolean {
  if (p.forma !== "cartao") return true;
  if (p.aprovadoEm && p.aprovadoEm.getTime() + PRAZO_DEVOLUCAO_CARTAO_DIAS * 86_400_000 < agora.getTime()) return true;
  if (!dev) return false;
  if (dev.recusaNoPainelEm) return true;
  if (dev.situacao !== "recusada") return false;
  const naJanela = !!p.criadoEm && p.criadoEm.getTime() >= inicioDoPrazoDeReleitura(agora).getTime();
  if (dev.ultimoCodigo && RECUSAS_DEFINITIVAS.includes(dev.ultimoCodigo) && (dev.ultimoCodigo !== "nao_encontrado" || naJanela)) return true;
  // Solta pela leitura: o id da devolução que falhou fica gravado (um pedido novo da equipe o apaga) e o aviso, ligado.
  return dev.idProvedor !== null && p.avisos.includes("devolucao_falhou");
}

/**
 * Despesa da taxa que o provedor não devolveu: uma por devolução (`#N` a cada correção). As despesas antigas (M8.2a)
 * ficam com a chave de antes (`mercadopago:<pagamento>:taxa_perdida`); a taxa já registrada nunca é lançada de novo.
 */
export const chaveTaxaPerdida = (pagamentoId: string, devolucaoId: string, n = 1) => `mercadopago:${pagamentoId}:devolucao:${devolucaoId}:taxa_perdida${n > 1 ? `#${n}` : ""}`;

export type ResultadoAcaoPagamento = { ok: true; situacao?: SituacaoDevolucao; mensagem?: string } | { ok: false; erro: string };

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

/** De onde é a devolução deste pagamento: a gravada; sem ela, a do pagamento que confirmou a reserva é a do cancelamento. */
const origemDa = (p: Pagamento, dev: Devolucao | undefined) => dev?.origem ?? (p.desfecho === "reserva" ? "cancelamento" : "sem_reserva");

/** A devolução cabe neste pagamento agora? Sem reserva: desfecho vazio. Cancelamento: a reserva cancelada com direito integral. */
const cabeNoPagamento = (dev: Devolucao, p: Pagamento, c: Cancelamento | null) =>
  dev.origem === "sem_reserva" ? p.desfecho === null : dev.origem === "cancelamento" && p.desfecho === "reserva" && c?.situacao === "cancelada" && c.direito === "integral";

/**
 * Pode decidir o destino do dinheiro (devolver)? Sob a trava. Devolve o motivo da recusa, ou null. Por fora também
 * vale para o pagamento contestado (a situação local nunca volta a "aprovado"; a releitura no provedor decide antes e
 * só aceita com a contestação resolvida). Devolvido em parte, não: o provedor sempre mostra a parte devolvida.
 */
function recusaDaDevolucao(p: Pagamento, dev: Devolucao | undefined, porFora: boolean, agora: Date, c: Cancelamento | null): string | null {
  const origem = origemDa(p, dev);
  if (!origemDeDevolucaoConhecida(origem)) return "Esta devolução foi registrada por uma versão mais nova do sistema: resolva por ela.";
  if (origem === "cancelamento") return recusaDoCancelamento(p, dev, porFora, agora, c);
  const situacoes = porFora ? ["aprovado", "contestado"] : ["aprovado"];
  if (!situacoes.includes(p.situacao)) return "Só um pagamento aprovado (e ainda não devolvido) pode ser devolvido.";
  if (p.desfecho !== null) return "Este pagamento já tem desfecho.";
  if (p.motivoSemReserva === null) return "Este pagamento ainda está sendo conferido ou confirmou a reserva: não se devolve na parte (a).";
  if (dev?.situacao === "pedida") return "Já há uma devolução pedida ao Mercado Pago para este pagamento.";
  // Um pedido que o Mercado Pago aceitou ainda pode sair por lá: registrar por fora devolveria em dobro.
  if (porFora && dev?.chaveAceita)
    return "O Mercado Pago aceitou um pedido de devolução deste pagamento, que ainda pode sair por lá: a devolução por fora não é registrada. Confira no painel do Mercado Pago; se lá a devolução aparecer recusada, use Conferir agora.";
  // Depois de 3 recusas (recusada), a equipe pode pedir de novo ou registrar a devolução feita por fora.
  if (dev && dev.situacao !== "recusada") return porFora ? "A devolução deste pagamento já foi registrada." : "A devolução deste pagamento já foi feita.";
  if (porFora && !porForaPermitidoNoCartao(p, dev, agora)) return ERRO_POR_FORA_CARTAO;
  return null;
}

/** A devolução do cancelamento pela política (M8.2c): só depois de decidido com direito integral, e só a que ficou recusada. */
function recusaDoCancelamento(p: Pagamento, dev: Devolucao | undefined, porFora: boolean, agora: Date, c: Cancelamento | null): string | null {
  if (p.desfecho !== "reserva" || c?.situacao !== "cancelada" || c.direito !== "integral")
    return "Este pagamento já tem desfecho: confirmou a reserva. A devolução sai pelo cancelamento da reserva (\"Cancelar a reserva\" no quadro Pagamento no site).";
  if (p.situacao !== "aprovado") return "Só um pagamento aprovado (e ainda não devolvido) pode ser devolvido.";
  if (!dev) return "A devolução deste cancelamento não foi registrada: confira o quadro Pagamento no site.";
  if (dev.situacao !== "recusada") return "A devolução deste cancelamento já está pedida ou feita.";
  if (porFora && dev.chaveAceita)
    return "O Mercado Pago aceitou um pedido de devolução deste pagamento, que ainda pode sair por lá: a devolução por fora não é registrada. Confira no painel do Mercado Pago; se lá a devolução aparecer recusada, use Conferir agora.";
  if (porFora && !porForaPermitidoNoCartao(p, dev, agora)) return ERRO_POR_FORA_CARTAO;
  if (!porFora && p.criadoEm.getTime() < inicioDoPrazoDePedirDevolucao(agora).getTime())
    return "O pagamento tem mais de 78 dias: devolva pelo painel do Mercado Pago e confirme aqui, ou por fora.";
  return null;
}

/** A order mostra devolução feita, em parte ou em andamento? (Nesse caso nada se pede nem se registra por fora.) */
const temDevolucao = (c: Cobranca) => c.situacao === "devolvido" || c.situacao === "devolvido_parcial" || c.devolvido > 0 || c.devolucaoEmAndamento;

async function adiarDevolucao(db: Db, devolucaoId: string, agora: Date): Promise<void> {
  await db.update(devolucoesPagamento).set({ proximaTentativaEm: new Date(agora.getTime() + ESPERA_DEVOLUCAO_MS), atualizadoEm: agora }).where(eq(devolucoesPagamento.id, devolucaoId));
}

/** Liga o aviso no pagamento (sob a trava de quem chama), sem repetir. */
async function ligarAvisoNoPagamento(tx: Db, p: Pagamento, aviso: CodigoAviso, agora: Date): Promise<void> {
  if (!p.avisos.includes(aviso)) {
    const avisos = [...p.avisos, aviso];
    await tx.update(pagamentos).set({ avisos, atualizadoEm: agora }).where(eq(pagamentos.id, p.id));
    p.avisos = avisos;
  }
}

/** Grava os avisos do pagamento (sob a trava de quem chama): liga e desliga numa escrita só. */
async function trocarAvisos(tx: Db, p: Pagamento, o: { ligar?: CodigoAviso[]; desligar?: CodigoAviso[] }, agora: Date): Promise<void> {
  const avisos = new Set(p.avisos);
  for (const a of o.desligar ?? []) avisos.delete(a);
  for (const a of o.ligar ?? []) avisos.add(a);
  const lista = [...avisos];
  if (lista.length === p.avisos.length && lista.every((a, i) => a === p.avisos[i])) return;
  await tx.update(pagamentos).set({ avisos: lista, atualizadoEm: agora }).where(eq(pagamentos.id, p.id));
  p.avisos = lista;
}

/**
 * Order devolvida em parte ou contestada antes de pedir: a devolução integral automática para (recusada, com aviso).
 * Devolver o valor inteiro agora devolveria o resto junto de uma parcial, ou correria com a contestação.
 */
async function pararDevolucao(db: Db, organizacaoId: string, cotacaoId: string, devolucaoId: string, agora: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const t = await travarCotacao(tx, organizacaoId, cotacaoId);
    const dev = t?.devolucoes.find((x) => x.id === devolucaoId);
    // Pedido aceito pelo provedor nunca para (ainda pode sair): só a leitura o resolve.
    if (!t || !dev || dev.situacao !== "pedida" || dev.chaveAceita) return;
    await tx.update(devolucoesPagamento).set({ situacao: "recusada", proximaTentativaEm: null, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
    const p = t.tentativas.find((x) => x.id === dev.pagamentoId)!;
    await ligarAvisoNoPagamento(tx, p, "devolucao_parada", agora);
    await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "pagamento.devolucao_parada", entidade: "pagamento", entidadeId: p.id, mudancas: { devolucao: ["pedida", "recusada"] } });
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
    if (falhas >= MAXIMO_FALHAS_DEVOLUCAO) await ligarAvisoNoPagamento(tx, t.tentativas.find((x) => x.id === dev.pagamentoId)!, "devolucao_sem_confirmacao", agora);
  });
}

/**
 * Um pedido de devolução ao provedor (rotina e painel): relê a order antes (já devolvida = confirmada; devolução em
 * andamento = espera), grava a chave nova antes de chamar, chama fora de transação e registra o resultado. A
 * confirmação vem da leitura. Devolução de origem que esta versão não conhece, ou que o Mercado Pago devolveu a menos
 * (M8.2c: a espera para, a equipe resolve), não é tocada.
 */
export async function tentarDevolucao(db: Db, organizacaoId: string, devolucaoId: string, provedor: ProvedorPagamento, agora: Date = new Date()): Promise<SituacaoDevolucao | null> {
  if (!uuidValido(devolucaoId)) return null;
  const [d] = await db
    .select({ dev: devolucoesPagamento, cotacaoId: pagamentos.cotacaoId, idProvedor: pagamentos.idProvedor, referencia: pagamentos.referencia, avisos: pagamentos.avisos })
    .from(devolucoesPagamento)
    .innerJoin(pagamentos, eq(pagamentos.id, devolucoesPagamento.pagamentoId))
    .where(and(eq(devolucoesPagamento.id, devolucaoId), eq(devolucoesPagamento.organizacaoId, organizacaoId)));
  if (!d || d.dev.situacao !== "pedida" || !d.idProvedor || !origemDeDevolucaoConhecida(d.dev.origem) || d.avisos.includes("devolucao_a_menor")) return d?.dev.situacao ?? null;
  // Antes de pedir de novo: a order já diz devolvida? Então a leitura confirma e nada é reenviado.
  let cobranca: Cobranca | null;
  try {
    cobranca = await provedor.consultar(d.idProvedor);
  } catch {
    // Sem leitura não se pede: tenta de novo na próxima volta.
    await adiarDevolucao(db, devolucaoId, agora);
    return "pedida";
  }
  if (cobranca?.situacao === "devolvido") {
    await conferirTentativa(db, organizacaoId, d.dev.pagamentoId, provedor, agora, { forcar: true, origem: "rotina", cobranca });
    return (await situacaoDaDevolucao(db, devolucaoId)) ?? "pedida";
  }
  // Devolução já em andamento no provedor (um pedido anterior cuja resposta se perdeu): espera, sem pedir de novo.
  if (cobranca?.devolucaoEmAndamento) {
    await adiarDevolucao(db, devolucaoId, agora);
    return "pedida";
  }
  // Pedido já aceito pelo provedor: nada se envia de novo (nem com a mesma chave) e ele nunca para sozinho, qualquer que
  // seja a leitura (em parte, contestada...): a devolução aceita ainda pode sair, e parar abriria o registro por fora (em
  // dobro). A leitura é aplicada (confirma pela situação ou pelo valor, ou solta a nossa devolução que falhou); três sem a
  // devolução viram aviso.
  if (d.dev.chaveAceita) {
    if (cobranca) await conferirTentativa(db, organizacaoId, d.dev.pagamentoId, provedor, agora, { forcar: true, origem: "rotina", cobranca });
    await esperarAceita(db, organizacaoId, d.cotacaoId, devolucaoId, agora);
    return (await situacaoDaDevolucao(db, devolucaoId)) ?? null;
  }
  // Devolvida em parte ou contestada: a leitura é aplicada e a devolução automática para (nunca o inteiro por cima).
  if (cobranca && (cobranca.situacao === "devolvido_parcial" || cobranca.situacao === "contestado" || cobranca.devolvido > 0)) {
    await conferirTentativa(db, organizacaoId, d.dev.pagamentoId, provedor, agora, { forcar: true, origem: "rotina", cobranca });
    await pararDevolucao(db, organizacaoId, d.cotacaoId, devolucaoId, agora);
    return (await situacaoDaDevolucao(db, devolucaoId)) ?? null;
  }
  // Só se pede com a order relida APROVADA e a mesma da tentativa (id e referência). Qualquer outra leitura
  // (desconhecida, recusada, cancelada, vencida, pendente, de outra referência) é aplicada e a devolução automática
  // para com aviso: a situação local "aprovado" pode estar velha, e o pedido não sai por cima dela.
  if (cobranca && (cobranca.situacao !== "aprovado" || cobranca.idProvedor !== d.idProvedor || cobranca.referencia !== d.referencia)) {
    await conferirTentativa(db, organizacaoId, d.dev.pagamentoId, provedor, agora, { forcar: true, origem: "rotina", cobranca });
    await pararDevolucao(db, organizacaoId, d.cotacaoId, devolucaoId, agora);
    return (await situacaoDaDevolucao(db, devolucaoId)) ?? null;
  }
  let res: ResultadoDevolucao;
  let chaveRepetida = false;
  if (!cobranca) res = { situacao: "recusada", idDevolucao: null, mensagem: "O Mercado Pago não encontrou o pagamento.", codigo: "nao_encontrado" };
  else {
    // Grava a chave antes de chamar, sob as travas. Depois de uma resposta incerta, a MESMA chave de novo (o pedido
    // anterior pode ter sido aceito: o provedor não devolve duas vezes pela mesma chave); senão, chave nova.
    // `repetida`: a chave enviada já estava em dúvida (um pedido anterior com ela pode ter saído).
    const reserva = await db.transaction(async (tx) => {
      const t = await travarCotacao(tx, organizacaoId, d.cotacaoId);
      const dev = t?.devolucoes.find((x) => x.id === devolucaoId);
      // Sob a trava: ainda pedida, a vez dela chegou e ninguém pediu desde a leitura (painel e rotina ao mesmo tempo).
      if (!t || !dev || dev.situacao !== "pedida" || dev.chaveAceita || dev.tentativas !== d.dev.tentativas || (dev.proximaTentativaEm && dev.proximaTentativaEm.getTime() > agora.getTime())) return null;
      // O pagamento ainda está aprovado e a devolução ainda cabe nele (sem desfecho; no cancelamento, a reserva cancelada
      // com direito integral)? Uma leitura que cruzou (Conferir agora, aviso) pode tê-lo levado a devolvido em parte ou
      // contestado depois da releitura acima: então nada se pede por cima, e para.
      const p = t.tentativas.find((x) => x.id === dev.pagamentoId);
      if (!p || p.situacao !== "aprovado" || !cabeNoPagamento(dev, p, t.cancelamento)) {
        await tx.update(devolucoesPagamento).set({ situacao: "recusada", proximaTentativaEm: null, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
        if (p) {
          await ligarAvisoNoPagamento(tx, p, "devolucao_parada", agora);
          await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "pagamento.devolucao_parada", entidade: "pagamento", entidadeId: p.id, mudancas: { devolucao: ["pedida", "recusada"] } });
        }
        return null;
      }
      // D12: a devolução do cancelamento só é pedida ao Mercado Pago com folga para conferir que saiu (pagamento com até
      // 78 dias). Passou disso entre um envio e outro (espera, resposta incerta, recusa clara): nada mais se envia. Com a
      // chave em dúvida (um envio anterior pode ter sido aceito), continua pedida e só a leitura segue, até os 85 dias
      // (depois, "Parar a devolução pedida"); sem dúvida, nada está no Mercado Pago: fica recusada, com o aviso, para a
      // equipe devolver pelo painel dele (cartão) ou por fora (Pix).
      if (dev.origem === "cancelamento" && p.criadoEm.getTime() < inicioDoPrazoDePedirDevolucao(agora).getTime()) {
        if (dev.chaveEmDuvida) {
          await tx.update(devolucoesPagamento).set({ proximaTentativaEm: new Date(agora.getTime() + ESPERA_DEVOLUCAO_MS), atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
          return null;
        }
        await tx.update(devolucoesPagamento).set({ situacao: "recusada", proximaTentativaEm: null, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
        await ligarAvisoNoPagamento(tx, p, "devolucao_fora_do_prazo", agora);
        await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "pagamento.devolucao_fora_do_prazo", entidade: "pagamento", entidadeId: p.id, mudancas: { devolucao: ["pedida", "recusada"] } });
        return null;
      }
      const proxima = dev.tentativas + 1;
      const usar = dev.chaveEmDuvida && dev.chaveAtual ? dev.chaveAtual : chaveDevolucao(dev.id, proxima);
      // O valor registrado é o que a order relida mostra como pago (a devolução integral devolve isso, não o da cotação).
      // A chave já fica "em dúvida" antes do envio: se o processo cair depois de o provedor aceitar (e antes de gravar o
      // resultado), o próximo envio repete a MESMA chave (o provedor não devolve duas vezes por ela). Só uma recusa
      // clara tira a dúvida.
      await tx
        .update(devolucoesPagamento)
        .set({ tentativas: proxima, chaveAtual: usar, chaveEmDuvida: true, valor: valorPagoNaOrder(cobranca), proximaTentativaEm: new Date(agora.getTime() + ESPERA_DEVOLUCAO_MS), atualizadoEm: agora })
        .where(eq(devolucoesPagamento.id, dev.id));
      return { chave: usar, repetida: Boolean(dev.chaveEmDuvida && dev.chaveAtual) };
    });
    if (reserva === null) return situacaoDaDevolucao(db, devolucaoId);
    chaveRepetida = reserva.repetida;
    res = await provedor.devolver(cobranca, reserva.chave, null);
  }
  // Antes de dar a devolução por recusada (a terceira recusa ou resposta incerta), a order é relida: a resposta pode
  // ter cruzado com um pedido que saiu. undefined = não deu para ler (então não se desiste).
  const falhou = res.situacao === "recusada" || res.situacao === "incerta";
  let releitura: Cobranca | null | undefined;
  if (falhou && d.dev.falhas + 1 >= MAXIMO_FALHAS_DEVOLUCAO) {
    try {
      releitura = await provedor.consultar(d.idProvedor);
    } catch {
      releitura = undefined;
    }
  }
  await db.transaction(async (tx) => {
    const t = await travarCotacao(tx, organizacaoId, d.cotacaoId);
    const dev = t?.devolucoes.find((x) => x.id === devolucaoId);
    if (!t || !dev || dev.situacao !== "pedida") return;
    // O código da resposta (lista fechada) fica guardado em toda resposta: o quadro do pagamento explica a espera ou a recusa.
    const ultimoCodigo = res.codigo;
    if (res.situacao === "confirmada" || res.situacao === "pedida") {
      // Aceito pelo provedor: daí em diante nada se envia de novo (a order pode demorar a mostrar a devolução; um envio
      // novo poderia devolver de novo). Só a leitura confirma; as falhas recomeçam a contar as leituras sem a devolução.
      // O id é o da devolução que ESTE pedido criou (ou nenhum, quando a resposta não deixa saber qual): só ele solta o
      // pedido se a leitura o mostrar falho.
      await tx
        .update(devolucoesPagamento)
        .set({ chaveEmDuvida: true, chaveAceita: true, falhas: 0, ultimoCodigo, idProvedor: res.idDevolucao, atualizadoEm: agora })
        .where(eq(devolucoesPagamento.id, dev.id));
      return;
    }
    if (res.situacao === "aguarde") {
      // "Aguarde" (outra devolução em andamento no Mercado Pago, ou espera pedida por ele): nada foi aceito por esta chave
      // e não conta falha — nunca leva à desistência nem abre a devolução por fora. A chave continua em dúvida (o próximo
      // envio repete a mesma) e não fica aceita. A próxima volta relê a order antes: espera enquanto houver devolução em
      // andamento, confirma quando a order mostrar devolvida, para numa devolução em parte e, sem nada disso, pede de novo.
      await tx.update(devolucoesPagamento).set({ chaveEmDuvida: true, ultimoCodigo, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
      return;
    }
    // Recusada ou incerta (o pedido pode ter saído): conta; só desiste com a releitura sem nenhum sinal de devolução.
    const falhas = dev.falhas + 1;
    const semSinalDeDevolucao = releitura === null || (releitura !== undefined && !temDevolucao(releitura));
    const desistiu = falhas >= MAXIMO_FALHAS_DEVOLUCAO && semSinalDeDevolucao;
    await tx
      .update(devolucoesPagamento)
      // Incerta: o próximo envio repete a chave. Recusa clara de uma chave nova: o próximo leva chave nova. Uma chave que
      // já estava em dúvida continua em dúvida mesmo recusada agora (a recusa pode vir antes de o provedor conferir a
      // chave, e o pedido anterior com ela pode ter saído): só a desistência, com a order relida sem sinal de
      // devolução, deixa a equipe pedir com chave nova.
      .set({ falhas, chaveEmDuvida: res.situacao === "incerta" || chaveRepetida, ultimoCodigo, ...(desistiu ? { situacao: "recusada" as const, proximaTentativaEm: null } : {}), atualizadoEm: agora })
      .where(eq(devolucoesPagamento.id, dev.id));
    if (desistiu) {
      const p = t.tentativas.find((x) => x.id === dev.pagamentoId)!;
      await ligarAvisoNoPagamento(tx, p, "devolucao_falhou", agora);
      await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "pagamento.devolucao_recusada", entidade: "pagamento", entidadeId: p.id, mudancas: { devolucao: ["pedida", "recusada"] } });
    }
  });
  // A confirmação só vem da leitura da order.
  if (res.situacao === "confirmada" || res.situacao === "pedida") await conferirTentativa(db, organizacaoId, d.dev.pagamentoId, provedor, agora, { forcar: true, origem: "rotina" });
  else if (releitura && temDevolucao(releitura)) await conferirTentativa(db, organizacaoId, d.dev.pagamentoId, provedor, agora, { forcar: true, origem: "rotina", cobranca: releitura });
  return (await situacaoDaDevolucao(db, devolucaoId)) ?? null;
}

/** A devolução do pagamento, lida sem trava (fora de transação, antes de reler a order): pela regra única `devolucaoDoPagamento`. */
async function devolucaoLida(db: Db, pagamentoId: string): Promise<Devolucao | undefined> {
  return devolucaoDoPagamento({ devolucoes: await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.pagamentoId, pagamentoId)) }, pagamentoId);
}

async function situacaoDaDevolucao(db: Db, devolucaoId: string): Promise<SituacaoDevolucao | null> {
  const [d] = await db.select({ situacao: devolucoesPagamento.situacao }).from(devolucoesPagamento).where(eq(devolucoesPagamento.id, devolucaoId));
  return d?.situacao ?? null;
}

async function comPagamento<T>(db: Db, organizacaoId: string, pagamentoId: string, f: (tx: Db, t: Travado, p: Pagamento, dev: Devolucao | undefined) => Promise<T>): Promise<T | { ok: false; erro: string }> {
  const cotacaoId = await cotacaoDoPagamento(db, organizacaoId, pagamentoId);
  if (!cotacaoId) return { ok: false, erro: "Pagamento não encontrado." };
  return db.transaction(async (tx) => {
    const t = await travarCotacao(tx, organizacaoId, cotacaoId);
    const p = t?.tentativas.find((x) => x.id === pagamentoId);
    if (!t || !p) return { ok: false as const, erro: "Pagamento não encontrado." };
    return f(tx, t, p, devolucaoDoPagamento(t, p.id));
  });
}

/**
 * Devolver pelo Mercado Pago (integral). A equipe confirma na tela; autorização conferida por quem chama. A devolução do
 * cancelamento (M8.2c) só é pedida de novo por aqui (a linha nasce no cancelamento, `cancelarReservaPaga`).
 */
export async function devolverPeloProvedor(db: Db, organizacaoId: string, pagamentoId: string, autorId: string | null, provedor: ProvedorPagamento, agora: Date = new Date()): Promise<ResultadoAcaoPagamento> {
  const r = await comPagamento(db, organizacaoId, pagamentoId, async (tx, t, p, dev) => {
    const recusa = recusaDaDevolucao(p, dev, false, agora, t.cancelamento);
    if (recusa) return { ok: false as const, erro: recusa };
    const motivo = textoMotivoSemReserva(p.motivoSemReserva) ?? "Pagamento sem reserva.";
    // O que o hóspede pagou pela última leitura (a devolução integral devolve isso); cada envio regrava pela releitura.
    const integral = valorPagoNaOrder({ pago: p.valorPago, valor: p.valor });
    let id: string;
    if (dev) {
      // Devolução que desistiu depois de 3 recusas (relida a order, sem sinal de devolução), ou solta pela leitura: a
      // equipe pede de novo, com chave nova (as falhas recomeçam; a numeração das chaves continua). Pedido que o provedor
      // já aceitou nunca ganha chave nova: continua só à espera da leitura. O id da devolução anterior sai (só a
      // devolução do pedido novo solta este pedido).
      await tx
        .update(devolucoesPagamento)
        .set({ situacao: "pedida", falhas: 0, chaveEmDuvida: dev.chaveAceita, ...(dev.chaveAceita ? {} : { idProvedor: null }), proximaTentativaEm: agora, autorId, atualizadoEm: agora })
        .where(eq(devolucoesPagamento.id, dev.id));
      id = dev.id;
    } else {
      [{ id }] = await tx
        .insert(devolucoesPagamento)
        .values({ organizacaoId, pagamentoId: p.id, motivo, valor: integral, situacao: "pedida", proximaTentativaEm: agora, autorId, criadoEm: agora, atualizadoEm: agora })
        .returning({ id: devolucoesPagamento.id });
    }
    await trocarAvisos(tx, p, { desligar: ["devolucao_falhou", "devolucao_parada"] }, agora);
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.devolver", entidade: "pagamento", entidadeId: p.id, mudancas: { devolucao: [dev?.situacao ?? null, "pedida"], valor: [null, integral] } });
    return { ok: true as const, id };
  });
  if (!r.ok) return r;
  const situacao = await tentarDevolucao(db, organizacaoId, r.id, provedor, agora);
  return { ok: true, situacao: situacao ?? "pedida" };
}

export const ERRO_POR_FORA_SEM_CONFERIR =
  "Não deu para conferir no Mercado Pago se a devolução já foi feita por lá. Sem essa conferência, a devolução feita por fora não é registrada (para o hóspede não receber duas vezes): tente de novo em instantes.";

/** Recusa da devolução por fora pelo que o provedor mostra agora (devolvido, em andamento, contestado); null = pode. */
function recusaPeloProvedor(c: Cobranca): string | null {
  if (c.situacao === "devolvido" || c.situacao === "devolvido_parcial" || c.devolvido > 0)
    return "O Mercado Pago mostra este pagamento como devolvido (no todo ou em parte): a devolução por fora não é registrada, para o hóspede não receber duas vezes. Confira no painel do Mercado Pago; o restante, se houver, se resolve pelo painel do Mercado Pago (a devolução de parte do valor pelo sistema chega no M8.2d).";
  if (c.devolucaoEmAndamento) return "O Mercado Pago mostra uma devolução em andamento neste pagamento: espere ela concluir (use Conferir agora) em vez de devolver por fora.";
  if (c.situacao === "contestado") return "Este pagamento está contestado no Mercado Pago: o dinheiro pode voltar ao hóspede pela contestação. Resolva pelo painel do Mercado Pago, sem devolver por fora.";
  if (c.situacao !== "aprovado") return "O Mercado Pago não mostra este pagamento como aprovado agora: confira no painel do Mercado Pago antes de registrar a devolução por fora.";
  return null;
}

/**
 * Lança a despesa da taxa que não voltou (empresa, realizada), na categoria da aba Pagamento no site: o imóvel e, no
 * cancelamento, a reserva. Sob as travas de quem chama. Devolve o lançamento, ou o erro da categoria (arquivada).
 */
async function lancarTaxaPerdida(tx: Db, organizacaoId: string, t: Travado, p: Pagamento, dev: Devolucao, valor: number, data: string, chave: string, autorId: string | null): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
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
        reservaId: dev.origem === "cancelamento" ? t.reserva.id : null,
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
 * Devolução feita por fora (Pix da conta da empresa, por exemplo): data até hoje, o valor integral pago (pela leitura
 * da order) e nota (sem dado pessoal). Antes, a order é relida no provedor (fora de transação): outra order (id ou
 * referência diferentes), devolvida, com devolução em andamento ou contestada = recusa; sem conseguir ler (ou sem
 * provedor), recusa também. A leitura é aplicada (pode confirmar uma devolução pedida). A taxa que não voltou é derivada
 * do que entrou (M8.2c): o devolvido menos os recebimentos em vigor do pagamento, ou menos o líquido informado quando nada
 * entrou; sem nenhum dos dois (ou com o aviso de taxa divergente), fica o aviso para a equipe informar. No cancelamento, o
 * caixa (a saída do que entrou) fica lançado com a data informada; o desfecho continua "reserva".
 */
export async function registrarDevolucaoPorFora(
  db: Db,
  organizacaoId: string,
  pagamentoId: string,
  d: { data: string; valor: number; nota: string },
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
  if (!uuidValido(pagamentoId)) return { ok: false, erro: "Pagamento não encontrado." };
  const [lido] = await db.select({ idProvedor: pagamentos.idProvedor, referencia: pagamentos.referencia, criadoEm: pagamentos.criadoEm }).from(pagamentos).where(and(eq(pagamentos.id, pagamentoId), eq(pagamentos.organizacaoId, organizacaoId)));
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
      await conferirTentativa(db, organizacaoId, pagamentoId, provedor, agora, { forcar: true, origem: "painel", cobranca });
    } catch {
      // A recusa abaixo vem da leitura, não da aplicação.
    }
    // A order lida precisa ser a deste pagamento (id e referência): a de outra tentativa não diz nada sobre esta.
    if (cobranca.idProvedor !== lido.idProvedor || cobranca.referencia !== lido.referencia)
      return { ok: false, erro: "A resposta do Mercado Pago não bate com este pagamento (referência ou identificação diferentes): nada foi registrado. Confira no painel do Mercado Pago." };
    const peloProvedor = recusaPeloProvedor(cobranca);
    if (peloProvedor) return { ok: false, erro: peloProvedor };
  }
  // Integral = o que o hóspede pagou: pela leitura de agora (pode diferir do valor da cotação: valor divergente) ou, sem
  // order para reler, pelo último valor pago que o sistema conferiu.
  const integralLido = cobranca ? valorPagoNaOrder(cobranca) : null;
  return comPagamento(db, organizacaoId, pagamentoId, async (tx, t, p, dev) => {
    const recusa = recusaDaDevolucao(p, dev, true, agora, t.cancelamento);
    if (recusa) return { ok: false as const, erro: recusa };
    const integral = integralLido ?? valorPagoNaOrder({ pago: p.valorPago, valor: p.valor });
    if (d.valor !== integral)
      return { ok: false as const, erro: `Nesta fase, a devolução feita por fora registra só o valor integral pago (${formatBRL(integral)}, ${integralLido === null ? "o último conferido no Mercado Pago" : "pelo Mercado Pago"}). Devolução de parte do valor chega com o M8.2d.` };
    // A devolução não pode ser de antes do pagamento existir (o pagamento foi criado neste dia, em São Paulo).
    const criadoNoDia = hojeISO(FUSO_PAGAMENTO, p.criadoEm);
    if (d.data < criadoNoDia) return { ok: false as const, erro: `A data da devolução não pode ser antes do pagamento (${criadoNoDia.split("-").reverse().join("/")}). Confira a data.` };
    const doCancelamento = origemDa(p, dev) === "cancelamento";
    const motivo = textoMotivoSemReserva(p.motivoSemReserva) ?? "Pagamento sem reserva.";
    const valores = { situacao: "por_fora" as const, porForaData: d.data, porForaValor: d.valor, porForaNota: nota, proximaTentativaEm: null, chaveEmDuvida: false, autorId, atualizadoEm: agora };
    let linha: Devolucao;
    if (dev) [linha] = await tx.update(devolucoesPagamento).set(valores).where(eq(devolucoesPagamento.id, dev.id)).returning();
    else [linha] = await tx.insert(devolucoesPagamento).values({ organizacaoId, pagamentoId: p.id, motivo, valor: d.valor, ...valores, criadoEm: agora }).returning();
    if (dev) Object.assign(dev, linha);
    else t.devolucoes.push(linha);
    // A taxa que não voltou: o que foi devolvido menos o que entrou (os recebimentos em vigor, pelo líquido), ou menos o
    // líquido informado quando nada entrou. Taxa divergente (recebimento e provedor discordam) ou nada conhecido: aviso.
    const recebidos = (await recebimentosDoPagamento(tx, organizacaoId, p.id)).emVigor.filter((l) => l.estado === "realizado" || l.estado === "conciliado");
    const soma = recebidos.reduce((s, l) => s + (l.montante ?? 0), 0);
    let taxa: number | null = null;
    if (soma > 0 && !p.avisos.includes("taxa_divergente")) taxa = d.valor - soma;
    else if (soma === 0 && p.liquido !== null) taxa = d.valor - p.liquido;
    if (taxa !== null && taxa < 0) taxa = null;
    let semTaxa = taxa === null;
    if (taxa !== null && linha.taxaPerdida === null) {
      let despesa: string | null = null;
      if (taxa > 0) {
        const l = await lancarTaxaPerdida(tx, organizacaoId, t, p, linha, taxa, d.data, chaveTaxaPerdida(p.id, linha.id), autorId);
        if (l.ok) despesa = l.id;
        else semTaxa = true;
      }
      if (!semTaxa) {
        await tx.update(devolucoesPagamento).set({ taxaPerdida: taxa, despesaLancamentoId: despesa, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, linha.id));
        Object.assign(linha, { taxaPerdida: taxa, despesaLancamentoId: despesa });
      }
    }
    if (doCancelamento) {
      // O desfecho continua "reserva"; o caixa do cancelamento fica lançado com a data informada.
      await acertarCaixa(tx, organizacaoId, t, p, linha, { data: d.data, estado: "realizado", origem: "manual" }, agora, autorId);
    } else {
      await tx.update(pagamentos).set({ desfecho: "por_fora", desfechoMotivo: nota || motivo, desfechoPor: autorId, desfechoEm: agora, atualizadoEm: agora }).where(eq(pagamentos.id, p.id));
      p.desfecho = "por_fora";
    }
    await trocarAvisos(
      tx,
      p,
      { desligar: ["devolucao_falhou", "devolucao_parada", "devolucao_sem_confirmacao", "devolucao_fora_do_prazo", ...(semTaxa ? [] : (["taxa_perdida_desconhecida"] as CodigoAviso[]))], ligar: semTaxa ? ["taxa_perdida_desconhecida"] : [] },
      agora,
    );
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "pagamento.devolucao_por_fora",
      entidade: "pagamento",
      entidadeId: p.id,
      mudancas: { ...(doCancelamento ? {} : { desfecho: [null, "por_fora"] }), devolucao: [null, `${d.valor} em ${d.data}`], ...(semTaxa ? {} : { taxaPerdida: [null, taxa] }) },
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

/**
 * "Confirmar devolução feita no painel do Mercado Pago" (M8.2c, `financeiro:editar`): a equipe viu no painel do Mercado
 * Pago a devolução do valor INTEGRAL concluída e o sistema não tem como ver (pagamento fora do prazo de leitura; ou a
 * leitura não confirma: devolução aceita sem aparecer, devolvida a menos, situação que o sistema não reconhece). Com
 * provedor, a order é relida antes (fora de transação): se ela confirma sozinha, vale a leitura. Sem provedor, só quando a
 * order com certeza não existe mais. Lança o caixa do cancelamento com a data informada (realizado) e liga o aviso da taxa.
 */
export async function confirmarDevolucaoVistaNoProvedor(
  db: Db,
  organizacaoId: string,
  pagamentoId: string,
  d: { data: string; nota: string },
  autorId: string | null,
  provedor: ProvedorPagamento | null,
  agora: Date = new Date(),
): Promise<ResultadoAcaoPagamento> {
  const problema = problemaDoRegistro(d, agora);
  if (problema) return { ok: false, erro: problema };
  const nota = d.nota.trim();
  if (!uuidValido(pagamentoId)) return { ok: false, erro: "Pagamento não encontrado." };
  const [lido] = await db.select().from(pagamentos).where(and(eq(pagamentos.id, pagamentoId), eq(pagamentos.organizacaoId, organizacaoId)));
  if (!lido) return { ok: false, erro: "Pagamento não encontrado." };
  const devLida = await devolucaoLida(db, lido.id);
  if (!devLida || (devLida.situacao !== "pedida" && devLida.situacao !== "recusada")) return { ok: false, erro: "Não há devolução pedida ou recusada para confirmar neste pagamento." };
  const foraDaLeitura = lido.criadoEm.getTime() < inicioDoPrazoDeReleitura(agora).getTime();
  const semConfirmacaoPelaLeitura = lido.avisos.includes("devolucao_sem_confirmacao") || lido.avisos.includes("devolucao_a_menor") || lido.avisos.includes("situacao_desconhecida");
  const AINDA_CONFERE = "O Mercado Pago ainda deixa conferir este pagamento: use Conferir agora (a confirmação vem da leitura).";
  if (!foraDaLeitura && !semConfirmacaoPelaLeitura) return { ok: false, erro: AINDA_CONFERE };
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
        await conferirTentativa(db, organizacaoId, pagamentoId, provedor, agora, { forcar: true, origem: "painel", cobranca });
      } catch {
        return { ok: false, erro: ERRO_POR_FORA_SEM_CONFERIR };
      }
      if ((await situacaoDaDevolucao(db, devLida.id)) === "confirmada") return { ok: true, situacao: "confirmada", mensagem: "O Mercado Pago já mostra a devolução: confirmada pela leitura." };
      // A order ainda aparece e não confirma: sem aviso, a confirmação vem da leitura (Conferir agora), também depois do
      // prazo de leitura, enquanto o Mercado Pago ainda mostra a order. Com um dos avisos (aceita sem aparecer, devolvida a
      // menos, situação que o sistema não reconhece), a leitura não tem como confirmar, dentro ou fora do prazo: a equipe
      // confirma o que vê no painel dele (recusar aqui só a faria esperar a order sumir, aos 90 dias, para confirmar sem
      // leitura nenhuma).
      if (!semConfirmacaoPelaLeitura) return { ok: false, erro: AINDA_CONFERE };
    }
  }
  return comPagamento(db, organizacaoId, pagamentoId, async (tx, t, p, dev) => {
    if (!dev || dev.id !== devLida.id || (dev.situacao !== "pedida" && dev.situacao !== "recusada")) return { ok: false as const, erro: "Não há devolução pedida ou recusada para confirmar neste pagamento." };
    if (!origemDeDevolucaoConhecida(dev.origem) || !cabeNoPagamento(dev, p, t.cancelamento)) return { ok: false as const, erro: "Esta devolução não cabe mais neste pagamento: confira o quadro Pagamento no site." };
    if (d.data < hojeISO(FUSO_PAGAMENTO, dev.criadoEm)) return { ok: false as const, erro: `A data não pode ser antes de a devolução ser registrada (${hojeISO(FUSO_PAGAMENTO, dev.criadoEm).split("-").reverse().join("/")}).` };
    const antes = dev.situacao;
    const mudanca = { situacao: "confirmada" as const, confirmadaEm: instanteLocal(d.data, "12:00", FUSO_PAGAMENTO), confirmadaPor: "equipe" as const, confirmadaNota: nota, chaveEmDuvida: false, chaveAceita: false, proximaTentativaEm: null, autorId, atualizadoEm: agora };
    const [linha] = await tx.update(devolucoesPagamento).set(mudanca).where(eq(devolucoesPagamento.id, dev.id)).returning();
    Object.assign(dev, linha);
    if (dev.origem === "sem_reserva") {
      await tx.update(pagamentos).set({ desfecho: "devolucao", desfechoMotivo: dev.motivo, desfechoPor: autorId, desfechoEm: agora, atualizadoEm: agora }).where(eq(pagamentos.id, p.id));
      p.desfecho = "devolucao";
    } else await acertarCaixa(tx, organizacaoId, t, p, dev, { data: d.data, estado: "realizado", origem: "manual" }, agora, autorId);
    await trocarAvisos(
      tx,
      p,
      { desligar: ["devolucao_fora_do_prazo", "devolucao_sem_confirmacao", "devolucao_falhou", "devolucao_parada", "devolucao_a_menor"], ligar: dev.taxaPerdida === null ? ["taxa_perdida_desconhecida"] : [] },
      agora,
    );
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.devolucao_confirmada_pela_equipe", entidade: "pagamento", entidadeId: p.id, mudancas: { devolucao: [antes, "confirmada"], data: [null, d.data] } });
    return { ok: true as const, situacao: "confirmada" as const };
  });
}

/**
 * "Registrar que o Mercado Pago recusou a devolução no painel" (M8.2c, `financeiro:editar`): a devolução ficou recusada
 * aqui (ou pedida sem aceite, depois do prazo de leitura) e o painel do Mercado Pago também recusou. Libera a devolução
 * por fora no cartão. Data e nota (sem dado pessoal), auditadas.
 */
export async function registrarRecusaNoPainel(db: Db, organizacaoId: string, pagamentoId: string, d: { data: string; nota: string }, autorId: string | null, agora: Date = new Date()): Promise<ResultadoAcaoPagamento> {
  const problema = problemaDoRegistro(d, agora);
  if (problema) return { ok: false, erro: problema };
  const nota = d.nota.trim();
  return comPagamento(db, organizacaoId, pagamentoId, async (tx, _t, p, dev) => {
    const foraDaLeitura = p.criadoEm.getTime() < inicioDoPrazoDeReleitura(agora).getTime();
    const pode = !!dev && origemDeDevolucaoConhecida(dev.origem) && (dev.situacao === "recusada" || (dev.situacao === "pedida" && foraDaLeitura && !dev.chaveAceita));
    if (!dev || !pode) return { ok: false as const, erro: "Só uma devolução recusada (ou pedida, sem aceite, depois do prazo de leitura do Mercado Pago) pode ter a recusa do painel registrada." };
    if (dev.recusaNoPainelEm) return { ok: false as const, erro: "A recusa do painel do Mercado Pago já foi registrada." };
    if (d.data < hojeISO(FUSO_PAGAMENTO, dev.criadoEm)) return { ok: false as const, erro: "A data não pode ser antes de a devolução ser registrada." };
    const [linha] = await tx
      .update(devolucoesPagamento)
      .set({ situacao: "recusada", proximaTentativaEm: null, chaveEmDuvida: false, recusaNoPainelEm: instanteLocal(d.data, "12:00", FUSO_PAGAMENTO), recusaNoPainelPor: autorId, recusaNoPainelNota: nota, atualizadoEm: agora })
      .where(eq(devolucoesPagamento.id, dev.id))
      .returning();
    Object.assign(dev, linha);
    await ligarAvisoNoPagamento(tx, p, "devolucao_falhou", agora);
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
export async function pararDevolucaoPedida(db: Db, organizacaoId: string, pagamentoId: string, d: { nota: string }, autorId: string | null, provedor: ProvedorPagamento | null, agora: Date = new Date()): Promise<ResultadoAcaoPagamento> {
  const nota = d.nota.trim();
  if (!uuidValido(pagamentoId)) return { ok: false, erro: "Pagamento não encontrado." };
  const [lido] = await db.select().from(pagamentos).where(and(eq(pagamentos.id, pagamentoId), eq(pagamentos.organizacaoId, organizacaoId)));
  if (!lido) return { ok: false, erro: "Pagamento não encontrado." };
  const devLida = await devolucaoLida(db, lido.id);
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
  return comPagamento(db, organizacaoId, pagamentoId, async (tx, _t, p, dev) => {
    if (!dev || dev.id !== devLida.id || dev.situacao !== "pedida" || dev.chaveAceita !== devLida.chaveAceita || dev.chaveEmDuvida !== devLida.chaveEmDuvida) return { ok: false as const, erro: FORA };
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
 * Teto da taxa que não voltou: na devolução pelo Mercado Pago, a taxa da aprovação mais os juros do parcelamento pagos
 * pelo hóspede (o pago − o valor), quando a taxa é conhecida; sem ela, o valor devolvido. Por fora, o valor devolvido.
 */
function tetoDaTaxa(p: Pagamento, dev: Devolucao): { teto: number; erro: (valor: number) => string } {
  const conferir = "Confira o valor (em reais, com vírgula: ex.: 18,06).";
  if (dev.situacao === "por_fora") {
    const teto = dev.porForaValor ?? dev.valor;
    return { teto, erro: (v) => `A taxa que não voltou (${formatBRL(v)}) não pode passar do valor devolvido por fora (${formatBRL(teto)}). ${conferir}` };
  }
  if (p.taxa !== null) {
    const juros = Math.max(0, (p.valorPago ?? p.valor) - p.valor);
    const teto = p.taxa + juros;
    return {
      teto,
      erro: (v) =>
        juros > 0
          ? `A taxa que não voltou (${formatBRL(v)}) não pode passar da taxa que o Mercado Pago cobrou neste pagamento mais os juros do parcelamento (${formatBRL(teto)}). ${conferir}`
          : `A taxa que não voltou (${formatBRL(v)}) não pode passar da taxa que o Mercado Pago cobrou neste pagamento (${formatBRL(teto)}). ${conferir}`,
    };
  }
  const teto = dev.valorConfirmado ?? dev.valor;
  return { teto, erro: (v) => `A taxa que não voltou (${formatBRL(v)}) não pode passar do valor do pagamento (${formatBRL(teto)}), devolvido ao hóspede. ${conferir}` };
}

/** Dia da despesa da taxa: o da confirmação da devolução, ou a data da devolução por fora. */
const diaDaTaxa = (dev: Devolucao, agora: Date) => (dev.situacao === "por_fora" && dev.porForaData ? dev.porForaData : hojeISO(FUSO_PAGAMENTO, dev.confirmadaEm ?? agora));

/**
 * Taxa (e juros do parcelamento, se o Mercado Pago tirou da SCL) que não voltou, informada pela equipe depois da
 * devolução confirmada ou feita por fora (o provedor só informa a tarifa da aprovação, não o que voltou). Valor em
 * centavos, zero se voltou toda, e nunca mais que o teto (`tetoDaTaxa`). Vira despesa da empresa na categoria da aba
 * Pagamento no site, com chave própria por devolução (idempotente), e o aviso sai. Uma vez por devolução; para mudar,
 * "Corrigir taxa que não voltou".
 */
export async function registrarTaxaPerdida(db: Db, organizacaoId: string, pagamentoId: string, valor: number, autorId: string | null, agora: Date = new Date()): Promise<ResultadoAcaoPagamento> {
  if (!Number.isSafeInteger(valor) || valor < 0) return { ok: false, erro: "Informe a taxa que não voltou, em reais (zero se voltou toda)." };
  return comPagamento(db, organizacaoId, pagamentoId, async (tx, t, p, dev) => {
    if (!dev || (dev.situacao !== "confirmada" && dev.situacao !== "por_fora")) return { ok: false as const, erro: "A taxa que não voltou se registra depois da devolução confirmada pelo Mercado Pago (ou feita por fora)." };
    if (dev.taxaPerdida !== null) return { ok: false as const, erro: `A taxa que não voltou já foi registrada (${formatBRL(dev.taxaPerdida)}): para mudar, use "Corrigir taxa que não voltou".` };
    // Um valor acima do teto é quase sempre digitação (ex.: 1806 por 18,06). Avisa com os dois valores, nunca grava.
    const { teto, erro } = tetoDaTaxa(p, dev);
    if (valor > teto) return { ok: false as const, erro: erro(valor) };
    let despesaLancamentoId: string | null = null;
    if (valor > 0) {
      const l = await lancarTaxaPerdida(tx, organizacaoId, t, p, dev, valor, diaDaTaxa(dev, agora), chaveTaxaPerdida(p.id, dev.id), autorId);
      if (!l.ok) return { ok: false as const, erro: l.erro };
      despesaLancamentoId = l.id;
    }
    await tx.update(devolucoesPagamento).set({ taxaPerdida: valor, despesaLancamentoId, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
    await trocarAvisos(tx, p, { desligar: ["taxa_perdida_desconhecida"] }, agora);
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.taxa_perdida", entidade: "pagamento", entidadeId: p.id, mudancas: { taxaPerdida: [null, valor] } });
    return { ok: true as const };
  });
}

/**
 * "Corrigir taxa que não voltou" (M8.2c, `financeiro:editar`): a despesa do pagamento do site não se estorna em Despesas
 * (chave `mercadopago:`); aqui a atual é estornada, com o motivo, e a nova é lançada com a chave seguinte (`#N`). O mesmo teto.
 */
export async function corrigirTaxaPerdida(db: Db, organizacaoId: string, pagamentoId: string, valor: number, motivo: string, autorId: string | null, agora: Date = new Date()): Promise<ResultadoAcaoPagamento> {
  if (!Number.isSafeInteger(valor) || valor < 0) return { ok: false, erro: "Informe a taxa que não voltou, em reais (zero se voltou toda)." };
  const m = motivo.trim();
  const problema = problemaDaNota(m, true);
  if (problema) return { ok: false, erro: !m ? "Informe o motivo da correção." : problema };
  return comPagamento(db, organizacaoId, pagamentoId, async (tx, t, p, dev) => {
    if (!dev || dev.taxaPerdida === null) return { ok: false as const, erro: "Ainda não há taxa que não voltou registrada para corrigir." };
    if (dev.taxaPerdida === valor) return { ok: false as const, erro: `A taxa que não voltou já está registrada com ${formatBRL(valor)}.` };
    const { teto, erro } = tetoDaTaxa(p, dev);
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
      const l = await lancarTaxaPerdida(tx, organizacaoId, t, p, dev, valor, dia, chaveTaxaPerdida(p.id, dev.id, n), autorId);
      if (!l.ok) return { ok: false as const, erro: l.erro };
      despesaLancamentoId = l.id;
    }
    const antes = dev.taxaPerdida;
    await tx.update(devolucoesPagamento).set({ taxaPerdida: valor, despesaLancamentoId, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.taxa_perdida_corrigida", entidade: "pagamento", entidadeId: p.id, mudancas: { taxaPerdida: [antes, valor] } });
    return { ok: true as const };
  });
}
