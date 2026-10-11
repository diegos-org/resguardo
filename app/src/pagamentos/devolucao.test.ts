import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ERRO_CATEGORIA_TAXA_PADRAO_ARQUIVADA, lerConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import { auditoria, categoriasDespesa, cotacoes, devolucoesPagamento, lancamentos, pagamentos } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { conferirTentativa } from "./conferencia";
import {
  chaveDevolucao,
  chaveTaxaPerdida,
  corrigirTaxaPerdida,
  devolverPeloProvedor,
  ERRO_POR_FORA_CARTAO,
  ESPERA_DEVOLUCAO_MS,
  ERRO_POR_FORA_SEM_CONFERIR,
  MAXIMO_FALHAS_DEVOLUCAO,
  PRAZO_DEVOLUCAO_CARTAO_DIAS,
  pararDevolucaoPedida,
  pedirRestanteDaDevolucao,
  porForaPermitidoNoCartao,
  registrarDevolucaoPorFora,
  registrarRecusaNoPainel,
  registrarTaxaPerdida,
  tentarDevolucao,
} from "./devolucao";
import type { ProvedorFalso } from "./falso";
import { type Cobranca, type CodigoDevolucao, type DevolucaoLida, ErroProvedor, type ProvedorPagamento } from "./provedor";
import { pagamentosDaReserva } from "./consultas";
import { conferirPendentes } from "./rotina";
import { type CodigoAviso, textosDosAvisos } from "./situacoes";
import { AGORA, type Cenario, cancelar, entradaPadrao, envelhecer, liberar, minutos, montarCenario, pagarEConfirmar, semDadosDoHospede, TOTAL, usuarioDeTeste } from "./testes";

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

  it("pelo Mercado Pago com valor divergente: o valor registrado é o que a order relida mostra como pago, não o da criação", async () => {
    const x = await semReserva();
    const [order] = c.provedor.todas().filter((o) => o.idProvedor === x.idProvedor);
    const pago = TOTAL - 10_000;
    vi.spyOn(c.provedor, "consultar").mockResolvedValue({ ...order, pago });
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    vi.restoreAllMocks();
    expect(pedidos()).toHaveLength(1);
    expect((await devolucao(x.pagamentoId)).valor).toBe(pago);
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
    expect(despesa).toMatchObject({ id: d.despesaLancamentoId, valor: -900, montante: 900, efeitoSaldo: 0, estado: "realizado", origem: "manual", chaveOrigem: chaveTaxaPerdida(x.pagamentoId, d.id), imovelId: c.imovel, proprietarioId: null, reservaId: null, dataCaixa: "2026-10-01" });
    // M8.2c: a chave é por devolução (as correções levam #2, #3…).
    expect(chaveTaxaPerdida(x.pagamentoId, d.id)).toBe(`mercadopago:${x.pagamentoId}:devolucao:${d.id}:taxa_perdida`);
    expect(chaveTaxaPerdida(x.pagamentoId, d.id, 2)).toBe(`mercadopago:${x.pagamentoId}:devolucao:${d.id}:taxa_perdida#2`);
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

  it("chave do pedido: repetida depois de resposta incerta (mesmo que a repetição seja recusada depois); nova depois de recusa clara de uma chave nova", async () => {
    const x = await semReserva();
    // 1º pedido: incerta → o 2º repete a chave.
    c.provedor.falhas.devolver = new ErroProvedor("incerto", "tempo");
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", tentativas: 1, chaveEmDuvida: true });
    // 2º pedido (mesma chave): recusa clara (credencial recusada, antes de o provedor conferir a chave) → a chave
    // continua em dúvida (o 1º pedido pode ter saído) e o 3º repete a mesma.
    c.provedor.falhas.devolver = new ErroProvedor("credencial", "recusada");
    await conferirPendentes(db, c.org, c.provedor, minutos(21));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", tentativas: 2, chaveEmDuvida: true });
    c.provedor.falhas.devolver = null;
    await conferirPendentes(db, c.org, c.provedor, minutos(32));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "confirmada", tentativas: 3, chaveEmDuvida: false });
    const d = await devolucao(x.pagamentoId);
    expect(pedidos().map((ch) => ch.chave)).toEqual([chaveDevolucao(d.id, 1), chaveDevolucao(d.id, 1), chaveDevolucao(d.id, 1)]);

    // Recusa clara de uma chave nova (nada em dúvida): o próximo leva chave nova.
    const y = await semReserva({ taxa: 1806 }, outras(0));
    c.provedor.falhas.devolver = new ErroProvedor("credencial", "recusada");
    await devolverPeloProvedor(db, c.org, y.pagamentoId, null, c.provedor, minutos(40));
    expect(await devolucao(y.pagamentoId)).toMatchObject({ situacao: "pedida", tentativas: 1, chaveEmDuvida: false });
    c.provedor.falhas.devolver = null;
    await conferirPendentes(db, c.org, c.provedor, minutos(51));
    const e = await devolucao(y.pagamentoId);
    expect(e).toMatchObject({ situacao: "confirmada", tentativas: 2 });
    expect(pedidos().slice(-2).map((ch) => ch.chave)).toEqual([chaveDevolucao(e.id, 1), chaveDevolucao(e.id, 2)]);
  });

  it("o processo cai depois de enviar o pedido (antes de gravar a resposta): a chave já estava em dúvida, e o envio seguinte repete a mesma chave", async () => {
    const x = await semReserva();
    const original = c.provedor.devolver.bind(c.provedor);
    // O provedor recebe o pedido e o processo cai antes de gravar a resposta.
    const devolver = vi.spyOn(c.provedor, "devolver").mockImplementationOnce(async (...a) => {
      await original(...a);
      throw new Error("processo caiu");
    });
    c.provedor.respostaDevolucao = "pedida";
    await expect(devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10))).rejects.toThrow();
    const d = await devolucao(x.pagamentoId);
    expect(d).toMatchObject({ situacao: "pedida", tentativas: 1, chaveEmDuvida: true });
    // A order ainda não mostra a devolução (atraso): o próximo envio repete a chave.
    const [order] = c.provedor.todas().filter((o) => o.idProvedor === x.idProvedor);
    vi.spyOn(c.provedor, "consultar").mockResolvedValue({ ...order, situacao: "aprovado", devolvido: 0, devolucaoEmAndamento: false });
    await tentarDevolucao(db, c.org, d.id, c.provedor, minutos(21));
    vi.restoreAllMocks();
    c.provedor.respostaDevolucao = "confirmada";
    expect(devolver).toHaveBeenCalledTimes(2);
    expect(pedidos().map((p) => p.chave)).toEqual([chaveDevolucao(d.id, 1), chaveDevolucao(d.id, 1)]);
  });

  it("pedido aceito (pedida) com a order ainda sem mostrar a devolução: nada se envia de novo, nem depois de várias leituras (aviso na terceira, continua pedida); a leitura confirma quando a order mostra", async () => {
    const x = await semReserva();
    c.provedor.respostaDevolucao = "pedida";
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", tentativas: 1, chaveEmDuvida: true, chaveAceita: true, falhas: 0 });
    // A order lida ainda não mostra a devolução (atraso do provedor), leitura após leitura.
    const [order] = c.provedor.todas().filter((o) => o.idProvedor === x.idProvedor);
    vi.spyOn(c.provedor, "consultar").mockResolvedValue({ ...order, situacao: "aprovado", devolvido: 0, devolucaoEmAndamento: false });
    for (const m of [21, 32, 43, 54]) await tentarDevolucao(db, c.org, (await devolucao(x.pagamentoId)).id, c.provedor, minutos(m));
    vi.restoreAllMocks();
    expect(pedidos()).toHaveLength(1);
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", tentativas: 1, chaveAceita: true });
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("devolucao_sem_confirmacao");
    // Quando a order mostra, a leitura confirma e o aviso sai.
    c.provedor.confirmarDevolucoes(x.idProvedor);
    await conferirPendentes(db, c.org, c.provedor, minutos(65));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "confirmada", chaveEmDuvida: false, chaveAceita: false });
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("devolucao_sem_confirmacao");
    expect(pedidos()).toHaveLength(1);
  });

  it("pedido aceito que a order nunca mostra: passado o prazo de consulta do provedor (85 dias), a rotina para de ler e liga o aviso uma vez; continua pedida", async () => {
    const x = await semReserva();
    c.provedor.respostaDevolucao = "pedida";
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    const [order] = c.provedor.todas().filter((o) => o.idProvedor === x.idProvedor);
    const consultar = vi.spyOn(c.provedor, "consultar").mockResolvedValue({ ...order, situacao: "aprovado", devolvido: 0, devolucaoEmAndamento: false });
    const dia = (n: number) => new Date(AGORA.getTime() + n * 86_400_000);
    // Dentro do prazo, a rotina ainda relê.
    await conferirPendentes(db, c.org, c.provedor, dia(84));
    expect((await devolucao(x.pagamentoId)).falhas).toBeGreaterThan(0);
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("devolucao_fora_do_prazo");
    // Depois de 85 dias: nenhuma leitura, só o aviso (uma vez, sem repetir nas voltas seguintes).
    const antes = consultar.mock.calls.length;
    expect(antes).toBeGreaterThan(0);
    for (const n of [86, 87, 120]) await conferirPendentes(db, c.org, c.provedor, dia(n));
    expect(consultar.mock.calls.length).toBe(antes);
    vi.restoreAllMocks();
    const t = await c.tentativa(x.pagamentoId);
    expect(t.avisos.filter((a) => a === "devolucao_fora_do_prazo")).toHaveLength(1);
    expect(textosDosAvisos(t.avisos).join(" ")).toContain("A devolução não é mais pedida pelo sistema");
    expect((await devolucao(x.pagamentoId)).situacao).toBe("pedida");
    expect(pedidos()).toHaveLength(1);
  });

  it("pedido aceito e depois a order lida devolvida em parte ou contestada: continua pedida (nunca para), nada se envia de novo e o registro por fora é recusado", async () => {
    for (const [n, variar] of [
      [0, (o: Cobranca) => ({ ...o, situacao: "devolvido_parcial" as const, devolvido: 5000, devolucaoEmAndamento: false })],
      [1, (o: Cobranca) => ({ ...o, situacao: "contestado" as const, devolucaoEmAndamento: false })],
    ] as const) {
      const x = await semReserva({ taxa: 1806 }, outras(n));
      c.provedor.respostaDevolucao = "pedida";
      await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
      c.provedor.respostaDevolucao = "confirmada";
      expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", chaveAceita: true });
      const antes = pedidos().length;
      const [order] = c.provedor.todas().filter((o) => o.idProvedor === x.idProvedor);
      vi.spyOn(c.provedor, "consultar").mockResolvedValue(variar(order));
      for (const m of [21, 32, 43]) await tentarDevolucao(db, c.org, (await devolucao(x.pagamentoId)).id, c.provedor, minutos(m));
      expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", chaveAceita: true });
      expect(pedidos()).toHaveLength(antes);
      const t = await c.tentativa(x.pagamentoId);
      expect(t.situacao).toBe(n === 0 ? "devolvido_parcial" : "contestado");
      expect(t.avisos).not.toContain("devolucao_parada");
      expect(t.avisos).toContain("devolucao_sem_confirmacao");
      expect(await porFora(x.pagamentoId, minutos(50))).toMatchObject({ ok: false });
      vi.restoreAllMocks();
      expect((await devolucao(x.pagamentoId)).situacao).toBe("pedida");
    }
  });

  it("pedido aceito, lido contestado e depois devolvido no Mercado Pago: a leitura confirma a devolução (contestado → devolvido só com o pedido aceito)", async () => {
    const x = await semReserva();
    c.provedor.respostaDevolucao = "pedida";
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    c.provedor.respostaDevolucao = "confirmada";
    const [order] = c.provedor.todas().filter((o) => o.idProvedor === x.idProvedor);
    const consultar = vi.spyOn(c.provedor, "consultar").mockResolvedValue({ ...order, situacao: "contestado", devolucaoEmAndamento: false });
    await tentarDevolucao(db, c.org, (await devolucao(x.pagamentoId)).id, c.provedor, minutos(21));
    expect((await c.tentativa(x.pagamentoId)).situacao).toBe("contestado");
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", chaveAceita: true });
    consultar.mockResolvedValue({ ...order, situacao: "devolvido", devolvido: TOTAL, devolucaoEmAndamento: false });
    await tentarDevolucao(db, c.org, (await devolucao(x.pagamentoId)).id, c.provedor, minutos(32));
    vi.restoreAllMocks();
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "confirmada", chaveAceita: false });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "devolvido", desfecho: "devolucao" });
    expect(pedidos()).toHaveLength(1);
  });

  it("order devolvida em parte ou contestada antes de pedir de novo: a leitura é aplicada e a devolução para (aviso), sem pedir o valor inteiro por cima", async () => {
    for (const [n, mexer] of [
      [0, (id: string) => c.provedor.devolverNoProvedor(id, 5000)],
      [1, (id: string) => c.provedor.contestar(id)],
    ] as const) {
      const x = await semReserva({ taxa: 1806 }, outras(n));
      const antes = pedidos().length;
      // 1º pedido sem resposta (incerta): continua pedida, sem devolução no provedor.
      c.provedor.falhas.devolver = new ErroProvedor("incerto", "tempo");
      await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
      c.provedor.falhas.devolver = null;
      expect((await devolucao(x.pagamentoId)).situacao).toBe("pedida");
      mexer(x.idProvedor);
      await tentarDevolucao(db, c.org, (await devolucao(x.pagamentoId)).id, c.provedor, minutos(21));
      expect((await devolucao(x.pagamentoId)).situacao).toBe("recusada");
      expect(pedidos()).toHaveLength(antes + 1);
      const t = await c.tentativa(x.pagamentoId);
      expect(t.situacao).toBe(n === 0 ? "devolvido_parcial" : "contestado");
      expect(t.avisos).toContain("devolucao_parada");
      expect(textosDosAvisos(t.avisos).join(" ")).toContain("parou");
    }
  });

  it("pagamento que deixou de estar aprovado entre a releitura e a trava (devolvido em parte por uma leitura que cruzou): a devolução para sob a trava, sem pedir o inteiro", async () => {
    const x = await semReserva();
    c.provedor.falhas.devolver = new ErroProvedor("incerto", "tempo");
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    c.provedor.falhas.devolver = null;
    const [aprovada] = c.provedor.todas().filter((o) => o.idProvedor === x.idProvedor);
    // Uma leitura (Conferir agora) aplica a devolução em parte feita no Mercado Pago...
    c.provedor.devolverNoProvedor(x.idProvedor, 5000);
    await conferir(x.pagamentoId, minutos(15));
    expect((await c.tentativa(x.pagamentoId)).situacao).toBe("devolvido_parcial");
    // ...enquanto a releitura da rotina ainda tinha a order aprovada.
    vi.spyOn(c.provedor, "consultar").mockResolvedValue(aprovada);
    await tentarDevolucao(db, c.org, (await devolucao(x.pagamentoId)).id, c.provedor, minutos(21));
    vi.restoreAllMocks();
    expect((await devolucao(x.pagamentoId)).situacao).toBe("recusada");
    expect(pedidos()).toHaveLength(1);
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("devolucao_parada");
  });

  it("releitura que não mostra a order aprovada e a mesma (desconhecida, cancelada, recusada, vencida, de outra referência): nada se pede; a leitura é aplicada e a devolução para (aviso)", async () => {
    const variantes = [
      (o: Cobranca) => ({ ...o, situacao: "desconhecido" as const }),
      (o: Cobranca) => ({ ...o, situacao: "cancelado" as const }),
      (o: Cobranca) => ({ ...o, situacao: "recusado" as const }),
      (o: Cobranca) => ({ ...o, situacao: "expirado" as const }),
      (o: Cobranca) => ({ ...o, referencia: "scl-outra" }),
    ];
    for (const [n, variar] of variantes.entries()) {
      const x = await semReserva({ taxa: 1806 }, outras(n));
      c.provedor.falhas.devolver = new ErroProvedor("incerto", "tempo");
      await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
      c.provedor.falhas.devolver = null;
      expect((await devolucao(x.pagamentoId)).situacao).toBe("pedida");
      const antes = pedidos().length;
      const [aprovada] = c.provedor.todas().filter((o) => o.idProvedor === x.idProvedor);
      vi.spyOn(c.provedor, "consultar").mockResolvedValue(variar(aprovada));
      await tentarDevolucao(db, c.org, (await devolucao(x.pagamentoId)).id, c.provedor, minutos(21));
      vi.restoreAllMocks();
      expect(pedidos()).toHaveLength(antes);
      expect((await devolucao(x.pagamentoId)).situacao).toBe("recusada");
      const t = await c.tentativa(x.pagamentoId);
      expect(t.avisos).toContain("devolucao_parada");
      expect(t.desfecho).toBeNull();
    }
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
    expect(await porFora(x.pagamentoId, minutos(70), { valor: TOTAL - 100 })).toEqual({ ok: false, erro: "A devolução por fora registra o valor desta devolução: R$ 1.824,00." });
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

    // M8.2d (D17): devolvido em parte no painel do Mercado Pago — o devolvido fora fica reconhecido e o por fora registra
    // só o restante (o integral, recusado com o valor certo).
    const y = await semReserva({ taxa: 1806 }, outras(0));
    c.provedor.devolverNoProvedor(y.idProvedor, 1000);
    expect(await porFora(y.pagamentoId, minutos(13))).toEqual({ ok: false, erro: "A devolução por fora registra o valor desta devolução: R$ 1.814,00." });
    expect(await porFora(y.pagamentoId, minutos(13), { valor: TOTAL - 1000 })).toEqual({ ok: true, situacao: "por_fora" });
    expect(await c.tentativa(y.pagamentoId)).toMatchObject({ desfecho: "por_fora", devolvidoForaReconhecido: 1000 });
    expect(await devolucao(y.pagamentoId)).toMatchObject({ situacao: "por_fora", valor: TOTAL - 1000, porForaValor: TOTAL - 1000 });
    const z = await semReserva({ taxa: 1806 }, outras(1));
    c.provedor.contestar(z.idProvedor);
    expect(await porFora(z.pagamentoId, minutos(14))).toMatchObject({ ok: false, erro: expect.stringContaining("contestado") });
  });

  it("por fora: a order relida precisa ser a deste pagamento (id e referência); outra order aprovada não serve, e nada é registrado", async () => {
    const x = await semReserva();
    const [order] = c.provedor.todas().filter((o) => o.idProvedor === x.idProvedor);
    for (const outra of [{ ...order, referencia: "scl-outra" }, { ...order, idProvedor: "ORDTSTOUTRA" }]) {
      vi.spyOn(c.provedor, "consultar").mockResolvedValue(outra);
      expect(await porFora(x.pagamentoId, minutos(10))).toMatchObject({ ok: false, erro: expect.stringContaining("não bate com este pagamento") });
      vi.restoreAllMocks();
    }
    expect(await devolucao(x.pagamentoId)).toBeUndefined();
    expect((await c.tentativa(x.pagamentoId)).desfecho).toBeNull();
  });

  it("por fora: o integral é o que o hóspede pagou pela leitura que aprovou (valor divergente da cotação), não o valor pedido na criação; uma leitura depois não muda o pago (D28)", async () => {
    const s = await c.segurar();
    const x = { ...s, ...(await c.pix(s.cotacaoId)) };
    await db.update(cotacoes).set({ total: TOTAL + 1 }).where(eq(cotacoes.id, s.cotacaoId));
    c.provedor.aprovar(x.idProvedor, { taxa: 1806 });
    const [order] = c.provedor.todas().filter((o) => o.idProvedor === x.idProvedor);
    const pago = TOTAL - 10_000;
    vi.spyOn(c.provedor, "consultar").mockResolvedValue({ ...order, pago });
    await conferir(x.pagamentoId, minutos(3));
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ motivoSemReserva: "valor_divergente", valorPago: pago });
    // Uma leitura depois com outro total pago (depois de uma devolução ele pode vir líquido) não muda o pago congelado.
    vi.spyOn(c.provedor, "consultar").mockResolvedValue({ ...order, pago: pago - 500 });
    expect(await porFora(x.pagamentoId, minutos(10))).toEqual({ ok: false, erro: "A devolução por fora registra o valor desta devolução: R$ 1.724,00." });
    expect(await porFora(x.pagamentoId, minutos(11), { valor: pago })).toEqual({ ok: true, situacao: "por_fora" });
    vi.restoreAllMocks();
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "por_fora", porForaValor: pago });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ desfecho: "por_fora", valorPago: pago });
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

describe('resposta "aguarde" do Mercado Pago (M8.2c)', () => {
  it("devolução em andamento ou espera pedida: não conta falha, a chave fica em dúvida (nunca aceita), o código fica guardado e o envio seguinte repete a mesma chave; uma recusa depois conta só ela", async () => {
    for (const [n, codigo] of [
      [0, "em_andamento"],
      [1, "transitorio"],
    ] as const) {
      const x = await semReserva({ taxa: 1806 }, outras(n));
      const antes = pedidos().length;
      c.provedor.respostaDevolucao = codigo;
      expect(await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10))).toEqual({ ok: true, situacao: "pedida" });
      expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", tentativas: 1, falhas: 0, chaveEmDuvida: true, chaveAceita: false, ultimoCodigo: codigo, idProvedor: null });
      // Esperas seguidas (mais do que o limite de falhas) nunca desistem: continua pedida, sem aviso de falha.
      for (const m of [21, 32, 43, 54]) await conferirPendentes(db, c.org, c.provedor, minutos(m));
      const d = await devolucao(x.pagamentoId);
      expect(d).toMatchObject({ situacao: "pedida", tentativas: 5, falhas: 0, chaveEmDuvida: true, chaveAceita: false, ultimoCodigo: codigo });
      expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("devolucao_falhou");
      // Uma recusa clara depois das esperas conta uma falha só (não chega ao limite nem dá por recusada).
      c.provedor.falhas.devolver = new ErroProvedor("credencial", "Chave recusada pelo Mercado Pago.");
      await conferirPendentes(db, c.org, c.provedor, minutos(65));
      c.provedor.falhas.devolver = null;
      expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", tentativas: 6, falhas: 1, chaveEmDuvida: true, ultimoCodigo: null });
      expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("devolucao_falhou");
      // O Mercado Pago aceita: sai com a mesma chave de sempre (nada foi aceito por ela antes).
      c.provedor.respostaDevolucao = "confirmada";
      await conferirPendentes(db, c.org, c.provedor, minutos(76));
      expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "confirmada", tentativas: 7 });
      expect(new Set(pedidos().slice(antes).map((ch) => ch.chave))).toEqual(new Set([chaveDevolucao(d.id, 1)]));
      expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "devolvido", desfecho: "devolucao" });
    }
  });

  it("em andamento e depois uma devolução em parte feita no painel do Mercado Pago: a releitura aplica a leitura e a devolução para (aviso), nunca fica presa", async () => {
    const x = await semReserva();
    c.provedor.respostaDevolucao = "em_andamento";
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", falhas: 0, chaveAceita: false });
    c.provedor.devolverNoProvedor(x.idProvedor, 5000);
    await conferirPendentes(db, c.org, c.provedor, minutos(21));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "recusada", falhas: 0 });
    const t = await c.tentativa(x.pagamentoId);
    expect(t.situacao).toBe("devolvido_parcial");
    expect(t.avisos).toContain("devolucao_parada");
    expect(t.avisos).not.toContain("devolucao_falhou");
    expect(pedidos()).toHaveLength(1);
  });

  it("o código de cada resposta fica guardado: recusa com código (saldo insuficiente) conta falha e o próximo pedido leva chave nova; o aceite limpa o código", async () => {
    const x = await semReserva();
    c.provedor.respostaDevolucao = "saldo_insuficiente";
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    const d = await devolucao(x.pagamentoId);
    expect(d).toMatchObject({ situacao: "pedida", falhas: 1, chaveEmDuvida: false, ultimoCodigo: "saldo_insuficiente" });
    c.provedor.respostaDevolucao = "confirmada";
    await conferirPendentes(db, c.org, c.provedor, minutos(21));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "confirmada", ultimoCodigo: null });
    expect(pedidos().map((ch) => ch.chave)).toEqual([chaveDevolucao(d.id, 1), chaveDevolucao(d.id, 2)]);
  });
});

describe("devolução do cartão (M8.2b)", () => {
  /** Cartão aprovado sem reserva (valor diferente do total da cotação), à espera da devolução. */
  async function cartaoSemReserva(parcelas = 1) {
    const s = await c.segurar();
    c.provedor.respostaCartao = "processando";
    c.provedor.jurosCartao = 9_000;
    const r = await c.cartao(s.cotacaoId, { parcelas });
    await db.update(cotacoes).set({ total: TOTAL + 1 }).where(eq(cotacoes.id, s.cotacaoId));
    c.provedor.concluirAnalise(r.idProvedor!, "aprovado");
    await conferir(r.pagamentoId!, minutos(3));
    expect((await c.tentativa(r.pagamentoId!)).motivoSemReserva).toBe("valor_divergente");
    return { ...s, pagamentoId: r.pagamentoId!, idProvedor: r.idProvedor! };
  }
  const acoes = async (reservaId: string, quando: Date) => (await pagamentosDaReserva(db, c.org, reservaId, quando))[0].acoes;

  it("pelo Mercado Pago: o integral é o que o hóspede pagou, com os juros do parcelamento", async () => {
    const x = await cartaoSemReserva(3);
    expect((await c.tentativa(x.pagamentoId)).valorPago).toBe(TOTAL + 9_000);
    expect(await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10))).toMatchObject({ ok: true, situacao: "confirmada" });
    expect(await devolucao(x.pagamentoId)).toMatchObject({ valor: TOTAL + 9_000, situacao: "confirmada" });
    expect(pedidos()[0]).toMatchObject({ valor: null });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ desfecho: "devolucao", situacao: "devolvido" });
  });

  it("por fora: recusado enquanto dá para devolver pelo Mercado Pago (relendo a order antes); aceito depois que o Mercado Pago recusou a devolução de vez; o quadro do pagamento segue a mesma regra", async () => {
    const x = await cartaoSemReserva();
    expect((await acoes(x.reservaId, minutos(5))).devolucaoPorFora).toBe(false);
    expect((await acoes(x.reservaId, minutos(5))).devolver).toBe(true);
    const lidas = () => c.provedor.chamadas.filter((ch) => ch.metodo === "consultar").length;
    const antes = lidas();
    expect(await porFora(x.pagamentoId, minutos(5))).toEqual({ ok: false, erro: ERRO_POR_FORA_CARTAO });
    expect(lidas()).toBe(antes + 1);
    expect(ERRO_POR_FORA_CARTAO).toContain("devolva pelo Mercado Pago");
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ desfecho: null });
    // M8.2c (regra apertada): três recusas sem código (credencial recusada, por exemplo) dão a devolução por recusada, mas
    // não abrem a devolução por fora no cartão — o Mercado Pago ainda pode devolver.
    c.provedor.falhas.devolver = new ErroProvedor("credencial", "Chave recusada pelo Mercado Pago.");
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    await conferirPendentes(db, c.org, c.provedor, minutos(21));
    await conferirPendentes(db, c.org, c.provedor, minutos(32));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "recusada", ultimoCodigo: null });
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("devolucao_falhou");
    expect((await acoes(x.reservaId, minutos(40))).devolucaoPorFora).toBe(false);
    expect(await porFora(x.pagamentoId, minutos(40))).toEqual({ ok: false, erro: ERRO_POR_FORA_CARTAO });
    // Pedida de novo e recusada de vez pelo Mercado Pago (prazo): a devolução por fora passa a valer.
    c.provedor.falhas.devolver = null;
    c.provedor.respostaDevolucao = "prazo";
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(45));
    await conferirPendentes(db, c.org, c.provedor, minutos(56));
    await conferirPendentes(db, c.org, c.provedor, minutos(67));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "recusada", ultimoCodigo: "prazo" });
    expect((await acoes(x.reservaId, minutos(70))).devolucaoPorFora).toBe(true);
    expect(await porFora(x.pagamentoId, minutos(70))).toEqual({ ok: true, situacao: "por_fora" });
  });

  it("por fora depois dos 180 dias em que o Mercado Pago devolve: aceito (relendo a order antes)", async () => {
    expect(PRAZO_DEVOLUCAO_CARTAO_DIAS).toBe(180);
    const x = await cartaoSemReserva();
    const aprovadoEm = (await c.tentativa(x.pagamentoId)).aprovadoEm!;
    const dia179 = new Date(aprovadoEm.getTime() + 179 * 86_400_000);
    const dia181 = new Date(aprovadoEm.getTime() + 181 * 86_400_000);
    expect(await porFora(x.pagamentoId, dia179)).toEqual({ ok: false, erro: ERRO_POR_FORA_CARTAO });
    expect((await acoes(x.reservaId, dia181)).devolucaoPorFora).toBe(true);
    expect(await porFora(x.pagamentoId, dia181)).toEqual({ ok: true, situacao: "por_fora" });
    // A regra pura, para o Pix: sempre (as outras condições continuam).
    expect(porForaPermitidoNoCartao({ forma: "pix", avisos: [], aprovadoEm: null }, undefined, AGORA)).toBe(true);
  });

  it("por fora depois dos 180 dias, com a order já fora do tempo em que o Mercado Pago a guarda: aceito pelo último valor pago conferido; dentro do prazo de releitura, sem a order, nada se registra", async () => {
    const x = await cartaoSemReserva(3);
    const p = await c.tentativa(x.pagamentoId);
    const sumiu = vi.spyOn(c.provedor, "consultar").mockResolvedValue(null);
    // Dentro do prazo de releitura (85 dias), a order sumida não é motivo para registrar sem conferir.
    expect(await porFora(x.pagamentoId, minutos(40))).toMatchObject({ ok: false, erro: expect.stringContaining("não encontrou") });
    const dia181 = new Date(p.aprovadoEm!.getTime() + 181 * 86_400_000);
    expect(await porFora(x.pagamentoId, dia181, { valor: TOTAL })).toMatchObject({ ok: false, erro: expect.stringContaining("o último conferido no Mercado Pago") });
    expect(await porFora(x.pagamentoId, dia181, { valor: p.valorPago! })).toEqual({ ok: true, situacao: "por_fora" });
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "por_fora", porForaValor: p.valorPago });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ desfecho: "por_fora" });
    sumiu.mockRestore();
  });

  it("regra pura do cartão e do Pix", async () => {
    expect(porForaPermitidoNoCartao({ forma: "pix", avisos: [], aprovadoEm: null }, undefined, AGORA)).toBe(true);
  });
});

describe("devolução do cancelamento pela política e as regras do M8.2c", () => {
  const longe = { entrada: "2026-11-20", saida: "2026-11-23" };
  // Dados pessoais (§10): depois de cada fluxo, nada do hóspede (e-mail, telefone, nome) nas tabelas do pagamento, da
  // devolução, do cancelamento e do livro (notas de por fora, confirmação, recusa, parada e correção da taxa incluídas).
  afterEach(async () => {
    expect(await semDadosDoHospede(db)).toEqual([]);
  });
  const doLivro = (reservaId: string) => db.select().from(lancamentos).where(eq(lancamentos.reservaId, reservaId));
  /** Reserva paga e cancelada pela SCL (integral), com a devolução pedida ao Mercado Pago na fase 2. */
  async function cancelada(o: { forma?: "pix" | "cartao"; resposta?: ProvedorFalso["respostaDevolucao"]; liberar?: boolean; envelhecer?: number; antes?: () => void } = {}) {
    const equipe = await usuarioDeTeste(c);
    const x = await pagarEConfirmar(c, { ...longe, forma: o.forma });
    if (o.liberar) await liberar(c, x.pagamentoId, { quando: minutos(10) });
    if (o.envelhecer) await envelhecer(c, x.pagamentoId, o.envelhecer);
    c.provedor.respostaDevolucao = o.resposta ?? "confirmada";
    o.antes?.();
    const { resultado } = await cancelar(c, x.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" }), equipe, minutos(60));
    expect(resultado).toMatchObject({ ok: true, direito: "integral" });
    return { ...x, equipe, resultado: resultado as Extract<typeof resultado, { ok: true }> };
  }
  /** Acrescenta itens à leitura das devoluções da order (o que o painel do Mercado Pago mostraria). */
  function comItensNaLeitura(itens: DevolucaoLida[]) {
    const original = c.provedor.consultar.bind(c.provedor);
    return vi.spyOn(c.provedor, "consultar").mockImplementation(async (id) => {
      const r = await original(id);
      return r && { ...r, devolucoes: [...r.devolucoes, ...itens] };
    });
  }

  it("resposta incerta: a mesma chave; três incertas sem sinal → recusada sem código; no cartão a devolução por fora continua recusada; pedir de novo reusa a linha com chave nova", async () => {
    const x = await cancelada({ forma: "cartao", antes: () => { c.provedor.falhas.devolver = new ErroProvedor("incerto", "Sem resposta do Mercado Pago."); } });
    expect(x.resultado.devolucao).toBe("pedida");
    const d = await devolucao(x.pagamentoId);
    expect(d).toMatchObject({ origem: "cancelamento", situacao: "pedida", falhas: 1, chaveEmDuvida: true, chaveAtual: chaveDevolucao(d.id, 1) });
    await conferirPendentes(db, c.org, c.provedor, minutos(71));
    await conferirPendentes(db, c.org, c.provedor, minutos(82));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "recusada", falhas: 3, ultimoCodigo: null, idProvedor: null });
    expect(new Set(pedidos().map((ch) => ch.chave))).toEqual(new Set([chaveDevolucao(d.id, 1)]));
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("devolucao_falhou");
    // Incertas não dizem que o Mercado Pago recusou de vez: no cartão, nada de devolução por fora.
    expect(await porFora(x.pagamentoId, minutos(90))).toEqual({ ok: false, erro: ERRO_POR_FORA_CARTAO });
    c.provedor.falhas.devolver = null;
    expect(await devolverPeloProvedor(db, c.org, x.pagamentoId, x.equipe, c.provedor, minutos(95))).toEqual({ ok: true, situacao: "confirmada" });
    const depois = await devolucao(x.pagamentoId);
    expect(depois).toMatchObject({ id: d.id, situacao: "confirmada", confirmadaPor: "leitura" });
    expect(pedidos().at(-1)!.chave).toBe(chaveDevolucao(d.id, 4));
    expect((await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.pagamentoId, x.pagamentoId))).length).toBe(1);
  });

  it("pedido aceito e depois falho com o id da nossa devolução: solto (recusada, falhas no limite, aviso, auditoria) e a devolução por fora do cartão passa a valer", async () => {
    const x = await cancelada({ forma: "cartao", resposta: "pedida" });
    const d = await devolucao(x.pagamentoId);
    expect(d).toMatchObject({ situacao: "pedida", chaveAceita: true, idProvedor: expect.stringMatching(/^REFTST/) });
    c.provedor.falharDevolucao(d.idProvedor!);
    await conferir(x.pagamentoId, minutos(70));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "recusada", falhas: MAXIMO_FALHAS_DEVOLUCAO, chaveAceita: false, chaveEmDuvida: false, idProvedor: d.idProvedor, proximaTentativaEm: null });
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("devolucao_falhou");
    const [a] = await db.select().from(auditoria).where(and(eq(auditoria.entidadeId, x.pagamentoId), eq(auditoria.acao, "pagamento.devolucao_recusada")));
    expect(a.mudancas).toMatchObject({ devolucao: ["pedida", "recusada"], motivo: [null, "o Mercado Pago informou que a devolução pedida não saiu"] });
    expect(await porFora(x.pagamentoId, minutos(75))).toEqual({ ok: true, situacao: "por_fora" });
    // Por fora no cancelamento: o desfecho continua "reserva"; a taxa derivada do líquido informado (nada tinha entrado).
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ desfecho: "reserva" });
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "por_fora", taxaPerdida: 1824 });
    const [despesa] = await despesas();
    expect(despesa).toMatchObject({ valor: -1824, reservaId: x.reservaId, chaveOrigem: chaveTaxaPerdida(x.pagamentoId, d.id), dataCaixa: "2026-10-01" });
  });

  it("não solta: devolução antiga falha com a nova aceita ainda fora da listagem; aceita sem o id; falha junto de outra em andamento", async () => {
    // (1) Solta uma vez, a equipe pede de novo e a nova demora a aparecer: a antiga (falha) não solta a nova.
    const x = await cancelada({ resposta: "pedida" });
    const d1 = await devolucao(x.pagamentoId);
    c.provedor.falharDevolucao(d1.idProvedor!);
    await conferir(x.pagamentoId, minutos(70));
    expect((await devolucao(x.pagamentoId)).situacao).toBe("recusada");
    c.provedor.atrasarListagem(5);
    await devolverPeloProvedor(db, c.org, x.pagamentoId, x.equipe, c.provedor, minutos(80));
    const d2 = await devolucao(x.pagamentoId);
    expect(d2).toMatchObject({ situacao: "pedida", chaveAceita: true });
    expect(d2.idProvedor).not.toBe(d1.idProvedor);
    await conferir(x.pagamentoId, minutos(90));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", chaveAceita: true, idProvedor: d2.idProvedor });

    // (2) Aceita sem o id da devolução (a resposta não deixa saber qual): nunca solta sozinha.
    const y = await (async () => {
      const original = c.provedor.devolver.bind(c.provedor);
      const espiao = vi.spyOn(c.provedor, "devolver").mockImplementation(async (...a) => ({ ...(await original(...a)), idDevolucao: null }));
      c.provedor.respostaDevolucao = "pedida";
      const equipe = await usuarioDeTeste(c, "Outra Pessoa");
      const p = await pagarEConfirmar(c, { entrada: "2026-11-25", saida: "2026-11-27", email: "y@example.com" });
      await cancelar(c, p.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" }), equipe, minutos(60));
      espiao.mockRestore();
      return p;
    })();
    const dy = await devolucao(y.pagamentoId);
    expect(dy).toMatchObject({ situacao: "pedida", chaveAceita: true, idProvedor: null });
    const [item] = (await c.provedor.consultar(y.idProvedor))!.devolucoes;
    c.provedor.falharDevolucao(item.id);
    await conferir(y.pagamentoId, minutos(70));
    expect((await devolucao(y.pagamentoId)).situacao).toBe("pedida");

    // (3) A nossa falhou, mas há outra em andamento na order: espera.
    const w = await (async () => {
      c.provedor.respostaDevolucao = "pedida";
      const equipe = await usuarioDeTeste(c, "Mais Alguém");
      const p = await pagarEConfirmar(c, { entrada: "2026-11-28", saida: "2026-11-30", email: "w@example.com" });
      await cancelar(c, p.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" }), equipe, minutos(60));
      return p;
    })();
    const dw = await devolucao(w.pagamentoId);
    c.provedor.falharDevolucao(dw.idProvedor!);
    const espiao = comItensNaLeitura([{ id: "REFPNL9999", estado: "andamento", valor: 1000 }]);
    await conferir(w.pagamentoId, minutos(70));
    espiao.mockRestore();
    expect(await devolucao(w.pagamentoId)).toMatchObject({ situacao: "pedida", chaveAceita: true });
  });

  it("resposta incerta e o pedido repetido com a mesma chave: o reenvio vai marcado como repetido (o adaptador sabe que a resposta é a do pedido anterior) e o id dela solta o pedido que falhou", async () => {
    c.provedor.chaveRepetida = "mesma_resposta";
    const x = await cancelada({ forma: "cartao", resposta: "pedida", antes: () => { c.provedor.falhasDepois.devolver = new ErroProvedor("incerto", "Sem resposta do Mercado Pago."); } });
    const d = await devolucao(x.pagamentoId);
    expect(d).toMatchObject({ situacao: "pedida", chaveEmDuvida: true, chaveAceita: false, falhas: 1 });
    expect(pedidos().at(-1)).toMatchObject({ chave: chaveDevolucao(d.id, 1), repetida: false });
    // A devolução que o primeiro envio criou falha; a próxima volta reenvia a MESMA chave, marcada como repetida.
    c.provedor.falhasDepois.devolver = null;
    const [criada] = (await c.provedor.consultar(x.idProvedor))!.devolucoes;
    c.provedor.falharDevolucao(criada.id);
    await conferirPendentes(db, c.org, c.provedor, minutos(71));
    expect(pedidos().at(-1)).toMatchObject({ chave: chaveDevolucao(d.id, 1), repetida: true });
    // O Mercado Pago repetiu a resposta do primeiro envio, com o id da devolução dele: a leitura a mostra falha e solta o pedido.
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "recusada", chaveAceita: false, idProvedor: criada.id, falhas: MAXIMO_FALHAS_DEVOLUCAO });
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("devolucao_falhou");
  });

  it("aceita sem o id e depois falha (o sistema não solta sozinho): com o aviso de sem confirmação, a equipe registra a recusa do painel e a devolução sai da espera", async () => {
    const original = c.provedor.devolver.bind(c.provedor);
    const espiao = vi.spyOn(c.provedor, "devolver").mockImplementation(async (...a) => ({ ...(await original(...a)), idDevolucao: null }));
    const x = await cancelada({ forma: "cartao", resposta: "pedida" });
    espiao.mockRestore();
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", chaveAceita: true, idProvedor: null });
    const [item] = (await c.provedor.consultar(x.idProvedor))!.devolucoes;
    c.provedor.falharDevolucao(item.id);
    const registrar = (quando: Date) => registrarRecusaNoPainel(db, c.org, x.pagamentoId, { data: "2026-10-01", nota: "Painel mostra o estorno recusado" }, x.equipe, quando);
    // Antes do aviso de sem confirmação: o pedido aceito ainda pode sair, então não.
    await conferirPendentes(db, c.org, c.provedor, minutos(71));
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("devolucao_sem_confirmacao");
    expect(await registrar(minutos(75))).toMatchObject({ ok: false, erro: expect.stringContaining("Só uma devolução recusada") });
    await conferirPendentes(db, c.org, c.provedor, minutos(82));
    await conferirPendentes(db, c.org, c.provedor, minutos(93));
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("devolucao_sem_confirmacao");
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", chaveAceita: true });
    expect((await pagamentosDaReserva(db, c.org, x.reservaId, minutos(95)))[0].acoes.registrarRecusaNoPainel).toBe(true);
    // Com o aviso: a recusa do painel tira a devolução da espera (recusada, chaves desligadas), com auditoria.
    expect(await registrar(minutos(95))).toEqual({ ok: true, situacao: "recusada" });
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "recusada", chaveAceita: false, chaveEmDuvida: false, proximaTentativaEm: null, recusaNoPainelPor: x.equipe });
    const t = await c.tentativa(x.pagamentoId);
    expect(t.avisos).toContain("devolucao_falhou");
    expect(t.avisos).not.toContain("devolucao_sem_confirmacao");
    // Daí a equipe segue: pedir de novo ao Mercado Pago, ou a devolução por fora (no cartão, aberta pela recusa registrada).
    const acoes = (await pagamentosDaReserva(db, c.org, x.reservaId, minutos(96)))[0].acoes;
    expect([acoes.devolver, acoes.devolucaoPorFora]).toEqual([true, true]);
    expect(await porFora(x.pagamentoId, minutos(97))).toEqual({ ok: true, situacao: "por_fora" });
  });

  it("aceita, sem o id, com o aviso de sem confirmação, mas a leitura mostra devolução em andamento ou valor devolvido: a recusa do painel não é registrada", async () => {
    const original = c.provedor.devolver.bind(c.provedor);
    const espiao = vi.spyOn(c.provedor, "devolver").mockImplementation(async (...a) => ({ ...(await original(...a)), idDevolucao: null }));
    const x = await cancelada({ forma: "cartao", resposta: "pedida" });
    espiao.mockRestore();
    await db.update(pagamentos).set({ avisos: ["devolucao_sem_confirmacao"], devolucaoEmAndamentoLida: true }).where(eq(pagamentos.id, x.pagamentoId));
    const registrar = () => registrarRecusaNoPainel(db, c.org, x.pagamentoId, { data: "2026-10-01", nota: "Painel mostra o estorno recusado" }, x.equipe, minutos(95));
    expect(await registrar()).toMatchObject({ ok: false, erro: expect.stringContaining("Só uma devolução recusada") });
    await db.update(pagamentos).set({ devolucaoEmAndamentoLida: false, devolvidoLido: 1000 }).where(eq(pagamentos.id, x.pagamentoId));
    expect(await registrar()).toMatchObject({ ok: false, erro: expect.stringContaining("Só uma devolução recusada") });
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", chaveAceita: true });
  });

  it("confirmada pelo valor: a order 'processed/refunded' (situação desconhecida) com as devoluções que somam o devido confirma, acerta o caixa e guarda o valor confirmado", async () => {
    c.provedor.detalheDevolvido = "processed/refunded";
    const x = await cancelada({ liberar: true });
    expect(x.resultado.devolucao).toBe("confirmada");
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "confirmada", confirmadaPor: "leitura", valorConfirmado: TOTAL });
    // M8.2d (D27): "processed/refunded" explicado pelas nossas devoluções é a order devolvida, sem o aviso de situação desconhecida.
    const t = await c.tentativa(x.pagamentoId);
    expect(t.situacao).toBe("devolvido");
    expect(t.avisos).not.toContain("situacao_desconhecida");
    expect((await doLivro(x.reservaId)).filter((l) => l.tipo === "devolucao")).toMatchObject([{ montante: TOTAL - 1824, estado: "conciliado" }]);
  });

  it("devolvida a menos (D15, M8.2d): confirmada pelo que voltou, com o aviso dos dois valores e o caixa do que voltou; a rotina não pede nada; a equipe pede o restante ao Mercado Pago", async () => {
    const x = await cancelada({ liberar: true, antes: () => c.provedor.devolverAMenos(TOTAL - 5000) });
    expect(x.resultado.devolucao).toBe("confirmada");
    const t = await c.tentativa(x.pagamentoId);
    expect(t.situacao).toBe("devolvido_parcial");
    expect(t.avisos).toContain("devolucao_a_menor");
    const d = await devolucao(x.pagamentoId);
    expect(d).toMatchObject({ situacao: "confirmada", valor: TOTAL, valorConfirmado: TOTAL - 5000, confirmadaPor: "leitura", avisos: expect.arrayContaining(["devolucao_a_menor"]) });
    // O caixa do que voltou: o devolvido menos a taxa atribuída a ele (o resto sai com o restante).
    expect(d.taxaAtribuida).toBe(Math.round((1824 * (TOTAL - 5000)) / TOTAL));
    expect((await doLivro(x.reservaId)).filter((l) => l.tipo === "devolucao")).toMatchObject([{ montante: TOTAL - 5000 - d.taxaAtribuida!, estado: "conciliado" }]);
    expect((await db.select().from(auditoria).where(and(eq(auditoria.entidadeId, x.pagamentoId), eq(auditoria.acao, "pagamento.devolucao_a_menor")))).length).toBe(1);
    // A rotina não pede de novo nem relê esta devolução (já confirmada).
    const enviados = pedidos().length;
    await conferirPendentes(db, c.org, c.provedor, minutos(200));
    expect(pedidos().length).toBe(enviados);
    expect(await tentarDevolucao(db, c.org, d.id, c.provedor, minutos(201))).toBe("confirmada");
    expect(pedidos().length).toBe(enviados);
    // "Pedir o restante ao Mercado Pago": a devolução nova de R$ 50,00, com o valor explícito; confirmada pela leitura.
    const r = await pedirRestanteDaDevolucao(db, c.org, d.id, x.equipe, c.provedor, minutos(210));
    expect(r).toMatchObject({ ok: true, situacao: "confirmada" });
    expect(pedidos().at(-1)).toMatchObject({ valor: 5000 });
    const [restante] = await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.origemDevolucaoId, d.id));
    expect(restante).toMatchObject({ id: r.ok ? r.devolucaoId : "", origem: "cancelamento", cancelamentoId: d.cancelamentoId, situacao: "confirmada", valor: 5000, valorConfirmado: 5000 });
    const depois = await c.tentativa(x.pagamentoId);
    expect(depois.situacao).toBe("devolvido");
    expect(depois.avisos).not.toContain("devolucao_a_menor");
    expect(depois.avisos).toContain("taxa_perdida_desconhecida");
    // O caixa das duas: tudo o que entrou sai (o restante completa o pagamento).
    expect((await doLivro(x.reservaId)).filter((l) => l.tipo === "devolucao").reduce((soma, l) => soma + (l.montante ?? 0), 0)).toBe(TOTAL - 1824);
    // Uma vez só.
    expect(await pedirRestanteDaDevolucao(db, c.org, d.id, x.equipe, c.provedor, minutos(220))).toMatchObject({ ok: false });
    expect(pedidos().length).toBe(enviados + 1);
  });

  it("cartão: saldo insuficiente fica guardado e nunca abre a devolução por fora; a regra pura (recusas definitivas, 180 dias, recusa no painel, a nossa devolução solta)", async () => {
    const x = await cancelada({ forma: "cartao", resposta: "saldo_insuficiente" });
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", falhas: 1, ultimoCodigo: "saldo_insuficiente" });
    await conferirPendentes(db, c.org, c.provedor, minutos(71));
    await conferirPendentes(db, c.org, c.provedor, minutos(82));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "recusada", ultimoCodigo: "saldo_insuficiente" });
    expect(await porFora(x.pagamentoId, minutos(90))).toEqual({ ok: false, erro: ERRO_POR_FORA_CARTAO });

    const cartao = { forma: "cartao" as const, avisos: [] as CodigoAviso[], aprovadoEm: AGORA, criadoEm: AGORA };
    const recusada = (o: Partial<{ ultimoCodigo: CodigoDevolucao | null; recusaNoPainelEm: Date | null; idProvedor: string | null }> = {}) => ({ situacao: "recusada" as const, ultimoCodigo: null, recusaNoPainelEm: null, idProvedor: null, ...o });
    const hoje = minutos(60);
    const dia90 = new Date(AGORA.getTime() + 90 * 86_400_000);
    expect(porForaPermitidoNoCartao(cartao, recusada({ ultimoCodigo: "saldo_insuficiente" }), hoje)).toBe(false);
    expect(porForaPermitidoNoCartao(cartao, recusada({ ultimoCodigo: "nao_permitido" }), hoje)).toBe(true);
    expect(porForaPermitidoNoCartao(cartao, recusada({ ultimoCodigo: "prazo" }), hoje)).toBe(true);
    expect(porForaPermitidoNoCartao(cartao, recusada({ ultimoCodigo: "nao_encontrado" }), hoje)).toBe(true);
    // "Não encontrado" depois do prazo de leitura não diz nada (a order some da consulta).
    expect(porForaPermitidoNoCartao(cartao, recusada({ ultimoCodigo: "nao_encontrado" }), dia90)).toBe(false);
    // D12: recusada sem pedido (pagamento com mais de 78 dias), sem código: não abre.
    expect(porForaPermitidoNoCartao(cartao, recusada(), hoje)).toBe(false);
    // A nossa devolução solta pela leitura: o id e o aviso.
    expect(porForaPermitidoNoCartao(cartao, recusada({ idProvedor: "REFTST0001" }), hoje)).toBe(false);
    expect(porForaPermitidoNoCartao({ ...cartao, avisos: ["devolucao_falhou"] }, recusada({ idProvedor: "REFTST0001" }), hoje)).toBe(true);
    expect(porForaPermitidoNoCartao(cartao, { situacao: "pedida", ultimoCodigo: null, recusaNoPainelEm: hoje, idProvedor: null }, hoje)).toBe(true);
    expect(porForaPermitidoNoCartao(cartao, { situacao: "pedida", ultimoCodigo: null, recusaNoPainelEm: null, idProvedor: null }, hoje)).toBe(false);
    expect(porForaPermitidoNoCartao(cartao, undefined, new Date(AGORA.getTime() + 181 * 86_400_000))).toBe(true);
    expect(porForaPermitidoNoCartao(cartao, undefined, hoje)).toBe(false);
  });

  it("por fora no cancelamento: a taxa derivada dos recebimentos (B − Σ); com taxa divergente, aviso e a equipe informa; sem nada conhecido, aviso", async () => {
    // Pix com mais de 78 dias: nada é pedido (recusada); liberado, a taxa é o devolvido menos o que entrou.
    const x = await cancelada({ liberar: true, envelhecer: 80 });
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "recusada", falhas: 0 });
    expect(await porFora(x.pagamentoId, minutos(70))).toEqual({ ok: true, situacao: "por_fora" });
    const dx = await devolucao(x.pagamentoId);
    expect(dx).toMatchObject({ situacao: "por_fora", taxaPerdida: 1824, porForaValor: TOTAL });
    expect((await despesas()).filter((l) => l.reservaId === x.reservaId)).toMatchObject([{ valor: -1824, chaveOrigem: chaveTaxaPerdida(x.pagamentoId, dx.id) }]);
    expect((await doLivro(x.reservaId)).filter((l) => l.tipo === "devolucao")).toMatchObject([{ montante: TOTAL - 1824, estado: "realizado", origem: "manual", dataCaixa: "2026-10-01" }]);
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("taxa_perdida_desconhecida");

    // Taxa divergente (recebimento e provedor discordam): não deriva; aviso; a equipe informa (teto: o devolvido por fora).
    const equipe = await usuarioDeTeste(c, "Pessoa Dois");
    const y = await pagarEConfirmar(c, { entrada: "2026-11-25", saida: "2026-11-27", email: "y@example.com" });
    const ty = await c.tentativa(y.pagamentoId);
    // Liberado pelo Mercado Pago (o recebimento entra); o aviso de taxa divergente ligado por uma leitura (depois da
    // liberação pelo provedor, o detalhe financeiro não é mais relido, e o aviso fica).
    c.provedor.atualizarFinanceiro(y.idProvedor, { liberado: true, liquido: ty.valor - 1824 });
    await conferir(y.pagamentoId, minutos(10));
    expect((await doLivro(y.reservaId)).filter((l) => l.tipo === "recebimento")).toHaveLength(1);
    await db.update(pagamentos).set({ avisos: ["taxa_divergente"] }).where(eq(pagamentos.id, y.pagamentoId));
    await envelhecer(c, y.pagamentoId, 80);
    const depois = (m: number) => minutos(60 + m);
    await cancelar(c, y.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" }), equipe, depois(0));
    expect((await c.tentativa(y.pagamentoId)).avisos).toContain("taxa_divergente");
    expect(await porFora(y.pagamentoId, depois(20), { valor: ty.valorPago! })).toEqual({ ok: true, situacao: "por_fora" });
    expect(await devolucao(y.pagamentoId)).toMatchObject({ situacao: "por_fora", taxaPerdida: null });
    expect((await c.tentativa(y.pagamentoId)).avisos).toContain("taxa_perdida_desconhecida");
    expect(await registrarTaxaPerdida(db, c.org, y.pagamentoId, ty.valorPago! + 1, equipe, depois(30))).toMatchObject({ ok: false, erro: expect.stringContaining("não pode passar do valor devolvido por fora") });
    expect(await registrarTaxaPerdida(db, c.org, y.pagamentoId, 1500, equipe, depois(30))).toEqual({ ok: true });
    expect((await c.tentativa(y.pagamentoId)).avisos).not.toContain("taxa_perdida_desconhecida");

    // Nada entrou e o líquido não é conhecido: aviso.
    const z = await pagarEConfirmar(c, { entrada: "2026-11-28", saida: "2026-11-30", email: "z@example.com" });
    await envelhecer(c, z.pagamentoId, 80);
    c.provedor.atualizarFinanceiro(z.idProvedor, { liquido: null });
    await db.update(pagamentos).set({ liquido: null }).where(eq(pagamentos.id, z.pagamentoId));
    await cancelar(c, z.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" }), equipe, minutos(60));
    const tz = await c.tentativa(z.pagamentoId);
    expect(await porFora(z.pagamentoId, minutos(70), { valor: tz.valorPago! })).toEqual({ ok: true, situacao: "por_fora" });
    expect(await devolucao(z.pagamentoId)).toMatchObject({ taxaPerdida: null });
    expect((await c.tentativa(z.pagamentoId)).avisos).toContain("taxa_perdida_desconhecida");
  });

  it("corrigir a taxa que não voltou: estorna a atual e lança a nova com a chave seguinte (#2, #3); zero não lança; motivo obrigatório, sem dado pessoal, nunca acima do teto", async () => {
    const x = await cancelada();
    const d = await devolucao(x.pagamentoId);
    expect(await corrigirTaxaPerdida(db, c.org, x.pagamentoId, 1000, "Extrato", x.equipe, minutos(70))).toMatchObject({ ok: false, erro: expect.stringContaining("Ainda não há taxa") });
    expect(await registrarTaxaPerdida(db, c.org, x.pagamentoId, 1000, x.equipe, minutos(70))).toEqual({ ok: true });
    expect(await registrarTaxaPerdida(db, c.org, x.pagamentoId, 1200, x.equipe, minutos(70))).toMatchObject({ ok: false, erro: expect.stringContaining("Corrigir taxa que não voltou") });
    expect(await corrigirTaxaPerdida(db, c.org, x.pagamentoId, 1200, "", x.equipe, minutos(71))).toEqual({ ok: false, erro: "Informe o motivo da correção." });
    expect(await corrigirTaxaPerdida(db, c.org, x.pagamentoId, 1200, "e-mail hospede@example.com", x.equipe, minutos(71))).toMatchObject({ ok: false, erro: expect.stringContaining("dados pessoais") });
    expect(await corrigirTaxaPerdida(db, c.org, x.pagamentoId, 1000, "Extrato do mês", x.equipe, minutos(71))).toMatchObject({ ok: false, erro: expect.stringContaining("já está registrada") });
    expect(await corrigirTaxaPerdida(db, c.org, x.pagamentoId, 1825, "Extrato do mês", x.equipe, minutos(71))).toMatchObject({ ok: false, erro: expect.stringContaining("(R$ 18,25)") });
    expect(await corrigirTaxaPerdida(db, c.org, x.pagamentoId, 1824, "Extrato do mês", x.equipe, minutos(72))).toEqual({ ok: true });
    expect(await corrigirTaxaPerdida(db, c.org, x.pagamentoId, 0, "A taxa voltou toda", x.equipe, minutos(73))).toEqual({ ok: true });
    expect(await corrigirTaxaPerdida(db, c.org, x.pagamentoId, 500, "Extrato corrigido", x.equipe, minutos(74))).toEqual({ ok: true });
    const todas = await despesas();
    const chaves = todas.filter((l) => l.chaveOrigem?.includes(d.id) && l.origem !== "estorno").map((l) => l.chaveOrigem);
    expect(chaves).toEqual([chaveTaxaPerdida(x.pagamentoId, d.id), chaveTaxaPerdida(x.pagamentoId, d.id, 2), chaveTaxaPerdida(x.pagamentoId, d.id, 3)]);
    // Em vigor só a última (R$ 5,00): as outras duas estornadas.
    const estornadas = new Set(todas.filter((l) => l.estornoDe).map((l) => l.estornoDe));
    expect(todas.filter((l) => !l.estornoDe && !estornadas.has(l.id)).map((l) => l.valor)).toEqual([-500]);
    expect(await devolucao(x.pagamentoId)).toMatchObject({ taxaPerdida: 500 });
    const correcoes = (await db.select().from(auditoria).where(and(eq(auditoria.entidadeId, x.pagamentoId), eq(auditoria.acao, "pagamento.taxa_perdida_corrigida")))).map((a) => a.mudancas);
    expect(correcoes).toHaveLength(3);
    expect(correcoes).toEqual(expect.arrayContaining([{ taxaPerdida: [1000, 1824] }, { taxaPerdida: [1824, 0] }, { taxaPerdida: [0, 500] }]));
  });

  it("despesa antiga (chave do M8.2a, taxa já registrada): nunca é lançada de novo", async () => {
    const x = await semReserva();
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    expect(await registrarTaxaPerdida(db, c.org, x.pagamentoId, 1806, null, minutos(20))).toEqual({ ok: true });
    const [antiga] = await despesas();
    await db.update(lancamentos).set({ chaveOrigem: `mercadopago:${x.pagamentoId}:taxa_perdida` }).where(eq(lancamentos.id, antiga.id));
    expect(await registrarTaxaPerdida(db, c.org, x.pagamentoId, 1806, null, minutos(30))).toMatchObject({ ok: false });
    await conferirPendentes(db, c.org, c.provedor, minutos(40));
    expect((await despesas()).map((l) => l.chaveOrigem)).toEqual([`mercadopago:${x.pagamentoId}:taxa_perdida`]);
  });

  it("parar a devolução pedida: só depois do prazo de leitura; sem pedido aceito, direto; com ele, só com a nota e a order fora da leitura", async () => {
    // Sem aceite nem dúvida (recusa clara de uma chave nova), depois de 90 dias.
    c.provedor.respostaDevolucao = "saldo_insuficiente";
    const x = await semReserva();
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", chaveAceita: false, chaveEmDuvida: false });
    expect(await pararDevolucaoPedida(db, c.org, x.pagamentoId, { nota: "" }, null, c.provedor, minutos(20))).toMatchObject({ ok: false, erro: expect.stringContaining("depois do prazo de leitura") });
    await envelhecer(c, x.pagamentoId, 90);
    expect(await pararDevolucaoPedida(db, c.org, x.pagamentoId, { nota: "" }, null, c.provedor, minutos(30))).toEqual({ ok: true, situacao: "recusada" });
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "recusada", paradaNota: "", proximaTentativaEm: null });
    expect((await devolucao(x.pagamentoId)).paradaEm).not.toBeNull();
    // Com o pedido aceito.
    c.provedor.respostaDevolucao = "pedida";
    const y = await semReserva({ taxa: 1806 }, outras(1));
    await devolverPeloProvedor(db, c.org, y.pagamentoId, null, c.provedor, minutos(10));
    expect(await devolucao(y.pagamentoId)).toMatchObject({ situacao: "pedida", chaveAceita: true });
    await envelhecer(c, y.pagamentoId, 90);
    expect(await pararDevolucaoPedida(db, c.org, y.pagamentoId, { nota: "" }, null, c.provedor, minutos(30))).toEqual({ ok: false, erro: "Escreva a nota: o que o painel do Mercado Pago mostra (nenhuma devolução saiu)." });
    expect(await pararDevolucaoPedida(db, c.org, y.pagamentoId, { nota: "O painel não mostra devolução" }, null, null, minutos(30))).toEqual({ ok: false, erro: ERRO_POR_FORA_SEM_CONFERIR });
    expect(await pararDevolucaoPedida(db, c.org, y.pagamentoId, { nota: "O painel não mostra devolução" }, null, c.provedor, minutos(30))).toMatchObject({ ok: false, erro: expect.stringContaining("ainda mostra este pagamento") });
    c.provedor.esquecerOrder(y.idProvedor);
    expect(await pararDevolucaoPedida(db, c.org, y.pagamentoId, { nota: "O painel não mostra devolução" }, null, c.provedor, minutos(31))).toEqual({ ok: true, situacao: "recusada" });
    expect(await devolucao(y.pagamentoId)).toMatchObject({ situacao: "recusada", chaveAceita: false, chaveEmDuvida: false, paradaNota: "O painel não mostra devolução" });
    expect((await db.select().from(auditoria).where(and(eq(auditoria.entidadeId, y.pagamentoId), eq(auditoria.acao, "pagamento.devolucao_parada_pela_equipe")))).length).toBe(1);
  });

  it("recusa no painel do Mercado Pago registrada: data e nota obrigatórias, uma vez; abre a devolução por fora no cartão", async () => {
    const x = await cancelada({ forma: "cartao", envelhecer: 80 });
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "recusada", falhas: 0 });
    expect(await porFora(x.pagamentoId, minutos(70))).toEqual({ ok: false, erro: ERRO_POR_FORA_CARTAO });
    expect(await registrarRecusaNoPainel(db, c.org, x.pagamentoId, { data: "2026-10-01", nota: "" }, x.equipe, minutos(70))).toEqual({ ok: false, erro: "Escreva a nota (sem dados pessoais)." });
    expect(await registrarRecusaNoPainel(db, c.org, x.pagamentoId, { data: "2026-10-02", nota: "Painel recusou" }, x.equipe, minutos(70))).toEqual({ ok: false, erro: "A data não pode ser no futuro." });
    expect(await registrarRecusaNoPainel(db, c.org, x.pagamentoId, { data: "2026-10-01", nota: "Painel recusou: prazo" }, x.equipe, minutos(70))).toEqual({ ok: true, situacao: "recusada" });
    expect(await registrarRecusaNoPainel(db, c.org, x.pagamentoId, { data: "2026-10-01", nota: "De novo" }, x.equipe, minutos(71))).toMatchObject({ ok: false, erro: expect.stringContaining("já foi registrada") });
    expect(await devolucao(x.pagamentoId)).toMatchObject({ recusaNoPainelNota: "Painel recusou: prazo", recusaNoPainelPor: x.equipe });
    expect(await porFora(x.pagamentoId, minutos(72))).toEqual({ ok: true, situacao: "por_fora" });
  });

  it("D12 nas novas tentativas: passados os 78 dias entre um envio e outro, nada mais se pede; sem a chave em dúvida, a devolução fica recusada com o aviso e a equipe resolve", async () => {
    // Recusa clara (saldo insuficiente): a próxima tentativa iria com chave nova.
    const x = await cancelada({ resposta: "saldo_insuficiente" });
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", falhas: 1, chaveEmDuvida: false });
    c.provedor.respostaDevolucao = "confirmada";
    await envelhecer(c, x.pagamentoId, 80);
    const enviados = pedidos().length;
    await conferirPendentes(db, c.org, c.provedor, minutos(71));
    expect(pedidos().length).toBe(enviados);
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "recusada", falhas: 1, proximaTentativaEm: null, ultimoCodigo: "saldo_insuficiente" });
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("devolucao_fora_do_prazo");
    const [a] = await db.select().from(auditoria).where(and(eq(auditoria.entidadeId, x.pagamentoId), eq(auditoria.acao, "pagamento.devolucao_fora_do_prazo")));
    expect(a.mudancas).toEqual({ devolucao: ["pedida", "recusada"] });
    // Pedir de novo ao Mercado Pago, não (mais de 78 dias); no Pix, a devolução por fora vale.
    expect(await devolverPeloProvedor(db, c.org, x.pagamentoId, x.equipe, c.provedor, minutos(80))).toMatchObject({ ok: false, erro: expect.stringContaining("mais de 78 dias") });
    expect(await porFora(x.pagamentoId, minutos(80))).toEqual({ ok: true, situacao: "por_fora" });
  });

  it("D12 nas novas tentativas: com a chave em dúvida (um envio pode ter sido aceito), nada se envia depois dos 78 dias; continua pedida, só a leitura, e ela confirma quando o Mercado Pago mostra", async () => {
    const x = await cancelada({ forma: "cartao", antes: () => { c.provedor.falhas.devolver = new ErroProvedor("incerto", "Sem resposta do Mercado Pago."); } });
    c.provedor.falhas.devolver = null;
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", falhas: 1, chaveEmDuvida: true });
    // Ainda com até 78 dias, a mesma chave sairia de novo; com 80, não.
    await envelhecer(c, x.pagamentoId, 80);
    const enviados = pedidos().length;
    await conferirPendentes(db, c.org, c.provedor, minutos(71));
    expect(pedidos().length).toBe(enviados);
    const d = await devolucao(x.pagamentoId);
    expect(d).toMatchObject({ situacao: "pedida", falhas: 1, chaveEmDuvida: true, chaveAceita: false });
    expect(d.proximaTentativaEm).toEqual(new Date(minutos(71).getTime() + ESPERA_DEVOLUCAO_MS));
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("devolucao_fora_do_prazo");
    // Pedida (o envio pode ter saído): a devolução por fora é recusada.
    expect(await porFora(x.pagamentoId, minutos(75))).toEqual({ ok: false, erro: "A devolução deste cancelamento já está pedida ou feita." });
    // O envio incerto tinha saído: o Mercado Pago mostra a devolução e a leitura confirma (nada foi pedido de novo).
    c.provedor.devolverNoProvedor(x.idProvedor, TOTAL);
    await conferirPendentes(db, c.org, c.provedor, minutos(90));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "confirmada", confirmadaPor: "leitura" });
    expect(pedidos().length).toBe(enviados);
  });

  it("rotina: a devolução do cancelamento pedida é retomada; fora do prazo de leitura, só o aviso (uma vez); de origem desconhecida, não é tocada", async () => {
    const x = await cancelada({ resposta: "pedida", antes: () => { c.provedor.falhas.devolver = new ErroProvedor("indisponivel", "Fora do ar."); } });
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", chaveAceita: false });
    c.provedor.falhas.devolver = null;
    await conferirPendentes(db, c.org, c.provedor, minutos(71));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "pedida", chaveAceita: true });
    // Passado o prazo de leitura (85 dias): nada se lê, só o aviso, uma vez.
    await envelhecer(c, x.pagamentoId, 90);
    const antes = c.provedor.chamadas.length;
    await conferirPendentes(db, c.org, c.provedor, minutos(200));
    await conferirPendentes(db, c.org, c.provedor, minutos(300));
    expect(c.provedor.chamadas.slice(antes).filter((ch) => ch.id === x.idProvedor)).toEqual([]);
    expect((await c.tentativa(x.pagamentoId)).avisos.filter((a) => a === "devolucao_fora_do_prazo")).toHaveLength(1);
    // Origem que esta versão não conhece (banco de prévia de uma versão mais nova): nem a rotina nem o pedido a tocam.
    const y = await semReserva({ taxa: 1806 }, outras(2));
    c.provedor.respostaDevolucao = "confirmada";
    c.provedor.falhas.devolver = new ErroProvedor("indisponivel", "Fora do ar.");
    await devolverPeloProvedor(db, c.org, y.pagamentoId, null, c.provedor, minutos(10));
    c.provedor.falhas.devolver = null;
    const dy = await devolucao(y.pagamentoId);
    await db.update(devolucoesPagamento).set({ origem: "futura" }).where(eq(devolucoesPagamento.id, dy.id));
    const enviados = pedidos().length;
    await conferirPendentes(db, c.org, c.provedor, minutos(30));
    expect(await tentarDevolucao(db, c.org, dy.id, c.provedor, minutos(31))).toBe("pedida");
    expect(pedidos().length).toBe(enviados);
    expect(await devolverPeloProvedor(db, c.org, y.pagamentoId, null, c.provedor, minutos(32))).toEqual({ ok: false, erro: "Esta devolução foi registrada por uma versão mais nova do sistema: resolva por ela." });
  });
});
