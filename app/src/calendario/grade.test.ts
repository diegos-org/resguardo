import { describe, expect, it } from "vitest";
import { diasDoPeriodo, type ItemCalendario, mesesVizinhos, montarCalendario } from "./grade";

const outubro = { inicio: "2026-10-01", fim: "2026-11-01" };
const item = (id: string, imovelId: string, inicio: string, fim: string, tipo: "reserva" | "bloqueio" = "reserva"): ItemCalendario => ({
  id,
  imovelId,
  inicio,
  fim,
  tipo,
  rotulo: id,
  categoria: tipo === "reserva" ? "airbnb" : "bloqueio",
});

describe("diasDoPeriodo", () => {
  it("lista os dias de um mês", () => {
    const d = diasDoPeriodo(outubro.inicio, outubro.fim);
    expect(d).toHaveLength(31);
    expect(d[0]).toBe("2026-10-01");
    expect(d[30]).toBe("2026-10-31");
    expect(diasDoPeriodo("2028-02-01", "2028-03-01")).toHaveLength(29);
  });
});

describe("montarCalendario", () => {
  it("ocupa as noites: entrada dia 10, saída dia 13 = colunas 10 a 12", () => {
    const [linha] = montarCalendario(outubro, ["x"], [item("a", "x", "2026-10-10", "2026-10-13")]);
    expect(linha.segmentos[0]).toMatchObject({ coluna: 10, largura: 3, continuaAntes: false, continuaDepois: false, faixa: 0 });
  });

  it("corta nas bordas do mês e marca continuação", () => {
    const [linha] = montarCalendario(outubro, ["x"], [item("a", "x", "2026-09-28", "2026-10-03"), item("b", "x", "2026-10-30", "2026-11-04")]);
    expect(linha.segmentos.map((s) => [s.coluna, s.largura, s.continuaAntes, s.continuaDepois])).toEqual([
      [1, 2, true, false],
      [30, 2, false, true],
    ]);
  });

  it("saída e entrada no mesmo dia ficam na mesma faixa; sobreposição abre outra faixa", () => {
    const [linha] = montarCalendario(outubro, ["x"], [
      item("a", "x", "2026-10-01", "2026-10-05"),
      item("b", "x", "2026-10-05", "2026-10-08"),
      item("c", "x", "2026-10-06", "2026-10-07"),
    ]);
    expect(linha.segmentos.map((s) => [s.id, s.faixa])).toEqual([
      ["a", 0],
      ["b", 0],
      ["c", 1],
    ]);
    expect(linha.faixas).toBe(2);
  });

  it("separa por imóvel e ignora o que está fora do período", () => {
    const linhas = montarCalendario(outubro, ["x", "y"], [item("a", "x", "2026-10-01", "2026-10-02"), item("b", "y", "2026-11-01", "2026-11-02")]);
    expect(linhas.map((l) => l.segmentos.length)).toEqual([1, 0]);
    expect(linhas[1].faixas).toBe(1);
  });
});

describe("mesesVizinhos", () => {
  it("vira o ano", () => {
    expect(mesesVizinhos(2026, 12).seguinte).toEqual({ ano: 2027, mes: 1 });
    expect(mesesVizinhos(2027, 1).anterior).toEqual({ ano: 2026, mes: 12 });
  });
});
