/**
 * Contestação do pagamento no site (M8.2e) — o resultado (ganha, perdida, sem efeito, conferir o aviso), a devolução
 * substituída, "Cancelar a reserva contestada" e o pagamento sem reserva, em PGlite com o Mercado Pago falso (sem rede): o
 * fluxo inteiro (a disputa aberta pela leitura da order, o débito, a decisão e o resultado pelo domínio), conferindo o
 * livro, o repasse e o dinheiro com a empresa do lado do proprietário.
 * Itens 14, 15 (os seis exemplos com a identidade do caixa), 16, 18 e 24 de "Testes a escrever" (PAGAMENTO-SITE.md,
 * "Contestação (M8.2e)"), mais o "sem efeito" e o "Conferir o aviso".
 */
import { and, asc, eq, like } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditoria, cancelamentosReserva, contestacoesPagamento, cotacoes, devolucoesPagamento, eventosContestacao, lancamentos, pagamentos } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { hojeISO } from "@/lib/datas";
import { mensagensDoCancelamento } from "@/mensagens/hospede";
import { partesDoProprietario } from "@/repasses/extrato";
import { dinheiroComAEmpresa, recebidoPorReserva } from "@/repasses/recebimentos";
import { cancelarReservaContestada, canceladaPelaDisputa, previaDoCancelamentoContestado, TEXTO_PREVIA_MUDOU, TEXTO_SEM_DISPUTA_PARA_CANCELAR } from "./cancelamento";
import { conferirTentativa } from "./conferencia";
import { avisosDeCancelamento, pagamentosDaReserva, vistaDaCotacaoParaHospede } from "./consultas";
import {
  buscarContestacoesTardias,
  conferirAviso,
  conferirContestacoes,
  confirmarDebito,
  confirmarOutraDisputa,
  confirmarResultado,
  type EntradaResultado,
  encerrarSemEfeito,
  previaDaDecisao,
  previaDoResultado,
  registrarContestacaoDaEquipe,
  registrarDecisao,
  TEXTO_NOTA_DO_RESULTADO,
  textoPerdaAcimaDoQueSobra,
  textoPerdaSemReservaAcimaDaTaxa,
} from "./contestacao";
import { partesEfetivasDaReserva, TEXTO_INFORME_A_VOLTA } from "./contestacao-acerto";
import {
  chavesDaContestacao,
  dividirPerda,
  NOTA_SEM_CONFERIR_AGORA,
  prefixoDaContestacao,
  type QuemArcaContestacao,
  TEXTO_CONTESTACAO_PREVIA_MUDOU,
  TEXTO_DECISAO_MUDOU,
  TEXTO_NOTA_REFORCADA,
} from "./contestacao-regras";
import { devolverPeloProvedor, registrarTaxaPerdida } from "./devolucao";
import type { ProvedorPagamento } from "./provedor";
import { textoDevolucaoDevidaDepoisDaDisputa } from "./situacoes";
import type { Contestacao } from "./travas";
import { type Cenario, cancelar, entradaPadrao, envelhecer, liberar, minutos, montarCenario, pagarEConfirmar, reduzirDeTeste, repassar, semDadosDoHospede, TOTAL, usuarioDeTeste } from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario, equipe: string;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
  c = await montarCenario(db);
  equipe = await usuarioDeTeste(c);
});
// Dados pessoais: nada do hóspede nas tabelas do pagamento (as da disputa inclusive), no livro e na auditoria.
afterEach(async () => {
  expect(await semDadosDoHospede(db)).toEqual([]);
  const daDisputa = JSON.stringify([await db.select().from(contestacoesPagamento), await db.select().from(eventosContestacao)]);
  for (const v of ["visitante@example.com", "Visitante Fictício", "99999-0000"]) expect(daDisputa).not.toContain(v);
});

const TAXA = 1824;
const LIQUIDO = TOTAL - TAXA;
const sp = (dataHora: string) => new Date(`${dataHora.replace(" ", "T")}:00-03:00`);
const conferir = (id: string, quando: Date) => conferirTentativa(db, c.org, id, c.provedor, quando, { origem: "rotina", forcar: true });
const linhas = (pagamentoId: string) => db.select().from(contestacoesPagamento).where(eq(contestacoesPagamento.pagamentoId, pagamentoId)).orderBy(asc(contestacoesPagamento.abertaEm), asc(contestacoesPagamento.rodada), asc(contestacoesPagamento.id));
const linha = async (id: string) => (await db.select().from(contestacoesPagamento).where(eq(contestacoesPagamento.id, id)))[0];
const daDisputa = (l: Pick<Contestacao, "pagamentoId" | "id">) =>
  db.select().from(lancamentos).where(like(lancamentos.chaveOrigem, `${prefixoDaContestacao(l.pagamentoId, l.id)}%`)).orderBy(asc(lancamentos.criadoEm), asc(lancamentos.chaveOrigem));
const naChave = async (l: Pick<Contestacao, "pagamentoId" | "id">, chave: string) => (await daDisputa(l)).filter((x) => x.chaveOrigem === chave);
const devolucoes = (pagamentoId: string) => db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.pagamentoId, pagamentoId)).orderBy(asc(devolucoesPagamento.criadoEm));

/** Reserva paga por Pix (taxa de R$ 18,24), liberada salvo `liberar: false`, com a parte repassada (`repassada`); a disputa (padrão: o pago) aberta pela leitura em 20/10. */
async function disputada(o: { liberar?: boolean; repassada?: boolean; valor?: number; entrada?: string; saida?: string } = {}) {
  const x = await pagarEConfirmar(c, { liberar: o.liberar ?? true, entrada: o.entrada, saida: o.saida });
  if (o.repassada) await repassar(c, "antecipado", { hoje: "2026-10-13" });
  const ids = c.provedor.contestar(x.idProvedor, "order", o.valor ? { valor: o.valor } : {});
  await conferir(x.pagamentoId, sp("2026-10-20 10:00"));
  const [l] = await linhas(x.pagamentoId);
  expect(l).toMatchObject({ situacao: "aberta" });
  return { ...x, ...ids, l };
}

async function decidir(l: Pick<Contestacao, "id">, quemArca: QuemArcaContestacao, quando: Date) {
  const pv = await previaDaDecisao(db, c.org, l.id);
  if (!pv.ok) throw new Error(pv.erro);
  const r = await registrarDecisao(db, c.org, l.id, { causa: "imovel", quemArca, nota: "Decisão da equipe.", explicacao: "", versao: pv.fatos.versao, assinatura: pv.fatos.opcoes[quemArca]?.assinatura ?? "" }, equipe, quando);
  if (!r.ok) throw new Error(r.erro);
}

const debito = async (l: Pick<Contestacao, "id">, data: string, valor: number, nota = "") => {
  const r = await confirmarDebito(db, c.org, l.id, { data, valor, nota }, equipe, sp(`${data} 18:00`));
  if (!r.ok) throw new Error(r.erro);
};

/** "Confirmar o resultado" pelo domínio, com a versão e a assinatura da prévia de agora (sem provedor, salvo `provedor`). */
async function confirmar(l: Pick<Contestacao, "id">, resultado: "ganha" | "perdida", quando: Date, campos: Partial<EntradaResultado> = {}, provedor: ProvedorPagamento | null = null) {
  const pv = await previaDoResultado(db, c.org, l.id);
  if (!pv.ok) throw new Error(pv.erro);
  return confirmarResultado(
    db,
    c.org,
    l.id,
    { resultado, data: hojeISO("America/Sao_Paulo", quando), nota: "Conferido no painel do Mercado Pago.", notaReforcada: false, versao: pv.fatos.versao, assinatura: pv.fatos.assinatura, tarifa: null, ...campos },
    equipe,
    provedor,
    quando,
  );
}

/**
 * O que cada lado ficou da reserva, pelo livro inteiro (os estornos se anulam com os originais): o proprietário (as partes),
 * a SCL (a comissão e as despesas dela) e o caixa (recebimentos menos saídas, realizados).
 */
async function balanco(reservaId: string) {
  const ls = await db.select().from(lancamentos).where(and(eq(lancamentos.organizacaoId, c.org), eq(lancamentos.reservaId, reservaId)));
  const soma = (tipos: string[]) => ls.filter((l) => tipos.includes(l.tipo)).reduce((s, l) => s + l.valor, 0);
  const caixa = ls
    .filter((l) => (l.tipo === "recebimento" || l.tipo === "devolucao") && (l.estado === "realizado" || l.estado === "conciliado"))
    .reduce((s, l) => s + (l.tipo === "recebimento" ? 1 : -1) * (l.montante ?? 0), 0);
  return { proprietario: soma(["direito_proprietario"]), scl: soma(["comissao", "despesa_empresa"]), caixa };
}
const partes = (reservaId: string) => partesEfetivasDaReserva(db, c.org, reservaId);
const dinheiro = async (reservaId: string) => (await recebidoPorReserva(db, c.org, [reservaId])).get(reservaId)!;

describe("ganha (item 14; exemplo 2)", () => {
  it("reversão e espelho no mês corrente (outubro, o da decisão, não muda); a volta do retido realizado; a tarifa como despesa; o pagamento volta a aprovado; o débito e a reversão somam zero no repasse; o caixa volta ao de antes", async () => {
    const x = await disputada({ repassada: true });
    const { parteProprietario: D, comissao: C } = await partes(x.reservaId);
    const { proprietario: px, scl: py } = dividirPerda(TOTAL, D, C)!;
    await debito(x.l, "2026-10-21", TOTAL);
    await decidir(x.l, "proporcional", sp("2026-10-22 10:00"));
    const r = await confirmar(x.l, "ganha", sp("2026-12-10 10:00"), { voltaEm: "2026-12-05", tarifa: 1500 });
    expect(r).toEqual({ ok: true, contestacaoId: x.l.id });
    const ch = chavesDaContestacao(x.pagamentoId, x.l.id);
    expect((await naChave(x.l, ch.proprietario(1)))[0]).toMatchObject({ valor: -px, competencia: "2026-10-01" });
    expect((await naChave(x.l, ch.scl(1)))[0]).toMatchObject({ valor: -py, competencia: "2026-10-01", estado: "previsto" });
    expect((await naChave(x.l, ch.proprietarioReverte()))[0]).toMatchObject({ tipo: "direito_proprietario", valor: px, efeitoSaldo: px, competencia: "2026-12-01", estado: "previsto", proprietarioId: c.dono });
    expect((await naChave(x.l, ch.sclReverte()))[0]).toMatchObject({ tipo: "despesa_empresa", valor: py, montante: -py, competencia: "2026-12-01", estado: "previsto" });
    expect((await naChave(x.l, ch.volta()))[0]).toMatchObject({ tipo: "recebimento", valor: 0, montante: TOTAL, estado: "realizado", competencia: "2026-12-05", dataCaixa: "2026-12-05" });
    expect((await naChave(x.l, ch.tarifa()))[0]).toMatchObject({ tipo: "despesa_empresa", valor: -1500, montante: 1500, estado: "realizado", dataCaixa: "2026-12-10" });
    expect(await linha(x.l.id)).toMatchObject({ situacao: "ganha", resultadoEm: "2026-12-10", resultadoPor: equipe, tarifa: 1500, definitivoEm: sp("2026-12-10 10:00") });
    const p = await c.tentativa(x.pagamentoId);
    expect(p.situacao).toBe("aprovado");
    expect(p.avisos).not.toContain("contestado");
    const aud = (await db.select().from(auditoria).where(and(eq(auditoria.acao, "pagamento.situacao"), eq(auditoria.entidadeId, x.pagamentoId)))).find((a) => JSON.stringify(a.mudancas).includes("contestacao_ganha"));
    expect(aud?.mudancas).toMatchObject({ situacao: ["contestado", "aprovado"], motivo: [null, "contestacao_ganha"] });
    // O débito do proprietário nunca descontado e a reversão: disponíveis juntos, somam zero.
    const daDisputaNoRepasse = (await partesDoProprietario(db, c.org, c.dono, sp("2026-12-11 10:00"))).filter((y) => y.reservaId === x.reservaId && y.origemLancamento !== "motor");
    expect(daDisputaNoRepasse.map((y) => y.situacao)).toEqual(["disponivel", "disponivel"]);
    expect(daDisputaNoRepasse.reduce((s, y) => s + y.valor, 0)).toBe(0);
    // O resultado igual ao de antes da disputa (a tarifa à parte, da SCL); o caixa volta ao líquido que entrou (menos a tarifa, sem caixa).
    expect(await balanco(x.reservaId)).toEqual({ proprietario: D, scl: C - 1500, caixa: LIQUIDO });
    expect(dinheiroComAEmpresa(await dinheiro(x.reservaId))).toBe(true);
    // Repetir a confirmação: a disputa já terminou.
    expect(await confirmar(x.l, "ganha", sp("2026-12-10 11:00"))).toMatchObject({ ok: false });
  });

  it("sem débito confirmado: o retido previsto é estornado; sem recebimento, o aviso de ganha sem recebimento — ou a liberação no próprio formulário", async () => {
    const x = await disputada({ liberar: false });
    expect(await confirmar(x.l, "ganha", sp("2026-10-25 10:00"))).toMatchObject({ ok: true });
    const ch = chavesDaContestacao(x.pagamentoId, x.l.id);
    const [previsto] = await naChave(x.l, ch.retido());
    expect(await db.select().from(lancamentos).where(eq(lancamentos.estornoDe, previsto.id))).toHaveLength(1);
    expect(await naChave(x.l, ch.volta())).toEqual([]);
    expect(await linha(x.l.id)).toMatchObject({ situacao: "ganha", retidoLancamentoId: null, avisos: expect.arrayContaining(["contestacao_ganha_sem_recebimento"]) });
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("contestacao_ganha_sem_recebimento");
    // Outra reserva, a mesma situação, com a liberação no formulário do "Ganhou".
    const y = await disputada({ liberar: false, entrada: "2026-11-20", saida: "2026-11-23" });
    const r = await confirmar(y.l, "ganha", sp("2026-10-25 10:00"), { liberacao: { data: "2026-10-24", liquido: LIQUIDO } });
    expect(r).toMatchObject({ ok: true });
    const recebidos = await db.select().from(lancamentos).where(like(lancamentos.chaveOrigem, `mercadopago:${y.pagamentoId}:recebimento%`));
    expect(recebidos).toMatchObject([{ montante: LIQUIDO, dataCaixa: "2026-10-24", estado: "realizado" }]);
    expect((await linha(y.l.id)).avisos).not.toContain("contestacao_ganha_sem_recebimento");
    expect(await c.tentativa(y.pagamentoId)).toMatchObject({ situacao: "aprovado", liberacaoOrigem: "manual" });
    // Uma liberação que as regras recusam (no futuro) desfaz tudo.
    const z = await disputada({ liberar: false, entrada: "2026-11-02", saida: "2026-11-05" });
    expect(await confirmar(z.l, "ganha", sp("2026-10-25 10:00"), { liberacao: { data: "2026-10-30", liquido: LIQUIDO } })).toMatchObject({ ok: false, erro: "A data da liberação não pode ser no futuro." });
    expect(await linha(z.l.id)).toMatchObject({ situacao: "aberta" });
  });
});

describe("perdida (item 15)", () => {
  it("exemplo 1: liberado, parte repassada, proporcional, débito confirmado: caixa final 0; o proprietário fica com D − x e a SCL com C − y (somam −taxa, o caixa confere); espelho e perda definitiva no mês corrente; outubro não muda", async () => {
    const x = await disputada({ repassada: true });
    const { parteProprietario: D, comissao: C } = await partes(x.reservaId);
    const { proprietario: px, scl: py } = dividirPerda(TOTAL, D, C)!;
    await debito(x.l, "2026-10-21", TOTAL);
    await decidir(x.l, "proporcional", sp("2026-10-22 10:00"));
    const pv = await previaDoResultado(db, c.org, x.l.id);
    expect(pv.ok && pv.fatos).toMatchObject({ semReserva: false, semRecebimento: false, lancado: { proprietario: px, scl: py }, retido: { estado: "realizado", montante: TOTAL, data: "2026-10-21" }, proposta: { valorPerdido: TOTAL, liquidoNaoEntrou: 0, debitoEm: "2026-10-21" }, sugestao: null });
    expect(await confirmar(x.l, "perdida", sp("2026-12-10 10:00"), { valorPerdido: TOTAL, liquidoNaoEntrou: 0, debitoEm: "2026-10-21" })).toMatchObject({ ok: true });
    const ch = chavesDaContestacao(x.pagamentoId, x.l.id);
    expect(await naChave(x.l, ch.caixaFinal())).toEqual([]);
    expect(await naChave(x.l, ch.proprietarioFinal())).toEqual([]);
    expect((await naChave(x.l, ch.sclEspelho()))[0]).toMatchObject({ valor: py, montante: -py, estado: "previsto", competencia: "2026-12-01" });
    expect((await naChave(x.l, ch.sclFinal()))[0]).toMatchObject({ valor: -py, montante: py, estado: "realizado", dataCaixa: null, competencia: "2026-12-01" });
    // Sem `mudarEstado`: as linhas de outubro continuam previstas e em outubro.
    expect((await naChave(x.l, ch.scl(1)))[0]).toMatchObject({ estado: "previsto", competencia: "2026-10-01" });
    expect((await naChave(x.l, ch.proprietario(1)))[0]).toMatchObject({ estado: "previsto", competencia: "2026-10-01" });
    expect(await linha(x.l.id)).toMatchObject({ situacao: "perdida", valorPerdido: TOTAL, liquidoNaoEntrou: 0, debitoEm: "2026-10-21", definitivoEm: sp("2026-12-10 10:00") });
    const b = await balanco(x.reservaId);
    expect(b).toEqual({ proprietario: D - px, scl: C - py, caixa: LIQUIDO - TOTAL });
    expect(b.proprietario + b.scl).toBe(-TAXA);
    expect(b.caixa).toBe(-TAXA);
    // O dinheiro com a empresa fecha: recebido (o líquido menos o débito) + perda coberta = o devido.
    const d = await dinheiro(x.reservaId);
    expect(d).toMatchObject({ recebido: LIQUIDO - TOTAL, perdaCoberta: TOTAL, devido: LIQUIDO });
    expect(dinheiroComAEmpresa(d)).toBe(true);
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("contestado");
    const [a] = await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, c.org), eq(auditoria.acao, "contestacao.resultado")));
    expect(a.mudancas).toMatchObject({ situacao: ["aberta", "perdida"], valorPerdido: [TOTAL, TOTAL], debitoEm: [null, "2026-10-21"] });
    expect(JSON.stringify(a.mudancas)).not.toContain("Conferido");
  });

  it("exemplo 3: não liberado, o proprietário arca, perdida: o líquido que não entrou proposto; o caixa final é a taxa, na data do débito; a parte e o débito ficam disponíveis juntos", async () => {
    const x = await disputada({ liberar: false });
    const { parteProprietario: D, comissao: C } = await partes(x.reservaId);
    await decidir(x.l, "proprietario", sp("2026-10-22 10:00"));
    const pv = await previaDoResultado(db, c.org, x.l.id);
    expect(pv.ok && pv.fatos).toMatchObject({ semRecebimento: true, proposta: { valorPerdido: TOTAL, liquidoNaoEntrou: LIQUIDO, debitoEm: null } });
    // Sem o dia do débito, o caixa final não tem data: recusa (nada gravado).
    expect(await confirmar(x.l, "perdida", sp("2026-12-10 10:00"), { valorPerdido: TOTAL, liquidoNaoEntrou: LIQUIDO })).toMatchObject({ ok: false, codigo: "dados" });
    expect((await linha(x.l.id)).situacao).toBe("aberta");
    expect(await confirmar(x.l, "perdida", sp("2026-12-10 10:00"), { valorPerdido: TOTAL, liquidoNaoEntrou: LIQUIDO, debitoEm: "2026-12-09" })).toMatchObject({ ok: true });
    const ch = chavesDaContestacao(x.pagamentoId, x.l.id);
    expect((await naChave(x.l, ch.caixaFinal()))[0]).toMatchObject({ tipo: "devolucao", montante: TAXA, dataCaixa: "2026-12-09", competencia: "2026-12-09", estado: "realizado" });
    const [previsto] = await naChave(x.l, ch.retido());
    expect(await db.select().from(lancamentos).where(eq(lancamentos.estornoDe, previsto.id))).toHaveLength(1);
    // O proprietário arcou com o valor inteiro (Σx = xF): nenhum ajuste; a SCL não perdeu nada.
    expect(await naChave(x.l, ch.proprietarioFinal())).toEqual([]);
    const b = await balanco(x.reservaId);
    expect(b).toEqual({ proprietario: D - TOTAL, scl: C, caixa: -TAXA });
    expect(b.proprietario + b.scl).toBe(b.caixa);
    const d = await dinheiro(x.reservaId);
    expect(d).toMatchObject({ recebido: -TAXA, perdaCoberta: TOTAL, devido: LIQUIDO });
    expect(dinheiroComAEmpresa(d)).toBe(true);
  });

  it("exemplo 4: liberado, a SCL arca (cobrança em dobro): o proprietário mantém a parte; a SCL fica com C − o valor", async () => {
    const x = await disputada();
    const { parteProprietario: D, comissao: C } = await partes(x.reservaId);
    await debito(x.l, "2026-10-21", TOTAL);
    await decidir(x.l, "scl", sp("2026-10-22 10:00"));
    expect(await confirmar(x.l, "perdida", sp("2026-12-10 10:00"), { valorPerdido: TOTAL, liquidoNaoEntrou: 0 })).toMatchObject({ ok: true });
    const ch = chavesDaContestacao(x.pagamentoId, x.l.id);
    expect((await naChave(x.l, ch.sclFinal()))[0]).toMatchObject({ valor: -TOTAL });
    expect(await naChave(x.l, ch.caixaFinal())).toEqual([]);
    expect(await balanco(x.reservaId)).toEqual({ proprietario: D, scl: C - TOTAL, caixa: -TAXA });
  });

  it("exemplo 5: disputa de parte do valor antes da liberação; a liberação à mão sob disputa; o débito; a SCL arca; perdida: caixa final 0 e o dinheiro com a empresa fecha", async () => {
    const V = 50_000;
    const x = await disputada({ liberar: false, valor: V });
    expect(x.l).toMatchObject({ valor: V, valorEmRisco: V });
    const { parteProprietario: D, comissao: C } = await partes(x.reservaId);
    await liberar(c, x.pagamentoId, { data: "2026-10-21", quando: sp("2026-10-21 09:00") });
    await debito(x.l, "2026-10-21", V);
    await decidir(x.l, "scl", sp("2026-10-22 10:00"));
    const pv = await previaDoResultado(db, c.org, x.l.id);
    expect(pv.ok && pv.fatos.proposta).toMatchObject({ valorPerdido: V, liquidoNaoEntrou: 0, debitoEm: "2026-10-21" });
    expect(await confirmar(x.l, "perdida", sp("2026-12-10 10:00"), { valorPerdido: V, liquidoNaoEntrou: 0 })).toMatchObject({ ok: true });
    expect(await naChave(x.l, chavesDaContestacao(x.pagamentoId, x.l.id).caixaFinal())).toEqual([]);
    expect(await balanco(x.reservaId)).toEqual({ proprietario: D, scl: C - V, caixa: LIQUIDO - V });
    const d = await dinheiro(x.reservaId);
    expect(d.recebido + (d.perdaCoberta ?? 0)).toBe(LIQUIDO);
    expect(dinheiroComAEmpresa(d)).toBe(true);
  });

  it("exemplo 6 (item 16): cancelamento integral com a devolução ainda não saída, depois a disputa (nada a dividir), perdida: a devolução confirmada pela disputa, a taxa perdida informada; o proprietário só pelo cancelamento", async () => {
    const x = await pagarEConfirmar(c, { liberar: true });
    await repassar(c, "antecipado", { hoje: "2026-10-13" });
    const { parteProprietario: D, comissao: C } = await partes(x.reservaId);
    // O Mercado Pago recusa o primeiro pedido com clareza: a devolução continua pedida, sem nada lá.
    c.provedor.respostaDevolucao = "saldo_insuficiente";
    const canc = await cancelar(c, x.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "imovel_sem_condicoes" }), equipe, sp("2026-10-14 10:00"));
    expect(canc.resultado).toMatchObject({ ok: true, direito: "integral" });
    expect(await partes(x.reservaId)).toMatchObject({ parteProprietario: 0, comissao: 0 });
    c.provedor.contestar(x.idProvedor);
    await conferir(x.pagamentoId, sp("2026-10-20 10:00"));
    const [l] = await linhas(x.pagamentoId);
    const [dev] = await devolucoes(x.pagamentoId);
    expect(dev).toMatchObject({ situacao: "recusada", contestacaoId: l.id });
    expect(l).toMatchObject({ valorEmRisco: 0, retidoLancamentoId: null });
    const pv = await previaDaDecisao(db, c.org, l.id);
    expect(pv.ok && pv.fatos.recusa).toBe("A disputa cobre a devolução que a reserva já devia ao hóspede: nada a dividir.");
    // O Mercado Pago debitou o valor inteiro (o retido confirmado é a saída); perdida.
    await debito(l, "2026-10-21", TOTAL, "O painel mostra o débito do valor inteiro.");
    expect(await confirmar(l, "perdida", sp("2026-12-10 10:00"), { valorPerdido: TOTAL, liquidoNaoEntrou: 0 })).toMatchObject({ ok: true });
    const [confirmada] = await devolucoes(x.pagamentoId);
    expect(confirmada).toMatchObject({ situacao: "confirmada", confirmadaPor: "contestacao", valorConfirmado: TOTAL, saidaLancamentoId: null, taxaPerdida: null, avisos: expect.arrayContaining(["taxa_perdida_desconhecida"]) });
    expect(confirmada.caixaLancadoEm).not.toBeNull();
    expect(await linha(l.id)).toMatchObject({ situacao: "perdida", definitivoEm: sp("2026-12-10 10:00") });
    expect((await db.select().from(cancelamentosReserva).where(eq(cancelamentosReserva.reservaId, x.reservaId)))[0].caixaLancadoEm).not.toBeNull();
    const [aud] = await db.select().from(auditoria).where(and(eq(auditoria.acao, "pagamento.devolucao_confirmada"), eq(auditoria.entidadeId, x.pagamentoId)));
    expect(aud.mudancas).toMatchObject({ devolucao: ["recusada", "confirmada pela disputa"], valor: [TOTAL, TOTAL] });
    // A taxa que não voltou, pelo caminho de sempre: despesa da SCL.
    expect(await registrarTaxaPerdida(db, c.org, { devolucaoId: dev.id }, TAXA, equipe, sp("2026-12-11 10:00"))).toMatchObject({ ok: true });
    const b = await balanco(x.reservaId);
    expect(b).toEqual({ proprietario: D - D, scl: C - C - TAXA, caixa: -TAXA });
    expect(b.proprietario + b.scl).toBe(b.caixa);
    expect(dinheiroComAEmpresa(await dinheiro(x.reservaId))).toBe(true);
  });

  it("o ajuste é comparado com o já lançado: exposição do pago, perdidos 80%: o proprietário recebe a diferença; a SCL espelha a prevista e lança a definitiva", async () => {
    const x = await disputada({ repassada: true });
    const { parteProprietario: D, comissao: C } = await partes(x.reservaId);
    const antes = dividirPerda(TOTAL, D, C)!;
    await decidir(x.l, "proporcional", sp("2026-10-22 10:00"));
    const perdido = (TOTAL * 8) / 10;
    const fim = dividirPerda(perdido, D, C)!;
    expect(await confirmar(x.l, "perdida", sp("2026-12-10 10:00"), { valorPerdido: perdido, liquidoNaoEntrou: 0, debitoEm: "2026-12-09", nota: "O painel mostra o débito de 80%." })).toMatchObject({ ok: true });
    const ch = chavesDaContestacao(x.pagamentoId, x.l.id);
    expect((await naChave(x.l, ch.proprietarioFinal()))[0]).toMatchObject({ valor: antes.proprietario - fim.proprietario, competencia: "2026-12-01", estado: "previsto" });
    expect((await naChave(x.l, ch.sclEspelho()))[0]).toMatchObject({ valor: antes.scl });
    expect((await naChave(x.l, ch.sclFinal()))[0]).toMatchObject({ valor: -fim.scl });
    expect((await naChave(x.l, ch.caixaFinal()))[0]).toMatchObject({ tipo: "devolucao", montante: perdido, dataCaixa: "2026-12-09" });
    expect(await linha(x.l.id)).toMatchObject({ exposicao: perdido, parteProprietario: fim.proprietario, parteScl: fim.scl });
    expect(await balanco(x.reservaId)).toEqual({ proprietario: D - fim.proprietario, scl: C - fim.scl, caixa: LIQUIDO - perdido });
  });

  it("a nota do resultado é obrigatória quando o Mercado Pago não mostra o resultado (e ganha a observação sem a leitura); assinatura e versão velhas recusadas", async () => {
    const x = await disputada();
    expect(await confirmar(x.l, "perdida", sp("2026-12-10 10:00"), { valorPerdido: TOTAL, liquidoNaoEntrou: 0, debitoEm: "2026-12-09", nota: "" })).toMatchObject({ ok: false, erro: TEXTO_NOTA_DO_RESULTADO });
    // A prévia velha: o débito confirmado no meio muda o retido (a assinatura); a decisão registrada muda a versão.
    const pv = await previaDoResultado(db, c.org, x.l.id);
    if (!pv.ok) throw new Error(pv.erro);
    await debito(x.l, "2026-10-21", TOTAL);
    const e = { resultado: "perdida", data: "2026-12-10", nota: "Perdida.", notaReforcada: false, versao: 0, assinatura: pv.fatos.assinatura, tarifa: null, valorPerdido: TOTAL, liquidoNaoEntrou: 0, debitoEm: "2026-10-21" };
    expect(await confirmarResultado(db, c.org, x.l.id, e, equipe, null, sp("2026-12-10 10:00"))).toMatchObject({ ok: false, erro: TEXTO_CONTESTACAO_PREVIA_MUDOU, codigo: "contestacao_previa_mudou" });
    await decidir(x.l, "scl", sp("2026-10-22 10:00"));
    const pv2 = await previaDoResultado(db, c.org, x.l.id);
    if (!pv2.ok) throw new Error(pv2.erro);
    expect(await confirmarResultado(db, c.org, x.l.id, { ...e, assinatura: pv2.fatos.assinatura }, equipe, null, sp("2026-12-10 10:00"))).toMatchObject({ ok: false, erro: TEXTO_DECISAO_MUDOU });
    expect(await confirmarResultado(db, c.org, x.l.id, { ...e, versao: 1, assinatura: pv2.fatos.assinatura }, equipe, null, sp("2026-12-10 10:00"))).toMatchObject({ ok: true });
    expect((await linha(x.l.id)).resultadoNota).toBe(`Perdida. (${NOTA_SEM_CONFERIR_AGORA})`);
  });

  it("fase 0: a leitura de agora mostra a disputa em andamento: pede a nota reforçada; com ela, vale", async () => {
    const x = await disputada();
    const quando = sp("2026-10-25 10:00");
    const r = await confirmar(x.l, "ganha", quando, {}, c.provedor);
    expect(r).toMatchObject({ ok: false, erro: TEXTO_NOTA_REFORCADA, codigo: "nota_reforcada" });
    expect((await linha(x.l.id)).consultadaEm).toEqual(quando);
    expect(await confirmar(x.l, "ganha", sp("2026-10-25 11:00"), { notaReforcada: true, nota: "O painel do Mercado Pago já mostra o resultado." }, c.provedor)).toMatchObject({ ok: true });
    expect(await linha(x.l.id)).toMatchObject({ situacao: "ganha", resultadoNota: "O painel do Mercado Pago já mostra o resultado." });
  });

  it("perdida sem decisão: o caixa acertado e a reserva continua em conferência (a parte espera); a decisão depois nasce definitiva", async () => {
    const x = await disputada();
    const { parteProprietario: D, comissao: C } = await partes(x.reservaId);
    expect(await confirmar(x.l, "perdida", sp("2026-12-10 10:00"), { valorPerdido: TOTAL, liquidoNaoEntrou: 0, debitoEm: "2026-12-09" })).toMatchObject({ ok: true });
    const ch = chavesDaContestacao(x.pagamentoId, x.l.id);
    expect((await naChave(x.l, ch.caixaFinal()))[0]).toMatchObject({ montante: TOTAL, dataCaixa: "2026-12-09" });
    expect(await linha(x.l.id)).toMatchObject({ situacao: "perdida", decisaoVersao: 0, definitivoEm: null });
    const parte = async (quando: Date) => (await partesDoProprietario(db, c.org, c.dono, quando)).find((y) => y.reservaId === x.reservaId && y.origemLancamento === "motor")!;
    expect(await parte(sp("2026-12-11 10:00"))).toMatchObject({ situacao: "a_liberar", contestacaoSemDecisao: true });
    // Sem os definitivos, o caixa da disputa ainda não conta no dinheiro com a empresa.
    expect((await dinheiro(x.reservaId)).recebido).toBe(LIQUIDO);
    const pv = await previaDaDecisao(db, c.org, x.l.id);
    expect(pv.ok && pv.fatos).toMatchObject({ perdida: true, valor: TOTAL, recusa: null });
    await decidir(x.l, "proporcional", sp("2026-12-11 10:00"));
    const { proprietario: px, scl: py } = dividirPerda(TOTAL, D, C)!;
    expect((await naChave(x.l, ch.proprietarioFinal()))[0]).toMatchObject({ valor: -px, competencia: "2026-12-01" });
    expect((await naChave(x.l, ch.sclFinal()))[0]).toMatchObject({ valor: -py, estado: "realizado" });
    expect(await naChave(x.l, ch.proprietario(1))).toEqual([]);
    expect(await naChave(x.l, ch.sclEspelho())).toEqual([]);
    expect(await linha(x.l.id)).toMatchObject({ decisaoVersao: 1, definitivoEm: sp("2026-12-11 10:00") });
    expect((await parte(sp("2026-12-12 10:00"))).contestacaoSemDecisao).toBeFalsy();
    expect(await balanco(x.reservaId)).toEqual({ proprietario: D - px, scl: C - py, caixa: LIQUIDO - TOTAL });
    // A decisão definitiva não muda mais.
    const pv2 = await previaDaDecisao(db, c.org, x.l.id);
    expect(pv2.ok && pv2.fatos.recusa).toBe("A disputa já terminou: corrija com um ajuste, que fica registrado.");
  });
});

describe("duas disputas confirmadas no mesmo pagamento (o teto do pago)", () => {
  it("a perdida leva parte do pago: a outra disputa fica com o resto, e a perda dela não passa do que sobra", async () => {
    const V = 100_000;
    const x = await disputada({ valor: V });
    // Uma segunda contestação no cartão, com o seu caso, confirmada pela equipe como outra disputa.
    const reg = await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, { tipo: "chargeback", abertaEm: "2026-10-20", valor: V, prazo: null, idCaso: "8100000001", nota: "Segunda contestação vista no painel." }, equipe, null, sp("2026-10-20 11:00"));
    if (!reg.ok) throw new Error(reg.erro);
    expect(await confirmarOutraDisputa(db, c.org, reg.contestacaoId, equipe, sp("2026-10-20 12:00"))).toMatchObject({ ok: true });
    expect(await linha(reg.contestacaoId)).toMatchObject({ duplicataPossivel: false, valorEmRisco: TOTAL - V });
    // A primeira perdida (o valor inteiro dela): a segunda continua com o resto do pago, nunca com o valor inteiro de novo.
    expect(await confirmar(x.l, "perdida", sp("2026-10-25 10:00"), { valorPerdido: V, liquidoNaoEntrou: 0, debitoEm: "2026-10-21" })).toMatchObject({ ok: true });
    expect(await linha(reg.contestacaoId)).toMatchObject({ situacao: "aberta", valorEmRisco: TOTAL - V });
    const pv = await previaDoResultado(db, c.org, reg.contestacaoId);
    expect(pv.ok && pv.fatos.proposta.valorPerdido).toBe(TOTAL - V);
    const segunda = await linha(reg.contestacaoId);
    expect(await confirmar(segunda, "perdida", sp("2026-10-26 10:00"), { valorPerdido: V, liquidoNaoEntrou: 0, debitoEm: "2026-10-22" })).toMatchObject({ ok: false, erro: textoPerdaAcimaDoQueSobra(V, TOTAL - V) });
    expect(await confirmar(segunda, "perdida", sp("2026-10-26 10:00"), { valorPerdido: TOTAL - V, liquidoNaoEntrou: 0, debitoEm: "2026-10-22" })).toMatchObject({ ok: true });
    // O dinheiro da reserva nunca perde mais que o pago.
    const d = await dinheiro(x.reservaId);
    expect(d.perdaCoberta ?? 0).toBeLessThanOrEqual(TOTAL);
  });
});

describe("devolução substituída (item 16)", () => {
  it("redução com a devolução da diferença parada: a disputa não cobra a diferença de novo; ganha, a devolução volta a ser devida (e se pede de novo)", async () => {
    const x = await pagarEConfirmar(c, { liberar: true, entrada: "2026-11-20", saida: "2026-11-23" });
    const diferenca = 40_000;
    const { devolucaoIds } = await reduzirDeTeste(c, x, TOTAL - diferenca, { quando: minutos(30) });
    c.provedor.contestar(x.idProvedor);
    await conferir(x.pagamentoId, sp("2026-10-20 10:00"));
    const [l] = await linhas(x.pagamentoId);
    const [d] = await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.id, devolucaoIds[0]));
    expect(d).toMatchObject({ situacao: "recusada", contestacaoId: l.id });
    expect(l).toMatchObject({ valor: TOTAL, valorEmRisco: TOTAL - diferenca });
    const pv = await previaDaDecisao(db, c.org, l.id);
    expect(pv.ok && pv.fatos.valor).toBe(TOTAL - diferenca);
    expect(await confirmar(l, "ganha", sp("2026-10-25 10:00"))).toMatchObject({ ok: true });
    const [devida] = await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.id, d.id));
    expect(devida).toMatchObject({ situacao: "recusada", contestacaoId: l.id });
    expect(devida.avisos).toContain("devolucao_devida_depois_da_disputa");
    expect(devida.avisos).not.toContain("devolucao_parada");
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("devolucao_devida_depois_da_disputa");
    // O quadro diz o valor da devolução devida (sem R$ para quem não lê o financeiro).
    const [quadro] = await pagamentosDaReserva(db, c.org, x.reservaId, sp("2026-10-25 10:30"));
    expect(quadro.avisos).toContain(textoDevolucaoDevidaDepoisDaDisputa(diferenca));
    expect(quadro.avisosSemValores).toContain(textoDevolucaoDevidaDepoisDaDisputa(null));
    // Pedir de novo (o Mercado Pago já mostra a disputa encerrada): pedida, o aviso sai.
    c.provedor.resolverContestacao(x.idProvedor, { estado: "settled", transacaoAprovada: true });
    expect(await devolverPeloProvedor(db, c.org, { devolucaoId: d.id }, equipe, c.provedor, sp("2026-10-25 11:00"))).toMatchObject({ ok: true });
    const [pedida] = await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.id, d.id));
    expect(pedida.avisos).not.toContain("devolucao_devida_depois_da_disputa");
  });

  it("perdida menor que a devolução substituída: confirmada pela disputa pelo valor perdido, com o aviso de a menor; nada a dividir", async () => {
    const x = await pagarEConfirmar(c, { liberar: true, entrada: "2026-11-20", saida: "2026-11-23" });
    const diferenca = 40_000;
    const { devolucaoIds } = await reduzirDeTeste(c, x, TOTAL - diferenca, { quando: minutos(30) });
    c.provedor.contestar(x.idProvedor, "order", { valor: diferenca });
    await conferir(x.pagamentoId, sp("2026-10-20 10:00"));
    const [l] = await linhas(x.pagamentoId);
    expect(l.valorEmRisco).toBe(0);
    expect(await confirmar(l, "perdida", sp("2026-12-10 10:00"), { valorPerdido: 30_000, liquidoNaoEntrou: 0, debitoEm: "2026-12-09", nota: "O painel mostra R$ 300,00 debitados." })).toMatchObject({ ok: true });
    const [d] = await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.id, devolucaoIds[0]));
    expect(d).toMatchObject({ situacao: "confirmada", confirmadaPor: "contestacao", valorConfirmado: 30_000, avisos: expect.arrayContaining(["devolucao_a_menor", "taxa_perdida_desconhecida"]) });
    expect(await linha(l.id)).toMatchObject({ definitivoEm: sp("2026-12-10 10:00") });
  });
});

describe("encerrar sem efeito e conferir o aviso", () => {
  it("sem efeito: espelhos das linhas previstas no mês corrente, o retido realizado volta no dia informado, o pagamento volta a aprovado; repetir não duplica", async () => {
    const x = await disputada();
    await debito(x.l, "2026-10-21", TOTAL);
    await decidir(x.l, "proporcional", sp("2026-10-22 10:00"));
    const { parteProprietario: D, comissao: C } = await partes(x.reservaId);
    expect(await encerrarSemEfeito(db, c.org, x.l.id, { nota: "Registrada por engano.", notaReforcada: false }, equipe, null, sp("2026-11-05 10:00"))).toMatchObject({ ok: false, erro: TEXTO_INFORME_A_VOLTA });
    expect((await linha(x.l.id)).situacao).toBe("aberta");
    expect(await encerrarSemEfeito(db, c.org, x.l.id, { nota: "Registrada por engano.", notaReforcada: false, voltaEm: "2026-11-04" }, equipe, null, sp("2026-11-05 10:00"))).toMatchObject({ ok: true });
    const ch = chavesDaContestacao(x.pagamentoId, x.l.id);
    const [v1] = await naChave(x.l, ch.proprietario(1));
    const [s1] = await naChave(x.l, ch.scl(1));
    expect((await naChave(x.l, ch.semEfeito(v1.id)))[0]).toMatchObject({ valor: -v1.valor, competencia: "2026-11-01", tipo: "direito_proprietario" });
    expect((await naChave(x.l, ch.semEfeito(s1.id)))[0]).toMatchObject({ valor: -s1.valor, competencia: "2026-11-01", tipo: "despesa_empresa", estado: "previsto" });
    expect((await naChave(x.l, ch.volta()))[0]).toMatchObject({ montante: TOTAL, dataCaixa: "2026-11-04" });
    expect(await linha(x.l.id)).toMatchObject({ situacao: "sem_efeito", valorEmRisco: 0, encerradaNota: `Registrada por engano. (${NOTA_SEM_CONFERIR_AGORA})`, definitivoEm: null });
    expect((await c.tentativa(x.pagamentoId)).situacao).toBe("aprovado");
    expect(await balanco(x.reservaId)).toEqual({ proprietario: D, scl: C, caixa: LIQUIDO });
    expect(await encerrarSemEfeito(db, c.org, x.l.id, { nota: "De novo.", notaReforcada: false, voltaEm: "2026-11-04" }, equipe, null, sp("2026-11-05 11:00"))).toMatchObject({ ok: false });
  });

  it("ganha relida em andamento: o aviso de resultado que mudou; 'continua encerrada' limpa; 'foi reaberta' cria a rodada seguinte, que segue o fluxo inteiro", async () => {
    const x = await disputada();
    expect(await confirmar(x.l, "ganha", sp("2026-10-25 10:00"))).toMatchObject({ ok: true });
    // A order continua em andamento: a leitura seguinte contradiz a ganha.
    await conferir(x.pagamentoId, sp("2026-10-26 10:00"));
    expect((await linha(x.l.id)).avisos).toContain("contestacao_resultado_mudou");
    expect(await conferirAviso(db, c.org, x.l.id, { como: "continua_encerrada", nota: "" }, equipe, sp("2026-10-26 11:00"))).toMatchObject({ ok: false });
    expect(await conferirAviso(db, c.org, x.l.id, { como: "continua_encerrada", nota: "O painel continua mostrando ganha." }, equipe, sp("2026-10-26 11:00"))).toMatchObject({ ok: true, contestacaoId: x.l.id });
    expect(await linha(x.l.id)).toMatchObject({ avisoConferidoPor: equipe, avisoConferidoNota: "O painel continua mostrando ganha." });
    expect((await linha(x.l.id)).avisos).not.toContain("contestacao_resultado_mudou");
    // O Mercado Pago volta a mostrar (um fato novo): o aviso volta; desta vez, foi reaberta.
    c.provedor.resolverContestacao(x.idProvedor, { cobertura: false });
    await conferir(x.pagamentoId, sp("2026-10-27 10:00"));
    await db.update(contestacoesPagamento).set({ avisos: ["contestacao_resultado_mudou"] }).where(eq(contestacoesPagamento.id, x.l.id));
    const r = await conferirAviso(db, c.org, x.l.id, { como: "reaberta", nota: "Reapresentação pelo banco." }, equipe, sp("2026-10-27 11:00"));
    expect(r).toMatchObject({ ok: true, mensagem: "A disputa foi reaberta: rodada 2 no quadro." });
    const [ganha, nova] = await linhas(x.pagamentoId);
    expect(ganha).toMatchObject({ id: x.l.id, situacao: "ganha", rodada: 1 });
    expect(nova).toMatchObject({ situacao: "aberta", rodada: 2, origem: "equipe", idCaso: x.idCaso, idContestacao: x.idCbk, decisaoVersao: 0, valorEmRisco: TOTAL });
    expect(r.ok && r.contestacaoId).toBe(nova.id);
    expect((await naChave(nova, chavesDaContestacao(x.pagamentoId, nova.id).retido()))[0]).toMatchObject({ estado: "previsto", montante: TOTAL });
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("contestado");
    expect(await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, c.org), eq(auditoria.acao, "contestacao.reabrir")))).toHaveLength(1);
  });

  it("perdida e a order de novo aprovada, sem disputa listada: o aviso de resultado que mudou na perdida, sem mexer na situação nem no livro; 'continua encerrada' limpa e a mesma leitura não o religa (Codex, 11/10)", async () => {
    const x = await pagarEConfirmar(c, { liberar: true });
    // A contestação só na transação, sem item na lista da order.
    c.provedor.contestar(x.idProvedor, "transacao", { naLista: false });
    await conferir(x.pagamentoId, sp("2026-10-20 10:00"));
    const [l] = await linhas(x.pagamentoId);
    expect(l).toMatchObject({ situacao: "aberta", idCaso: null, idContestacao: null });
    await debito(l, "2026-10-21", TOTAL);
    await decidir(l, "proporcional", sp("2026-10-22 10:00"));
    expect(await confirmar(l, "perdida", sp("2026-12-10 10:00"), { valorPerdido: TOTAL, liquidoNaoEntrou: 0, debitoEm: "2026-10-21" })).toMatchObject({ ok: true });
    const situacao = (await c.tentativa(x.pagamentoId)).situacao;
    const livro = (await daDisputa(l)).map((y) => [y.id, y.valor, y.montante, y.estado]);
    // O Mercado Pago volta a mostrar a transação aprovada, sem nenhuma contestação na order.
    c.provedor.resolverContestacao(x.idProvedor, { transacaoAprovada: true });
    expect(await c.provedor.consultar(x.idProvedor)).toMatchObject({ situacao: "aprovado", transacaoAprovada: true, contestacoes: [] });
    await conferir(x.pagamentoId, sp("2026-12-11 10:00"));
    const depois = await linha(l.id);
    expect(depois.situacao).toBe("perdida");
    expect(depois.avisos).toContain("contestacao_resultado_mudou");
    // A perda definitiva e o livro ficam: a correção é da equipe (aviso, nunca palpite).
    expect((await c.tentativa(x.pagamentoId)).situacao).toBe(situacao);
    expect((await daDisputa(l)).map((y) => [y.id, y.valor, y.montante, y.estado])).toEqual(livro);
    expect(await conferirAviso(db, c.org, l.id, { como: "continua_encerrada", nota: "O painel mostra a disputa perdida." }, equipe, sp("2026-12-11 11:00"))).toMatchObject({ ok: true });
    await conferir(x.pagamentoId, sp("2026-12-12 10:00"));
    expect((await linha(l.id)).avisos).not.toContain("contestacao_resultado_mudou");
  });

  it("depois dos 85 dias, a disputa perdida no cartão: a busca semanal lê também a Payments API; a transação de volta a aprovada liga o aviso, sem a perdida voltar à fila diária (Codex, 11/10)", async () => {
    const x = await disputada();
    await debito(x.l, "2026-10-21", TOTAL);
    await decidir(x.l, "proporcional", sp("2026-10-22 10:00"));
    expect(await confirmar(x.l, "perdida", sp("2026-12-10 10:00"), { valorPerdido: TOTAL, liquidoNaoEntrou: 0, debitoEm: "2026-10-21" })).toMatchObject({ ok: true });
    await envelhecer(c, x.pagamentoId, 100);
    expect((await c.tentativa(x.pagamentoId)).idPagamentoProvedor).not.toBeNull();
    const naPayments = () => c.provedor.chamadas.filter((ch) => ch.metodo === "situacaoDoPagamento").length;
    // A releitura diária não pega a perdida (sem espera crescente nem "sem fonte").
    await conferirContestacoes(db, c.org, c.provedor, sp("2026-12-11 09:00"));
    expect(naPayments()).toBe(0);
    // O Mercado Pago volta a mostrar a transação aprovada.
    c.provedor.resolverContestacao(x.idProvedor, { transacaoAprovada: true });
    const r = await buscarContestacoesTardias(db, c.org, c.provedor, sp("2026-12-11 10:00"));
    expect(r).toMatchObject({ buscados: 1, falhas: 0, mudaram: 1 });
    expect(naPayments()).toBe(1);
    const l = await linha(x.l.id);
    expect(l.situacao).toBe("perdida");
    expect(l.avisos).toContain("contestacao_resultado_mudou");
    expect(l.avisos).not.toContain("contestacao_sem_fonte");
    expect(l.falhasLeitura).toBe(0);
  });
});

describe("cancelar a reserva contestada (item 18)", () => {
  it("só antes da entrada; o valor retido = o pago; sem devolução; a tarefa das OTAs; a página do hóspede em conferência; a assinatura velha recusa", async () => {
    const x = await disputada({ liberar: false, entrada: "2026-11-20", saida: "2026-11-23" });
    const quando = sp("2026-10-21 10:00");
    const pv = await previaDoCancelamentoContestado(db, c.org, x.reservaId, quando);
    if (!pv.ok) throw new Error(pv.erro);
    expect(pv.previa).toMatchObject({ valorPago: TOTAL, valorRetido: TOTAL, disputas: [{ contestacaoId: x.l.id, pagamentoId: x.pagamentoId, valorEmRisco: TOTAL }] });
    expect(pv.previa.pergunta).toContain("sem devolução pelo sistema");
    expect(await cancelarReservaContestada(db, c.org, x.reservaId, { nota: "", assinatura: pv.previa.assinatura }, equipe, c.provedor, quando)).toMatchObject({ ok: false, codigo: "dados" });
    expect(await cancelarReservaContestada(db, c.org, x.reservaId, { nota: "Possível fraude.", assinatura: "velha" }, equipe, c.provedor, quando)).toMatchObject({ ok: false, codigo: "previa_mudou", erro: TEXTO_PREVIA_MUDOU });
    const motorAntes = (await db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, x.reservaId), eq(lancamentos.origem, "motor")))).map((l) => l.id);
    const r = await cancelarReservaContestada(db, c.org, x.reservaId, { nota: "Possível fraude: o titular não reconhece.", assinatura: pv.previa.assinatura }, equipe, c.provedor, quando);
    expect(r).toMatchObject({ ok: true, valorRetido: TOTAL });
    expect(await c.reserva(x.reservaId)).toMatchObject({ estado: "cancelada", valorRetido: TOTAL });
    const [canc] = await db.select().from(cancelamentosReserva).where(eq(cancelamentosReserva.reservaId, x.reservaId));
    expect(canc).toMatchObject({ situacao: "cancelada", quemCancela: "empresa", base: "contestacao", direito: "nenhum", valorADevolver: 0, nota: "Possível fraude: o titular não reconhece." });
    expect(canceladaPelaDisputa(canc)).toBe(true);
    expect(await devolucoes(x.pagamentoId)).toEqual([]);
    expect(c.provedor.chamadas.filter((ch) => ch.metodo === "devolver")).toEqual([]);
    // O valor retido igual ao bruto: o motor divide como antes (nada muda no livro).
    expect((await db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, x.reservaId), eq(lancamentos.origem, "motor")))).map((l) => l.id)).toEqual(motorAntes);
    // A tarefa das OTAs e a página do hóspede.
    expect((await avisosDeCancelamento(db, c.org, quando)).find((a) => a.texto.includes("reabra as datas nas OTAs"))?.texto).toContain(x.reservaCodigo);
    // Sem a mensagem da decisão ao hóspede (nem o aviso de mensagem pendente): numa disputa, a equipe fala caso a caso.
    expect((await avisosDeCancelamento(db, c.org, sp("2026-10-23 10:00"))).some((a) => a.texto.includes("mensagem ao hóspede pendente"))).toBe(false);
    expect((await mensagensDoCancelamento(db, c.org, x.reservaId, quando)).decidido).toBeNull();
    expect((await vistaDaCotacaoParaHospede(db, c.org, x.cotacaoId, quando, { comAutorizacao: true, oferecido: true }))?.estado).toBe("cancelada_em_conferencia");
    expect((await db.select().from(eventosContestacao).where(and(eq(eventosContestacao.contestacaoId, x.l.id), eq(eventosContestacao.tipo, "cancelamento"))))).toHaveLength(1);
    expect(await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, c.org), eq(auditoria.acao, "contestacao.cancelar_reserva")))).toHaveLength(1);
    // A disputa segue: ganha, o retido continua dividido como numa reserva cancelada sem devolução.
    const { parteProprietario: D, comissao: C } = await partes(x.reservaId);
    expect(D + C).toBe(LIQUIDO);
    await decidir(x.l, "proporcional", sp("2026-10-22 10:00"));
    expect(await confirmar(x.l, "ganha", sp("2026-12-10 10:00"))).toMatchObject({ ok: true });
    expect(await balanco(x.reservaId)).toMatchObject({ proprietario: D, scl: C });
    expect((await vistaDaCotacaoParaHospede(db, c.org, x.cotacaoId, sp("2026-12-10 11:00"), { comAutorizacao: true, oferecido: true }))?.estado).toBe("cancelada_sem_devolucao");
  });

  it("depois do horário de entrada, sem disputa com valor em risco ou já cancelada: recusado; perdida depois do cancelamento: a decisão vale sobre o valor perdido", async () => {
    const x = await disputada({ liberar: false });
    expect(await previaDoCancelamentoContestado(db, c.org, x.reservaId, sp("2026-10-21 10:00"))).toMatchObject({ ok: false, codigo: "estadia_iniciada" });
    const semDisputa = await pagarEConfirmar(c, { entrada: "2026-11-20", saida: "2026-11-23" });
    expect(await previaDoCancelamentoContestado(db, c.org, semDisputa.reservaId, sp("2026-10-21 10:00"))).toMatchObject({ ok: false, codigo: "sem_disputa", erro: TEXTO_SEM_DISPUTA_PARA_CANCELAR });
    const y = await disputada({ liberar: false, entrada: "2026-11-02", saida: "2026-11-05" });
    const pv = await previaDoCancelamentoContestado(db, c.org, y.reservaId, sp("2026-10-21 10:00"));
    if (!pv.ok) throw new Error(pv.erro);
    expect(await cancelarReservaContestada(db, c.org, y.reservaId, { nota: "Possível fraude.", assinatura: pv.previa.assinatura }, equipe, null, sp("2026-10-21 10:00"))).toMatchObject({ ok: true });
    expect(await previaDoCancelamentoContestado(db, c.org, y.reservaId, sp("2026-10-21 11:00"))).toMatchObject({ ok: false, codigo: "ja_cancelada" });
    const { parteProprietario: D, comissao: C } = await partes(y.reservaId);
    await decidir(y.l, "proprietario", sp("2026-10-22 10:00"));
    expect(await confirmar(y.l, "perdida", sp("2026-12-10 10:00"), { valorPerdido: TOTAL, liquidoNaoEntrou: LIQUIDO, debitoEm: "2026-12-09" })).toMatchObject({ ok: true });
    expect(await balanco(y.reservaId)).toEqual({ proprietario: D - TOTAL, scl: C, caixa: -TAXA });
  });
});

describe("pagamento sem reserva (item 24)", () => {
  it("perdida: desfecho contestacao; a taxa como despesa da SCL; a devolução substituída confirmada pela disputa (a taxa dela é a da disputa); as ações de devolução param; nada de proprietário", async () => {
    const s = await c.segurar({ entrada: "2026-11-20", saida: "2026-11-23" });
    const pix = await c.pix(s.cotacaoId);
    await db.update(cotacoes).set({ total: TOTAL + 1 }).where(eq(cotacoes.id, s.cotacaoId));
    c.provedor.aprovar(pix.idProvedor, { taxa: TAXA });
    await conferir(pix.pagamentoId, minutos(3));
    expect((await c.tentativa(pix.pagamentoId)).motivoSemReserva).toBe("valor_divergente");
    // A equipe pede a devolução; o Mercado Pago recusa com clareza (nada lá): pedida, sem aceite.
    c.provedor.respostaDevolucao = "saldo_insuficiente";
    expect(await devolverPeloProvedor(db, c.org, pix.pagamentoId, equipe, c.provedor, minutos(10))).toMatchObject({ ok: true });
    c.provedor.contestar(pix.idProvedor);
    await conferir(pix.pagamentoId, sp("2026-10-20 10:00"));
    const [l] = await linhas(pix.pagamentoId);
    expect(l).toMatchObject({ reservaId: null, valorEmRisco: 0 });
    const [dev] = await devolucoes(pix.pagamentoId);
    expect(dev).toMatchObject({ situacao: "recusada", contestacaoId: l.id, origem: "sem_reserva" });
    const pv = await previaDoResultado(db, c.org, l.id);
    expect(pv.ok && pv.fatos).toMatchObject({ semReserva: true, semRecebimento: false, proposta: { valorPerdido: TAXA, liquidoNaoEntrou: 0 } });
    expect(await confirmar(l, "perdida", sp("2026-12-10 10:00"), { valorPerdido: TAXA, debitoEm: "2026-12-09" })).toMatchObject({ ok: true });
    const p = await c.tentativa(pix.pagamentoId);
    expect(p).toMatchObject({ desfecho: "contestacao", desfechoPor: equipe });
    const [taxa] = await naChave(l, chavesDaContestacao(pix.pagamentoId, l.id).taxa());
    expect(taxa).toMatchObject({ tipo: "despesa_empresa", valor: -TAXA, montante: TAXA, estado: "realizado", dataCaixa: "2026-12-09", reservaId: null, imovelId: c.imovel });
    expect((await daDisputa(l)).map((x) => x.tipo)).toEqual(["despesa_empresa"]);
    const [confirmada] = await devolucoes(pix.pagamentoId);
    expect(confirmada).toMatchObject({ situacao: "confirmada", confirmadaPor: "contestacao", valorConfirmado: TOTAL, taxaPerdida: TAXA, despesaLancamentoId: taxa.id });
    expect(confirmada.avisos).not.toContain("taxa_perdida_desconhecida");
    expect(await linha(l.id)).toMatchObject({ situacao: "perdida", definitivoEm: sp("2026-12-10 10:00") });
    // As ações de devolução desse pagamento param.
    expect(await devolverPeloProvedor(db, c.org, pix.pagamentoId, equipe, c.provedor, sp("2026-12-11 10:00"))).toMatchObject({ ok: false });
    expect(await devolverPeloProvedor(db, c.org, { devolucaoId: dev.id }, equipe, c.provedor, sp("2026-12-11 10:00"))).toMatchObject({ ok: false });
  });

  it("duas disputas perdidas no mesmo pagamento sem reserva: a taxa é perdida uma vez só; o custo do parcelamento já está dentro dela (Codex, 11/10)", async () => {
    const s = await c.segurar({ entrada: "2026-11-20", saida: "2026-11-23" });
    const pix = await c.pix(s.cotacaoId);
    await db.update(cotacoes).set({ total: TOTAL + 1 }).where(eq(cotacoes.id, s.cotacaoId));
    c.provedor.aprovar(pix.idProvedor, { taxa: TAXA });
    await conferir(pix.pagamentoId, minutos(3));
    expect((await c.tentativa(pix.pagamentoId)).motivoSemReserva).toBe("valor_divergente");
    // O custo do parcelamento cobrado da SCL já está dentro da taxa (`financeiroDoPagamento`): não soma ao teto.
    await db.update(pagamentos).set({ custoParcelasVendedor: 500 }).where(eq(pagamentos.id, pix.pagamentoId));
    const med = await registrarContestacaoDaEquipe(db, c.org, pix.pagamentoId, { tipo: "med", abertaEm: "2026-10-20", valor: TOTAL, prazo: null, idCaso: null, nota: "MED visto no painel." }, equipe, null, sp("2026-10-20 10:00"));
    if (!med.ok) throw new Error(med.erro);
    const rec = await registrarContestacaoDaEquipe(db, c.org, pix.pagamentoId, { tipo: "reclamacao", abertaEm: "2026-10-20", valor: TOTAL, prazo: null, idCaso: "8100000002", nota: "Reclamação vista no painel." }, equipe, null, sp("2026-10-20 11:00"));
    if (!rec.ok) throw new Error(rec.erro);
    expect(await confirmarOutraDisputa(db, c.org, rec.contestacaoId, equipe, sp("2026-10-20 12:00"))).toMatchObject({ ok: true });
    expect(await confirmar({ id: med.contestacaoId }, "perdida", sp("2026-12-10 10:00"), { valorPerdido: TAXA + 500, debitoEm: "2026-12-09" })).toMatchObject({ ok: false, erro: textoPerdaSemReservaAcimaDaTaxa(TAXA + 500, TAXA) });
    expect(await confirmar({ id: med.contestacaoId }, "perdida", sp("2026-12-10 10:00"), { valorPerdido: TAXA, debitoEm: "2026-12-09" })).toMatchObject({ ok: true });
    // A segunda: a taxa já foi perdida pela primeira; a proposta é zero e um valor acima é recusado.
    const pv = await previaDoResultado(db, c.org, rec.contestacaoId);
    expect(pv.ok && pv.fatos.proposta.valorPerdido).toBe(0);
    expect(await confirmar({ id: rec.contestacaoId }, "perdida", sp("2026-12-11 10:00"), { valorPerdido: TAXA, debitoEm: "2026-12-10" })).toMatchObject({ ok: false, erro: textoPerdaSemReservaAcimaDaTaxa(TAXA, 0, TAXA) });
    expect(await confirmar({ id: rec.contestacaoId }, "perdida", sp("2026-12-11 10:00"), { valorPerdido: 0, debitoEm: "2026-12-10" })).toMatchObject({ ok: true });
    // Uma despesa de taxa só, a da primeira disputa (a segunda perdeu zero).
    const taxaDe = (id: string) => naChave({ pagamentoId: pix.pagamentoId, id }, chavesDaContestacao(pix.pagamentoId, id).taxa());
    expect((await taxaDe(med.contestacaoId)).map((x) => x.montante)).toEqual([TAXA]);
    expect(await taxaDe(rec.contestacaoId)).toEqual([]);
  });

  it("ganha: a devolução sem reserva substituída volta a ser devida; registro da equipe e duplicata confirmada como outra disputa também valem", async () => {
    const s = await c.segurar({ entrada: "2026-11-20", saida: "2026-11-23" });
    const pix = await c.pix(s.cotacaoId);
    await db.update(cotacoes).set({ total: TOTAL + 1 }).where(eq(cotacoes.id, s.cotacaoId));
    c.provedor.aprovar(pix.idProvedor, { taxa: TAXA });
    await conferir(pix.pagamentoId, minutos(3));
    c.provedor.respostaDevolucao = "saldo_insuficiente";
    expect(await devolverPeloProvedor(db, c.org, pix.pagamentoId, equipe, c.provedor, minutos(10))).toMatchObject({ ok: true });
    const reg = await registrarContestacaoDaEquipe(db, c.org, pix.pagamentoId, { tipo: "med", abertaEm: "2026-10-20", valor: TOTAL, prazo: null, idCaso: null, nota: "MED visto no painel." }, equipe, null, sp("2026-10-20 10:00"));
    if (!reg.ok) throw new Error(reg.erro);
    expect(await confirmar({ id: reg.contestacaoId }, "ganha", sp("2026-10-30 10:00"))).toMatchObject({ ok: true });
    const [dev] = await devolucoes(pix.pagamentoId);
    expect(dev).toMatchObject({ situacao: "recusada", contestacaoId: reg.contestacaoId });
    expect(dev.avisos).toContain("devolucao_devida_depois_da_disputa");
    expect((await c.tentativa(pix.pagamentoId)).desfecho).toBeNull();
  });
});
