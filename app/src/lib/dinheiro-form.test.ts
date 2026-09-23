import { describe, expect, it } from "vitest";
import { centavosParaCampo, reaisParaCentavos } from "./dinheiro-form";

describe("reaisParaCentavos", () => {
  it("entende os formatos comuns", () => {
    expect(reaisParaCentavos("1.234,56")).toBe(123456);
    expect(reaisParaCentavos("R$ 1.234,5")).toBe(123450);
    expect(reaisParaCentavos("1234,56")).toBe(123456);
    expect(reaisParaCentavos("1234.56")).toBe(123456);
    expect(reaisParaCentavos("1234")).toBe(123400);
    expect(reaisParaCentavos("0,07")).toBe(7);
    expect(reaisParaCentavos("")).toBeNull();
  });

  it("recusa o que não é valor", () => {
    for (const ruim of ["abc", "-10", "1,234", "12,345", "1.23.4"]) expect(reaisParaCentavos(ruim)).toBeUndefined();
  });

  it("formata para o campo", () => {
    expect(centavosParaCampo(123456)).toBe("1234,56");
    expect(centavosParaCampo(7)).toBe("0,07");
    expect(centavosParaCampo(null)).toBe("");
  });
});
