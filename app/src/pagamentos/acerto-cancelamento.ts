/**
 * Cancelamento pela política (M8.2c) — o acerto no livro, por componente (desenho §6).
 *
 * - **Resultado** (receita, taxa, comissão, parte do proprietário): todo ele na hora do cancelamento (fase 1), sob as
 *   travas da cotação e do motor. Sem devolução (pela política, ou pela rota "Cancelar a reserva contestada" do M8.2e, base
 *   `contestacao`: o dinheiro volta ao titular pela disputa, se ele ganhar), o motor divide o valor retido como uma reserva
 *   normal. Com devolução
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
 * Idempotente: `resultadoLancadoEm` no cancelamento, `caixaLancadoEm` na devolução (M8.2d: várias por pagamento; o
 * cancelamento ganha a marca quando todas as dele acertaram), e as chaves no livro (por cancelamento e lançamento original
 * nos espelhos, por devolução na saída).
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { auditoria, cancelamentosReserva, devolucoesPagamento, lancamentos, repasseItens, repasses, reservas, type TipoRepasse } from "@/db/schema";
import type { Db } from "@/db/types";
import { aplicarMotor } from "@/financeiro/aplicar";
import { estornar, type Lancamento, lancar } from "@/financeiro/ledger";
import { travarMotorDaReserva } from "@/financeiro/trava";
import { dataBr, hojeISO } from "@/lib/datas";
import { formatBRL } from "@/lib/money";
import { chaveEspelhoDoCancelamento, lancarDescontoDoProprietario, mesDoDesconto, ORIGEM_CANCELAMENTO } from "@/repasses/descontos";
import { reservaCalculadaPeloMotor } from "@/financeiro/motor";
import { trocarAvisosDaDevolucao } from "./avisos-devolucao";
import { FUSO_PAGAMENTO, recebimentosDoPagamento } from "./liberacao";
import type { CodigoAviso } from "./situacoes";
import { comprometido, type Devolucao, devolucoesDoPagamento, type Pagamento, taxaAtribuidaDaDevolucao, type Travado, valorPagoAprovado } from "./travas";

/** A saída do caixa de uma devolução (uma por devolução). Começa com `mercadopago:` (não se estorna pelas listas) e não tem "recebimento". */
export const chaveSaidaDevolucao = (pagamentoId: string, devolucaoId: string) => `mercadopago:${pagamentoId}:devolucao:${devolucaoId}:saida`;

/** Como a devolução se realizou, para o lançamento de caixa: o dia, e se veio de uma leitura (conciliado) ou da equipe. */
export type FatoDaDevolucao = { data: string; estado: "conciliado" | "realizado"; origem: "sincronizacao" | "manual" };

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
 * O caixa de UMA devolução realizada (leitura que confirma, por fora, confirmação da equipe, ou já devolvida no Mercado
 * Pago ao cancelar): só os componentes de caixa (M8.2c §6; M8.2d §6.2, várias devoluções por pagamento). Idempotente
 * pela devolução (`caixaLancadoEm`). Dentro das travas de quem chama (cotação → motor → livro).
 *
 * - Sem reserva: nada entrou no livro, nada sai (só a marca).
 * - O recebimento do pagamento já entrou (E = o que entrou menos as saídas das outras devoluções): a devolução que completa
 *   o pagamento leva tudo o que resta (M8.2c: X = E); as outras, o devolvido menos a taxa atribuída ao principal dela
 *   (X = min(E, A − F)). Com parte do pagamento devolvida pelo painel do Mercado Pago fora do sistema (D17), a que completa
 *   leva também o caixa dessa parte, e ganha o aviso de data a conferir.
 * - Ainda não entrou: se o dinheiro ainda vai entrar (a reserva o motor calcula, o pagamento não fica completo pelas
 *   devoluções e esta não saiu pelo Mercado Pago antes da liberação), a saída espera (`caixaLancadoEm` vazio) e
 *   `acertarCaixasPendentes` a lança logo depois do recebimento; senão nada vai entrar e nada se lança.
 * O cancelamento ganha a marca quando todas as devoluções dele acertaram o caixa.
 */
export async function acertarCaixaDaDevolucao(
  tx: Db,
  organizacaoId: string,
  t: Travado,
  p: Pagamento,
  dev: Devolucao,
  fato: FatoDaDevolucao,
  agora: Date,
  autorId: string | null = null,
): Promise<{ avisos: CodigoAviso[] }> {
  const avisos: CodigoAviso[] = dev.situacao === "confirmada" && dev.taxaPerdida === null ? ["taxa_perdida_desconhecida"] : [];
  if (dev.caixaLancadoEm) return { avisos: [] };
  if (dev.origem === "sem_reserva") {
    await marcarCaixa(tx, dev, agora);
    return { avisos };
  }
  await travarMotorDaReserva(tx, organizacaoId, t.reserva.id);
  const devs = devolucoesDoPagamento(t, p.id);
  const outras = devs.filter((x) => x.id !== dev.id);
  const { emVigor: recebidos } = await recebimentosDoPagamento(tx, organizacaoId, p.id);
  const entrou = recebidos.filter((l) => l.estado === "realizado" || l.estado === "conciliado").reduce((s, l) => s + (l.montante ?? 0), 0);
  const devolvido = dev.valorConfirmado ?? dev.porForaValor ?? dev.valor;
  const realizadasOutras = outras.filter((x) => x.situacao === "confirmada" || x.situacao === "por_fora").reduce((s, x) => s + comprometido(x), 0);
  const completa = p.devolvidoForaReconhecido + realizadasOutras + devolvido >= valorPagoAprovado(p);
  const taxa = await congelarTaxaAtribuida(tx, p, dev, devs, agora);
  let saida = 0;
  if (entrou > 0) {
    const saidasOutras = await saidasEmVigor(tx, organizacaoId, outras);
    const resta = Math.max(0, entrou - saidasOutras);
    saida = completa ? resta : Math.min(resta, Math.max(0, devolvido - (taxa ?? 0)));
  } else {
    // A devolução que saiu pelo Mercado Pago antes da liberação (só a integral de um pagamento intocado, D13) leva o
    // dinheiro de volta antes de ele entrar: nada vai entrar por este pagamento. Só a que se sabe integral (o pedido de
    // corpo vazio): a confirmada pela equipe sem nunca ter sido pedida não diz o que voltou, e a parte espera o
    // recebimento como as outras (a que completa o pagamento já não espera, acima).
    const saiuAntes = dev.situacao === "confirmada" && dev.corpoIntegral === true && !p.liberacaoConfirmadaEm;
    const aindaEntra = reservaCalculadaPeloMotor(t.reserva) && !completa && !saiuAntes;
    if (aindaEntra) return { avisos };
  }
  if (saida > 0) {
    const como = dev.situacao === "por_fora" ? "por fora" : dev.confirmadaPor === "equipe" ? "confirmada pela equipe" : "pelo Mercado Pago";
    const [l] = await lancar(
      tx,
      organizacaoId,
      [
        {
          tipo: "devolucao",
          // A que completa o pagamento leva o líquido que resta (o texto do M8.2c); uma parte, o devolvido menos a taxa dela.
          descricao: completa
            ? `Reserva ${t.reserva.codigo} — devolução de ${formatBRL(devolvido)} ao hóspede (${como} em ${dataBr(fato.data)}): sai o líquido de ${formatBRL(saida)} que entrou; a taxa que não voltou é despesa da empresa`
            : `Reserva ${t.reserva.codigo} — devolução de ${formatBRL(devolvido)} ao hóspede (${como} em ${dataBr(fato.data)}): sai ${formatBRL(saida)} do que entrou; a taxa do Mercado Pago sobre a parte devolvida que não voltar é despesa da empresa`,
          valor: 0,
          efeitoSaldo: 0,
          montante: saida,
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
    // D17: a parte devolvida pelo painel do Mercado Pago, fora do sistema, não tem saída própria — a que completa o
    // pagamento leva tudo o que resta, no dia dela. A equipe confere a data (aviso, nunca uma data suposta).
    if (completa && p.devolvidoForaReconhecido > 0) avisos.push("devolucao_data_a_conferir");
  }
  await marcarCaixa(tx, dev, agora);
  // O cancelamento fica com o caixa acertado quando todas as devoluções dele acertaram (M8.2c: a única devolução dele).
  const c = t.cancelamento;
  if (dev.origem === "cancelamento" && c && c.id === dev.cancelamentoId && !c.caixaLancadoEm) {
    const doCancelamento = t.devolucoes.filter((x) => x.cancelamentoId === c.id && x.situacao !== "substituida");
    if (doCancelamento.every((x) => x.caixaLancadoEm)) {
      const [linha] = await tx.update(cancelamentosReserva).set({ caixaLancadoEm: agora, atualizadoEm: agora }).where(eq(cancelamentosReserva.id, c.id)).returning();
      Object.assign(c, linha);
    }
  }
  // A auditoria do M8.2c continua com o nome dela para a devolução do cancelamento.
  await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: dev.origem === "cancelamento" ? "pagamento.cancelamento_caixa" : "pagamento.devolucao_caixa", entidade: "pagamento", entidadeId: p.id, mudancas: { saida: [null, saida] } });
  return { avisos };
}

/** M8.2c: o nome de antes (uma devolução por cancelamento). */
export const acertarCaixa = acertarCaixaDaDevolucao;

async function marcarCaixa(tx: Db, dev: Devolucao, agora: Date): Promise<void> {
  await tx.update(devolucoesPagamento).set({ caixaLancadoEm: agora, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
  dev.caixaLancadoEm = agora;
}

/** As saídas de caixa em vigor (não estornadas) das devoluções dadas. */
async function saidasEmVigor(tx: Db, organizacaoId: string, devs: readonly Devolucao[]): Promise<number> {
  const ids = devs.map((d) => d.saidaLancamentoId).filter((x): x is string => !!x);
  if (!ids.length) return 0;
  const linhas = await tx
    .select({ montante: lancamentos.montante })
    .from(lancamentos)
    .where(and(eq(lancamentos.organizacaoId, organizacaoId), inArray(lancamentos.id, ids), emVigor()));
  return linhas.reduce((s, l) => s + (l.montante ?? 0), 0);
}

/**
 * Congela a taxa atribuída ao principal da devolução (D19) na primeira vez que dá para calcular (a taxa do pagamento
 * conhecida); devolve a congelada (ou null, ainda desconhecida). Sob as travas de quem chama.
 */
export async function congelarTaxaAtribuida(tx: Db, p: Pagamento, dev: Devolucao, devs: readonly Devolucao[], agora: Date): Promise<number | null> {
  if (dev.taxaAtribuida !== null) return dev.taxaAtribuida;
  const taxa = taxaAtribuidaDaDevolucao(p, dev, devs);
  if (taxa === null) return null;
  await tx.update(devolucoesPagamento).set({ taxaAtribuida: taxa, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
  dev.taxaAtribuida = taxa;
  return taxa;
}

/**
 * Depois do recebimento do pagamento entrar no livro (liberação pelo Mercado Pago ou registrada à mão): lança as saídas
 * de caixa que esperavam por ele (devoluções realizadas antes, por fora ou confirmadas), no dia da liberação. Sob as
 * travas de quem chama; idempotente por devolução.
 */
export async function acertarCaixasPendentes(tx: Db, organizacaoId: string, t: Travado, p: Pagamento, data: string, agora: Date): Promise<CodigoAviso[]> {
  const avisos: CodigoAviso[] = [];
  for (const dev of devolucoesDoPagamento(t, p.id)) {
    if (dev.caixaLancadoEm || (dev.situacao !== "confirmada" && dev.situacao !== "por_fora") || (dev.origem !== "cancelamento" && dev.origem !== "alteracao")) continue;
    const fato: FatoDaDevolucao = dev.situacao === "confirmada" && dev.confirmadaPor !== "equipe" ? { data, estado: "conciliado", origem: "sincronizacao" } : { data, estado: "realizado", origem: "manual" };
    const r = await acertarCaixaDaDevolucao(tx, organizacaoId, t, p, dev, fato, agora);
    if (r.avisos.length) await trocarAvisosDaDevolucao(tx, dev, { ligar: r.avisos }, agora);
    avisos.push(...r.avisos);
  }
  return avisos;
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
