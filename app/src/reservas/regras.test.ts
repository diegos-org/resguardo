import { describe, expect, it } from "vitest";
import { conflitos, dataValida, type DadosReserva, gerarCodigo, noites, periodosCruzam, validarReserva } from "./regras";

const reservaBase = (over: Partial<DadosReserva> = {}): DadosReserva => ({
  imovelId: "00000000-0000-4000-8000-000000000000",
  origem: "airbnb",
  estado: "confirmada",
  checkin: "2026-10-10",
  checkout: "2026-10-13",
  hospedes: 2,
  hospedeNome: "Hóspede Teste",
  hospedeEmail: "",
  hospedeTelefone: "",
  hospedeOrigem: "",
  moeda: "BRL",
  valorBruto: 150000,
  taxaCanal: 22500,
  valorLiquido: 127500,
  codigoCanal: "",
  observacoes: "",
  ...over,
});

describe("datas e noites", () => {
  it("valida datas reais e conta noites", () => {
    expect(dataValida("2028-02-29")).toBe(true);
    expect(dataValida("2027-02-29")).toBe(false);
    expect(noites("2026-10-10", "2026-10-13")).toBe(3);
    expect(noites("2026-12-30", "2027-01-02")).toBe(3);
  });

  it("saída e entrada no mesmo dia não conflitam", () => {
    expect(periodosCruzam({ inicio: "2026-10-10", fim: "2026-10-13" }, { inicio: "2026-10-13", fim: "2026-10-15" })).toBe(false);
    expect(periodosCruzam({ inicio: "2026-10-10", fim: "2026-10-13" }, { inicio: "2026-10-12", fim: "2026-10-15" })).toBe(true);
  });
});

describe("conflitos (overbooking)", () => {
  it("acha sobreposição no mesmo imóvel, ignora canceladas e outros imóveis", () => {
    const r = (id: string, imovelId: string, checkin: string, checkout: string, estado: "confirmada" | "cancelada" = "confirmada") => ({
      id,
      imovelId,
      checkin,
      checkout,
      estado,
    });
    const lista = [
      r("a", "x", "2026-10-01", "2026-10-05"),
      r("b", "y", "2026-10-02", "2026-10-04"),
      r("c", "x", "2026-10-04", "2026-10-06"),
      r("d", "x", "2026-10-03", "2026-10-04", "cancelada"),
      r("e", "x", "2026-10-06", "2026-10-08"),
    ];
    expect(conflitos(lista)).toEqual([["a", "c"]]);
  });
});

describe("validarReserva", () => {
  it("aceita reserva correta", () => {
    expect(validarReserva(reservaBase())).toEqual({});
  });

  it("recusa saída antes da entrada, valores negativos ou quebrados e hóspedes fora da faixa", () => {
    const e = validarReserva(reservaBase({ checkout: "2026-10-10", valorBruto: -1, taxaCanal: 10.5, hospedes: 0, moeda: "real" }));
    expect(Object.keys(e).sort()).toEqual(["checkout", "hospedes", "moeda", "taxaCanal", "valorBruto"]);
  });

  it("valor líquido desconhecido é permitido (null)", () => {
    expect(validarReserva(reservaBase({ valorLiquido: null, taxaCanal: null }))).toEqual({});
  });
});

describe("gerarCodigo", () => {
  it("formato SCL-XXXXXX sem caracteres ambíguos", () => {
    for (let i = 0; i < 50; i++) expect(gerarCodigo()).toMatch(/^SCL-[A-HJ-NP-Z2-9]{6}$/);
  });
});


it("consulta sobreposta não é overbooking; pedido conserva a restrição", () => {
  const r = { imovelId: "x", checkin: "2027-06-01", checkout: "2027-06-05" };
  expect(conflitos([{ ...r, id: "a", estado: "confirmada" }, { ...r, id: "b", estado: "consulta" }])).toEqual([]);
  expect(conflitos([{ ...r, id: "a", estado: "confirmada" }, { ...r, id: "b", estado: "pedido" }])).toEqual([["a", "b"]]);
});
