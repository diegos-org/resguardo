import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { beds24Envios, imoveis, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { criarPeriodo, DETALHES_VAZIOS, excluirPeriodo, fontesDePrecosDosImoveis, lerDetalhes, listarPeriodos, salvarDetalhes, salvarDetalhesComLeitura, validarDetalhes, validarPeriodo } from "./detalhes";
import { PERIODO_SO_DISPONIBILIDADE_PAINEL } from "./fonte-precos";

let db: Db;
let close: () => Promise<void>;
let org: string;
let outraOrg: string;
let im: string;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }, { id: outraOrg }] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Quatro" }).returning();
});
afterEach(() => close());

const form = {
  cep: "22440000",
  estado: "rj",
  complemento: "apto 403",
  cama_casal: "1",
  cama_solteiro: "2",
  cama_beliche: "0",
  comodidades: ["Wi-Fi", "Piscina", "Inventada"],
  comodidadesOutras: "Churrasqueira, Rede",
  regrasCasa: "Silêncio após 22h",
  aceitaAnimais: "on",
  checkinAPartirDe: "14:00",
  checkoutAte: "",
  taxaLimpeza: "250,00",
  hospedeExtraValor: "50",
  hospedeExtraAPartirDe: "5",
  estadiaMinima: "3",
  estadiaMaxima: "",
  diasChegada: ["5", "6"],
  diasSaida: ["0", "1", "2", "3", "4", "5", "6"],
  precoBase: "1.200,50",
  precoDinamico: "",
};

describe("validação do cadastro completo", () => {
  it("lê o formulário: centavos, CEP, sigla, camas, comodidades e dias", () => {
    const r = validarDetalhes(form);
    if (!r.ok) throw new Error(JSON.stringify(r.erros));
    expect(r.dados).toMatchObject({
      cep: "22440-000",
      estado: "RJ",
      camas: { casal: 1, solteiro: 2 },
      comodidades: ["Wi-Fi", "Piscina", "Churrasqueira", "Rede"],
      aceitaAnimais: true,
      permiteFumar: false,
      checkinAPartirDe: "14:00",
      checkoutAte: "11:00",
      taxaLimpeza: 25000,
      hospedeExtraValor: 5000,
      precoBase: 120050,
      estadiaMaxima: null,
      diasChegada: [5, 6],
      diasSaida: [], // todos = sem restrição
    });
  });

  it("campo vazio fica 'não cadastrado' (null), não zero", () => {
    const r = validarDetalhes({});
    if (!r.ok) throw new Error("inválido");
    expect(r.dados).toEqual(DETALHES_VAZIOS);
  });

  it("horários (M7.22): \"9:00\" e \"15h\" gravam \"09:00\" e \"15:00\"; \"25:00\" é recusado; vazio dá o padrão da casa", () => {
    const r = validarDetalhes({ ...form, checkinAPartirDe: "15h", checkoutAte: "9:00" });
    if (!r.ok) throw new Error(JSON.stringify(r.erros));
    expect([r.dados.checkinAPartirDe, r.dados.checkoutAte]).toEqual(["15:00", "09:00"]);
    const vazio = validarDetalhes({ ...form, checkinAPartirDe: "", checkoutAte: " " });
    if (!vazio.ok) throw new Error(JSON.stringify(vazio.erros));
    expect([vazio.dados.checkinAPartirDe, vazio.dados.checkoutAte]).toEqual(["15:00", "11:00"]);
    for (const hora of ["25:00", "15", "3 da tarde", "15:7"]) {
      const x = validarDetalhes({ ...form, checkoutAte: hora });
      expect(x.ok, hora).toBe(false);
      if (!x.ok) expect(x.erros, hora).toEqual({ checkoutAte: "Use o formato 15:00 (24 horas)." });
    }
  });

  it("recusa incoerências", () => {
    const r = validarDetalhes({ ...form, estadiaMinima: "10", estadiaMaxima: "5", checkinAPartirDe: "25:00", cep: "123", taxaLimpeza: "abc", hospedeExtraAPartirDe: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erros).sort()).toEqual(["cep", "checkinAPartirDe", "estadiaMaxima", "hospedeExtraAPartirDe", "taxaLimpeza"]);
    const d = validarDetalhes({ precoDinamico: "on", precoMinimo: "300" });
    expect(d.ok).toBe(false);
    const inv = validarDetalhes({ precoMinimo: "500", precoMaximo: "300" });
    expect(inv.ok).toBe(false);
  });
});

describe("gravação", () => {
  it("salva, relê e registra só o que mudou no histórico do imóvel", async () => {
    expect(await lerDetalhes(db, org, im)).toEqual(DETALHES_VAZIOS);
    const r = validarDetalhes(form);
    if (!r.ok) throw new Error("inválido");
    expect(await salvarDetalhes(db, org, im, r.dados, null)).toBe(true);
    expect(await lerDetalhes(db, org, im)).toEqual(r.dados);
    await salvarDetalhes(db, org, im, { ...r.dados, precoBase: 130000 }, null);
    await salvarDetalhes(db, org, im, { ...r.dados, precoBase: 130000 }, null); // igual: não registra
    const h = await historicoDe(db, org, "imovel", im);
    expect(h).toHaveLength(2);
    expect(h[0].mudancas).toEqual({ precoBase: [120050, 130000] });
  });

  it("mudar a fonte de preços durante um envio ao Beds24 é recusado; outros campos salvam; com o envio parado, salva", async () => {
    const agora = new Date("2026-10-04T12:00:00Z");
    // Envio entre a escrita externa e o registro final (fase sem trava): a troca de fonte espera.
    const [envio] = await db.insert(beds24Envios).values({ organizacaoId: org, iniciadoEm: agora, modo: "envio", automatica: false, situacao: "executando" }).returning({ id: beds24Envios.id });
    const r = await salvarDetalhes(db, org, im, { ...DETALHES_VAZIOS, fontePrecos: "beds24" }, null, agora);
    expect(typeof r).toBe("string");
    expect(r).toContain("envio de calendário e preços em andamento");
    // A fonte "só disponibilidade" (M3.11b) passa pela mesma trava.
    expect(await salvarDetalhes(db, org, im, { ...DETALHES_VAZIOS, fontePrecos: "so_disponibilidade" }, null, agora)).toContain("envio de calendário e preços em andamento");
    expect((await lerDetalhes(db, org, im)).fontePrecos).toBe("scl");
    // Outros campos não dependem do envio.
    expect(await salvarDetalhes(db, org, im, { ...DETALHES_VAZIOS, precoBase: 50000 }, null, agora)).toBe(true);
    // Envio registrado como terminado: a troca passa.
    await db.update(beds24Envios).set({ situacao: "ok" }).where(eq(beds24Envios.id, envio.id));
    expect(await salvarDetalhes(db, org, im, { ...DETALHES_VAZIOS, precoBase: 50000, fontePrecos: "beds24" }, null, agora)).toBe(true);
    expect((await lerDetalhes(db, org, im)).fontePrecos).toBe("beds24");
  });

  it("gravação com leitura: monta os dados a partir do cadastro atual, dentro da transação; recusa não grava nada", async () => {
    const r = validarDetalhes(form);
    if (!r.ok) throw new Error("inválido");
    await salvarDetalhes(db, org, im, r.dados, null);
    // Quem edita só um campo recebe o cadastro atual (lido com o imóvel travado) e devolve o completo.
    expect(await salvarDetalhesComLeitura(db, org, im, (atual) => ({ ...atual, precoBase: 99900 }), null)).toEqual({ ok: true });
    expect(await lerDetalhes(db, org, im)).toEqual({ ...r.dados, precoBase: 99900 });
    expect((await historicoDe(db, org, "imovel", im))[0].mudancas).toEqual({ precoBase: [120050, 99900] });
    // Recusa (com erros por campo) vem do cadastro atual e não grava.
    expect(await salvarDetalhesComLeitura(db, org, im, (atual) => (atual.precoBase === 99900 ? { erro: "Confira.", erros: { precoBase: "alto" } } : atual), null)).toEqual({ ok: false, erro: "Confira.", erros: { precoBase: "alto" } });
    expect(await lerDetalhes(db, org, im)).toMatchObject({ precoBase: 99900 });
    expect(await salvarDetalhesComLeitura(db, outraOrg, im, (atual) => atual, null)).toEqual({ ok: false, erro: "Imóvel não encontrado." });
  });

  it("outra organização não lê nem grava", async () => {
    expect(await salvarDetalhes(db, outraOrg, im, DETALHES_VAZIOS, null)).toBe(false);
    expect(await salvarDetalhes(db, org, "nao-uuid", DETALHES_VAZIOS, null)).toBe(false);
    const r = validarDetalhes(form);
    if (!r.ok) throw new Error("inválido");
    await salvarDetalhes(db, org, im, r.dados, null);
    expect(await lerDetalhes(db, outraOrg, im)).toEqual(DETALHES_VAZIOS);
  });
});

describe("períodos de exceção", () => {
  const rev = { nome: "Réveillon", inicio: "2026-12-28", fim: "2027-01-01", precoNoite: "1.500", estadiaMinima: "5" };

  it("valida nome, datas e exige preço ou mínima", () => {
    expect(validarPeriodo(rev)).toMatchObject({ ok: true, dados: { precoNoite: 150000, estadiaMinima: 5 } });
    expect(validarPeriodo({ ...rev, fim: "2026-12-01" }).ok).toBe(false);
    expect(validarPeriodo({ ...rev, precoNoite: "", estadiaMinima: "" }).ok).toBe(false);
    expect(validarPeriodo({ ...rev, nome: "" }).ok).toBe(false);
    expect(validarPeriodo({ ...rev, inicio: "2026-02-30" }).ok).toBe(false);
    expect(validarPeriodo({ ...rev, precoNoite: "21474836,48" })).toEqual({ ok: false, erro: "Preço alto demais." });
    expect(validarDetalhes({ precoBase: "21474836,48" })).toMatchObject({ ok: false, erros: { precoBase: "Valor alto demais." } });
  });

  it("regra extra (`conferir`) é avaliada sobre o cadastro atual, com o imóvel travado; recusa não grava", async () => {
    const r = validarDetalhes(form);
    if (!r.ok) throw new Error("inválido");
    await salvarDetalhes(db, org, im, { ...r.dados, fontePrecos: "beds24" }, null);
    const periodo = { nome: "Natal", inicio: "2026-12-24", fim: "2026-12-26", precoNoite: "500,00", estadiaMinima: "" };
    const vistos: string[] = [];
    expect(await criarPeriodo(db, org, im, periodo, null, { conferir: (atual) => (vistos.push(atual.fontePrecos), atual.fontePrecos === "beds24" ? "preço não" : null) })).toEqual({ ok: false, erro: "preço não" });
    expect(vistos).toEqual(["beds24"]);
    expect(await listarPeriodos(db, org, im)).toEqual([]);
    expect(await criarPeriodo(db, org, im, { ...periodo, precoNoite: "", estadiaMinima: "3" }, null, { conferir: async () => null })).toEqual({ ok: true });
    const [criado] = await listarPeriodos(db, org, im);
    // Excluir também aceita a regra extra, com o imóvel do período travado; recusa não apaga.
    expect(await excluirPeriodo(db, org, criado.id, null, { conferir: async (_tx, imovelId) => (imovelId === im ? "contrato acabou" : null) })).toBe("contrato acabou");
    expect(await listarPeriodos(db, org, im)).toHaveLength(1);
    expect(await excluirPeriodo(db, org, criado.id, null, { conferir: async () => null })).toBe(true);
    expect(await listarPeriodos(db, org, im)).toEqual([]);
    // Gravação com leitura: a regra extra roda antes de preparar, com o imóvel travado.
    expect(await salvarDetalhesComLeitura(db, org, im, (atual) => atual, null, new Date(), { conferir: async () => "sem contrato" })).toEqual({ ok: false, erro: "sem contrato" });
  });

  it("só disponibilidade (M3.11b, desenho §7): nenhum período novo, com a frase do painel, em qualquer tela; a regra extra de quem chama (o portal) fala antes", async () => {
    await salvarDetalhes(db, org, im, { ...DETALHES_VAZIOS, fontePrecos: "so_disponibilidade" }, null);
    for (const entrada of [rev, { ...rev, precoNoite: "" }, { ...rev, estadiaMinima: "" }]) {
      expect(await criarPeriodo(db, org, im, entrada, null)).toEqual({ ok: false, erro: PERIODO_SO_DISPONIBILIDADE_PAINEL });
    }
    expect(await criarPeriodo(db, org, im, rev, null, { conferir: () => "a frase do portal" })).toEqual({ ok: false, erro: "a frase do portal" });
    expect(await criarPeriodo(db, org, im, rev, null, { conferir: () => null })).toEqual({ ok: false, erro: PERIODO_SO_DISPONIBILIDADE_PAINEL });
    expect(await listarPeriodos(db, org, im)).toEqual([]);
    expect(PERIODO_SO_DISPONIBILIDADE_PAINEL).toBe("Com só disponibilidade, preço e estadia mínima ficam no Beds24: períodos daqui não são enviados nem usados no site.");
    // De volta a outra fonte, o período entra.
    await salvarDetalhes(db, org, im, { ...DETALHES_VAZIOS, fontePrecos: "scl" }, null);
    expect(await criarPeriodo(db, org, im, rev, null)).toEqual({ ok: true });
  });

  it("cria, recusa sobreposição, lista em ordem e exclui", async () => {
    expect(await criarPeriodo(db, org, im, rev, null)).toEqual({ ok: true });
    expect(await criarPeriodo(db, org, im, { ...rev, nome: "Ano novo", inicio: "2027-01-01", fim: "2027-01-03" }, null)).toMatchObject({
      ok: false,
      erro: expect.stringContaining("Réveillon"),
    });
    expect(await criarPeriodo(db, org, im, { ...rev, nome: "Carnaval", inicio: "2027-02-05", fim: "2027-02-10" }, null)).toEqual({ ok: true });
    const lista = await listarPeriodos(db, org, im);
    expect(lista.map((p) => p.nome)).toEqual(["Réveillon", "Carnaval"]);
    expect(await criarPeriodo(db, outraOrg, im, { ...rev, inicio: "2028-01-01", fim: "2028-01-02" }, null)).toMatchObject({ ok: false });
    expect(await excluirPeriodo(db, outraOrg, lista[0].id, null)).toBe(false);
    expect(await excluirPeriodo(db, org, lista[0].id, null)).toBe(true);
    expect(await listarPeriodos(db, org, im)).toHaveLength(1);
    expect(await historicoDe(db, org, "imovel", im)).toHaveLength(3);
  });
});

it("fonte de preços (M3.9, M3.11b): ausente vira SCL; beds24, manual e so_disponibilidade são aceitas; valor desconhecido é erro", () => {
  expect(validarDetalhes({})).toMatchObject({ ok: true, dados: { fontePrecos: "scl" } });
  expect(validarDetalhes({ fontePrecos: "beds24" })).toMatchObject({ ok: true, dados: { fontePrecos: "beds24" } });
  expect(validarDetalhes({ fontePrecos: "manual" })).toMatchObject({ ok: true, dados: { fontePrecos: "manual" } });
  expect(validarDetalhes({ fontePrecos: "so_disponibilidade" })).toMatchObject({ ok: true, dados: { fontePrecos: "so_disponibilidade" } });
  expect(validarDetalhes({ fontePrecos: "airbnb" })).toMatchObject({ ok: false, erros: { fontePrecos: expect.any(String) } });
});

it("fontesDePrecosDosImoveis: lê a fonte gravada; imóvel sem detalhes ou de outra empresa fica no padrão SCL", async () => {
  const [{ id: semDetalhes }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "102", nome: "Cento e dois" }).returning();
  await salvarDetalhes(db, org, im, { ...DETALHES_VAZIOS, fontePrecos: "beds24" }, null);
  expect(await lerDetalhes(db, org, im)).toMatchObject({ fontePrecos: "beds24" });
  expect(await fontesDePrecosDosImoveis(db, org, [im, semDetalhes, "nao-e-uuid"])).toEqual(new Map([[im, "beds24"], [semDetalhes, "scl"], ["nao-e-uuid", "scl"]]));
  expect(await fontesDePrecosDosImoveis(db, outraOrg, [im])).toEqual(new Map([[im, "scl"]]));
  expect(await fontesDePrecosDosImoveis(db, org, [])).toEqual(new Map());
});

