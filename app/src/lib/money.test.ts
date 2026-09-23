import { describe, expect, it } from "vitest";
import { assertCents, formatBRL } from "./money";

describe("formatBRL", () => {
  it("formata centavos em reais", () => {
    expect(formatBRL(123456)).toBe("R$ 1.234,56");
    expect(formatBRL(0)).toBe("R$ 0,00");
    expect(formatBRL(-4000_00)).toBe("-R$ 4.000,00");
  });

  it("rejeita valores que não são centavos inteiros", () => {
    expect(() => formatBRL(10.5)).toThrow(TypeError);
    expect(() => assertCents(Number.NaN)).toThrow(TypeError);
  });
});
