import { describe, expect, it } from "vitest";
import { janela, lerPeriodoPortal, mesesDaJanela, situacaoDoPeriodo, vizinhos } from "./periodo";

const agora = new Date("2026-09-24T15:00:00Z");
const opcoes = [
  { codigo: "403", nome: "Quatro" },
  { codigo: "102", nome: "Um" },
];

describe("período do portal", () => {
  it("janela de nove meses para cada lado do mês atual", () => {
    expect(janela(agora)).toEqual({ de: { ano: 2025, mes: 12 }, ate: { ano: 2027, mes: 6 }, atual: { ano: 2026, mes: 9 } });
    expect(mesesDaJanela(agora)).toHaveLength(19);
  });

  it("mês atual é parcial; passado fechado; futuro previsto (também para o ano)", () => {
    expect(situacaoDoPeriodo({ ano: 2026, mes: 9 }, agora)).toBe("parcial");
    expect(situacaoDoPeriodo({ ano: 2026, mes: 8 }, agora)).toBe("fechado");
    expect(situacaoDoPeriodo({ ano: 2026, mes: 10 }, agora)).toBe("futuro");
    expect(situacaoDoPeriodo({ ano: 2026, mes: null }, agora)).toBe("parcial");
    expect(situacaoDoPeriodo({ ano: 2025, mes: null }, agora)).toBe("fechado");
  });

  it("padrão é o mês atual e todos os imóveis dele; imóvel de outro dono é ignorado", () => {
    expect(lerPeriodoPortal({}, opcoes, agora)).toEqual({ filtros: { imoveis: [], ano: 2026, mes: 9 } });
    expect(lerPeriodoPortal({ imovel: ["403", "999"] }, opcoes, agora).filtros.imoveis).toEqual(["403"]);
  });

  it("fora da janela volta ao limite e avisa", () => {
    expect(lerPeriodoPortal({ ano: "2027", mes: "12" }, opcoes, agora)).toMatchObject({ filtros: { ano: 2027, mes: 6 }, aviso: expect.stringContaining("junho de 2027") });
    expect(lerPeriodoPortal({ ano: "2024", mes: "1" }, opcoes, agora)).toMatchObject({ filtros: { ano: 2025, mes: 12 }, aviso: expect.stringContaining("dezembro de 2025") });
    expect(lerPeriodoPortal({ ano: "2030", mes: "todos" }, opcoes, agora)).toMatchObject({ filtros: { ano: 2026, mes: null }, aviso: expect.any(String) });
    expect(lerPeriodoPortal({ ano: "2027", mes: "todos" }, opcoes, agora).aviso).toBeUndefined();
  });

  it("setas param na janela", () => {
    expect(vizinhos({ ano: 2026, mes: 9 }, agora)).toEqual({ anterior: { ano: 2026, mes: 8 }, seguinte: { ano: 2026, mes: 10 } });
    expect(vizinhos({ ano: 2027, mes: 6 }, agora).seguinte).toBeNull();
    expect(vizinhos({ ano: 2025, mes: 12 }, agora).anterior).toBeNull();
    expect(vizinhos({ ano: 2026, mes: 1 }, agora).anterior).toEqual({ ano: 2025, mes: 12 });
    expect(vizinhos({ ano: 2026, mes: null }, agora)).toEqual({ anterior: { ano: 2025, mes: null }, seguinte: { ano: 2027, mes: null } });
    expect(vizinhos({ ano: 2025, mes: null }, agora).anterior).toBeNull();
  });
});
