import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcessoNegado, type Sessao } from "@/acesso/politica";
import { historicoDe } from "@/auditoria/auditoria";
import { REGRAS_CALENDARIO_PADRAO, salvarRegrasCalendario } from "@/calendario/regras-config";
import { criarContrato, listarContratos } from "@/contratos/repositorio";
import { beds24Envios, beds24EnvioNoites, imoveis, limpezas, manutencoes, organizacoes, profissionaisLimpeza, proprietarioImoveis, proprietarios, proprietarioUsuarios, reservas, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { DETALHES_VAZIOS, entradaDeDetalhes, lerDetalhes, listarPeriodos, salvarDetalhes, validarDetalhes } from "@/imoveis/detalhes";
import { reabrirLimpeza } from "@/limpezas/limpezas";
import { lancarCusto, listarManutencoes } from "@/manutencao/manutencao";
import {
  ANTES_DA_POSSE,
  criarPeriodoPeloProprietario,
  excluirPeriodoPeloProprietario,
  imoveisMarketplaceDaSessao,
  limpezasDoProprietario,
  manutencoesDoProprietario,
  marcarLimpezaFeitaPeloProprietario,
  NAO_MARKETPLACE,
  registrarManutencaoPeloProprietario,
  salvarPrecosPeloProprietario,
  situacaoDoEnvio,
} from "./marketplace";

// A leitura dos contratos é espiada para simular o contrato acabando entre a conferência inicial e a gravação.
vi.mock("@/contratos/repositorio", async (orig) => {
  const m = await orig<typeof import("@/contratos/repositorio")>();
  return { ...m, listarContratos: vi.fn(m.listarContratos) };
});

let db: Db, close: () => Promise<void>, org: string, a: string, b: string, c: string, d: string, usuario: string, dona: string, outro: string;
// 3/10/2026, 12:00 em São Paulo.
const agora = new Date("2026-10-03T15:00:00Z");
const desdeSempre = new Date("2025-01-01T12:00:00Z");
const sessao = (imovelIds = [a, b, d]): Sessao => ({ usuarioId: usuario, organizacaoId: org, papel: "proprietario", imovelIds });

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "A" }).returning();
  // a: marketplace da dona; b: gestão completa da dona; c: marketplace de outro dono; d: da dona, sem contrato.
  [{ id: a }, { id: b }, { id: c }, { id: d }] = await db
    .insert(imoveis)
    .values([
      { organizacaoId: org, codigo: "403", nome: "Quatro" },
      { organizacaoId: org, codigo: "102", nome: "Um" },
      { organizacaoId: org, codigo: "303", nome: "Três" },
      { organizacaoId: org, codigo: "103", nome: "Boutique" },
    ])
    .returning();
  [{ id: dona }, { id: outro }] = await db.insert(proprietarios).values([{ organizacaoId: org, nome: "Dona" }, { organizacaoId: org, nome: "Outro" }]).returning();
  // Vínculos antigos (data explícita): o que é anterior ao vínculo não é do dono atual.
  await db.insert(proprietarioImoveis).values([{ proprietarioId: dona, imovelId: a, criadoEm: desdeSempre }, { proprietarioId: dona, imovelId: b, criadoEm: desdeSempre }, { proprietarioId: outro, imovelId: c, criadoEm: desdeSempre }, { proprietarioId: dona, imovelId: d, criadoEm: desdeSempre }]);
  [{ id: usuario }] = await db.insert(usuarios).values({ organizacaoId: org, email: "dona@example.com", nome: "Dona", papel: "proprietario" }).returning();
  await db.insert(proprietarioUsuarios).values({ proprietarioId: dona, usuarioId: usuario });
  await criarContrato(db, org, a, { tipo: "marketplace", comissao: "", inicio: "2025-01-01" }, null);
  await criarContrato(db, org, b, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
  await criarContrato(db, org, c, { tipo: "marketplace", comissao: "", inicio: "2025-01-01" }, null);
  await salvarDetalhes(db, org, a, { ...DETALHES_VAZIOS, precoBase: 30000, regrasCasa: "Sem festas.", comodidades: ["Wi-Fi", "Varanda da vovó"], camas: { queen: 1 } }, null, agora);
});
afterEach(() => close());

describe("portal do proprietário marketplace (M12.4)", () => {
  it("entradaDeDetalhes é o inverso de validarDetalhes (ida e volta sem perder nada)", async () => {
    const d = await lerDetalhes(db, org, a);
    const v = validarDetalhes(entradaDeDetalhes(d));
    expect(v.ok).toBe(true);
    expect(v.ok && v.dados).toEqual(d);
    const cheio = { ...d, cep: "22440-000", estado: "RJ", aceitaAnimais: true, precoDinamico: true, precoMinimo: 20000, precoMaximo: 90000, diasChegada: [1, 5], diasSaida: [0], taxaLimpeza: 15000, hospedeExtraValor: 5000, hospedeExtraAPartirDe: 3, pisoUltimaHora1: 25000, pisoUltimaHora2: 22000, fontePrecos: "manual" as const };
    const v2 = validarDetalhes(entradaDeDetalhes(cheio));
    expect(v2.ok && v2.dados).toEqual(cheio);
  });

  it("lista só os imóveis da sessão em contrato marketplace hoje, com cadastro, períodos e situação do envio", async () => {
    const lista = await imoveisMarketplaceDaSessao(db, sessao(), agora);
    expect(lista.map((i) => i.codigo)).toEqual(["403"]);
    expect(lista[0]).toMatchObject({ fontePrecos: "scl", posseDesde: "2025-01-01", detalhes: { precoBase: 30000 }, periodos: [], envio: { naLista: false, automatico: false, ultimo: null } });
    // Contrato marketplace que só começa no futuro ainda não libera.
    await criarContrato(db, org, d, { tipo: "marketplace", comissao: "", inicio: "2027-01-01" }, null);
    expect((await imoveisMarketplaceDaSessao(db, sessao(), agora)).map((i) => i.codigo)).toEqual(["403"]);
    // Outro papel não vê nada por aqui.
    expect(await imoveisMarketplaceDaSessao(db, { ...sessao(), papel: "admin" }, agora)).toEqual([]);
  });

  it("salva preço, taxas, regras e horários pela validação do painel, preservando o resto do cadastro, com histórico do proprietário", async () => {
    const r = await salvarPrecosPeloProprietario(db, sessao(), a, { precoBase: "350,00", taxaLimpeza: "150,00", hospedeExtraValor: "50,00", hospedeExtraAPartirDe: "3", estadiaMinima: "2", estadiaMaxima: "10", antecedenciaMinima: "1", janelaMaxima: "365", diasChegada: ["1", "5"], checkinAPartirDe: "14:00", checkoutAte: "11:00" }, agora);
    expect(r).toEqual({ ok: true });
    const d = await lerDetalhes(db, org, a);
    expect(d).toMatchObject({ precoBase: 35000, taxaLimpeza: 15000, hospedeExtraValor: 5000, hospedeExtraAPartirDe: 3, estadiaMinima: 2, estadiaMaxima: 10, antecedenciaMinima: 1, janelaMaxima: 365, diasChegada: [1, 5], diasSaida: [], checkinAPartirDe: "14:00" });
    // O que o portal não edita fica como estava.
    expect(d).toMatchObject({ regrasCasa: "Sem festas.", comodidades: ["Wi-Fi", "Varanda da vovó"], camas: { queen: 1 }, fontePrecos: "scl" });
    const h = await historicoDe(db, org, "imovel", a);
    expect(h.some((x) => x.acao === "imovel.detalhes")).toBe(true);
    // Campo omitido vira "em branco" (não cadastrado), nunca um palpite; dias omitidos = qualquer dia.
    expect(await salvarPrecosPeloProprietario(db, sessao(), a, { precoBase: "350,00" }, agora)).toEqual({ ok: true });
    expect(await lerDetalhes(db, org, a)).toMatchObject({ precoBase: 35000, taxaLimpeza: null, estadiaMinima: null, diasChegada: [] });
  });

  it("erros de validação voltam por campo; imóvel fora do marketplace ou fora da sessão não passa", async () => {
    expect(await salvarPrecosPeloProprietario(db, sessao(), a, { precoBase: "abc" }, agora)).toMatchObject({ ok: false, erros: { precoBase: expect.stringContaining("inválido") } });
    expect(await salvarPrecosPeloProprietario(db, sessao(), a, { estadiaMinima: "5", estadiaMaxima: "2" }, agora)).toMatchObject({ ok: false, erros: { estadiaMaxima: expect.any(String) } });
    expect(await lerDetalhes(db, org, a)).toMatchObject({ precoBase: 30000 });
    expect(await salvarPrecosPeloProprietario(db, sessao(), b, { precoBase: "100,00" }, agora)).toEqual({ ok: false, erro: NAO_MARKETPLACE });
    expect(await salvarPrecosPeloProprietario(db, sessao(), d, { precoBase: "100,00" }, agora)).toEqual({ ok: false, erro: NAO_MARKETPLACE });
    await expect(salvarPrecosPeloProprietario(db, sessao(), c, { precoBase: "100,00" }, agora)).rejects.toBeInstanceOf(AcessoNegado);
    // Profissional de limpeza ou hóspede nunca operam o marketplace.
    await expect(salvarPrecosPeloProprietario(db, { ...sessao(), papel: "limpeza" }, a, { precoBase: "100,00" }, agora)).rejects.toBeInstanceOf(AcessoNegado);
  });

  it("com os preços definidos no Beds24, o preço da noite não é editado aqui (regras e taxas, sim); período só com estadia mínima", async () => {
    await salvarDetalhes(db, org, a, { ...(await lerDetalhes(db, org, a)), fontePrecos: "beds24" }, null, agora);
    expect(await salvarPrecosPeloProprietario(db, sessao(), a, { precoBase: "350,00", estadiaMinima: "2" }, agora)).toMatchObject({ ok: false, erros: { precoBase: expect.stringContaining("Beds24") } });
    expect(await salvarPrecosPeloProprietario(db, sessao(), a, { precoBase: "300,00", estadiaMinima: "2", taxaLimpeza: "120,00" }, agora)).toEqual({ ok: true });
    expect(await lerDetalhes(db, org, a)).toMatchObject({ precoBase: 30000, estadiaMinima: 2, taxaLimpeza: 12000, fontePrecos: "beds24" });
    expect(await criarPeriodoPeloProprietario(db, sessao(), a, { nome: "Réveillon", inicio: "2026-12-28", fim: "2027-01-02", precoNoite: "900,00", estadiaMinima: "" }, agora)).toMatchObject({ ok: false, erro: expect.stringContaining("Beds24") });
    expect(await criarPeriodoPeloProprietario(db, sessao(), a, { nome: "Réveillon", inicio: "2026-12-28", fim: "2027-01-02", precoNoite: "", estadiaMinima: "5" }, agora)).toEqual({ ok: true });
  });

  it("períodos: cria e exclui só nos próprios imóveis marketplace", async () => {
    expect(await criarPeriodoPeloProprietario(db, sessao(), a, { nome: "Carnaval", inicio: "2027-02-12", fim: "2027-02-17", precoNoite: "800,00", estadiaMinima: "4" }, agora)).toEqual({ ok: true });
    expect(await criarPeriodoPeloProprietario(db, sessao(), a, { nome: "", inicio: "2027-02-12", fim: "2027-02-17", precoNoite: "800,00" }, agora)).toMatchObject({ ok: false, erro: expect.stringContaining("nome") });
    expect(await criarPeriodoPeloProprietario(db, sessao(), b, { nome: "X", inicio: "2027-02-12", fim: "2027-02-17", precoNoite: "800,00" }, agora)).toEqual({ ok: false, erro: NAO_MARKETPLACE });
    const [p] = await listarPeriodos(db, org, a);
    expect(p).toMatchObject({ nome: "Carnaval", precoNoite: 80000, estadiaMinima: 4 });
    // Sessão sem o imóvel: negado antes de excluir.
    await expect(excluirPeriodoPeloProprietario(db, sessao([b]), p.id, agora)).rejects.toBeInstanceOf(AcessoNegado);
    expect(await excluirPeriodoPeloProprietario(db, sessao(), "nada", agora)).toMatchObject({ ok: false });
    expect(await excluirPeriodoPeloProprietario(db, sessao(), p.id, agora)).toEqual({ ok: true });
    expect(await listarPeriodos(db, org, a)).toEqual([]);
  });

  it("limpezas: só as dos imóveis marketplace, com atraso e entrada no dia; marcar feita só a partir do dia, sem custo para a empresa", async () => {
    await db.insert(reservas).values({ organizacaoId: org, imovelId: a, codigo: "SCL-T1", origem: "airbnb", estado: "confirmada", checkin: "2026-10-05", checkout: "2026-10-08", hospedeNome: "Hóspede Fictício", fonte: "manual", idFonte: "" });
    const [atrasada, futura] = await db
      .insert(limpezas)
      .values([
        { organizacaoId: org, imovelId: a, data: "2026-10-02", estado: "pedida" },
        { organizacaoId: org, imovelId: a, data: "2026-10-05", estado: "confirmada" },
        { organizacaoId: org, imovelId: b, data: "2026-10-04", estado: "pedida" },
        { organizacaoId: org, imovelId: a, data: "2026-11-30", estado: "pedida" },
      ])
      .returning();
    const lista = await limpezasDoProprietario(db, sessao(), agora);
    expect(lista.map((l) => [l.data, l.imovelCodigo, l.atrasada, l.entraNoDia, l.podeMarcar])).toEqual([
      ["2026-10-02", "403", true, false, true],
      ["2026-10-05", "403", false, true, false],
    ]);
    expect(await marcarLimpezaFeitaPeloProprietario(db, sessao(), futura.id, agora)).toMatchObject({ ok: false, erro: expect.stringContaining("ainda não chegou") });
    expect(await marcarLimpezaFeitaPeloProprietario(db, sessao(), atrasada.id, agora)).toEqual({ ok: true });
    const [feita] = await db.select().from(limpezas).where(eq(limpezas.id, atrasada.id));
    expect(feita).toMatchObject({ estado: "realizada", custo: 0, despesaId: null, observacao: expect.stringContaining("Feita pelo proprietário") });
    expect((await limpezasDoProprietario(db, sessao(), agora))[0]).toMatchObject({ estado: "realizada", atrasada: false, podeMarcar: false });
    // Imóvel de gestão completa: a limpeza é da empresa.
    const [daEmpresa] = await db.select({ id: limpezas.id }).from(limpezas).where(eq(limpezas.imovelId, b));
    expect(await marcarLimpezaFeitaPeloProprietario(db, sessao(), daEmpresa.id, agora)).toEqual({ ok: false, erro: NAO_MARKETPLACE });
    expect(await marcarLimpezaFeitaPeloProprietario(db, sessao(), "nada", agora)).toMatchObject({ ok: false });
  });

  it("limpeza já confirmada para uma profissional: marcada pelo dono, a profissional sai; reabrir volta a 'pedida'", async () => {
    const [prof] = await db.insert(profissionaisLimpeza).values({ organizacaoId: org, nome: "Profissional Fictícia" }).returning();
    const [l] = await db.insert(limpezas).values({ organizacaoId: org, imovelId: a, data: "2026-10-02", estado: "confirmada", profissionalId: prof.id, confirmadaEm: new Date("2026-10-01T12:00:00Z") }).returning();
    expect(await marcarLimpezaFeitaPeloProprietario(db, sessao(), l.id, agora)).toEqual({ ok: true });
    expect((await db.select().from(limpezas).where(eq(limpezas.id, l.id)))[0]).toMatchObject({ estado: "realizada", profissionalId: null, confirmadaEm: null, custo: 0 });
    expect(await reabrirLimpeza(db, org, l.id, null)).toEqual({ ok: true });
    expect((await db.select().from(limpezas).where(eq(limpezas.id, l.id)))[0]).toMatchObject({ estado: "pedida", profissionalId: null });
  });

  it("limpeza e manutenção: 'hoje' é o do fuso do imóvel (lista, botão e ação na mesma régua)", async () => {
    // a em Auckland: às 15:00Z de 3/10 já é 4/10 lá; e em São Paulo ainda é 3/10.
    await db.update(imoveis).set({ fuso: "Pacific/Auckland" }).where(eq(imoveis.id, a));
    const [{ id: e }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "501", nome: "Cinco" }).returning();
    await db.insert(proprietarioImoveis).values({ proprietarioId: dona, imovelId: e, criadoEm: desdeSempre });
    await criarContrato(db, org, e, { tipo: "marketplace", comissao: "", inicio: "2025-01-01" }, null);
    const [auckland, saoPaulo] = await db
      .insert(limpezas)
      .values([
        { organizacaoId: org, imovelId: a, data: "2026-10-04", estado: "pedida" },
        { organizacaoId: org, imovelId: e, data: "2026-10-04", estado: "pedida" },
      ])
      .returning();
    const s = sessao([a, b, d, e]);
    expect((await limpezasDoProprietario(db, s, agora)).map((l) => [l.imovelCodigo, l.podeMarcar, l.atrasada])).toEqual([
      ["403", true, false],
      ["501", false, false],
    ]);
    expect(await marcarLimpezaFeitaPeloProprietario(db, s, saoPaulo.id, agora)).toMatchObject({ ok: false, erro: expect.stringContaining("ainda não chegou") });
    expect(await marcarLimpezaFeitaPeloProprietario(db, s, auckland.id, agora)).toEqual({ ok: true });
    expect(await registrarManutencaoPeloProprietario(db, s, { imovelId: e, titulo: "Pintura", descricao: "", data: "2026-10-04" }, agora)).toMatchObject({ ok: false, erro: expect.stringContaining("futuro") });
    expect(await registrarManutencaoPeloProprietario(db, s, { imovelId: a, titulo: "Pintura", descricao: "", data: "2026-10-04" }, agora)).toEqual({ ok: true });
  });

  it("manutenção feita pelo proprietário nasce realizada e por conta dele; nunca no futuro, nunca fora do marketplace", async () => {
    expect(await registrarManutencaoPeloProprietario(db, sessao(), { imovelId: a, titulo: "Troca do chuveiro", descricao: "Chuveiro novo instalado.", data: "2026-10-01" }, agora)).toEqual({ ok: true });
    expect(await registrarManutencaoPeloProprietario(db, sessao(), { imovelId: a, titulo: "", descricao: "", data: "2026-10-01" }, agora)).toMatchObject({ ok: false, erro: expect.stringContaining("o que foi feito") });
    expect(await registrarManutencaoPeloProprietario(db, sessao(), { imovelId: a, titulo: "Pintura", descricao: "", data: "2026-10-09" }, agora)).toMatchObject({ ok: false, erro: expect.stringContaining("futuro") });
    expect(await registrarManutencaoPeloProprietario(db, sessao(), { imovelId: b, titulo: "Pintura", descricao: "", data: "2026-10-01" }, agora)).toEqual({ ok: false, erro: NAO_MARKETPLACE });
    const [m] = await db.select().from(manutencoes).where(eq(manutencoes.organizacaoId, org));
    expect(m).toMatchObject({ imovelId: a, estado: "realizada", responsavel: "proprietario", proprietarioId: dona, dataRealizada: "2026-10-01", orcamento: null, despesaId: null, semCusto: true });
    expect(await manutencoesDoProprietario(db, sessao(), agora)).toEqual([expect.objectContaining({ imovelCodigo: "403", titulo: "Troca do chuveiro", estado: "realizada", porContaPropria: true })]);
    // Histórico do portal: as últimas registradas primeiro, mesmo com pedido da empresa (que a fila do painel põe na frente); o limite corta depois.
    await db.insert(manutencoes).values({ organizacaoId: org, imovelId: a, titulo: "Pedido da empresa", estado: "pedida" });
    expect(await registrarManutencaoPeloProprietario(db, sessao(), { imovelId: a, titulo: "Pintura", descricao: "", data: "2026-09-20" }, agora)).toEqual({ ok: true });
    expect((await manutencoesDoProprietario(db, sessao(), agora)).map((x) => x.titulo)).toEqual(["Pintura", "Pedido da empresa", "Troca do chuveiro"]);
    expect((await manutencoesDoProprietario(db, sessao(), agora, 1)).map((x) => x.titulo)).toEqual(["Pintura"]);
    // Sem custo para a empresa: não entra na fila "custo a lançar" do painel, o aviso explica e lançar custo é recusado.
    expect((await listarManutencoes(db, org, { emAberto: true })).map((x) => x.id)).not.toContain(m.id);
    const linha = (await listarManutencoes(db, org)).find((x) => x.id === m.id);
    expect(linha).toMatchObject({ semCusto: true, custo: null, avisos: ["Feita pelo proprietário por conta própria (marketplace): sem custo para a empresa."] });
    expect(await lancarCusto(db, org, m.id, { categoriaId: "00000000-0000-4000-8000-000000000001", valor: 10000, paga: false, dataPagamento: null, pagoPor: "empresa", comprovante: "" }, null)).toMatchObject({ ok: false, erro: expect.stringContaining("não há custo a lançar") });
    expect((await db.select().from(manutencoes).where(eq(manutencoes.id, m.id)))[0].despesaId).toBeNull();
  });

  it("o dia da autorização é o do fuso do imóvel, o mesmo que decide se a seção aparece", async () => {
    // d em Auckland: às 15:00Z de 3/10 já é 4/10 lá (em São Paulo ainda é 3/10). e em São Paulo, mesmo contrato.
    await db.update(imoveis).set({ fuso: "Pacific/Auckland" }).where(eq(imoveis.id, d));
    const [{ id: e }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "501", nome: "Cinco" }).returning();
    await db.insert(proprietarioImoveis).values({ proprietarioId: dona, imovelId: e, criadoEm: desdeSempre });
    await criarContrato(db, org, d, { tipo: "marketplace", comissao: "", inicio: "2026-10-04" }, null);
    await criarContrato(db, org, e, { tipo: "marketplace", comissao: "", inicio: "2026-10-04" }, null);
    const s = sessao([a, b, d, e]);
    expect((await imoveisMarketplaceDaSessao(db, s, agora)).map((i) => i.codigo)).toEqual(["103", "403"]);
    // Aparece e pode editar (Auckland); não aparece e não pode editar (São Paulo) — nunca uma coisa sem a outra.
    expect(await salvarPrecosPeloProprietario(db, s, d, { precoBase: "200,00" }, agora)).toEqual({ ok: true });
    expect(await criarPeriodoPeloProprietario(db, s, d, { nome: "Natal", inicio: "2026-12-24", fim: "2026-12-26", precoNoite: "500,00", estadiaMinima: "" }, agora)).toEqual({ ok: true });
    expect(await salvarPrecosPeloProprietario(db, s, e, { precoBase: "200,00" }, agora)).toEqual({ ok: false, erro: NAO_MARKETPLACE });
    expect(await criarPeriodoPeloProprietario(db, s, e, { nome: "Natal", inicio: "2026-12-24", fim: "2026-12-26", precoNoite: "500,00", estadiaMinima: "" }, agora)).toEqual({ ok: false, erro: NAO_MARKETPLACE });
  });

  it("situação do envio: na lista e automático vêm das regras; o último envio real que tocou o imóvel (simulação não conta)", async () => {
    await salvarRegrasCalendario(db, org, { ...REGRAS_CALENDARIO_PADRAO, envio: { imoveis: [a], automatico: true } }, null);
    const regras = { ...REGRAS_CALENDARIO_PADRAO, envio: { imoveis: [a], automatico: true } };
    expect(await situacaoDoEnvio(db, org, regras, a)).toEqual({ naLista: true, automatico: true, ultimo: null });
    const [sim] = await db.insert(beds24Envios).values({ organizacaoId: org, modo: "simulacao", situacao: "simulacao", iniciadoEm: new Date("2026-10-02T10:00:00Z") }).returning();
    const [real] = await db.insert(beds24Envios).values({ organizacaoId: org, modo: "envio", situacao: "ok", iniciadoEm: new Date("2026-10-01T10:00:00Z") }).returning();
    await db.insert(beds24EnvioNoites).values([
      { organizacaoId: org, envioId: sim.id, imovelId: a, data: "2026-10-10", resultado: "enviado" },
      { organizacaoId: org, envioId: real.id, imovelId: a, data: "2026-10-10", resultado: "confirmado" },
    ]);
    expect(await situacaoDoEnvio(db, org, regras, a)).toEqual({ naLista: true, automatico: true, ultimo: { em: new Date("2026-10-01T10:00:00Z"), situacao: "ok" } });
    expect(await situacaoDoEnvio(db, org, regras, b)).toMatchObject({ naLista: false, ultimo: null });
  });

  it("o contrato marketplace é reconferido dentro da transação que grava: se acabou no meio, nada é gravado", async () => {
    const real = vi.mocked(listarContratos).getMockImplementation()!;
    // A 1ª leitura (conferência inicial) ainda vê o contrato; a 2ª (dentro da transação, com o imóvel travado) já não.
    const acabouNoMeio = () => {
      let n = 0;
      vi.mocked(listarContratos).mockImplementation(async (...args) => (++n === 2 ? [] : real(...args)));
    };
    try {
      acabouNoMeio();
      expect(await salvarPrecosPeloProprietario(db, sessao(), a, { precoBase: "999,00" }, agora)).toEqual({ ok: false, erro: NAO_MARKETPLACE });
      expect((await lerDetalhes(db, org, a)).precoBase).toBe(30000);
      acabouNoMeio();
      expect(await criarPeriodoPeloProprietario(db, sessao(), a, { nome: "Natal", inicio: "2026-12-24", fim: "2026-12-26", precoNoite: "500,00", estadiaMinima: "" }, agora)).toEqual({ ok: false, erro: NAO_MARKETPLACE });
      expect(await listarPeriodos(db, org, a)).toEqual([]);
      vi.mocked(listarContratos).mockImplementation(real);
      expect(await criarPeriodoPeloProprietario(db, sessao(), a, { nome: "Natal", inicio: "2026-12-24", fim: "2026-12-26", precoNoite: "500,00", estadiaMinima: "" }, agora)).toEqual({ ok: true });
      const [p] = await listarPeriodos(db, org, a);
      acabouNoMeio();
      expect(await excluirPeriodoPeloProprietario(db, sessao(), p.id, agora)).toEqual({ ok: false, erro: NAO_MARKETPLACE });
      expect(await listarPeriodos(db, org, a)).toHaveLength(1);
      const [l] = await db.insert(limpezas).values({ organizacaoId: org, imovelId: a, data: "2026-10-02", estado: "pedida" }).returning();
      acabouNoMeio();
      expect(await marcarLimpezaFeitaPeloProprietario(db, sessao(), l.id, agora)).toEqual({ ok: false, erro: NAO_MARKETPLACE });
      expect((await db.select().from(limpezas).where(eq(limpezas.id, l.id)))[0].estado).toBe("pedida");
      acabouNoMeio();
      expect(await registrarManutencaoPeloProprietario(db, sessao(), { imovelId: a, titulo: "Pintura", descricao: "", data: "2026-10-01" }, agora)).toEqual({ ok: false, erro: NAO_MARKETPLACE });
      expect(await db.select().from(manutencoes)).toEqual([]);
    } finally {
      vi.mocked(listarContratos).mockImplementation(real);
    }
  });

  it("imóvel que mudou de dono: limpezas e manutenções de antes do vínculo não aparecem nem podem ser mexidas pelo dono novo", async () => {
    // a passa de "dona" para "nova" em 3/10 (vínculo às 12:00 de São Paulo).
    const [{ id: nova }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Nova Dona" }).returning();
    await db.delete(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, a));
    await db.insert(proprietarioImoveis).values({ proprietarioId: nova, imovelId: a, criadoEm: new Date("2026-10-03T15:00:00Z") });
    await db.insert(limpezas).values([
      { organizacaoId: org, imovelId: a, data: "2026-10-02", estado: "pedida" },
      { organizacaoId: org, imovelId: a, data: "2026-10-03", estado: "pedida" },
    ]);
    await db.insert(manutencoes).values([
      { organizacaoId: org, imovelId: a, titulo: "Do dono anterior", estado: "realizada", dataRealizada: "2026-10-01", responsavel: "proprietario", semCusto: true },
      { organizacaoId: org, imovelId: a, titulo: "Do dono novo", estado: "realizada", dataRealizada: "2026-10-03", responsavel: "proprietario", semCusto: true },
    ]);
    const s = sessao([a]);
    expect((await imoveisMarketplaceDaSessao(db, s, agora))[0]).toMatchObject({ codigo: "403", posseDesde: "2026-10-03" });
    expect((await limpezasDoProprietario(db, s, agora)).map((l) => l.data)).toEqual(["2026-10-03"]);
    const [antiga] = await db.select({ id: limpezas.id }).from(limpezas).where(and(eq(limpezas.imovelId, a), eq(limpezas.data, "2026-10-02")));
    expect(await marcarLimpezaFeitaPeloProprietario(db, s, antiga.id, agora)).toEqual({ ok: false, erro: ANTES_DA_POSSE("2026-10-03") });
    expect((await manutencoesDoProprietario(db, s, agora)).map((m) => m.titulo)).toEqual(["Do dono novo"]);
    expect(await registrarManutencaoPeloProprietario(db, s, { imovelId: a, titulo: "Retroativa", descricao: "", data: "2026-10-02" }, agora)).toEqual({ ok: false, erro: ANTES_DA_POSSE("2026-10-03") });
    expect(await registrarManutencaoPeloProprietario(db, s, { imovelId: a, titulo: "De hoje", descricao: "", data: "2026-10-03" }, agora)).toEqual({ ok: true });
  });
});
