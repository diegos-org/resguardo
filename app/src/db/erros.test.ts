import { describe, expect, it } from "vitest";
import { travaOcupada, violouUnicidade } from "./erros";

describe("erros do Postgres", () => {
  it("trava não obtida: tempo-limite (55P03) e impasse (40P01), direto ou embrulhado", () => {
    expect(travaOcupada({ code: "55P03" })).toBe(true);
    expect(travaOcupada({ code: "40P01" })).toBe(true);
    expect(travaOcupada(new Error("drizzle", { cause: { code: "40P01" } }))).toBe(true);
    expect(travaOcupada({ code: "23505" })).toBe(false);
    expect(travaOcupada(new Error("outro"))).toBe(false);
    expect(travaOcupada(null)).toBe(false);
  });

  it("violação de unicidade, com ou sem o índice", () => {
    expect(violouUnicidade({ code: "23505", constraint: "x" }, "x")).toBe(true);
    expect(violouUnicidade({ code: "23505", constraint: "y" }, "x")).toBe(false);
    expect(violouUnicidade({ code: "40P01" })).toBe(false);
  });
});
