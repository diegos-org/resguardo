import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditoria, cotacoes, pagamentos } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { expirarHoldsVencidos } from "@/site/cotacoes";
import { conferirCotacaoParaPagina, conferirTentativa } from "./conferencia";
import { EMAIL_PAGADOR_SANDBOX } from "./mercadopago";
import { chaveCriacao, FOLGA_PRAZO_PIX_MS, gerarPix, MAXIMO_PIX_POR_COTACAO, referenciaDaTentativa } from "./pix";
import { ErroProvedor } from "./provedor";
import { AGORA, type Cenario, EMAIL_HOSPEDE, minutos, montarCenario, TOTAL } from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => { c = await montarCenario(db); });

describe("gerar o Pix (M8.2a)", () => {
  it("cria a tentativa com referência e chave gravadas antes, valor da cotação e o e-mail da reserva (o adaptador troca no sandbox); estende o prazo das datas até o Pix + 2 min", async () => {
    const { cotacaoId, reservaId } = await c.segurar();
    const antes = await c.cotacao(cotacaoId);
    expect(antes.holdAte?.toISOString()).toBe(minutos(30).toISOString());
    const r = await gerarPix(db, c.org, cotacaoId, AGORA, c.provedor);
    expect(r).toMatchObject({ ok: true, reaproveitado: false });
    if (!r.ok) return;
    const p = await c.tentativa(r.pagamentoId);
    expect(p).toMatchObject({ situacao: "pendente", forma: "pix", ambiente: "teste", valor: TOTAL, reservaId, cotacaoId, referencia: referenciaDaTentativa(p.id), chaveIdempotencia: chaveCriacao(p.id), idProvedor: "ORDTST0001", aoVivo: false });
    expect(p.pixCopiaECola).toContain("ORDTST0001");
    expect(p.pixImagem).toBe("RkFMU08=");
    // A chamada levou a chave gravada e o e-mail da reserva (no cliente real, o sandbox usa test@testuser.com).
    const chamada = c.provedor.chamadas.find((x) => x.metodo === "criarPix")!;
    expect(chamada).toMatchObject({ chave: chaveCriacao(p.id), referencia: referenciaDaTentativa(p.id), valor: TOTAL });
    expect(EMAIL_PAGADOR_SANDBOX).toBe("test@testuser.com");
    // O Pix vale 30 min (mínimo do provedor) e as datas ficam seguradas até ele + 2 min.
    expect(p.pixExpiraEm?.toISOString()).toBe(minutos(30).toISOString());
    expect((await c.cotacao(cotacaoId)).holdAte?.toISOString()).toBe(new Date(minutos(30).getTime() + FOLGA_PRAZO_PIX_MS).toISOString());
    // A observação do pedido acompanha o prazo novo (12:32 em São Paulo).
    expect((await c.reserva(reservaId)).observacoes).toContain("Datas seguradas até 01/10, 12:32 (estendido pelo Pix);");
    const estender = await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, c.org), eq(auditoria.acao, "cotacao.estender")));
    expect(estender.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(estender)).not.toContain(EMAIL_HOSPEDE);
  });

  it("um Pix por vez: o válido é mostrado de novo; o vencido é cancelado no provedor antes do próximo; no máximo 3 por cotação", async () => {
    const { cotacaoId } = await c.segurar();
    const a = await c.pix(cotacaoId);
    expect(await gerarPix(db, c.org, cotacaoId, minutos(5), c.provedor)).toEqual({ ok: true, pagamentoId: a.pagamentoId, reaproveitado: true });
    expect(c.provedor.chamadas.filter((x) => x.metodo === "criarPix")).toHaveLength(1);
    // Perto de vencer (menos de 1 min): cancela o anterior (lendo de volta) e gera outro.
    const b = await gerarPix(db, c.org, cotacaoId, minutos(29.5), c.provedor);
    expect(b).toMatchObject({ ok: true, reaproveitado: false });
    expect(c.provedor.chamadas.map((x) => x.metodo)).toEqual(expect.arrayContaining(["cancelar"]));
    expect((await c.tentativa(a.pagamentoId)).situacao).toBe("cancelado");
    // Pix pago/vencido/cancelado: copia e cola e imagem saem do banco.
    expect(await c.tentativa(a.pagamentoId)).toMatchObject({ pixCopiaECola: null, pixImagem: null, pixLink: null });
    // Vencido no provedor antes do cancelamento ("não cancelável" + leitura expirada): também libera o próximo.
    const segundo = await c.tentativa(b.ok ? b.pagamentoId : "");
    c.provedor.expirar(segundo.idProvedor!);
    const terceiro = await gerarPix(db, c.org, cotacaoId, minutos(61), c.provedor);
    expect(terceiro.ok).toBe(true);
    expect((await c.tentativa(segundo.id)).situacao).toBe("expirado");
    const ultimo = await c.tentativa(terceiro.ok ? terceiro.pagamentoId : "");
    c.provedor.expirar(ultimo.idProvedor!);
    await conferirTentativa(db, c.org, ultimo.id, c.provedor, minutos(92), { origem: "rotina", forcar: true });
    expect(await gerarPix(db, c.org, cotacaoId, minutos(92), c.provedor)).toMatchObject({ ok: false, codigo: "limite" });
    expect(MAXIMO_PIX_POR_COTACAO).toBe(3);
    expect(await db.select().from(pagamentos).where(eq(pagamentos.cotacaoId, cotacaoId))).toHaveLength(3);
  });

  it("cancelamento que falha no provedor: não gera outro Pix (dois QR pagáveis nunca)", async () => {
    const { cotacaoId } = await c.segurar();
    await c.pix(cotacaoId);
    c.provedor.falhas.cancelar = new ErroProvedor("incerto", "falha simulada");
    expect(await gerarPix(db, c.org, cotacaoId, minutos(29.5), c.provedor)).toMatchObject({ ok: false, codigo: "provedor" });
    expect(c.provedor.chamadas.filter((x) => x.metodo === "criarPix")).toHaveLength(1);
  });

  it("três fases: chamada que cai fica incerta e é resolvida pela referência (nunca com outra order); resposta perdida depois de criar também", async () => {
    const { cotacaoId } = await c.segurar();
    c.provedor.falhas.criarPix = new ErroProvedor("incerto", "O Mercado Pago não respondeu a tempo.");
    expect(await gerarPix(db, c.org, cotacaoId, AGORA, c.provedor)).toMatchObject({ ok: false, codigo: "incerto" });
    const [incerta] = await db.select().from(pagamentos).where(eq(pagamentos.cotacaoId, cotacaoId));
    expect(incerta).toMatchObject({ situacao: "incerta", idProvedor: null });
    // Enquanto incerta, nada novo: a criação é procurada pela referência (aqui não existe — o pedido nunca chegou).
    c.provedor.falhas.criarPix = null;
    expect(await gerarPix(db, c.org, cotacaoId, minutos(1), c.provedor)).toMatchObject({ ok: false, codigo: "em_andamento" });
    expect(c.provedor.chamadas.filter((x) => x.metodo === "buscarPorReferencia").length).toBeGreaterThanOrEqual(1);
    // Passado o tempo de desistir sem achar a order, a criação é dada por não feita e um Pix novo pode sair.
    expect(await gerarPix(db, c.org, cotacaoId, minutos(16), c.provedor)).toMatchObject({ ok: true });
    expect((await c.tentativa(incerta.id)).situacao).toBe("cancelado");

    // Outra cotação: a order foi criada, mas a resposta se perdeu no caminho.
    const outra = await c.segurar({ entrada: "2026-11-02", saida: "2026-11-05", email: "outra@example.com" });
    c.provedor.falhasDepois.criarPix = new ErroProvedor("incerto", "conexão cortada");
    expect(await gerarPix(db, c.org, outra.cotacaoId, minutos(16), c.provedor)).toMatchObject({ ok: false, codigo: "incerto" });
    c.provedor.falhasDepois.criarPix = null;
    const [perdida] = await db.select().from(pagamentos).where(eq(pagamentos.cotacaoId, outra.cotacaoId));
    // A página que espera resolve pela referência: acha a order, grava o id e o QR.
    const r = await conferirCotacaoParaPagina(db, c.org, outra.cotacaoId, c.provedor, minutos(16.5));
    expect(r).toMatchObject({ ok: true, situacao: "pendente" });
    expect(await c.tentativa(perdida.id)).toMatchObject({ situacao: "pendente", idProvedor: expect.stringMatching(/^ORDTST/) });
    expect(c.provedor.todas().filter((o) => o.referencia === perdida.referencia)).toHaveLength(1);
  });

  it("pedido que não chegou ao provedor (sem conexão, chave recusada): a tentativa é apagada e não conta no teto", async () => {
    const { cotacaoId } = await c.segurar();
    c.provedor.falhas.criarPix = new ErroProvedor("indisponivel", "Não deu para falar com o Mercado Pago.");
    expect(await gerarPix(db, c.org, cotacaoId, AGORA, c.provedor)).toMatchObject({ ok: false, codigo: "provedor" });
    expect(await db.select().from(pagamentos).where(eq(pagamentos.cotacaoId, cotacaoId))).toEqual([]);
    c.provedor.falhas.criarPix = null;
    expect((await gerarPix(db, c.org, cotacaoId, minutos(1), c.provedor)).ok).toBe(true);
  });

  it("recusas: cotação não segurada, prazo vencido, a confirmar, outra organização; e o prazo provisório cobre a chamada", async () => {
    expect(await gerarPix(db, c.org, "00000000-0000-4000-8000-000000000000", AGORA, c.provedor)).toMatchObject({ ok: false, codigo: "nao_encontrada" });
    const { cotacaoId } = await c.segurar();
    expect(await gerarPix(db, "00000000-0000-4000-8000-000000000001", cotacaoId, AGORA, c.provedor)).toMatchObject({ ok: false, codigo: "nao_encontrada" });
    expect(await gerarPix(db, c.org, cotacaoId, minutos(31), c.provedor)).toMatchObject({ ok: false, codigo: "nao_oferecido" });
    await db.update(cotacoes).set({ situacao: "a_confirmar" }).where(eq(cotacoes.id, cotacaoId));
    expect(await gerarPix(db, c.org, cotacaoId, AGORA, c.provedor)).toMatchObject({ ok: false, codigo: "nao_oferecido", erro: expect.stringContaining("a confirmar") });
    await db.update(cotacoes).set({ situacao: "disponivel" }).where(eq(cotacoes.id, cotacaoId));
    // A rotina passa durante a chamada: a tentativa "criando" segura as datas (prazo provisório e carência).
    c.provedor.falhas.criarPix = new ErroProvedor("incerto", "tempo");
    await gerarPix(db, c.org, cotacaoId, minutos(10), c.provedor);
    expect((await c.cotacao(cotacaoId)).holdAte!.getTime()).toBeGreaterThanOrEqual(minutos(42).getTime());
    expect(await expirarHoldsVencidos(db, c.org, minutos(44))).toMatchObject({ expiradas: 0 });
    expect((await c.cotacao(cotacaoId)).estado).toBe("segurada");
  });
});
