import { describe, expect, it } from "vitest";
import { validarIntervaloPrevia } from "./previa";

describe("intervalo da conferência", () => {
  it("aceita uma noite e exatamente 92 noites, inclusive ano bissexto", () => {
    expect(validarIntervaloPrevia("2026-12-28", "2026-12-28")).toBeNull();
    expect(validarIntervaloPrevia("2026-10-01", "2026-12-31")).toBeNull();
    expect(validarIntervaloPrevia("2028-02-29", "2028-02-29")).toBeNull();
  });
  it.each([["2026-02-29", "2026-03-01"], ["x", "2026-03-01"], ["2026-12-31", "2026-12-30"], ["2026-10-01", "2027-01-01"], ["0010-01-01", "0010-01-01"], ["9999-12-31", "9999-12-31"]])("recusa intervalo inválido ou excessivo: %s / %s", (inicio, fim) => {
    expect(validarIntervaloPrevia(inicio, fim)).not.toBeNull();
  });
});
