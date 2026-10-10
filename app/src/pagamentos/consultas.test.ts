import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditoria, cotacoes, devolucoesPagamento, eventosPagamento, lancamentos, pagamentos } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { estornar } from "@/financeiro/ledger";
import { lerRegrasCalendario, salvarRegrasCalendario } from "@/calendario/regras-config";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import { expirarHoldsVencidos } from "@/site/cotacoes";
import { textoDoCancelamento } from "@/site/pagamento-vista";
import { conferirTentativa } from "./conferencia";
import {
  avisosDeCancelamento,
  avisosDePagamento,
  canceladaEmPalavras,
  listarPagamentos,
  nomeDaBandeira,
  pagamentoEmAndamentoOuAprovado,
  pagamentosDaReserva,
  TEXTO_DEVOLUCAO_FALHOU_NA_LEITURA,
  TEXTO_RECUSA_NO_PAINEL,
  vistaDaCotacaoParaHospede,
} from "./consultas";
import { marcarHospedeAvisado, marcarOtaLiberada } from "./cancelamento";
import { devolverPeloProvedor, registrarDevolucaoPorFora, registrarRecusaNoPainel, registrarTaxaPerdida } from "./devolucao";
import { registrarEventoDeAviso } from "./eventos";
import { conferirPendentes } from "./rotina";
import { gerarPix } from "./pix";
import { ErroProvedor } from "./provedor";
import { AGORA, type Cenario, cancelar, DOCUMENTO_FICTICIO, EMAIL_HOSPEDE, entradaPadrao, env, envelhecer, minutos, montarCenario, pagarEConfirmar, pedir, TOTAL, usuarioDeTeste } from "./testes";

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
    expect(q.avisos.join(" ")).toContain("M8.2d");
    // O domínio também recusa (o Mercado Pago sempre mostra a parte devolvida).
    expect(await registrarDevolucaoPorFora(db, c.org, p.pagamentoId, { data: "2026-10-01", valor: TOTAL, nota: "" }, null, c.provedor, minutos(4))).toMatchObject({ ok: false });
    // No Início: alerta próprio (resolver no painel do Mercado Pago), não "devolva ao hóspede".
    const { alertas, contagens } = await avisosDePagamento(db, c.org, minutos(5), { env: env({}) });
    expect(contagens).toMatchObject({ aprovadoSemDesfecho: 0, situacaoInesperada: 1 });
    const textos = alertas.map((a) => a.texto).join("\n");
    expect(textos).not.toContain("devolva ao hóspede");
    expect(alertas).toContainEqual({
      nivel: "atencao",
      texto: "1 pagamento(s) do site que o Mercado Pago mostrou já devolvido(s) em parte ou contestado(s) antes de o sistema decidir a reserva: resolva pelo painel do Mercado Pago (o sistema passa a cuidar disso no M8.2d).",
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

  it("aceite das páginas legais por tentativa (M7.4): as versões e o prazo da política aceita; tentativa sem aceite (anterior ao M7.4), null; o mesmo na lista", async () => {
    const a = await c.segurar();
    const pa = await c.pix(a.cotacaoId);
    const [q] = await pagamentosDaReserva(db, c.org, a.reservaId, minutos(1));
    expect(q.aceite).toEqual({ versoes: { termos: 1, privacidade: 1, cancelamento: 1 }, aceitoEm: AGORA, diasReembolsoIntegral: 14 });
    // Tentativa gravada sem aceite (como as de antes do M7.4).
    const base = { organizacaoId: c.org, cotacaoId: a.cotacaoId, reservaId: a.reservaId, imovelId: c.imovel, ambiente: "teste" as const, forma: "pix" as const, valor: TOTAL, situacao: "cancelado" as const };
    await db.insert(pagamentos).values({ ...base, referencia: "scl-antiga", chaveIdempotencia: "antiga", criadoEm: minutos(-60) });
    const [antiga, nova] = await pagamentosDaReserva(db, c.org, a.reservaId, minutos(1));
    expect(antiga.aceite).toBeNull();
    expect(nova.id).toBe(pa.pagamentoId);
    expect(nova.aceite?.diasReembolsoIntegral).toBe(14);
    const lista = await listarPagamentos(db, c.org, {}, minutos(1));
    expect(lista.find((l) => l.id === pa.pagamentoId)?.aceite?.versoes).toEqual({ termos: 1, privacidade: 1, cancelamento: 1 });
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

describe("o cartão na página do hóspede e no painel (M8.2b)", () => {
  it("desafio do banco: o endereço só com a autorização (e só de domínio do Mercado Pago); em análise, mesmo depois do prazo das datas; recusado com as datas seguradas; sem as datas, sem pagamento", async () => {
    const s = await c.segurar();
    c.provedor.respostaCartao = "desafio";
    const r = await c.cartao(s.cotacaoId);
    const com = await vista(s.cotacaoId, minutos(1));
    expect(com).toMatchObject({ estado: "cartao_desafio", forma: "cartao", cartaoRestantes: 2, pixRestantes: 3, desafioUrl: expect.stringMatching(/^https:\/\/www\.mercadopago\.com\.br\//) });
    expect(await vista(s.cotacaoId, minutos(1), false)).toMatchObject({ estado: "cartao_desafio", desafioUrl: null });
    // Endereço adulterado no banco: não sai (a vista confere de novo).
    await db.update(pagamentos).set({ desafioUrl: "https://exemplo.invalid/3ds" }).where(eq(pagamentos.id, r.pagamentoId!));
    expect(await vista(s.cotacaoId, minutos(1))).toMatchObject({ estado: "cartao_desafio", desafioUrl: null });
    c.provedor.concluirDesafio(r.idProvedor!, "expirado");
    await conferir(r.pagamentoId!, minutos(41));
    expect(await vista(s.cotacaoId, minutos(41))).toMatchObject({ estado: "cartao_recusado", recusa: "verificacao", acompanhar: true });
    // Datas não mais seguradas e nada que ainda possa virar dinheiro: o fluxo pela conversa.
    expect(await vista(s.cotacaoId, minutos(60))).toMatchObject({ estado: "sem_pagamento", acompanhar: false });

    const a = await c.segurar(outras(0));
    c.provedor.respostaCartao = "em_analise";
    await c.cartao(a.cotacaoId);
    expect(await vista(a.cotacaoId, minutos(2))).toMatchObject({ estado: "cartao_em_analise", dinheiroSemDesfecho: true });
    await expirarHoldsVencidos(db, c.org, minutos(80));
    expect(await vista(a.cotacaoId, minutos(80))).toMatchObject({ estado: "cartao_em_analise", holdAte: null });

    const p = await c.segurar(outras(1));
    c.provedor.respostaCartao = "processando";
    await c.cartao(p.cotacaoId);
    expect(await vista(p.cotacaoId, minutos(2))).toMatchObject({ estado: "verificando" });

    const x = await c.segurar(outras(2));
    c.provedor.respostaCartao = "recusado";
    await c.cartao(x.cotacaoId);
    expect(await vista(x.cotacaoId, minutos(2))).toMatchObject({ estado: "cartao_recusado", recusa: "cartao", cartaoRestantes: 2, acompanhar: false });
    // Um Pix gerado depois: a página volta a ser do Pix.
    await c.pix(x.cotacaoId, minutos(3));
    expect(await vista(x.cotacaoId, minutos(4))).toMatchObject({ estado: "pix_aguardando", forma: "pix", cartaoRestantes: 2 });
    // Nada pessoal na vista.
    expect(JSON.stringify(await vista(x.cotacaoId, minutos(4)))).not.toContain(EMAIL_HOSPEDE);
  });

  it("painel: bandeira, parcelas, verificação do banco, identificadores no Mercado Pago, juros e o motivo da recusa (o texto do painel); nunca dados do cartão", async () => {
    const s = await c.segurar();
    c.provedor.respostaCartao = "recusado";
    c.provedor.motivoRecusaCartao = "high_risk";
    await c.cartao(s.cotacaoId);
    c.provedor.respostaCartao = "aprovado";
    c.provedor.jurosCartao = 9_000;
    const ok = await c.cartao(s.cotacaoId, { parcelas: 3, bandeira: "visa" }, minutos(1));
    c.provedor.atualizarFinanceiro(ok.idProvedor!, { taxa: 9_100, liquido: TOTAL - 9_100 });
    await conferir(ok.pagamentoId!, minutos(2));
    const [recusado, aprovado] = await pagamentosDaReserva(db, c.org, s.reservaId, minutos(3));
    expect(recusado).toMatchObject({ forma: "cartao", situacao: "recusado", bandeira: "master", parcelas: 1, tresDS: "on_fraud_risk", motivoRecusa: "Recusado pela análise de segurança do Mercado Pago.", juros: null, idProvedor: expect.stringMatching(/^ORDTST/) });
    expect(recusado.referencia).toMatch(/^scl-/);
    expect(aprovado).toMatchObject({
      situacao: "aprovado",
      bandeira: "visa",
      parcelas: 3,
      tresDSStatus: "AUTHENTICATED",
      juros: 9_000,
      custoParcelasVendedor: 0,
      motivoRecusa: null,
      etapaCartao: null,
      idPagamentoProvedor: expect.stringMatching(/^\d+$/),
    });
    expect(nomeDaBandeira("master")).toBe("Mastercard");
    expect(nomeDaBandeira("visa")).toBe("Visa");
    expect(nomeDaBandeira("naranja")).toBe("naranja");
    // Um Pix no painel não tem campos de cartão.
    const outro = await c.segurar(outras(0));
    await c.pix(outro.cotacaoId);
    const [pix] = await pagamentosDaReserva(db, c.org, outro.reservaId, minutos(3));
    expect(pix).toMatchObject({ forma: "pix", bandeira: null, parcelas: null, tresDS: null, juros: null, motivoRecusa: null });
  });

  it("Início: criação sem resposta conta para o cartão também (o texto fala de pagamento)", async () => {
    const s = await c.segurar();
    c.provedor.falhas.criarCartao = new ErroProvedor("incerto", "tempo");
    await c.cartao(s.cotacaoId);
    c.provedor.falhas.criarCartao = null;
    const r = await avisosDePagamento(db, c.org, minutos(20), { env: env({}) });
    expect(r.contagens.criacaoPresa).toBe(1);
    expect(r.alertas.map((x) => x.texto).join("\n")).toContain("1 pagamento(s) do site sem resposta do Mercado Pago sobre a criação");
  });
});

describe("cancelamento pela política: a página do hóspede, o quadro do pagamento e o Início (M8.2c)", () => {
  const longe = { entrada: "2026-11-20", saida: "2026-11-23" };
  const empresa = () => entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" });
  const t = TEXTOS_SITE_INICIAIS;
  const texto = async (cotacaoId: string, quando: Date) => {
    const v = (await vista(cotacaoId, quando))!;
    return { v, ...textoDoCancelamento(v, t) };
  };
  const acoes = async (reservaId: string, quando: Date) => (await pagamentosDaReserva(db, c.org, reservaId, quando))[0];

  it("as cinco situações da página e o texto de cada uma (valores, prazos, como o dinheiro volta; nada de Beds24 nem dado pessoal)", async () => {
    const equipe = await usuarioDeTeste(c);
    // Sem devolução (pedido depois dos prazos): os prazos aparecem.
    const a = await pagarEConfirmar(c);
    await cancelar(c, a.reservaId, entradaPadrao({ recebidoEm: new Date("2026-10-10T10:00:00-03:00"), canal: "email" }), equipe, new Date("2026-10-10T11:00:00-03:00"));
    const ta = await texto(a.cotacaoId, new Date("2026-10-10T12:00:00-03:00"));
    expect(ta.v).toMatchObject({ estado: "cancelada_sem_devolucao", reservaCodigo: a.reservaCodigo, cancelamento: { direito: "nenhum", base: "fora_do_prazo", integralAte: "2026-09-28", arrependimentoAte: "2026-10-08", politicaVersao: 1 } });
    expect(ta.linhas[0]).toBe(`Reserva ${a.reservaCodigo} cancelada. Recebemos o seu pedido em 10/10 às 10:00 (horário de Brasília).`);
    // Paga em 01/10 com o prazo do integral até 28/09: esse prazo nunca valeu para ela (não aparece), só o arrependimento.
    expect(ta.decisao).toBe(`Esta reserva foi paga quando o prazo de reembolso integral já tinha passado. Arrependimento: até 08/10. ${t.cancelamentoSemDevolucaoPrazo}`);
    expect(ta.comoVolta).toBeNull();

    // Devolvida pelo Mercado Pago (Pix): o valor confirmado e o dia; como volta no Pix.
    const b = await pagarEConfirmar(c, { ...longe, email: "b@example.com" });
    await cancelar(c, b.reservaId, empresa(), equipe, minutos(60));
    const tb = await texto(b.cotacaoId, minutos(70));
    expect(tb.v).toMatchObject({ estado: "cancelada_devolvida", cancelamento: { direito: "integral", base: "empresa", valor: TOTAL, valorConfirmado: TOTAL, confirmadaPor: "leitura", porFora: false } });
    expect(tb.linhas[0]).toBe(`Nós cancelamos a sua reserva ${b.reservaCodigo} por motivo de força maior.`);
    expect(tb.decisao).toBe(`Pela Política de cancelamento que você aceitou (versão 1), devolvemos o valor integral pago, R$ 1.824,00, ${t.cancelamentoSemTaxas} Devolução de R$ 1.824,00 confirmada pelo Mercado Pago em 01/10.`);
    expect(tb.comoVolta).toBe(t.cancelamentoVoltaPix);

    // Pedida e ainda não confirmada (inclusive a aceita sem aparecer, com o aviso): pedida.
    c.provedor.respostaDevolucao = "pedida";
    const d = await pagarEConfirmar(c, { entrada: "2026-11-25", saida: "2026-11-27", email: "d@example.com" });
    await cancelar(c, d.reservaId, empresa(), equipe, minutos(60));
    expect((await texto(d.cotacaoId, minutos(70))).v.estado).toBe("cancelada_devolucao_pedida");
    await db.update(pagamentos).set({ avisos: ["devolucao_sem_confirmacao"] }).where(eq(pagamentos.id, d.pagamentoId));
    const td = await texto(d.cotacaoId, minutos(70));
    expect(td.v.estado).toBe("cancelada_devolucao_pedida");
    expect(td.decisao).toContain(t.cancelamentoDevolucaoPedida);

    // Com a equipe (Pix com mais de 78 dias: nada foi pedido ao Mercado Pago).
    c.provedor.respostaDevolucao = "confirmada";
    const e = await pagarEConfirmar(c, { entrada: "2026-11-28", saida: "2026-11-30", email: "e@example.com" });
    await envelhecer(c, e.pagamentoId, 80);
    await cancelar(c, e.reservaId, empresa(), equipe, minutos(60));
    const te = await texto(e.cotacaoId, minutos(70));
    expect(te.v.estado).toBe("cancelada_com_a_equipe");
    expect(te.decisao).toContain(`A devolução de ${"R$ 1.296,00"} pelo Mercado Pago não foi possível. ${t.cancelamentoComAEquipe}`);

    // Cartão com mais de 78 dias (D12): o estorno no cartão pela equipe, como pedida.
    const f = await pagarEConfirmar(c, { entrada: "2026-11-05", saida: "2026-11-07", email: "f@example.com", forma: "cartao" });
    await envelhecer(c, f.pagamentoId, 80);
    await cancelar(c, f.reservaId, empresa(), equipe, minutos(60));
    const tf = await texto(f.cotacaoId, minutos(70));
    expect(tf.v).toMatchObject({ estado: "cancelada_devolucao_pedida", cancelamento: { estornoPelaEquipe: true, forma: "cartao" } });
    expect(tf.decisao).toContain(t.cancelamentoEstornoNoCartao);
    expect(tf.comoVolta).toBe(t.cancelamentoVoltaCartao);

    // Em conferência (o Mercado Pago devolveu a menos): sem oferecer outra forma de pagar.
    c.provedor.devolverAMenos(5000);
    const g = await pagarEConfirmar(c, { entrada: "2026-11-09", saida: "2026-11-11", email: "g@example.com" });
    await cancelar(c, g.reservaId, empresa(), equipe, minutos(60));
    const tg = await texto(g.cotacaoId, minutos(70));
    expect(tg.v.estado).toBe("cancelada_em_conferencia");
    expect(tg.decisao).toContain(t.cancelamentoEmConferencia);
    expect(tg.comoVolta).toBeNull();

    for (const x of [ta, tb, td, te, tf, tg]) {
      expect(JSON.stringify(x)).not.toMatch(/Beds24/i);
      expect(JSON.stringify(x)).not.toContain(EMAIL_HOSPEDE);
    }
  });

  it("cartão com a devolução recusada por falta de saldo (a por fora do cartão continua fechada): 'devolução pedida', nunca 'outra forma'; com a recusa do painel registrada, com a equipe", async () => {
    const equipe = await usuarioDeTeste(c);
    c.provedor.respostaDevolucao = "saldo_insuficiente";
    const x = await pagarEConfirmar(c, { ...longe, forma: "cartao" });
    await cancelar(c, x.reservaId, empresa(), equipe, minutos(60));
    await conferirPendentes(db, c.org, c.provedor, minutos(71));
    await conferirPendentes(db, c.org, c.provedor, minutos(82));
    expect((await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.pagamentoId, x.pagamentoId)))[0]).toMatchObject({ situacao: "recusada", ultimoCodigo: "saldo_insuficiente" });
    const tx = await texto(x.cotacaoId, minutos(90));
    expect(tx.v.estado).toBe("cancelada_devolucao_pedida");
    expect(tx.decisao).not.toContain(t.cancelamentoComAEquipe);
    expect((await acoes(x.reservaId, minutos(90))).cancelada?.estado).toBe("cancelada_devolucao_pedida");
    // A recusa do painel do Mercado Pago registrada abre a por fora do cartão: aí sim, a equipe combina outra forma.
    expect(await registrarRecusaNoPainel(db, c.org, x.pagamentoId, { data: "2026-10-01", nota: "Painel recusou o estorno" }, equipe, minutos(95))).toEqual({ ok: true, situacao: "recusada" });
    expect((await texto(x.cotacaoId, minutos(100))).v.estado).toBe("cancelada_com_a_equipe");
  });

  it("o quadro do pagamento e a lista dizem a mesma situação da página do hóspede (a reserva cancelada pela política, pela devolução)", async () => {
    const equipe = await usuarioDeTeste(c);
    // Ainda confirmada: nada de cancelada.
    const a = await pagarEConfirmar(c);
    expect((await acoes(a.reservaId, minutos(10))).cancelada).toBeNull();
    // Sem devolução (valor retido).
    await cancelar(c, a.reservaId, entradaPadrao({ recebidoEm: new Date("2026-10-10T10:00:00-03:00"), canal: "email" }), equipe, new Date("2026-10-10T11:00:00-03:00"));
    const pa = await acoes(a.reservaId, new Date("2026-10-10T12:00:00-03:00"));
    expect(pa.cancelada).toEqual({ estado: "cancelada_sem_devolucao", estornoPelaEquipe: false });
    expect(canceladaEmPalavras(pa.cancelada!)).toBe("Reserva cancelada: sem devolução (valor retido)");
    // Devolvida pelo Mercado Pago: a mesma situação na lista dos pagamentos do site.
    const b = await pagarEConfirmar(c, { entrada: "2026-11-25", saida: "2026-11-27", email: "b@example.com" });
    await cancelar(c, b.reservaId, empresa(), equipe, minutos(60));
    expect((await acoes(b.reservaId, minutos(70))).cancelada?.estado).toBe("cancelada_devolvida");
    const linha = (await listarPagamentos(db, c.org, { de: "2026-10-01", ate: "2026-10-31" }, minutos(70))).find((p) => p.reservaId === b.reservaId);
    expect(linha?.cancelada).toEqual({ estado: "cancelada_devolvida", estornoPelaEquipe: false });
    // Cartão com mais de 78 dias: o estorno pelo painel do Mercado Pago, feito pela equipe.
    const f = await pagarEConfirmar(c, { entrada: "2026-11-05", saida: "2026-11-07", email: "f@example.com", forma: "cartao" });
    await envelhecer(c, f.pagamentoId, 80);
    await cancelar(c, f.reservaId, empresa(), equipe, minutos(60));
    const pf = await acoes(f.reservaId, minutos(70));
    expect(pf.cancelada).toEqual({ estado: "cancelada_devolucao_pedida", estornoPelaEquipe: true });
    expect(canceladaEmPalavras(pf.cancelada!)).toBe("Reserva cancelada: devolução pelo painel do Mercado Pago (pagamento com mais de 78 dias)");
  });

  it("por fora: a devolução feita no dia informado, sem a linha do meio de pagamento; pela equipe no painel do Mercado Pago: 'feita pelo Mercado Pago'", async () => {
    const equipe = await usuarioDeTeste(c);
    const x = await pagarEConfirmar(c, longe);
    await envelhecer(c, x.pagamentoId, 80);
    await cancelar(c, x.reservaId, empresa(), equipe, minutos(60));
    await registrarDevolucaoPorFora(db, c.org, x.pagamentoId, { data: "2026-10-01", valor: TOTAL, nota: "Pix da conta da empresa" }, equipe, c.provedor, minutos(70));
    const tx = await texto(x.cotacaoId, minutos(80));
    expect(tx.v).toMatchObject({ estado: "cancelada_devolvida", cancelamento: { porFora: true } });
    expect(tx.decisao).toContain("Devolução de R$ 1.824,00 feita em 01/10.");
    expect(tx.comoVolta).toBe(t.cancelamentoVoltaPorFora);
    expect(tx.linhas.join(" ")).not.toContain(t.cancelamentoVoltaPix);
  });

  it("pedido registrado, ainda sem decisão: a página continua 'confirmada', com a linha do pedido", async () => {
    const equipe = await usuarioDeTeste(c);
    const x = await pagarEConfirmar(c, longe);
    await pedir(c, x.reservaId, equipe, { recebidoEm: minutos(30), quando: minutos(40) });
    const v = (await vista(x.cotacaoId, minutos(50)))!;
    expect(v).toMatchObject({ estado: "confirmada", cancelamento: null, pedidoCancelamentoEm: minutos(30) });
    expect(textoDoCancelamento(v, t)).toEqual({ linhas: [`Pedido de cancelamento recebido em 01/10 às 12:30 (horário de Brasília). ${t.cancelamentoPedidoRecebido}`], decisao: "", comoVolta: null });
    expect((await acoes(x.reservaId, minutos(50))).pedeAtencao).toBe(true);
    expect((await listarPagamentos(db, c.org, { atencao: true }, minutos(50))).map((p) => p.reservaId)).toContain(x.reservaId);
    expect(v.pedidoCancelamentoSemPolitica).toBe(false);
    // Pagamento sem a política aceita: o recibo não cita a política "que você aceitou".
    const y = await pagarEConfirmar(c, { entrada: "2026-11-25", saida: "2026-11-27", email: "y@example.com", semAceite: true });
    await pedir(c, y.reservaId, equipe, { recebidoEm: minutos(30), quando: minutos(40) });
    const vy = (await vista(y.cotacaoId, minutos(50)))!;
    expect(vy).toMatchObject({ estado: "confirmada", pedidoCancelamentoSemPolitica: true });
    expect(textoDoCancelamento(vy, t).linhas).toEqual(["Pedido de cancelamento recebido em 01/10 às 12:30 (horário de Brasília). A equipe confirma com você, por escrito, o valor da devolução."]);
  });

  it("o quadro do pagamento: as ações de cada caso do cancelamento", async () => {
    const equipe = await usuarioDeTeste(c);
    // Retida: a liberação vale; nada a devolver.
    const a = await pagarEConfirmar(c);
    await cancelar(c, a.reservaId, entradaPadrao({ recebidoEm: new Date("2026-10-10T10:00:00-03:00"), canal: "email" }), equipe, new Date("2026-10-10T11:00:00-03:00"));
    expect((await acoes(a.reservaId, new Date("2026-10-10T12:00:00-03:00"))).acoes).toMatchObject({ registrarLiberacao: true, devolver: false, devolucaoPorFora: false, confirmarDevolucaoVista: false, pararDevolucaoPedida: false });

    // Integral, devolução aceita ainda sem aparecer: nada a fazer além de conferir; com o aviso, a equipe confirma.
    c.provedor.respostaDevolucao = "pedida";
    const b = await pagarEConfirmar(c, { ...longe, email: "b@example.com" });
    await cancelar(c, b.reservaId, empresa(), equipe, minutos(60));
    expect((await acoes(b.reservaId, minutos(70))).acoes).toMatchObject({ conferir: true, registrarLiberacao: false, devolver: false, devolucaoPorFora: false, confirmarDevolucaoVista: false, registrarRecusaNoPainel: false, pararDevolucaoPedida: false });
    await db.update(pagamentos).set({ avisos: ["devolucao_sem_confirmacao"] }).where(eq(pagamentos.id, b.pagamentoId));
    expect((await acoes(b.reservaId, minutos(70))).acoes.confirmarDevolucaoVista).toBe(true);
    // Passado o prazo de leitura: parar a devolução pedida.
    await envelhecer(c, b.pagamentoId, 90);
    expect((await acoes(b.reservaId, minutos(70))).acoes).toMatchObject({ confirmarDevolucaoVista: true, pararDevolucaoPedida: true });

    // Pix com mais de 78 dias (recusada sem pedido): nada se pede; por fora e a recusa do painel, sim.
    c.provedor.respostaDevolucao = "confirmada";
    const d = await pagarEConfirmar(c, { entrada: "2026-11-25", saida: "2026-11-27", email: "d@example.com" });
    await envelhecer(c, d.pagamentoId, 80);
    await cancelar(c, d.reservaId, empresa(), equipe, minutos(60));
    expect((await acoes(d.reservaId, minutos(70))).acoes).toMatchObject({ devolver: false, devolucaoPorFora: true, registrarRecusaNoPainel: true, confirmarDevolucaoVista: false, registrarLiberacao: false });

    // Devolvida: a taxa que não voltou; depois, a correção.
    const e = await pagarEConfirmar(c, { entrada: "2026-11-28", saida: "2026-11-30", email: "e@example.com" });
    await cancelar(c, e.reservaId, empresa(), equipe, minutos(60));
    expect((await acoes(e.reservaId, minutos(70))).acoes).toMatchObject({ registrarTaxaPerdida: true, corrigirTaxaPerdida: false, registrarLiberacao: false });
    await registrarTaxaPerdida(db, c.org, e.pagamentoId, 1000, equipe, minutos(70));
    expect((await acoes(e.reservaId, minutos(71))).acoes).toMatchObject({ registrarTaxaPerdida: false, corrigirTaxaPerdida: true });
  });

  it("Início da operação: um aviso por pedido (atenção depois de 24 h ou perto da entrada), as datas a reabrir nas OTAs e a mensagem pendente ao hóspede; nada de valores", async () => {
    const equipe = await usuarioDeTeste(c);
    const x = await pagarEConfirmar(c, longe);
    await pedir(c, x.reservaId, equipe, { recebidoEm: minutos(30), quando: minutos(40) });
    const avisos = (q: Date) => avisosDeCancelamento(db, c.org, q, { env: env() });
    expect(await avisos(minutos(60))).toEqual([{ nivel: "info", texto: `Pedido de cancelamento da reserva ${x.reservaCodigo}: recebido em 01/10 às 12:30, entrada em 20/11 (há 0 dia(s)).`, link: "/painel/reservas?cancelamento=pedido" }]);
    expect((await avisos(minutos(30 + 24 * 60)))[0]).toMatchObject({ nivel: "atencao", texto: expect.stringContaining("(há 1 dia(s))") });
    // Perto da entrada (3 dias ou menos): atenção mesmo com o pedido novo.
    const y = await pagarEConfirmar(c, { email: "y@example.com" });
    await pedir(c, y.reservaId, equipe, { recebidoEm: new Date("2026-10-09T10:00:00-03:00"), quando: new Date("2026-10-09T10:05:00-03:00") });
    const perto = (await avisos(new Date("2026-10-09T11:00:00-03:00"))).find((a) => a.texto.includes(y.reservaCodigo));
    expect(perto?.nivel).toBe("atencao");
    // Cancelada: as datas a reabrir (envio ao Beds24 desligado) e a mensagem da decisão e da devolução.
    await cancelar(c, x.reservaId, entradaPadrao(), equipe, minutos(60));
    const depois = await avisos(minutos(70));
    // Com o código da reserva e o link para a ficha dela (a lista do mês esconde as canceladas).
    expect(depois).toContainEqual({ nivel: "info", texto: `1 reserva(s) do site cancelada(s) (${x.reservaCodigo}): reabra as datas nas OTAs (no Beds24, apague o bloqueio) enquanto o envio ao Beds24 estiver desligado.`, link: `/painel/reservas/${x.reservaId}` });
    expect(depois).toContainEqual({ nivel: "info", texto: `1 cancelamento(s) com mensagem ao hóspede pendente (decisão ou devolução feita): avise o hóspede (${x.reservaCodigo}).`, link: `/painel/reservas/${x.reservaId}` });
    // Quem não lê o financeiro não copia essas mensagens (levam o valor): o aviso delas não aparece para ele.
    expect((await avisosDeCancelamento(db, c.org, minutos(70), { env: env(), mensagensComValor: false })).some((a) => a.texto.includes("mensagem ao hóspede"))).toBe(false);
    expect((await avisos(minutos(70 + 24 * 60))).find((a) => a.texto.includes("mensagem ao hóspede"))?.nivel).toBe("atencao");
    expect(await marcarOtaLiberada(db, c.org, x.reservaId, equipe, minutos(80))).toEqual({ ok: true });
    expect(await marcarHospedeAvisado(db, c.org, x.reservaId, "decisao", equipe, minutos(80))).toEqual({ ok: true });
    // A devolução confirmada também pede a mensagem; depois dela, nada pendente.
    expect((await avisos(minutos(90))).some((a) => a.texto.includes("mensagem ao hóspede"))).toBe(true);
    expect(await marcarHospedeAvisado(db, c.org, x.reservaId, "devolucao", equipe, minutos(90))).toEqual({ ok: true });
    const fim = await avisos(minutos(100));
    expect(fim.some((a) => a.texto.includes("reabra as datas") || a.texto.includes("mensagem ao hóspede") || a.texto.includes(x.reservaCodigo))).toBe(false);
    for (const a of [...depois, ...fim]) expect(a.texto).not.toContain("R$");
  });

  it("cartão com mais de 78 dias: 'pedindo o estorno no cartão' só enquanto a devolução por fora do cartão não abre (recusa do painel registrada, 180 dias); contestado: em conferência", async () => {
    const equipe = await usuarioDeTeste(c);
    // A recusa do painel do Mercado Pago registrada: o estorno no cartão não sai mais; a equipe combina outra forma.
    const f = await pagarEConfirmar(c, { ...longe, forma: "cartao" });
    await envelhecer(c, f.pagamentoId, 80);
    await cancelar(c, f.reservaId, empresa(), equipe, minutos(60));
    expect((await texto(f.cotacaoId, minutos(70))).v).toMatchObject({ estado: "cancelada_devolucao_pedida", cancelamento: { estornoPelaEquipe: true } });
    expect(await registrarRecusaNoPainel(db, c.org, f.pagamentoId, { data: "2026-10-01", nota: "Painel recusou o estorno" }, equipe, minutos(75))).toEqual({ ok: true, situacao: "recusada" });
    const tf = await texto(f.cotacaoId, minutos(80));
    expect(tf.v).toMatchObject({ estado: "cancelada_com_a_equipe", cancelamento: { estornoPelaEquipe: false } });
    expect(tf.decisao).toContain(t.cancelamentoComAEquipe);
    expect(tf.decisao).not.toContain(t.cancelamentoEstornoNoCartao);
    // O quadro do pagamento diz que a recusa foi a do painel (não "três vezes").
    expect((await acoes(f.reservaId, minutos(80))).avisos).toContain(TEXTO_RECUSA_NO_PAINEL);

    // Cartão com mais de 180 dias: o Mercado Pago não estorna mais; com a equipe desde o cancelamento.
    const g = await pagarEConfirmar(c, { entrada: "2026-11-25", saida: "2026-11-27", email: "g@example.com", forma: "cartao" });
    await envelhecer(c, g.pagamentoId, 185);
    await cancelar(c, g.reservaId, empresa(), equipe, minutos(60));
    const tg = await texto(g.cotacaoId, minutos(70));
    expect(tg.v).toMatchObject({ estado: "cancelada_com_a_equipe", cancelamento: { estornoPelaEquipe: false, forma: "cartao" } });
    expect(tg.decisao).not.toContain(t.cancelamentoEstornoNoCartao);

    // Contestado depois do cancelamento, com a devolução ainda pedida: em conferência, sem oferecer outra forma.
    c.provedor.respostaDevolucao = "pedida";
    const h = await pagarEConfirmar(c, { entrada: "2026-11-28", saida: "2026-11-30", email: "h@example.com" });
    await cancelar(c, h.reservaId, empresa(), equipe, minutos(60));
    expect((await texto(h.cotacaoId, minutos(70))).v.estado).toBe("cancelada_devolucao_pedida");
    await db.update(pagamentos).set({ situacao: "contestado" }).where(eq(pagamentos.id, h.pagamentoId));
    const th = await texto(h.cotacaoId, minutos(70));
    expect(th.v.estado).toBe("cancelada_em_conferencia");
    expect(th.decisao).toContain(t.cancelamentoEmConferencia);
    expect(th.decisao).not.toContain(t.cancelamentoComAEquipe);
  });

  it("Início do financeiro: a devolução de pagamento com mais de 78 dias (nunca pedida) conta à parte da recusada pelo Mercado Pago; a solta pela leitura tem o texto dela no quadro", async () => {
    const equipe = await usuarioDeTeste(c);
    const x = await pagarEConfirmar(c, longe);
    await envelhecer(c, x.pagamentoId, 80);
    await cancelar(c, x.reservaId, empresa(), equipe, minutos(60));
    const antes = await avisosDePagamento(db, c.org, minutos(70), { env: env() });
    expect(antes.contagens).toMatchObject({ devolucaoForaDoPrazo: 1, devolucaoRecusada: 0 });
    const textos = antes.alertas.map((a) => a.texto);
    expect(textos).toContain("1 devolução(ões) de pagamento(s) com mais de 78 dias, que o sistema não pede mais ao Mercado Pago: no cartão, devolva pelo painel do Mercado Pago; no Pix, faça a devolução por fora.");
    expect(textos.join("\n")).not.toContain("recusou ou não respondeu três vezes");
    // A nossa devolução aceita e depois falha na leitura: recusada pelo Mercado Pago (conta como recusada), com o texto dela.
    c.provedor.respostaDevolucao = "pedida";
    const y = await pagarEConfirmar(c, { entrada: "2026-11-25", saida: "2026-11-27", email: "y@example.com", forma: "cartao" });
    await cancelar(c, y.reservaId, empresa(), equipe, minutos(60));
    const idDevolucao = (await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.pagamentoId, y.pagamentoId)))[0].idProvedor!;
    c.provedor.falharDevolucao(idDevolucao);
    await conferir(y.pagamentoId, minutos(70));
    const depois = await avisosDePagamento(db, c.org, minutos(80), { env: env() });
    expect(depois.contagens).toMatchObject({ devolucaoForaDoPrazo: 1, devolucaoRecusada: 1 });
    expect((await acoes(y.reservaId, minutos(80))).avisos).toContain(TEXTO_DEVOLUCAO_FALHOU_NA_LEITURA);
    // A recusa do painel registrada na de mais de 78 dias: passa a contar como recusada pelo Mercado Pago.
    expect(await registrarRecusaNoPainel(db, c.org, x.pagamentoId, { data: "2026-10-01", nota: "Painel recusou" }, equipe, minutos(85))).toMatchObject({ ok: true });
    expect((await avisosDePagamento(db, c.org, minutos(90), { env: env() })).contagens).toMatchObject({ devolucaoForaDoPrazo: 0, devolucaoRecusada: 2 });
  });

  it("Início da operação: com mais de uma reserva, os códigos no texto e o link para a lista das canceladas de todo o histórico", async () => {
    const equipe = await usuarioDeTeste(c);
    const x = await pagarEConfirmar(c, longe);
    const y = await pagarEConfirmar(c, { entrada: "2026-11-25", saida: "2026-11-27", email: "y@example.com" });
    await cancelar(c, x.reservaId, empresa(), equipe, minutos(60));
    await cancelar(c, y.reservaId, empresa(), equipe, minutos(60));
    const ota = (await avisosDeCancelamento(db, c.org, minutos(70), { env: env() })).find((a) => a.texto.includes("reabra as datas"));
    expect(ota?.texto).toContain(`(${[x.reservaCodigo, y.reservaCodigo].sort().join(", ")})`);
    expect(ota?.link).toBe("/painel/reservas?situacao=cancelada&escopo=historico");
  });

  it("Início da operação: com o envio automático ao Beds24 ligado, 'reabra as datas nas OTAs' não aparece (o envio cuida); o resto continua", async () => {
    const equipe = await usuarioDeTeste(c);
    const x = await pagarEConfirmar(c, longe);
    await cancelar(c, x.reservaId, empresa(), equipe, minutos(60));
    // Credencial fictícia: nada é chamado (só a regra "o envio está ligado" é conferida).
    const ligado = env({ BEDS24_ESCRITA: "ligada", BEDS24_REFRESH_TOKEN: "refresh-ficticio" });
    const textos = async (e: NodeJS.ProcessEnv) => (await avisosDeCancelamento(db, c.org, minutos(70), { env: e })).map((a) => a.texto).join("\n");
    // Escrita ligada no ambiente, mas o envio automático desligado no painel: o aviso continua.
    expect(await textos(ligado)).toContain("reabra as datas nas OTAs");
    const regras = await lerRegrasCalendario(db, c.org);
    await salvarRegrasCalendario(db, c.org, { ...regras, envio: { ...regras.envio, automatico: true } }, null);
    const comEnvio = await textos(ligado);
    expect(comEnvio).not.toContain("reabra as datas nas OTAs");
    expect(comEnvio).toContain("mensagem ao hóspede pendente");
    // Sem a escrita ligada no ambiente, o envio marcado não basta: o aviso volta.
    expect(await textos(env())).toContain("reabra as datas nas OTAs");
  });

  it("Início do financeiro: devolvida a menos e reserva devolvida no Mercado Pago fora do cancelamento (D21) contam e avisam", async () => {
    const equipe = await usuarioDeTeste(c);
    c.provedor.devolverAMenos(5000);
    const x = await pagarEConfirmar(c, longe);
    await cancelar(c, x.reservaId, empresa(), equipe, minutos(60));
    const y = await pagarEConfirmar(c, { email: "y@example.com" });
    c.provedor.devolverNoProvedor(y.idProvedor, TOTAL);
    await conferir(y.pagamentoId, minutos(70));
    const { alertas, contagens } = await avisosDePagamento(db, c.org, minutos(80), { env: env() });
    expect(contagens).toMatchObject({ devolucaoAMenor: 1, reservaDevolvidaNoProvedor: 1 });
    expect(alertas.map((a) => a.texto)).toEqual(
      expect.arrayContaining([
        "1 devolução(ões) de cancelamento que o Mercado Pago fez a menos do que o pedido: confira no painel do Mercado Pago.",
        "1 reserva(s) paga(s) pelo site que o Mercado Pago mostra devolvida(s) fora do sistema: a parte do proprietário ficou em conferência. Cancele pela política ou registre um ajuste.",
      ]),
    );
    // O quadro mostra o aviso com os dois valores.
    expect((await acoes(x.reservaId, minutos(80))).avisos).toContainEqual(expect.stringContaining("R$ 50,00"));
  });
});
