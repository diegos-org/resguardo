import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcessoNegado, type Sessao } from "@/acesso/politica";
import { historicoDe } from "@/auditoria/auditoria";
import { impressaoCredencialBeds24 } from "@/beds24/http";
import { VEREDITO_PENDENTE } from "@/calendario/envio";
import { REGRAS_CALENDARIO_PADRAO, salvarRegrasCalendario } from "@/calendario/regras-config";
import { criarContrato, listarContratos } from "@/contratos/repositorio";
import { beds24EnvioImoveis, beds24Envios, beds24EnvioNoites, idsExternos, imoveis, imoveisDetalhes, limpezas, manutencoes, organizacoes, profissionaisLimpeza, proprietarioImoveis, proprietarios, proprietarioUsuarios, reservas, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { DETALHES_VAZIOS, entradaDeDetalhes, lerDetalhes, listarPeriodos, salvarDetalhes, validarDetalhes } from "@/imoveis/detalhes";
import { reabrirLimpeza } from "@/limpezas/limpezas";
import { lancarCusto, listarManutencoes } from "@/manutencao/manutencao";
import {
  ANTES_DA_POSSE,
  criarPeriodoPeloProprietario,
  envioPronto,
  ESTADIA_FORA_DO_PORTAL,
  excluirPeriodoPeloProprietario,
  imoveisMarketplaceDaSessao,
  limpezasDoProprietario,
  manutencoesDoProprietario,
  marcarLimpezaFeitaPeloProprietario,
  NAO_DONO,
  NAO_MARKETPLACE,
  NAO_SAIDA,
  PERIODO_SO_DISPONIBILIDADE,
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
const semEnv = { NODE_ENV: "test" } as NodeJS.ProcessEnv;
const soSinal = { NODE_ENV: "test", BEDS24_ESCRITA: "ligada" } as NodeJS.ProcessEnv;
const escritaPronta = { NODE_ENV: "test", BEDS24_ESCRITA: "ligada", BEDS24_API_KEY: "token-ficticio-de-teste" } as NodeJS.ProcessEnv;
/** Impressão da credencial de `escritaPronta`: as execuções de teste "feitas com a credencial atual" gravam esta. */
const credencial = impressaoCredencialBeds24(escritaPronta);
const sessao = (imovelIds = [a, b, d]): Sessao => ({ usuarioId: usuario, organizacaoId: org, papel: "proprietario", imovelIds });
const somaDias = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
let seq = 0;
/** Limpeza de saída de hóspede: cada uma nasce de uma reserva com checkout no dia (uma limpeza por reserva). */
const limpezaDeSaida = async (imovelId: string, data: string, extra: Partial<typeof limpezas.$inferInsert> = {}) => {
  seq++;
  const [r] = await db.insert(reservas).values({ organizacaoId: org, imovelId, codigo: `SCL-L${seq}`, origem: "airbnb", estado: "confirmada", checkin: somaDias(data, -2), checkout: data, hospedeNome: "Hóspede Fictício", fonte: "manual", idFonte: `L${seq}` }).returning();
  const [l] = await db.insert(limpezas).values({ organizacaoId: org, imovelId, data, estado: "pedida", reservaId: r.id, ...extra }).returning();
  return l;
};

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
    expect(lista[0]).toMatchObject({ fontePrecos: "scl", posseDesde: "2025-01-01", detalhes: { precoBase: 30000 }, periodos: [], envio: { naLista: false, vinculado: false, escritaPronta: false, automatico: false, ultimo: null } });
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

  it("com os preços definidos no Beds24, o preço da noite não é editado aqui (regras e taxas, sim); período só com estadia mínima; as mensagens não citam o Beds24", async () => {
    await salvarDetalhes(db, org, a, { ...(await lerDetalhes(db, org, a)), fontePrecos: "beds24" }, null, agora);
    expect(await salvarPrecosPeloProprietario(db, sessao(), a, { precoBase: "350,00", estadiaMinima: "2" }, agora)).toMatchObject({ ok: false, erros: { precoBase: expect.stringContaining("sua ferramenta de preços") } });
    expect(await salvarPrecosPeloProprietario(db, sessao(), a, { precoBase: "300,00", estadiaMinima: "2", taxaLimpeza: "120,00" }, agora)).toEqual({ ok: true });
    expect(await lerDetalhes(db, org, a)).toMatchObject({ precoBase: 30000, estadiaMinima: 2, taxaLimpeza: 12000, fontePrecos: "beds24" });
    // O portal recebe a fonte já convertida, sem o nome interno.
    expect((await imoveisMarketplaceDaSessao(db, sessao(), agora))[0]).toMatchObject({ fontePrecos: "ferramenta" });
    expect(await criarPeriodoPeloProprietario(db, sessao(), a, { nome: "Réveillon", inicio: "2026-12-28", fim: "2027-01-02", precoNoite: "900,00", estadiaMinima: "" }, agora)).toMatchObject({ ok: false, erro: expect.stringContaining("sua ferramenta de preços") });
    expect(await criarPeriodoPeloProprietario(db, sessao(), a, { nome: "Réveillon", inicio: "2026-12-28", fim: "2027-01-02", precoNoite: "", estadiaMinima: "5" }, agora)).toEqual({ ok: true });
  });

  it("com só disponibilidade (M3.11b): o preço da noite não é editado aqui, a fonte chega com o valor próprio e nenhum período é criado, com a frase do desenho; nada cita o Beds24", async () => {
    await salvarDetalhes(db, org, a, { ...(await lerDetalhes(db, org, a)), fontePrecos: "so_disponibilidade" }, null, agora);
    const recusa = await salvarPrecosPeloProprietario(db, sessao(), a, { precoBase: "350,00", estadiaMinima: "2" }, agora);
    expect(recusa).toMatchObject({ ok: false, erros: { precoBase: expect.stringContaining("sua ferramenta de preços") } });
    expect(await salvarPrecosPeloProprietario(db, sessao(), a, { precoBase: "300,00", taxaLimpeza: "120,00" }, agora)).toEqual({ ok: true });
    expect(await lerDetalhes(db, org, a)).toMatchObject({ precoBase: 30000, taxaLimpeza: 12000, fontePrecos: "so_disponibilidade" });
    expect((await imoveisMarketplaceDaSessao(db, sessao(), agora))[0]).toMatchObject({ fontePrecos: "so_disponibilidade" });
    // Estadia mínima e máxima (revisão 2): a tela as mostra só de leitura e o servidor recusa a mudança, como o preço; o mesmo
    // valor (o que o campo só de leitura envia) passa, e as outras regras continuam editáveis.
    await db.update(imoveisDetalhes).set({ estadiaMinima: 2, estadiaMaxima: 10 }).where(eq(imoveisDetalhes.imovelId, a));
    expect(await salvarPrecosPeloProprietario(db, sessao(), a, { precoBase: "300,00", estadiaMinima: "3", estadiaMaxima: "10" }, agora)).toEqual({ ok: false, erro: "Confira os campos destacados.", erros: { estadiaMinima: ESTADIA_FORA_DO_PORTAL } });
    expect(await salvarPrecosPeloProprietario(db, sessao(), a, { precoBase: "300,00", estadiaMinima: "2", estadiaMaxima: "" }, agora)).toEqual({ ok: false, erro: "Confira os campos destacados.", erros: { estadiaMaxima: ESTADIA_FORA_DO_PORTAL } });
    expect(await salvarPrecosPeloProprietario(db, sessao(), a, { precoBase: "300,00", estadiaMinima: "2", estadiaMaxima: "10", antecedenciaMinima: "1" }, agora)).toEqual({ ok: true });
    expect(await lerDetalhes(db, org, a)).toMatchObject({ estadiaMinima: 2, estadiaMaxima: 10, antecedenciaMinima: 1 });
    expect(ESTADIA_FORA_DO_PORTAL).not.toMatch(/beds24/i);
    // Período com preço ou só com mínimo: nenhum dos dois seria enviado, então nenhum é gravado.
    for (const entrada of [{ precoNoite: "900,00", estadiaMinima: "" }, { precoNoite: "", estadiaMinima: "5" }]) {
      expect(await criarPeriodoPeloProprietario(db, sessao(), a, { nome: "Réveillon", inicio: "2026-12-28", fim: "2027-01-02", ...entrada }, agora)).toEqual({ ok: false, erro: PERIODO_SO_DISPONIBILIDADE });
    }
    expect(await listarPeriodos(db, org, a)).toEqual([]);
    expect(PERIODO_SO_DISPONIBILIDADE).toBe("Com só disponibilidade, preço e estadia mínima ficam com você ou com a sua ferramenta: aqui você só fecha e reabre datas.");
    expect(JSON.stringify([recusa, PERIODO_SO_DISPONIBILIDADE])).not.toMatch(/beds24/i);
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
    const atrasada = await limpezaDeSaida(a, "2026-10-02");
    const futura = await limpezaDeSaida(a, "2026-10-05", { estado: "confirmada" });
    await limpezaDeSaida(b, "2026-10-04");
    await limpezaDeSaida(a, "2026-11-30");
    // Limpeza avulsa/extra agendada pela empresa (sem reserva): não é do proprietário — nem na lista, nem para marcar.
    const [avulsa] = await db.insert(limpezas).values({ organizacaoId: org, imovelId: a, data: "2026-10-02", estado: "pedida" }).returning();
    const lista = await limpezasDoProprietario(db, sessao(), agora);
    expect(lista.map((l) => [l.data, l.imovelCodigo, l.atrasada, l.entraNoDia, l.podeMarcar])).toEqual([
      ["2026-10-02", "403", true, false, true],
      ["2026-10-05", "403", false, true, false],
    ]);
    expect(await marcarLimpezaFeitaPeloProprietario(db, sessao(), avulsa.id, agora)).toEqual({ ok: false, erro: NAO_SAIDA });
    expect((await db.select().from(limpezas).where(eq(limpezas.id, avulsa.id)))[0].estado).toBe("pedida");
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
    const l = await limpezaDeSaida(a, "2026-10-02", { estado: "confirmada", profissionalId: prof.id, confirmadaEm: new Date("2026-10-01T12:00:00Z") });
    expect(await marcarLimpezaFeitaPeloProprietario(db, sessao(), l.id, agora)).toEqual({ ok: true });
    expect((await db.select().from(limpezas).where(eq(limpezas.id, l.id)))[0]).toMatchObject({ estado: "realizada", profissionalId: null, confirmadaEm: null, custo: 0, semCusto: true });
    // Reabrir solta a marca "sem custo" e o zero: quem fizer agora segue o fluxo normal (custo não informado volta a avisar).
    expect(await reabrirLimpeza(db, org, l.id, null)).toEqual({ ok: true });
    expect((await db.select().from(limpezas).where(eq(limpezas.id, l.id)))[0]).toMatchObject({ estado: "pedida", profissionalId: null, custo: null, semCusto: false });
  });

  it("limpeza e manutenção: 'hoje' é o do fuso do imóvel (lista, botão e ação na mesma régua)", async () => {
    // a em Auckland: às 15:00Z de 3/10 já é 4/10 lá; e em São Paulo ainda é 3/10.
    await db.update(imoveis).set({ fuso: "Pacific/Auckland" }).where(eq(imoveis.id, a));
    const [{ id: e }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "501", nome: "Cinco" }).returning();
    await db.insert(proprietarioImoveis).values({ proprietarioId: dona, imovelId: e, criadoEm: desdeSempre });
    await criarContrato(db, org, e, { tipo: "marketplace", comissao: "", inicio: "2025-01-01" }, null);
    const auckland = await limpezaDeSaida(a, "2026-10-04");
    const saoPaulo = await limpezaDeSaida(e, "2026-10-04");
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

  it("situação do envio: lista e automático vêm das regras, vínculo do Beds24 e escrita do ambiente; o último envio real que tocou o imóvel (simulação não conta)", async () => {
    await salvarRegrasCalendario(db, org, { ...REGRAS_CALENDARIO_PADRAO, envio: { imoveis: [a], automatico: true } }, null);
    const regras = { ...REGRAS_CALENDARIO_PADRAO, envio: { imoveis: [a], automatico: true } };
    // Sem vínculo e com a escrita desligada, o envio não alcança as OTAs mesmo com o imóvel na lista.
    expect(await situacaoDoEnvio(db, org, regras, a, semEnv)).toEqual({ naLista: true, vinculado: false, escritaPronta: false, automatico: true, ultimo: null });
    // Vínculo precisa de propriedade e quarto numéricos; a escrita vem de BEDS24_ESCRITA=ligada.
    await db.insert(idsExternos).values({ organizacaoId: org, imovelId: a, canal: "beds24", idExterno: "10", detalhe: "" });
    expect((await situacaoDoEnvio(db, org, regras, a, escritaPronta)).vinculado).toBe(false);
    await db.insert(idsExternos).values({ organizacaoId: org, imovelId: a, canal: "beds24", idExterno: "10", detalhe: "20" });
    expect(await situacaoDoEnvio(db, org, regras, a, escritaPronta)).toEqual({ naLista: true, vinculado: true, escritaPronta: true, automatico: true, ultimo: null });
    // Sinal ligado sem credencial: o escritor do ambiente é nulo e nada sai — o portal não pode prometer envio.
    expect((await situacaoDoEnvio(db, org, regras, a, soSinal)).escritaPronta).toBe(false);
    // A régua que aborta o envio: segundo vínculo válido no mesmo imóvel, ou o mesmo quarto em outro imóvel da lista, desfaz o "vinculado".
    const [duplicado] = await db.insert(idsExternos).values({ organizacaoId: org, imovelId: a, canal: "beds24", idExterno: "11", detalhe: "21" }).returning();
    expect((await situacaoDoEnvio(db, org, regras, a, escritaPronta)).vinculado).toBe(false);
    await db.delete(idsExternos).where(eq(idsExternos.id, duplicado.id));
    await db.insert(idsExternos).values({ organizacaoId: org, imovelId: b, canal: "beds24", idExterno: "12", detalhe: "20" });
    expect((await situacaoDoEnvio(db, org, { ...regras, envio: { imoveis: [a, b], automatico: true } }, a, escritaPronta)).vinculado).toBe(false);
    // Fora da lista de envio, o outro imóvel não entra no envio e não cria ambiguidade.
    expect((await situacaoDoEnvio(db, org, regras, a, escritaPronta)).vinculado).toBe(true);
    // Ambiguidade em OUTRO imóvel da lista (dois vínculos válidos no 102) também derruba o envio inteiro — e a promessa deste.
    await db.delete(idsExternos).where(and(eq(idsExternos.imovelId, b), eq(idsExternos.canal, "beds24")));
    await db.insert(idsExternos).values([{ organizacaoId: org, imovelId: b, canal: "beds24", idExterno: "12", detalhe: "30" }, { organizacaoId: org, imovelId: b, canal: "beds24", idExterno: "13", detalhe: "31" }]);
    expect((await situacaoDoEnvio(db, org, { ...regras, envio: { imoveis: [a, b], automatico: true } }, a, escritaPronta)).vinculado).toBe(false);
    expect((await situacaoDoEnvio(db, org, regras, a, escritaPronta)).vinculado).toBe(true);
    const terminada = (iniciadoEm: string) => ({ iniciadoEm: new Date(iniciadoEm), terminadoEm: new Date(new Date(iniciadoEm).getTime() + 60_000) });
    const [sim] = await db.insert(beds24Envios).values({ organizacaoId: org, modo: "simulacao", situacao: "simulacao", ...terminada("2026-10-02T10:00:00Z") }).returning();
    const [real] = await db.insert(beds24Envios).values({ organizacaoId: org, modo: "envio", situacao: "ok", credencial, ...terminada("2026-10-01T10:00:00Z") }).returning();
    await db.insert(beds24EnvioImoveis).values([{ organizacaoId: org, envioId: sim.id, imovelId: a, propertyId: "10", roomId: "20" }, { organizacaoId: org, envioId: real.id, imovelId: a, propertyId: "10", roomId: "20" }]);
    await db.insert(beds24EnvioNoites).values([
      { organizacaoId: org, envioId: sim.id, imovelId: a, data: "2026-10-10", resultado: "enviado" },
      { organizacaoId: org, envioId: real.id, imovelId: a, data: "2026-10-10", resultado: "confirmado" },
    ]);
    // Sem credencial no ambiente, a do veredito não é "a atual" (e a escrita também não está pronta).
    expect(await situacaoDoEnvio(db, org, regras, a, semEnv)).toMatchObject({ naLista: true, vinculado: true, escritaPronta: false, automatico: true, ultimo: { em: new Date("2026-10-01T10:00:00Z"), situacao: "ok", falhou: false, mesmoVinculo: true, mesmaCredencial: false } });
    expect(await situacaoDoEnvio(db, org, regras, b, semEnv)).toMatchObject({ naLista: false, vinculado: false, ultimo: null });
    // Execução real que incluiu o imóvel sem nenhuma noite a mudar (tudo já igual) também é "último envio".
    const [igual] = await db.insert(beds24Envios).values({ organizacaoId: org, modo: "envio", situacao: "ok", credencial, ...terminada("2026-10-03T10:00:00Z") }).returning();
    await db.insert(beds24EnvioImoveis).values({ organizacaoId: org, envioId: igual.id, imovelId: a, propertyId: "10", roomId: "20" });
    expect((await situacaoDoEnvio(db, org, regras, a, semEnv)).ultimo).toEqual({ em: new Date("2026-10-03T10:00:00Z"), situacao: "ok", falhou: false, mesmoVinculo: true, mesmaCredencial: false });
    expect((await situacaoDoEnvio(db, org, regras, a, escritaPronta)).ultimo?.mesmaCredencial).toBe(true);
    // Execução ainda em curso (ou interrompida sem terminar) não conta: o veredito dela está pendente.
    const [emCurso] = await db.insert(beds24Envios).values({ organizacaoId: org, modo: "envio", situacao: "executando", credencial, iniciadoEm: new Date("2026-10-03T12:00:00Z") }).returning();
    await db.insert(beds24EnvioImoveis).values({ organizacaoId: org, envioId: emCurso.id, imovelId: a, propertyId: "10", roomId: "20", falha: VEREDITO_PENDENTE });
    expect((await situacaoDoEnvio(db, org, regras, a, semEnv)).ultimo?.em).toEqual(new Date("2026-10-03T10:00:00Z"));
    expect(envioPronto(await situacaoDoEnvio(db, org, regras, a, escritaPronta))).toBe(true);
    // Execução em que o imóvel ficou de fora (quarto inacessível à credencial, moeda): o veredito vem junto e nada é prometido.
    const [fora] = await db.insert(beds24Envios).values({ organizacaoId: org, modo: "envio", situacao: "erro", credencial, ...terminada("2026-10-04T10:00:00Z") }).returning();
    await db.insert(beds24EnvioImoveis).values({ organizacaoId: org, envioId: fora.id, imovelId: a, propertyId: "10", roomId: "20", falha: "O quarto vinculado ao imóvel 403 não está acessível nesta credencial." });
    const comFalha = await situacaoDoEnvio(db, org, regras, a, escritaPronta);
    expect(comFalha.ultimo).toMatchObject({ em: new Date("2026-10-04T10:00:00Z"), falhou: true });
    // O motivo técnico (nomes internos, números de quarto) nunca vai ao portal: o objeto chega inteiro ao navegador.
    expect(JSON.stringify(comFalha)).not.toMatch(/acessível|imóvel 403/);
    expect(envioPronto(comFalha)).toBe(false);
    // Envio bom, mas o vínculo mudou depois (outro quarto): o veredito antigo não vale para o quarto novo.
    const [bom] = await db.insert(beds24Envios).values({ organizacaoId: org, modo: "envio", situacao: "ok", credencial, ...terminada("2026-10-05T10:00:00Z") }).returning();
    await db.insert(beds24EnvioImoveis).values({ organizacaoId: org, envioId: bom.id, imovelId: a, propertyId: "10", roomId: "20" });
    expect(envioPronto(await situacaoDoEnvio(db, org, regras, a, escritaPronta))).toBe(true);
    await db.update(idsExternos).set({ detalhe: "22" }).where(and(eq(idsExternos.imovelId, a), eq(idsExternos.detalhe, "20")));
    const trocado = await situacaoDoEnvio(db, org, regras, a, escritaPronta);
    expect(trocado).toMatchObject({ vinculado: true, ultimo: { em: new Date("2026-10-05T10:00:00Z"), falhou: false, mesmoVinculo: false, mesmaCredencial: true } });
    expect(envioPronto(trocado)).toBe(false);
    // Vínculo de volta ao quarto validado, mas a credencial Beds24 do ambiente trocada (outra conta, mesma organização e mesmo
    // vínculo): o veredito foi dado por outra credencial, que podia enxergar um quarto que esta não enxerga — nada é prometido
    // até um envio real com a credencial atual.
    await db.update(idsExternos).set({ detalhe: "20" }).where(and(eq(idsExternos.imovelId, a), eq(idsExternos.detalhe, "22")));
    expect(envioPronto(await situacaoDoEnvio(db, org, regras, a, escritaPronta))).toBe(true);
    const outraCredencial = { ...escritaPronta, BEDS24_API_KEY: "outro-token-ficticio" } as NodeJS.ProcessEnv;
    const trocada = await situacaoDoEnvio(db, org, regras, a, outraCredencial);
    expect(trocada).toMatchObject({ escritaPronta: true, ultimo: { em: new Date("2026-10-05T10:00:00Z"), falhou: false, mesmoVinculo: true, mesmaCredencial: false } });
    expect(envioPronto(trocada)).toBe(false);
    // Execução antiga, sem impressão gravada: não se sabe com que credencial foi, então também não vale.
    await db.update(beds24Envios).set({ credencial: "" }).where(eq(beds24Envios.id, bom.id));
    const semImpressao = await situacaoDoEnvio(db, org, regras, a, escritaPronta);
    expect(semImpressao.ultimo?.mesmaCredencial).toBe(false);
    expect(envioPronto(semImpressao)).toBe(false);
  });

  it("escrita pronta exige que a credencial Beds24 atenda esta organização: com mais de uma empresa, só a de BEDS24_ORGANIZACAO_ID", async () => {
    const regras = { ...REGRAS_CALENDARIO_PADRAO, envio: { imoveis: [a], automatico: true } };
    await db.insert(idsExternos).values({ organizacaoId: org, imovelId: a, canal: "beds24", idExterno: "10", detalhe: "20" });
    const [outra] = await db.insert(organizacoes).values({ nome: "Outra empresa" }).returning();
    // Duas organizações e nenhuma indicada: a credencial é ambígua, a rotina não envia — o portal não promete.
    expect((await situacaoDoEnvio(db, org, regras, a, escritaPronta)).escritaPronta).toBe(false);
    expect((await situacaoDoEnvio(db, org, regras, a, { ...escritaPronta, BEDS24_ORGANIZACAO_ID: org })).escritaPronta).toBe(true);
    // Credencial de outra empresa: o imóvel desta nunca sai pelo envio.
    expect((await situacaoDoEnvio(db, org, regras, a, { ...escritaPronta, BEDS24_ORGANIZACAO_ID: outra.id })).escritaPronta).toBe(false);
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
      const l = await limpezaDeSaida(a, "2026-10-02");
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

  it("a posse é reconferida dentro da transação: imóvel que passou a outro dono do mesmo usuário no meio não aceita data de antes do vínculo novo", async () => {
    const real = vi.mocked(listarContratos).getMockImplementation()!;
    const [{ id: nova }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Nova Dona" }).returning();
    await db.insert(proprietarioUsuarios).values({ proprietarioId: nova, usuarioId: usuario });
    const l = await limpezaDeSaida(a, "2026-10-02");
    // Entre a conferência inicial (posse desde sempre) e a transação, o imóvel passa à nova dona a partir de 3/10.
    const troca = () =>
      vi.mocked(listarContratos).mockImplementationOnce(async (...args) => {
        await db.delete(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, a));
        await db.insert(proprietarioImoveis).values({ proprietarioId: nova, imovelId: a, criadoEm: new Date("2026-10-03T15:00:00Z") });
        return real(...args);
      });
    try {
      troca();
      expect(await marcarLimpezaFeitaPeloProprietario(db, sessao([a]), l.id, agora)).toEqual({ ok: false, erro: ANTES_DA_POSSE("2026-10-03") });
      expect((await db.select().from(limpezas).where(eq(limpezas.id, l.id)))[0].estado).toBe("pedida");
      // De volta à posse antiga; a manutenção retroativa passa pelo mesmo caminho.
      await db.delete(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, a));
      await db.insert(proprietarioImoveis).values({ proprietarioId: dona, imovelId: a, criadoEm: desdeSempre });
      troca();
      expect(await registrarManutencaoPeloProprietario(db, sessao([a]), { imovelId: a, titulo: "Retroativa", descricao: "", data: "2026-10-02" }, agora)).toEqual({ ok: false, erro: ANTES_DA_POSSE("2026-10-03") });
      expect(await db.select().from(manutencoes)).toEqual([]);
    } finally {
      vi.mocked(listarContratos).mockImplementation(real);
    }
  });

  it("vínculo criado hoje em São Paulo num imóvel de fuso atrasado: preço e período gravam (a posse só vale para data de serviço)", async () => {
    // 00:30 em São Paulo de 4/10; no Havaí ainda é 3/10 17:30. Vínculo criado às 00:10 de São Paulo (posse desde 4/10).
    const madrugada = new Date("2026-10-04T03:30:00Z");
    const [{ id: h }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "808", nome: "Havaí", fuso: "Pacific/Honolulu" }).returning();
    await db.insert(proprietarioImoveis).values({ proprietarioId: dona, imovelId: h, criadoEm: new Date("2026-10-04T03:10:00Z") });
    await criarContrato(db, org, h, { tipo: "marketplace", comissao: "", inicio: "2025-01-01" }, null);
    const s = sessao([h]);
    expect(await salvarPrecosPeloProprietario(db, s, h, { precoBase: "150,00" }, madrugada)).toEqual({ ok: true });
    expect(await criarPeriodoPeloProprietario(db, s, h, { nome: "Natal", inicio: "2026-12-24", fim: "2026-12-26", precoNoite: "500,00", estadiaMinima: "" }, madrugada)).toEqual({ ok: true });
    // Serviço com data de antes do vínculo continua recusado.
    expect(await registrarManutencaoPeloProprietario(db, s, { imovelId: h, titulo: "Antiga", descricao: "", data: "2026-10-03" }, madrugada)).toEqual({ ok: false, erro: ANTES_DA_POSSE("2026-10-04") });
  });

  it("sessão com posse antiga: o imóvel transferido ou desvinculado no meio é recusado dentro da transação, e nada é gravado", async () => {
    const s = sessao([a]);
    const [{ id: nova }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Nova Dona" }).returning();
    // Transferido para outra proprietária (sem vínculo com este usuário) depois de a sessão ter sido montada.
    await db.delete(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, a));
    await db.insert(proprietarioImoveis).values({ proprietarioId: nova, imovelId: a, criadoEm: desdeSempre });
    expect(await salvarPrecosPeloProprietario(db, s, a, { precoBase: "200,00" }, agora)).toEqual({ ok: false, erro: NAO_DONO });
    expect(await criarPeriodoPeloProprietario(db, s, a, { nome: "Natal", inicio: "2026-12-24", fim: "2026-12-26", precoNoite: "500,00", estadiaMinima: "" }, agora)).toEqual({ ok: false, erro: NAO_DONO });
    expect(await registrarManutencaoPeloProprietario(db, s, { imovelId: a, titulo: "Pintura", descricao: "", data: "2026-10-01" }, agora)).toEqual({ ok: false, erro: NAO_DONO });
    expect(await db.select().from(manutencoes)).toEqual([]);
    expect((await lerDetalhes(db, org, a)).precoBase).not.toBe(20000);
    // Desvinculado de todo mundo: idem.
    await db.delete(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, a));
    expect(await salvarPrecosPeloProprietario(db, s, a, { precoBase: "200,00" }, agora)).toEqual({ ok: false, erro: NAO_DONO });
    // Representando a nova dona, o mesmo usuário volta a poder gravar.
    await db.insert(proprietarioImoveis).values({ proprietarioId: nova, imovelId: a, criadoEm: desdeSempre });
    await db.insert(proprietarioUsuarios).values({ proprietarioId: nova, usuarioId: usuario });
    expect(await salvarPrecosPeloProprietario(db, s, a, { precoBase: "200,00" }, agora)).toEqual({ ok: true });
  });

  it("imóvel que mudou de dono: limpezas e manutenções de antes do vínculo não aparecem nem podem ser mexidas pelo dono novo", async () => {
    // a passa de "dona" para "nova" em 3/10 (vínculo às 12:00 de São Paulo); o usuário representa a nova dona.
    const [{ id: nova }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Nova Dona" }).returning();
    await db.insert(proprietarioUsuarios).values({ proprietarioId: nova, usuarioId: usuario });
    await db.delete(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, a));
    await db.insert(proprietarioImoveis).values({ proprietarioId: nova, imovelId: a, criadoEm: new Date("2026-10-03T15:00:00Z") });
    await limpezaDeSaida(a, "2026-10-02");
    await limpezaDeSaida(a, "2026-10-03");
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
