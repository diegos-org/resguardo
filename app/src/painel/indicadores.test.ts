import { describe, expect, it } from "vitest";
import { calcularOcupacao, mesesDoAno, noitesNoPeriodo, ocupacaoTotal, resumoFinanceiro } from "./indicadores";

const out = { inicio: "2026-10-01", fim: "2026-11-01" }; // 31 noites

describe("ocupação", () => {
  it("conta só as noites dentro do período", () => {
    expect(noitesNoPeriodo("2026-09-29", "2026-10-03", out.inicio, out.fim)).toBe(2);
    expect(noitesNoPeriodo("2026-10-30", "2026-11-04", out.inicio, out.fim)).toBe(2);
    expect(noitesNoPeriodo("2026-11-01", "2026-11-04", out.inicio, out.fim)).toBe(0);
  });

  it("bloqueio sai do disponível; sobreposição não conta duas vezes", () => {
    const r = calcularOcupacao(
      ["a", "b"],
      [
        { imovelId: "a", inicio: "2026-10-01", fim: "2026-10-11" }, // 10
        { imovelId: "a", inicio: "2026-10-05", fim: "2026-10-12" }, // sobreposta: +1
        { imovelId: "b", inicio: "2026-10-30", fim: "2026-11-05" }, // 2 no período
      ],
      [{ imovelId: "a", inicio: "2026-10-20", fim: "2026-10-30" }], // 10 bloqueadas
      out,
    );
    expect(r).toEqual([
      { imovelId: "a", vendidas: 11, bloqueadas: 10, disponiveis: 21, taxa: 11 / 21 },
      { imovelId: "b", vendidas: 2, bloqueadas: 0, disponiveis: 31, taxa: 2 / 31 },
    ]);
    expect(ocupacaoTotal(r)).toEqual({ vendidas: 13, disponiveis: 52, taxa: 13 / 52 });
  });

  it("imóvel todo bloqueado: taxa desconhecida (não 0%)", () => {
    const [x] = calcularOcupacao(["a"], [], [{ imovelId: "a", inicio: "2026-09-01", fim: "2026-12-01" }], out);
    expect(x.taxa).toBeNull();
    expect(ocupacaoTotal([x]).taxa).toBeNull();
  });
});

describe("financeiro", () => {
  it("resultado da empresa = comissões − despesas da empresa + ajustes; o resto é dinheiro que passa", () => {
    expect(resumoFinanceiro({ receita_bruta: 300000, taxa_canal: -45000, comissao: 38250, direito_proprietario: 216750, despesa_empresa: -10000, ajuste: -1500 })).toEqual({
      receitaBruta: 300000,
      taxasCanais: 45000,
      comissoes: 38250,
      despesasEmpresa: 10000,
      ajustesEmpresa: -1500,
      resultadoEmpresa: 26750,
    });
    expect(resumoFinanceiro({}).resultadoEmpresa).toBe(0);
    expect(Object.is(resumoFinanceiro({}).despesasEmpresa, -0)).toBe(false);
  });

  it("gráfico: 12 meses, zero onde não houve movimento", () => {
    const m = mesesDoAno(2026, new Map([["2026-03", { receitaBruta: 100, comissoes: 15 }]]));
    expect(m).toHaveLength(12);
    expect(m[2]).toEqual({ mes: 3, receitaBruta: 100, comissoes: 15 });
    expect(m[0]).toEqual({ mes: 1, receitaBruta: 0, comissoes: 0 });
  });
});
