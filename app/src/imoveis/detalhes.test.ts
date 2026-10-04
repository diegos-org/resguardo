import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { imoveis, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { criarPeriodo, DETALHES_VAZIOS, excluirPeriodo, fontesDePrecosDosImoveis, lerDetalhes, listarPeriodos, salvarDetalhes, validarDetalhes, validarPeriodo } from "./detalhes";

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

it("fonte de preços (M3.9): ausente vira SCL; beds24 e manual são aceitas; valor desconhecido é erro", () => {
  expect(validarDetalhes({})).toMatchObject({ ok: true, dados: { fontePrecos: "scl" } });
  expect(validarDetalhes({ fontePrecos: "beds24" })).toMatchObject({ ok: true, dados: { fontePrecos: "beds24" } });
  expect(validarDetalhes({ fontePrecos: "manual" })).toMatchObject({ ok: true, dados: { fontePrecos: "manual" } });
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

