/**
 * M8.2d — o motor de devoluções com várias devoluções por pagamento: devoluções de parte do valor (as da alteração, pela
 * costura `reduzirDeTeste`), cada uma confirmada por ela mesma (pelo id, pelo valor, por completar o pagamento), a espera
 * pela liberação (D13), o teto (D12), o corpo do pedido guardado (D29), a resposta perdida (D21), o que sobra (restante
 * sem reserva, por fora de parte, a menor e o restante dela) e o provedor pessimista. Nada usa rede; o Mercado Pago é o falso.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cotacoes, devolucoesPagamento, lancamentos, pagamentos } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { formatBRL } from "@/lib/money";
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
import { previaDoCancelamento } from "./cancelamento";
import { conferirPendentes } from "./rotina";
import { AGORA, alterar, type Cenario, entradaPadrao, envelhecer, liberar, minutos, montarCenario, pagarEConfirmar, reduzirDeTeste, semDadosDoHospede, TOTAL, usuarioDeTeste } from "./testes";

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
    // O quadro: o aviso com o valor para quem lê o financeiro; o mesmo aviso sem nenhum R$ para os outros (D26).
    const [q] = await pagamentosDaReserva(db, c.org, x.reservaId, minutos(21));
    expect(q.avisos.join(" ")).toContain("a devolução de R$ 300,00 continua esperando");
    expect(q.avisosSemValores!.join(" ")).toContain("a devolução de parte do valor continua esperando");
    expect(q.avisosSemValores!.join(" ")).not.toContain("R$");
    await liberar(c, x.pagamentoId, { quando: minutos(30) });
    expect(await tentar(x.devolucaoId, minutos(31))).toBe("confirmada");
    expect((await devolucao(x.devolucaoId)).avisos).not.toContain("devolucao_aguardando_liberacao_atrasada");
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("devolucao_aguardando_liberacao_atrasada");
  });

  it("pedida de novo depois de recusada, com a liberação estornada no meio: espera a liberação de novo (nada enviado); a liberação à mão a acorda e ela sai com chave nova", async () => {
    const equipe = await usuarioDeTeste(c);
    const x = await reduzida(30000);
    c.provedor.respostaDevolucao = "saldo_insuficiente";
    for (const m of [20, 31, 42]) await tentar(x.devolucaoId, minutos(m));
    expect(await devolucao(x.devolucaoId)).toMatchObject({ situacao: "recusada", tentativas: 3, chaveEmDuvida: false });
    c.provedor.respostaDevolucao = "confirmada";
    // A recusada (nada dela no Mercado Pago) não segura o estorno da liberação.
    expect(await estornarLiberacaoManual(db, c.org, x.pagamentoId, "Lançada por engano", equipe, minutos(50))).toEqual({ ok: true });
    expect(await devolverPeloProvedor(db, c.org, { devolucaoId: x.devolucaoId }, equipe, c.provedor, minutos(55))).toEqual({ ok: true, situacao: "pedida" });
    expect(pedidos()).toHaveLength(3);
    expect(await devolucao(x.devolucaoId)).toMatchObject({ situacao: "pedida", tentativas: 3, chaveEmDuvida: false, ultimoCodigo: "aguardando_liberacao" });
    const [q] = await pagamentosDaReserva(db, c.org, x.reservaId, minutos(56));
    expect(q.devolucoes!.find((y) => y.id === x.devolucaoId)).toMatchObject({ aguardandoLiberacao: true });
    await conferirPendentes(db, c.org, c.provedor, minutos(70));
    expect(pedidos()).toHaveLength(3);
    await liberar(c, x.pagamentoId, { quando: minutos(80) });
    expect((await devolucao(x.devolucaoId)).proximaTentativaEm).toEqual(minutos(80));
    expect(await tentar(x.devolucaoId, minutos(81))).toBe("confirmada");
    expect(pedidos()).toHaveLength(4);
    expect(pedidos().at(-1)).toMatchObject({ chave: chaveDevolucao(x.devolucaoId, 4), valor: 30000 });
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
    expect(esperaLiberacao(p, { ...d, tentativas: 1, chaveAceita: true, chaveEmDuvida: true }, [d])).toBe(false);
    // Enviada antes e recusada com clareza (nada dela no Mercado Pago), pedida de novo: espera.
    expect(esperaLiberacao(p, { ...d, tentativas: 3, chaveEmDuvida: false }, [d])).toBe(true);
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
    expect(q.avisosSemValores!.join(" ")).toContain("O Mercado Pago devolveu menos do que foi pedido nesta devolução");
    expect(q.avisosSemValores!.join(" ")).not.toContain("R$");
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

  it("sem reserva parada por uma devolução de parte feita no painel do Mercado Pago: 'Devolver o restante' pede o restante, com o devolvido fora reconhecido", async () => {
    const x = await semReserva();
    // O painel do Mercado Pago devolveu R$ 10,00 antes de o sistema ler: o pedido do integral para (nada enviado).
    c.provedor.devolverNoProvedor(x.idProvedor, 1000);
    expect(await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10))).toEqual({ ok: true, situacao: "recusada" });
    expect(pedidos()).toEqual([]);
    const [d] = await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.pagamentoId, x.pagamentoId));
    expect(d).toMatchObject({ situacao: "recusada", valor: TOTAL, avisos: ["devolucao_parada"] });
    const [q] = await pagamentosDaReserva(db, c.org, x.reservaId, minutos(11));
    expect(q).toMatchObject({ situacao: "devolvido_parcial", desfecho: null, acoes: { devolver: true } });
    expect(await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(20))).toEqual({ ok: true, situacao: "confirmada" });
    expect(pedidos()).toHaveLength(1);
    expect(pedidos()[0]).toMatchObject({ valor: TOTAL - 1000 });
    expect(await devolucao(d.id)).toMatchObject({ situacao: "confirmada", valor: TOTAL - 1000, valorConfirmado: TOTAL - 1000, avisos: ["taxa_perdida_desconhecida"] });
    const p = await c.tentativa(x.pagamentoId);
    expect(p).toMatchObject({ situacao: "devolvido", desfecho: "devolucao", devolvidoForaReconhecido: 1000 });
    expect(p.avisos).not.toContain("devolucao_parada");
    expect(p.avisos).not.toContain("devolvido_por_fora");
  });

  it("sem reserva parada sem o Mercado Pago dizer quanto devolveu: pedir de novo pela devolução (o id) e a por fora pedem o valor do painel; com ele, o restante certo", async () => {
    const x = await semReserva();
    c.provedor.listaNaLeitura = false;
    c.provedor.devolverNoProvedor(x.idProvedor, 1000);
    expect(await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10))).toEqual({ ok: true, situacao: "recusada" });
    const [d] = await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.pagamentoId, x.pagamentoId));
    expect(d).toMatchObject({ situacao: "recusada", valor: TOTAL, avisos: ["devolucao_parada"] });
    // O quadro: a linha parada oferece pedir de novo e a por fora, cada uma com o campo do valor do painel (o restante sai dele).
    const [q] = await pagamentosDaReserva(db, c.org, x.reservaId, minutos(11));
    const linha = q.devolucoes!.find((y) => y.id === d.id)!;
    expect(linha.acoes).toMatchObject({ pedirDeNovo: true, porFora: true });
    expect(linha.restanteSemReserva).toEqual({ semValor: true, base: TOTAL });
    expect(q.restante).toEqual({ semValor: true, base: TOTAL });
    // Sem o valor do painel, nada sai; a por fora também pede o valor.
    expect(await devolverPeloProvedor(db, c.org, { devolucaoId: d.id }, null, c.provedor, minutos(12))).toEqual({ ok: false, erro: ERRO_FORA_SEM_VALOR });
    const porFora = (o: { valor: number; valorForaInformado?: number }) =>
      registrarDevolucaoPorFora(db, c.org, { devolucaoId: d.id }, { data: "2026-10-01", nota: "Pix da conta da empresa", ...o }, null, c.provedor, minutos(13));
    expect(await porFora({ valor: TOTAL - 1000 })).toEqual({ ok: false, erro: ERRO_FORA_SEM_VALOR });
    // Com o valor: a linha parada é a que se refaz (o teto conta as outras devoluções, não ela mesma).
    expect(await porFora({ valor: TOTAL, valorForaInformado: 1000 })).toEqual({ ok: false, erro: `A devolução por fora registra o valor desta devolução: ${formatBRL(TOTAL - 1000)}.` });
    expect(pedidos()).toEqual([]);
    expect(await devolverPeloProvedor(db, c.org, { devolucaoId: d.id }, null, c.provedor, minutos(14), { valorForaInformado: 1000 })).toMatchObject({ ok: true });
    expect(pedidos()).toHaveLength(1);
    expect(pedidos()[0]).toMatchObject({ valor: TOTAL - 1000 });
    expect(await devolucao(d.id)).toMatchObject({ valor: TOTAL - 1000 });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ devolvidoForaReconhecido: 1000 });
  });

  it("sem reserva parada com o Mercado Pago dizendo quanto devolveu: o quadro mostra na linha o restante que sai (não o valor antigo dela)", async () => {
    const x = await semReserva();
    c.provedor.devolverNoProvedor(x.idProvedor, 1000);
    expect(await devolverPeloProvedor(db, c.org, x.pagamentoId, null, c.provedor, minutos(10))).toEqual({ ok: true, situacao: "recusada" });
    const [q] = await pagamentosDaReserva(db, c.org, x.reservaId, minutos(11));
    const linha = q.devolucoes![0];
    expect(linha).toMatchObject({ valor: TOTAL, restanteSemReserva: { semValor: false, valor: TOTAL - 1000 } });
    // O pagamento também (antes de a equipe reconhecer o devolvido fora: o restante já desconta o que o Mercado Pago mostra).
    expect(q.restante).toEqual({ semValor: false, valor: TOTAL - 1000 });
    // A por fora pela linha registra esse restante.
    expect(await registrarDevolucaoPorFora(db, c.org, { devolucaoId: linha.id }, { data: "2026-10-01", valor: TOTAL - 1000, nota: "" }, null, c.provedor, minutos(12))).toEqual({ ok: true, situacao: "por_fora" });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ devolvidoForaReconhecido: 1000, desfecho: "por_fora" });
  });

  it("o teto (D12) também no restante (pedido ou por fora) e na confirmação da equipe", async () => {
    const equipe = await usuarioDeTeste(c);
    const x = await reduzida(30000);
    c.provedor.devolverAMenos(25000);
    await tentar(x.devolucaoId, minutos(20));
    expect(await devolucao(x.devolucaoId)).toMatchObject({ situacao: "confirmada", valorConfirmado: 25000 });
    // Como se a equipe tivesse reconhecido uma devolução pelo painel do Mercado Pago que deixa só R$ 49,99 devolvíveis.
    await db.update(pagamentos).set({ devolvidoForaReconhecido: TOTAL - 25000 - 4999 }).where(eq(pagamentos.id, x.pagamentoId));
    expect(await pedirRestanteDaDevolucao(db, c.org, x.devolucaoId, equipe, c.provedor, minutos(25))).toMatchObject({ ok: false, erro: expect.stringContaining("passaria do que ainda se pode devolver") });
    expect(await registrarDevolucaoPorFora(db, c.org, { restanteDe: x.devolucaoId }, { data: "2026-10-01", valor: 5000, nota: "" }, equipe, c.provedor, minutos(26))).toMatchObject({
      ok: false,
      erro: expect.stringContaining("passaria do que ainda se pode devolver"),
    });
    expect(pedidos()).toHaveLength(1);
    expect(await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.origemDevolucaoId, x.devolucaoId))).toEqual([]);

    // A confirmação da equipe: uma devolução parada (sem a transação do pagamento) que não cabe mais no que resta.
    const y = await pagarEConfirmar(c, { entrada: "2026-11-25", saida: "2026-11-27", email: "y@example.com", liberar: true });
    const [dy] = (await reduzirDeTeste(c, y, (await c.reserva(y.reservaId)).valorBruto! - 30000, { quando: minutos(15) })).devolucaoIds;
    const espiao = vi.spyOn(c.provedor, "consultar").mockResolvedValueOnce({ ...orderDe(y.idProvedor), idTransacao: null });
    expect(await tentar(dy, minutos(30))).toBe("recusada");
    espiao.mockRestore();
    expect((await devolucao(dy)).avisos).toContain("devolucao_parada");
    const pagoY = (await c.tentativa(y.pagamentoId)).valor;
    await db.update(pagamentos).set({ devolvidoForaReconhecido: pagoY - 29999 }).where(eq(pagamentos.id, y.pagamentoId));
    const confirmar = (valor: number) =>
      confirmarDevolucaoVistaNoProvedor(db, c.org, { devolucaoId: dy }, { data: "2026-10-01", nota: "O painel mostra a devolução", valor }, equipe, c.provedor, minutos(35));
    expect(await confirmar(30000)).toMatchObject({ ok: false, erro: expect.stringContaining("passaria do que ainda se pode devolver") });
    expect((await devolucao(dy)).situacao).toBe("recusada");
    expect(await confirmar(29999)).toEqual({ ok: true, situacao: "confirmada" });
    expect(await devolucao(dy)).toMatchObject({ situacao: "confirmada", valorConfirmado: 29999, avisos: expect.arrayContaining(["devolucao_a_menor"]) });
  });

  it("a menos sem o id numa segunda parte (D15): o aviso mostra o que a leitura tem além das outras (nunca o total), nada é acertado; a equipe confirma o valor visto e então pede o restante", async () => {
    const equipe = await usuarioDeTeste(c);
    const x = await reduzida(30000);
    expect(await tentar(x.devolucaoId, minutos(20))).toBe("confirmada");
    const [d2] = (await reduzirDeTeste(c, x, TOTAL - 50000, { quando: minutos(25) })).devolucaoIds;
    c.provedor.idDaDevolucao = "ausente";
    c.provedor.devolverAMenos(15000);
    expect(await tentar(d2, minutos(30))).toBe("pedida");
    expect(await devolucao(d2)).toMatchObject({ situacao: "pedida", chaveAceita: true, idProvedor: null, proximaTentativaEm: null, avisos: ["devolucao_a_menor"] });
    expect(await saidas(x.reservaId)).toEqual([29700]);
    const [q] = await pagamentosDaReserva(db, c.org, x.reservaId, minutos(31));
    const textos = q.avisos.join(" ");
    expect(textos).toContain("R$ 150,00 devolvidos de R$ 200,00 pedidos nesta devolução");
    expect(textos).toContain("nada foi acertado no financeiro");
    expect(textos).not.toContain("R$ 450,00");
    expect(q.avisosSemValores!.join(" ")).toContain("O Mercado Pago mostra menos devolvido do que foi pedido nesta devolução, sem dizer qual devolução é");
    expect(q.avisosSemValores!.join(" ")).not.toContain("R$");
    expect(q.devolucoes!.find((y) => y.id === d2)!.acoes).toMatchObject({ confirmarVista: true, pedirRestante: false, restantePorFora: false });
    expect(await confirmarDevolucaoVistaNoProvedor(db, c.org, { devolucaoId: d2 }, { data: "2026-10-01", nota: "O painel mostra R$ 150,00", valor: 15000 }, equipe, c.provedor, minutos(32))).toEqual({
      ok: true,
      situacao: "confirmada",
    });
    const [depois] = await pagamentosDaReserva(db, c.org, x.reservaId, minutos(33));
    expect(depois.avisos.join(" ")).toContain("O Mercado Pago devolveu R$ 150,00 de R$ 200,00 pedidos nesta devolução");
    expect(depois.devolucoes!.find((y) => y.id === d2)!.acoes).toMatchObject({ pedirRestante: true });
    // O caixa da que voltou (R$ 150,00 menos a taxa atribuída a ela).
    expect(await saidas(x.reservaId)).toEqual([29700, 14850]);
  });

  it("cartão: o restante recusado com 'valor acima do que se pode devolver' (D15) fica recusado com o aviso de a menor — confira no painel; nada é pedido de novo; a equipe confirma o valor visto", async () => {
    const equipe = await usuarioDeTeste(c);
    const x = await reduzida(30000, { forma: "cartao" });
    c.provedor.devolverAMenos(25000);
    await tentar(x.devolucaoId, minutos(20));
    expect(await devolucao(x.devolucaoId)).toMatchObject({ situacao: "confirmada", valorConfirmado: 25000 });
    const espiao = vi.spyOn(c.provedor, "devolver").mockResolvedValueOnce({ situacao: "recusada", idDevolucao: null, mensagem: "O valor passa do que ainda pode ser devolvido.", codigo: "valor_excede" });
    const r = await pedirRestanteDaDevolucao(db, c.org, x.devolucaoId, equipe, c.provedor, minutos(25));
    espiao.mockRestore();
    expect(r).toMatchObject({ ok: true, situacao: "recusada" });
    const restante = await devolucao((r as { devolucaoId: string }).devolucaoId);
    expect(restante).toMatchObject({ situacao: "recusada", valor: 5000, falhas: 1, ultimoCodigo: "valor_excede", proximaTentativaEm: null, chaveEmDuvida: false, avisos: ["devolucao_a_menor"] });
    const [q] = await pagamentosDaReserva(db, c.org, x.reservaId, minutos(26));
    expect(q.avisos.join(" ")).toContain("O Mercado Pago recusou o pedido do restante (R$ 50,00) desta devolução: confira no painel do Mercado Pago.");
    expect(q.avisosSemValores!.join(" ")).toContain("O Mercado Pago recusou o pedido do restante desta devolução: confira no painel do Mercado Pago.");
    expect(q.avisosSemValores!.join(" ")).not.toContain("R$");
    // Cartão com "valor acima": a por fora continua fechada; a confirmação do que o painel mostra e a recusa do painel, abertas.
    expect(q.devolucoes!.find((y) => y.id === restante.id)!.acoes).toMatchObject({ confirmarVista: true, pedirDeNovo: false, porFora: false, registrarRecusaNoPainel: true });
    expect(await devolverPeloProvedor(db, c.org, { devolucaoId: restante.id }, equipe, c.provedor, minutos(27))).toMatchObject({ ok: false, erro: expect.stringContaining("recusou o pedido deste restante") });
    await conferirPendentes(db, c.org, c.provedor, minutos(40));
    expect(pedidos()).toHaveLength(1);
    // O cancelamento espera o restante resolvido (nunca devolve duas vezes).
    expect(await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" }), c.provedor, minutos(41))).toMatchObject({ ok: false, codigo: "devolucao_a_menor" });
    expect(await confirmarDevolucaoVistaNoProvedor(db, c.org, { devolucaoId: restante.id }, { data: "2026-10-01", nota: "O painel mostra o restante devolvido", valor: 5000 }, equipe, c.provedor, minutos(42))).toEqual({
      ok: true,
      situacao: "confirmada",
    });
    expect(await devolucao(restante.id)).toMatchObject({ situacao: "confirmada", confirmadaPor: "equipe", valorConfirmado: 5000, avisos: ["taxa_perdida_desconhecida"] });
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("devolucao_a_menor");
    expect(await saidas(x.reservaId)).toEqual([24750, 4950]);
    expect(await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" }), c.provedor, minutos(43))).toMatchObject({ ok: true });
  });

  it("Pix: o restante recusado como 'não permitido' (D15) fica com o aviso de a menor; o restante devolvido por fora tira o aviso", async () => {
    const x = await reduzida(30000);
    c.provedor.devolverAMenos(25000);
    await tentar(x.devolucaoId, minutos(20));
    c.provedor.parcialRecusada = "max_refunds_exceeded";
    const r = await pedirRestanteDaDevolucao(db, c.org, x.devolucaoId, null, c.provedor, minutos(25));
    expect(r).toMatchObject({ ok: true, situacao: "recusada" });
    const id = (r as { devolucaoId: string }).devolucaoId;
    expect(await devolucao(id)).toMatchObject({ situacao: "recusada", ultimoCodigo: "nao_permitido", avisos: ["devolucao_a_menor"] });
    const [q] = await pagamentosDaReserva(db, c.org, x.reservaId, minutos(26));
    expect(q.devolucoes!.find((y) => y.id === id)!.acoes).toMatchObject({ confirmarVista: true, porFora: true, pedirDeNovo: false });
    expect(q.avisos.join(" ")).toContain("registre o restante devolvido por fora");
    expect(await registrarDevolucaoPorFora(db, c.org, { devolucaoId: id }, { data: "2026-10-01", valor: 5000, nota: "Pix da conta da empresa" }, null, c.provedor, minutos(30))).toEqual({ ok: true, situacao: "por_fora" });
    expect((await devolucao(id)).avisos).not.toContain("devolucao_a_menor");
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("devolucao_a_menor");
    expect(pedidos()).toHaveLength(2);
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

describe("revisão do M8.2d: a devolução de parte que o sistema nunca pediu (pagamento com mais de 78 dias)", () => {
  it("cartão: a redução vira devolução pelo painel do Mercado Pago; feita lá, a equipe confirma aqui com a order ainda lida (o caixa sai, o aviso de devolvido por fora some); antes disso, nada é confirmado", async () => {
    const x = await pagarEConfirmar(c, { ...longe, forma: "cartao", liberar: true });
    await envelhecer(c, x.pagamentoId, 80);
    const valor = { origem: "digitado" as const, valor: TOTAL - 20_000, motivo: "acordo_com_hospede" as const, nota: "Desconto combinado" };
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-11-22", valor }, minutos(20), { aplicar: true });
    if (!resultado.ok) throw new Error(resultado.erro);
    const [d] = await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.alteracaoId, resultado.alteracaoId));
    expect(d).toMatchObject({ situacao: "recusada", valor: 20_000, tentativas: 0, avisos: ["devolucao_fora_do_prazo"] });
    const confirmar = (quando: Date) => confirmarDevolucaoVistaNoProvedor(db, c.org, { devolucaoId: d.id }, { data: "2026-10-01", nota: "Painel do Mercado Pago mostra o estorno" }, null, c.provedor, quando);
    // O Mercado Pago ainda não mostra a devolução: nada é confirmado.
    expect(await confirmar(minutos(25))).toMatchObject({ ok: false, erro: expect.stringContaining("não mostra esta devolução") });
    expect(await devolucao(d.id)).toMatchObject({ situacao: "recusada", confirmadaPor: null });
    // A equipe devolve R$ 200,00 pelo painel do Mercado Pago; a leitura mostra o devolvido.
    c.provedor.devolverNoProvedor(x.idProvedor, 20_000);
    await conferir(x.pagamentoId, minutos(30));
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "devolvido_parcial", devolvidoLido: 20_000 });
    const [q] = await pagamentosDaReserva(db, c.org, x.reservaId, minutos(31));
    expect(q.devolucoes!.find((y) => y.id === d.id)!.acoes.confirmarVista).toBe(true);
    expect(await confirmar(minutos(32))).toEqual({ ok: true, situacao: "confirmada" });
    expect(await devolucao(d.id)).toMatchObject({ situacao: "confirmada", confirmadaPor: "equipe", taxaAtribuida: 200 });
    expect(await saidas(x.reservaId)).toEqual([19_800]);
    const p = await c.tentativa(x.pagamentoId);
    expect(p.avisos).not.toContain("devolvido_por_fora");
    expect(p.avisos).not.toContain("devolucao_fora_do_prazo");
    await conferir(x.pagamentoId, minutos(40));
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("devolvido_por_fora");
  });
});

describe("revisão do M8.2d: a taxa da reserva depois de uma devolução a menos", () => {
  for (const manual of [false, true])
    it(`liberação ${manual ? "à mão" : "pelo Mercado Pago"}: a taxa da reserva continua a de antes (a do pago menos a do principal devolvido) na confirmação a menos, nas leituras e no restante; o motor não roda de novo`, async () => {
      const x = await pagarEConfirmar(c, longe);
      await liberar(c, x.pagamentoId, { quando: minutos(8), manual });
      const { devolucaoIds } = await reduzirDeTeste(c, x, TOTAL - 52_800, { quando: minutos(15) });
      const estornos = async () => (await db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, x.reservaId), isNotNull(lancamentos.estornoDe)))).length;
      expect(await c.reserva(x.reservaId)).toMatchObject({ valorBruto: TOTAL - 52_800, taxaCanal: 1296 });
      const antes = await estornos();
      c.provedor.devolverAMenos(15_000);
      expect(await tentar(devolucaoIds[0], minutos(20))).toBe("confirmada");
      expect(await devolucao(devolucaoIds[0])).toMatchObject({ valorConfirmado: 15_000, taxaAtribuida: 150 });
      await conferirTentativa(db, c.org, x.pagamentoId, c.provedor, minutos(25), { origem: "painel", forcar: true });
      expect((await c.reserva(x.reservaId)).taxaCanal).toBe(1296);
      expect(await pedirRestanteDaDevolucao(db, c.org, devolucaoIds[0], null, c.provedor, minutos(30))).toMatchObject({ ok: true });
      await conferirTentativa(db, c.org, x.pagamentoId, c.provedor, minutos(35), { origem: "painel", forcar: true });
      expect((await c.reserva(x.reservaId)).taxaCanal).toBe(1296);
      expect(await estornos()).toBe(antes);
    });
});

describe("revisão do M8.2d: pedir de novo com outra devolução pedida no mesmo pagamento", () => {
  it("a recusada não se pede de novo enquanto outra do pagamento está pedida (o botão some; nada estoura no banco); resolvida a outra, pede", async () => {
    const x = await reduzida(30_000);
    c.provedor.respostaDevolucao = "saldo_insuficiente";
    for (const m of [20, 31, 42]) await tentar(x.devolucaoId, minutos(m));
    expect(await devolucao(x.devolucaoId)).toMatchObject({ situacao: "recusada", chaveEmDuvida: false });
    const segunda = await reduzirDeTeste(c, x, TOTAL - 50_000, { quando: minutos(50) });
    c.provedor.respostaDevolucao = "pedida";
    await tentar(segunda.devolucaoIds[0], minutos(55));
    expect(await devolucao(segunda.devolucaoIds[0])).toMatchObject({ situacao: "pedida", tentativas: 1 });
    const [q] = await pagamentosDaReserva(db, c.org, x.reservaId, minutos(60));
    expect(q.devolucoes!.find((d) => d.id === x.devolucaoId)!.acoes.pedirDeNovo).toBe(false);
    expect(await devolverPeloProvedor(db, c.org, { devolucaoId: x.devolucaoId }, null, c.provedor, minutos(60))).toEqual({
      ok: false,
      erro: "Já há uma devolução pedida ao Mercado Pago para este pagamento: espere ela se resolver.",
    });
    // A outra confirmada: a recusada volta a poder ser pedida.
    c.provedor.confirmarDevolucoes(x.idProvedor);
    await conferir(x.pagamentoId, minutos(70));
    expect(await devolucao(segunda.devolucaoIds[0])).toMatchObject({ situacao: "confirmada" });
    c.provedor.respostaDevolucao = "confirmada";
    expect(await devolverPeloProvedor(db, c.org, { devolucaoId: x.devolucaoId }, null, c.provedor, minutos(80))).toMatchObject({ ok: true });
  });
});
