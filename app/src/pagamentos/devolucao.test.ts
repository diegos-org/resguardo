import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ERRO_CATEGORIA_TAXA_PADRAO_ARQUIVADA, lerConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import { categoriasDespesa, cotacoes, devolucoesPagamento, lancamentos } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { conferirTentativa } from "./conferencia";
import { chaveDevolucao, chaveTaxaPerdida, devolverPeloProvedor, ERRO_POR_FORA_SEM_CONFERIR, MAXIMO_FALHAS_DEVOLUCAO, registrarDevolucaoPorFora, registrarTaxaPerdida, tentarDevolucao } from "./devolucao";
import { ErroProvedor, type ProvedorPagamento } from "./provedor";
import { pagamentosDaReserva } from "./consultas";
import { conferirPendentes } from "./rotina";
import { textosDosAvisos } from "./situacoes";
import { type Cenario, minutos, montarCenario, TOTAL } from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => { c = await montarCenario(db); });

const conferir = (id: string, quando: Date) => conferirTentativa(db, c.org, id, c.provedor, quando, { origem: "rotina", forcar: true });
const devolucao = async (pagamentoId: string) => (await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.pagamentoId, pagamentoId)))[0];
const despesas = () => db.select().from(lancamentos).where(and(eq(lancamentos.organizacaoId, c.org), eq(lancamentos.tipo, "despesa_empresa")));
const pedidos = () => c.provedor.chamadas.filter((ch) => ch.metodo === "devolver");
const porFora = (pagamentoId: string, quando: Date, o: { valor?: number; provedor?: ProvedorPagamento | null; nota?: string } = {}) =>
  registrarDevolucaoPorFora(db, c.org, pagamentoId, { data: "2026-10-01", valor: o.valor ?? TOTAL, nota: o.nota ?? "Pix da conta da empresa" }, null, o.provedor === undefined ? c.provedor : o.provedor, quando);
const outras = (n: number) => ({ entrada: `2026-11-${String(2 + n * 4).padStart(2, "0")}`, saida: `2026-11-${String(5 + n * 4).padStart(2, "0")}`, email: `d${n}@example.com` });

/** Pagamento aprovado sem reserva (valor diferente do total da cotação), à espera da devolução. */
async function semReserva(financeiro: Parameters<Cenario["provedor"]["aprovar"]>[1] = { taxa: 1806 }, over: Parameters<Cenario["segurar"]>[0] = {}) {
  const s = await c.segurar(over);
  const p = await c.pix(s.cotacaoId);
  await db.update(cotacoes).set({ total: TOTAL + 1 }).where(eq(cotacoes.id, s.cotacaoId));
  c.provedor.aprovar(p.idProvedor, financeiro);
  await conferir(p.pagamentoId, minutos(3));
  expect((await c.tentativa(p.pagamentoId)).motivoSemReserva).toBe("valor_divergente");
  return { ...s, ...p };
}

describe("devolução do pagamento sem reserva (M8.2a)", () => {
  it("pelo Mercado Pago: chave gravada antes, confirmação pela leitura, desfecho devolução; a taxa que não voltou fica pendente (aviso, nunca a tarifa da aprovação)", async () => {
    const x = await semReserva();
    const r = await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    expect(r).toEqual({ ok: true, situacao: "confirmada" });
    const d = await devolucao(x.pagamentoId);
    expect(d).toMatchObject({ situacao: "confirmada", tentativas: 1, chaveAtual: chaveDevolucao(d.id, 1), valor: TOTAL, taxaPerdida: null });
    expect(pedidos()[0]).toMatchObject({ chave: chaveDevolucao(d.id, 1), valor: null });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "devolvido", desfecho: "devolucao", avisos: ["taxa_perdida_desconhecida"] });
    // A tarifa da aprovação (1.806) não vira despesa sozinha: o Mercado Pago não diz se ela voltou.
    expect(await despesas()).toEqual([]);
    await conferirPendentes(db, c.org, c.provedor, minutos(30));
    expect(await despesas()).toEqual([]);
    // Repetir não devolve de novo.
    expect(await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(11))).toMatchObject({ ok: false });
    expect(pedidos()).toHaveLength(1);
  });

  it("taxa que não voltou: a equipe informa (zero se voltou toda); despesa da empresa com chave própria, categoria criada no primeiro uso, uma vez só", async () => {
    const x = await semReserva();
    expect(await registrarTaxaPerdida(db, c.org, x.pagamentoId, 900, null, minutos(5))).toMatchObject({ ok: false, erro: expect.stringContaining("depois da devolução confirmada") });
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    expect(await registrarTaxaPerdida(db, c.org, x.pagamentoId, -1, null, minutos(12))).toMatchObject({ ok: false });
    expect(await registrarTaxaPerdida(db, c.org, x.pagamentoId, TOTAL + 1, null, minutos(12))).toMatchObject({ ok: false });
    // "1806" digitado sem vírgula (R$ 1.806,00) com a taxa da aprovação de R$ 18,06: recusado, com os dois valores.
    expect(await registrarTaxaPerdida(db, c.org, x.pagamentoId, 180600, null, minutos(12))).toEqual({
      ok: false,
      erro: "A taxa que não voltou (R$ 1.806,00) não pode passar da taxa que o Mercado Pago cobrou neste pagamento (R$ 18,06). Confira o valor (em reais, com vírgula: ex.: 18,06).",
    });
    expect(await registrarTaxaPerdida(db, c.org, x.pagamentoId, 1807, null, minutos(12))).toMatchObject({ ok: false, erro: expect.stringContaining("R$ 18,06") });
    expect(await despesas()).toEqual([]);
    expect(await registrarTaxaPerdida(db, c.org, x.pagamentoId, 900, null, minutos(12))).toEqual({ ok: true });
    const d = await devolucao(x.pagamentoId);
    expect(d.taxaPerdida).toBe(900);
    const [despesa] = await despesas();
    expect(despesa).toMatchObject({ id: d.despesaLancamentoId, valor: -900, montante: 900, efeitoSaldo: 0, estado: "realizado", origem: "manual", chaveOrigem: chaveTaxaPerdida(x.pagamentoId), imovelId: c.imovel, proprietarioId: null, dataCaixa: "2026-10-01" });
    expect(chaveTaxaPerdida(x.pagamentoId)).toBe(`mercadopago:${x.pagamentoId}:taxa_perdida`);
    const [cat] = await db.select().from(categoriasDespesa).where(eq(categoriasDespesa.id, despesa.categoriaId!));
    expect(cat.nome).toBe("Taxa do pagamento do site");
    expect((await lerConfigPagamentoSite(db, c.org)).categoriaTaxaId).toBe(cat.id);
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("taxa_perdida_desconhecida");
    expect(await registrarTaxaPerdida(db, c.org, x.pagamentoId, 900, null, minutos(13))).toMatchObject({ ok: false, erro: expect.stringContaining("já foi registrada") });
    expect(await despesas()).toHaveLength(1);

    // A taxa inteira da aprovação também vale (nada voltou).
    const w = await semReserva({ taxa: 1806 }, outras(1));
    await devolverPeloProvedor(db, c.org, w.pagamentoId, null, c.provedor, minutos(14));
    expect(await registrarTaxaPerdida(db, c.org, w.pagamentoId, 1806, null, minutos(15))).toEqual({ ok: true });
    // Sem a taxa da aprovação (o Mercado Pago não informou), o teto é o valor do pagamento.
    const v = await semReserva({}, outras(2));
    expect((await c.tentativa(v.pagamentoId)).taxa).toBeNull();
    await devolverPeloProvedor(db, c.org, v.pagamentoId, null, c.provedor, minutos(16));
    expect(await registrarTaxaPerdida(db, c.org, v.pagamentoId, TOTAL + 1, null, minutos(17))).toMatchObject({ ok: false, erro: expect.stringContaining("valor do pagamento (R$ 1.824,00)") });
    expect(await registrarTaxaPerdida(db, c.org, v.pagamentoId, 2000, null, minutos(17))).toEqual({ ok: true });
    expect(await despesas()).toHaveLength(3);

    // Outra devolução em que a taxa voltou toda: zero, sem despesa, e o aviso sai.
    const y = await semReserva({ taxa: 1806 }, outras(0));
    await devolverPeloProvedor(db, c.org, y.pagamentoId, null, c.provedor, minutos(20));
    expect(await registrarTaxaPerdida(db, c.org, y.pagamentoId, 0, null, minutos(21))).toEqual({ ok: true });
    expect(await devolucao(y.pagamentoId)).toMatchObject({ taxaPerdida: 0, despesaLancamentoId: null });
    expect((await c.tentativa(y.pagamentoId)).avisos).toEqual([]);
    expect(await despesas()).toHaveLength(3);
  });

  it("taxa que não voltou com a categoria arquivada: avisa, não lança e a pendência continua", async () => {
    const x = await semReserva();
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    const [cat] = await db.insert(categoriasDespesa).values({ organizacaoId: c.org, nome: "Taxa do pagamento do site", ativa: false }).returning();
    expect(await registrarTaxaPerdida(db, c.org, x.pagamentoId, 900, null, minutos(12))).toEqual({ ok: false, erro: ERRO_CATEGORIA_TAXA_PADRAO_ARQUIVADA });
    expect(await despesas()).toEqual([]);
    expect(await devolucao(x.pagamentoId)).toMatchObject({ taxaPerdida: null, despesaLancamentoId: null });
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("taxa_perdida_desconhecida");
    await db.update(categoriasDespesa).set({ ativa: true }).where(eq(categoriasDespesa.id, cat.id));
    expect(await registrarTaxaPerdida(db, c.org, x.pagamentoId, 900, null, minutos(13))).toEqual({ ok: true });
    expect((await despesas())[0].categoriaId).toBe(cat.id);
  });

  it("pedida até o provedor confirmar; a rotina relê a order antes de pedir de novo (já devolvida = confirmada; em andamento = espera, sem reenviar)", async () => {
    const x = await semReserva();
    c.provedor.respostaDevolucao = "pedida";
    expect(await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10))).toEqual({ ok: true, situacao: "pedida" });
    // Ainda em andamento no Mercado Pago: a rotina não pede de novo.
    await conferirPendentes(db, c.org, c.provedor, minutos(21));
    expect(pedidos()).toHaveLength(1);
    expect((await devolucao(x.pagamentoId)).situacao).toBe("pedida");
    c.provedor.confirmarDevolucoes(x.idProvedor);
    await conferirPendentes(db, c.org, c.provedor, minutos(32));
    expect((await devolucao(x.pagamentoId)).situacao).toBe("confirmada");
    expect(pedidos()).toHaveLength(1);
    expect((await c.tentativa(x.pagamentoId)).desfecho).toBe("devolucao");
  });

  it("chave do pedido: repetida depois de resposta incerta, nova depois de recusa clara e no pedido novo da equipe", async () => {
    const x = await semReserva();
    // 1º pedido: incerta → o 2º repete a chave.
    c.provedor.falhas.devolver = new ErroProvedor("incerto", "tempo");
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", tentativas: 1, chaveEmDuvida: true });
    // 2º pedido: recusa clara (credencial recusada) → o 3º leva chave nova.
    c.provedor.falhas.devolver = new ErroProvedor("credencial", "recusada");
    await conferirPendentes(db, c.org, c.provedor, minutos(21));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", tentativas: 2, chaveEmDuvida: false });
    c.provedor.falhas.devolver = null;
    await conferirPendentes(db, c.org, c.provedor, minutos(32));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "confirmada", tentativas: 3, chaveEmDuvida: false });
    const d = await devolucao(x.pagamentoId);
    expect(pedidos().map((ch) => ch.chave)).toEqual([chaveDevolucao(d.id, 1), chaveDevolucao(d.id, 1), chaveDevolucao(d.id, 3)]);
  });

  it("devolução feita no painel do Mercado Pago enquanto pedida: a releitura confirma", async () => {
    const x = await semReserva();
    c.provedor.respostaDevolucao = "pedida";
    c.provedor.falhas.devolver = new ErroProvedor("incerto", "tempo");
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    c.provedor.falhas.devolver = null;
    c.provedor.devolverNoProvedor(x.idProvedor, TOTAL);
    await conferirPendentes(db, c.org, c.provedor, minutos(21));
    expect((await devolucao(x.pagamentoId)).situacao).toBe("confirmada");
  });

  it("resposta incerta conta, mas a terceira relê a order antes de desistir: o pedido que saiu com a resposta perdida é confirmado (nunca recusada, nada de devolução em dobro)", async () => {
    const x = await semReserva();
    c.provedor.falhas.devolver = new ErroProvedor("incerto", "tempo");
    expect(await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10))).toEqual({ ok: true, situacao: "pedida" });
    // Antes da próxima tentativa, nada é reenviado.
    await conferirPendentes(db, c.org, c.provedor, minutos(15));
    expect(pedidos()).toHaveLength(1);
    await conferirPendentes(db, c.org, c.provedor, minutos(21));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", tentativas: 2, falhas: 2 });
    // O terceiro pedido sai (o Mercado Pago devolve), mas a resposta se perde.
    c.provedor.falhas.devolver = null;
    c.provedor.falhasDepois.devolver = new ErroProvedor("incerto", "tempo");
    await conferirPendentes(db, c.org, c.provedor, minutos(32));
    c.provedor.falhasDepois.devolver = null;
    // A releitura antes de desistir mostra a devolução: confirmada pela leitura. Depois de cada resposta incerta, o
    // pedido seguinte repete a MESMA chave (o provedor nunca devolve duas vezes pela mesma chave).
    const d = await devolucao(x.pagamentoId);
    expect(d).toMatchObject({ situacao: "confirmada", tentativas: 3, chaveEmDuvida: false });
    expect(pedidos().map((ch) => ch.chave)).toEqual([1, 1, 1].map((n) => chaveDevolucao(d.id, n)));
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "devolvido", desfecho: "devolucao" });
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("devolucao_falhou");
    await conferirPendentes(db, c.org, c.provedor, minutos(43));
    expect(pedidos()).toHaveLength(3);
    // E a devolução por fora não se registra por cima.
    expect(await porFora(x.pagamentoId, minutos(44))).toMatchObject({ ok: false });
  });

  it("só respostas incertas e nenhum sinal de devolução na order: na terceira vira recusada, com o aviso (nunca 'pedida' para sempre); a equipe pede de novo ou registra por fora", async () => {
    const x = await semReserva();
    // Ex.: o Mercado Pago responde sempre com um erro que o sistema não sabe ler (fica incerta).
    c.provedor.falhas.devolver = new ErroProvedor("incerto", "Resposta inesperada do Mercado Pago.");
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    await conferirPendentes(db, c.org, c.provedor, minutos(21));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", falhas: 2 });
    const lidas = () => c.provedor.chamadas.filter((ch) => ch.metodo === "consultar").length;
    const antes = lidas();
    await conferirPendentes(db, c.org, c.provedor, minutos(32));
    // Antes do pedido e, de novo, antes de dar por recusada.
    expect(lidas() - antes).toBeGreaterThanOrEqual(2);
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "recusada", tentativas: 3, falhas: MAXIMO_FALHAS_DEVOLUCAO });
    const t = await c.tentativa(x.pagamentoId);
    expect(t.avisos).toContain("devolucao_falhou");
    expect(textosDosAvisos(t.avisos)).toContain("O Mercado Pago recusou ou não respondeu três vezes: confira no painel do Mercado Pago antes de tentar de novo ou de registrar a devolução feita por fora.");
    // Nada mais é pedido sozinho; o painel volta a oferecer as duas saídas.
    await conferirPendentes(db, c.org, c.provedor, minutos(60));
    expect(pedidos()).toHaveLength(3);
    const [q] = await pagamentosDaReserva(db, c.org, x.reservaId, minutos(61));
    expect(q.acoes).toMatchObject({ devolver: true, devolucaoPorFora: true });
    c.provedor.falhas.devolver = null;
    expect(await porFora(x.pagamentoId, minutos(70))).toEqual({ ok: true, situacao: "por_fora" });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ desfecho: "por_fora", avisos: [] });
  });

  it("terceira resposta incerta com a order mostrando a devolução em andamento: continua pedida (nunca recusada), espera sem pedir de novo e a leitura confirma quando ela sai", async () => {
    const x = await semReserva();
    c.provedor.falhas.devolver = new ErroProvedor("incerto", "tempo");
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    await conferirPendentes(db, c.org, c.provedor, minutos(21));
    // O terceiro pedido chega ao Mercado Pago (fica em andamento lá), mas a resposta se perde.
    c.provedor.falhas.devolver = null;
    c.provedor.respostaDevolucao = "pedida";
    c.provedor.falhasDepois.devolver = new ErroProvedor("incerto", "tempo");
    await conferirPendentes(db, c.org, c.provedor, minutos(32));
    c.provedor.falhasDepois.devolver = null;
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", tentativas: 3, falhas: 3 });
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("devolucao_falhou");
    await conferirPendentes(db, c.org, c.provedor, minutos(43));
    expect(pedidos()).toHaveLength(3);
    expect((await devolucao(x.pagamentoId)).situacao).toBe("pedida");
    c.provedor.confirmarDevolucoes(x.idProvedor);
    await conferirPendentes(db, c.org, c.provedor, minutos(54));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "confirmada" });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "devolvido", desfecho: "devolucao" });
    expect(pedidos()).toHaveLength(3);
  });

  it("a devolução por fora relê a order: o pedido que saiu com a resposta perdida é confirmado e o registro por fora, recusado", async () => {
    const x = await semReserva();
    c.provedor.falhasDepois.devolver = new ErroProvedor("incerto", "tempo");
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    c.provedor.falhasDepois.devolver = null;
    expect((await devolucao(x.pagamentoId)).situacao).toBe("pedida");
    // Mesmo que a devolução ainda estivesse "recusada" no sistema, a releitura do Mercado Pago decide.
    await db.update(devolucoesPagamento).set({ situacao: "recusada" }).where(eq(devolucoesPagamento.pagamentoId, x.pagamentoId));
    expect(await porFora(x.pagamentoId, minutos(12))).toMatchObject({ ok: false, erro: expect.stringContaining("devolvido") });
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "confirmada" });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "devolvido", desfecho: "devolucao" });
  });

  it("recusas explícitas: a terceira relê a order antes e, sem sinal de devolução, vira recusada com aviso; a equipe registra por fora (relendo a order)", async () => {
    const x = await semReserva();
    c.provedor.falhas.devolver = new ErroProvedor("credencial", "Chave recusada pelo Mercado Pago.");
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    await conferirPendentes(db, c.org, c.provedor, minutos(21));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", falhas: 2 });
    const lidas = () => c.provedor.chamadas.filter((ch) => ch.metodo === "consultar").length;
    const antes = lidas();
    await conferirPendentes(db, c.org, c.provedor, minutos(32));
    // Antes do pedido e, de novo, antes de dar por recusada.
    expect(lidas() - antes).toBeGreaterThanOrEqual(2);
    const d = await devolucao(x.pagamentoId);
    expect(d).toMatchObject({ situacao: "recusada", tentativas: 3, falhas: MAXIMO_FALHAS_DEVOLUCAO });
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("devolucao_falhou");
    await conferirPendentes(db, c.org, c.provedor, minutos(60));
    expect(pedidos()).toHaveLength(3);
    c.provedor.falhas.devolver = null;
    expect(await porFora(x.pagamentoId, minutos(70), { valor: TOTAL - 100 })).toMatchObject({ ok: false, erro: expect.stringContaining("só o valor integral") });
    expect(await registrarDevolucaoPorFora(db, c.org, x.pagamentoId, { data: "2026-10-02", valor: TOTAL, nota: "" }, null, c.provedor, minutos(70))).toMatchObject({ ok: false, erro: expect.stringContaining("futuro") });
    expect(await porFora(x.pagamentoId, minutos(70))).toEqual({ ok: true, situacao: "por_fora" });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ desfecho: "por_fora", avisos: [] });
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "por_fora", porForaData: "2026-10-01", porForaValor: TOTAL, porForaNota: "Pix da conta da empresa" });
  });

  it("a terceira recusa cruzou com um pedido que saiu: a releitura antes de desistir mostra a devolução e confirma (nunca recusada)", async () => {
    const x = await semReserva();
    c.provedor.falhas.devolver = new ErroProvedor("credencial", "Chave recusada pelo Mercado Pago.");
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    await conferirPendentes(db, c.org, c.provedor, minutos(21));
    // No terceiro pedido, a recusa chega, mas o dinheiro volta ao hóspede logo depois (um pedido anterior concluiu).
    const original = c.provedor.devolver.bind(c.provedor);
    c.provedor.devolver = async (...a) => {
      const r = await original(...a);
      c.provedor.devolverNoProvedor(x.idProvedor, TOTAL);
      return r;
    };
    await conferirPendentes(db, c.org, c.provedor, minutos(32));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "confirmada" });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "devolvido", desfecho: "devolucao" });
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("devolucao_falhou");
  });

  it("dada por recusada, mas o dinheiro voltou depois: a releitura diária confirma", async () => {
    const x = await semReserva();
    c.provedor.falhas.devolver = new ErroProvedor("credencial", "Chave recusada pelo Mercado Pago.");
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    await conferirPendentes(db, c.org, c.provedor, minutos(21));
    await conferirPendentes(db, c.org, c.provedor, minutos(32));
    expect((await devolucao(x.pagamentoId)).situacao).toBe("recusada");
    c.provedor.falhas.devolver = null;
    c.provedor.devolverNoProvedor(x.idProvedor, TOTAL);
    await conferirPendentes(db, c.org, c.provedor, minutos(24 * 60 + 40));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "confirmada" });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "devolvido", desfecho: "devolucao" });
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("devolucao_falhou");
  });

  it("por fora com data de antes do pagamento (digitação do ano, por exemplo): recusa e nada muda", async () => {
    const x = await semReserva();
    const r = await registrarDevolucaoPorFora(db, c.org, x.pagamentoId, { data: "2026-09-30", valor: TOTAL, nota: "" }, null, c.provedor, minutos(10));
    expect(r).toEqual({ ok: false, erro: "A data da devolução não pode ser antes do pagamento (01/10/2026). Confira a data." });
    expect(await devolucao(x.pagamentoId)).toBeUndefined();
    expect((await c.tentativa(x.pagamentoId)).desfecho).toBeNull();
    expect(await porFora(x.pagamentoId, minutos(11))).toMatchObject({ ok: true });
  });

  it("por fora relê a order antes: sem provedor ou sem leitura, recusa; devolvida, em parte, em andamento ou contestada no Mercado Pago, recusa", async () => {
    const x = await semReserva();
    expect(await porFora(x.pagamentoId, minutos(10), { provedor: null })).toEqual({ ok: false, erro: ERRO_POR_FORA_SEM_CONFERIR });
    c.provedor.falhas.consultar = new ErroProvedor("incerto", "tempo");
    expect(await porFora(x.pagamentoId, minutos(10))).toEqual({ ok: false, erro: ERRO_POR_FORA_SEM_CONFERIR });
    c.provedor.falhas.consultar = null;
    // Devolução pedida direto no Mercado Pago, ainda em andamento.
    c.provedor.respostaDevolucao = "pedida";
    const [order] = c.provedor.todas().filter((o) => o.idProvedor === x.idProvedor);
    await c.provedor.devolver(order, "fora-do-sistema-1", null);
    expect(await porFora(x.pagamentoId, minutos(11))).toMatchObject({ ok: false, erro: expect.stringContaining("em andamento") });
    // Concluída lá: devolvido no Mercado Pago, por fora recusado (e a leitura aplicada avisa).
    c.provedor.confirmarDevolucoes(x.idProvedor);
    expect(await porFora(x.pagamentoId, minutos(12))).toMatchObject({ ok: false, erro: expect.stringContaining("devolvido") });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "devolvido", desfecho: null, avisos: expect.arrayContaining(["devolvido_por_fora"]) });
    expect(await devolucao(x.pagamentoId)).toBeUndefined();

    const y = await semReserva({ taxa: 1806 }, outras(0));
    c.provedor.devolverNoProvedor(y.idProvedor, 1000);
    expect(await porFora(y.pagamentoId, minutos(13))).toMatchObject({ ok: false, erro: expect.stringContaining("no todo ou em parte") });
    const z = await semReserva({ taxa: 1806 }, outras(1));
    c.provedor.contestar(z.idProvedor);
    expect(await porFora(z.pagamentoId, minutos(14))).toMatchObject({ ok: false, erro: expect.stringContaining("contestado") });
  });

  it("devolvido pelo Mercado Pago depois de registrado por fora: a releitura diária avisa da devolução em dobro", async () => {
    const x = await semReserva();
    expect(await porFora(x.pagamentoId, minutos(10))).toEqual({ ok: true, situacao: "por_fora" });
    c.provedor.devolverNoProvedor(x.idProvedor, TOTAL);
    // Antes de um dia, nada; a releitura diária inclui o desfecho "por fora".
    await conferirPendentes(db, c.org, c.provedor, minutos(60));
    expect((await c.tentativa(x.pagamentoId)).avisos).toEqual([]);
    await conferirPendentes(db, c.org, c.provedor, minutos(24 * 60 + 20));
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "devolvido", desfecho: "por_fora", avisos: ["devolucao_em_dobro"] });
  });

  it("painel e rotina ao mesmo tempo: só um pedido sai (sob a trava, a vez e as tentativas são conferidas de novo)", async () => {
    const x = await semReserva();
    c.provedor.falhas.devolver = new ErroProvedor("incerto", "tempo");
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    c.provedor.falhas.devolver = null;
    c.provedor.respostaDevolucao = "pedida";
    const d = await devolucao(x.pagamentoId);
    await Promise.all([tentarDevolucao(db, c.org, d.id, c.provedor, minutos(21)), tentarDevolucao(db, c.org, d.id, c.provedor, minutos(21))]);
    expect(pedidos()).toHaveLength(2);
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", tentativas: 2 });
    // Antes da vez dela, nenhum pedido.
    expect(await tentarDevolucao(db, c.org, d.id, c.provedor, minutos(22))).toBe("pedida");
    expect(pedidos()).toHaveLength(2);
  });

  it("recusas: pagamento que confirmou a reserva, ainda pendente, ou já com devolução pedida; por fora com devolução pedida", async () => {
    const s = await c.segurar();
    const p = await c.pix(s.cotacaoId);
    expect(await devolverPeloProvedor(db, c.org, p.pagamentoId, null, c.provedor, minutos(2))).toMatchObject({ ok: false, erro: expect.stringContaining("aprovado") });
    c.provedor.aprovar(p.idProvedor);
    await conferir(p.pagamentoId, minutos(3));
    expect(await devolverPeloProvedor(db, c.org, p.pagamentoId, null, c.provedor, minutos(4))).toMatchObject({ ok: false, erro: expect.stringContaining("desfecho") });
    expect(await porFora(p.pagamentoId, minutos(4), { valor: TOTAL })).toMatchObject({ ok: false });
    const x = await semReserva({ taxa: 1806 }, { entrada: "2026-11-02", saida: "2026-11-05", email: "y@example.com" });
    c.provedor.respostaDevolucao = "pedida";
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    expect(await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(11))).toMatchObject({ ok: false, erro: expect.stringContaining("Já há uma devolução pedida") });
    expect(await porFora(x.pagamentoId, minutos(11))).toMatchObject({ ok: false });
    expect(await devolverPeloProvedor(db, "00000000-0000-4000-8000-000000000009", x.pagamentoId, null, c.provedor, minutos(11))).toMatchObject({ ok: false, erro: "Pagamento não encontrado." });
  });
});
