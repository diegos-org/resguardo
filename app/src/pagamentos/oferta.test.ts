import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG_PAGAMENTO_SITE_PADRAO, salvarConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import { encerrarContrato, listarContratos } from "@/contratos/repositorio";
import { beds24Calendario, bloqueios, cotacoes, imoveis, organizacoes, proprietarioImoveis, recebimentoPorCanal, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { pendenciaDoCalculo } from "@/financeiro/motor";
import { CONFLITO_AGENDA_EXTERNA, noitesLivres } from "@/site/disponibilidade";
import { expirarHoldsVencidos } from "@/site/cotacoes";
import { esquecerProvedorDoAmbiente } from "./ambiente";
import { ProvedorFalso } from "./falso";
import { ClienteMercadoPagoHttp } from "./mercadopago";
import { chavePublicaValida, motivosPorImovel, ofertaDePix, podeCobrar, provedorDeConferencia, TEXTO_SEM_COBRANCA, TEXTO_SEM_PIX } from "./oferta";
import { AGORA, type Cenario, CHAVE_PUBLICA_FICTICIA, env, minutos, montarCenario } from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => { c = await montarCenario(db); });

const CHAVES = { MERCADOPAGO_ACCESS_TOKEN: "APP_USR-teste-ficticio", MERCADOPAGO_PUBLIC_KEY: "APP_USR-publica-ficticia" };

describe("podeCobrar: a função única das travas (M8.2a)", () => {
  it("fora do teste não cobra: chaves faltando, valor inválido, produção travada, deploy de produção (só nas prévias)", async () => {
    esquecerProvedorDoAmbiente();
    expect(await podeCobrar(db, c.org, env())).toMatchObject({ ok: false, motivo: "desligado" });
    expect(await podeCobrar(db, c.org, env({ ...CHAVES, MERCADOPAGO_AMBIENTE: "production" }))).toMatchObject({ ok: false, motivo: "configuracao_invalida" });
    expect(await podeCobrar(db, c.org, env({ ...CHAVES, MERCADOPAGO_AMBIENTE: "producao" }))).toMatchObject({ ok: false, motivo: "producao_travada" });
    expect(await podeCobrar(db, c.org, env({ ...CHAVES, MERCADOPAGO_AMBIENTE: "teste", VERCEL_ENV: "production" }))).toMatchObject({ ok: false, motivo: "so_nas_previas", texto: TEXTO_SEM_COBRANCA.so_nas_previas });
    expect(await provedorDeConferencia(env({ ...CHAVES, VERCEL_ENV: "production" }))).toMatchObject({ ok: false, motivo: "so_nas_previas" });
  });

  it("conta das chaves: só a conta comprovadamente de teste cobra (falsa ou sem resposta = não); a chave do painel desliga a oferta, não a conferência", async () => {
    const falsa = new ProvedorFalso(() => AGORA);
    expect(await podeCobrar(db, c.org, env(), AGORA, { provedor: falsa })).toMatchObject({ ok: true, ambiente: "teste", provedor: falsa });
    const real = new ProvedorFalso(() => AGORA);
    real.contaDeTeste = false;
    expect(await podeCobrar(db, c.org, env(), AGORA, { provedor: real })).toMatchObject({ ok: false, motivo: "conta_nao_teste" });
    const muda = new ProvedorFalso(() => AGORA);
    muda.contaDeTeste = null;
    expect(await podeCobrar(db, c.org, env(), AGORA, { provedor: muda })).toMatchObject({ ok: false, motivo: "conta_nao_conferida" });
    expect(await provedorDeConferencia(env(), AGORA, { provedor: real })).toMatchObject({ ok: false, motivo: "conta_nao_teste" });
    await salvarConfigPagamentoSite(db, c.org, { ...CONFIG_PAGAMENTO_SITE_PADRAO, oferecer: false }, null);
    const outra = new ProvedorFalso(() => AGORA);
    expect(await podeCobrar(db, c.org, env(), AGORA, { provedor: outra })).toMatchObject({ ok: false, motivo: "desligado_no_painel" });
    // Com a oferta desligada nem se pergunta a conta ao provedor; a conferência continua liberada.
    expect(outra.chamadas.filter((x) => x.metodo === "conferirContaDeTeste")).toHaveLength(0);
    expect(await provedorDeConferencia(env(), AGORA, { provedor: outra })).toMatchObject({ ok: true });
  });

  it("deny-by-default: uma empresa que nunca salvou a aba Pagamento no site não cobra (a oferta começa desligada)", async () => {
    const [{ id: nova }] = await db.insert(organizacoes).values({ nome: "Outra Exemplo" }).returning();
    const falsa = new ProvedorFalso(() => AGORA);
    expect(await podeCobrar(db, nova, env(), AGORA, { provedor: falsa })).toMatchObject({ ok: false, motivo: "desligado_no_painel", texto: TEXTO_SEM_COBRANCA.desligado_no_painel });
    expect(falsa.chamadas).toEqual([]);
  });

  it("páginas legais (M7.4): sem as três publicadas não cobra, nem pergunta a conta ao provedor; a chave do painel vem antes; conferir não depende delas", async () => {
    const s = await montarCenario(db, { semPaginasLegais: true });
    const falsa = new ProvedorFalso(() => AGORA);
    expect(await podeCobrar(db, s.org, env(), AGORA, { provedor: falsa })).toEqual({ ok: false, motivo: "sem_paginas_legais", texto: TEXTO_SEM_COBRANCA.sem_paginas_legais });
    expect(falsa.chamadas).toEqual([]);
    expect(TEXTO_SEM_PIX.sem_paginas_legais).toBe(TEXTO_SEM_COBRANCA.sem_paginas_legais);
    const h = await s.segurar();
    expect(await ofertaDePix(db, s.org, h.cotacaoId, AGORA, s.gate)).toEqual({ oferecer: false, motivo: "sem_paginas_legais" });
    // Conferir, cancelar e devolver o que já foi cobrado nunca dependem das páginas legais.
    expect(await provedorDeConferencia(env(), AGORA, { provedor: falsa })).toMatchObject({ ok: true });
    // Oferta desligada no painel: esse é o motivo, mesmo sem as páginas.
    await salvarConfigPagamentoSite(db, s.org, { ...CONFIG_PAGAMENTO_SITE_PADRAO, oferecer: false }, null);
    expect(await podeCobrar(db, s.org, env(), AGORA, { provedor: falsa })).toMatchObject({ ok: false, motivo: "desligado_no_painel" });
  });
});

describe("chave pública no portão (M8.2b)", () => {
  it("o portão aberto leva a chave pública do formulário do cartão; formato estranho ou ausente = null (o Pix não depende dela)", async () => {
    expect(c.gate).toMatchObject({ ok: true, chavePublica: CHAVE_PUBLICA_FICTICIA });
    const falsa = new ProvedorFalso(() => AGORA);
    expect(await podeCobrar(db, c.org, env(), AGORA, { provedor: falsa })).toMatchObject({ ok: true, chavePublica: null });
    expect(await podeCobrar(db, c.org, env(), AGORA, { provedor: falsa, chavePublica: "curta" })).toMatchObject({ ok: true, chavePublica: null });
    expect(await provedorDeConferencia(env(), AGORA, { provedor: falsa, chavePublica: CHAVE_PUBLICA_FICTICIA })).toMatchObject({ ok: true, chavePublica: CHAVE_PUBLICA_FICTICIA });
    for (const ok of ["TEST-0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0", "APP_USR-ficticia-0000-0000-0000-000000000000"]) expect(chavePublicaValida(ok)).toBe(true);
    for (const ruim of ["", "curta", "TEST chave com espaço", "TEST-<script>alert(1)</script>", "x".repeat(201), null, 42]) expect(chavePublicaValida(ruim)).toBe(false);
  });

  it("pelo ambiente: a chave pública vem de MERCADOPAGO_PUBLIC_KEY, só no formato esperado (a conta é conferida sem rede neste teste)", async () => {
    esquecerProvedorDoAmbiente();
    const conta = vi.spyOn(ClienteMercadoPagoHttp.prototype, "conferirContaDeTeste").mockResolvedValue(true);
    try {
      const publica = "TEST-0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
      const chaves = { MERCADOPAGO_ACCESS_TOKEN: "TEST-token-ficticio-0000", MERCADOPAGO_AMBIENTE: "teste", NODE_ENV: "test" };
      expect(await podeCobrar(db, c.org, env({ ...chaves, MERCADOPAGO_PUBLIC_KEY: publica }), AGORA)).toMatchObject({ ok: true, chavePublica: publica });
      expect(await provedorDeConferencia(env({ ...chaves, MERCADOPAGO_PUBLIC_KEY: publica }), AGORA)).toMatchObject({ ok: true, chavePublica: publica });
      // Legível para o ambiente (sem espaço), mas fora do formato de chave pública: o Pix segue, o cartão não tem chave.
      expect(await podeCobrar(db, c.org, env({ ...chaves, MERCADOPAGO_PUBLIC_KEY: "TEST.chave+estranha/0000" }), AGORA)).toMatchObject({ ok: true, chavePublica: null });
      expect(conta).toHaveBeenCalled();
    } finally {
      conta.mockRestore();
      esquecerProvedorDoAmbiente();
    }
  });
});

describe("quando o site oferece o Pix (M8.2a)", () => {
  it("cotação segurada, disponível e o motor em seco fecha: oferece; cada motivo do contrário", async () => {
    const s = await c.segurar();
    expect(await ofertaDePix(db, c.org, s.cotacaoId, AGORA, c.gate)).toEqual({ oferecer: true });
    expect(await ofertaDePix(db, c.org, s.cotacaoId, AGORA, { ok: false, motivo: "conta_nao_teste", texto: "" })).toEqual({ oferecer: false, motivo: "conta_nao_teste" });
    expect(await ofertaDePix(db, c.org, s.cotacaoId, minutos(31), c.gate)).toEqual({ oferecer: false, motivo: "prazo_vencido" });
    expect(await ofertaDePix(db, c.org, "x", AGORA, c.gate)).toEqual({ oferecer: false, motivo: "cotacao_nao_encontrada" });
    await db.update(cotacoes).set({ situacao: "a_confirmar" }).where(eq(cotacoes.id, s.cotacaoId));
    expect(await ofertaDePix(db, c.org, s.cotacaoId, AGORA, c.gate)).toEqual({ oferecer: false, motivo: "a_confirmar" });
    await db.update(cotacoes).set({ situacao: "disponivel" }).where(eq(cotacoes.id, s.cotacaoId));
    // Quem recebe do site no imóvel ≠ empresa.
    await db.insert(recebimentoPorCanal).values({ organizacaoId: c.org, imovelId: c.imovel, origem: "site", recebimento: "split" });
    expect(await ofertaDePix(db, c.org, s.cotacaoId, AGORA, c.gate)).toEqual({ oferecer: false, motivo: "recebimento_nao_empresa" });
    await db.delete(recebimentoPorCanal).where(eq(recebimentoPorCanal.imovelId, c.imovel));
    // Sem dono (o banco não aceita dois donos por imóvel; "vários" está no teste puro abaixo).
    await db.delete(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, c.imovel));
    expect(await ofertaDePix(db, c.org, s.cotacaoId, AGORA, c.gate)).toEqual({ oferecer: false, motivo: "sem_proprietario" });
    await db.insert(proprietarioImoveis).values({ proprietarioId: c.dono, imovelId: c.imovel });
    // Contrato encerrado antes da entrada: sem contrato vigente NA ENTRADA.
    const [contrato] = await listarContratos(db, c.org, c.imovel);
    expect((await encerrarContrato(db, c.org, contrato.id, "2026-10-11", null)).ok).toBe(true);
    expect(await ofertaDePix(db, c.org, s.cotacaoId, AGORA, c.gate)).toEqual({ oferecer: false, motivo: "sem_contrato" });
    // Imóvel fora do site.
    await db.update(imoveis).set({ publico: false }).where(eq(imoveis.id, c.imovel));
    expect(await ofertaDePix(db, c.org, s.cotacaoId, AGORA, c.gate)).toEqual({ oferecer: false, motivo: "imovel_fora_do_site" });
    // Pedido já confirmado: não segura mais.
    await db.update(reservas).set({ estado: "confirmada" }).where(eq(reservas.id, s.reservaId));
    expect(await ofertaDePix(db, c.org, s.cotacaoId, AGORA, c.gate)).toEqual({ oferecer: false, motivo: "nao_segurada" });
    for (const m of ["sem_contrato", "marketplace", "nao_segurada", "desligado_no_painel"] as const) expect(TEXTO_SEM_PIX[m]).toBeTruthy();
  });

  it("marketplace e cálculo puro: pendenciaDoCalculo lê o contrato da ENTRADA", () => {
    const r = { id: "r", codigo: "SCL-X", imovelId: "i", origem: "site" as const, estado: "pedido" as const, checkin: "2026-10-12", checkout: "2026-10-15", valorBruto: 100000, taxaCanal: null, recebimento: null };
    const gestao = { tipo: "gestao_completa" as const, comissaoBp: 1500, inicio: "2025-01-01", fim: null };
    expect(pendenciaDoCalculo(r, [gestao], ["d"])).toBeNull();
    expect(pendenciaDoCalculo(r, [{ ...gestao, tipo: "marketplace", comissaoBp: null }], ["d"])).toBe("marketplace");
    expect(pendenciaDoCalculo(r, [{ ...gestao, fim: "2026-10-11" }], ["d"])).toBe("sem_contrato");
    expect(pendenciaDoCalculo(r, [{ ...gestao, inicio: "2026-10-13" }], ["d"])).toBe("sem_contrato");
    expect(pendenciaDoCalculo({ ...r, valorBruto: null }, [gestao], ["d"])).toBe("sem_valor");
    expect(pendenciaDoCalculo(r, [gestao], [])).toBe("sem_proprietario");
    expect(pendenciaDoCalculo(r, [gestao], ["d", "e"])).toBe("varios_proprietarios");
    expect(pendenciaDoCalculo(r, [gestao], ["d"], { base: "liquido_canal", recebimento: { airbnb: "split", booking: "empresa", site: "a_confirmar", direta: "empresa", outro: "empresa" } })).toBe("recebimento_nao_empresa");
  });

  it("lista do painel: cada imóvel do site com ✓ ou o motivo", async () => {
    const [{ id: outro }] = await db.insert(imoveis).values({ organizacaoId: c.org, codigo: "102", nome: "Outro Exemplo", publico: true, capacidade: 2 }).returning();
    await db.insert(imoveis).values({ organizacaoId: c.org, codigo: "buzios", nome: "Fora do site", publico: false });
    const lista = await motivosPorImovel(db, c.org, AGORA);
    expect(lista.map((x) => [x.codigo, x.oferece, x.motivo])).toEqual([["102", false, "sem_contrato"], ["403", true, null]]);
    expect(lista[0].texto).toContain("contrato");
    expect(outro).toBeTruthy();
  });
});

describe("noitesLivres: só ocupação (M8.2a)", () => {
  it("exclui a própria reserva; reserva, bloqueio ou pedido ainda valendo ocupam; pedido vencido não; com leitura exigida, sem leitura atual = não dá para conferir", async () => {
    const s = await c.segurar();
    const livres = (o: Parameters<typeof noitesLivres>[5] = {}) => noitesLivres(db, c.org, c.imovel, "2026-10-12", "2026-10-15", { agora: AGORA, ...o });
    expect(await livres()).toEqual({ livres: false, motivo: "ocupada", conflito: (await c.reserva(s.reservaId)).codigo });
    expect(await livres({ excetoReservaId: s.reservaId })).toEqual({ livres: true });
    expect(await livres({ excetoReservaId: s.reservaId, exigirLeituraAtual: true })).toEqual({ livres: true });
    // Pedido do site vencido (sem pagamento): não ocupa, mesmo antes da rotina passar.
    expect(await noitesLivres(db, c.org, c.imovel, "2026-10-12", "2026-10-15", { agora: minutos(31) })).toEqual({ livres: true });
    // Regras de venda e preço não contam: mínimo de noites, por exemplo, não muda nada aqui.
    await db.insert(bloqueios).values({ organizacaoId: c.org, imovelId: c.imovel, inicio: "2026-10-14", fim: "2026-10-15", motivo: "" });
    expect(await livres({ excetoReservaId: s.reservaId })).toEqual({ livres: false, motivo: "ocupada", conflito: "bloqueio" });
    await db.delete(bloqueios).where(eq(bloqueios.imovelId, c.imovel));
    // Leitura do Beds24 que fecha a noite, e leitura que falta.
    await db.update(beds24Calendario).set({ livres: 0 }).where(and(eq(beds24Calendario.imovelId, c.imovel), eq(beds24Calendario.data, "2026-10-13")));
    expect(await livres({ excetoReservaId: s.reservaId })).toEqual({ livres: true });
    expect(await livres({ excetoReservaId: s.reservaId, exigirLeituraAtual: true })).toEqual({ livres: false, motivo: "ocupada", conflito: CONFLITO_AGENDA_EXTERNA });
    await db.delete(beds24Calendario).where(and(eq(beds24Calendario.imovelId, c.imovel), eq(beds24Calendario.data, "2026-10-13")));
    expect(await livres({ excetoReservaId: s.reservaId, exigirLeituraAtual: true })).toEqual({ livres: false, motivo: "sem_leitura", conflito: null });
    // Leitura velha (fora da validade) também não serve.
    expect(await noitesLivres(db, c.org, c.imovel, "2026-10-20", "2026-10-22", { agora: new Date("2026-10-05T15:00:00Z"), exigirLeituraAtual: true })).toEqual({ livres: false, motivo: "sem_leitura", conflito: null });
    await expirarHoldsVencidos(db, c.org, minutos(31));
  });
});
