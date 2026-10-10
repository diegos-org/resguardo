/**
 * Cancelamento pela política (M8.2c) — o acerto no livro, por componente (desenho §6).
 *
 * - **Resultado** (receita, taxa, comissão, parte do proprietário): todo ele na hora do cancelamento (fase 1), sob as
 *   travas da cotação e do motor. Sem devolução, o motor divide o valor retido como uma reserva normal. Com devolução
 *   integral e nada movimentado, o motor estorna (como em qualquer cancelamento). Com algum mês que já movimentou
 *   dinheiro (parte repassada e paga, ou lançamento realizado/conciliado), esse mês ganha espelhos no mês CORRENTE — o da
 *   parte do proprietário é o desconto (`lancarDescontoDoProprietario`) —, os outros meses são estornados no próprio mês,
 *   a reserva fica congelada no motor (`espelhado`) e a conferência é dada por resolvida pelo sistema, com auditoria. O
 *   passado nunca muda: o mês já fechado e o relatório já enviado ficam como estavam.
 * - **Caixa** (o dinheiro que volta ao hóspede): só quando a devolução se realiza. A saída espelha os recebimentos em
 *   vigor do pagamento (o líquido que entrou; nada entrou = nada a lançar); a taxa que não voltou é despesa da empresa
 *   (`registrarTaxaPerdida`, ou derivada na devolução por fora). Conciliada quando a leitura do Mercado Pago confirma,
 *   realizada quando a devolução foi por fora ou confirmada pela equipe.
 *
 * Idempotente: `resultadoLancadoEm` e `caixaLancadoEm` no cancelamento, e as chaves no livro (por cancelamento e lançamento
 * original nos espelhos, por devolução na saída).
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { auditoria, cancelamentosReserva, devolucoesPagamento, lancamentos, repasseItens, repasses, reservas, type TipoRepasse } from "@/db/schema";
import type { Db } from "@/db/types";
import { aplicarMotor } from "@/financeiro/aplicar";
import { estornar, type Lancamento, lancar } from "@/financeiro/ledger";
import { travarMotorDaReserva } from "@/financeiro/trava";
import { hojeISO } from "@/lib/datas";
import { formatBRL } from "@/lib/money";
import { chaveEspelhoDoCancelamento, lancarDescontoDoProprietario, mesDoDesconto, ORIGEM_CANCELAMENTO } from "@/repasses/descontos";
import { FUSO_PAGAMENTO, recebimentosDoPagamento } from "./liberacao";
import type { CodigoAviso } from "./situacoes";
import type { Devolucao, Pagamento, Travado } from "./travas";

/** A saída do caixa de uma devolução (uma por devolução). Começa com `mercadopago:` (não se estorna pelas listas) e não tem "recebimento". */
export const chaveSaidaDevolucao = (pagamentoId: string, devolucaoId: string) => `mercadopago:${pagamentoId}:devolucao:${devolucaoId}:saida`;

/** Como a devolução se realizou, para o lançamento de caixa: o dia, e se veio de uma leitura (conciliado) ou da equipe. */
export type FatoDaDevolucao = { data: string; estado: "conciliado" | "realizado"; origem: "sincronizacao" | "manual" };

const dataBr = (d: string) => d.slice(0, 10).split("-").reverse().join("/");
const mesBr = (competencia: string) => `${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`;
const emVigor = () => and(isNull(lancamentos.estornoDe), sql`not exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`);

export type ItemDeRepasse = { lancamentoId: string; repasseId: string; tipo: TipoRepasse; data: string; dataPagamento: string | null };

/**
 * Os lançamentos do motor em vigor da reserva (travados com `travar`) e o que cada um já movimentou: o item de repasse em
 * vigor (pago ou a pagar) e os meses de competência que movimentaram dinheiro — parte num repasse pago, ou qualquer
 * lançamento do mês realizado/conciliado. A prévia (sem trava) e o acerto (com trava) leem daqui.
 */
export async function lancamentosDoMotor(tx: Db, organizacaoId: string, reservaId: string, o: { travar: boolean }) {
  const q = tx
    .select()
    .from(lancamentos)
    .where(and(eq(lancamentos.organizacaoId, organizacaoId), eq(lancamentos.reservaId, reservaId), eq(lancamentos.origem, "motor"), emVigor()))
    .orderBy(asc(lancamentos.competencia), asc(lancamentos.id));
  const ativos: Lancamento[] = o.travar ? await q.for("update") : await q;
  const itens: ItemDeRepasse[] = ativos.length
    ? await tx
        .select({ lancamentoId: repasseItens.lancamentoId, repasseId: repasses.id, tipo: repasses.tipo, data: repasses.data, dataPagamento: repasses.dataPagamento })
        .from(repasseItens)
        .innerJoin(repasses, eq(repasses.id, repasseItens.repasseId))
        .where(and(eq(repasseItens.organizacaoId, organizacaoId), inArray(repasseItens.lancamentoId, ativos.map((a) => a.id)), isNull(repasseItens.liberadoEm), isNull(repasses.estornadoEm)))
    : [];
  const pagos = new Map(itens.filter((i) => i.dataPagamento).map((i) => [i.lancamentoId, i]));
  const movidos = new Set(ativos.filter((a) => a.estado === "realizado" || a.estado === "conciliado" || pagos.has(a.id)).map((a) => a.competencia.slice(0, 7)));
  return { ativos, pagos, aPagar: itens.filter((i) => !i.dataPagamento), movidos };
}

/**
 * Devolução integral numa reserva com algum mês que já movimentou dinheiro: espelhos de cada lançamento desses meses no
 * mês corrente (chave por cancelamento e lançamento original; o da parte do proprietário é a parte negativa, para quem
 * recebeu) e estorno dos meses que não movimentaram, no próprio mês. Nada movimentado: não mexe em nada (`meses` 0; quem
 * chama passa o motor, que estorna tudo). Devolve os meses espelhados, a parte espelhada e quanto dela é desconto de
 * verdade (parte já repassada e paga, ou realizada à mão; o espelho de uma parte nunca paga só a anula). Sob a trava do
 * motor da reserva, dentro da transação de quem chama.
 */
export async function espelharMovidos(
  tx: Db,
  organizacaoId: string,
  d: { reservaId: string; cancelamentoId: string; codigo: string },
  autorId: string | null,
  agora: Date,
): Promise<{ meses: number; parteEspelhada: number; desconto: number }> {
  await travarMotorDaReserva(tx, organizacaoId, d.reservaId);
  const { ativos, pagos, movidos } = await lancamentosDoMotor(tx, organizacaoId, d.reservaId, { travar: true });
  if (!movidos.size) return { meses: 0, parteEspelhada: 0, desconto: 0 };
  const competencia = mesDoDesconto(agora);
  const prefixo = `Reserva ${d.codigo} cancelada com devolução integral ao hóspede`;
  let parteEspelhada = 0;
  let desconto = 0;
  for (const a of ativos) {
    const mes = a.competencia.slice(0, 7);
    if (!movidos.has(mes)) {
      await estornar(tx, organizacaoId, a.id, `${prefixo} (o mês não tinha movimentado dinheiro)`, autorId);
      continue;
    }
    const chave = chaveEspelhoDoCancelamento(d.cancelamentoId, a.id);
    if (a.tipo === "direito_proprietario" && a.proprietarioId && a.imovelId && a.valor > 0) {
      const pago = pagos.get(a.id);
      const paga = !!pago || a.estado === "realizado" || a.estado === "conciliado";
      const descricao = pago
        ? `${prefixo}: desconto da parte já repassada (repasse de ${dataBr(pago.data)})`
        : paga
          ? `${prefixo}: desconto da parte de ${mesBr(a.competencia)} já paga`
          : `${prefixo}: anula a parte de ${mesBr(a.competencia)}, que não foi repassada`;
      await lancarDescontoDoProprietario(tx, organizacaoId, { chave, proprietarioId: a.proprietarioId, imovelId: a.imovelId, reservaId: d.reservaId, valor: a.valor, competencia, descricao }, autorId, agora);
      parteEspelhada += a.valor;
      if (paga) desconto += a.valor;
      continue;
    }
    await lancar(
      tx,
      organizacaoId,
      [
        {
          tipo: a.tipo,
          descricao: `${prefixo}: espelho de ${mesBr(a.competencia)}`,
          valor: -a.valor,
          efeitoSaldo: -a.efeitoSaldo,
          montante: a.montante === null ? null : -a.montante,
          competencia,
          estado: "previsto",
          imovelId: a.imovelId,
          reservaId: d.reservaId,
          proprietarioId: a.proprietarioId,
          origem: ORIGEM_CANCELAMENTO,
          chaveOrigem: chave,
        },
      ],
      autorId,
    );
  }
  return { meses: movidos.size, parteEspelhada, desconto };
}

/**
 * Fase 1: todos os componentes de resultado (inclusive o lado do proprietário), sob `travarCotacao` + `travarMotorDaReserva`,
 * com `t.cancelamento` e `t.reserva` já atualizados (cancelada; valor retido gravado). Idempotente (`resultadoLancadoEm`).
 */
export async function acertarResultado(tx: Db, organizacaoId: string, t: Travado, p: Pagamento, d: { direito: "integral" | "nenhum" }, autorId: string | null, agora: Date): Promise<{ avisos: string[] }> {
  const c = t.cancelamento;
  if (!c || c.situacao !== "cancelada") throw new Error("Acerto sem o cancelamento decidido.");
  if (c.resultadoLancadoEm) return { avisos: [] };
  await travarMotorDaReserva(tx, organizacaoId, t.reserva.id);
  let avisos: string[] = [];
  let espelhado = false;
  let descontos = 0;
  if (d.direito === "nenhum") {
    // O valor retido entra na divisão como uma reserva normal: igual ao bruto, nada muda no livro; diferente, o motor
    // recalcula (ou protege o que já movimentou dinheiro, como em qualquer reserva).
    avisos = (await aplicarMotor(tx, organizacaoId, t.reserva.id, autorId))?.avisos ?? [];
  } else {
    const m = await espelharMovidos(tx, organizacaoId, { reservaId: t.reserva.id, cancelamentoId: c.id, codigo: t.reserva.codigo }, autorId, agora);
    if (m.meses === 0) avisos = (await aplicarMotor(tx, organizacaoId, t.reserva.id, autorId))?.avisos ?? [];
    else {
      espelhado = true;
      descontos = m.desconto;
      // Os lançamentos do motor dos meses espelhados ficam em vigor (o passado não muda): a conferência deles é dada por
      // resolvida pelo sistema — o acerto já foi lançado no mês do cancelamento.
      await tx.update(reservas).set({ conferenciaResolvidaEm: agora, atualizadoEm: agora }).where(eq(reservas.id, t.reserva.id));
      t.reserva.conferenciaResolvidaEm = agora;
      const n = m.desconto > 0 ? "a parte já repassada descontada no próximo repasse" : "espelhos lançados no mês do cancelamento";
      await registrarAuditoria(tx, {
        organizacaoId,
        usuarioId: autorId,
        acao: "reserva.conferencia_resolvida",
        entidade: "reserva",
        entidadeId: t.reserva.id,
        mudancas: { conferenciaResolvidaEm: [null, agora.toISOString()], motivo: [null, `acerto do cancelamento pelo sistema: ${n}`] },
      });
    }
  }
  const [linha] = await tx.update(cancelamentosReserva).set({ resultadoLancadoEm: agora, espelhado, atualizadoEm: agora }).where(eq(cancelamentosReserva.id, c.id)).returning();
  Object.assign(c, linha);
  await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.cancelamento_resultado", entidade: "pagamento", entidadeId: p.id, mudancas: { espelhado: [null, espelhado], descontos: [null, descontos] } });
  return { avisos };
}

/**
 * Na devolução realizada (leitura que confirma, por fora, confirmação da equipe, ou já devolvida no Mercado Pago ao
 * cancelar): só os componentes de caixa. A saída espelha os recebimentos em vigor do pagamento (nada entrou = nada a
 * lançar). Idempotente (`caixaLancadoEm`). Dentro das travas de quem chama (cotação → motor → livro).
 */
export async function acertarCaixa(tx: Db, organizacaoId: string, t: Travado, p: Pagamento, dev: Devolucao, fato: FatoDaDevolucao, agora: Date, autorId: string | null = null): Promise<{ avisos: CodigoAviso[] }> {
  const c = t.cancelamento;
  if (!c || c.situacao !== "cancelada" || c.caixaLancadoEm) return { avisos: [] };
  await travarMotorDaReserva(tx, organizacaoId, t.reserva.id);
  const { emVigor: recebidos } = await recebimentosDoPagamento(tx, organizacaoId, p.id);
  const soma = recebidos.filter((l) => l.estado === "realizado" || l.estado === "conciliado").reduce((s, l) => s + (l.montante ?? 0), 0);
  if (soma > 0) {
    const devolvido = dev.valorConfirmado ?? dev.porForaValor ?? dev.valor;
    const como = dev.situacao === "por_fora" ? "por fora" : dev.confirmadaPor === "equipe" ? "confirmada pela equipe" : "pelo Mercado Pago";
    const [l] = await lancar(
      tx,
      organizacaoId,
      [
        {
          tipo: "devolucao",
          descricao: `Reserva ${t.reserva.codigo} — devolução de ${formatBRL(devolvido)} ao hóspede (${como} em ${dataBr(fato.data)}): sai o líquido de ${formatBRL(soma)} que entrou; a taxa que não voltou é despesa da empresa`,
          valor: 0,
          efeitoSaldo: 0,
          montante: soma,
          competencia: fato.data,
          dataCaixa: fato.data,
          estado: fato.estado,
          imovelId: t.reserva.imovelId,
          reservaId: t.reserva.id,
          origem: fato.origem,
          chaveOrigem: chaveSaidaDevolucao(p.id, dev.id),
        },
      ],
      autorId,
    );
    await tx.update(devolucoesPagamento).set({ saidaLancamentoId: l.id, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
    dev.saidaLancamentoId = l.id;
  }
  const [linha] = await tx.update(cancelamentosReserva).set({ caixaLancadoEm: agora, atualizadoEm: agora }).where(eq(cancelamentosReserva.id, c.id)).returning();
  Object.assign(c, linha);
  await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.cancelamento_caixa", entidade: "pagamento", entidadeId: p.id, mudancas: { saida: [null, soma] } });
  return { avisos: dev.situacao === "confirmada" && dev.taxaPerdida === null ? ["taxa_perdida_desconhecida"] : [] };
}

/**
 * D15: o pagamento já aparecia devolvido por inteiro no Mercado Pago quando a equipe cancelou. O dia do caixa é o da
 * primeira leitura que viu "devolvido" (`devolvidoVistoEm`), senão o da auditoria dessa leitura; sem nenhum dos dois, hoje,
 * realizado, com o aviso para a equipe conferir a data (nunca uma data suposta como conciliada).
 */
export function fatoDoDevolvidoNoPainel(p: Pick<Pagamento, "devolvidoVistoEm">, auditoriaDevolvido: Date | null, agora: Date): FatoDaDevolucao & { aviso?: CodigoAviso } {
  const visto = p.devolvidoVistoEm ?? auditoriaDevolvido;
  if (visto) return { data: hojeISO(FUSO_PAGAMENTO, visto), estado: "conciliado", origem: "sincronizacao" };
  return { data: hojeISO(FUSO_PAGAMENTO, agora), estado: "realizado", origem: "sincronizacao", aviso: "devolucao_data_a_conferir" };
}

/** Quando a auditoria registrou a primeira leitura que levou o pagamento a "devolvido" (pagamentos de antes da coluna `devolvido_visto_em`). */
export async function auditoriaDoDevolvido(tx: Db, organizacaoId: string, pagamentoId: string): Promise<Date | null> {
  const [a] = await tx
    .select({ criadoEm: auditoria.criadoEm })
    .from(auditoria)
    .where(
      and(
        eq(auditoria.organizacaoId, organizacaoId),
        eq(auditoria.entidade, "pagamento"),
        eq(auditoria.entidadeId, pagamentoId),
        eq(auditoria.acao, "pagamento.situacao"),
        sql`${auditoria.mudancas} -> 'situacao' ->> 1 = 'devolvido'`,
      ),
    )
    .orderBy(asc(auditoria.criadoEm))
    .limit(1);
  return a?.criadoEm ?? null;
}
