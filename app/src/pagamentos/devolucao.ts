/**
 * Pagamento no site (M8.2a) — devolução do pagamento que ficou sem reserva (design "Devolução na parte (a)").
 *
 * A equipe escolhe, com confirmação: devolver pelo Mercado Pago (integral) ou registrar a devolução feita por
 * fora. As duas exigem, sob a trava da tentativa, desfecho vazio, decisão "sem reserva" gravada e nenhuma
 * devolução pedida. Pelo provedor: `pedida` até a leitura da order dizer devolvido; cada tentativa nova usa chave
 * nova, gravada antes, e relê a order antes (já devolvida = confirmada); "já em andamento" continua pedida; depois
 * de 3 falhas, aviso (a equipe pode registrar por fora). A taxa que não voltar vira despesa da empresa só depois
 * da confirmação, com o valor informado pelo provedor.
 */
import { and, eq } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { devolucoesPagamento, pagamentos } from "@/db/schema";
import type { Db } from "@/db/types";
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

export const MAXIMO_FALHAS_DEVOLUCAO = 3;
/** Espera entre uma tentativa de devolução e a seguinte (a rotina relê a order antes). */
export const ESPERA_DEVOLUCAO_MS = 10 * 60_000;
export const chaveDevolucao = (devolucaoId: string, n: number) => `devolucao:${devolucaoId}:${n}`;

export type ResultadoAcaoPagamento = { ok: true; situacao?: SituacaoDevolucao } | { ok: false; erro: string };

async function cotacaoDoPagamento(db: Db, organizacaoId: string, pagamentoId: string): Promise<string | null> {
  if (!uuidValido(pagamentoId)) return null;
  const [p] = await db.select({ cotacaoId: pagamentos.cotacaoId }).from(pagamentos).where(and(eq(pagamentos.id, pagamentoId), eq(pagamentos.organizacaoId, organizacaoId)));
  return p?.cotacaoId ?? null;
}

/** Pode decidir o destino do dinheiro (devolver)? Sob a trava. Devolve o motivo da recusa, ou null. */
function recusaDaDevolucao(p: Pagamento, dev: Devolucao | undefined, porFora: boolean): string | null {
  if (p.situacao !== "aprovado") return "Só um pagamento aprovado (e ainda não devolvido) pode ser devolvido.";
  if (p.desfecho !== null) return "Este pagamento já tem desfecho.";
  if (p.motivoSemReserva === null) return "Este pagamento ainda está sendo conferido ou confirmou a reserva: não se devolve na parte (a).";
  if (dev?.situacao === "pedida") return "Já há uma devolução pedida ao Mercado Pago para este pagamento.";
  // Depois de 3 falhas (recusada), a equipe pode pedir de novo ou registrar a devolução feita por fora.
  if (dev && dev.situacao !== "recusada") return porFora ? "A devolução deste pagamento já foi registrada." : "A devolução deste pagamento já foi feita.";
  return null;
}

/**
 * Um pedido de devolução ao provedor (rotina e painel): relê a order antes (já devolvida = confirmada), grava a
 * chave nova antes de chamar, chama fora de transação e registra o resultado. A confirmação vem da leitura.
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
    await db.update(devolucoesPagamento).set({ proximaTentativaEm: new Date(agora.getTime() + ESPERA_DEVOLUCAO_MS), atualizadoEm: agora }).where(eq(devolucoesPagamento.id, devolucaoId));
    return "pedida";
  }
  if (cobranca?.situacao === "devolvido") {
    await conferirTentativa(db, organizacaoId, d.dev.pagamentoId, provedor, agora, { forcar: true, origem: "rotina", cobranca });
    return (await situacaoDaDevolucao(db, devolucaoId)) ?? "pedida";
  }
  let res: ResultadoDevolucao;
  if (!cobranca) res = { situacao: "recusada", idDevolucao: null, mensagem: "O Mercado Pago não encontrou o pagamento." };
  else {
    // Grava a chave da tentativa nova antes de chamar, sob as travas.
    const n = await db.transaction(async (tx) => {
      const t = await travarCotacao(tx, organizacaoId, d.cotacaoId);
      const dev = t?.devolucoes.find((x) => x.id === devolucaoId);
      if (!t || !dev || dev.situacao !== "pedida") return null;
      const proxima = dev.tentativas + 1;
      await tx.update(devolucoesPagamento).set({ tentativas: proxima, chaveAtual: chaveDevolucao(dev.id, proxima), proximaTentativaEm: new Date(agora.getTime() + ESPERA_DEVOLUCAO_MS), atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
      return proxima;
    });
    if (n === null) return situacaoDaDevolucao(db, devolucaoId);
    res = await provedor.devolver(cobranca, chaveDevolucao(devolucaoId, n), null);
  }
  await db.transaction(async (tx) => {
    const t = await travarCotacao(tx, organizacaoId, d.cotacaoId);
    const dev = t?.devolucoes.find((x) => x.id === devolucaoId);
    if (!t || !dev || dev.situacao !== "pedida") return;
    if (res.situacao === "confirmada" || res.situacao === "pedida") {
      if (res.idDevolucao) await tx.update(devolucoesPagamento).set({ idProvedor: res.idDevolucao, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
      return;
    }
    const falhas = dev.falhas + 1;
    const desistiu = falhas >= MAXIMO_FALHAS_DEVOLUCAO;
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
      // Devolução que desistiu depois de 3 falhas: a equipe pede de novo (as falhas recomeçam; as chaves continuam).
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

/** Devolução feita por fora (Pix da conta da empresa, por exemplo): data até hoje, valor e nota. */
export async function registrarDevolucaoPorFora(
  db: Db,
  organizacaoId: string,
  pagamentoId: string,
  d: { data: string; valor: number; nota: string },
  autorId: string | null,
  agora: Date = new Date(),
): Promise<ResultadoAcaoPagamento> {
  if (!dataValida(d.data)) return { ok: false, erro: "Data da devolução inválida." };
  if (d.data > hojeISO(FUSO_PAGAMENTO, agora)) return { ok: false, erro: "A data da devolução não pode ser no futuro." };
  if (!Number.isSafeInteger(d.valor) || d.valor <= 0) return { ok: false, erro: "Informe o valor devolvido (maior que zero)." };
  const nota = d.nota.trim().slice(0, 300);
  return comPagamento(db, organizacaoId, pagamentoId, async (tx, _t, p, dev) => {
    const recusa = recusaDaDevolucao(p, dev, true);
    if (recusa) return { ok: false as const, erro: recusa };
    if (d.valor > p.valor) return { ok: false as const, erro: `O valor devolvido não pode passar do valor pago (${formatBRL(p.valor)}).` };
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
