/**
 * Pagamento no site (M8.2a) — taxa, liberação e recebimento (M4.10 e M4.12).
 *
 * - Taxa = valor − líquido, numa leitura só, gravada em `reservas.taxaCanal` (e `valorLiquido`) e depois o motor,
 *   nessa ordem, na mesma transação.
 * - Só o pagamento com desfecho `reserva`, com a reserva confirmada e a situação ainda `aprovado`, lança o
 *   recebimento, e só quando o provedor diz EXPLICITAMENTE que liberou (data passada sozinha nunca basta):
 *   montante = líquido, data de caixa = data da liberação em São Paulo, `conciliado`, origem `sincronizacao`, chave
 *   `mercadopago:<tentativa>:recebimento` (`#N` depois de um estorno, como o motor).
 * - Sem o sinal, a equipe registra a liberação à mão (data até hoje e líquido): a taxa é derivada, o recebimento
 *   fica `realizado` com a mesma chave. O provedor confirmando depois com os mesmos valores passa a `conciliado`;
 *   diferentes, aviso, sem mexer. Só o manual se estorna, e só por aqui.
 */
import { and, eq, inArray, like, or } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { lancamentos, pagamentos, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { aplicarMotor } from "@/financeiro/aplicar";
import { estornar, lancar, LancamentoInvalido, mudarEstado } from "@/financeiro/ledger";
import { travarMotorDaReserva } from "@/financeiro/trava";
import { hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { formatBRL } from "@/lib/money";
import { repasseAPagarDaReserva } from "@/repasses/recebimentos";
import { dataValida } from "@/reservas/regras";
import type { CodigoAviso } from "./situacoes";
import { type Pagamento, type ReservaTravada, travarCotacao } from "./travas";

export const FUSO_PAGAMENTO = "America/Sao_Paulo";
export const chaveRecebimento = (pagamentoId: string) => `mercadopago:${pagamentoId}:recebimento`;
const dataBr = (d: string) => d.split("-").reverse().join("/");

export type Resultado = { ok: true } | { ok: false; erro: string };

/** Recebimentos lançados para este pagamento (a chave base e as versões #N), com os que ainda estão em vigor. */
async function recebimentosDoPagamento(tx: Db, organizacaoId: string, pagamentoId: string) {
  const base = chaveRecebimento(pagamentoId);
  const linhas = await tx
    .select({ id: lancamentos.id, chave: lancamentos.chaveOrigem, estado: lancamentos.estado, montante: lancamentos.montante, dataCaixa: lancamentos.dataCaixa })
    .from(lancamentos)
    .where(and(eq(lancamentos.organizacaoId, organizacaoId), eq(lancamentos.tipo, "recebimento"), or(eq(lancamentos.chaveOrigem, base), like(lancamentos.chaveOrigem, `${base}#%`))))
    .for("update");
  const estornados = linhas.length ? await tx.select({ de: lancamentos.estornoDe }).from(lancamentos).where(inArray(lancamentos.estornoDe, linhas.map((l) => l.id))) : [];
  const anulados = new Set(estornados.map((e) => e.de));
  let proxima = base;
  for (let n = 2; linhas.some((l) => l.chave === proxima); n++) proxima = `${base}#${n}`;
  return { emVigor: linhas.filter((l) => !anulados.has(l.id)), proxima };
}

/** Grava a taxa do pagamento na reserva e aplica o motor, nessa ordem (quem chama já tem as travas). */
export async function gravarTaxaNaReserva(tx: Db, organizacaoId: string, reservaId: string, taxa: number, liquido: number, autorId: string | null, pagamentoId: string, agora: Date): Promise<void> {
  const [r] = await tx.select({ taxaCanal: reservas.taxaCanal, valorLiquido: reservas.valorLiquido }).from(reservas).where(and(eq(reservas.id, reservaId), eq(reservas.organizacaoId, organizacaoId))).for("update");
  if (!r || (r.taxaCanal === taxa && r.valorLiquido === liquido)) return;
  // Campo do financeiro mudou: uma conferência dada por resolvida volta a valer (como na sincronização).
  await tx.update(reservas).set({ taxaCanal: taxa, valorLiquido: liquido, conferenciaResolvidaEm: null, atualizadoEm: agora }).where(eq(reservas.id, reservaId));
  await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.taxa", entidade: "reserva", entidadeId: reservaId, mudancas: { taxaCanal: [r.taxaCanal, taxa], valorLiquido: [r.valorLiquido, liquido], pagamento: [null, pagamentoId] } });
  await aplicarMotor(tx, organizacaoId, reservaId, autorId);
}

/**
 * O provedor disse que liberou: lança o recebimento conciliado (ou concilia o manual igual). Quem chama já conferiu
 * desfecho `reserva`, reserva confirmada e situação aprovada, dentro das travas.
 */
export async function liberarPeloProvedor(tx: Db, organizacaoId: string, p: Pagamento, r: ReservaTravada, liquido: number, dataLiberacao: Date | null, agora: Date): Promise<{ aviso: CodigoAviso | null; confirmada: boolean }> {
  // Liberado sem data: vale o dia em que o provedor disse que liberou; liberado com data futura não fecha.
  if (dataLiberacao && dataLiberacao.getTime() > agora.getTime()) return { aviso: "liberacao_futura", confirmada: false };
  const data = hojeISO(FUSO_PAGAMENTO, dataLiberacao ?? agora);
  const { emVigor, proxima } = await recebimentosDoPagamento(tx, organizacaoId, p.id);
  const atual = emVigor[0];
  if (atual) {
    if (atual.estado === "conciliado") return { aviso: null, confirmada: true };
    if (atual.montante === liquido && atual.dataCaixa === data) {
      await mudarEstado(tx, organizacaoId, atual.id, "conciliado", null);
      await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "pagamento.liberacao", entidade: "pagamento", entidadeId: p.id, mudancas: { liberacao: ["manual", `conciliada em ${data}`] } });
      return { aviso: null, confirmada: true };
    }
    return { aviso: "liberacao_divergente", confirmada: false };
  }
  await lancar(
    tx,
    organizacaoId,
    [
      {
        tipo: "recebimento",
        descricao: `Reserva ${r.codigo} — liberação do Mercado Pago de ${formatBRL(liquido)} em ${dataBr(data)}`,
        valor: 0,
        montante: liquido,
        competencia: data,
        dataCaixa: data,
        estado: "conciliado",
        imovelId: r.imovelId,
        reservaId: r.id,
        origem: "sincronizacao",
        chaveOrigem: proxima,
      },
    ],
    null,
  );
  await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "pagamento.liberacao", entidade: "pagamento", entidadeId: p.id, mudancas: { liberacao: [null, `${liquido} em ${data}`] } });
  return { aviso: null, confirmada: true };
}

async function cotacaoDoPagamento(db: Db, organizacaoId: string, pagamentoId: string): Promise<string | null> {
  if (!uuidValido(pagamentoId)) return null;
  const [p] = await db.select({ cotacaoId: pagamentos.cotacaoId }).from(pagamentos).where(and(eq(pagamentos.id, pagamentoId), eq(pagamentos.organizacaoId, organizacaoId)));
  return p?.cotacaoId ?? null;
}

/**
 * Liberação registrada à mão (sem o sinal do provedor): data até hoje e o líquido que caiu. A taxa é derivada
 * (valor − líquido) e gravada na reserva com o motor; o recebimento fica `realizado`, com a chave do pagamento.
 */
export async function registrarLiberacaoManual(db: Db, organizacaoId: string, pagamentoId: string, d: { data: string; liquido: number }, autorId: string | null, agora: Date = new Date()): Promise<Resultado> {
  if (!dataValida(d.data)) return { ok: false, erro: "Data da liberação inválida." };
  if (d.data > hojeISO(FUSO_PAGAMENTO, agora)) return { ok: false, erro: "A data da liberação não pode ser no futuro." };
  if (!Number.isSafeInteger(d.liquido) || d.liquido <= 0) return { ok: false, erro: "Informe o líquido que caiu na conta (maior que zero)." };
  const cotacaoId = await cotacaoDoPagamento(db, organizacaoId, pagamentoId);
  if (!cotacaoId) return { ok: false, erro: "Pagamento não encontrado." };
  return db.transaction(async (tx) => {
    const t = await travarCotacao(tx, organizacaoId, cotacaoId);
    const p = t?.tentativas.find((x) => x.id === pagamentoId);
    if (!t || !p) return { ok: false as const, erro: "Pagamento não encontrado." };
    if (p.desfecho !== "reserva") return { ok: false as const, erro: "Só o pagamento que confirmou a reserva tem liberação registrada." };
    if (p.situacao !== "aprovado") return { ok: false as const, erro: "Este pagamento não está mais aprovado no Mercado Pago: confira antes de registrar a liberação." };
    if (t.reserva.estado !== "confirmada") return { ok: false as const, erro: "A reserva não está confirmada." };
    if (d.liquido > p.valor) return { ok: false as const, erro: `O líquido não pode passar do valor pago (${formatBRL(p.valor)}).` };
    const { emVigor, proxima } = await recebimentosDoPagamento(tx, organizacaoId, p.id);
    if (emVigor.length) return { ok: false as const, erro: emVigor[0].estado === "conciliado" ? "A liberação já foi confirmada pelo Mercado Pago." : "A liberação já está registrada: estorne a registrada à mão antes de registrar de novo." };
    const taxa = p.valor - d.liquido;
    await tx.update(pagamentos).set({ taxa, liquido: d.liquido, liberacaoConfirmadaEm: agora, liberacaoOrigem: "manual", atualizadoEm: agora }).where(eq(pagamentos.id, p.id));
    await gravarTaxaNaReserva(tx, organizacaoId, t.reserva.id, taxa, d.liquido, autorId, p.id, agora);
    await lancar(
      tx,
      organizacaoId,
      [
        {
          tipo: "recebimento",
          descricao: `Reserva ${t.reserva.codigo} — liberação do Mercado Pago de ${formatBRL(d.liquido)} em ${dataBr(d.data)} (registrada à mão)`,
          valor: 0,
          montante: d.liquido,
          competencia: d.data,
          dataCaixa: d.data,
          estado: "realizado",
          imovelId: t.reserva.imovelId,
          reservaId: t.reserva.id,
          origem: "manual",
          chaveOrigem: proxima,
        },
      ],
      autorId,
    );
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.liberacao_manual", entidade: "pagamento", entidadeId: p.id, mudancas: { liberacao: [null, `${d.liquido} em ${d.data}`], taxa: [p.taxa, taxa] } });
    return { ok: true as const };
  });
}

/** Estorna a liberação registrada à mão (a do provedor nunca): a próxima liberação usa a chave seguinte (#N). */
export async function estornarLiberacaoManual(db: Db, organizacaoId: string, pagamentoId: string, motivo: string, autorId: string | null, agora: Date = new Date()): Promise<Resultado> {
  const m = motivo.trim().slice(0, 200);
  if (!m) return { ok: false, erro: "Informe o motivo do estorno." };
  const cotacaoId = await cotacaoDoPagamento(db, organizacaoId, pagamentoId);
  if (!cotacaoId) return { ok: false, erro: "Pagamento não encontrado." };
  return db.transaction(async (tx) => {
    const t = await travarCotacao(tx, organizacaoId, cotacaoId);
    const p = t?.tentativas.find((x) => x.id === pagamentoId);
    if (!t || !p) return { ok: false as const, erro: "Pagamento não encontrado." };
    const { emVigor } = await recebimentosDoPagamento(tx, organizacaoId, p.id);
    const l = emVigor[0];
    if (!l) return { ok: false as const, erro: "Não há liberação registrada para estornar." };
    if (l.estado !== "realizado") return { ok: false as const, erro: "A liberação foi confirmada pelo Mercado Pago: não se estorna pelo painel." };
    await travarMotorDaReserva(tx, organizacaoId, t.reserva.id);
    const preso = await repasseAPagarDaReserva(tx, organizacaoId, t.reserva.id);
    if (preso) return { ok: false as const, erro: preso };
    try {
      await estornar(tx, organizacaoId, l.id, `Liberação registrada à mão estornada: ${m}`, autorId);
    } catch (e) {
      if (e instanceof LancamentoInvalido) return { ok: false as const, erro: e.message };
      throw e;
    }
    await tx.update(pagamentos).set({ liberacaoConfirmadaEm: null, liberacaoOrigem: null, atualizadoEm: agora }).where(eq(pagamentos.id, p.id));
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.liberacao_estornar", entidade: "pagamento", entidadeId: p.id, mudancas: { liberacao: [`${l.montante} em ${l.dataCaixa}`, null], motivo: [null, m] } });
    return { ok: true as const };
  });
}
