/**
 * Pagamento no site (M8.2a) — devolução do pagamento que ficou sem reserva (design "Devolução na parte (a)").
 *
 * A equipe escolhe, com confirmação: devolver pelo Mercado Pago (integral) ou registrar a devolução feita por
 * fora. As duas exigem, sob a trava da tentativa, desfecho vazio, decisão "sem reserva" gravada e nenhuma
 * devolução pedida. Pelo provedor: `pedida` até a leitura da order dizer devolvido; cada pedido novo usa chave
 * nova, gravada antes, e relê a order antes (já devolvida = confirmada; devolução em andamento = não pede de novo).
 * Resposta incerta não é falha: continua pedida e a próxima volta relê a order. Só recusa explícita conta, e a
 * terceira só vira "recusada" (aviso) depois de reler a order sem nenhum sinal de devolução. Por fora: só depois
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
import type { Cobranca, ProvedorPagamento, ResultadoDevolucao } from "./provedor";
import type { SituacaoDevolucao } from "@/db/schema";
import { textoMotivoSemReserva } from "./situacoes";
import { type Devolucao, type Pagamento, type Travado, travarCotacao } from "./travas";

/** Recusas explícitas do provedor até a devolução ficar "recusada" (resposta incerta não conta). */
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
 * vale para o dinheiro que chegou já devolvido em parte ou contestado (a releitura no provedor decide antes).
 */
function recusaDaDevolucao(p: Pagamento, dev: Devolucao | undefined, porFora: boolean): string | null {
  const situacoes = porFora ? ["aprovado", "devolvido_parcial", "contestado"] : ["aprovado"];
  if (!situacoes.includes(p.situacao)) return "Só um pagamento aprovado (e ainda não devolvido) pode ser devolvido.";
  if (p.desfecho !== null) return "Este pagamento já tem desfecho.";
  if (p.motivoSemReserva === null) return "Este pagamento ainda está sendo conferido ou confirmou a reserva: não se devolve na parte (a).";
  if (dev?.situacao === "pedida") return "Já há uma devolução pedida ao Mercado Pago para este pagamento.";
  // Depois de 3 recusas (recusada), a equipe pode pedir de novo ou registrar a devolução feita por fora.
  if (dev && dev.situacao !== "recusada") return porFora ? "A devolução deste pagamento já foi registrada." : "A devolução deste pagamento já foi feita.";
  return null;
}

/** A order mostra devolução feita, em parte ou em andamento? (Nesse caso nada se pede nem se registra por fora.) */
const temDevolucao = (c: Cobranca) => c.situacao === "devolvido" || c.situacao === "devolvido_parcial" || c.devolvido > 0 || c.devolucaoEmAndamento;

async function adiarDevolucao(db: Db, devolucaoId: string, agora: Date): Promise<void> {
  await db.update(devolucoesPagamento).set({ proximaTentativaEm: new Date(agora.getTime() + ESPERA_DEVOLUCAO_MS), atualizadoEm: agora }).where(eq(devolucoesPagamento.id, devolucaoId));
}

/**
 * Um pedido de devolução ao provedor (rotina e painel): relê a order antes (já devolvida = confirmada; devolução em
 * andamento = espera), grava a chave nova antes de chamar, chama fora de transação e registra o resultado. A
 * confirmação vem da leitura.
 */
export async function tentarDevolucao(db: Db, organizacaoId: string, devolucaoId: string, provedor: ProvedorPagamento, agora: Date = new Date()): Promise<SituacaoDevolucao | null> {
  if (!uuidValido(devolucaoId)) return null;
  const [d] = await db
    .select({ dev: devolucoesPagamento, cotacaoId: pagamentos.cotacaoId, idProvedor: pagamentos.idProvedor })
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
  let res: ResultadoDevolucao;
  if (!cobranca) res = { situacao: "recusada", idDevolucao: null, mensagem: "O Mercado Pago não encontrou o pagamento." };
  else {
    // Grava a chave da tentativa nova antes de chamar, sob as travas.
    const n = await db.transaction(async (tx) => {
      const t = await travarCotacao(tx, organizacaoId, d.cotacaoId);
      const dev = t?.devolucoes.find((x) => x.id === devolucaoId);
      // Sob a trava: ainda pedida, a vez dela chegou e ninguém pediu desde a leitura (painel e rotina ao mesmo tempo).
      if (!t || !dev || dev.situacao !== "pedida" || dev.tentativas !== d.dev.tentativas || (dev.proximaTentativaEm && dev.proximaTentativaEm.getTime() > agora.getTime())) return null;
      const proxima = dev.tentativas + 1;
      await tx.update(devolucoesPagamento).set({ tentativas: proxima, chaveAtual: chaveDevolucao(dev.id, proxima), proximaTentativaEm: new Date(agora.getTime() + ESPERA_DEVOLUCAO_MS), atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
      return proxima;
    });
    if (n === null) return situacaoDaDevolucao(db, devolucaoId);
    res = await provedor.devolver(cobranca, chaveDevolucao(devolucaoId, n), null);
  }
  // Antes de dar a devolução por recusada (a terceira recusa), a order é relida: a recusa pode ter cruzado com um
  // pedido anterior que saiu. undefined = não deu para ler (então não se desiste).
  let releitura: Cobranca | null | undefined;
  if (res.situacao === "recusada" && d.dev.falhas + 1 >= MAXIMO_FALHAS_DEVOLUCAO) {
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
      if (res.idDevolucao) await tx.update(devolucoesPagamento).set({ idProvedor: res.idDevolucao, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
      return;
    }
    // Incerta: o pedido pode ter saído. Não é falha; continua pedida e a próxima volta relê a order antes.
    if (res.situacao === "incerta") return;
    const falhas = dev.falhas + 1;
    const semSinalDeDevolucao = releitura === null || (releitura !== undefined && !temDevolucao(releitura));
    const desistiu = falhas >= MAXIMO_FALHAS_DEVOLUCAO && semSinalDeDevolucao;
    await tx
      .update(devolucoesPagamento)
      .set({ falhas, ...(desistiu ? { situacao: "recusada" as const, proximaTentativaEm: null } : {}), atualizadoEm: agora })
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
    let id: string;
    if (dev) {
      // Devolução que desistiu depois de 3 recusas: a equipe pede de novo (as falhas recomeçam; as chaves continuam).
      await tx.update(devolucoesPagamento).set({ situacao: "pedida", falhas: 0, proximaTentativaEm: agora, autorId, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
      id = dev.id;
    } else {
      [{ id }] = await tx
        .insert(devolucoesPagamento)
        .values({ organizacaoId, pagamentoId: p.id, motivo, valor: p.valor, situacao: "pedida", proximaTentativaEm: agora, autorId, criadoEm: agora, atualizadoEm: agora })
        .returning({ id: devolucoesPagamento.id });
    }
    await tx.update(pagamentos).set({ avisos: p.avisos.filter((a) => a !== "devolucao_falhou"), atualizadoEm: agora }).where(eq(pagamentos.id, p.id));
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.devolver", entidade: "pagamento", entidadeId: p.id, mudancas: { devolucao: [dev?.situacao ?? null, "pedida"], valor: [null, p.valor] } });
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
 * Devolução feita por fora (Pix da conta da empresa, por exemplo): data até hoje, o valor integral e nota. Antes, a
 * order é relida no provedor (fora de transação): devolvida, com devolução em andamento ou contestada = recusa; sem
 * conseguir ler (ou sem provedor), recusa também. A leitura é aplicada (pode confirmar uma devolução pedida).
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
  const [lido] = await db.select({ idProvedor: pagamentos.idProvedor }).from(pagamentos).where(and(eq(pagamentos.id, pagamentoId), eq(pagamentos.organizacaoId, organizacaoId)));
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
  const peloProvedor = recusaPeloProvedor(cobranca);
  if (peloProvedor) return { ok: false, erro: peloProvedor };
  const nota = d.nota.trim().slice(0, 300);
  return comPagamento(db, organizacaoId, pagamentoId, async (tx, _t, p, dev) => {
    const recusa = recusaDaDevolucao(p, dev, true);
    if (recusa) return { ok: false as const, erro: recusa };
    if (d.valor !== p.valor)
      return { ok: false as const, erro: `Nesta fase, a devolução feita por fora registra só o valor integral do pagamento (${formatBRL(p.valor)}). Devolução de parte do valor chega com o M8.2c.` };
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
 * a tarifa da aprovação, não o que voltou). Valor em centavos, zero se voltou toda. Vira despesa da empresa na
 * categoria da aba Pagamento no site, com chave própria (idempotente), e o aviso sai. Uma vez por devolução.
 */
export async function registrarTaxaPerdida(db: Db, organizacaoId: string, pagamentoId: string, valor: number, autorId: string | null, agora: Date = new Date()): Promise<ResultadoAcaoPagamento> {
  if (!Number.isSafeInteger(valor) || valor < 0) return { ok: false, erro: "Informe a taxa que não voltou, em reais (zero se voltou toda)." };
  return comPagamento(db, organizacaoId, pagamentoId, async (tx, t, p, dev) => {
    if (!dev || dev.situacao !== "confirmada") return { ok: false as const, erro: "A taxa que não voltou se registra depois da devolução confirmada pelo Mercado Pago." };
    if (dev.taxaPerdida !== null) return { ok: false as const, erro: `A taxa que não voltou já foi registrada (${formatBRL(dev.taxaPerdida)}).` };
    if (valor > p.valor) return { ok: false as const, erro: `A taxa não pode passar do valor do pagamento (${formatBRL(p.valor)}).` };
    let despesaLancamentoId: string | null = null;
    if (valor > 0) {
      const categoriaId = await categoriaDaTaxaPerdida(tx, organizacaoId, autorId);
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
