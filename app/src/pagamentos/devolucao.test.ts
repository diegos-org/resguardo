import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { lerConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import { categoriasDespesa, cotacoes, devolucoesPagamento, lancamentos } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { conferirTentativa } from "./conferencia";
import { chaveDevolucao, devolverPeloProvedor, MAXIMO_FALHAS_DEVOLUCAO, registrarDevolucaoPorFora } from "./devolucao";
import { ErroProvedor } from "./provedor";
import { conferirPendentes } from "./rotina";
import { type Cenario, minutos, montarCenario, TOTAL } from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => { c = await montarCenario(db); });

const conferir = (id: string, quando: Date) => conferirTentativa(db, c.org, id, c.provedor, quando, { origem: "rotina", forcar: true });
const devolucao = async (pagamentoId: string) => (await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.pagamentoId, pagamentoId)))[0];
const despesas = () => db.select().from(lancamentos).where(and(eq(lancamentos.organizacaoId, c.org), eq(lancamentos.tipo, "despesa_empresa")));

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
  it("pelo Mercado Pago: chave gravada antes, confirmação pela leitura, desfecho devolução e a taxa perdida como despesa da empresa (valor do provedor)", async () => {
    const x = await semReserva();
    const r = await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    expect(r).toEqual({ ok: true, situacao: "confirmada" });
    const d = await devolucao(x.pagamentoId);
    expect(d).toMatchObject({ situacao: "confirmada", tentativas: 1, chaveAtual: chaveDevolucao(d.id, 1), valor: TOTAL, taxaPerdida: 1806 });
    expect(c.provedor.chamadas.find((ch) => ch.metodo === "devolver")).toMatchObject({ chave: chaveDevolucao(d.id, 1), valor: null });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "devolvido", desfecho: "devolucao" });
    const [despesa] = await despesas();
    expect(despesa).toMatchObject({ valor: -1806, montante: 1806, efeitoSaldo: 0, estado: "realizado", origem: "sincronizacao", chaveOrigem: `mercadopago:${d.id}:taxa`, imovelId: c.imovel, proprietarioId: null, dataCaixa: "2026-10-01" });
    // Categoria criada no primeiro uso e guardada na configuração (editável depois).
    const [cat] = await db.select().from(categoriasDespesa).where(eq(categoriasDespesa.id, despesa.categoriaId!));
    expect(cat.nome).toBe("Taxa do pagamento do site");
    expect((await lerConfigPagamentoSite(db, c.org)).categoriaTaxaId).toBe(cat.id);
    // Repetir não devolve de novo nem lança outra despesa.
    expect(await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(11))).toMatchObject({ ok: false });
    await conferirPendentes(db, c.org, c.provedor, minutos(30));
    expect(await despesas()).toHaveLength(1);
  });

  it("pedida até o provedor confirmar; a rotina relê a order antes de pedir de novo (já devolvida = confirmada, sem reenviar)", async () => {
    const x = await semReserva();
    c.provedor.respostaDevolucao = "pedida";
    expect(await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10))).toEqual({ ok: true, situacao: "pedida" });
    c.provedor.confirmarDevolucoes(x.idProvedor);
    const pedidos = c.provedor.chamadas.filter((ch) => ch.metodo === "devolver").length;
    await conferirPendentes(db, c.org, c.provedor, minutos(21));
    expect((await devolucao(x.pagamentoId)).situacao).toBe("confirmada");
    expect(c.provedor.chamadas.filter((ch) => ch.metodo === "devolver")).toHaveLength(pedidos);
    expect((await c.tentativa(x.pagamentoId)).desfecho).toBe("devolucao");
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

  it("falhas: cada pedido novo usa chave nova; depois de 3, aviso, e a equipe registra a devolução feita por fora", async () => {
    const x = await semReserva();
    c.provedor.falhas.devolver = new ErroProvedor("incerto", "tempo");
    expect(await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10))).toEqual({ ok: true, situacao: "pedida" });
    // Antes da próxima tentativa, nada é reenviado.
    await conferirPendentes(db, c.org, c.provedor, minutos(15));
    expect(c.provedor.chamadas.filter((ch) => ch.metodo === "devolver")).toHaveLength(1);
    await conferirPendentes(db, c.org, c.provedor, minutos(21));
    await conferirPendentes(db, c.org, c.provedor, minutos(32));
    const d = await devolucao(x.pagamentoId);
    expect(d).toMatchObject({ situacao: "recusada", tentativas: 3, falhas: MAXIMO_FALHAS_DEVOLUCAO });
    expect(c.provedor.chamadas.filter((ch) => ch.metodo === "devolver").map((ch) => ch.chave)).toEqual([1, 2, 3].map((n) => chaveDevolucao(d.id, n)));
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("devolucao_falhou");
    await conferirPendentes(db, c.org, c.provedor, minutos(60));
    expect(c.provedor.chamadas.filter((ch) => ch.metodo === "devolver")).toHaveLength(3);
    expect((await conferirPendentes(db, c.org, c.provedor, minutos(61))).conferidas).toBe(0);
    expect(await registrarDevolucaoPorFora(db, c.org, x.pagamentoId, { data: "2026-10-02", valor: TOTAL, nota: "Pix da conta" }, null, minutos(70))).toMatchObject({ ok: false, erro: expect.stringContaining("futuro") });
    expect(await registrarDevolucaoPorFora(db, c.org, x.pagamentoId, { data: "2026-10-01", valor: TOTAL, nota: "Pix da conta da empresa" }, null, minutos(70))).toEqual({ ok: true, situacao: "por_fora" });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ desfecho: "por_fora", avisos: [] });
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "por_fora", porForaData: "2026-10-01", porForaValor: TOTAL, porForaNota: "Pix da conta da empresa" });
  });

  it("dada por recusada depois de 3 falhas, mas o dinheiro voltou (o último pedido acabou saindo): a releitura diária confirma", async () => {
    const x = await semReserva();
    c.provedor.falhas.devolver = new ErroProvedor("incerto", "tempo");
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

  it("taxa perdida sem o valor do provedor: aviso, nunca palpite; quando o provedor informa, a despesa entra", async () => {
    const x = await semReserva({ liquido: TOTAL - 1806 });
    expect((await c.tentativa(x.pagamentoId)).taxa).toBe(1806);
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ situacao: "confirmada", taxaPerdida: null });
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("taxa_perdida_desconhecida");
    expect(await despesas()).toEqual([]);
    c.provedor.atualizarFinanceiro(x.idProvedor, { taxa: 900 });
    await conferirPendentes(db, c.org, c.provedor, minutos(30));
    expect(await devolucao(x.pagamentoId)).toMatchObject({ taxaPerdida: 900 });
    expect((await despesas()).map((l) => l.valor)).toEqual([-900]);
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("taxa_perdida_desconhecida");
  });

  it("recusas: pagamento que confirmou a reserva, ainda pendente, ou já com devolução pedida; por fora com devolução pedida", async () => {
    const s = await c.segurar();
    const p = await c.pix(s.cotacaoId);
    expect(await devolverPeloProvedor(db, c.org, p.pagamentoId, null, c.provedor, minutos(2))).toMatchObject({ ok: false, erro: expect.stringContaining("aprovado") });
    c.provedor.aprovar(p.idProvedor);
    await conferir(p.pagamentoId, minutos(3));
    expect(await devolverPeloProvedor(db, c.org, p.pagamentoId, null, c.provedor, minutos(4))).toMatchObject({ ok: false, erro: expect.stringContaining("desfecho") });
    expect(await registrarDevolucaoPorFora(db, c.org, p.pagamentoId, { data: "2026-10-01", valor: 1, nota: "" }, null, minutos(4))).toMatchObject({ ok: false });
    const x = await semReserva({ taxa: 1806 }, { entrada: "2026-11-02", saida: "2026-11-05", email: "y@example.com" });
    c.provedor.respostaDevolucao = "pedida";
    await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    expect(await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(11))).toMatchObject({ ok: false, erro: expect.stringContaining("já há uma devolução pedida".replace("já", "Já")) });
    expect(await registrarDevolucaoPorFora(db, c.org, x.pagamentoId, { data: "2026-10-01", valor: TOTAL, nota: "" }, null, minutos(11))).toMatchObject({ ok: false });
    expect(await devolverPeloProvedor(db, "00000000-0000-4000-8000-000000000009", x.pagamentoId, null, c.provedor, minutos(11))).toMatchObject({ ok: false, erro: "Pagamento não encontrado." });
  });
});
