import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditoria, cotacoes, pagamentos } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { registrarRecebimento } from "@/repasses/recebimentos";
import { expirarHoldsVencidos } from "@/site/cotacoes";
import { conferirCotacaoParaPagina, conferirTentativa } from "./conferencia";
import { EMAIL_PAGADOR_SANDBOX } from "./mercadopago";
import { chaveCriacao, FOLGA_PRAZO_PIX_MS, gerarPix, MAXIMO_PIX_POR_COTACAO, referenciaDaTentativa } from "./pix";
import { ErroProvedor } from "./provedor";
import { conferirPendentes } from "./rotina";
import { textosDosAvisos } from "./situacoes";
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

  it("pedido que não chegou ao provedor (sem conexão, chave recusada): a tentativa é apagada, não conta no teto e o prazo provisório das datas volta ao que era", async () => {
    const { cotacaoId, reservaId } = await c.segurar();
    const antes = (await c.cotacao(cotacaoId)).holdAte!;
    const observacao = (await c.reserva(reservaId)).observacoes;
    c.provedor.falhas.criarPix = new ErroProvedor("indisponivel", "Não deu para falar com o Mercado Pago.");
    // Clicando várias vezes com o Mercado Pago fora, as datas não ficam presas além do prazo original.
    for (const m of [0, 5, 10]) expect(await gerarPix(db, c.org, cotacaoId, minutos(m), c.provedor)).toMatchObject({ ok: false, codigo: "provedor" });
    expect(await db.select().from(pagamentos).where(eq(pagamentos.cotacaoId, cotacaoId))).toEqual([]);
    expect((await c.cotacao(cotacaoId)).holdAte?.toISOString()).toBe(antes.toISOString());
    expect((await c.reserva(reservaId)).observacoes).toBe(observacao);
    c.provedor.falhas.criarPix = null;
    expect((await gerarPix(db, c.org, cotacaoId, minutos(11), c.provedor)).ok).toBe(true);
  });

  it("criação recusada pelo provedor (dados inválidos, sem order): sem Pix para pagar, o prazo provisório das datas volta ao que era", async () => {
    const { cotacaoId } = await c.segurar();
    const antes = (await c.cotacao(cotacaoId)).holdAte!;
    c.provedor.criarPix = async () => ({ ok: false, motivo: "dados_invalidos", mensagem: "Dados do pagador inválidos.", cobranca: null });
    for (const m of [0, 5]) expect(await gerarPix(db, c.org, cotacaoId, minutos(m), c.provedor)).toMatchObject({ ok: false, codigo: "recusado" });
    const tentativas = await db.select().from(pagamentos).where(eq(pagamentos.cotacaoId, cotacaoId));
    expect(tentativas.map((t) => t.situacao)).toEqual(["recusado", "recusado"]);
    expect((await c.cotacao(cotacaoId)).holdAte?.toISOString()).toBe(antes.toISOString());
  });

  it("criação que já volta cancelada ou vencida (sem Pix para pagar): falha, nunca 'ok', e o prazo provisório das datas volta ao que era", async () => {
    for (const [n, situacao] of [[0, "cancelado"], [1, "expirado"]] as const) {
      const { cotacaoId } = await c.segurar({ entrada: `2026-11-${String(2 + n * 4).padStart(2, "0")}`, saida: `2026-11-${String(5 + n * 4).padStart(2, "0")}`, email: `fechada${n}@example.com` });
      const antes = (await c.cotacao(cotacaoId)).holdAte!;
      const original = c.provedor.criarPix.bind(c.provedor);
      c.provedor.criarPix = async (p) => {
        const r = await original(p);
        return r.ok ? { ...r, cobranca: { ...r.cobranca, situacao } } : r;
      };
      expect(await gerarPix(db, c.org, cotacaoId, minutos(0), c.provedor)).toMatchObject({ ok: false, codigo: "recusado" });
      c.provedor.criarPix = original;
      expect((await c.cotacao(cotacaoId)).holdAte?.toISOString()).toBe(antes.toISOString());
    }
  });

  it("teto antes de cancelar: com 3 Pix gerados, pedir outro não cancela o terceiro, ainda pagável", async () => {
    const { cotacaoId } = await c.segurar();
    for (const [gerar, vencer] of [[0, 31], [31, 62]]) {
      const r = await gerarPix(db, c.org, cotacaoId, minutos(gerar), c.provedor);
      if (!r.ok) throw new Error(r.erro);
      c.provedor.expirar((await c.tentativa(r.pagamentoId)).idProvedor!);
      await conferirTentativa(db, c.org, r.pagamentoId, c.provedor, minutos(vencer), { origem: "rotina", forcar: true });
    }
    const terceiro = await gerarPix(db, c.org, cotacaoId, minutos(62), c.provedor);
    if (!terceiro.ok) throw new Error(terceiro.erro);
    const t3 = await c.tentativa(terceiro.pagamentoId);
    // A menos de um minuto de vencer (não é mais mostrado de novo), o hóspede pede outro: teto, sem cancelar.
    const quase = new Date(t3.pixExpiraEm!.getTime() - 30_000);
    expect(await gerarPix(db, c.org, cotacaoId, quase, c.provedor)).toMatchObject({ ok: false, codigo: "limite" });
    expect(c.provedor.chamadas.some((x) => x.metodo === "cancelar" && x.id === t3.idProvedor)).toBe(false);
    expect((await c.tentativa(t3.id)).situacao).toBe("pendente");
  });

  it("Pix marcado como real (live_mode) no teste: cancelado na hora, a resposta é de falha (nunca ok) e as datas não ficam presas a ele", async () => {
    const { cotacaoId } = await c.segurar();
    const antes = (await c.cotacao(cotacaoId)).holdAte!;
    c.provedor.aoVivo = true;
    const r = await gerarPix(db, c.org, cotacaoId, AGORA, c.provedor);
    expect(r).toMatchObject({ ok: false, codigo: "ao_vivo" });
    const [p] = await db.select().from(pagamentos).where(eq(pagamentos.cotacaoId, cotacaoId));
    expect(p).toMatchObject({ situacao: "cancelado", aoVivo: true, pixCopiaECola: null });
    expect(p.avisos).toContain("ao_vivo");
    expect(c.provedor.chamadas.some((x) => x.metodo === "cancelar" && x.id === p.idProvedor)).toBe(true);
    expect((await c.cotacao(cotacaoId)).holdAte?.toISOString()).toBe(antes.toISOString());
  });

  it("order criada já aprovada e marcada como real (live_mode) no teste: falha como as outras do live_mode (nunca 'ok'), sem reserva, e as datas não ficam presas a ela", async () => {
    const { cotacaoId } = await c.segurar();
    const antes = (await c.cotacao(cotacaoId)).holdAte!;
    c.provedor.aoVivo = true;
    const criarOriginal = c.provedor.criarPix.bind(c.provedor);
    c.provedor.criarPix = async (pedido) => {
      const r = await criarOriginal(pedido);
      if (!r.ok) return r;
      c.provedor.aprovar(r.cobranca.idProvedor!);
      return { ok: true, cobranca: c.provedor.todas().find((o) => o.idProvedor === r.cobranca.idProvedor)! };
    };
    expect(await gerarPix(db, c.org, cotacaoId, AGORA, c.provedor)).toMatchObject({ ok: false, codigo: "ao_vivo" });
    const [p] = await db.select().from(pagamentos).where(eq(pagamentos.cotacaoId, cotacaoId));
    expect(p).toMatchObject({ situacao: "aprovado", aoVivo: true, desfecho: null, motivoSemReserva: "ao_vivo" });
    expect(p.avisos).toContain("ao_vivo");
    expect((await c.cotacao(cotacaoId)).holdAte?.toISOString()).toBe(antes.toISOString());
  });

  it("reserva com recebimento registrado à mão: nenhum Pix é gerado (a conferência é feita sob a trava da reserva)", async () => {
    const { cotacaoId, reservaId } = await c.segurar();
    expect(await registrarRecebimento(db, c.org, { reservaId, data: "2026-10-01", valor: TOTAL, nota: "Pix na conta" }, null, "2026-10-01")).toMatchObject({ ok: true });
    expect(await gerarPix(db, c.org, cotacaoId, AGORA, c.provedor)).toMatchObject({ ok: false, codigo: "nao_oferecido", erro: expect.stringContaining("recebimento registrado à mão") });
    expect(await db.select().from(pagamentos).where(eq(pagamentos.cotacaoId, cotacaoId))).toEqual([]);
    expect(c.provedor.chamadas.filter((x) => x.metodo === "criarPix")).toEqual([]);
  });

  it("Pix cancelado há pouco que acabou pago depois da última leitura: ao pedir outro, ele é relido antes e nenhum segundo Pix sai", async () => {
    const { cotacaoId, reservaId } = await c.segurar();
    const a = await c.pix(cotacaoId);
    // A foi dado por cancelado, mas o pagamento dele cruzou e só aparece no provedor agora.
    await db.update(pagamentos).set({ situacao: "cancelado" }).where(eq(pagamentos.id, a.pagamentoId));
    c.provedor.aprovar(a.idProvedor);
    const criados = () => c.provedor.chamadas.filter((x) => x.metodo === "criarPix").length;
    const antes = criados();
    expect((await gerarPix(db, c.org, cotacaoId, minutos(2), c.provedor)).ok).toBe(false);
    expect(criados()).toBe(antes);
    expect(await c.tentativa(a.pagamentoId)).toMatchObject({ situacao: "aprovado", desfecho: "reserva" });
    expect((await c.reserva(reservaId)).estado).toBe("confirmada");
  });

  it("Pix cancelado lido pela página segundos antes de ser pago: ao pedir outro dentro dos 15 s, a leitura é nova (sem o intervalo) e nenhum segundo Pix sai; sem leitura, também não", async () => {
    const { cotacaoId, reservaId } = await c.segurar();
    const a = await c.pix(cotacaoId);
    await db.update(pagamentos).set({ situacao: "cancelado" }).where(eq(pagamentos.id, a.pagamentoId));
    // A página lê o cancelado (marca de 15 s gravada)...
    await conferirCotacaoParaPagina(db, c.org, cotacaoId, c.provedor, minutos(2));
    expect((await c.tentativa(a.pagamentoId)).situacao).toBe("cancelado");
    const criados = () => c.provedor.chamadas.filter((x) => x.metodo === "criarPix").length;
    const antes = criados();
    // ...o provedor falha na hora de pedir outro: nada sai.
    c.provedor.falhas.consultar = new ErroProvedor("incerto", "tempo");
    expect(await gerarPix(db, c.org, cotacaoId, new Date(minutos(2).getTime() + 1000), c.provedor)).toMatchObject({ ok: false });
    c.provedor.falhas.consultar = null;
    expect(criados()).toBe(antes);
    // ...e o Pix é pago um segundo depois; o hóspede pede outro dentro dos 15 s.
    c.provedor.aprovar(a.idProvedor);
    expect((await gerarPix(db, c.org, cotacaoId, new Date(minutos(2).getTime() + 2000), c.provedor)).ok).toBe(false);
    expect(criados()).toBe(antes);
    expect(await c.tentativa(a.pagamentoId)).toMatchObject({ situacao: "aprovado", desfecho: "reserva" });
    expect((await c.reserva(reservaId)).estado).toBe("confirmada");
  });

  it("Pix que fica em andamento além do prazo de consulta do provedor (85 dias): nem a página nem a rotina leem mais; aviso uma vez para a equipe", async () => {
    const { cotacaoId } = await c.segurar();
    const a = await c.pix(cotacaoId);
    const [order] = c.provedor.todas().filter((o) => o.idProvedor === a.idProvedor);
    // A order continua "pendente" a cada leitura (o provedor nunca encerra).
    const consultar = vi.spyOn(c.provedor, "consultar").mockResolvedValue(order);
    const dia = (n: number) => new Date(AGORA.getTime() + n * 86_400_000);
    await conferirPendentes(db, c.org, c.provedor, dia(84));
    expect(consultar.mock.calls.length).toBe(1);
    expect((await c.tentativa(a.pagamentoId)).situacao).toBe("pendente");
    for (const n of [86, 87, 120]) {
      await conferirPendentes(db, c.org, c.provedor, dia(n));
      await conferirCotacaoParaPagina(db, c.org, cotacaoId, c.provedor, dia(n));
    }
    expect(consultar.mock.calls.length).toBe(1);
    vi.restoreAllMocks();
    const t = await c.tentativa(a.pagamentoId);
    expect(t.avisos.filter((x) => x === "andamento_fora_do_prazo")).toHaveLength(1);
    expect(textosDosAvisos(t.avisos).join(" ")).toContain("parou de conferir");
  });

  it("trava não obtida (impasse 40P01 ou tempo-limite) na criação, na conferência inicial ou depois de cancelar: 'ocupado', nada pela metade", async () => {
    const impasse = () => Object.assign(new Error("deadlock detected"), { code: "40P01" });
    /** O banco, com a n-ésima transação abortada por impasse (como o Postgres faz). */
    const falhandoNa = (n: number): typeof db => {
      let i = 0;
      return new Proxy(db, {
        get(alvo, k, r) {
          if (k === "transaction") return (...a: Parameters<typeof db.transaction>) => (++i === n ? Promise.reject(impasse()) : alvo.transaction(...a));
          return Reflect.get(alvo, k, r);
        },
      });
    };
    const { cotacaoId } = await c.segurar();
    // Fase 1 (a primeira transação).
    expect(await gerarPix(falhandoNa(1), c.org, cotacaoId, AGORA, c.provedor)).toMatchObject({ ok: false, codigo: "ocupado" });
    expect(await db.select().from(pagamentos).where(eq(pagamentos.cotacaoId, cotacaoId))).toEqual([]);
    // Fase 3: o Pix foi criado no provedor; a tentativa fica "criando" e a próxima conferência acha pela referência.
    expect(await gerarPix(falhandoNa(2), c.org, cotacaoId, AGORA, c.provedor)).toMatchObject({ ok: false, codigo: "ocupado" });
    const [criando] = await db.select().from(pagamentos).where(eq(pagamentos.cotacaoId, cotacaoId));
    expect(criando).toMatchObject({ situacao: "criando", idProvedor: null });
    // Conferência inicial da que ficou no ar.
    expect(await gerarPix(falhandoNa(1), c.org, cotacaoId, minutos(1), c.provedor)).toMatchObject({ ok: false, codigo: "ocupado" });
    expect(await gerarPix(db, c.org, cotacaoId, minutos(1), c.provedor)).toEqual({ ok: true, pagamentoId: criando.id, reaproveitado: true });
    expect(c.provedor.chamadas.filter((x) => x.metodo === "criarPix")).toHaveLength(1);
    // Depois de cancelar o anterior (perto de vencer), a releitura com trava ocupada.
    expect(await gerarPix(falhandoNa(2), c.org, cotacaoId, minutos(29.5), c.provedor)).toMatchObject({ ok: false, codigo: "ocupado" });
    expect(c.provedor.chamadas.filter((x) => x.metodo === "criarPix")).toHaveLength(1);
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
