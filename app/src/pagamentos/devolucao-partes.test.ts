/**
 * M8.2d — o motor de devoluções com várias devoluções por pagamento: devoluções de parte do valor (as da alteração, pela
 * costura `reduzirDeTeste`), cada uma confirmada por ela mesma (pelo id, pelo valor, por completar o pagamento), a espera
 * pela liberação (D13), o teto (D12), o corpo do pedido guardado (D29), a resposta perdida (D21), o que sobra (restante
 * sem reserva, por fora de parte, a menor e o restante dela) e o provedor pessimista. Nada usa rede; o Mercado Pago é o falso.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cotacoes, devolucoesPagamento, lancamentos, pagamentos } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { devolvidaNoProvedorDaReserva } from "@/reservas/repositorio";
import { conferirTentativa } from "./conferencia";
import { pagamentosDaReserva } from "./consultas";
import {
  chaveDevolucao,
  chaveTaxaPerdida,
  confirmarDevolucaoVistaNoProvedor,
  devolverPeloProvedor,
  ERRO_FORA_SEM_VALOR,
  ERRO_POR_FORA_CHAVE_ENVIADA,
  esperaLiberacao,
  pedirRestanteDaDevolucao,
  porForaPermitidoNoCartao,
  registrarDevolucaoPorFora,
  registrarTaxaPerdida,
  tentarDevolucao,
} from "./devolucao";
import { pessimista } from "./falso";
import { estornarLiberacaoManual } from "./liberacao";
import { ErroProvedor } from "./provedor";
import { conferirPendentes } from "./rotina";
import { AGORA, type Cenario, envelhecer, liberar, minutos, montarCenario, pagarEConfirmar, reduzirDeTeste, semDadosDoHospede, TOTAL, usuarioDeTeste } from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
  c = await montarCenario(db);
});

const longe = { entrada: "2026-11-20", saida: "2026-11-23" };
const devolucao = async (id: string) => (await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.id, id)))[0];
const pedidos = () => c.provedor.chamadas.filter((ch) => ch.metodo === "devolver");
const conferir = (id: string, quando: Date) => conferirTentativa(db, c.org, id, c.provedor, quando, { origem: "rotina", forcar: true });
const saidas = async (reservaId: string) =>
  (await db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, reservaId), eq(lancamentos.tipo, "devolucao")))).map((l) => l.montante ?? 0).sort((a, b) => b - a);
const tentar = (id: string, quando: Date) => tentarDevolucao(db, c.org, id, c.provedor, quando);
const orderDe = (idProvedor: string) => c.provedor.todas().filter((o) => o.idProvedor === idProvedor)[0];

/** Reserva paga por Pix (liberada à mão, salvo `liberar: false`) e reduzida em `devolver` centavos: a devolução da alteração pedida. */
async function reduzida(devolver = 30000, o: { liberar?: boolean; email?: string; forma?: "pix" | "cartao" } = {}) {
  const x = await pagarEConfirmar(c, { ...longe, email: o.email, forma: o.forma, liberar: o.liberar ?? true });
  const r = await reduzirDeTeste(c, x, TOTAL - devolver, { quando: minutos(15) });
  return { ...x, alteracaoId: r.alteracaoId, devolucaoId: r.devolucaoIds[0] };
}

/** Pagamento aprovado sem reserva (valor divergente da cotação). */
async function semReserva(over: Parameters<Cenario["segurar"]>[0] = {}) {
  const s = await c.segurar(over);
  const p = await c.pix(s.cotacaoId);
  await db.update(cotacoes).set({ total: TOTAL + 1 }).where(eq(cotacoes.id, s.cotacaoId));
  c.provedor.aprovar(p.idProvedor, { taxa: 1806 });
  await conferir(p.pagamentoId, minutos(3));
  expect((await c.tentativa(p.pagamentoId)).motivoSemReserva).toBe("valor_divergente");
  return { ...s, ...p };
}

describe("várias devoluções por pagamento (M8.2d)", () => {
  it("duas devoluções de parte do valor no mesmo pagamento: valor explícito, cada uma confirmada pelo próprio id, o caixa de cada uma; nada em conferência", async () => {
    const x = await reduzida(30000);
    expect(await tentar(x.devolucaoId, minutos(20))).toBe("confirmada");
    expect(pedidos().at(-1)).toMatchObject({ chave: chaveDevolucao(x.devolucaoId, 1), valor: 30000, repetida: false, conhecidas: [] });
    const d1 = await devolucao(x.devolucaoId);
    expect(d1).toMatchObject({ situacao: "confirmada", valor: 30000, valorConfirmado: 30000, corpoIntegral: false, taxaAtribuida: 300, confirmadaPor: "leitura" });
    expect(d1.idProvedor).toMatch(/^REFTST/);
    // A segunda redução: outra devolução de parte, no mesmo pagamento; a primeira é "conhecida" no pedido.
    const segunda = await reduzirDeTeste(c, x, TOTAL - 50000, { quando: minutos(25) });
    const [d2] = segunda.devolucaoIds;
    expect(await tentar(d2, minutos(30))).toBe("confirmada");
    expect(pedidos().at(-1)).toMatchObject({ chave: chaveDevolucao(d2, 1), valor: 20000, conhecidas: [d1.idProvedor] });
    // A taxa atribuída é acumulada (D19): 1824 × 50000/182400 = 500, menos os 300 da primeira.
    expect(await devolucao(d2)).toMatchObject({ situacao: "confirmada", valor: 20000, valorConfirmado: 20000, taxaAtribuida: 200 });
    expect(await devolucao(x.devolucaoId)).toMatchObject({ situacao: "confirmada", valorConfirmado: 30000 });
    const p = await c.tentativa(x.pagamentoId);
    expect(p).toMatchObject({ situacao: "devolvido_parcial", devolvidoLido: 50000, valorPago: TOTAL, desfecho: "reserva" });
    expect(p.avisos).not.toContain("devolvido_por_fora");
    expect(p.avisos).not.toContain("devolucao_a_menor");
    expect(p.avisos).toContain("taxa_perdida_desconhecida");
    expect(await devolvidaNoProvedorDaReserva(db, c.org, x.reservaId)).toBe(false);
    // O caixa: cada uma tira do que entrou o devolvido menos a taxa atribuída a ela.
    expect(await saidas(x.reservaId)).toEqual([29700, 19800]);
    expect(await c.reserva(x.reservaId)).toMatchObject({ estado: "confirmada", valorBruto: TOTAL - 50000, taxaCanal: 1324 });
    expect(await semDadosDoHospede(db)).toEqual([]);
  });

  it("uma devolução pedida por pagamento (índice único): uma segunda pedida no mesmo pagamento é recusada pelo banco", async () => {
    const x = await reduzida(30000);
    const outra = () => db.insert(devolucoesPagamento).values({ organizacaoId: c.org, pagamentoId: x.pagamentoId, motivo: "Outra", valor: 1000, origem: "sem_reserva" });
    await expect(outra()).rejects.toThrow();
    // Depois de confirmada, a próxima pode ser pedida.
    await tentar(x.devolucaoId, minutos(20));
    await expect(outra()).resolves.toBeDefined();
  });

  it("o teto (D12): uma devolução que passa do pago menos as outras não sai (parada, nada enviado); por fora também não", async () => {
    const x = await reduzida(30000);
    await tentar(x.devolucaoId, minutos(20));
    // Outra alteração cuja devolução passaria do que resta no pagamento (R$ 0,01 a mais).
    const r = await reduzirDeTeste(c, x, TOTAL - 30001, { quando: minutos(20), devolucoes: [{ pagamentoId: x.pagamentoId, valor: TOTAL - 30000 + 1 }] });
    const grande = await devolucao(r.devolucaoIds[0]);
    expect(await tentar(grande.id, minutos(30))).toBe("recusada");
    expect(pedidos()).toHaveLength(1);
    expect((await devolucao(grande.id)).avisos).toContain("devolucao_parada");
    expect(await registrarDevolucaoPorFora(db, c.org, { devolucaoId: grande.id }, { data: "2026-10-01", valor: grande.valor, nota: "" }, null, c.provedor, minutos(31))).toMatchObject({
      ok: false,
      erro: expect.stringContaining("passaria do que ainda se pode devolver"),
    });
    // A que cabe (o resto exato) sai.
    await db.update(devolucoesPagamento).set({ valor: TOTAL - 30000, situacao: "pedida", proximaTentativaEm: minutos(32) }).where(eq(devolucoesPagamento.id, grande.id));
    expect(await tentar(grande.id, minutos(33))).toBe("confirmada");
    expect((await c.tentativa(x.pagamentoId)).situacao).toBe("devolvido");
  });
});

describe("a espera pela liberação (D13, M8.2d)", () => {
  it("a de parte do valor espera a liberação (nenhuma chave, nada pedido); a liberação à mão a acorda e ela sai com o valor explícito", async () => {
    const x = await reduzida(30000, { liberar: false });
    expect(await tentar(x.devolucaoId, minutos(20))).toBe("pedida");
    expect(await devolucao(x.devolucaoId)).toMatchObject({ situacao: "pedida", tentativas: 0, chaveAtual: null, chaveEmDuvida: false, ultimoCodigo: "aguardando_liberacao" });
    await conferirPendentes(db, c.org, c.provedor, minutos(40));
    expect(pedidos()).toEqual([]);
    // A equipe não confirma no painel do Mercado Pago o que nunca foi pedido.
    expect(await confirmarDevolucaoVistaNoProvedor(db, c.org, { devolucaoId: x.devolucaoId }, { data: "2026-10-01", nota: "Painel" }, null, c.provedor, minutos(41))).toMatchObject({
      ok: false,
      erro: expect.stringContaining("ainda não foi pedida"),
    });
    await liberar(c, x.pagamentoId, { quando: minutos(45) });
    expect((await devolucao(x.devolucaoId)).proximaTentativaEm).toEqual(minutos(45));
    await conferirPendentes(db, c.org, c.provedor, minutos(46));
    expect(pedidos()).toHaveLength(1);
    expect(pedidos()[0]).toMatchObject({ valor: 30000 });
    expect(await devolucao(x.devolucaoId)).toMatchObject({ situacao: "confirmada", valorConfirmado: 30000 });
    expect(await saidas(x.reservaId)).toEqual([29700]);
  });

  it("a liberação lida do Mercado Pago também acorda a devolução que espera", async () => {
    const x = await reduzida(30000, { liberar: false });
    await tentar(x.devolucaoId, minutos(20));
    await liberar(c, x.pagamentoId, { manual: false, quando: minutos(45) });
    expect((await c.tentativa(x.pagamentoId)).liberacaoOrigem).toBe("provedor");
    expect((await devolucao(x.devolucaoId)).proximaTentativaEm).toEqual(minutos(45));
    expect(await tentar(x.devolucaoId, minutos(46))).toBe("confirmada");
    expect(pedidos()).toHaveLength(1);
  });

  it("a trava confere de novo: a liberação estornada entre a releitura e a trava → nada enviado, volta a esperar", async () => {
    const x = await reduzida(30000);
    const original = c.provedor.consultar.bind(c.provedor);
    const espiao = vi.spyOn(c.provedor, "consultar").mockImplementationOnce(async (id) => {
      expect(await estornarLiberacaoManual(db, c.org, x.pagamentoId, "Lançada por engano", null, minutos(20))).toEqual({ ok: true });
      return original(id);
    });
    expect(await tentar(x.devolucaoId, minutos(20))).toBe("pedida");
    espiao.mockRestore();
    expect(pedidos()).toEqual([]);
    expect(await devolucao(x.devolucaoId)).toMatchObject({ tentativas: 0, chaveAtual: null, ultimoCodigo: "aguardando_liberacao" });
  });

  it("liberação atrasada: a devolução que espera ganha o aviso (o pagamento também, na união); some quando a chave é gravada", async () => {
    const x = await reduzida(30000, { liberar: false });
    await db.update(pagamentos).set({ liberacaoPrevistaEm: minutos(10) }).where(eq(pagamentos.id, x.pagamentoId));
    await tentar(x.devolucaoId, minutos(20));
    expect((await devolucao(x.devolucaoId)).avisos).toContain("devolucao_aguardando_liberacao_atrasada");
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("devolucao_aguardando_liberacao_atrasada");
    await liberar(c, x.pagamentoId, { quando: minutos(30) });
    expect(await tentar(x.devolucaoId, minutos(31))).toBe("confirmada");
    expect((await devolucao(x.devolucaoId)).avisos).not.toContain("devolucao_aguardando_liberacao_atrasada");
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("devolucao_aguardando_liberacao_atrasada");
  });

  it("a regra pura: só o dinheiro da reserva espera; a integral de um pagamento intocado e o pedido possivelmente no provedor nunca", async () => {
    const x = await reduzida(30000, { liberar: false });
    const p = await c.tentativa(x.pagamentoId);
    const d = await devolucao(x.devolucaoId);
    expect(esperaLiberacao(p, d, [d])).toBe(true);
    expect(esperaLiberacao({ ...p, liberacaoConfirmadaEm: AGORA, taxa: null }, d, [d])).toBe(true);
    expect(esperaLiberacao({ ...p, liberacaoConfirmadaEm: AGORA }, d, [d])).toBe(false);
    expect(esperaLiberacao(p, { ...d, valor: TOTAL }, [d])).toBe(false);
    expect(esperaLiberacao(p, { ...d, tentativas: 1, chaveEmDuvida: true }, [d])).toBe(false);
    expect(esperaLiberacao({ ...p, desfecho: null }, d, [d])).toBe(false);
  });
});

describe("o pedido de parte do valor ao Mercado Pago (M8.2d)", () => {
  it("resposta incerta: o reenvio repete a chave e o corpo (valor explícito, D29); o valor da devolução nunca muda", async () => {
    const x = await reduzida(30000);
    c.provedor.falhas.devolver = new ErroProvedor("incerto", "tempo");
    await tentar(x.devolucaoId, minutos(20));
    c.provedor.falhas.devolver = null;
    expect(await devolucao(x.devolucaoId)).toMatchObject({ situacao: "pedida", chaveEmDuvida: true, corpoIntegral: false, valor: 30000, falhas: 1 });
    expect(await tentar(x.devolucaoId, minutos(31))).toBe("confirmada");
    expect(pedidos().map((p) => [p.chave, p.valor, p.repetida])).toEqual([
      [chaveDevolucao(x.devolucaoId, 1), 30000, false],
      [chaveDevolucao(x.devolucaoId, 1), 30000, true],
    ]);
    expect(await devolucao(x.devolucaoId)).toMatchObject({ situacao: "confirmada", valor: 30000, valorConfirmado: 30000 });
  });

  it("resposta perdida (D21): o Mercado Pago fez a parte e a resposta se perdeu — o reenvio com a mesma chave a reconhece; nada parado, nada em conferência", async () => {
    c.provedor.chaveRepetida = "mesma_resposta";
    const x = await reduzida(30000);
    c.provedor.falhasDepois.devolver = new ErroProvedor("incerto", "Sem resposta do Mercado Pago.");
    await tentar(x.devolucaoId, minutos(20));
    c.provedor.falhasDepois.devolver = null;
    expect(await devolucao(x.devolucaoId)).toMatchObject({ situacao: "pedida", chaveEmDuvida: true, chaveAceita: false, idProvedor: null });
    // A releitura mostra R$ 300,00 devolvidos: explicados por esta devolução (pode estar lá), o reenvio repete a chave.
    expect(await tentar(x.devolucaoId, minutos(31))).toBe("confirmada");
    expect(pedidos()).toHaveLength(2);
    expect(pedidos()[1]).toMatchObject({ chave: chaveDevolucao(x.devolucaoId, 1), repetida: true, valor: 30000 });
    expect(await devolucao(x.devolucaoId)).toMatchObject({ situacao: "confirmada", valorConfirmado: 30000 });
    const p = await c.tentativa(x.pagamentoId);
    expect(p.avisos).not.toContain("devolucao_parada");
    expect(p.avisos).not.toContain("devolvido_por_fora");
    expect(await devolvidaNoProvedorDaReserva(db, c.org, x.reservaId)).toBe(false);
    // O Mercado Pago devolveu uma vez só.
    expect(orderDe(x.idProvedor).devolvido).toBe(30000);
  });

  it("resposta perdida e uma leitura (webhook) antes da próxima volta: a leitura confirma pelo valor, sem reenviar", async () => {
    const x = await reduzida(30000);
    c.provedor.falhasDepois.devolver = new ErroProvedor("incerto", "Sem resposta do Mercado Pago.");
    await tentar(x.devolucaoId, minutos(20));
    c.provedor.falhasDepois.devolver = null;
    await conferir(x.pagamentoId, minutos(22));
    expect(await devolucao(x.devolucaoId)).toMatchObject({ situacao: "confirmada", valorConfirmado: 30000, chaveEmDuvida: false });
    expect(pedidos()).toHaveLength(1);
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("devolvido_por_fora");
    expect(await devolvidaNoProvedorDaReserva(db, c.org, x.reservaId)).toBe(false);
  });

  it("'aguarde' numa parte enquanto outra devolução está em andamento no Mercado Pago: sem falha, a chave em dúvida (não aceita), o código guardado", async () => {
    const x = await reduzida(30000);
    const antes = orderDe(x.idProvedor);
    // Uma devolução pedida direto no painel do Mercado Pago, ainda em andamento (a releitura da rotina ainda não a mostra).
    c.provedor.respostaDevolucao = "pedida";
    await c.provedor.devolver(antes, "fora-do-sistema-1", 1000);
    c.provedor.respostaDevolucao = "confirmada";
    const espiao = vi.spyOn(c.provedor, "consultar").mockResolvedValueOnce(antes);
    expect(await tentar(x.devolucaoId, minutos(20))).toBe("pedida");
    espiao.mockRestore();
    expect(await devolucao(x.devolucaoId)).toMatchObject({ situacao: "pedida", chaveEmDuvida: true, chaveAceita: false, falhas: 0, ultimoCodigo: "em_andamento" });
  });

  it("'ja_devolvido' numa parte (a order inteira devolvida pelo painel): recusada sem desistir; a próxima leitura para a devolução e põe a reserva em conferência", async () => {
    const x = await reduzida(30000);
    const aprovada = orderDe(x.idProvedor);
    c.provedor.devolverNoProvedor(x.idProvedor, TOTAL);
    const espiao = vi.spyOn(c.provedor, "consultar").mockResolvedValueOnce(aprovada);
    await tentar(x.devolucaoId, minutos(20));
    espiao.mockRestore();
    expect(await devolucao(x.devolucaoId)).toMatchObject({ situacao: "pedida", falhas: 1, ultimoCodigo: "ja_devolvido", chaveEmDuvida: false });
    expect(await tentar(x.devolucaoId, minutos(31))).toBe("recusada");
    expect(pedidos()).toHaveLength(1);
    expect((await devolucao(x.devolucaoId)).avisos).toContain("devolucao_parada");
    const p = await c.tentativa(x.pagamentoId);
    expect(p).toMatchObject({ situacao: "devolvido" });
    expect(p.avisos).toContain("devolvido_por_fora");
    expect(await devolvidaNoProvedorDaReserva(db, c.org, x.reservaId)).toBe(true);
  });

  it("três recusas: desiste só sem devolução NOVA desde o pedido (a parte já confirmada antes não conta como sinal)", async () => {
    const x = await reduzida(30000);
    await tentar(x.devolucaoId, minutos(20));
    const [d2] = (await reduzirDeTeste(c, x, TOTAL - 50000, { quando: minutos(25) })).devolucaoIds;
    c.provedor.respostaDevolucao = "saldo_insuficiente";
    for (const m of [30, 41, 52]) await tentar(d2, minutos(m));
    expect(await devolucao(d2)).toMatchObject({ situacao: "recusada", falhas: 3, ultimoCodigo: "saldo_insuficiente" });
    expect((await devolucao(d2)).avisos).toContain("devolucao_falhou");
    expect((await devolucao(x.devolucaoId)).avisos).not.toContain("devolucao_falhou");
    // Avisos por devolução; o pagamento leva a união.
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("devolucao_falhou");
  });

  it("a nossa devolução que falhou (pelo id) é solta com o pagamento devolvido em parte pelas nossas: recusada, aviso nela, a outra intacta", async () => {
    const x = await reduzida(30000);
    await tentar(x.devolucaoId, minutos(20));
    const [d2] = (await reduzirDeTeste(c, x, TOTAL - 50000, { quando: minutos(25) })).devolucaoIds;
    c.provedor.respostaDevolucao = "pedida";
    await tentar(d2, minutos(30));
    const aceita = await devolucao(d2);
    expect(aceita).toMatchObject({ situacao: "pedida", chaveAceita: true });
    c.provedor.falharDevolucao(aceita.idProvedor!);
    await conferir(x.pagamentoId, minutos(40));
    expect(await devolucao(d2)).toMatchObject({ situacao: "recusada", chaveAceita: false, idProvedor: aceita.idProvedor });
    expect((await devolucao(d2)).avisos).toContain("devolucao_falhou");
    expect(await devolucao(x.devolucaoId)).toMatchObject({ situacao: "confirmada", valorConfirmado: 30000 });
    expect((await c.tentativa(x.pagamentoId)).situacao).toBe("devolvido_parcial");
  });

  it("devolução de alteração de um pagamento com mais de 78 dias: nada se pede (recusada, aviso de fora do prazo)", async () => {
    const x = await reduzida(30000);
    await envelhecer(c, x.pagamentoId, 80);
    expect(await tentar(x.devolucaoId, minutos(20))).toBe("recusada");
    expect(pedidos()).toEqual([]);
    expect((await devolucao(x.devolucaoId)).avisos).toContain("devolucao_fora_do_prazo");
  });

  it("sem a transação do pagamento na leitura, a de parte do valor não sai (parada, nada enviado)", async () => {
    const x = await reduzida(30000);
    const espiao = vi.spyOn(c.provedor, "consultar").mockResolvedValueOnce({ ...orderDe(x.idProvedor), idTransacao: null });
    expect(await tentar(x.devolucaoId, minutos(20))).toBe("recusada");
    espiao.mockRestore();
    expect(pedidos()).toEqual([]);
    expect((await devolucao(x.devolucaoId)).avisos).toContain("devolucao_parada");
  });

  it("cartão: a devolução por fora lê o 'devolucao_falhou' da própria devolução, não o de outra do mesmo pagamento", async () => {
    const cartao = { forma: "cartao" as const, avisos: ["devolucao_falhou"], aprovadoEm: AGORA, criadoEm: AGORA };
    const recusada = { situacao: "recusada" as const, ultimoCodigo: null, recusaNoPainelEm: null, idProvedor: "REFTST0002" };
    expect(porForaPermitidoNoCartao(cartao, { ...recusada, avisos: [] }, minutos(60))).toBe(false);
    expect(porForaPermitidoNoCartao(cartao, { ...recusada, avisos: ["devolucao_falhou"] }, minutos(60))).toBe(true);
  });
});

describe("o que sobra: restante, por fora de parte e a menor (M8.2d)", () => {
  it("sem reserva devolvido em parte pelo painel: 'Devolver o restante' pede o restante com o valor explícito; o devolvido fora fica reconhecido; nada de D21", async () => {
    const x = await semReserva();
    c.provedor.devolverNoProvedor(x.idProvedor, 1000);
    await conferir(x.pagamentoId, minutos(5));
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "devolvido_parcial", devolvidoLido: 1000, desfecho: null });
    const r = await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10));
    expect(r).toEqual({ ok: true, situacao: "confirmada" });
    expect(pedidos().at(-1)).toMatchObject({ valor: TOTAL - 1000 });
    const [d] = await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.pagamentoId, x.pagamentoId));
    expect(d).toMatchObject({ origem: "sem_reserva", situacao: "confirmada", valor: TOTAL - 1000, corpoIntegral: false });
    const p = await c.tentativa(x.pagamentoId);
    expect(p).toMatchObject({ situacao: "devolvido", desfecho: "devolucao", devolvidoForaReconhecido: 1000 });
    expect(p.avisos).not.toContain("devolvido_por_fora");
  });

  it("sem reserva com o Mercado Pago sem dizer quanto foi devolvido: pede o valor visto no painel; com ele, o restante certo", async () => {
    const x = await semReserva();
    c.provedor.listaNaLeitura = false;
    c.provedor.devolverNoProvedor(x.idProvedor, 1000);
    await conferir(x.pagamentoId, minutos(5));
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "devolvido_parcial", devolvidoLido: 0 });
    expect(await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10))).toEqual({ ok: false, erro: ERRO_FORA_SEM_VALOR });
    expect(pedidos()).toEqual([]);
    expect(await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(11), { valorForaInformado: 1000 })).toMatchObject({ ok: true });
    expect(pedidos().at(-1)).toMatchObject({ valor: TOTAL - 1000 });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ devolvidoForaReconhecido: 1000, situacao: "devolvido", desfecho: "devolucao" });
  });

  it("por fora de uma devolução de parte que espera a liberação: só o valor dela; a taxa derivada é a atribuída; o caixa espera o recebimento e sai com ele", async () => {
    const x = await reduzida(30000, { liberar: false });
    await tentar(x.devolucaoId, minutos(20));
    const porFora = (valor: number) => registrarDevolucaoPorFora(db, c.org, { devolucaoId: x.devolucaoId }, { data: "2026-10-01", valor, nota: "Pix da conta da empresa" }, null, c.provedor, minutos(25));
    expect(await porFora(TOTAL)).toEqual({ ok: false, erro: "A devolução por fora registra o valor desta devolução: R$ 300,00." });
    expect(await porFora(30000)).toEqual({ ok: true, situacao: "por_fora" });
    const d = await devolucao(x.devolucaoId);
    expect(d).toMatchObject({ situacao: "por_fora", porForaValor: 30000, taxaPerdida: 300, caixaLancadoEm: null });
    const [despesa] = await db.select().from(lancamentos).where(eq(lancamentos.chaveOrigem, chaveTaxaPerdida(x.pagamentoId, d.id)));
    expect(despesa).toMatchObject({ montante: 300, reservaId: x.reservaId });
    expect(await saidas(x.reservaId)).toEqual([]);
    // O pagamento continua aprovado (nada saiu pelo Mercado Pago); a liberação lança o recebimento e a saída que esperava.
    expect((await c.tentativa(x.pagamentoId)).situacao).toBe("aprovado");
    await liberar(c, x.pagamentoId, { quando: minutos(30) });
    expect(await saidas(x.reservaId)).toEqual([29700]);
    expect((await devolucao(x.devolucaoId)).caixaLancadoEm).not.toBeNull();
  });

  it("por fora recusada numa devolução cujo pedido já foi enviado (resposta incerta): pode estar no Mercado Pago", async () => {
    const x = await reduzida(30000);
    c.provedor.falhas.devolver = new ErroProvedor("incerto", "tempo");
    await tentar(x.devolucaoId, minutos(20));
    c.provedor.falhas.devolver = null;
    expect(await registrarDevolucaoPorFora(db, c.org, { devolucaoId: x.devolucaoId }, { data: "2026-10-01", valor: 30000, nota: "" }, null, c.provedor, minutos(25))).toEqual({
      ok: false,
      erro: ERRO_POR_FORA_CHAVE_ENVIADA,
    });
  });

  it("devolvida a menos numa parte (D15): confirmada pelo que voltou; 'Pedir o restante' pede a diferença; o restante por fora também vale (uma vez)", async () => {
    const x = await reduzida(30000);
    c.provedor.devolverAMenos(25000);
    await tentar(x.devolucaoId, minutos(20));
    const d = await devolucao(x.devolucaoId);
    expect(d).toMatchObject({ situacao: "confirmada", valor: 30000, valorConfirmado: 25000, avisos: expect.arrayContaining(["devolucao_a_menor"]) });
    const [q] = await pagamentosDaReserva(db, c.org, x.reservaId, minutos(21));
    const linha = q.devolucoes!.find((y) => y.id === d.id)!;
    expect(linha.acoes).toMatchObject({ pedirRestante: true, restantePorFora: true });
    expect(q.avisos.join(" ")).toContain("R$ 250,00 de R$ 300,00");
    // O restante por fora: só o valor do restante.
    const restantePorFora = (valor: number) => registrarDevolucaoPorFora(db, c.org, { restanteDe: d.id }, { data: "2026-10-01", valor, nota: "Pix da conta da empresa" }, null, c.provedor, minutos(25));
    expect(await restantePorFora(30000)).toEqual({ ok: false, erro: "A devolução por fora registra o valor desta devolução: R$ 50,00." });
    expect(await restantePorFora(5000)).toEqual({ ok: true, situacao: "por_fora" });
    expect(await restantePorFora(5000)).toMatchObject({ ok: false });
    expect(await pedirRestanteDaDevolucao(db, c.org, d.id, null, c.provedor, minutos(26))).toMatchObject({ ok: false });
    const [restante] = await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.origemDevolucaoId, d.id));
    expect(restante).toMatchObject({ situacao: "por_fora", valor: 5000, origem: "alteracao", alteracaoId: x.alteracaoId });
    expect((await devolucao(d.id)).avisos).not.toContain("devolucao_a_menor");
    expect(pedidos()).toHaveLength(1);
  });

  it("taxa que não voltou numa parte: o teto é a taxa atribuída a ela; a soma por pagamento nunca passa da taxa; a despesa leva a reserva", async () => {
    const x = await reduzida(30000);
    await tentar(x.devolucaoId, minutos(20));
    expect(await registrarTaxaPerdida(db, c.org, { devolucaoId: x.devolucaoId }, 301, null, minutos(21))).toMatchObject({ ok: false, erro: expect.stringContaining("R$ 3,00") });
    expect(await registrarTaxaPerdida(db, c.org, { devolucaoId: x.devolucaoId }, 300, null, minutos(21))).toEqual({ ok: true });
    const d = await devolucao(x.devolucaoId);
    const [despesa] = await db.select().from(lancamentos).where(eq(lancamentos.id, d.despesaLancamentoId!));
    expect(despesa).toMatchObject({ montante: 300, reservaId: x.reservaId, chaveOrigem: chaveTaxaPerdida(x.pagamentoId, d.id) });
    // A que completa o pagamento: o teto é o que resta da taxa (1824 − 300).
    const [d2] = (await reduzirDeTeste(c, x, 0, { quando: minutos(25) })).devolucaoIds;
    expect(await tentar(d2, minutos(30))).toBe("confirmada");
    expect((await c.tentativa(x.pagamentoId)).situacao).toBe("devolvido");
    expect(await registrarTaxaPerdida(db, c.org, { devolucaoId: d2 }, 1525, null, minutos(31))).toMatchObject({ ok: false });
    expect(await registrarTaxaPerdida(db, c.org, { devolucaoId: d2 }, 1524, null, minutos(31))).toEqual({ ok: true });
  });
});

describe("provedor pessimista (M8.2d)", () => {
  it("parte do valor com tudo o que a documentação não garante: nada se perde nem é pedido em dobro; a equipe confirma o que vê no painel", async () => {
    const equipe = await usuarioDeTeste(c);
    const x = await reduzida(30000);
    pessimista(c.provedor);
    expect(await tentar(x.devolucaoId, minutos(20))).toBe("pedida");
    expect(await devolucao(x.devolucaoId)).toMatchObject({ situacao: "pedida", chaveAceita: true, idProvedor: null });
    // O pago lido líquido da devolução não muda o pago congelado na aprovação (D28); "processed/refunded" explicado (D27).
    const p = await c.tentativa(x.pagamentoId);
    expect(p.valorPago).toBe(TOTAL);
    expect(p.situacao).toBe("devolvido_parcial");
    expect(p.avisos).not.toContain("situacao_desconhecida");
    expect(p.avisos).not.toContain("devolvido_por_fora");
    expect(await devolvidaNoProvedorDaReserva(db, c.org, x.reservaId)).toBe(false);
    // A leitura sem a lista nunca confirma sozinha: três voltas sem confirmação viram aviso; nada é pedido de novo.
    for (const m of [31, 42, 53]) await conferirPendentes(db, c.org, c.provedor, minutos(m));
    expect(pedidos()).toHaveLength(1);
    expect((await devolucao(x.devolucaoId)).avisos).toContain("devolucao_sem_confirmacao");
    const [q] = await pagamentosDaReserva(db, c.org, x.reservaId, minutos(54));
    expect(q.devolucoes!.find((y) => y.id === x.devolucaoId)!.acoes.confirmarVista).toBe(true);
    const r = await confirmarDevolucaoVistaNoProvedor(db, c.org, { devolucaoId: x.devolucaoId }, { data: "2026-10-01", nota: "O painel mostra R$ 300,00 devolvidos", valor: 30000 }, equipe, c.provedor, minutos(55));
    expect(r).toEqual({ ok: true, situacao: "confirmada" });
    expect(await devolucao(x.devolucaoId)).toMatchObject({ situacao: "confirmada", confirmadaPor: "equipe", valorConfirmado: 30000 });
    expect(await saidas(x.reservaId)).toEqual([29700]);
  });
});
