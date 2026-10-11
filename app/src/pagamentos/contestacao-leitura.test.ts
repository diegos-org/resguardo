/**
 * Contestação do pagamento no site (M8.2e) — a leitura sob a trava, em PGlite com o Mercado Pago falso (sem rede): a
 * disputa que a order mostra vira linha; a ordem das leituras; a situação do pagamento e o aviso `contestado`; o "em
 * curso" nas recusas (cancelamento, alteração, devolução, recebimento à mão); a liberação sob disputa; o retido no caixa;
 * a substituição das devoluções; o aviso assinado; o Pix (o número do pagamento e `contestacao_pix`).
 * Itens 3, 4, 5, 7, 13, 19, 21 e 23 de "Testes a escrever" (PAGAMENTO-SITE.md, "Contestação (M8.2e)").
 */
import { and, asc, eq, like, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditoria, contestacoesPagamento, devolucoesPagamento, eventosContestacao, lancamentos, pagamentos, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { devolvidaNoProvedorSql } from "@/portal/posse";
import { registrarRecebimento } from "@/repasses/recebimentos";
import { previaDaAlteracao } from "./alteracao";
import { previaDoCancelamento, TEXTO_CONTESTADO, TEXTO_CONTESTADO_PERDIDA } from "./cancelamento";
import { conferirTentativa, processarAvisoDeOrder } from "./conferencia";
import { aplicarLeiturasDaDisputa, confirmarOutraDisputa, registrarContestacaoDaEquipe } from "./contestacao";
import { chavesDaContestacao, DESCRICAO_RETIDO_PREVISTO, type LeituraDeContestacao, TEXTO_DISPUTA_EM_CURSO_ALTERACAO, TEXTO_ESTORNO_LIBERACAO_COM_RETIDO, textoContestacaoPerdida } from "./contestacao-regras";
import { avisosDePagamento } from "./consultas";
import { devolverPeloProvedor, ERRO_DEVOLUCAO_COM_DISPUTA } from "./devolucao";
import { estornarLiberacaoManual, registrarLiberacaoManual } from "./liberacao";
import { travarCotacao } from "./travas";
import {
  alterar,
  type Cenario,
  cancelar,
  entradaAlteracao,
  entradaPadrao,
  env,
  envelhecer,
  minutos,
  montarCenario,
  pagarDiferenca,
  pagarEConfirmar,
  semDadosDoHospede,
  TOTAL,
  usuarioDeTeste,
} from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario, equipe: string;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  c = await montarCenario(db);
  equipe = await usuarioDeTeste(c);
});
// Dados pessoais: nenhuma tabela do pagamento (as da disputa inclusive, pela auditoria e pelo livro) guarda o hóspede.
afterEach(async () => {
  expect(await semDadosDoHospede(db)).toEqual([]);
});

const conferir = (id: string, quando: Date) => conferirTentativa(db, c.org, id, c.provedor, quando, { origem: "rotina", forcar: true });
const linhas = (pagamentoId: string) => db.select().from(contestacoesPagamento).where(eq(contestacoesPagamento.pagamentoId, pagamentoId)).orderBy(asc(contestacoesPagamento.abertaEm), asc(contestacoesPagamento.id));
const eventos = (contestacaoId: string) => db.select().from(eventosContestacao).where(eq(eventosContestacao.contestacaoId, contestacaoId)).orderBy(asc(eventosContestacao.em), asc(eventosContestacao.id));
const daDisputa = (pagamentoId: string) => db.select().from(lancamentos).where(like(lancamentos.chaveOrigem, `mercadopago:${pagamentoId}:contestacao:%`)).orderBy(asc(lancamentos.criadoEm), asc(lancamentos.chaveOrigem));
const recebimentos = (pagamentoId: string) => db.select().from(lancamentos).where(and(eq(lancamentos.tipo, "recebimento"), like(lancamentos.chaveOrigem, `mercadopago:${pagamentoId}:recebimento%`)));
/** O D21 pela regra SQL da conferência (`devolvidaNoProvedorSql`), para a reserva. */
const devolvidaPeloD21 = async (reservaId: string) =>
  (await db.select({ d: sql<boolean>`coalesce(${devolvidaNoProvedorSql()}, false)` }).from(reservas).where(eq(reservas.id, reservaId)))[0].d;
/** Reserva com entrada em 20/11 (o cancelamento pela política dá a devolução integral). */
const longe = { entrada: "2026-11-20", saida: "2026-11-23" };
/** A equipe confirma o resultado (o "Confirmar o resultado" do quadro da disputa, de outro bloco do M8.2e, simulado aqui). */
async function confirmarNaMao(pagamentoId: string, resultado: "ganha" | "perdida", quando: Date) {
  await db.update(contestacoesPagamento).set({ situacao: resultado, lidaEm: quando }).where(eq(contestacoesPagamento.pagamentoId, pagamentoId));
  if (resultado === "ganha") await db.update(pagamentos).set({ situacao: "aprovado" }).where(and(eq(pagamentos.id, pagamentoId), eq(pagamentos.situacao, "contestado")));
}
/** Aplica leituras feitas à mão (da Chargebacks API, por exemplo) sob a trava, como a rotina. */
async function aplicarSobATrava(cotacaoId: string, pagamentoId: string, leituras: LeituraDeContestacao[], agora: Date) {
  return db.transaction(async (tx) => {
    const t = (await travarCotacao(tx, c.org, cotacaoId))!;
    const p = t.tentativas.find((x) => x.id === pagamentoId)!;
    return aplicarLeiturasDaDisputa(tx, c.org, t, p, leituras, agora, { fonte: "chargebacks" });
  });
}
const doCaso = (idCaso: string, o: Partial<LeituraDeContestacao> & Pick<LeituraDeContestacao, "lidaEm">): LeituraDeContestacao => ({
  fonte: "chargebacks",
  idCaso,
  idContestacao: null,
  estadoLido: null,
  coberturaAplicada: null,
  valor: null,
  atualizadoNoProvedorEm: null,
  ...o,
});

describe("Pix (item 23)", () => {
  it("o número do pagamento é gravado também no Pix; contestado num Pix = disputa no cartão com o aviso contestacao_pix", async () => {
    const x = await pagarEConfirmar(c);
    expect((await c.tentativa(x.pagamentoId)).idPagamentoProvedor).toMatch(/^\d{1,20}$/);
    const { idCaso, idCbk } = c.provedor.contestar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(20));
    const [l] = await linhas(x.pagamentoId);
    expect(l).toMatchObject({ tipo: "chargeback", origem: "leitura", situacao: "aberta", idCaso, idContestacao: idCbk, idTransacao: expect.stringMatching(/^PAYCBK/), valor: TOTAL, valorEmRisco: TOTAL, situacaoPagamentoAntes: "aprovado", reservaId: x.reservaId });
    expect(l.avisos).toEqual(expect.arrayContaining(["contestacao_pix", "contestacao_prazo_desconhecido"]));
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "contestado", avisos: expect.arrayContaining(["contestado", "contestacao_pix"]) });
  });
});

describe("ordem das leituras (item 3)", () => {
  it("a leitura iniciada antes da última aplicada é descartada; a de depois vale", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    c.provedor.contestar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(30));
    c.provedor.resolverContestacao(x.idProvedor, { estado: "settled" });
    // Uma leitura que começou antes (a rotina lenta) chega depois: descartada.
    await conferir(x.pagamentoId, minutos(20));
    expect((await linhas(x.pagamentoId))[0]).toMatchObject({ situacao: "aberta", estadoLido: "in_process", lidaEm: minutos(30) });
    await conferir(x.pagamentoId, minutos(31));
    const [l] = await linhas(x.pagamentoId);
    expect(l).toMatchObject({ situacao: "a_confirmar", estadoLido: "settled", lidaEm: minutos(31) });
    // Um evento por mudança do estado combinado (a leitura descartada não deixa nenhum); o retido previsto é o de caixa.
    expect((await eventos(l.id)).map((e) => e.tipo).sort()).toEqual(["aberta", "caixa", "estado_lido"]);
  });

  it("date_last_updated mais velho é descartado; fontes que divergem no encerramento avisam uma vez, sem oscilar", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    const { idCaso } = c.provedor.contestar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(10));
    await aplicarSobATrava(x.cotacaoId, x.pagamentoId, [doCaso(idCaso, { lidaEm: minutos(11), atualizadoNoProvedorEm: minutos(9), valor: 100_000 })], minutos(11));
    expect((await linhas(x.pagamentoId))[0]).toMatchObject({ valor: 100_000, atualizadoNoProvedorEm: minutos(9) });
    // O caso relido com uma data do Mercado Pago mais antiga que a guardada: descartado.
    await aplicarSobATrava(x.cotacaoId, x.pagamentoId, [doCaso(idCaso, { lidaEm: minutos(12), atualizadoNoProvedorEm: minutos(8), valor: 90_000 })], minutos(12));
    expect((await linhas(x.pagamentoId))[0]).toMatchObject({ valor: 100_000, valorEmRisco: 100_000 });
    // A order diz `reimbursed` e o caso diz cobertura a favor: conflito, a situação não muda, o aviso liga uma vez.
    c.provedor.resolverContestacao(x.idProvedor, { estado: "reimbursed" });
    const conflito = async (n: number) => {
      const cobranca = (await c.provedor.consultar(x.idProvedor))!;
      return db.transaction(async (tx) => {
        const t = (await travarCotacao(tx, c.org, x.cotacaoId))!;
        const p = t.tentativas.find((y) => y.id === x.pagamentoId)!;
        const daOrder: LeituraDeContestacao[] = cobranca.contestacoes.map((k) => ({ fonte: "order", idCaso: k.idCaso, idContestacao: k.idContestacao, estadoLido: k.estadoLido, coberturaAplicada: null, valor: k.valor, lidaEm: minutos(n), atualizadoNoProvedorEm: null }));
        return aplicarLeiturasDaDisputa(tx, c.org, t, p, [...daOrder, doCaso(idCaso, { lidaEm: minutos(n), atualizadoNoProvedorEm: minutos(n), coberturaAplicada: true })], minutos(n), { fonte: "chargebacks" });
      });
    };
    await conflito(20);
    const [l] = await linhas(x.pagamentoId);
    expect(l.situacao).toBe("aberta");
    expect(l.avisos).toContain("contestacao_leitura_conflitante");
    const antes = (await eventos(l.id)).length;
    await conflito(21);
    const [l2] = await linhas(x.pagamentoId);
    expect(l2).toMatchObject({ situacao: "aberta", avisos: l.avisos });
    expect(await eventos(l.id)).toHaveLength(antes);
  });

  it("a confirmação da equipe nunca é desfeita por uma leitura velha", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    c.provedor.contestar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(10));
    await confirmarNaMao(x.pagamentoId, "ganha", minutos(40));
    // Uma leitura começada antes da confirmação, que ainda mostrava a disputa em andamento: descartada.
    await conferir(x.pagamentoId, minutos(35));
    const [l] = await linhas(x.pagamentoId);
    expect(l).toMatchObject({ situacao: "ganha" });
    expect(l.avisos).not.toContain("contestacao_resultado_mudou");
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "aprovado" });
  });
});

describe("situação do pagamento (item 4)", () => {
  it("contestado durante a disputa; ganha: uma leitura encerrada depois mantém a situação local e o aviso `contestado` sai", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    c.provedor.contestar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(10));
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "contestado", avisos: expect.arrayContaining(["contestado"]) });
    expect((await linhas(x.pagamentoId))[0]).toMatchObject({ situacaoPagamentoAntes: "aprovado", tresDSStatus: (await c.tentativa(x.pagamentoId)).tresDSStatus });
    await confirmarNaMao(x.pagamentoId, "ganha", minutos(20));
    // O Mercado Pago mostra a disputa encerrada (reimbursed): explicada pela linha ganha; a situação local (aprovado) fica.
    c.provedor.resolverContestacao(x.idProvedor, { estado: "reimbursed" });
    await conferir(x.pagamentoId, minutos(21));
    const p = await c.tentativa(x.pagamentoId);
    expect(p.situacao).toBe("aprovado");
    expect(p.avisos).not.toContain("contestado");
  });

  it("caso novo `in_process` abre outra linha; com outra não final, nasce possível duplicata com valor em risco 0", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    c.provedor.contestar(x.idProvedor, "order", { valor: 50_000 });
    await conferir(x.pagamentoId, minutos(10));
    c.provedor.contestar(x.idProvedor, "order", { valor: 30_000 });
    await conferir(x.pagamentoId, minutos(11));
    const [a, b] = await linhas(x.pagamentoId);
    expect(a).toMatchObject({ duplicataPossivel: false, valorEmRisco: 50_000 });
    expect(b).toMatchObject({ duplicataPossivel: true, valorEmRisco: 0 });
    expect(b.avisos).toContain("contestacao_possivel_duplicata");
    // Só a primeira tem retido (a possível duplicata não segura nada).
    expect((await daDisputa(x.pagamentoId)).map((l) => [l.chaveOrigem, l.montante])).toEqual([[chavesDaContestacao(x.pagamentoId, a.id).retido(), 50_000]]);
  });

  it("pagamento devolvido por inteiro e contestado: não muda de situação; a linha nasce com o aviso e o valor em risco cheio", async () => {
    const x = await pagarEConfirmar(c);
    c.provedor.devolverNoProvedor(x.idProvedor, TOTAL);
    await conferir(x.pagamentoId, minutos(10));
    expect((await c.tentativa(x.pagamentoId)).situacao).toBe("devolvido");
    c.provedor.contestar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(11));
    expect((await c.tentativa(x.pagamentoId)).situacao).toBe("devolvido");
    const [l] = await linhas(x.pagamentoId);
    expect(l).toMatchObject({ situacao: "aberta", situacaoPagamentoAntes: "devolvido", valorEmRisco: TOTAL });
    expect(l.avisos).toContain("contestacao_com_devolucao");
  });
});

describe("em curso (item 5)", () => {
  it("MED registrado à mão num Pix aprovado: o pagamento continua aprovado e o cancelamento, a alteração e o recebimento à mão são recusados", async () => {
    const x = await pagarEConfirmar(c, longe);
    const r = await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, { tipo: "med", abertaEm: "2026-10-01", valor: 50_000, prazo: null, idCaso: null, nota: "MED visto no painel do Mercado Pago" }, equipe, c.provedor, minutos(20));
    expect(r).toMatchObject({ ok: true });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "aprovado", avisos: expect.arrayContaining(["contestado"]) });
    expect(await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao(), null, minutos(30))).toMatchObject({ ok: false, codigo: "contestado", erro: TEXTO_CONTESTADO });
    const r2 = await c.reserva(x.reservaId);
    const e = entradaAlteracao({ checkin: r2.checkin, checkout: "2026-11-24", hospedes: 4, recebidoEm: minutos(30) });
    expect(await previaDaAlteracao(db, c.org, x.reservaId, e, null, minutos(30))).toMatchObject({ ok: false, codigo: "contestado", erro: TEXTO_DISPUTA_EM_CURSO_ALTERACAO });
    expect(await registrarRecebimento(db, c.org, { reservaId: x.reservaId, data: "2026-10-01", valor: 1000, nota: "" }, equipe, "2026-10-01")).toMatchObject({ ok: false });
  });

  it("caso tardio só da Chargebacks API (a order já apagada, o pagamento ainda aprovado): recusa como contestado", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao", ...longe });
    const numero = (await c.tentativa(x.pagamentoId)).idPagamentoProvedor!;
    await envelhecer(c, x.pagamentoId, 100);
    c.provedor.contestarTarde(numero);
    const { buscarContestacoesTardias } = await import("./contestacao");
    expect(await buscarContestacoesTardias(db, c.org, c.provedor, minutos(30))).toMatchObject({ buscados: 1, novas: 1 });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "aprovado", avisos: expect.arrayContaining(["contestado"]) });
    expect(await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao(), null, minutos(40))).toMatchObject({ ok: false, codigo: "contestado" });
    // Perdida: recusa própria, sem "Pedir de novo" pela política.
    await confirmarNaMao(x.pagamentoId, "perdida", minutos(50));
    expect(await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao(), null, minutos(60))).toEqual({ ok: false, codigo: "contestacao_perdida", erro: TEXTO_CONTESTADO_PERDIDA });
    const r = await c.reserva(x.reservaId);
    const e = entradaAlteracao({ checkin: r.checkin, checkout: "2026-11-24", hospedes: 4, recebidoEm: minutos(60) });
    expect(await previaDaAlteracao(db, c.org, x.reservaId, e, null, minutos(60))).toEqual({ ok: false, codigo: "contestacao_perdida", erro: textoContestacaoPerdida("alteracao") });
  });

  it("alteração segurada quando a disputa abre: a aprovação da diferença não aplica (alteracao_nao_aplicada:contestado)", async () => {
    const x = await pagarEConfirmar(c, { liberar: true });
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok || !("alteracaoId" in resultado)) throw new Error("alteração não segurada");
    expect(await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, { tipo: "reclamacao", abertaEm: "2026-10-01", valor: 10_000, prazo: null, idCaso: null, nota: "Reclamação aberta no Mercado Pago" }, equipe, null, minutos(22))).toMatchObject({ ok: true });
    const pag = await pagarDiferenca(c, x.cotacaoId, resultado.alteracaoId, { quando: minutos(25) });
    expect(pag.resultado).toBe("aprovado");
    expect(await c.tentativa(pag.pagamentoId)).toMatchObject({ desfecho: null, motivoSemReserva: "alteracao_nao_aplicada:contestado" });
    expect(await c.reserva(x.reservaId)).toMatchObject({ checkout: "2026-10-15" });
  });
});

describe("liberação sob disputa (item 7)", () => {
  it("a lida não lança e liga o aviso; a à mão lança, com o retido separado; o estorno é recusado com o retido realizado", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    c.provedor.contestar(x.idProvedor, "order", { valor: 30_000 });
    await conferir(x.pagamentoId, minutos(10));
    // O Mercado Pago mostra a liberação de um pagamento em disputa: nada é lançado nem dado por liberado (a lacuna de antes).
    c.provedor.atualizarFinanceiro(x.idProvedor, { liberado: true, liberacaoPrevista: minutos(5) });
    await conferir(x.pagamentoId, minutos(11));
    expect(await recebimentos(x.pagamentoId)).toEqual([]);
    expect((await c.tentativa(x.pagamentoId)).liberacaoConfirmadaEm).toBeNull();
    expect((await linhas(x.pagamentoId))[0].avisos).toContain("contestacao_liberacao_lida");
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("contestacao_liberacao_lida");
    // A equipe registra a liberação à mão com o líquido que caiu: o recebimento entra; o retido da disputa é outra linha.
    expect(await registrarLiberacaoManual(db, c.org, x.pagamentoId, { data: "2026-10-01", liquido: TOTAL - 1824 }, equipe, minutos(12))).toEqual({ ok: true });
    expect((await recebimentos(x.pagamentoId)).map((l) => l.montante)).toEqual([TOTAL - 1824]);
    const [retido] = await daDisputa(x.pagamentoId);
    expect(retido).toMatchObject({ tipo: "devolucao", estado: "previsto", montante: 30_000, valor: 0 });
    expect((await linhas(x.pagamentoId))[0].avisos).not.toContain("contestacao_liberacao_lida");
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("contestacao_liberacao_lida");
    // O débito confirmado (o "Confirmar o débito do Mercado Pago", de outro bloco, simulado): o estorno da liberação é recusado.
    await db.update(lancamentos).set({ estado: "realizado", dataCaixa: "2026-10-01" }).where(eq(lancamentos.id, retido.id));
    expect(await estornarLiberacaoManual(db, c.org, x.pagamentoId, "registrada errado", equipe, minutos(13))).toEqual({ ok: false, erro: TEXTO_ESTORNO_LIBERACAO_COM_RETIDO });
  });

  it("ganha: a liberação lida lança na leitura seguinte, com a order ainda contestada (encerrada)", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    c.provedor.contestar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(10));
    await confirmarNaMao(x.pagamentoId, "ganha", minutos(20));
    c.provedor.resolverContestacao(x.idProvedor, { estado: "settled" });
    c.provedor.atualizarFinanceiro(x.idProvedor, { liberado: true, liberacaoPrevista: minutos(5) });
    expect((await c.provedor.consultar(x.idProvedor))!.situacao).toBe("contestado");
    await conferir(x.pagamentoId, minutos(21));
    expect((await recebimentos(x.pagamentoId)).map((l) => [l.montante, l.estado])).toEqual([[TOTAL - 1824, "conciliado"]]);
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "aprovado", liberacaoOrigem: "provedor" });
  });

  it("a liberação vencida não avisa com a disputa em curso e volta na ganha", async () => {
    const x = await pagarEConfirmar(c, { financeiro: { taxa: 1824, liberacaoPrevista: minutos(60) } });
    const vencidas = async (quando: Date) => (await avisosDePagamento(db, c.org, quando, { env: env({}) })).contagens.liberacaoVencida;
    expect(await vencidas(minutos(120))).toBe(1);
    await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, { tipo: "med", abertaEm: "2026-10-01", valor: 10_000, prazo: null, idCaso: null, nota: "MED visto no painel" }, equipe, null, minutos(100));
    expect(await vencidas(minutos(120))).toBe(0);
    await confirmarNaMao(x.pagamentoId, "ganha", minutos(110));
    // A próxima gravação sob a trava refaz a união dos avisos (a ganha não está mais em curso).
    await conferir(x.pagamentoId, minutos(115));
    expect(await vencidas(minutos(120))).toBe(1);
  });
});

describe("retido (item 13: abertura e MED)", () => {
  it("nasce previsto (competência do dia da abertura, sem caixa); o valor em risco muda antes do débito: estorno e #2", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    const { idCaso } = c.provedor.contestar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(10));
    const [l] = await linhas(x.pagamentoId);
    const chaves = chavesDaContestacao(x.pagamentoId, l.id);
    const [r1] = await daDisputa(x.pagamentoId);
    expect(r1).toMatchObject({ tipo: "devolucao", valor: 0, efeitoSaldo: 0, montante: TOTAL, estado: "previsto", dataCaixa: null, competencia: "2026-10-01", chaveOrigem: chaves.retido(), reservaId: x.reservaId, origem: "contestacao_pagamento" });
    expect(r1.descricao).toContain(DESCRICAO_RETIDO_PREVISTO);
    expect(l.retidoLancamentoId).toBe(r1.id);
    // O caso da Chargebacks API diz o valor em disputa (parte do valor): a prevista é estornada e nasce a #2.
    await aplicarSobATrava(x.cotacaoId, x.pagamentoId, [doCaso(idCaso, { lidaEm: minutos(11), atualizadoNoProvedorEm: minutos(11), valor: 40_000 })], minutos(11));
    const todos = await daDisputa(x.pagamentoId);
    const estorno = (await db.select().from(lancamentos).where(eq(lancamentos.estornoDe, r1.id)))[0];
    expect(estorno).toMatchObject({ montante: -TOTAL, estado: "previsto", dataCaixa: null });
    const r2 = todos.find((y) => y.chaveOrigem === chaves.retido(2))!;
    expect(r2).toMatchObject({ montante: 40_000, estado: "previsto" });
    expect((await linhas(x.pagamentoId))[0]).toMatchObject({ valorEmRisco: 40_000, retidoLancamentoId: r2.id });
    // Repetir a mesma leitura não lança de novo.
    await aplicarSobATrava(x.cotacaoId, x.pagamentoId, [doCaso(idCaso, { lidaEm: minutos(12), atualizadoNoProvedorEm: minutos(11), valor: 40_000 })], minutos(12));
    expect(await daDisputa(x.pagamentoId)).toHaveLength(2);
  });

  it("MED que a leitura mostra como devolução: retido realizado no dia em que a leitura a viu, sem gravar o reconhecido; o D21 fica explicado", async () => {
    const x = await pagarEConfirmar(c);
    c.provedor.devolverNoProvedor(x.idProvedor, TOTAL);
    await conferir(x.pagamentoId, minutos(10));
    const antes = await c.tentativa(x.pagamentoId);
    expect(antes).toMatchObject({ situacao: "devolvido", devolvidoLido: TOTAL, devolvidoVistoEm: minutos(10), avisos: expect.arrayContaining(["devolvido_por_fora"]) });
    expect(await devolvidaPeloD21(x.reservaId)).toBe(true);
    const r = await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, { tipo: "med", abertaEm: "2026-10-01", valor: TOTAL, prazo: "2026-10-10", idCaso: null, nota: "MED aceito pelo Mercado Pago" }, equipe, c.provedor, minutos(30));
    expect(r).toMatchObject({ ok: true });
    const [l] = await linhas(x.pagamentoId);
    expect(l).toMatchObject({ tipo: "med", origem: "equipe", valorEmRisco: TOTAL });
    const [retido] = await daDisputa(x.pagamentoId);
    expect(retido).toMatchObject({ tipo: "devolucao", estado: "realizado", montante: TOTAL, dataCaixa: "2026-10-01", competencia: "2026-10-01", chaveOrigem: chavesDaContestacao(x.pagamentoId, l.id).retido() });
    const depois = await c.tentativa(x.pagamentoId);
    expect(depois).toMatchObject({ devolvidoForaReconhecido: 0 });
    expect(depois.avisos).not.toContain("devolvido_por_fora");
    // A regra SQL da conferência (o gêmeo de `devolucaoInexplicada`) também conta o MED: o D21 não segura mais a reserva.
    expect(await devolvidaPeloD21(x.reservaId)).toBe(false);
    // A leitura seguinte não o liga de novo: o MED explica a devolução lida.
    await conferir(x.pagamentoId, minutos(40));
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("devolvido_por_fora");
    expect(await daDisputa(x.pagamentoId)).toHaveLength(1);
  });

  it("a saída do devolvido_por_fora pelo MED é gravada mesmo quando o resto dos avisos não muda", async () => {
    const x = await pagarEConfirmar(c);
    c.provedor.devolverNoProvedor(x.idProvedor, TOTAL);
    await conferir(x.pagamentoId, minutos(10));
    // O pagamento já com os avisos que o registro vai dar, na mesma ordem: a lista recalculada é igual à da memória sem o
    // `devolvido_por_fora`, e mudar só a memória pularia a escrita.
    await db.update(pagamentos).set({ avisos: ["contestado", "contestacao_com_devolucao", "devolvido_por_fora"] }).where(eq(pagamentos.id, x.pagamentoId));
    const r = await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, { tipo: "med", abertaEm: "2026-10-01", valor: TOTAL, prazo: "2026-10-10", idCaso: null, nota: "MED aceito pelo Mercado Pago" }, equipe, null, minutos(30));
    expect(r).toMatchObject({ ok: true });
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("devolvido_por_fora");
  });

  it("a possível duplicata não explica a devolução lida até a equipe confirmar que é outra disputa", async () => {
    const x = await pagarEConfirmar(c);
    c.provedor.devolverNoProvedor(x.idProvedor, TOTAL);
    await conferir(x.pagamentoId, minutos(10));
    expect(await devolvidaPeloD21(x.reservaId)).toBe(true);
    // Um MED com o número do caso, de parte do valor: a devolução ainda não fica toda explicada.
    const med = { tipo: "med", abertaEm: "2026-10-01", valor: 50_000, prazo: "2026-10-10", idCaso: "8100000001", nota: "MED visto no painel" };
    expect(await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, med, equipe, null, minutos(20))).toMatchObject({ ok: true });
    // A reclamação do restante, sem número: possível duplicata (há outra disputa não final), ainda sem efeito nenhum.
    const reclamacao = { tipo: "reclamacao", abertaEm: "2026-10-01", valor: TOTAL - 50_000, prazo: "2026-10-12", idCaso: null, nota: "Reclamação vista no painel" };
    expect(await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, reclamacao, equipe, null, minutos(30))).toMatchObject({ ok: true });
    const r = (await linhas(x.pagamentoId)).find((l) => l.tipo === "reclamacao")!;
    expect(r).toMatchObject({ duplicataPossivel: true, valorEmRisco: 0 });
    expect(await devolvidaPeloD21(x.reservaId)).toBe(true);
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("devolvido_por_fora");
    // Confirmada como outra disputa, ela explica o restante: o D21 sai, e o aviso também.
    expect(await confirmarOutraDisputa(db, c.org, r.id, equipe, minutos(40))).toMatchObject({ ok: true });
    expect(await devolvidaPeloD21(x.reservaId)).toBe(false);
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("devolvido_por_fora");
  });
});

describe("devoluções do mesmo pagamento (item 19)", () => {
  it("a devolução pedida e não aceita para e é substituída pela disputa: valor em risco 0, nada retido", async () => {
    const x = await pagarEConfirmar(c, longe);
    // O Mercado Pago recusa o primeiro pedido com clareza: a devolução continua pedida, sem nada no Mercado Pago.
    c.provedor.respostaDevolucao = "saldo_insuficiente";
    const { resultado } = await cancelar(c, x.reservaId, entradaPadrao({ recebidoEm: minutos(30), canal: "whatsapp", nota: "WhatsApp" }), equipe, minutos(60));
    expect(resultado).toMatchObject({ ok: true });
    const [d0] = await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.pagamentoId, x.pagamentoId));
    expect(d0).toMatchObject({ situacao: "pedida", chaveAceita: false, chaveEmDuvida: false });
    c.provedor.contestar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(70));
    const [l] = await linhas(x.pagamentoId);
    const [d] = await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.pagamentoId, x.pagamentoId));
    expect(d).toMatchObject({ situacao: "recusada", contestacaoId: l.id, proximaTentativaEm: null, avisos: expect.arrayContaining(["devolucao_parada"]) });
    expect(l).toMatchObject({ valorEmRisco: 0, retidoLancamentoId: null });
    expect((await eventos(l.id)).map((e) => e.tipo).sort()).toEqual(["aberta", "substituicao"]);
    expect(await db.select({ acao: auditoria.acao }).from(auditoria).where(and(eq(auditoria.entidadeId, x.pagamentoId), eq(auditoria.acao, "pagamento.devolucao_substituida")))).toHaveLength(1);
    expect(await daDisputa(x.pagamentoId)).toEqual([]);
    // Pedir de novo: recusado em curso e depois de perdida; aceito depois de ganha.
    expect(await devolverPeloProvedor(db, c.org, { devolucaoId: d.id }, equipe, c.provedor, minutos(80))).toEqual({ ok: false, erro: ERRO_DEVOLUCAO_COM_DISPUTA });
    await confirmarNaMao(x.pagamentoId, "perdida", minutos(90));
    expect(await devolverPeloProvedor(db, c.org, { devolucaoId: d.id }, equipe, c.provedor, minutos(91))).toEqual({ ok: false, erro: textoContestacaoPerdida("devolucao") });
    await db.update(contestacoesPagamento).set({ situacao: "ganha" }).where(eq(contestacoesPagamento.id, l.id));
    await db.update(pagamentos).set({ situacao: "aprovado" }).where(eq(pagamentos.id, x.pagamentoId));
    c.provedor.resolverContestacao(x.idProvedor, { estado: "settled", transacaoAprovada: true });
    c.provedor.respostaDevolucao = "confirmada";
    expect(await devolverPeloProvedor(db, c.org, { devolucaoId: d.id }, equipe, c.provedor, minutos(92))).toMatchObject({ ok: true });
  });

  it("depois de ganha, um pagamento com mais de 78 dias: pedir de novo segue os caminhos do painel", async () => {
    const x = await pagarEConfirmar(c, longe);
    c.provedor.respostaDevolucao = "saldo_insuficiente";
    await cancelar(c, x.reservaId, entradaPadrao({ recebidoEm: minutos(30), canal: "whatsapp", nota: "WhatsApp" }), equipe, minutos(60));
    c.provedor.contestar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(70));
    await confirmarNaMao(x.pagamentoId, "ganha", minutos(80));
    await envelhecer(c, x.pagamentoId, 79);
    const [d] = await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.pagamentoId, x.pagamentoId));
    expect(await devolverPeloProvedor(db, c.org, { devolucaoId: d.id }, equipe, c.provedor, minutos(90))).toMatchObject({ ok: false, erro: expect.stringContaining("mais de 78 dias") });
  });

  it("a devolução aceita segue esperando a leitura, sem substituição", async () => {
    const x = await pagarEConfirmar(c, longe);
    c.provedor.respostaDevolucao = "pedida";
    await cancelar(c, x.reservaId, entradaPadrao({ recebidoEm: minutos(30), canal: "whatsapp", nota: "WhatsApp" }), equipe, minutos(60));
    c.provedor.contestar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(70));
    const [d] = await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.pagamentoId, x.pagamentoId));
    expect(d).toMatchObject({ situacao: "pedida", chaveAceita: true, contestacaoId: null });
    const [l] = await linhas(x.pagamentoId);
    expect(l.valorEmRisco).toBe(TOTAL);
  });

  it("devolução realizada e depois a disputa: aviso contestacao_com_devolucao e valor em risco cheio", async () => {
    const x = await pagarEConfirmar(c);
    c.provedor.devolverNoProvedor(x.idProvedor, 20_000);
    await conferir(x.pagamentoId, minutos(10));
    await db.update(pagamentos).set({ devolvidoForaReconhecido: 20_000 }).where(eq(pagamentos.id, x.pagamentoId));
    c.provedor.contestar(x.idProvedor, "order", { valor: TOTAL });
    await conferir(x.pagamentoId, minutos(11));
    const [l] = await linhas(x.pagamentoId);
    expect(l.valorEmRisco).toBe(TOTAL);
    expect(l.avisos).toContain("contestacao_com_devolucao");
  });
});

describe("aviso assinado (item 21)", () => {
  it("ORD… com order.charged_back cria a disputa pela releitura; o id numérico é ignorado; o corpo nunca decide", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    c.provedor.contestar(x.idProvedor);
    expect(await processarAvisoDeOrder(db, c.provedor, x.idProvedor, minutos(10))).toBe("aplicado");
    expect(await linhas(x.pagamentoId)).toHaveLength(1);
    expect((await c.tentativa(x.pagamentoId)).situacao).toBe("contestado");
    // O id numérico do pagamento (o que um aviso de "Chargebacks" poderia trazer) continua ignorado: nada é lido.
    const numero = (await c.tentativa(x.pagamentoId)).idPagamentoProvedor!;
    const chamadas = c.provedor.chamadas.length;
    expect(await processarAvisoDeOrder(db, c.provedor, numero, minutos(11))).toBe("ignorado");
    expect(c.provedor.chamadas.length).toBe(chamadas);
    expect(await linhas(x.pagamentoId)).toHaveLength(1);
  });
});
