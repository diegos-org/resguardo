import { describe, expect, it } from "vitest";
import { lerFormReserva } from "./formulario";

const base = {
  imovelId: "00000000-0000-4000-8000-000000000000",
  origem: "booking",
  checkin: "2026-11-01",
  checkout: "2026-11-04",
  hospedes: "3",
  hospedeNome: "Hóspede",
  valorBruto: "2.100,00",
  taxaCanal: "315",
  valorLiquido: "",
};

describe("lerFormReserva", () => {
  it("converte reais em centavos e aplica padrões", () => {
    const r = lerFormReserva(base);
    expect(r.ok && r.dados).toMatchObject({ estado: "confirmada", hospedes: 3, valorBruto: 210000, taxaCanal: 31500, valorLiquido: null, moeda: "BRL" });
  });

  it("junta erros do formulário e das regras", () => {
    const r = lerFormReserva({ ...base, imovelId: "", origem: "vrbo", checkout: "2026-10-01", valorBruto: "dez", hospedes: "2,5" });
    expect(!r.ok && Object.keys(r.erros).sort()).toEqual(["checkout", "hospedes", "imovelId", "origem", "valorBruto"]);
  });
});
