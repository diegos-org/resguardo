/**
 * Pagamento no site (M8.2a) — taxa, liberação e recebimento (M4.10 e M4.12).
 *
 * - Taxa = valor − líquido, a partir do líquido informado numa leitura (nunca soma de itens), gravada em
 *   `reservas.taxaCanal` (e `valorLiquido`) e depois o motor, nessa ordem, na mesma transação. Se o provedor informar
 *   outro líquido antes de qualquer recebimento lançado, a taxa é atualizada (e o motor roda) antes de lançar.
 * - Só o pagamento com desfecho `reserva`, com a reserva confirmada (ou cancelada com valor retido pela política, M8.2c)
 *   e a situação ainda `aprovado`, lança o
 *   recebimento, e só quando o provedor diz EXPLICITAMENTE que liberou (data passada sozinha nunca basta):
 *   montante = o líquido INFORMADO pelo provedor nessa leitura, data de caixa = o dia (em São Paulo) da leitura que
 *   viu o sinal (a data que o provedor informa é a PREVISTA e pode ser anterior à liberação de fato),
 *   `conciliado`, origem `sincronizacao`, chave `mercadopago:<tentativa>:recebimento` (`#N` depois de um estorno).
 * - Sem o sinal, a equipe registra a liberação à mão (data entre o dia da criação do pagamento e hoje, e o líquido): a taxa é
 *   derivada, o recebimento fica `realizado` com a mesma chave. O provedor confirmando depois com o mesmo líquido passa
 *   a `conciliado` (a data fica a que a equipe viu no Mercado Pago); outro líquido (ou um recebimento já lançado com
 *   outro valor), aviso, sem mexer.
 *   Só o manual se estorna, e só por aqui: a taxa volta ao que o provedor tinha informado antes (ou a nada).
 * - Cartão (M8.2b): a mesma regra. Liberação parcela a parcela (money_release_schema) e "parcelamento sem acréscimo"
 *   nunca lançam sozinhos (`aplicarLeitura` liga o aviso); a equipe registra à mão.
 */
import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { auditoria, lancamentos, pagamentos, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { aplicarMotor } from "@/financeiro/aplicar";
import { estornar, lancar, LancamentoInvalido, mudarEstado } from "@/financeiro/ledger";
import { reservaCalculadaPeloMotor } from "@/financeiro/motor";
import { travarMotorDaReserva } from "@/financeiro/trava";
import { hojeISO } from "@/lib/datas";
import { ERRO_DADOS_PESSOAIS, textoSemDadosPessoais } from "@/lib/dados-pessoais";
import { uuidValido } from "@/lib/ids";
import { formatBRL } from "@/lib/money";
import { repasseAPagarDaReserva } from "@/repasses/recebimentos";
import { dataValida } from "@/reservas/regras";
import type { CodigoAviso } from "./situacoes";
import { devolucaoDoPagamento, type Pagamento, type ReservaTravada, travarCotacao } from "./travas";

export const FUSO_PAGAMENTO = "America/Sao_Paulo";
export const chaveRecebimento = (pagamentoId: string) => `mercadopago:${pagamentoId}:recebimento`;
const dataBr = (d: string) => d.split("-").reverse().join("/");

export type Resultado = { ok: true } | { ok: false; erro: string };

export const ERRO_ESTORNO_LIBERACAO_CANCELADA = "A reserva foi cancelada com devolução integral ao hóspede: a liberação não se estorna mais (não poderia ser registrada de novo). Corrija com um ajuste.";

/** Recebimentos lançados para este pagamento (a chave base e as versões #N), com os que ainda estão em vigor. */
export async function recebimentosDoPagamento(tx: Db, organizacaoId: string, pagamentoId: string) {
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

/**
 * Grava a taxa do pagamento na reserva e aplica o motor, nessa ordem (quem chama já tem as travas). null = taxa
 * desconhecida (volta a reserva ao "sem taxa", como antes de qualquer leitura).
 */
export async function gravarTaxaNaReserva(tx: Db, organizacaoId: string, reservaId: string, taxa: number | null, liquido: number | null, autorId: string | null, pagamentoId: string, agora: Date): Promise<void> {
  // Mesmo modo da trava da cotação (NO KEY UPDATE): um FOR UPDATE aqui subiria a trava da reserva (ver travas.ts).
  const [r] = await tx.select({ taxaCanal: reservas.taxaCanal, valorLiquido: reservas.valorLiquido }).from(reservas).where(and(eq(reservas.id, reservaId), eq(reservas.organizacaoId, organizacaoId))).for("no key update");
  if (!r || (r.taxaCanal === taxa && r.valorLiquido === liquido)) return;
  // Campo do financeiro mudou: uma conferência dada por resolvida volta a valer (como na sincronização).
  await tx.update(reservas).set({ taxaCanal: taxa, valorLiquido: liquido, conferenciaResolvidaEm: null, atualizadoEm: agora }).where(eq(reservas.id, reservaId));
  await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.taxa", entidade: "reserva", entidadeId: reservaId, mudancas: { taxaCanal: [r.taxaCanal, taxa], valorLiquido: [r.valorLiquido, liquido], pagamento: [null, pagamentoId] } });
  await aplicarMotor(tx, organizacaoId, reservaId, autorId);
}

/**
 * O provedor disse que liberou: lança o recebimento conciliado com o líquido INFORMADO por ele nesta leitura, com a
 * data de caixa no dia desta leitura (ou concilia o registrado à mão, se o valor bate; a data dele fica). Recebimento
 * já lançado com outro valor: aviso, sem mexer. Quem chama já conferiu desfecho `reserva`, reserva confirmada e
 * situação aprovada, dentro das travas, e já gravou a taxa desse líquido na reserva (quando não havia recebimento).
 */
export async function liberarPeloProvedor(tx: Db, organizacaoId: string, p: Pagamento, r: ReservaTravada, liquidoInformado: number, liberacaoPrevista: Date | null, agora: Date): Promise<{ aviso: CodigoAviso | null; confirmada: boolean }> {
  // "Liberado" com a data prevista ainda no futuro: sinais que não batem, não fecha (aviso).
  if (liberacaoPrevista && liberacaoPrevista.getTime() > agora.getTime()) return { aviso: "liberacao_futura", confirmada: false };
  // Data de caixa = o dia desta leitura: a data informada é a prevista (com retenção ou contestação, o dinheiro sai
  // depois dela) e o sinal só diz que já saiu; nunca se lança o caixa num dia antes de o dinheiro estar liberado.
  const data = hojeISO(FUSO_PAGAMENTO, agora);
  const { emVigor, proxima } = await recebimentosDoPagamento(tx, organizacaoId, p.id);
  const atual = emVigor[0];
  if (atual) {
    // Já lançado (à mão pela equipe, com a data vista no Mercado Pago, ou por uma leitura anterior): o valor decide.
    if (atual.montante !== liquidoInformado) return { aviso: "liberacao_divergente", confirmada: false };
    if (atual.estado !== "conciliado") {
      await mudarEstado(tx, organizacaoId, atual.id, "conciliado", null);
      await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "pagamento.liberacao", entidade: "pagamento", entidadeId: p.id, mudancas: { liberacao: ["manual", `conciliada (caixa em ${atual.dataCaixa})`] } });
    }
    return { aviso: null, confirmada: true };
  }
  await lancar(
    tx,
    organizacaoId,
    [
      {
        tipo: "recebimento",
        descricao: `Reserva ${r.codigo} — liberação do Mercado Pago de ${formatBRL(liquidoInformado)} em ${dataBr(data)}`,
        valor: 0,
        montante: liquidoInformado,
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
  await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "pagamento.liberacao", entidade: "pagamento", entidadeId: p.id, mudancas: { liberacao: [null, `${liquidoInformado} em ${data}`] } });
  return { aviso: null, confirmada: true };
}

async function cotacaoDoPagamento(db: Db, organizacaoId: string, pagamentoId: string): Promise<string | null> {
  if (!uuidValido(pagamentoId)) return null;
  const [p] = await db.select({ cotacaoId: pagamentos.cotacaoId }).from(pagamentos).where(and(eq(pagamentos.id, pagamentoId), eq(pagamentos.organizacaoId, organizacaoId)));
  return p?.cotacaoId ?? null;
}

/**
 * Liberação registrada à mão (sem o sinal do provedor): data entre o dia (em São Paulo) da criação do pagamento e hoje, e o
 * líquido que caiu. O limite de baixo é a criação, não `aprovadoEm`: este é a hora da primeira leitura da aprovação,
 * que pode vir dias depois do pagamento (nas prévias nada confere sozinho). A taxa é
 * derivada (valor − líquido) e gravada na reserva com o motor; o recebimento fica `realizado`, com a chave do
 * pagamento. A auditoria guarda a taxa de antes (a que o provedor tinha informado, ou nada): o estorno volta a ela.
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
    // Confirmada, ou cancelada com valor retido pela política (M8.2c): o dinheiro ficou com a empresa. Cancelada com
    // devolução integral: o dinheiro volta ao hóspede e nunca entra no livro.
    if (!reservaCalculadaPeloMotor(t.reserva)) return { ok: false as const, erro: "A reserva não está confirmada nem cancelada com valor retido: o dinheiro deste pagamento volta ao hóspede." };
    if (d.liquido > p.valor) return { ok: false as const, erro: `O líquido não pode passar do valor pago (${formatBRL(p.valor)}).` };
    // O dinheiro não cai antes de o pagamento existir (a hora da criação é nossa e confiável).
    const criadoNoDia = hojeISO(FUSO_PAGAMENTO, p.criadoEm);
    if (d.data < criadoNoDia) return { ok: false as const, erro: `A data da liberação não pode ser antes da criação do pagamento (${dataBr(criadoNoDia)}).` };
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

/**
 * A taxa que valia antes da liberação registrada à mão (a última que o provedor informou, ou null): a auditoria do
 * registro guarda `taxa: [antes, depois]`, e é o único lugar com esse valor. Sem o registro, null (desconhecida).
 */
async function taxaAntesDoManual(tx: Db, organizacaoId: string, pagamentoId: string): Promise<number | null> {
  const [a] = await tx
    .select({ mudancas: auditoria.mudancas })
    .from(auditoria)
    .where(and(eq(auditoria.organizacaoId, organizacaoId), eq(auditoria.entidade, "pagamento"), eq(auditoria.entidadeId, pagamentoId), eq(auditoria.acao, "pagamento.liberacao_manual")))
    .orderBy(desc(auditoria.criadoEm), desc(auditoria.id))
    .limit(1);
  const antes = (a?.mudancas as { taxa?: unknown[] } | undefined)?.taxa?.[0];
  return Number.isSafeInteger(antes) && (antes as number) >= 0 ? (antes as number) : null;
}

/**
 * Estorna a liberação registrada à mão (a do provedor nunca): a taxa e o líquido voltam ao que o provedor tinha
 * informado antes (ou a desconhecidos), a reserva recebe essa taxa com o motor, o aviso de liberação divergente sai, e
 * a próxima conferência relê a Payments API. A próxima liberação usa a chave seguinte (#N). Na reserva cancelada com
 * devolução integral (M8.2c), nunca: a liberação não se registraria de novo e a saída da devolução espelha esta entrada.
 */
export async function estornarLiberacaoManual(db: Db, organizacaoId: string, pagamentoId: string, motivo: string, autorId: string | null, agora: Date = new Date()): Promise<Resultado> {
  const m = motivo.trim().slice(0, 200);
  if (!m) return { ok: false, erro: "Informe o motivo do estorno." };
  // O motivo vai para a descrição do estorno no livro: nunca com dado pessoal (como toda nota, M8.2c).
  if (textoSemDadosPessoais(motivo.trim()) === null) return { ok: false, erro: ERRO_DADOS_PESSOAIS };
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
    // M8.2c: a saída do caixa da devolução ao hóspede espelha este recebimento; estornar a liberação deixaria a saída sem a entrada.
    if (devolucaoDoPagamento(t, p.id)?.saidaLancamentoId) return { ok: false as const, erro: "A devolução ao hóspede já espelhou esta liberação: corrija com um ajuste." };
    // M8.2c: cancelada com devolução integral, a liberação não se registra de novo (`registrarLiberacaoManual`), e a taxa
    // nunca volta à reserva (gravá-la reabriria a conferência que o acerto do cancelamento deu por resolvida).
    if (!reservaCalculadaPeloMotor(t.reserva)) return { ok: false as const, erro: ERRO_ESTORNO_LIBERACAO_CANCELADA };
    await travarMotorDaReserva(tx, organizacaoId, t.reserva.id);
    const preso = await repasseAPagarDaReserva(tx, organizacaoId, t.reserva.id);
    if (preso) return { ok: false as const, erro: preso };
    try {
      await estornar(tx, organizacaoId, l.id, `Liberação registrada à mão estornada: ${m}`, autorId);
    } catch (e) {
      if (e instanceof LancamentoInvalido) return { ok: false as const, erro: e.message };
      throw e;
    }
    const taxa = p.liberacaoOrigem === "manual" ? await taxaAntesDoManual(tx, organizacaoId, p.id) : p.taxa;
    const liquido = taxa === null ? null : p.valor - taxa;
    // O aviso de liberação divergente apontava para o recebimento que acabou de sair: sai junto (a próxima leitura liga
    // de novo se o provedor ainda não bater com o que for registrado depois).
    await tx
      .update(pagamentos)
      .set({ liberacaoConfirmadaEm: null, liberacaoOrigem: null, taxa, liquido, financeiroConsultadoEm: null, avisos: p.avisos.filter((a) => a !== "liberacao_divergente"), atualizadoEm: agora })
      .where(eq(pagamentos.id, p.id));
    // A reserva volta à taxa do provedor (ou a nenhuma) antes de qualquer novo recebimento: o motor recalcula.
    if (p.desfecho === "reserva") await gravarTaxaNaReserva(tx, organizacaoId, t.reserva.id, taxa, liquido, autorId, p.id, agora);
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.liberacao_estornar", entidade: "pagamento", entidadeId: p.id, mudancas: { liberacao: [`${l.montante} em ${l.dataCaixa}`, null], taxa: [p.taxa, taxa] } });
    return { ok: true as const };
  });
}
