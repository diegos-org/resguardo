/**
 * Pagamento no site (M8.2a) — devolução do pagamento que ficou sem reserva (design "Devolução na parte (a)").
 *
 * A equipe escolhe, com confirmação: devolver pelo Mercado Pago (integral) ou registrar a devolução feita por
 * fora. As duas exigem, sob a trava da tentativa, desfecho vazio, decisão "sem reserva" gravada e nenhuma
 * devolução pedida. Pelo provedor: `pedida` até a leitura da order dizer devolvido; cada pedido novo usa chave
 * nova, gravada antes, e relê a order antes (já devolvida = confirmada; devolução em andamento = não pede de novo).
 * Recusa e resposta incerta contam do mesmo jeito; a terceira só vira "recusada" (aviso) depois de reler a order sem
 * nenhum sinal de devolução (feita, em parte ou em andamento): com sinal, continua pedida e a leitura confirma. Assim
 * uma devolução que só recebe respostas incertas não fica "pedida" para sempre, e uma que saiu nunca é dada por
 * recusada. Pedido ACEITO pelo provedor: nada se envia de novo (nem com outra chave, nem num pedido novo da equipe),
 * só a leitura confirma; três leituras sem a devolução viram aviso, e ela continua pedida, qualquer que seja a leitura
 * (nunca para: parar abriria o registro por fora, em dobro). Order devolvida em parte ou contestada antes de pedir
 * (pedido ainda não aceito): a leitura é aplicada e a devolução para (aviso; devolver o inteiro devolveria a mais).
 * O pedido só sai com a order relida aprovada e a mesma da tentativa; qualquer outra leitura também para (aviso).
 * Por fora: só depois
 * de reler a order no provedor (devolvida, em andamento ou contestada = recusa), e só o valor integral. A taxa que
 * não voltar a equipe informa depois da confirmação ("Registrar taxa que não voltou"): vira despesa da empresa.
 */
import { and, eq } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { categoriaDaTaxaPerdida } from "@/configuracoes/pagamento-site";
import { devolucoesPagamento, pagamentos } from "@/db/schema";
import type { Db } from "@/db/types";
import { lancar } from "@/financeiro/ledger";
import { hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { formatBRL } from "@/lib/money";
import { dataValida } from "@/reservas/regras";
import { conferirTentativa } from "./conferencia";
import { FUSO_PAGAMENTO } from "./liberacao";
import { type Cobranca, type ProvedorPagamento, type ResultadoDevolucao, valorPagoNaOrder } from "./provedor";
import type { SituacaoDevolucao } from "@/db/schema";
import { type CodigoAviso, textoMotivoSemReserva } from "./situacoes";
import { type Devolucao, type Pagamento, type Travado, travarCotacao } from "./travas";

/** Recusas ou respostas incertas do provedor até a devolução ficar "recusada" (sempre depois de reler a order sem sinal de devolução). */
export const MAXIMO_FALHAS_DEVOLUCAO = 3;
/** Espera entre uma tentativa de devolução e a seguinte (a rotina relê a order antes). */
export const ESPERA_DEVOLUCAO_MS = 10 * 60_000;
export const chaveDevolucao = (devolucaoId: string, n: number) => `devolucao:${devolucaoId}:${n}`;
/** Despesa da taxa que o provedor não devolveu (uma por tentativa; idempotente). */
export const chaveTaxaPerdida = (pagamentoId: string) => `mercadopago:${pagamentoId}:taxa_perdida`;

export type ResultadoAcaoPagamento = { ok: true; situacao?: SituacaoDevolucao } | { ok: false; erro: string };

async function cotacaoDoPagamento(db: Db, organizacaoId: string, pagamentoId: string): Promise<string | null> {
  if (!uuidValido(pagamentoId)) return null;
  const [p] = await db.select({ cotacaoId: pagamentos.cotacaoId }).from(pagamentos).where(and(eq(pagamentos.id, pagamentoId), eq(pagamentos.organizacaoId, organizacaoId)));
  return p?.cotacaoId ?? null;
}

/**
 * Pode decidir o destino do dinheiro (devolver)? Sob a trava. Devolve o motivo da recusa, ou null. Por fora também
 * vale para o pagamento contestado (a situação local nunca volta a "aprovado"; a releitura no provedor decide antes e
 * só aceita com a contestação resolvida). Devolvido em parte, não: o provedor sempre mostra a parte devolvida.
 */
function recusaDaDevolucao(p: Pagamento, dev: Devolucao | undefined, porFora: boolean): string | null {
  const situacoes = porFora ? ["aprovado", "contestado"] : ["aprovado"];
  if (!situacoes.includes(p.situacao)) return "Só um pagamento aprovado (e ainda não devolvido) pode ser devolvido.";
  if (p.desfecho !== null) return "Este pagamento já tem desfecho.";
  if (p.motivoSemReserva === null) return "Este pagamento ainda está sendo conferido ou confirmou a reserva: não se devolve na parte (a).";
  if (dev?.situacao === "pedida") return "Já há uma devolução pedida ao Mercado Pago para este pagamento.";
  // Um pedido que o Mercado Pago aceitou ainda pode sair por lá: registrar por fora devolveria em dobro.
  if (porFora && dev?.chaveAceita) return "O Mercado Pago aceitou um pedido de devolução deste pagamento, que ainda pode sair por lá: a devolução por fora não é registrada. Confira no painel do Mercado Pago e resolva por lá até o M8.2c.";
  // Depois de 3 recusas (recusada), a equipe pode pedir de novo ou registrar a devolução feita por fora.
  if (dev && dev.situacao !== "recusada") return porFora ? "A devolução deste pagamento já foi registrada." : "A devolução deste pagamento já foi feita.";
  return null;
}

/** A order mostra devolução feita, em parte ou em andamento? (Nesse caso nada se pede nem se registra por fora.) */
const temDevolucao = (c: Cobranca) => c.situacao === "devolvido" || c.situacao === "devolvido_parcial" || c.devolvido > 0 || c.devolucaoEmAndamento;

async function adiarDevolucao(db: Db, devolucaoId: string, agora: Date): Promise<void> {
  await db.update(devolucoesPagamento).set({ proximaTentativaEm: new Date(agora.getTime() + ESPERA_DEVOLUCAO_MS), atualizadoEm: agora }).where(eq(devolucoesPagamento.id, devolucaoId));
}

/** Liga o aviso no pagamento (sob a trava de quem chama), sem repetir. */
async function ligarAvisoNoPagamento(tx: Db, p: Pagamento, aviso: CodigoAviso, agora: Date): Promise<void> {
  if (!p.avisos.includes(aviso)) await tx.update(pagamentos).set({ avisos: [...p.avisos, aviso], atualizadoEm: agora }).where(eq(pagamentos.id, p.id));
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
 * confirmação vem da leitura.
 */
export async function tentarDevolucao(db: Db, organizacaoId: string, devolucaoId: string, provedor: ProvedorPagamento, agora: Date = new Date()): Promise<SituacaoDevolucao | null> {
  if (!uuidValido(devolucaoId)) return null;
  const [d] = await db
    .select({ dev: devolucoesPagamento, cotacaoId: pagamentos.cotacaoId, idProvedor: pagamentos.idProvedor, referencia: pagamentos.referencia })
    .from(devolucoesPagamento)
    .innerJoin(pagamentos, eq(pagamentos.id, devolucoesPagamento.pagamentoId))
    .where(and(eq(devolucoesPagamento.id, devolucaoId), eq(devolucoesPagamento.organizacaoId, organizacaoId)));
  if (!d || d.dev.situacao !== "pedida" || !d.idProvedor) return d?.dev.situacao ?? null;
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
  // Pedido já aceito pelo provedor: nada se envia de novo (nem com a mesma chave) e ele nunca para, qualquer que seja a
  // leitura (em parte, contestada...): a devolução aceita ainda pode sair, e parar abriria o registro por fora (em
  // dobro). A leitura é aplicada e confirma quando a order mostrar; três sem a devolução viram aviso.
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
  if (!cobranca) res = { situacao: "recusada", idDevolucao: null, mensagem: "O Mercado Pago não encontrou o pagamento." };
  else {
    // Grava a chave antes de chamar, sob as travas. Depois de uma resposta incerta, a MESMA chave de novo (o pedido
    // anterior pode ter sido aceito: o provedor não devolve duas vezes pela mesma chave); senão, chave nova.
    // `repetida`: a chave enviada já estava em dúvida (um pedido anterior com ela pode ter saído).
    const reserva = await db.transaction(async (tx) => {
      const t = await travarCotacao(tx, organizacaoId, d.cotacaoId);
      const dev = t?.devolucoes.find((x) => x.id === devolucaoId);
      // Sob a trava: ainda pedida, a vez dela chegou e ninguém pediu desde a leitura (painel e rotina ao mesmo tempo).
      if (!t || !dev || dev.situacao !== "pedida" || dev.chaveAceita || dev.tentativas !== d.dev.tentativas || (dev.proximaTentativaEm && dev.proximaTentativaEm.getTime() > agora.getTime())) return null;
      // O pagamento ainda está aprovado e sem desfecho? Uma leitura que cruzou (Conferir agora, aviso) pode tê-lo
      // levado a devolvido em parte ou contestado depois da releitura acima: então nada se pede por cima, e para.
      const p = t.tentativas.find((x) => x.id === dev.pagamentoId);
      if (!p || p.situacao !== "aprovado" || p.desfecho !== null) {
        await tx.update(devolucoesPagamento).set({ situacao: "recusada", proximaTentativaEm: null, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
        if (p) {
          await ligarAvisoNoPagamento(tx, p, "devolucao_parada", agora);
          await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "pagamento.devolucao_parada", entidade: "pagamento", entidadeId: p.id, mudancas: { devolucao: ["pedida", "recusada"] } });
        }
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
    if (res.situacao === "confirmada" || res.situacao === "pedida") {
      // Aceito pelo provedor: daí em diante nada se envia de novo (a order pode demorar a mostrar a devolução; um envio
      // novo poderia devolver de novo). Só a leitura confirma; as falhas recomeçam a contar as leituras sem a devolução.
      await tx
        .update(devolucoesPagamento)
        .set({ chaveEmDuvida: true, chaveAceita: true, falhas: 0, ...(res.idDevolucao ? { idProvedor: res.idDevolucao } : {}), atualizadoEm: agora })
        .where(eq(devolucoesPagamento.id, dev.id));
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
      .set({ falhas, chaveEmDuvida: res.situacao === "incerta" || chaveRepetida, ...(desistiu ? { situacao: "recusada" as const, proximaTentativaEm: null } : {}), atualizadoEm: agora })
      .where(eq(devolucoesPagamento.id, dev.id));
    if (desistiu) {
      const p = t.tentativas.find((x) => x.id === dev.pagamentoId)!;
      if (!p.avisos.includes("devolucao_falhou")) await tx.update(pagamentos).set({ avisos: [...p.avisos, "devolucao_falhou"], atualizadoEm: agora }).where(eq(pagamentos.id, p.id));
      await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "pagamento.devolucao_recusada", entidade: "pagamento", entidadeId: p.id, mudancas: { devolucao: ["pedida", "recusada"] } });
    }
  });
  // A confirmação só vem da leitura da order.
  if (res.situacao === "confirmada" || res.situacao === "pedida") await conferirTentativa(db, organizacaoId, d.dev.pagamentoId, provedor, agora, { forcar: true, origem: "rotina" });
  else if (releitura && temDevolucao(releitura)) await conferirTentativa(db, organizacaoId, d.dev.pagamentoId, provedor, agora, { forcar: true, origem: "rotina", cobranca: releitura });
  return (await situacaoDaDevolucao(db, devolucaoId)) ?? null;
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
    return f(tx, t, p, t.devolucoes.find((x) => x.pagamentoId === p.id));
  });
}

/** Devolver pelo Mercado Pago (integral). A equipe confirma na tela; autorização conferida por quem chama. */
export async function devolverPeloProvedor(db: Db, organizacaoId: string, pagamentoId: string, autorId: string | null, provedor: ProvedorPagamento, agora: Date = new Date()): Promise<ResultadoAcaoPagamento> {
  const r = await comPagamento(db, organizacaoId, pagamentoId, async (tx, _t, p, dev) => {
    const recusa = recusaDaDevolucao(p, dev, false);
    if (recusa) return { ok: false as const, erro: recusa };
    const motivo = textoMotivoSemReserva(p.motivoSemReserva) ?? "Pagamento sem reserva.";
    // O que o hóspede pagou pela última leitura (a devolução integral devolve isso); cada envio regrava pela releitura.
    const integral = valorPagoNaOrder({ pago: p.valorPago, valor: p.valor });
    let id: string;
    if (dev) {
      // Devolução que desistiu depois de 3 recusas (relida a order, sem sinal de devolução): a equipe pede de novo, com
      // chave nova (as falhas recomeçam; a numeração das chaves continua). Pedido que o provedor já aceitou nunca ganha
      // chave nova: continua só à espera da leitura.
      await tx
        .update(devolucoesPagamento)
        .set({ situacao: "pedida", falhas: 0, chaveEmDuvida: dev.chaveAceita, proximaTentativaEm: agora, autorId, atualizadoEm: agora })
        .where(eq(devolucoesPagamento.id, dev.id));
      id = dev.id;
    } else {
      [{ id }] = await tx
        .insert(devolucoesPagamento)
        .values({ organizacaoId, pagamentoId: p.id, motivo, valor: integral, situacao: "pedida", proximaTentativaEm: agora, autorId, criadoEm: agora, atualizadoEm: agora })
        .returning({ id: devolucoesPagamento.id });
    }
    await tx.update(pagamentos).set({ avisos: p.avisos.filter((a) => a !== "devolucao_falhou" && a !== "devolucao_parada"), atualizadoEm: agora }).where(eq(pagamentos.id, p.id));
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
    return "O Mercado Pago mostra este pagamento como devolvido (no todo ou em parte): a devolução por fora não é registrada, para o hóspede não receber duas vezes. Confira no painel do Mercado Pago; o restante, se houver, se resolve por lá até o M8.2c.";
  if (c.devolucaoEmAndamento) return "O Mercado Pago mostra uma devolução em andamento neste pagamento: espere ela concluir (use Conferir agora) em vez de devolver por fora.";
  if (c.situacao === "contestado") return "Este pagamento está contestado no Mercado Pago: o dinheiro pode voltar ao hóspede pela contestação. Resolva pelo painel do Mercado Pago, sem devolver por fora.";
  if (c.situacao !== "aprovado") return "O Mercado Pago não mostra este pagamento como aprovado agora: confira no painel do Mercado Pago antes de registrar a devolução por fora.";
  return null;
}

/**
 * Devolução feita por fora (Pix da conta da empresa, por exemplo): data até hoje, o valor integral pago (pela leitura
 * da order) e nota. Antes, a order é relida no provedor (fora de transação): outra order (id ou referência
 * diferentes), devolvida, com devolução em andamento ou contestada = recusa; sem conseguir ler (ou sem provedor),
 * recusa também. A leitura é aplicada (pode confirmar uma devolução pedida).
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
  if (!uuidValido(pagamentoId)) return { ok: false, erro: "Pagamento não encontrado." };
  const [lido] = await db.select({ idProvedor: pagamentos.idProvedor, referencia: pagamentos.referencia }).from(pagamentos).where(and(eq(pagamentos.id, pagamentoId), eq(pagamentos.organizacaoId, organizacaoId)));
  if (!lido) return { ok: false, erro: "Pagamento não encontrado." };
  if (!provedor) return { ok: false, erro: ERRO_POR_FORA_SEM_CONFERIR };
  if (!lido.idProvedor) return { ok: false, erro: "Este pagamento não tem identificação no Mercado Pago para conferir: confira no painel do Mercado Pago." };
  let cobranca: Cobranca | null;
  try {
    cobranca = await provedor.consultar(lido.idProvedor);
  } catch {
    return { ok: false, erro: ERRO_POR_FORA_SEM_CONFERIR };
  }
  if (!cobranca) return { ok: false, erro: "O Mercado Pago não encontrou este pagamento: confira no painel do Mercado Pago antes de registrar a devolução por fora." };
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
  // Integral = o que o hóspede pagou, pela leitura de agora (pode diferir do valor da cotação: valor divergente).
  const integral = valorPagoNaOrder(cobranca);
  const nota = d.nota.trim().slice(0, 300);
  return comPagamento(db, organizacaoId, pagamentoId, async (tx, _t, p, dev) => {
    const recusa = recusaDaDevolucao(p, dev, true);
    if (recusa) return { ok: false as const, erro: recusa };
    if (d.valor !== integral)
      return { ok: false as const, erro: `Nesta fase, a devolução feita por fora registra só o valor integral pago (${formatBRL(integral)}, pelo Mercado Pago). Devolução de parte do valor chega com o M8.2c.` };
    // A devolução não pode ser de antes do pagamento existir (o Pix foi criado neste dia, em São Paulo).
    const criadoNoDia = hojeISO(FUSO_PAGAMENTO, p.criadoEm);
    if (d.data < criadoNoDia) return { ok: false as const, erro: `A data da devolução não pode ser antes do pagamento (${criadoNoDia.split("-").reverse().join("/")}). Confira a data.` };
    const motivo = textoMotivoSemReserva(p.motivoSemReserva) ?? "Pagamento sem reserva.";
    const valores = { situacao: "por_fora" as const, porForaData: d.data, porForaValor: d.valor, porForaNota: nota, proximaTentativaEm: null, autorId, atualizadoEm: agora };
    if (dev) await tx.update(devolucoesPagamento).set(valores).where(eq(devolucoesPagamento.id, dev.id));
    else await tx.insert(devolucoesPagamento).values({ organizacaoId, pagamentoId: p.id, motivo, valor: d.valor, ...valores, criadoEm: agora });
    await tx
      .update(pagamentos)
      .set({ desfecho: "por_fora", desfechoMotivo: nota || motivo, desfechoPor: autorId, desfechoEm: agora, avisos: p.avisos.filter((a) => a !== "devolucao_falhou"), atualizadoEm: agora })
      .where(eq(pagamentos.id, p.id));
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.devolucao_por_fora", entidade: "pagamento", entidadeId: p.id, mudancas: { desfecho: [null, "por_fora"], devolucao: [null, `${d.valor} em ${d.data}`] } });
    return { ok: true as const, situacao: "por_fora" as const };
  });
}

/**
 * Taxa que o Mercado Pago não devolveu, informada pela equipe depois da devolução confirmada (o provedor só informa
 * a tarifa da aprovação, não o que voltou). Valor em centavos, zero se voltou toda, e nunca mais que a tarifa da
 * aprovação (sem ela, que o valor pago). Vira despesa da empresa na categoria da aba Pagamento no site, com chave
 * própria (idempotente), e o aviso sai. Uma vez por devolução.
 */
export async function registrarTaxaPerdida(db: Db, organizacaoId: string, pagamentoId: string, valor: number, autorId: string | null, agora: Date = new Date()): Promise<ResultadoAcaoPagamento> {
  if (!Number.isSafeInteger(valor) || valor < 0) return { ok: false, erro: "Informe a taxa que não voltou, em reais (zero se voltou toda)." };
  return comPagamento(db, organizacaoId, pagamentoId, async (tx, t, p, dev) => {
    if (!dev || dev.situacao !== "confirmada") return { ok: false as const, erro: "A taxa que não voltou se registra depois da devolução confirmada pelo Mercado Pago." };
    if (dev.taxaPerdida !== null) return { ok: false as const, erro: `A taxa que não voltou já foi registrada (${formatBRL(dev.taxaPerdida)}).` };
    // A taxa que não voltou nunca passa da que o Mercado Pago cobrou na aprovação (ou, sem ela, do valor pago): um
    // valor maior é quase sempre digitação (ex.: 1806 por 18,06). Avisa com os dois valores, nunca grava.
    const teto = p.taxa ?? p.valor;
    if (valor > teto)
      return {
        ok: false as const,
        erro:
          p.taxa !== null
            ? `A taxa que não voltou (${formatBRL(valor)}) não pode passar da taxa que o Mercado Pago cobrou neste pagamento (${formatBRL(p.taxa)}). Confira o valor (em reais, com vírgula: ex.: 18,06).`
            : `A taxa que não voltou (${formatBRL(valor)}) não pode passar do valor do pagamento (${formatBRL(p.valor)}). Confira o valor (em reais, com vírgula: ex.: 18,06).`,
      };
    let despesaLancamentoId: string | null = null;
    if (valor > 0) {
      const categoria = await categoriaDaTaxaPerdida(tx, organizacaoId, autorId);
      if (!categoria.ok) return { ok: false as const, erro: categoria.erro };
      const categoriaId = categoria.id;
      const data = hojeISO(FUSO_PAGAMENTO, dev.confirmadaEm ?? agora);
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
            categoriaId,
            origem: "manual",
            chaveOrigem: chaveTaxaPerdida(p.id),
          },
        ],
        autorId,
      );
      despesaLancamentoId = l.id;
    }
    await tx.update(devolucoesPagamento).set({ taxaPerdida: valor, despesaLancamentoId, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
    await tx.update(pagamentos).set({ avisos: p.avisos.filter((a) => a !== "taxa_perdida_desconhecida"), atualizadoEm: agora }).where(eq(pagamentos.id, p.id));
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.taxa_perdida", entidade: "pagamento", entidadeId: p.id, mudancas: { taxaPerdida: [null, valor] } });
    return { ok: true as const };
  });
}
