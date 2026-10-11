/**
 * Contestação do pagamento no site (M8.2e) — dados pessoais: a varredura `semDadosPessoais` percorre também
 * `contestacoes_pagamento` e `eventos_contestacao`, depois dos fluxos do desenho (aberta → ganha, aberta → perdida, sem
 * identificação → com caso, registro da equipe, MED, duplicata e reabertura), em PGlite com o Mercado Pago falso (sem
 * rede). Item 28 de "Testes a escrever" (PAGAMENTO-SITE.md, "Contestação (M8.2e)", "Dados pessoais"); o JSON oficial cheio
 * de dados pessoais no cliente HTTP fica em `mercadopago.test.ts`.
 */
import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { contestacoesPagamento, eventosContestacao } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { hojeISO } from "@/lib/datas";
import { conferirTentativa } from "./conferencia";
import {
  conferirAviso,
  conferirContestacoesDoPagamento,
  confirmarDebito,
  confirmarOutraDisputa,
  confirmarResultado,
  type EntradaRegistroDisputa,
  previaDaDecisao,
  previaDoResultado,
  registrarContestacaoDaEquipe,
  registrarDecisao,
} from "./contestacao";
import {
  DISPOSITIVO_FICTICIO,
  DOCUMENTO_FICTICIO,
  EMAIL_HOSPEDE,
  minutos,
  montarCenario,
  NOME_HOSPEDE,
  pagarEConfirmar,
  semDadosDoHospede,
  semDadosPessoais,
  TELEFONE_HOSPEDE,
  TOKEN_FICTICIO,
  TOTAL,
  usuarioDeTeste,
  type Cenario,
} from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario, equipe: string;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
  c = await montarCenario(db);
  equipe = await usuarioDeTeste(c);
});
afterEach(async () => {
  expect(await semDadosDoHospede(db)).toEqual([]);
});

const conferir = (id: string, quando: Date) => conferirTentativa(db, c.org, id, c.provedor, quando, { origem: "rotina", forcar: true });
const linhas = (pagamentoId: string) =>
  db.select().from(contestacoesPagamento).where(eq(contestacoesPagamento.pagamentoId, pagamentoId)).orderBy(asc(contestacoesPagamento.abertaEm), asc(contestacoesPagamento.rodada), asc(contestacoesPagamento.id));
const registro = (o: Partial<EntradaRegistroDisputa> = {}): EntradaRegistroDisputa => ({ tipo: "chargeback", abertaEm: "2026-10-01", valor: 50_000, prazo: "2026-10-10", idCaso: null, nota: "Vista no painel do Mercado Pago.", ...o });
/** O resultado de sucesso (a recusa vira erro do teste, com o texto dela). */
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};

/** "Registrar quem arca" com a versão e a assinatura da prévia de agora. */
async function decidir(contestacaoId: string, quemArca: "proprietario" | "scl" | "proporcional", quando: Date) {
  const pv = ok(await previaDaDecisao(db, c.org, contestacaoId));
  ok(await registrarDecisao(db, c.org, contestacaoId, { causa: "imovel", quemArca, nota: "Decisão da equipe.", explicacao: "O ar-condicionado parou na estadia.", versao: pv.fatos.versao, assinatura: pv.fatos.opcoes[quemArca]?.assinatura ?? "" }, equipe, quando));
}

/** "Confirmar o resultado" com a proposta da prévia (sem provedor: segue com a nota "não deu para conferir"). */
async function confirmar(contestacaoId: string, resultado: "ganha" | "perdida", quando: Date) {
  const pv = ok(await previaDoResultado(db, c.org, contestacaoId));
  const perdida = resultado === "perdida" ? { valorPerdido: pv.fatos.proposta.valorPerdido, liquidoNaoEntrou: pv.fatos.proposta.liquidoNaoEntrou, debitoEm: pv.fatos.proposta.debitoEm } : {};
  ok(
    await confirmarResultado(
      db,
      c.org,
      contestacaoId,
      { resultado, data: hojeISO("America/Sao_Paulo", quando), nota: "Conferido no painel do Mercado Pago.", notaReforcada: false, versao: pv.fatos.versao, assinatura: pv.fatos.assinatura, tarifa: null, ...perdida },
      equipe,
      null,
      quando,
    ),
  );
}

describe("dados pessoais nas tabelas da disputa (item 28)", () => {
  it("a varredura cobre as disputas e a linha do tempo delas: um valor plantado em cada uma é achado", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    const r = ok(await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, registro(), equipe, null, minutos(20)));
    expect(await semDadosPessoais(db, ["canario.linha@example.com", "canario.evento@example.com"])).toEqual([]);
    // Fora do domínio (que valida toda nota): só para provar que a varredura lê as duas tabelas.
    await db.update(contestacoesPagamento).set({ notaRegistro: "canario.linha@example.com" }).where(eq(contestacoesPagamento.id, r.contestacaoId));
    const [plantado] = await db.insert(eventosContestacao).values({ contestacaoId: r.contestacaoId, fonte: "sistema", tipo: "valor", depois: { nota: "canario.evento@example.com" }, em: minutos(21) }).returning({ id: eventosContestacao.id });
    expect(await semDadosPessoais(db, ["canario.linha@example.com", "canario.evento@example.com"])).toEqual(["canario.linha@example.com", "canario.evento@example.com"]);
    // A linha volta ao que o domínio gravou; o evento plantado fica com um texto neutro (a linha do tempo nunca é apagada).
    await db.update(contestacoesPagamento).set({ notaRegistro: "Vista no painel do Mercado Pago." }).where(eq(contestacoesPagamento.id, r.contestacaoId));
    await db.update(eventosContestacao).set({ depois: { nota: "neutro" } }).where(eq(eventosContestacao.id, plantado.id));
  });

  it("depois de aberta → ganha, aberta → perdida, sem identificação → com caso, registro da equipe, MED, duplicata e reabertura: nada do hóspede nem do titular", async () => {
    const emails = ["a.ganha@example.com", "b.perdida@example.com", "c.semid@example.com", "d.equipe@example.com", "e.med@example.com"];

    // A: Pix, a disputa aberta pela leitura da order, decidida, ganha; a leitura seguinte ainda a mostra em andamento e a
    // equipe a reabre (rodada 2).
    const a = await pagarEConfirmar(c, { email: emails[0] });
    c.provedor.contestar(a.idProvedor, "order", { motivoId: "4853", motivoCodigo: "Visitante Fictício não reconhece a cobrança" });
    await conferir(a.pagamentoId, minutos(20));
    // O "Conferir agora" do quadro lê também o caso na Chargebacks API: o motivo em frase nunca passa; o número, sim.
    await conferirContestacoesDoPagamento(db, c.org, a.pagamentoId, c.provedor, minutos(25));
    const [la] = await linhas(a.pagamentoId);
    expect(la).toMatchObject({ situacao: "aberta", origem: "leitura", motivoId: "4853", motivoCodigo: null });
    await decidir(la.id, "proporcional", minutos(30));
    await confirmar(la.id, "ganha", minutos(40));
    await conferir(a.pagamentoId, minutos(50));
    expect((await linhas(a.pagamentoId))[0].avisos).toContain("contestacao_resultado_mudou");
    ok(await conferirAviso(db, c.org, la.id, { como: "reaberta", nota: "Reapresentação pelo banco." }, equipe, minutos(55)));
    expect((await linhas(a.pagamentoId)).map((l) => [l.situacao, l.rodada])).toEqual([["ganha", 1], ["aberta", 2]]);

    // B: cartão, a disputa aberta pela leitura, o débito confirmado, a decisão e a perdida.
    const b = await pagarEConfirmar(c, { forma: "cartao", entrada: "2026-10-20", saida: "2026-10-23", email: emails[1] });
    c.provedor.contestar(b.idProvedor, "transacao");
    await conferir(b.pagamentoId, minutos(20));
    const [lb] = await linhas(b.pagamentoId);
    ok(await confirmarDebito(db, c.org, lb.id, { data: "2026-10-01", valor: lb.valorEmRisco, nota: "" }, equipe, minutos(25)));
    await decidir(lb.id, "proprietario", minutos(30));
    await confirmar(lb.id, "perdida", minutos(40));
    expect((await linhas(b.pagamentoId))[0]).toMatchObject({ situacao: "perdida", decisaoVersao: 1 });

    // C: a order contestada sem o item da lista (a leitura vem sem identificação); depois a lista traz o caso e a mesma
    // linha é completada.
    const cc = await pagarEConfirmar(c, { entrada: "2026-10-26", saida: "2026-10-29", email: emails[2] });
    const ids = c.provedor.contestar(cc.idProvedor, "order", { naLista: false });
    await conferir(cc.pagamentoId, minutos(20));
    expect((await linhas(cc.pagamentoId)).map((l) => [l.idCaso, l.idContestacao])).toEqual([[null, null]]);
    c.provedor.mostrarNaLista(ids.idCbk);
    await conferir(cc.pagamentoId, minutos(30));
    expect((await linhas(cc.pagamentoId)).map((l) => [l.idCaso, l.idContestacao])).toEqual([[ids.idCaso, ids.idCbk]]);

    // D: registro da equipe (sem provedor); outra disputa no mesmo pagamento nasce possível duplicata e é confirmada.
    const d = await pagarEConfirmar(c, { forma: "cartao", entrada: "2026-11-02", saida: "2026-11-05", email: emails[3] });
    ok(await registrarContestacaoDaEquipe(db, c.org, d.pagamentoId, registro(), equipe, null, minutos(20)));
    const dup = ok(await registrarContestacaoDaEquipe(db, c.org, d.pagamentoId, registro({ tipo: "reclamacao", valor: 30_000, idCaso: "7123456789", prazo: null }), equipe, null, minutos(21)));
    expect((await linhas(d.pagamentoId))[1]).toMatchObject({ duplicataPossivel: true, valorEmRisco: 0 });
    ok(await confirmarOutraDisputa(db, c.org, dup.contestacaoId, equipe, minutos(22)));

    // E: Pix devolvido no painel do Mercado Pago (o D21) e o MED registrado pela equipe.
    const e = await pagarEConfirmar(c, { entrada: "2026-11-09", saida: "2026-11-12", email: emails[4] });
    c.provedor.devolverNoProvedor(e.idProvedor, TOTAL);
    await conferir(e.pagamentoId, minutos(20));
    ok(await registrarContestacaoDaEquipe(db, c.org, e.pagamentoId, registro({ tipo: "med", valor: TOTAL, idCaso: null }), equipe, c.provedor, minutos(30)));
    expect((await linhas(e.pagamentoId))[0]).toMatchObject({ tipo: "med", origem: "equipe" });

    // A varredura não é vazia: as sete linhas e a linha do tempo de cada fluxo estão lá.
    const pagamentoIds = [a, b, cc, d, e].map((p) => p.pagamentoId);
    const todas = await db.select().from(contestacoesPagamento).where(inArray(contestacoesPagamento.pagamentoId, pagamentoIds));
    expect(todas).toHaveLength(7);
    const tipos = new Set((await db.select().from(eventosContestacao).where(inArray(eventosContestacao.contestacaoId, todas.map((l) => l.id)))).map((ev) => ev.tipo));
    for (const t of ["aberta", "decisao", "debito_confirmado", "resultado", "reaberta", "outra_disputa"]) expect(tipos).toContain(t);

    // Nada do hóspede (nome, e-mails, telefone) nem do titular do cartão (token, documento, aparelho), e nunca o motivo em
    // texto livre.
    expect(await semDadosPessoais(db, [EMAIL_HOSPEDE, ...emails, TELEFONE_HOSPEDE, TOKEN_FICTICIO, DOCUMENTO_FICTICIO, DISPOSITIVO_FICTICIO, "não reconhece a cobrança"], { nomes: [NOME_HOSPEDE] })).toEqual([]);
  });
});
