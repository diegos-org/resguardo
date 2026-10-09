import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditoria, cotacoes, devolucoesPagamento, eventosPagamento, lancamentos, pagamentos } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { estornar } from "@/financeiro/ledger";
import { expirarHoldsVencidos } from "@/site/cotacoes";
import { conferirTentativa } from "./conferencia";
import { avisosDePagamento, listarPagamentos, pagamentoEmAndamentoOuAprovado, pagamentosDaReserva, vistaDaCotacaoParaHospede } from "./consultas";
import { devolverPeloProvedor, registrarDevolucaoPorFora } from "./devolucao";
import { registrarEventoDeAviso } from "./eventos";
import { gerarPix } from "./pix";
import { ErroProvedor } from "./provedor";
import { AGORA, type Cenario, DOCUMENTO_FICTICIO, EMAIL_HOSPEDE, env, minutos, montarCenario, TOTAL } from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => { c = await montarCenario(db); });

const conferir = (id: string, quando: Date) => conferirTentativa(db, c.org, id, c.provedor, quando, { origem: "rotina", forcar: true });
const vista = (cotacaoId: string, quando: Date, comAutorizacao = true, oferecido = true) => vistaDaCotacaoParaHospede(db, c.org, cotacaoId, quando, { comAutorizacao, oferecido });
const outras = (n: number) => ({ entrada: `2026-11-${String(2 + n * 4).padStart(2, "0")}`, saida: `2026-11-${String(5 + n * 4).padStart(2, "0")}`, email: `v${n}@example.com` });

describe("o que o hóspede vê (M8.2a)", () => {
  it("datas seguradas: Pix oferecido ou o fluxo pela conversa; Pix aguardando com QR só com a autorização; vencido gera outro; esgotado", async () => {
    const { cotacaoId } = await c.segurar();
    expect(await vista(cotacaoId, AGORA, true, false)).toMatchObject({ estado: "sem_pagamento", dinheiroSemDesfecho: false });
    expect(await vista(cotacaoId, AGORA)).toMatchObject({ estado: "pagar", pixRestantes: 3, holdAte: minutos(30), ambienteTeste: true, acompanhar: false });
    const p = await c.pix(cotacaoId);
    const com = await vista(cotacaoId, minutos(1));
    expect(com).toMatchObject({ estado: "pix_aguardando", dinheiroSemDesfecho: true, pixRestantes: 2, pix: { imagemBase64: "RkFMU08=", expiraEm: minutos(30) } });
    expect(com?.pix?.copiaECola).toContain(p.idProvedor);
    const sem = await vista(cotacaoId, minutos(1), false);
    expect(sem).toMatchObject({ estado: "pix_aguardando", pix: null });
    // Nada pessoal na vista (nem com a autorização).
    expect(JSON.stringify(com)).not.toContain(EMAIL_HOSPEDE);
    expect(JSON.stringify(com)).not.toContain("Visitante");
    c.provedor.expirar(p.idProvedor);
    await conferir(p.pagamentoId, minutos(31));
    expect(await vista(cotacaoId, minutos(31))).toMatchObject({ estado: "pix_vencido", pixRestantes: 2, pix: null });
    // Esgotado: três tentativas sem pagamento, datas ainda seguradas.
    // Cada Pix novo estende as datas até ele + 2 min: gerar o seguinte logo depois do vencimento do anterior.
    for (const [gerar, ler] of [[31, 61.5], [62, 92.5]]) {
      c.relogio.agora = minutos(gerar); // o provedor conta o prazo do Pix a partir da criação
      const r = await gerarPix(db, c.org, cotacaoId, minutos(gerar), c.provedor);
      if (!r.ok) throw new Error(r.erro);
      c.provedor.expirar((await c.tentativa(r.pagamentoId)).idProvedor!);
      await conferir(r.pagamentoId, minutos(ler));
    }
    expect(await vista(cotacaoId, minutos(93))).toMatchObject({ estado: "pix_esgotado", pixRestantes: 0 });
    // O último Pix venceu às 92 min e ainda pode virar dinheiro (o provedor pode corrigir): a página continua
    // acompanhando, mesmo depois do prazo das datas, até o prazo do Pix mais a folga da leitura (92 + 15 min).
    expect(await vista(cotacaoId, minutos(93))).toMatchObject({ acompanhar: true });
    expect(await vista(cotacaoId, minutos(100))).toMatchObject({ estado: "sem_pagamento", acompanhar: true });
    expect(await vista(cotacaoId, minutos(108))).toMatchObject({ estado: "sem_pagamento", acompanhar: false });
  });

  it("verificando (criação incerta); pagamento recebido e confirmando; confirmada com o código; pagamento em dobro", async () => {
    const a = await c.segurar();
    c.provedor.falhas.criarPix = new ErroProvedor("incerto", "tempo");
    await gerarPix(db, c.org, a.cotacaoId, AGORA, c.provedor);
    c.provedor.falhas.criarPix = null;
    expect(await vista(a.cotacaoId, minutos(1))).toMatchObject({ estado: "verificando", dinheiroSemDesfecho: true });

    const b = await c.segurar(outras(0));
    const pb = await c.pix(b.cotacaoId);
    // Aprovado e ainda sem decisão (o instante entre a leitura e a confirmação).
    await db.update(pagamentos).set({ situacao: "aprovado" }).where(eq(pagamentos.id, pb.pagamentoId));
    expect(await vista(b.cotacaoId, minutos(2))).toMatchObject({ estado: "confirmando", dinheiroSemDesfecho: true });
    await db.update(pagamentos).set({ situacao: "pendente" }).where(eq(pagamentos.id, pb.pagamentoId));
    c.provedor.aprovar(pb.idProvedor);
    await conferir(pb.pagamentoId, minutos(3));
    const reserva = await c.reserva(b.reservaId);
    expect(await vista(b.cotacaoId, minutos(3))).toMatchObject({ estado: "confirmada", reservaCodigo: reserva.codigo, pagamentoEmDobro: false, dinheiroSemDesfecho: false });
    // Outra tentativa aprovada na mesma cotação: confirmada, avisando que um pagamento será devolvido.
    const [dobro] = await db
      .insert(pagamentos)
      .values({ organizacaoId: c.org, cotacaoId: b.cotacaoId, reservaId: b.reservaId, imovelId: c.imovel, ambiente: "teste", forma: "pix", referencia: "scl-dobro", chaveIdempotencia: "dobro", situacao: "aprovado", valor: TOTAL, motivoSemReserva: "outra_tentativa" })
      .returning({ id: pagamentos.id });
    expect(await vista(b.cotacaoId, minutos(4))).toMatchObject({ estado: "confirmada", pagamentoEmDobro: true, dinheiroSemDesfecho: true });
    // Devolvido o pagamento a mais (pelo provedor, ou com desfecho de devolução feita por fora), o aviso sai.
    await db.update(pagamentos).set({ situacao: "devolvido", desfecho: "devolucao", desfechoEm: minutos(5) }).where(eq(pagamentos.id, dobro.id));
    expect(await vista(b.cotacaoId, minutos(5))).toMatchObject({ estado: "confirmada", pagamentoEmDobro: false });
    await db.update(pagamentos).set({ situacao: "aprovado", desfecho: "por_fora" }).where(eq(pagamentos.id, dobro.id));
    expect(await vista(b.cotacaoId, minutos(6))).toMatchObject({ estado: "confirmada", pagamentoEmDobro: false });
  });

  it("aprovado sem as datas, devolução pedida, devolvido; Pix aguardando vence 'expirada' na tela durante a carência", async () => {
    const a = await c.segurar();
    const pa = await c.pix(a.cotacaoId);
    await db.update(cotacoes).set({ total: TOTAL + 1 }).where(eq(cotacoes.id, a.cotacaoId));
    c.provedor.aprovar(pa.idProvedor, { taxa: 1806 });
    await conferir(pa.pagamentoId, minutos(3));
    expect(await vista(a.cotacaoId, minutos(3))).toMatchObject({ estado: "aprovado_sem_datas", dinheiroSemDesfecho: true });
    c.provedor.respostaDevolucao = "pedida";
    await devolverPeloProvedor(db, c.org, pa.pagamentoId, null, c.provedor, minutos(4));
    expect(await vista(a.cotacaoId, minutos(5))).toMatchObject({ estado: "devolucao_pedida", devolucao: { situacao: "pedida" } });
    c.provedor.confirmarDevolucoes(pa.idProvedor);
    await conferir(pa.pagamentoId, minutos(6));
    expect(await vista(a.cotacaoId, minutos(6))).toMatchObject({ estado: "devolvido", devolucao: { situacao: "feita", em: minutos(6) }, dinheiroSemDesfecho: false });

    // Outro pagamento sem reserva na mesma cotação, mais antigo e ainda a devolver: a página não diz "devolvido".
    const base = { organizacaoId: c.org, cotacaoId: a.cotacaoId, reservaId: a.reservaId, imovelId: c.imovel, ambiente: "teste" as const, forma: "pix" as const, valor: TOTAL };
    const [antigo] = await db
      .insert(pagamentos)
      .values({ ...base, referencia: "scl-antigo", chaveIdempotencia: "antigo", situacao: "aprovado", motivoSemReserva: "outra_tentativa", criadoEm: minutos(-30) })
      .returning();
    expect(await vista(a.cotacaoId, minutos(7))).toMatchObject({ estado: "aprovado_sem_datas", dinheiroSemDesfecho: true });
    // Devolução dele parada (o Mercado Pago recusou três vezes): nunca "devolução pedida"; a equipe resolve.
    await db.insert(devolucoesPagamento).values({ organizacaoId: c.org, pagamentoId: antigo.id, motivo: "outra tentativa", valor: TOTAL, situacao: "recusada", falhas: 3, tentativas: 3, criadoEm: minutos(7), atualizadoEm: minutos(7) });
    expect(await vista(a.cotacaoId, minutos(8))).toMatchObject({ estado: "aprovado_sem_datas" });
    // Os dois devolvidos: aí sim, "devolvido".
    await db.update(devolucoesPagamento).set({ situacao: "por_fora", porForaData: "2026-10-01", porForaValor: TOTAL }).where(eq(devolucoesPagamento.pagamentoId, antigo.id));
    await db.update(pagamentos).set({ desfecho: "por_fora", desfechoEm: minutos(9) }).where(eq(pagamentos.id, antigo.id));
    expect(await vista(a.cotacaoId, minutos(9))).toMatchObject({ estado: "devolvido", dinheiroSemDesfecho: false });

    const b = await c.segurar(outras(1));
    await c.pix(b.cotacaoId);
    const T = (await c.cotacao(b.cotacaoId)).holdAte!;
    // Prazo das datas vencido com o Pix ainda sem resposta do provedor (carência): "conferindo", nunca "expirada / nova consulta".
    expect(await vista(b.cotacaoId, new Date(T.getTime() + 60_000))).toMatchObject({ estado: "verificando", dinheiroSemDesfecho: true });
    // QR vencido, datas ainda seguradas: gerar outro.
    expect(await vista(b.cotacaoId, new Date(T.getTime() - 30_000))).toMatchObject({ estado: "pix_vencido" });
    // Pix pendente sem o prazo informado pelo provedor: continua aguardando (sem contagem), nunca "vencido".
    const [pbx] = await db.select().from(pagamentos).where(eq(pagamentos.cotacaoId, b.cotacaoId));
    await db.update(pagamentos).set({ pixExpiraEm: null }).where(eq(pagamentos.id, pbx.id));
    expect(await vista(b.cotacaoId, new Date(T.getTime() - 30_000))).toMatchObject({ estado: "pix_aguardando", pix: { expiraEm: null } });
    expect(await vista("00000000-0000-4000-8000-000000000000", AGORA)).toBeNull();
  });
});

describe("leituras que faltam dado e situações inesperadas (M8.2a)", () => {
  it("leitura do Pix pendente sem prazo, imagem ou link não apaga o que já se sabia; Pix sem prazo nenhum vira aviso", async () => {
    const { cotacaoId } = await c.segurar();
    const p = await c.pix(cotacaoId);
    const antes = await c.tentativa(p.pagamentoId);
    const [order] = c.provedor.todas().filter((o) => o.idProvedor === p.idProvedor);
    const semDados = { ...order, pix: { ...order.pix!, expiraEm: null, imagemBase64: null, link: null } };
    await conferirTentativa(db, c.org, p.pagamentoId, c.provedor, minutos(1), { origem: "rotina", forcar: true, cobranca: semDados });
    const depois = await c.tentativa(p.pagamentoId);
    expect(depois).toMatchObject({ situacao: "pendente", pixExpiraEm: antes.pixExpiraEm, pixImagem: antes.pixImagem, pixLink: antes.pixLink, pixCopiaECola: antes.pixCopiaECola, avisos: [] });
    expect(await vista(cotacaoId, minutos(2))).toMatchObject({ estado: "pix_aguardando" });
    // Nunca se soube o prazo: aviso (nada de prazo suposto).
    await db.update(pagamentos).set({ pixExpiraEm: null }).where(eq(pagamentos.id, p.pagamentoId));
    await conferirTentativa(db, c.org, p.pagamentoId, c.provedor, minutos(3), { origem: "rotina", forcar: true, cobranca: semDados });
    expect((await c.tentativa(p.pagamentoId)).avisos).toEqual(["pix_sem_prazo"]);
    await conferirTentativa(db, c.org, p.pagamentoId, c.provedor, minutos(4), { origem: "rotina", forcar: true });
    expect(await c.tentativa(p.pagamentoId)).toMatchObject({ pixExpiraEm: minutos(30), avisos: [] });
  });

  it("devolvido em parte antes de o sistema decidir: o hóspede vê 'aprovado sem as datas' (nunca 'confirmando' para sempre); o painel pede atenção, explica e só oferece Conferir agora (nada que o domínio recusaria)", async () => {
    const { cotacaoId, reservaId } = await c.segurar();
    const p = await c.pix(cotacaoId);
    c.provedor.aprovar(p.idProvedor);
    c.provedor.devolverNoProvedor(p.idProvedor, 1000);
    await conferir(p.pagamentoId, minutos(3));
    expect(await vista(cotacaoId, minutos(3))).toMatchObject({ estado: "aprovado_sem_datas", dinheiroSemDesfecho: true });
    const [q] = await pagamentosDaReserva(db, c.org, reservaId, minutos(3));
    expect(q).toMatchObject({ situacao: "devolvido_parcial", pedeAtencao: true, motivoSemReservaTexto: expect.stringContaining("antes de o sistema decidir"), acoes: { conferir: true, devolver: false, devolucaoPorFora: false, registrarTaxaPerdida: false } });
    expect(q.avisos.join(" ")).toContain("M8.2c");
    // O domínio também recusa (o Mercado Pago sempre mostra a parte devolvida).
    expect(await registrarDevolucaoPorFora(db, c.org, p.pagamentoId, { data: "2026-10-01", valor: TOTAL, nota: "" }, null, c.provedor, minutos(4))).toMatchObject({ ok: false });
    // No Início: alerta próprio (resolver no painel do Mercado Pago), não "devolva ao hóspede".
    const { alertas, contagens } = await avisosDePagamento(db, c.org, minutos(5), { env: env({}) });
    expect(contagens).toMatchObject({ aprovadoSemDesfecho: 0, situacaoInesperada: 1 });
    const textos = alertas.map((a) => a.texto).join("\n");
    expect(textos).not.toContain("devolva ao hóspede");
    expect(alertas).toContainEqual({
      nivel: "atencao",
      texto: "1 pagamento(s) do site que o Mercado Pago mostrou já devolvido(s) em parte ou contestado(s) antes de o sistema decidir a reserva: resolva pelo painel do Mercado Pago (o sistema passa a cuidar disso no M8.2c).",
      link: "/painel/financeiro/pagamentos-site?atencao=1",
    });
  });

  it("contestado antes de o sistema decidir: 'Registrar devolução feita por fora' continua oferecido; recusado enquanto o Mercado Pago mostra a contestação, aceito quando ele volta a mostrar aprovado", async () => {
    const { cotacaoId, reservaId } = await c.segurar();
    const p = await c.pix(cotacaoId);
    c.provedor.aprovar(p.idProvedor);
    c.provedor.contestar(p.idProvedor);
    await conferir(p.pagamentoId, minutos(3));
    const [q] = await pagamentosDaReserva(db, c.org, reservaId, minutos(3));
    expect(q).toMatchObject({ situacao: "contestado", desfecho: null, motivoSemReserva: "situacao_inesperada", acoes: { devolver: false, devolucaoPorFora: true } });
    expect((await avisosDePagamento(db, c.org, minutos(3), { env: env({}) })).contagens).toMatchObject({ aprovadoSemDesfecho: 0, situacaoInesperada: 1 });
    const porFora = (quando: Date) => registrarDevolucaoPorFora(db, c.org, p.pagamentoId, { data: "2026-10-01", valor: TOTAL, nota: "" }, null, c.provedor, quando);
    expect(await porFora(minutos(4))).toMatchObject({ ok: false, erro: expect.stringContaining("contestado") });
    // A contestação se resolve (o Mercado Pago volta a mostrar aprovado); a situação local continua "contestado".
    c.provedor.aprovar(p.idProvedor);
    await conferir(p.pagamentoId, minutos(5));
    const [q2] = await pagamentosDaReserva(db, c.org, reservaId, minutos(5));
    expect(q2).toMatchObject({ situacao: "contestado", acoes: { devolucaoPorFora: true } });
    expect(await porFora(minutos(6))).toEqual({ ok: true, situacao: "por_fora" });
    expect((await avisosDePagamento(db, c.org, minutos(7), { env: env({}) })).contagens.situacaoInesperada).toBe(0);
  });
});

describe("painel: pagamentos da reserva, lista e avisos do Início (M8.2a)", () => {
  it("quadro da reserva com valores, motivo e ações; lista por período e 'pede atenção'; pagamento que prende a reserva", async () => {
    const a = await c.segurar();
    const pa = await c.pix(a.cotacaoId);
    expect(await pagamentoEmAndamentoOuAprovado(db, a.reservaId)).toMatchObject({ id: pa.pagamentoId, situacao: "pendente", forma: "pix" });
    await db.update(cotacoes).set({ total: TOTAL + 1 }).where(eq(cotacoes.id, a.cotacaoId));
    c.provedor.aprovar(pa.idProvedor, { taxa: 1806 });
    await conferir(pa.pagamentoId, minutos(3));
    // Decidido "sem reserva": não prende a reserva (é dinheiro a devolver).
    expect(await pagamentoEmAndamentoOuAprovado(db, a.reservaId)).toBeNull();
    const [q] = await pagamentosDaReserva(db, c.org, a.reservaId, minutos(3));
    expect(q).toMatchObject({ situacao: "aprovado", valor: TOTAL, taxa: 1806, motivoSemReservaTexto: expect.stringContaining("valor aprovado"), pedeAtencao: true, acoes: { devolver: true, devolucaoPorFora: true, registrarLiberacao: false } });
    expect(await pagamentosDaReserva(db, "00000000-0000-4000-8000-000000000001", a.reservaId)).toEqual([]);
    const b = await c.segurar(outras(0));
    const pb = await c.pix(b.cotacaoId);
    c.provedor.aprovar(pb.idProvedor, { liquido: TOTAL - 1806, liberacaoPrevista: new Date("2026-10-03T12:00:00Z") });
    await conferir(pb.pagamentoId, minutos(4));
    const [qb] = await pagamentosDaReserva(db, c.org, b.reservaId, minutos(4));
    expect(qb).toMatchObject({ desfecho: "reserva", pedeAtencao: false, acoes: { devolver: false, registrarLiberacao: true, estornarLiberacao: false } });
    expect(await listarPagamentos(db, c.org, { de: "2026-10-01", ate: "2026-10-01" }, minutos(5))).toHaveLength(2);
    expect(await listarPagamentos(db, c.org, { de: "2026-10-02", ate: "2026-10-31" }, minutos(5))).toHaveLength(0);
    const atencao = await listarPagamentos(db, c.org, { atencao: true }, minutos(5));
    expect(atencao.map((l) => l.id)).toEqual([pa.pagamentoId]);
    expect(atencao[0]).toMatchObject({ reservaCodigo: expect.stringMatching(/^SCL-/), imovelCodigo: "403", cotacaoCodigo: expect.stringMatching(/^COT-/) });
    // Liberação prevista vencida sem sinal também pede atenção.
    expect((await listarPagamentos(db, c.org, { atencao: true }, new Date("2026-10-04T12:00:00Z"))).map((l) => l.id).sort()).toEqual([pa.pagamentoId, pb.pagamentoId].sort());
    // Mais de 500 tentativas mais novas que não pedem atenção: o filtro vem do banco, antes do limite de linhas.
    const base = { organizacaoId: c.org, cotacaoId: b.cotacaoId, reservaId: b.reservaId, imovelId: c.imovel, ambiente: "teste" as const, forma: "pix" as const, valor: TOTAL, situacao: "cancelado" as const };
    await db.insert(pagamentos).values(Array.from({ length: 501 }, (_, i) => ({ ...base, referencia: `scl-velha-${i}`, chaveIdempotencia: `velha-${i}`, criadoEm: minutos(10 + i) })));
    expect(await listarPagamentos(db, c.org, {}, minutos(600))).toHaveLength(500);
    expect((await listarPagamentos(db, c.org, { atencao: true }, minutos(600))).map((l) => l.id)).toEqual([pa.pagamentoId]);
  });

  it("Início: aprovado sem desfecho, devolução pedida/recusada, liberação vencida, live_mode, dinheiro sem cálculo, configuração inválida e o informativo das OTAs", async () => {
    const vazio = await avisosDePagamento(db, c.org, AGORA, { env: env({}) });
    expect(vazio.alertas).toEqual([]);
    expect((await avisosDePagamento(db, c.org, AGORA, { env: env({ MERCADOPAGO_AMBIENTE: "prod" }) })).alertas[0].texto).toContain("Configuração inválida");
    expect((await avisosDePagamento(db, c.org, AGORA, { env: env(), contaDeTeste: false })).alertas[0].texto).toContain("não é de teste");

    const a = await c.segurar();
    const pa = await c.pix(a.cotacaoId);
    await db.update(cotacoes).set({ total: TOTAL + 1 }).where(eq(cotacoes.id, a.cotacaoId));
    c.provedor.aprovar(pa.idProvedor, { taxa: 1806 });
    await conferir(pa.pagamentoId, minutos(3));
    const b = await c.segurar(outras(0));
    const pb = await c.pix(b.cotacaoId);
    c.provedor.aprovar(pb.idProvedor, { liquido: TOTAL - 1806, liberacaoPrevista: new Date("2026-10-03T12:00:00Z") });
    await conferir(pb.pagamentoId, minutos(4));
    await registrarEventoDeAviso(db, { tipo: "order", acao: "order.processed", dataId: "ORDREAL0001", requestId: "r-1", ts: "1", aoVivo: true }, AGORA);
    const r = await avisosDePagamento(db, c.org, new Date("2026-10-04T12:00:00Z"), { env: env({}) });
    expect(r.contagens).toMatchObject({ aprovadoSemDesfecho: 1, liberacaoVencida: 1, aoVivo: 1, pagasAbertas: 1, semCalculo: 0 });
    const textos = r.alertas.map((x) => x.texto).join("\n");
    expect(textos).toContain("aprovado(s) sem reserva");
    expect(textos).toContain("liberação prevista vencida");
    expect(textos).toContain("live_mode");
    expect(textos).toContain("feche as datas nas OTAs");
    // Escrita no Beds24 ligada, mas o envio automático desligado no painel: o informativo continua.
    expect((await avisosDePagamento(db, c.org, new Date("2026-10-04T12:00:00Z"), { env: env({ BEDS24_ESCRITA: "ligada", BEDS24_TOKEN: "x" }) })).alertas.map((x) => x.texto).join()).toContain("feche as datas");
    // Devolução pedida e depois recusada.
    c.provedor.falhas.devolver = new ErroProvedor("incerto", "tempo");
    await devolverPeloProvedor(db, c.org, pa.pagamentoId, null, c.provedor, minutos(10));
    expect((await avisosDePagamento(db, c.org, minutos(11), { env: env({}) })).contagens.devolucaoPedida).toBe(1);
    await db.update(devolucoesPagamento).set({ situacao: "recusada" }).where(eq(devolucoesPagamento.pagamentoId, pa.pagamentoId));
    const recusada = await avisosDePagamento(db, c.org, minutos(11), { env: env({}) });
    expect(recusada.contagens.devolucaoRecusada).toBe(1);
    // O Início não afirma que o Mercado Pago não fez: manda conferir lá antes.
    expect(recusada.alertas.map((x) => x.texto).join("\n")).toContain("o Mercado Pago recusou ou não respondeu três vezes. Confira no painel do Mercado Pago antes de tentar de novo");
    await db.update(devolucoesPagamento).set({ situacao: "pedida" }).where(eq(devolucoesPagamento.pagamentoId, pa.pagamentoId));
    // Dinheiro sem cálculo: os lançamentos do motor da reserva paga somem (recálculo depois do fim do contrato).
    const motor = await db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, b.reservaId), eq(lancamentos.origem, "motor")));
    for (const l of motor) await estornar(db, c.org, l.id, "contrato encerrado", null);
    expect((await avisosDePagamento(db, c.org, minutos(11), { env: env({}) })).contagens.semCalculo).toBe(1);
  });

  it("Início: criação do Pix sem resposta do Mercado Pago há mais que a carência (busca pela referência falhando) vira alerta", async () => {
    const s = await c.segurar();
    c.provedor.falhas.criarPix = new ErroProvedor("incerto", "tempo");
    await gerarPix(db, c.org, s.cotacaoId, AGORA, c.provedor);
    c.provedor.falhas.criarPix = null;
    c.provedor.falhas.buscarPorReferencia = new ErroProvedor("indisponivel", "busca fora do ar");
    await conferirTentativa(db, c.org, (await db.select().from(pagamentos).where(eq(pagamentos.cotacaoId, s.cotacaoId)))[0].id, c.provedor, minutos(20), { origem: "rotina", forcar: true });
    expect((await avisosDePagamento(db, c.org, minutos(10), { env: env({}) })).contagens.criacaoPresa).toBe(0);
    const r = await avisosDePagamento(db, c.org, minutos(20), { env: env({}) });
    expect(r.contagens.criacaoPresa).toBe(1);
    expect(r.alertas.map((x) => x.texto).join("\n")).toContain("sem resposta do Mercado Pago sobre a criação");
    expect((await listarPagamentos(db, c.org, { atencao: true }, minutos(20))).map((l) => l.situacao)).toEqual(["incerta"]);
  });

  it("dados pessoais: depois de fluxos completos, nenhum e-mail ou documento do pagador em tentativas, eventos ou auditoria do pagamento", async () => {
    const a = await c.segurar();
    const pa = await c.pix(a.cotacaoId);
    c.provedor.aprovar(pa.idProvedor, { taxa: 1806, liberado: true });
    await conferir(pa.pagamentoId, minutos(3));
    await registrarEventoDeAviso(db, { tipo: "order", acao: "order.processed", dataId: pa.idProvedor, requestId: "req-1", ts: "1700000000" }, minutos(3));
    const b = await c.segurar(outras(0));
    const pb = await c.pix(b.cotacaoId);
    await db.update(cotacoes).set({ total: TOTAL + 1 }).where(eq(cotacoes.id, b.cotacaoId));
    c.provedor.aprovar(pb.idProvedor, { taxa: 1806 });
    await conferir(pb.pagamentoId, minutos(4));
    await devolverPeloProvedor(db, c.org, pb.pagamentoId, null, c.provedor, minutos(5));
    await expirarHoldsVencidos(db, c.org, minutos(200));
    const tudo = JSON.stringify([
      await db.select().from(pagamentos).where(eq(pagamentos.organizacaoId, c.org)),
      await db.select().from(eventosPagamento),
      (await db.select().from(auditoria).where(eq(auditoria.organizacaoId, c.org))).filter((x) => x.acao.startsWith("pagamento.") || x.acao.startsWith("cotacao.")),
    ]);
    for (const proibido of [EMAIL_HOSPEDE, "v0@example.com", "test@testuser.com", DOCUMENTO_FICTICIO, "Visitante Fictício", "99999-0000"]) expect(tudo).not.toContain(proibido);
    // A auditoria geral da reserva continua sem o contato por extenso (regra do M8.1).
    const geral = JSON.stringify(await db.select().from(auditoria).where(eq(auditoria.organizacaoId, c.org)));
    expect(geral).not.toContain(EMAIL_HOSPEDE);
  });
});
