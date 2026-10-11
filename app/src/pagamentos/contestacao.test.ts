/**
 * Contestação do pagamento no site (M8.2e) — a rotina das disputas (releitura diária, busca tardia semanal, fila que anda na
 * falha, 403, dia 85 sem fonte, 240 dias, limite por volta e orçamento, depois dos holds, "Conferir agora" de um pagamento),
 * o registro pela equipe e os e-mails à equipe, em PGlite com o Mercado Pago falso (sem rede).
 * Itens 20 e 22 de "Testes a escrever" (PAGAMENTO-SITE.md, "Contestação (M8.2e)").
 */
import { asc, eq, ne } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { lerEmpresa, salvarEmpresa } from "@/configuracoes/empresa";
import { contestacoesPagamento, cotacoes, eventosContestacao, pagamentos } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import { avisosDeContestacao } from "@/painel/dashboard";
import type { Db } from "@/db/types";
import { CorreioMemoria } from "@/email/correio";
import { conferirTentativa } from "./conferencia";
import {
  avisarEquipeDasContestacoes,
  buscarContestacoesTardias,
  conferirContestacoes,
  conferirContestacoesDoPagamento,
  type EntradaRegistroDisputa,
  previaDoResultado,
  registrarContestacaoDaEquipe,
  TEXTO_MED_SO_NO_PIX,
} from "./contestacao";
import { LEITURAS_DE_CONTESTACAO_POR_VOLTA, NOTA_SEM_LEITURA, TEXTO_CASO_DE_OUTRO_PAGAMENTO, TEXTO_DISPUTA_JA_NO_QUADRO } from "./contestacao-regras";
import { ErroProvedor } from "./provedor";
import { rotinaDoSite } from "./rotina";
import { type Cenario, envelhecer, minutos, montarCenario, pagarEConfirmar, semDadosDoHospede, TOTAL, usuarioDeTeste } from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario, equipe: string;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  c = await montarCenario(db);
  equipe = await usuarioDeTeste(c);
});
afterEach(async () => {
  expect(await semDadosDoHospede(db)).toEqual([]);
});

const DIA = 86_400_000;
const dias = (n: number, de = minutos(0)) => new Date(de.getTime() + n * DIA);
const conferir = (id: string, quando: Date) => conferirTentativa(db, c.org, id, c.provedor, quando, { origem: "rotina", forcar: true });
const linhas = (pagamentoId: string) => db.select().from(contestacoesPagamento).where(eq(contestacoesPagamento.pagamentoId, pagamentoId)).orderBy(asc(contestacoesPagamento.abertaEm), asc(contestacoesPagamento.id));
const chamadas = (metodo: string) => c.provedor.chamadas.filter((x) => x.metodo === metodo);
const entrada = (o: Partial<EntradaRegistroDisputa> = {}): EntradaRegistroDisputa => ({ tipo: "chargeback", abertaEm: "2026-10-01", valor: 50_000, prazo: "2026-10-20", idCaso: null, nota: "Vista no painel do Mercado Pago", ...o });
/** Um cartão pago e contestado, lido pela order (a linha nasce com o número do caso). */
async function contestado(over: Parameters<typeof pagarEConfirmar>[1] = {}) {
  const x = await pagarEConfirmar(c, { forma: "cartao", ...over });
  const ids = c.provedor.contestar(x.idProvedor);
  await conferir(x.pagamentoId, minutos(10));
  return { ...x, ...ids };
}

describe("rotina das disputas (item 20)", () => {
  it("depois dos 85 dias: relida uma vez por dia pela Chargebacks API (pelo caso) e pela Payments API (pelo número)", async () => {
    const x = await contestado();
    await envelhecer(c, x.pagamentoId, 90);
    c.provedor.resolverContestacao(x.idCaso, { estado: "settled", cobertura: true });
    // Ainda não é a vez dela (relida há menos de um dia): nada é lido.
    expect(await conferirContestacoes(db, c.org, c.provedor, minutos(60))).toMatchObject({ lidas: 0 });
    const r = await conferirContestacoes(db, c.org, c.provedor, dias(2));
    expect(r).toMatchObject({ lidas: 1, mudaram: 1, falhas: 0 });
    expect(chamadas("consultarContestacao").map((x) => x.id)).toEqual([x.idCaso]);
    expect(chamadas("situacaoDoPagamento")).toHaveLength(1);
    // A order não é mais lida depois dos 85 dias.
    expect(chamadas("consultar").filter((ch) => ch.id === x.idProvedor && c.provedor.chamadas.indexOf(ch) > c.provedor.chamadas.indexOf(chamadas("consultarContestacao")[0]))).toEqual([]);
    const [l] = await linhas(x.pagamentoId);
    expect(l).toMatchObject({ situacao: "a_confirmar", coberturaAplicada: true, falhasLeitura: 0, consultadaEm: dias(2), proximaLeituraEm: dias(3) });
  });

  it("a fila anda também na falha: espera crescente (1, 2, 4 dias); a leitura boa zera", async () => {
    const x = await contestado();
    c.provedor.falhas.consultarContestacao = new ErroProvedor("incerto", "sem resposta");
    await conferirContestacoes(db, c.org, c.provedor, dias(2));
    expect((await linhas(x.pagamentoId))[0]).toMatchObject({ falhasLeitura: 1, proximaLeituraEm: dias(3) });
    await conferirContestacoes(db, c.org, c.provedor, dias(3));
    expect((await linhas(x.pagamentoId))[0]).toMatchObject({ falhasLeitura: 2, proximaLeituraEm: dias(5) });
    await conferirContestacoes(db, c.org, c.provedor, dias(5));
    expect((await linhas(x.pagamentoId))[0]).toMatchObject({ falhasLeitura: 3, proximaLeituraEm: dias(9) });
    c.provedor.falhas.consultarContestacao = null;
    await conferirContestacoes(db, c.org, c.provedor, dias(9));
    expect((await linhas(x.pagamentoId))[0]).toMatchObject({ falhasLeitura: 0, proximaLeituraEm: dias(10) });
  });

  it("a falha na leitura de um caso não impede os outros casos do pagamento; só a disputa dele conta a falha", async () => {
    const x = await contestado();
    await envelhecer(c, x.pagamentoId, 100);
    const numero = (await c.tentativa(x.pagamentoId)).idPagamentoProvedor!;
    // Uma segunda contestação no mesmo pagamento, achada pela busca tardia (possível duplicata, com o seu caso).
    const outro = c.provedor.contestarTarde(numero, { valor: 20_000 });
    expect(await buscarContestacoesTardias(db, c.org, c.provedor, minutos(30))).toMatchObject({ novas: 1 });
    // A do primeiro caso vem antes na fila.
    await db.update(contestacoesPagamento).set({ proximaLeituraEm: minutos(40) }).where(eq(contestacoesPagamento.idCaso, x.idCaso));
    await db.update(contestacoesPagamento).set({ proximaLeituraEm: minutos(41) }).where(eq(contestacoesPagamento.idCaso, outro.idCaso));
    c.provedor.resolverContestacao(outro.idCaso, { estado: "settled", cobertura: true });
    const lidos: string[] = [];
    const original = c.provedor.consultarContestacao.bind(c.provedor);
    c.provedor.consultarContestacao = async (id: string) => {
      lidos.push(id);
      if (id === x.idCaso) throw new ErroProvedor("incerto", "Resposta ilegível.");
      return original(id);
    };
    const r = await conferirContestacoes(db, c.org, c.provedor, dias(2));
    c.provedor.consultarContestacao = original;
    expect(lidos).toEqual([x.idCaso, outro.idCaso]);
    expect(r).toMatchObject({ lidas: 2, falhas: 1 });
    const daFalha = (await linhas(x.pagamentoId)).find((l) => l.idCaso === x.idCaso)!;
    const lida = (await linhas(x.pagamentoId)).find((l) => l.idCaso === outro.idCaso)!;
    expect(daFalha).toMatchObject({ situacao: "aberta", falhasLeitura: 1 });
    expect(lida).toMatchObject({ situacao: "a_confirmar", coberturaAplicada: true, falhasLeitura: 0 });
  });

  it("403 da Chargebacks API: aviso contestacao_sem_leitura, uma vez", async () => {
    const x = await contestado();
    c.provedor.respostaChargebacks.consultarContestacao = "403";
    await conferirContestacoes(db, c.org, c.provedor, dias(2));
    await conferirContestacoes(db, c.org, c.provedor, dias(4));
    const [l] = await linhas(x.pagamentoId);
    expect(l.avisos.filter((a) => a === "contestacao_sem_leitura")).toHaveLength(1);
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("contestacao_sem_leitura");
  });

  it("depois dos 85 dias, a liberação que a Payments API mostra num pagamento em disputa liga o aviso que pede o registro à mão; o \"pending\" não (Codex, 11/10)", async () => {
    const x = await contestado();
    await envelhecer(c, x.pagamentoId, 90);
    // Ainda não liberado no Mercado Pago (money_release_status "pending"): nada a pedir.
    c.provedor.atualizarFinanceiro(x.idProvedor, { liberado: false });
    await conferirContestacoes(db, c.org, c.provedor, dias(2));
    expect((await linhas(x.pagamentoId))[0].avisos).not.toContain("contestacao_liberacao_lida");
    // Liberado ("released"), sem recebimento no sistema: o aviso, na disputa e no pagamento.
    c.provedor.atualizarFinanceiro(x.idProvedor, { liberado: true });
    await conferirContestacoes(db, c.org, c.provedor, dias(4));
    expect(chamadas("situacaoDoPagamento")).toHaveLength(2);
    const [l] = await linhas(x.pagamentoId);
    expect(l.avisos).toContain("contestacao_liberacao_lida");
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("contestacao_liberacao_lida");
    // A proposta do resultado não supõe que o líquido nunca entrou.
    const pv = await previaDoResultado(db, c.org, l.id);
    expect(pv.ok && pv.fatos.proposta.liquidoNaoEntrou).toBeNull();
  });

  it("depois dos 85 dias, a Payments API é lida com uma reclamação ao lado da contestação no cartão, e vale só para a do cartão", async () => {
    const x = await contestado();
    expect(await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, entrada({ tipo: "reclamacao" }), equipe, null, minutos(20))).toMatchObject({ ok: true });
    await envelhecer(c, x.pagamentoId, 90);
    // A Chargebacks API não acha o caso: a única fonte da contestação no cartão é a Payments API pelo número.
    c.provedor.respostaChargebacks.consultarContestacao = "404";
    c.provedor.resolverContestacao(x.idCaso, { estado: "settled" });
    await conferirContestacoes(db, c.org, c.provedor, dias(2));
    expect(chamadas("situacaoDoPagamento")).toHaveLength(1);
    const [cartao, reclamacao] = await linhas(x.pagamentoId);
    expect(cartao).toMatchObject({ tipo: "chargeback", situacao: "a_confirmar", estadoLido: "settled" });
    expect(cartao.avisos).not.toContain("contestacao_sem_fonte");
    // A reclamação não recebe a leitura do cartão (nada da Payments API fala dela): continua aberta, sem fonte.
    expect(reclamacao).toMatchObject({ tipo: "reclamacao", situacao: "aberta" });
    expect(reclamacao.avisos).toContain("contestacao_sem_fonte");
    expect((await db.select({ avisos: pagamentos.avisos }).from(pagamentos).where(eq(pagamentos.id, x.pagamentoId)))[0].avisos).not.toContain("contestacao_ambigua");
  });

  it("a busca pelo número do pagamento roda também quando só uma das disputas tem caso: a disputa achada que não casa com segurança vira a ambígua", async () => {
    const x = await contestado();
    expect(await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, entrada({ tipo: "reclamacao" }), equipe, null, minutos(20))).toMatchObject({ ok: true });
    await envelhecer(c, x.pagamentoId, 90);
    const numero = (await c.tentativa(x.pagamentoId)).idPagamentoProvedor!;
    // No Mercado Pago, um caso que o quadro não conhece (a reclamação foi registrada sem o número); o do cartão encerrou.
    c.provedor.contestarTarde(numero, { valor: 20_000 });
    c.provedor.resolverContestacao(x.idCaso, { estado: "settled" });
    await conferirContestacoes(db, c.org, c.provedor, dias(2));
    // O caso conhecido pelo número e, pela reclamação sem número, a busca do pagamento (o caso já lido não entra de novo).
    expect(chamadas("consultarContestacao").map((ch) => ch.id)).toEqual([x.idCaso]);
    expect(chamadas("buscarContestacoes").map((ch) => ch.id)).toEqual([numero]);
    const [cartao, reclamacao] = await linhas(x.pagamentoId);
    expect(cartao.avisos).not.toContain("contestacao_sem_fonte");
    // Duas disputas não finais: o caso novo não se liga a nenhuma com segurança, e a equipe fica sabendo (nada é criado).
    expect(reclamacao).toMatchObject({ tipo: "reclamacao", situacao: "aberta", idCaso: null });
    expect(reclamacao.avisos).toContain("contestacao_sem_fonte");
    expect(await linhas(x.pagamentoId)).toHaveLength(2);
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("contestacao_ambigua");
  });

  it("depois dos 85 dias, a resposta útil do caso de uma disputa não apaga o sem fonte de outra do mesmo pagamento sem caso", async () => {
    const x = await contestado();
    // Uma segunda contestação no cartão, registrada pela equipe sem o número do caso (possível duplicata até a equipe confirmar).
    expect(await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, entrada(), equipe, null, minutos(20))).toMatchObject({ ok: true });
    await envelhecer(c, x.pagamentoId, 90);
    c.provedor.resolverContestacao(x.idCaso, { estado: "settled", cobertura: true });
    await conferirContestacoes(db, c.org, c.provedor, dias(2));
    const [comCaso, semCaso] = await linhas(x.pagamentoId);
    expect(comCaso).toMatchObject({ idCaso: x.idCaso, situacao: "a_confirmar", coberturaAplicada: true });
    expect(comCaso.avisos).not.toContain("contestacao_sem_fonte");
    // Nada leu a outra (a busca só achou o caso já conhecido; a situação do pagamento não diz de qual das duas fala).
    expect(semCaso).toMatchObject({ tipo: "chargeback", situacao: "aberta", idCaso: null });
    expect(semCaso.avisos).toContain("contestacao_sem_fonte");
  });

  it("depois dos 85 dias, o \"voltou a aprovado\" da Payments API vale para a contestação achada tarde (o pagamento continua aprovado)", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    await envelhecer(c, x.pagamentoId, 100);
    const numero = (await c.tentativa(x.pagamentoId)).idPagamentoProvedor!;
    c.provedor.contestarTarde(numero, { valor: 40_000 });
    expect(await buscarContestacoesTardias(db, c.org, c.provedor, minutos(30))).toMatchObject({ novas: 1 });
    // A disputa nasce pela Chargebacks API, sem mudar a situação do pagamento.
    expect((await c.tentativa(x.pagamentoId)).situacao).toBe("aprovado");
    // O Mercado Pago resolve a favor: a transação volta a aprovada, e a Chargebacks API não acha mais o caso.
    c.provedor.respostaChargebacks.consultarContestacao = "404";
    c.provedor.situacaoDoPagamento = async () => ({ status: "approved", statusDetail: "accredited", moneyReleaseStatus: null });
    await conferirContestacoes(db, c.org, c.provedor, dias(2));
    const [l] = await linhas(x.pagamentoId);
    expect(l).toMatchObject({ situacao: "a_confirmar", origem: "leitura" });
    expect(l.avisos).not.toContain("contestacao_sem_fonte");
  });

  it("depois dos 85 dias, o \"voltou a aprovado\" vale também para a contestação registrada pela equipe", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    expect(await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, entrada(), equipe, null, minutos(20))).toMatchObject({ ok: true });
    await envelhecer(c, x.pagamentoId, 90);
    expect((await c.tentativa(x.pagamentoId)).situacao).toBe("aprovado");
    c.provedor.situacaoDoPagamento = async () => ({ status: "approved", statusDetail: "accredited", moneyReleaseStatus: null });
    await conferirContestacoes(db, c.org, c.provedor, dias(2));
    const [l] = await linhas(x.pagamentoId);
    expect(l).toMatchObject({ situacao: "a_confirmar", origem: "equipe" });
    expect(l.avisos).not.toContain("contestacao_sem_fonte");
  });

  it("antes dos 85 dias, a order aprovada sem disputa listada também é o \"voltou a aprovado\" da contestação registrada pela equipe (Codex, 11/10)", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    expect(await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, entrada(), equipe, null, minutos(20))).toMatchObject({ ok: true });
    expect((await c.tentativa(x.pagamentoId)).situacao).toBe("aprovado");
    // A leitura da order (dentro dos 85 dias): aprovada, sem nenhuma contestação listada.
    await conferirContestacoes(db, c.org, c.provedor, dias(2));
    const [l] = await linhas(x.pagamentoId);
    expect(l).toMatchObject({ situacao: "a_confirmar", origem: "equipe" });
    // A Payments API não foi chamada: a order ainda é lida.
    expect(chamadas("situacaoDoPagamento")).toEqual([]);
  });

  it("dia 85 sem fonte: sem caso nem número do pagamento, o aviso contestacao_sem_fonte (em vez de esperar os 240 dias)", async () => {
    const x = await pagarEConfirmar(c);
    expect(await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, entrada({ tipo: "med" }), equipe, null, minutos(20))).toMatchObject({ ok: true });
    await db.update(pagamentos).set({ idPagamentoProvedor: null }).where(eq(pagamentos.id, x.pagamentoId));
    await envelhecer(c, x.pagamentoId, 90);
    await conferirContestacoes(db, c.org, c.provedor, dias(1));
    expect((await linhas(x.pagamentoId))[0].avisos).toContain("contestacao_sem_fonte");
    expect(chamadas("consultarContestacao")).toEqual([]);
  });

  it("240 dias da abertura: para de ler e avisa contestacao_fora_do_prazo, uma vez", async () => {
    const x = await contestado();
    await db.update(contestacoesPagamento).set({ abertaEm: dias(-241) }).where(eq(contestacoesPagamento.pagamentoId, x.pagamentoId));
    expect(await conferirContestacoes(db, c.org, c.provedor, dias(2))).toMatchObject({ foraDoPrazo: 1, lidas: 0 });
    expect(await conferirContestacoes(db, c.org, c.provedor, dias(3))).toMatchObject({ foraDoPrazo: 0, lidas: 0 });
    const [l] = await linhas(x.pagamentoId);
    expect(l).toMatchObject({ proximaLeituraEm: null });
    expect(l.avisos.filter((a) => a === "contestacao_fora_do_prazo")).toHaveLength(1);
    expect(chamadas("consultarContestacao")).toEqual([]);
  });

  it("240 dias com muitas de uma vez: até 50 por volta, das mais antigas, e só dentro do orçamento; o resto fica para a próxima (Codex, 11/10)", async () => {
    const x = await contestado();
    const [l0] = await linhas(x.pagamentoId);
    const base: Partial<typeof l0> = { ...l0 };
    delete base.id;
    await db.update(contestacoesPagamento).set({ abertaEm: dias(-300) }).where(eq(contestacoesPagamento.id, l0.id));
    // Mais 52 disputas que passaram dos 240 dias juntas (a rotina parada, um acúmulo): 53 no total.
    await db.insert(contestacoesPagamento).values(
      Array.from({ length: 52 }, (_, i) => ({ ...(base as Omit<typeof l0, "id">), idCaso: String(8_300_000_000 + i), idContestacao: null, duplicataPossivel: true, retidoLancamentoId: null, abertaEm: dias(-299 + i), avisos: [] })),
    );
    const marcadas = async () => (await linhas(x.pagamentoId)).filter((l) => l.avisos.includes("contestacao_fora_do_prazo"));
    // O orçamento da volta já acabou: nenhuma é marcada, nem a primeira.
    expect(await conferirContestacoes(db, c.org, c.provedor, dias(2), { relogio: () => 61_000, inicio: 0 })).toMatchObject({ foraDoPrazo: 0, lidas: 0 });
    expect(await marcadas()).toEqual([]);
    // Dentro do orçamento: as 50 mais antigas nesta volta; as 3 mais novas, na seguinte.
    expect(await conferirContestacoes(db, c.org, c.provedor, dias(2))).toMatchObject({ foraDoPrazo: LEITURAS_DE_CONTESTACAO_POR_VOLTA });
    const primeiras = await marcadas();
    expect(primeiras).toHaveLength(LEITURAS_DE_CONTESTACAO_POR_VOLTA);
    const maisNovaMarcada = Math.max(...primeiras.map((l) => l.abertaEm.getTime()));
    const restantes = (await linhas(x.pagamentoId)).filter((l) => !l.avisos.includes("contestacao_fora_do_prazo"));
    expect(restantes).toHaveLength(3);
    expect(restantes.every((l) => l.abertaEm.getTime() > maisNovaMarcada)).toBe(true);
    expect(await conferirContestacoes(db, c.org, c.provedor, dias(3))).toMatchObject({ foraDoPrazo: 3 });
    expect(await marcadas()).toHaveLength(53);
    expect(chamadas("consultarContestacao")).toEqual([]);
  });

  it("no máximo 50 por volta, em ordem de proxima_leitura_em; o orçamento de tempo para a volta", async () => {
    const x = await contestado();
    const [l0] = await linhas(x.pagamentoId);
    // Mais 52 disputas antigas no mesmo pagamento (ids de caso distintos), já na vez delas.
    const base: Partial<typeof l0> = { ...l0 };
    delete base.id;
    await db.insert(contestacoesPagamento).values(
      Array.from({ length: 52 }, (_, i) => ({ ...(base as Omit<typeof l0, "id">), idCaso: String(8_100_000_000 + i), idContestacao: null, duplicataPossivel: true, retidoLancamentoId: null, proximaLeituraEm: minutos(i), avisos: [] })),
    );
    expect(await conferirContestacoes(db, c.org, c.provedor, dias(2))).toMatchObject({ lidas: LEITURAS_DE_CONTESTACAO_POR_VOLTA });
    // O orçamento é conferido antes de cada chamada, também entre os casos do mesmo pagamento: o relógio anda 12 s por caso.
    const y = await contestado({ entrada: "2026-11-02", saida: "2026-11-05", email: "outro@example.com" });
    let relogio = 0;
    const original = c.provedor.consultarContestacao.bind(c.provedor);
    c.provedor.consultarContestacao = async (id: string) => {
      relogio += 12_000;
      return original(id);
    };
    const antes = chamadas("consultarContestacao").length;
    const r = await conferirContestacoes(db, c.org, c.provedor, dias(4), { relogio: () => relogio });
    c.provedor.consultarContestacao = original;
    // Cinco casos (aos 0, 12, 24, 36 e 48 s); antes do sexto o minuto acabou: a volta para no meio do primeiro pagamento.
    expect(chamadas("consultarContestacao").length - antes).toBe(5);
    expect(r.lidas).toBe(5);
    expect((await linhas(x.pagamentoId)).filter((l) => l.consultadaEm?.getTime() === dias(4).getTime())).toHaveLength(5);
    expect((await linhas(y.pagamentoId))[0].consultadaEm).toEqual(minutos(10));
    // A volta seguinte (sem o relógio estourado) segue de onde parou e chega no segundo pagamento.
    await conferirContestacoes(db, c.org, c.provedor, dias(4));
    expect((await linhas(y.pagamentoId))[0].consultadaEm).toEqual(dias(4));
  });

  it("a releitura e a busca tardia da mesma volta dividem um orçamento só de 60 s (Codex, 11/10)", async () => {
    const x = await contestado();
    const [l0] = await linhas(x.pagamentoId);
    const base: Partial<typeof l0> = { ...l0 };
    delete base.id;
    await db.insert(contestacoesPagamento).values(
      Array.from({ length: 9 }, (_, i) => ({ ...(base as Omit<typeof l0, "id">), idCaso: String(8_200_000_000 + i), idContestacao: null, duplicataPossivel: true, retidoLancamentoId: null, proximaLeituraEm: minutos(i), avisos: [] })),
    );
    // Um pagamento antigo, na janela da busca tardia.
    const velho = await pagarEConfirmar(c, { forma: "cartao", entrada: "2026-11-02", saida: "2026-11-05", email: "outro@example.com" });
    await envelhecer(c, velho.pagamentoId, 100);
    // O relógio anda 12 s por caso: a releitura gasta o minuto inteiro (cinco casos).
    let relogio = 0;
    const original = c.provedor.consultarContestacao.bind(c.provedor);
    c.provedor.consultarContestacao = async (id: string) => {
      relogio += 12_000;
      return original(id);
    };
    const antes = chamadas("buscarContestacoes").length;
    const r = await rotinaDoSite(db, c.provedor, dias(2), { correio: null, relogio: () => relogio });
    c.provedor.consultarContestacao = original;
    expect(r.contestacoes).toMatchObject({ lidas: 5, buscados: 0 });
    // A busca tardia não começou um minuto novo: fica para a próxima volta, com a vez do pagamento antigo intacta.
    expect(chamadas("buscarContestacoes").length - antes).toBe(0);
    expect((await c.tentativa(velho.pagamentoId)).contestacoesBuscadasEm).toBeNull();
  });

  it("uma chamada só começa se o tempo dela cabe no orçamento: a leitura da order (até 30 s) não começa aos 35 s; a busca tardia (8 s) não começa aos 55 s (Codex, 11/10)", async () => {
    const x = await contestado();
    const naOrder = () => chamadas("consultar").filter((ch) => ch.id === x.idProvedor).length;
    const antes = naOrder();
    const [l0] = await linhas(x.pagamentoId);
    // Aos 35 s da volta, a order e o financeiro (2 × 15 s) não cabem: nada é lido e a disputa continua na vez.
    expect(await conferirContestacoes(db, c.org, c.provedor, dias(2), { relogio: () => 35_000, inicio: 0 })).toMatchObject({ lidas: 0 });
    expect(naOrder()).toBe(antes);
    expect(chamadas("consultarContestacao")).toEqual([]);
    expect((await linhas(x.pagamentoId))[0]).toMatchObject({ consultadaEm: l0.consultadaEm, proximaLeituraEm: l0.proximaLeituraEm });
    // Aos 20 s, cabe: a order e o caso são lidos.
    expect(await conferirContestacoes(db, c.org, c.provedor, dias(2), { relogio: () => 20_000, inicio: 0 })).toMatchObject({ lidas: 1 });
    expect(naOrder()).toBe(antes + 1);
    // A busca tardia: aos 55 s, a chamada de 8 s não cabe (a vez fica intacta); aos 50 s, cabe.
    const velho = await pagarEConfirmar(c, { forma: "cartao", entrada: "2026-11-02", saida: "2026-11-05", email: "outro@example.com" });
    await envelhecer(c, velho.pagamentoId, 100);
    expect(await buscarContestacoesTardias(db, c.org, c.provedor, dias(2), { relogio: () => 55_000, inicio: 0 })).toMatchObject({ buscados: 0 });
    expect((await c.tentativa(velho.pagamentoId)).contestacoesBuscadasEm).toBeNull();
    expect(await buscarContestacoesTardias(db, c.org, c.provedor, dias(2), { relogio: () => 50_000, inicio: 0 })).toMatchObject({ buscados: 1 });
  });

  it("busca tardia semanal, de todo desfecho, na janela, reservada pela coluna", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    const numero = (await c.tentativa(x.pagamentoId)).idPagamentoProvedor!;
    // Antes dos 80 dias: fora da janela.
    expect(await buscarContestacoesTardias(db, c.org, c.provedor, minutos(30))).toMatchObject({ buscados: 0 });
    await envelhecer(c, x.pagamentoId, 100);
    expect(await buscarContestacoesTardias(db, c.org, c.provedor, minutos(30))).toMatchObject({ buscados: 1, novas: 0 });
    expect((await c.tentativa(x.pagamentoId)).contestacoesBuscadasEm).toEqual(minutos(30));
    // Na mesma semana, nada; a falha devolve a marca.
    expect(await buscarContestacoesTardias(db, c.org, c.provedor, dias(3))).toMatchObject({ buscados: 0 });
    c.provedor.respostaChargebacks.buscarContestacoes = "falha";
    expect(await buscarContestacoesTardias(db, c.org, c.provedor, dias(8))).toMatchObject({ buscados: 1, falhas: 1 });
    expect((await c.tentativa(x.pagamentoId)).contestacoesBuscadasEm).toEqual(minutos(30));
    c.provedor.respostaChargebacks.buscarContestacoes = null;
    c.provedor.contestarTarde(numero, { valor: 40_000 });
    expect(await buscarContestacoesTardias(db, c.org, c.provedor, dias(8))).toMatchObject({ buscados: 1, novas: 1 });
    expect((await linhas(x.pagamentoId))[0]).toMatchObject({ situacao: "aberta", origem: "leitura", valor: 40_000, valorEmRisco: 40_000 });
    expect(chamadas("buscarContestacoes").every((ch) => ch.id === numero)).toBe(true);
    // De qualquer desfecho com dinheiro: um pagamento já devolvido (desfecho devolução) também é procurado.
    const z = await pagarEConfirmar(c, { entrada: "2026-11-02", saida: "2026-11-05", email: "z@example.com" });
    await db.update(pagamentos).set({ situacao: "devolvido", desfecho: "devolucao" }).where(eq(pagamentos.id, z.pagamentoId));
    await envelhecer(c, z.pagamentoId, 100);
    expect(await buscarContestacoesTardias(db, c.org, c.provedor, dias(9))).toMatchObject({ buscados: 1 });
    expect(chamadas("buscarContestacoes").at(-1)!.id).toBe((await c.tentativa(z.pagamentoId)).idPagamentoProvedor);
  });

  it("403 na busca tardia: a vez fica gasta, mas o pagamento ganha o aviso (no Início) até a busca voltar a responder", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    await envelhecer(c, x.pagamentoId, 100);
    c.provedor.respostaChargebacks.buscarContestacoes = "403";
    expect(await buscarContestacoesTardias(db, c.org, c.provedor, minutos(30))).toMatchObject({ buscados: 1, novas: 0 });
    const p = await c.tentativa(x.pagamentoId);
    expect(p.contestacoesBuscadasEm).toEqual(minutos(30));
    expect(p.avisos).toContain("contestacao_busca_sem_acesso");
    const alerta = (await avisosDeContestacao(db, c.org, minutos(30))).find((a) => a.texto.includes("procurar disputas"));
    expect(alerta).toMatchObject({ nivel: "atencao", link: `/painel/reservas/${p.reservaId}` });
    // A próxima busca (uma semana depois) responde: o aviso sai.
    c.provedor.respostaChargebacks.buscarContestacoes = null;
    expect(await buscarContestacoesTardias(db, c.org, c.provedor, dias(8))).toMatchObject({ buscados: 1 });
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("contestacao_busca_sem_acesso");
    expect((await avisosDeContestacao(db, c.org, dias(8))).some((a) => a.texto.includes("procurar disputas"))).toBe(false);
  });

  it("roda depois dos holds (o vencimento não espera o Mercado Pago); \"Conferir agora\" de um pagamento só lê aquele", async () => {
    const a = await contestado();
    const b = await contestado({ entrada: "2026-11-02", saida: "2026-11-05", email: "outro@example.com" });
    // Um pedido segurado e vencido: na hora da leitura da disputa, a rotina já o venceu.
    const s = await c.segurar({ entrada: "2026-11-10", saida: "2026-11-12", email: "terceiro@example.com" }, minutos(0));
    const original = c.provedor.consultarContestacao.bind(c.provedor);
    let situacaoNaLeitura: string | null = null;
    c.provedor.consultarContestacao = async (id: string) => {
      situacaoNaLeitura ??= (await db.select({ estado: cotacoes.estado }).from(cotacoes).where(eq(cotacoes.id, s.cotacaoId)))[0].estado;
      return original(id);
    };
    // As disputas das outras empresas do banco de teste ficam fora da vez (a rotina lê todas as empresas).
    await db.update(contestacoesPagamento).set({ proximaLeituraEm: dias(1000) }).where(ne(contestacoesPagamento.organizacaoId, c.org));
    const r = await rotinaDoSite(db, c.provedor, dias(2), { correio: null });
    expect(r.contestacoes).toMatchObject({ lidas: 2 });
    expect(situacaoNaLeitura).toBe("expirada");
    c.provedor.consultarContestacao = original;
    const antes = chamadas("consultarContestacao").length;
    await conferirContestacoesDoPagamento(db, c.org, a.pagamentoId, c.provedor, dias(2));
    const depois = chamadas("consultarContestacao").slice(antes);
    expect(depois.map((x) => x.id)).toEqual([a.idCaso]);
    expect(depois.map((x) => x.id)).not.toContain(b.idCaso);
  });
});

describe("registro pela equipe (item 22)", () => {
  it("relê antes (order e Chargebacks API); não duplica a disputa que a leitura já trouxe", async () => {
    const x = await contestado();
    const antes = c.provedor.chamadas.length;
    expect(await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, entrada({ idCaso: x.idCaso }), equipe, c.provedor, minutos(20))).toEqual({ ok: false, erro: TEXTO_DISPUTA_JA_NO_QUADRO });
    expect(c.provedor.chamadas.slice(antes).map((ch) => ch.metodo)).toEqual(expect.arrayContaining(["consultar", "consultarContestacao"]));
    expect(await linhas(x.pagamentoId)).toHaveLength(1);
  });

  it("caso de outro pagamento: recusado com a frase, nada gravado", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    const { idCaso } = c.provedor.contestar(x.idProvedor, "lista");
    c.provedor.casoDeOutroPagamento(idCaso);
    // A disputa da order ainda não foi lida; o caso informado é de outro pagamento.
    expect(await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, entrada({ idCaso }), equipe, c.provedor, minutos(20))).toEqual({ ok: false, erro: TEXTO_CASO_DE_OUTRO_PAGAMENTO });
  });

  it("sem provedor, segue com a nota \"sem leitura do Mercado Pago\"; a linha nasce aberta, de origem equipe, com o prazo; o e-mail à equipe uma vez", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    await salvarEmpresa(db, c.org, { ...(await lerEmpresa(db, c.org)), email: "equipe@example.com" }, null);
    const correio = new CorreioMemoria();
    const r = await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, entrada(), equipe, null, minutos(20), { correio });
    expect(r).toMatchObject({ ok: true });
    const [l] = await linhas(x.pagamentoId);
    expect(l).toMatchObject({ origem: "equipe", tipo: "chargeback", situacao: "aberta", valor: 50_000, valorOrigem: "equipe", valorEmRisco: 50_000, notaRegistro: `Vista no painel do Mercado Pago (${NOTA_SEM_LEITURA})` });
    expect(l.documentacaoPrazo).not.toBeNull();
    expect(l.avisos).not.toContain("contestacao_prazo_desconhecido");
    expect((await c.tentativa(x.pagamentoId)).situacao).toBe("aprovado");
    expect(correio.enviadas.map((m) => m.assunto)).toEqual([`Disputa do pagamento: reserva ${x.reservaCodigo}`]);
    expect(correio.enviadas[0].texto).not.toContain("example.com");
    // Uma vez: de novo, nada; no prazo dos documentos, o aviso dos dias e o do dia (cada um uma vez).
    expect(await avisarEquipeDasContestacoes(db, c.org, correio, minutos(30))).toBe(0);
    expect(await avisarEquipeDasContestacoes(db, c.org, correio, new Date("2026-10-17T12:00:00-03:00"))).toBe(1);
    expect(await avisarEquipeDasContestacoes(db, c.org, correio, new Date("2026-10-18T12:00:00-03:00"))).toBe(0);
    expect(await avisarEquipeDasContestacoes(db, c.org, correio, new Date("2026-10-20T12:00:00-03:00"))).toBe(1);
    expect(correio.enviadas).toHaveLength(3);
    const ev = await db.select().from(eventosContestacao).where(eq(eventosContestacao.contestacaoId, l.id));
    expect(ev.filter((e) => e.tipo === "email_equipe").map((e) => e.depois?.momento).sort()).toEqual(["abertura", "prazo_aviso", "prazo_dia"]);
    expect(ev.find((e) => e.tipo === "aberta")).toMatchObject({ fonte: "equipe", usuarioId: equipe });
  });

  it("o e-mail da abertura diz o dia em que a disputa abriu no Mercado Pago, não o do registro (Codex, 11/10)", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    await salvarEmpresa(db, c.org, { ...(await lerEmpresa(db, c.org)), email: "equipe@example.com" }, null);
    const correio = new CorreioMemoria();
    // Registrada em 06/10; aberta no painel do Mercado Pago em 03/10.
    expect(await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, entrada({ abertaEm: "2026-10-03" }), equipe, null, dias(5), { correio })).toMatchObject({ ok: true });
    expect(correio.enviadas).toHaveLength(1);
    expect(correio.enviadas[0].texto).toContain("aberta em 03/10.");
    expect(correio.enviadas[0].texto).not.toContain("06/10");
  });

  it("o prazo dos documentos nunca antes do dia em que a disputa abriu", async () => {
    const x = await pagarEConfirmar(c);
    const r = await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, entrada({ tipo: "med", abertaEm: "2026-10-01", prazo: "2026-09-30" }), equipe, null, minutos(20));
    expect(r).toEqual({ ok: false, erro: "Informe o prazo dos documentos a partir do dia em que a disputa abriu (01/10)." });
    expect(await linhas(x.pagamentoId)).toEqual([]);
    expect(await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, entrada({ tipo: "med", abertaEm: "2026-10-01", prazo: "2026-10-01" }), equipe, null, minutos(20))).toMatchObject({ ok: true });
  });

  it("MED só no Pix; sem prazo, o aviso de prazo desconhecido; nota com dado pessoal recusada; pagamento de outra empresa = não encontrado", async () => {
    const cartao = await pagarEConfirmar(c, { forma: "cartao" });
    expect(await registrarContestacaoDaEquipe(db, c.org, cartao.pagamentoId, entrada({ tipo: "med" }), equipe, null, minutos(20))).toEqual({ ok: false, erro: TEXTO_MED_SO_NO_PIX });
    expect(await registrarContestacaoDaEquipe(db, c.org, cartao.pagamentoId, entrada({ nota: "CPF 123.456.789-09" }), equipe, null, minutos(20))).toMatchObject({ ok: false });
    expect(await registrarContestacaoDaEquipe(db, c.org, cartao.pagamentoId, entrada({ valor: TOTAL + 1 }), equipe, null, minutos(20))).toMatchObject({ ok: false });
    const outra = await montarCenario(db);
    expect(await registrarContestacaoDaEquipe(db, outra.org, cartao.pagamentoId, entrada(), equipe, null, minutos(20))).toEqual({ ok: false, erro: "Pagamento não encontrado." });
    const pix = await pagarEConfirmar(c, { entrada: "2026-11-02", saida: "2026-11-05", email: "pix@example.com" });
    expect(await registrarContestacaoDaEquipe(db, c.org, pix.pagamentoId, entrada({ tipo: "med", prazo: null }), equipe, null, minutos(20))).toMatchObject({ ok: true });
    const [l] = await linhas(pix.pagamentoId);
    expect(l).toMatchObject({ tipo: "med", avisos: expect.arrayContaining(["contestacao_prazo_desconhecido"]) });
    expect(l.avisos).not.toContain("contestacao_pix");
    // Outra disputa no mesmo pagamento com a primeira ainda aberta: possível duplicata, valor em risco 0.
    expect(await registrarContestacaoDaEquipe(db, c.org, pix.pagamentoId, entrada({ tipo: "reclamacao", idCaso: "7123456789" }), equipe, null, minutos(21))).toMatchObject({ ok: true, mensagem: expect.stringContaining("possível duplicata") });
    expect((await linhas(pix.pagamentoId))[1]).toMatchObject({ duplicataPossivel: true, valorEmRisco: 0 });
  });
});
