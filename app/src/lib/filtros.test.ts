import { describe, expect, it } from "vitest";
import { comFiltros, descreverFiltros, filtrosParaQuery, hojeNoFuso, lerFiltros, manterFiltros } from "./filtros";

// 1º de outubro, 01h UTC = ainda 30 de setembro em São Paulo.
const agora = new Date("2026-10-01T01:00:00Z");

describe("hojeNoFuso", () => {
  it("usa o fuso de São Paulo", () => {
    expect(hojeNoFuso(agora)).toEqual({ ano: 2026, mes: 9 });
  });
});

describe("lerFiltros", () => {
  it("sem parâmetros: todos os imóveis, mês atual", () => {
    expect(lerFiltros({}, undefined, agora)).toEqual({ imoveis: [], ano: 2026, mes: 9 });
  });

  it("aceita imóveis repetidos ou separados por vírgula e ignora desconhecidos", () => {
    const f = lerFiltros({ imovel: ["102", "403,999", "102"] }, undefined, agora);
    expect(f.imoveis).toEqual(["102", "403"]);
  });

  it("selecionar todos equivale a nenhum filtro", () => {
    const f = lerFiltros({ imovel: "102,103,303,399,403,buzios" }, undefined, agora);
    expect(f.imoveis).toEqual([]);
  });

  it("aceita o ano inteiro e ignora valores inválidos", () => {
    expect(lerFiltros({ ano: "2025", mes: "todos" }, undefined, agora)).toMatchObject({ ano: 2025, mes: null });
    expect(lerFiltros({ ano: "abc", mes: "13" }, undefined, agora)).toMatchObject({ ano: 2026, mes: 9 });
    expect(lerFiltros({ mes: "0" }, undefined, agora).mes).toBe(9);
  });
});

describe("filtrosParaQuery", () => {
  it("é o inverso de lerFiltros", () => {
    const f = { imoveis: ["103", "buzios"], ano: 2027, mes: null };
    const params = Object.fromEntries(
      [...new URLSearchParams(filtrosParaQuery(f)).entries()].reduce((m, [k, v]) => m.set(k, [...(m.get(k) ?? []), v]), new Map<string, string[]>()),
    );
    expect(lerFiltros(params, undefined, agora)).toEqual(f);
  });
});

describe("descreverFiltros", () => {
  it("descreve a seleção em português", () => {
    expect(descreverFiltros({ imoveis: [], ano: 2026, mes: 9 })).toBe("Todos os imóveis · setembro de 2026");
    expect(descreverFiltros({ imoveis: ["403", "buzios"], ano: 2027, mes: null })).toBe("403, Búzios · ano de 2027");
  });
});

describe("manterFiltros", () => {
  it("mantém só os parâmetros do filtro", () => {
    expect(manterFiltros({ imovel: ["403", "102"], ano: "2025", mes: "todos", outro: "x" })).toBe("?imovel=403&imovel=102&ano=2025&mes=todos");
    expect(manterFiltros(new URLSearchParams("mes=3&pagina=2"))).toBe("?mes=3");
    expect(manterFiltros({})).toBe("");
  });
});

describe("periodoDosFiltros", () => {
  it("mês, dezembro e ano inteiro", async () => {
    const { periodoDosFiltros } = await import("./filtros");
    expect(periodoDosFiltros({ imoveis: [], ano: 2026, mes: 9 })).toEqual({ inicio: "2026-09-01", fim: "2026-10-01" });
    expect(periodoDosFiltros({ imoveis: [], ano: 2026, mes: 12 })).toEqual({ inicio: "2026-12-01", fim: "2027-01-01" });
    expect(periodoDosFiltros({ imoveis: [], ano: 2027, mes: null })).toEqual({ inicio: "2027-01-01", fim: "2028-01-01" });
  });
});

describe("comFiltros", () => {
  it("junta os filtros a links com e sem parâmetros próprios (alertas do Início)", () => {
    expect(comFiltros("/painel/reservas", "?ano=2026&mes=10")).toBe("/painel/reservas?ano=2026&mes=10");
    expect(comFiltros("/painel/financeiro/pagamentos-site?atencao=1", "?ano=2026")).toBe("/painel/financeiro/pagamentos-site?atencao=1&ano=2026");
    expect(comFiltros("/painel/financeiro/pagamentos-site?atencao=1", "")).toBe("/painel/financeiro/pagamentos-site?atencao=1");
  });
});
