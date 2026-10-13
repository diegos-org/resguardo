/**
 * Contestação do pagamento no site (M8.2e) — a revisão do domínio (11/10/2026): cada achado da auditoria com o teste que o
 * mostrava e passa com a correção, em PGlite com o Mercado Pago falso (sem rede). A leitura e a rotina (a ambígua, a
 * oscilação, o conflito entre as fontes, o dia 85 sem fonte, os avisos que voltam a sair, a busca tardia), as ações da
 * equipe com a trava ocupada, a disputa nova depois de uma sem efeito, os avisos da liberação e o dinheiro (a devolução em
 * dúvida, o MED lido depois, o restante da devolução confirmada pela disputa, a nota do débito, a liberação depois da
 * perdida, "Cancelar a reserva contestada" depois de uma redução, a disputa de parte do valor, a taxa que não voltou, o MED
 * acima do devolvido, o pagamento sem reserva e as datas de caixa).
 */
import { and, asc, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { contestacoesPagamento, cotacoes, devolucoesPagamento, eventosContestacao, lancamentos, pagamentos, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import * as travaDoMotor from "@/financeiro/trava";
import { hojeISO } from "@/lib/datas";
import { dinheiroComAEmpresa, recebidoPorReserva } from "@/repasses/recebimentos";
import { cancelarReservaContestada, previaDoCancelamentoContestado } from "./cancelamento";
import { conferirTentativa } from "./conferencia";
import {
  buscarContestacoesTardias,
  conferirAviso,
  conferirContestacoes,
  conferirContestacoesDoPagamento,
  confirmarDebito,
  confirmarResultado,
  type EntradaResultado,
  encerrarSemEfeito,
  previaDaDecisao,
  previaDoResultado,
  registrarContestacaoDaEquipe,
  registrarDecisao,
} from "./contestacao";
import * as acerto from "./contestacao-acerto";
import { disputaDoPagamento, type QuemArcaContestacao, TEXTO_LIDA_PODE_SER_RECLAMACAO, textoDaOrigemDaContestacao } from "./contestacao-regras";
import { acoesDaDevolucao, pedirRestanteDaDevolucao, registrarDevolucaoPorFora, registrarTaxaPerdida, tentarDevolucao } from "./devolucao";
import { registrarLiberacaoManual } from "./liberacao";
import { ErroProvedor, type ProvedorPagamento } from "./provedor";
import { lerCotacaoSemTravar, type Contestacao } from "./travas";
import { type Cenario, cancelar, entradaPadrao, envelhecer, minutos, montarCenario, pagarEConfirmar, reduzirDeTeste, TOTAL, usuarioDeTeste } from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario, equipe: string;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
  c = await montarCenario(db);
  equipe = await usuarioDeTeste(c);
});

const TAXA = 1824;
const LIQUIDO = TOTAL - TAXA;
const DIA = 86_400_000;
const dias = (n: number) => new Date(minutos(0).getTime() + n * DIA);
const sp = (dataHora: string) => new Date(`${dataHora.replace(" ", "T")}:00-03:00`);
const conferir = (id: string, quando: Date) => conferirTentativa(db, c.org, id, c.provedor, quando, { origem: "rotina", forcar: true });
const linhas = (pagamentoId: string) =>
  db.select().from(contestacoesPagamento).where(eq(contestacoesPagamento.pagamentoId, pagamentoId)).orderBy(asc(contestacoesPagamento.criadoEm), asc(contestacoesPagamento.rodada), asc(contestacoesPagamento.id));
const linha = async (id: string) => (await db.select().from(contestacoesPagamento).where(eq(contestacoesPagamento.id, id)))[0];
const daDisputa = (l: Pick<Contestacao, "pagamentoId" | "id">) =>
  db.select().from(lancamentos).where(like(lancamentos.chaveOrigem, `mercadopago:${l.pagamentoId}:contestacao:${l.id}:%`)).orderBy(asc(lancamentos.criadoEm), asc(lancamentos.chaveOrigem));
const estornados = async (ids: string[]) => new Set((await db.select({ de: lancamentos.estornoDe }).from(lancamentos)).map((x) => x.de).filter((x): x is string => !!x && ids.includes(x)));

/** A primeira transação aberta falha como a trava ocupada (55P03); as seguintes vão ao banco. */
const ocupadoUmaVez = () => {
  let falhar = true;
  return new Proxy(db, {
    get(alvo, k, r) {
      if (k === "transaction" && falhar)
        return async () => {
          falhar = false;
          throw Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });
        };
      const v = Reflect.get(alvo, k, r);
      return typeof v === "function" ? v.bind(alvo) : v;
    },
  }) as Db;
};

async function decidir(l: Pick<Contestacao, "id">, quemArca: QuemArcaContestacao, quando: Date, causa = "imovel") {
  const pv = await previaDaDecisao(db, c.org, l.id);
  if (!pv.ok) throw new Error(pv.erro);
  const r = await registrarDecisao(db, c.org, l.id, { causa, quemArca, nota: "Decisão da equipe.", explicacao: "", versao: pv.fatos.versao, assinatura: pv.fatos.opcoes[quemArca]?.assinatura ?? "" }, equipe, quando);
  if (!r.ok) throw new Error(r.erro);
}

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

/** O que cada lado ficou da reserva pelo livro inteiro (os estornos se anulam) e o caixa (recebimentos menos saídas, realizados). */
async function balanco(reservaId: string) {
  const ls = await db.select().from(lancamentos).where(and(eq(lancamentos.organizacaoId, c.org), eq(lancamentos.reservaId, reservaId)));
  const soma = (tipos: string[]) => ls.filter((l) => tipos.includes(l.tipo)).reduce((s, l) => s + l.valor, 0);
  const caixa = ls
    .filter((l) => (l.tipo === "recebimento" || l.tipo === "devolucao") && (l.estado === "realizado" || l.estado === "conciliado"))
    .reduce((s, l) => s + (l.tipo === "recebimento" ? 1 : -1) * (l.montante ?? 0), 0);
  // As despesas pagas (com data de caixa) também tiram dinheiro do caixa.
  const despesasPagas = ls.filter((l) => l.tipo === "despesa_empresa" && l.dataCaixa !== null && l.estado !== "previsto").reduce((s, l) => s + (l.montante ?? 0), 0);
  return { proprietario: soma(["direito_proprietario"]), scl: soma(["comissao", "despesa_empresa"]), caixa: caixa - despesasPagas };
}

// ---------------------------------------------------------------- a leitura e a rotina

describe("contestacao_ambigua só sai pela order ou pelo registro da equipe (achados 1 e 25)", () => {
  it("a order liga a ambígua; a rotina relê a order e os casos que casam pela Chargebacks API: o aviso fica", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    c.provedor.contestar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(10));
    // A order passa a mostrar também a disputa B, já encerrada e com um número que o sistema nunca viu.
    const b = c.provedor.contestar(x.idProvedor);
    c.provedor.resolverContestacao(b.idCaso, { estado: "settled" });
    await conferir(x.pagamentoId, minutos(20));
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("contestacao_ambigua");
    await conferirContestacoes(db, c.org, c.provedor, dias(2), { forcar: true });
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("contestacao_ambigua");
    expect(await linhas(x.pagamentoId)).toHaveLength(1);
  });

  it("duas disputas abertas e a order sem a lista (sem identificação): a Chargebacks API casando os dois casos não apaga o aviso", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    c.provedor.contestar(x.idProvedor, "transacao");
    await conferir(x.pagamentoId, minutos(10));
    c.provedor.contestar(x.idProvedor, "transacao");
    await conferir(x.pagamentoId, minutos(20));
    const casos = (c.provedor as unknown as { casos: { naLista: boolean }[] }).casos;
    for (const k of casos) k.naLista = false;
    await conferir(x.pagamentoId, dias(1));
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("contestacao_ambigua");
    await conferirContestacoes(db, c.org, c.provedor, dias(3));
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("contestacao_ambigua");
  });
});

describe("a_confirmar volta a aberta só com in_process do mesmo caso (achado 2)", () => {
  it("a order encerrada e o caso ainda sem cobertura: a linha fica a_confirmar, sem oscilar nem ligar o resultado que mudou", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    const ids = c.provedor.contestar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(10));
    c.provedor.resolverContestacao(ids.idCaso, { estado: "settled", cobertura: null });
    const historico: string[] = [];
    for (const d of [2, 3, 4, 5]) {
      await conferirContestacoes(db, c.org, c.provedor, dias(d), { forcar: true });
      const [l] = await linhas(x.pagamentoId);
      historico.push(`${l.situacao}:${l.estadoLido}:${l.avisos.includes("contestacao_resultado_mudou")}`);
    }
    expect(historico).toEqual(["a_confirmar:settled:false", "a_confirmar:settled:false", "a_confirmar:settled:false", "a_confirmar:settled:false"]);
    const [l] = await linhas(x.pagamentoId);
    const evs = await db.select().from(eventosContestacao).where(and(eq(eventosContestacao.contestacaoId, l.id), eq(eventosContestacao.tipo, "estado_lido")));
    expect(evs.filter((e) => e.depois?.situacao !== undefined).map((e) => `${e.antes?.situacao}->${e.depois?.situacao}`)).toEqual(["aberta->a_confirmar"]);
  });

  it("a order de novo em in_process do mesmo caso reabre (uma vez)", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    const ids = c.provedor.contestar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(10));
    c.provedor.resolverContestacao(ids.idCaso, { estado: "settled" });
    await conferir(x.pagamentoId, dias(1));
    expect((await linhas(x.pagamentoId))[0].situacao).toBe("a_confirmar");
    c.provedor.resolverContestacao(ids.idCaso, { estado: "in_process" });
    await conferir(x.pagamentoId, dias(2));
    expect((await linhas(x.pagamentoId))[0]).toMatchObject({ situacao: "aberta", avisos: expect.arrayContaining(["contestacao_resultado_mudou"]) });
  });
});

describe("fontes que divergem no encerramento ligam contestacao_leitura_conflitante (achado 3)", () => {
  it("a order reimbursed e o caso com a cobertura true, pela rotina e pelo 'Conferir agora'", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    const ids = c.provedor.contestar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(10));
    c.provedor.resolverContestacao(ids.idCaso, { estado: "reimbursed", cobertura: true });
    await conferirContestacoes(db, c.org, c.provedor, dias(2), { forcar: true });
    expect((await linhas(x.pagamentoId))[0]).toMatchObject({ estadoLido: "reimbursed", coberturaAplicada: true, avisos: expect.arrayContaining(["contestacao_leitura_conflitante"]) });
    // Outro pagamento, pelo "Conferir agora" do quadro.
    const y = await pagarEConfirmar(c, { forma: "cartao", entrada: "2026-11-02", saida: "2026-11-05" });
    const idsY = c.provedor.contestar(y.idProvedor);
    await conferir(y.pagamentoId, minutos(10));
    c.provedor.resolverContestacao(idsY.idCaso, { estado: "reimbursed", cobertura: true });
    await conferir(y.pagamentoId, dias(3));
    await conferirContestacoesDoPagamento(db, c.org, y.pagamentoId, c.provedor, dias(3));
    expect((await linhas(y.pagamentoId))[0].avisos).toContain("contestacao_leitura_conflitante");
  });
});

describe("dia 85 sem fonte também com falhas seguidas (achado 6) e os avisos de leitura que saem (achado 24)", () => {
  it("depois dos 85 dias, a Chargebacks API falhando sempre e a Payments API sem resposta: contestacao_sem_fonte na terceira falha seguida", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    c.provedor.contestar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(10));
    await envelhecer(c, x.pagamentoId, 90);
    c.provedor.respostaChargebacks.consultarContestacao = "falha";
    c.provedor.situacaoAusente = true;
    const r: string[] = [];
    for (const d of [2, 10, 30]) {
      await conferirContestacoes(db, c.org, c.provedor, dias(d), { forcar: true });
      const [l] = await linhas(x.pagamentoId);
      r.push(`${l.falhasLeitura}:${l.avisos.includes("contestacao_sem_fonte")}`);
    }
    expect(r).toEqual(["1:false", "2:false", "3:true"]);
  });

  it("contestacao_sem_leitura sai quando a Chargebacks API volta a responder; contestacao_sem_fonte sai com uma resposta útil", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    const ids = c.provedor.contestar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(10));
    c.provedor.respostaChargebacks.consultarContestacao = "403";
    await conferirContestacoes(db, c.org, c.provedor, dias(2));
    expect((await linhas(x.pagamentoId))[0].avisos).toContain("contestacao_sem_leitura");
    c.provedor.respostaChargebacks.consultarContestacao = null;
    c.provedor.resolverContestacao(ids.idCaso, { estado: "in_process", cobertura: null });
    await conferirContestacoes(db, c.org, c.provedor, dias(4));
    expect((await linhas(x.pagamentoId))[0].avisos).not.toContain("contestacao_sem_leitura");
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("contestacao_sem_leitura");
    // Sem fonte depois dos 85 dias (o caso some da API e a Payments API não responde) e, depois, o caso responde de novo.
    await envelhecer(c, x.pagamentoId, 90);
    c.provedor.respostaChargebacks.consultarContestacao = "404";
    c.provedor.situacaoAusente = true;
    await conferirContestacoes(db, c.org, c.provedor, dias(6), { forcar: true });
    expect((await linhas(x.pagamentoId))[0].avisos).toContain("contestacao_sem_fonte");
    c.provedor.respostaChargebacks.consultarContestacao = null;
    await conferirContestacoes(db, c.org, c.provedor, dias(8), { forcar: true });
    expect((await linhas(x.pagamentoId))[0].avisos).not.toContain("contestacao_sem_fonte");
  });
});

describe("busca tardia (achados 19 e 20)", () => {
  it("a trava ocupada depois da chamada devolve a vez: a disputa achada entra na volta seguinte", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    const numero = (await c.tentativa(x.pagamentoId)).idPagamentoProvedor!;
    await envelhecer(c, x.pagamentoId, 100);
    c.provedor.contestarTarde(numero, { valor: 40_000 });
    const r1 = await buscarContestacoesTardias(ocupadoUmaVez(), c.org, c.provedor, minutos(30));
    expect(r1).toMatchObject({ buscados: 1, falhas: 1, novas: 0 });
    expect((await c.tentativa(x.pagamentoId)).contestacoesBuscadasEm).toBeNull();
    expect(await buscarContestacoesTardias(db, c.org, c.provedor, dias(1))).toMatchObject({ buscados: 1, novas: 1 });
  });

  it("pagamentos já fora da janela não ocupam a fila: o da janela é buscado de novo na semana dele", async () => {
    const agora = minutos(30);
    const modeloP = await pagarEConfirmar(c, { forma: "cartao" });
    const x = await pagarEConfirmar(c, { forma: "cartao", entrada: "2026-11-02", saida: "2026-11-05", email: "y@example.com" });
    await envelhecer(c, x.pagamentoId, 100);
    const numero = (await c.tentativa(x.pagamentoId)).idPagamentoProvedor!;
    await db.update(pagamentos).set({ contestacoesBuscadasEm: new Date(agora.getTime() - 8 * DIA) }).where(eq(pagamentos.id, x.pagamentoId));
    await db.update(reservas).set({ checkin: "2025-12-01", checkout: "2025-12-05" }).where(eq(reservas.id, modeloP.reservaId));
    const [modelo] = await db.select().from(pagamentos).where(eq(pagamentos.id, modeloP.pagamentoId));
    const { id: _id, ...resto } = modelo;
    void _id;
    for (let i = 0; i < 200; i++)
      await db.insert(pagamentos).values({
        ...resto,
        referencia: `clone-${i}`,
        idProvedor: null,
        desfecho: "devolucao",
        situacao: "devolvido",
        idPagamentoProvedor: String(900000 + i),
        aprovadoEm: new Date(agora.getTime() - 300 * DIA),
        contestacoesBuscadasEm: new Date(agora.getTime() - 101 * DIA),
      });
    await db.update(pagamentos).set({ aprovadoEm: new Date(agora.getTime() - 300 * DIA), contestacoesBuscadasEm: new Date(agora.getTime() - 101 * DIA) }).where(eq(pagamentos.id, modeloP.pagamentoId));
    c.provedor.contestarTarde(numero, { valor: 40_000 });
    expect(await buscarContestacoesTardias(db, c.org, c.provedor, agora)).toMatchObject({ buscados: 1, novas: 1 });
    expect(await linhas(x.pagamentoId)).toHaveLength(1);
  });
});

describe("fase 0 com a trava ocupada segue sem a leitura (achado 21)", () => {
  it("o resultado, o sem efeito e o registro da equipe seguem com a nota de sem leitura", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    c.provedor.contestar(x.idProvedor, "order");
    await conferir(x.pagamentoId, sp("2026-10-20 10:00"));
    const [l] = await linhas(x.pagamentoId);
    const reg = await registrarContestacaoDaEquipe(ocupadoUmaVez(), c.org, x.pagamentoId, { tipo: "chargeback", abertaEm: "2026-10-20", valor: 1000, prazo: null, idCaso: null, nota: "Vista no painel" }, equipe, c.provedor, sp("2026-10-25 09:00"));
    expect(reg).toMatchObject({ ok: true });
    const segunda = (await linhas(x.pagamentoId)).find((y) => y.id !== l.id)!;
    expect(segunda.notaRegistro).toContain("sem leitura do Mercado Pago");
    // A Chargebacks API mostra o caso da primeira em andamento: a nota reforçada (a leitura da order não deu).
    expect(await encerrarSemEfeito(ocupadoUmaVez(), c.org, segunda.id, { nota: "Duplicata da primeira.", notaReforcada: true }, equipe, c.provedor, sp("2026-10-25 09:30"))).toMatchObject({ ok: true });
    expect((await linha(segunda.id)).encerradaNota).toContain("não deu para conferir");
    const pv = await previaDoResultado(db, c.org, l.id);
    if (!pv.ok) throw new Error(pv.erro);
    const e = { resultado: "ganha", data: "2026-10-25", nota: "Conferido no painel.", notaReforcada: true, versao: pv.fatos.versao, assinatura: pv.fatos.assinatura, tarifa: null };
    expect(await confirmarResultado(ocupadoUmaVez(), c.org, l.id, e, equipe, c.provedor, sp("2026-10-25 10:00"))).toMatchObject({ ok: true });
    expect((await linha(l.id)).resultadoNota).toContain("não deu para conferir");
  });
});

describe("uma disputa nova lida sem número depois de uma sem efeito (achado 17)", () => {
  it("nasce a linha nova (o pagamento volta a contestado e segura as devoluções); a sem efeito fica como está", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    expect(await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, { tipo: "chargeback", abertaEm: "2026-10-10", valor: 10_000, prazo: "2026-10-30", idCaso: null, nota: "Vista no painel" }, equipe, null, sp("2026-10-10 10:00"))).toMatchObject({ ok: true });
    const [a] = await linhas(x.pagamentoId);
    expect(await encerrarSemEfeito(db, c.org, a.id, { nota: "Registrada por engano.", notaReforcada: false }, equipe, null, sp("2026-10-11 10:00"))).toMatchObject({ ok: true });
    c.provedor.contestar(x.idProvedor, "transacao", { naLista: false });
    await conferir(x.pagamentoId, sp("2026-10-15 10:00"));
    const ls = await linhas(x.pagamentoId);
    expect(ls.map((l) => l.situacao)).toEqual(["sem_efeito", "aberta"]);
    expect(ls[0].avisos).not.toContain("contestacao_resultado_mudou");
    const p = await c.tentativa(x.pagamentoId);
    expect(p.situacao).toBe("contestado");
    expect(p.avisos).toContain("contestado");
    expect(disputaDoPagamento({ contestacoes: ls }, x.pagamentoId)).toBe("em_curso");
    expect(ls[1]).toMatchObject({ valorEmRisco: TOTAL, situacaoPagamentoAntes: "aprovado" });
  });
});

describe("os avisos de liberação da disputa saem com a liberação (achado 18)", () => {
  it("ganha sem recebimento: a liberação lida depois lança o recebimento e desliga o aviso", async () => {
    const x = await pagarEConfirmar(c, { liberar: false });
    const ids = c.provedor.contestar(x.idProvedor, "order");
    await conferir(x.pagamentoId, sp("2026-10-20 10:00"));
    const [l] = await linhas(x.pagamentoId);
    expect(await confirmar(l, "ganha", sp("2026-10-25 10:00"))).toMatchObject({ ok: true });
    expect((await linha(l.id)).avisos).toContain("contestacao_ganha_sem_recebimento");
    c.provedor.resolverContestacao(ids.idCaso, { estado: "settled", cobertura: true, transacaoAprovada: true });
    c.provedor.atualizarFinanceiro(x.idProvedor, { liberado: true, taxa: TAXA, liquido: LIQUIDO, liberacaoPrevista: sp("2026-10-26 09:00") });
    await conferir(x.pagamentoId, sp("2026-10-26 10:00"));
    expect(await db.select().from(lancamentos).where(like(lancamentos.chaveOrigem, `mercadopago:${x.pagamentoId}:recebimento%`))).toHaveLength(1);
    expect((await linha(l.id)).avisos).not.toContain("contestacao_ganha_sem_recebimento");
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("contestacao_ganha_sem_recebimento");
  });

  it("MED num Pix já liberado à mão: a liberação lida não liga contestacao_liberacao_lida (o recebimento já está no livro)", async () => {
    const x = await pagarEConfirmar(c, { liberar: true });
    const p0 = await c.tentativa(x.pagamentoId);
    expect(await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, { tipo: "med", abertaEm: hojeISO("America/Sao_Paulo", dias(1)), valor: 10_000, prazo: null, idCaso: null, nota: "MED visto no painel" }, equipe, null, dias(1))).toMatchObject({ ok: true });
    c.provedor.atualizarFinanceiro(x.idProvedor, { liberado: true, taxa: p0.taxa, liquido: p0.liquido, liberacaoPrevista: dias(1) });
    await conferir(x.pagamentoId, dias(2));
    expect((await linhas(x.pagamentoId))[0].avisos).not.toContain("contestacao_liberacao_lida");
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("contestacao_liberacao_lida");
  });
});

describe("'Conferir o aviso → reaberta' com outra disputa sem número aberta (achado 22)", () => {
  it("recusa com texto próprio, sem o 23505 cru", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    const reg = (quando: string) => registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, { tipo: "chargeback", abertaEm: "2026-10-10", valor: 10_000, prazo: "2026-10-30", idCaso: null, nota: "Vista no painel do Mercado Pago" }, equipe, null, sp(quando));
    expect(await reg("2026-10-10 10:00")).toMatchObject({ ok: true });
    const [a] = await linhas(x.pagamentoId);
    expect(await confirmar(a, "ganha", sp("2026-10-12 10:00"))).toMatchObject({ ok: true });
    c.provedor.contestar(x.idProvedor, "transacao", { naLista: false });
    await conferir(x.pagamentoId, sp("2026-10-15 10:00"));
    expect(await reg("2026-10-16 10:00")).toMatchObject({ ok: true });
    const r = await conferirAviso(db, c.org, a.id, { como: "reaberta", nota: "Reapresentação no painel." }, equipe, sp("2026-10-17 10:00"));
    expect(r).toMatchObject({ ok: false, codigo: "nao_permitida" });
    expect(r.ok === false && r.erro).toMatch(/outra disputa sem número/);
  });
});

describe("a decisão trava o motor antes de ler as partes efetivas (achado 23)", () => {
  it("travarMotorDaReserva vem antes de partesEfetivasDaReserva em 'Registrar quem arca'", async () => {
    const x = await pagarEConfirmar(c, { liberar: true });
    c.provedor.contestar(x.idProvedor, "order");
    await conferir(x.pagamentoId, sp("2026-10-20 10:00"));
    const [l] = await linhas(x.pagamentoId);
    const pv = await previaDaDecisao(db, c.org, l.id);
    if (!pv.ok) throw new Error(pv.erro);
    const ordem: string[] = [];
    const travarDeVerdade = travaDoMotor.travarMotorDaReserva;
    const partesDeVerdade = acerto.partesEfetivasDaReserva;
    const t = vi.spyOn(travaDoMotor, "travarMotorDaReserva").mockImplementation(async (...a) => {
      ordem.push("motor");
      return travarDeVerdade(...a);
    });
    const p = vi.spyOn(acerto, "partesEfetivasDaReserva").mockImplementation(async (...a) => {
      ordem.push("partes");
      return partesDeVerdade(...a);
    });
    try {
      const r = await registrarDecisao(db, c.org, l.id, { causa: "imovel", quemArca: "proprietario", nota: "Decisão.", explicacao: "", versao: 0, assinatura: pv.fatos.opcoes.proprietario!.assinatura }, equipe, sp("2026-10-21 10:00"));
      expect(r).toMatchObject({ ok: true });
    } finally {
      t.mockRestore();
      p.mockRestore();
    }
    expect(ordem.indexOf("motor")).toBeGreaterThanOrEqual(0);
    expect(ordem.indexOf("motor")).toBeLessThan(ordem.indexOf("partes"));
  });
});

describe("a leitura que pode ser uma reclamação (achado 9)", () => {
  it("a linha de origem leitura diz que pode ser uma reclamação no Mercado Pago (mediação); a da equipe, que foi registrada à mão", () => {
    expect(textoDaOrigemDaContestacao({ origem: "leitura" })).toBe(TEXTO_LIDA_PODE_SER_RECLAMACAO);
    expect(TEXTO_LIDA_PODE_SER_RECLAMACAO).toMatch(/reclamação no Mercado Pago \(mediação\).*não tem como separar/);
    expect(textoDaOrigemDaContestacao({ origem: "equipe" })).toMatch(/registrada à mão/);
  });
});

// ---------------------------------------------------------------- o dinheiro

describe("a devolução com a chave em dúvida não para quando a disputa abre (achado 4)", () => {
  it("só relê e espera: continua pedida, em dúvida, sem novo envio nem devolucao_parada", async () => {
    const x = await pagarEConfirmar(c, { entrada: "2026-11-20", saida: "2026-11-23" });
    c.provedor.falhas.devolver = new ErroProvedor("incerto", "sem resposta");
    await cancelar(c, x.reservaId, entradaPadrao({ recebidoEm: minutos(30), canal: "whatsapp", nota: "WhatsApp" }), equipe, minutos(60));
    const [d0] = await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.pagamentoId, x.pagamentoId));
    expect(d0).toMatchObject({ situacao: "pedida", chaveEmDuvida: true });
    c.provedor.falhas.devolver = null;
    c.provedor.contestar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(70));
    const enviosAntes = c.provedor.chamadas.filter((y) => y.metodo === "devolver").length;
    expect(await tentarDevolucao(db, c.org, d0.id, c.provedor, minutos(90))).toBe("pedida");
    const [d1] = await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.id, d0.id));
    expect(d1).toMatchObject({ situacao: "pedida", chaveEmDuvida: true, contestacaoId: null });
    expect(d1.avisos).not.toContain("devolucao_parada");
    expect(c.provedor.chamadas.filter((y) => y.metodo === "devolver").length).toBe(enviosAntes);
  });
});

describe("o MED registrado antes de a leitura mostrar a devolução (achado 5)", () => {
  it("a leitura que vê a devolução troca o retido previsto pelo realizado, no dia em que a viu", async () => {
    const x = await pagarEConfirmar(c);
    expect(await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, { tipo: "med", abertaEm: "2026-10-01", valor: TOTAL, prazo: "2026-10-10", idCaso: null, nota: "MED aberto no painel" }, equipe, c.provedor, minutos(20))).toMatchObject({ ok: true });
    const [l] = await linhas(x.pagamentoId);
    c.provedor.devolverNoProvedor(x.idProvedor, TOTAL);
    await conferir(x.pagamentoId, minutos(40));
    const ls = await daDisputa(l);
    const est = await estornados(ls.map((y) => y.id));
    const vigentes = ls.filter((y) => !est.has(y.id) && !y.estornoDe);
    expect(vigentes.map((y) => [y.tipo, y.estado, y.montante, y.dataCaixa])).toEqual([["devolucao", "realizado", TOTAL, "2026-10-01"]]);
    expect((await linha(l.id)).retidoLancamentoId).toBe(vigentes[0].id);
    // Uma releitura não lança de novo.
    await conferir(x.pagamentoId, minutos(50));
    expect((await daDisputa(l)).filter((y) => y.estado === "realizado")).toHaveLength(1);
  });
});

describe("o MED registrado acima do devolvido lido (achado 14)", () => {
  it("o retido realizado fica no que o Mercado Pago mostra devolvido; o restante entra no caixa final se ele debitar", async () => {
    const x = await pagarEConfirmar(c);
    c.provedor.devolverNoProvedor(x.idProvedor, 50_000);
    await conferir(x.pagamentoId, minutos(10));
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("devolvido_por_fora");
    const r = await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, { tipo: "med", abertaEm: "2026-10-01", valor: TOTAL, prazo: "2026-10-10", idCaso: null, nota: "MED visto no painel" }, equipe, c.provedor, minutos(30));
    expect(r).toMatchObject({ ok: true });
    // O aviso na hora: o caixa registra o devolvido lido.
    expect(r.ok && r.mensagem).toMatch(/R\$ 500,00 devolvidos/);
    const [l] = await linhas(x.pagamentoId);
    const realizados = (await daDisputa(l)).filter((y) => y.estado === "realizado");
    expect(realizados.map((y) => [y.tipo, y.montante])).toEqual([["devolucao", 50_000]]);
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("devolvido_por_fora");
  });
});

describe("o restante da devolução que a disputa perdida confirmou a menos (achado 7)", () => {
  it("o quadro oferece só o restante por fora; pedir ao Mercado Pago é recusado com o texto certo; o por fora passa", async () => {
    const x = await pagarEConfirmar(c, { liberar: true, entrada: "2026-11-20", saida: "2026-11-23" });
    const diferenca = 40_000;
    const { devolucaoIds } = await reduzirDeTeste(c, x, TOTAL - diferenca, { quando: minutos(30) });
    const ids = c.provedor.contestar(x.idProvedor, "order", { valor: diferenca });
    await conferir(x.pagamentoId, sp("2026-10-20 10:00"));
    const [l] = await linhas(x.pagamentoId);
    c.provedor.resolverContestacao(ids.idCaso, { estado: "reimbursed", cobertura: false });
    expect(await confirmar(l, "perdida", sp("2026-12-10 10:00"), { nota: "O painel mostra R$ 300,00 debitados.", valorPerdido: 30_000, liquidoNaoEntrou: 0, debitoEm: "2026-12-09" })).toMatchObject({ ok: true });
    const [d] = await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.id, devolucaoIds[0]));
    expect(d).toMatchObject({ situacao: "confirmada", confirmadaPor: "contestacao", valorConfirmado: 30_000, avisos: expect.arrayContaining(["devolucao_a_menor"]) });
    const [p] = await db.select().from(pagamentos).where(eq(pagamentos.id, x.pagamentoId));
    const t = (await lerCotacaoSemTravar(db, c.org, p.cotacaoId))!;
    const acoes = acoesDaDevolucao(p, d, t.devolucoes, t, sp("2026-12-11 10:00"));
    expect({ pedirRestante: acoes.pedirRestante, restantePorFora: acoes.restantePorFora }).toEqual({ pedirRestante: false, restantePorFora: true });
    const pedir = await pedirRestanteDaDevolucao(db, c.org, d.id, equipe, c.provedor, sp("2026-12-11 10:00"));
    expect(pedir.ok).toBe(false);
    expect(pedir.ok === false && pedir.erro).not.toMatch(/Não se devolve de novo/);
    const porFora = await registrarDevolucaoPorFora(db, c.org, { restanteDe: d.id }, { data: "2026-12-11", valor: 10_000, nota: "Pix da conta da empresa" }, equipe, c.provedor, sp("2026-12-11 11:00"));
    expect(porFora).toMatchObject({ ok: true });
    const [d2] = await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.id, d.id));
    expect(d2.avisos).not.toContain("devolucao_a_menor");
  });
});

describe("a nota do débito é guardada (achado 8)", () => {
  it("'Confirmar o débito' com valor diferente do valor em risco grava a nota na linha", async () => {
    const x = await pagarEConfirmar(c, { liberar: true });
    c.provedor.contestar(x.idProvedor, "order");
    await conferir(x.pagamentoId, sp("2026-10-20 10:00"));
    const [l] = await linhas(x.pagamentoId);
    const nota = "painel mostra R$ 1.500,00 debitados em 16/12";
    expect(await confirmarDebito(db, c.org, l.id, { data: "2026-10-21", valor: 150_000, nota }, equipe, sp("2026-10-21 18:00"))).toMatchObject({ ok: true });
    expect((await linha(l.id)).debitoNota).toBe(nota);
  });
});

describe("a liberação depois da disputa perdida (achado 10) e o 'nunca entrou' proposto (achado 12)", () => {
  it("com o sinal de liberação, a perdida pede antes o registro da liberação; depois, o caixa confere com o Mercado Pago e o aviso sai", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    c.provedor.contestar(x.idProvedor, "order");
    await conferir(x.pagamentoId, sp("2026-10-20 10:00"));
    c.provedor.atualizarFinanceiro(x.idProvedor, { liberado: true, liberacaoPrevista: sp("2026-10-20 09:00") });
    await conferir(x.pagamentoId, sp("2026-10-20 11:00"));
    const [l] = await linhas(x.pagamentoId);
    expect(l.avisos).toContain("contestacao_liberacao_lida");
    await decidir(l, "scl", sp("2026-10-21 10:00"), "cobranca");
    const pv = await previaDoResultado(db, c.org, l.id);
    expect(pv.ok && pv.fatos.proposta.liquidoNaoEntrou).toBeNull();
    const r = await confirmar(l, "perdida", sp("2026-12-10 10:00"), { valorPerdido: TOTAL, liquidoNaoEntrou: LIQUIDO, debitoEm: "2026-12-09" });
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.erro).toMatch(/registre a liberação/);
    expect(await registrarLiberacaoManual(db, c.org, x.pagamentoId, { data: "2026-10-20", liquido: LIQUIDO }, equipe, sp("2026-12-10 10:30"))).toEqual({ ok: true });
    expect(await confirmar(l, "perdida", sp("2026-12-10 11:00"), { valorPerdido: TOTAL, liquidoNaoEntrou: 0, debitoEm: "2026-12-09" })).toMatchObject({ ok: true });
    const b = await balanco(x.reservaId);
    expect(b.caixa).toBe(-TAXA);
    expect(b.proprietario + b.scl).toBe(b.caixa);
    expect((await linha(l.id)).avisos).not.toContain("contestacao_liberacao_lida");
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("contestacao_liberacao_lida");
  });

  it("perdida que já contou o líquido como 'nunca entrou': a liberação à mão é recusada e a leitura não volta a pedir", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    c.provedor.contestar(x.idProvedor, "order");
    await conferir(x.pagamentoId, sp("2026-10-20 10:00"));
    const [l] = await linhas(x.pagamentoId);
    await decidir(l, "scl", sp("2026-10-21 10:00"), "cobranca");
    expect(await confirmar(l, "perdida", sp("2026-12-10 10:00"), { valorPerdido: TOTAL, liquidoNaoEntrou: LIQUIDO, debitoEm: "2026-12-09" })).toMatchObject({ ok: true });
    c.provedor.atualizarFinanceiro(x.idProvedor, { liberado: true, liberacaoPrevista: sp("2026-12-10 09:00") });
    await conferir(x.pagamentoId, sp("2026-12-10 12:00"));
    expect((await linha(l.id)).avisos).not.toContain("contestacao_liberacao_lida");
    const m = await registrarLiberacaoManual(db, c.org, x.pagamentoId, { data: "2026-12-10", liquido: LIQUIDO }, equipe, sp("2026-12-10 13:00"));
    expect(m).toMatchObject({ ok: false });
    expect((await balanco(x.reservaId)).caixa).toBe(-TAXA);
  });

  it("disputa de parte do valor sem liberação no livro: nada de 'nunca entrou' suposto; a liberação se registra antes e o caixa confere", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    c.provedor.contestar(x.idProvedor, "order", { valor: 50_000 });
    await conferir(x.pagamentoId, sp("2026-10-20 10:00"));
    const [l] = await linhas(x.pagamentoId);
    await decidir(l, "scl", sp("2026-10-21 10:00"), "cobranca");
    const pv = await previaDoResultado(db, c.org, l.id);
    expect(pv.ok && pv.fatos.proposta).toMatchObject({ valorPerdido: 50_000, liquidoNaoEntrou: null });
    expect(pv.ok && pv.fatos.liberacaoAntesDaPerda).toMatch(/registre a liberação/);
    // Com o "nunca entrou" proposto antes (o líquido inteiro), a perdida lançava uma entrada de caixa que não existiu.
    const r1 = await confirmar(l, "perdida", sp("2026-12-10 10:00"), { valorPerdido: 50_000, liquidoNaoEntrou: 50_000, debitoEm: "2026-12-09" });
    expect(r1).toMatchObject({ ok: false, codigo: "liberacao_antes" });
    expect(dinheiroComAEmpresa((await recebidoPorReserva(db, c.org, [x.reservaId])).get(x.reservaId)!)).toBe(false);
    expect(await registrarLiberacaoManual(db, c.org, x.pagamentoId, { data: "2026-11-19", liquido: LIQUIDO }, equipe, sp("2026-12-10 10:30"))).toEqual({ ok: true });
    expect(await confirmar(l, "perdida", sp("2026-12-10 11:00"), { valorPerdido: 50_000, liquidoNaoEntrou: 0, debitoEm: "2026-12-09" })).toMatchObject({ ok: true });
    const final = (await daDisputa(l)).filter((y) => y.chaveOrigem.endsWith(":caixa_final"));
    expect(final.map((y) => [y.tipo, y.montante, y.dataCaixa])).toEqual([["devolucao", 50_000, "2026-12-09"]]);
    const b = await balanco(x.reservaId);
    expect(b.caixa).toBe(LIQUIDO - 50_000);
    expect(b.proprietario + b.scl).toBe(b.caixa);
  });

  it("disputa do valor inteiro, sem liberação nem sinal: o 'nunca entrou' não passa do valor perdido", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    c.provedor.contestar(x.idProvedor, "order");
    await conferir(x.pagamentoId, sp("2026-10-20 10:00"));
    const [l] = await linhas(x.pagamentoId);
    await decidir(l, "scl", sp("2026-10-21 10:00"), "cobranca");
    const pv = await previaDoResultado(db, c.org, l.id);
    expect(pv.ok && pv.fatos.proposta).toMatchObject({ valorPerdido: TOTAL, liquidoNaoEntrou: LIQUIDO });
    const r = await confirmar(l, "perdida", sp("2026-12-10 10:00"), { valorPerdido: 100_000, liquidoNaoEntrou: LIQUIDO, debitoEm: "2026-12-09" });
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.erro).toMatch(/não passa do valor que a SCL perdeu/);
    expect(await confirmar(l, "perdida", sp("2026-12-10 10:00"), { valorPerdido: TOTAL, liquidoNaoEntrou: LIQUIDO, debitoEm: "2026-12-09" })).toMatchObject({ ok: true });
    expect((await balanco(x.reservaId)).caixa).toBe(-TAXA);
  });
});

describe("'Cancelar a reserva contestada' depois de uma redução (achado 11)", () => {
  async function reduzidaContestadaCancelada() {
    const x = await pagarEConfirmar(c, { liberar: true, entrada: "2026-11-20", saida: "2026-11-23" });
    const diferenca = 40_000;
    const { devolucaoIds } = await reduzirDeTeste(c, x, TOTAL - diferenca, { quando: minutos(30) });
    c.provedor.contestar(x.idProvedor);
    await conferir(x.pagamentoId, sp("2026-10-20 10:00"));
    const [l] = await linhas(x.pagamentoId);
    expect(l.valorEmRisco).toBe(TOTAL - diferenca);
    const quando = sp("2026-10-21 10:00");
    const pv = await previaDoCancelamentoContestado(db, c.org, x.reservaId, quando);
    if (!pv.ok) throw new Error(pv.erro);
    expect(pv.previa.valorRetido).toBe(TOTAL - diferenca);
    expect(await cancelarReservaContestada(db, c.org, x.reservaId, { nota: "Possível fraude.", assinatura: pv.previa.assinatura }, equipe, c.provedor, quando)).toMatchObject({ ok: true });
    expect(await confirmarDebito(db, c.org, l.id, { data: "2026-10-22", valor: TOTAL, nota: "O painel mostra o débito do valor inteiro." }, equipe, sp("2026-10-22 18:00"))).toMatchObject({ ok: true });
    await decidir(l, "scl", sp("2026-10-23 10:00"), "fraude");
    return { x, l, devolucaoId: devolucaoIds[0], diferenca };
  }

  it("perdida: o retido não volta a contar a diferença do hóspede; resultado igual ao caixa (com a taxa que não voltou na devolução substituída)", async () => {
    const { x, l, devolucaoId, diferenca } = await reduzidaContestadaCancelada();
    expect(await confirmar(l, "perdida", sp("2026-12-10 10:00"), { valorPerdido: TOTAL, liquidoNaoEntrou: 0 })).toMatchObject({ ok: true });
    const [d] = await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.id, devolucaoId));
    expect(d).toMatchObject({ situacao: "confirmada", confirmadaPor: "contestacao", valorConfirmado: diferenca });
    // A taxa da parte devolvida (D19) não voltou: a equipe a informa, e ela fica com a SCL (sem caixa: o débito foi o bruto).
    expect(await registrarTaxaPerdida(db, c.org, { devolucaoId }, Math.round((TAXA * diferenca) / TOTAL), equipe, sp("2026-12-11 10:00"))).toMatchObject({ ok: true });
    const b = await balanco(x.reservaId);
    expect(b.caixa).toBe(-TAXA);
    expect(b.proprietario + b.scl).toBe(b.caixa);
  });

  it("ganha: o resultado é o caixa menos a devolução que voltou a ser devida ao hóspede", async () => {
    const { x, l, devolucaoId, diferenca } = await reduzidaContestadaCancelada();
    expect(await confirmar(l, "ganha", sp("2026-12-10 10:00"), { voltaEm: "2026-12-09" })).toMatchObject({ ok: true });
    const [d] = await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.id, devolucaoId));
    expect(d.situacao).toBe("recusada");
    const b = await balanco(x.reservaId);
    expect(b.caixa).toBe(LIQUIDO);
    // O resultado é o caixa menos o que a reserva ainda deve ao hóspede, mais a taxa da parte devolvida (D19), que sai com a
    // devolução quando ela for paga (a taxa que não voltou).
    expect(b.proprietario + b.scl).toBe(b.caixa - diferenca + Math.round((TAXA * diferenca) / TOTAL));
  });
});

describe("a taxa que não voltou na devolução confirmada pela disputa (achado 13)", () => {
  it("vira linha de resultado no mês corrente, sem tirar do caixa uma segunda vez", async () => {
    const x = await pagarEConfirmar(c, { liberar: true });
    c.provedor.respostaDevolucao = "saldo_insuficiente";
    const canc = await cancelar(c, x.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "imovel_sem_condicoes" }), equipe, sp("2026-10-14 10:00"));
    expect(canc.resultado).toMatchObject({ ok: true });
    c.provedor.contestar(x.idProvedor);
    await conferir(x.pagamentoId, sp("2026-10-20 10:00"));
    const [l] = await linhas(x.pagamentoId);
    expect(await confirmarDebito(db, c.org, l.id, { data: "2026-10-21", valor: TOTAL, nota: "Débito do valor inteiro." }, equipe, sp("2026-10-21 18:00"))).toMatchObject({ ok: true });
    expect(await confirmar(l, "perdida", sp("2026-12-10 10:00"), { valorPerdido: TOTAL, liquidoNaoEntrou: 0 })).toMatchObject({ ok: true });
    const [dev] = await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.pagamentoId, x.pagamentoId));
    expect(dev).toMatchObject({ confirmadaPor: "contestacao", avisos: expect.arrayContaining(["taxa_perdida_desconhecida"]) });
    expect(await registrarTaxaPerdida(db, c.org, { devolucaoId: dev.id }, TAXA, equipe, sp("2026-12-11 10:00"))).toMatchObject({ ok: true });
    const [despesa] = await db.select().from(lancamentos).where(eq(lancamentos.id, (await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.id, dev.id)))[0].despesaLancamentoId!));
    expect(despesa).toMatchObject({ tipo: "despesa_empresa", estado: "realizado", montante: TAXA, dataCaixa: null, competencia: "2026-12-11" });
    const b = await balanco(x.reservaId);
    expect(b.caixa).toBe(-TAXA);
  });
});

describe("o pagamento sem reserva perdido (achado 15)", () => {
  async function semReservaDisputado() {
    const s = await c.segurar({ entrada: "2026-11-20", saida: "2026-11-23" });
    const pix = await c.pix(s.cotacaoId);
    await db.update(cotacoes).set({ total: TOTAL + 1 }).where(eq(cotacoes.id, s.cotacaoId));
    c.provedor.aprovar(pix.idProvedor, { taxa: TAXA });
    await conferir(pix.pagamentoId, minutos(3));
    expect((await c.tentativa(pix.pagamentoId)).motivoSemReserva).toBe("valor_divergente");
    c.provedor.contestar(pix.idProvedor);
    await conferir(pix.pagamentoId, sp("2026-10-20 10:00"));
    const [l] = await linhas(pix.pagamentoId);
    return { x: { pagamentoId: pix.pagamentoId }, l };
  }

  it("o valor perdido não passa da taxa do pagamento (a perda real)", async () => {
    const { l } = await semReservaDisputado();
    const pv = await previaDoResultado(db, c.org, l.id);
    expect(pv.ok && pv.fatos.proposta.valorPerdido).toBe(TAXA);
    const r = await confirmar(l, "perdida", sp("2026-12-10 10:00"), { valorPerdido: TOTAL, debitoEm: "2026-12-09" });
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.erro).toMatch(/taxa/);
    expect(await confirmar(l, "perdida", sp("2026-12-10 10:00"), { valorPerdido: TAXA, debitoEm: "2026-12-09" })).toMatchObject({ ok: true });
  });

  it("sem a taxa conhecida, a nota que diz a taxa vista no painel é obrigatória", async () => {
    const { x, l } = await semReservaDisputado();
    await db.update(pagamentos).set({ taxa: null, liquido: null }).where(eq(pagamentos.id, x.pagamentoId));
    const pv = await previaDoResultado(db, c.org, l.id);
    if (!pv.ok) throw new Error(pv.erro);
    const e = { resultado: "perdida", data: "2026-12-10", notaReforcada: false, versao: pv.fatos.versao, assinatura: pv.fatos.assinatura, tarifa: null, valorPerdido: 2000, debitoEm: "2026-12-09" };
    const r = await confirmarResultado(db, c.org, l.id, { ...e, nota: "" }, equipe, null, sp("2026-12-10 10:00"));
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.erro).toMatch(/taxa/);
    expect(await confirmarResultado(db, c.org, l.id, { ...e, nota: "O painel mostra a taxa de R$ 20,00." }, equipe, null, sp("2026-12-10 10:00"))).toMatchObject({ ok: true });
  });
});

describe("as datas de caixa da disputa (achado 16)", () => {
  it("o débito não é antes da abertura e a volta não é antes do débito", async () => {
    const x = await pagarEConfirmar(c, { liberar: true });
    expect(await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, { tipo: "chargeback", abertaEm: "2026-10-20", valor: TOTAL, prazo: "2026-10-30", idCaso: null, nota: "Vista no painel" }, equipe, null, sp("2026-10-20 10:00"))).toMatchObject({ ok: true });
    const [l] = await linhas(x.pagamentoId);
    const antes = await confirmarDebito(db, c.org, l.id, { data: "2026-10-02", valor: TOTAL, nota: "" }, equipe, sp("2026-10-21 18:00"));
    expect(antes).toMatchObject({ ok: false });
    expect(await confirmarDebito(db, c.org, l.id, { data: "2026-10-21", valor: TOTAL, nota: "" }, equipe, sp("2026-10-21 18:00"))).toMatchObject({ ok: true });
    const volta = await confirmar(l, "ganha", sp("2026-12-10 10:00"), { voltaEm: "2026-10-05" });
    expect(volta).toMatchObject({ ok: false });
    expect(await confirmar(l, "ganha", sp("2026-12-10 10:00"), { voltaEm: "2026-12-05" })).toMatchObject({ ok: true });
  });
});
