import { describe, expect, it } from "vitest";
import { cotarEstadia, diaDaSemana, precoDaNoite, type Periodo, type RegrasVenda, verificarEstadia } from "./regras-venda";

const base: RegrasVenda = {
  estadiaMinima: 3,
  estadiaMaxima: 30,
  antecedenciaMinima: 1,
  janelaMaxima: 365,
  diasChegada: [],
  diasSaida: [],
  precoBase: 50000,
  precoDinamico: false,
  precoMinimo: null,
  precoMaximo: null,
  taxaLimpeza: 25000,
  hospedeExtraValor: 5000,
  hospedeExtraAPartirDe: 5,
};
const reveillon: Periodo = { nome: "Réveillon", inicio: "2026-12-28", fim: "2027-01-01", precoNoite: 150000, estadiaMinima: 5 };

describe("preço da noite", () => {
  it("usa o período quando a noite cai nele, senão o preço base", () => {
    expect(precoDaNoite(base, [reveillon], "2026-12-27")).toMatchObject({ valor: 50000, fonte: "base" });
    expect(precoDaNoite(base, [reveillon], "2026-12-28")).toMatchObject({ valor: 150000, fonte: "periodo", periodo: "Réveillon" });
    expect(precoDaNoite(base, [reveillon], "2027-01-01")).toMatchObject({ valor: 150000 });
    expect(precoDaNoite(base, [reveillon], "2027-01-02")).toMatchObject({ valor: 50000 });
  });

  it("período só com estadia mínima mantém o preço base", () => {
    expect(precoDaNoite(base, [{ ...reveillon, precoNoite: null }], "2026-12-30")).toMatchObject({ valor: 50000, fonte: "base" });
  });

  it("sem preço base nem período: sem preço (nunca chuta)", () => {
    expect(precoDaNoite({ ...base, precoBase: null }, [], "2026-10-10")).toEqual({ data: "2026-10-10", valor: null, fonte: "sem_preco" });
  });

  it("preço dinâmico ligado limita ao mínimo e ao máximo; desligado, não", () => {
    const din = { ...base, precoDinamico: true, precoMinimo: 60000, precoMaximo: 120000 };
    expect(precoDaNoite(din, [], "2026-10-10")).toMatchObject({ valor: 60000, ajustado: true });
    expect(precoDaNoite(din, [reveillon], "2026-12-29")).toMatchObject({ valor: 120000, ajustado: true });
    expect(precoDaNoite({ ...din, precoDinamico: false }, [reveillon], "2026-12-29").valor).toBe(150000);
  });
});

describe("verificar estadia", () => {
  const hoje = "2026-10-01";
  it("estadia dentro das regras passa", () => {
    expect(verificarEstadia(base, [reveillon], "2026-10-10", "2026-10-14", hoje)).toEqual([]);
  });

  it("mínima do período vale para entrada dentro dele", () => {
    expect(verificarEstadia(base, [reveillon], "2026-12-29", "2027-01-02", hoje)).toEqual(["Estadia mínima de 5 noite(s) em Réveillon."]);
    expect(verificarEstadia(base, [reveillon], "2026-12-20", "2026-12-22", hoje)).toEqual(["Estadia mínima de 3 noite(s)."]);
  });

  it("máxima, antecedência, janela e datas invertidas", () => {
    expect(verificarEstadia(base, [], "2026-10-10", "2026-11-20", hoje)).toContain("Estadia máxima de 30 noite(s).");
    expect(verificarEstadia(base, [], "2026-10-01", "2026-10-05", hoje)).toContain("Precisa reservar com 1 dia(s) de antecedência.");
    expect(verificarEstadia(base, [], "2026-09-20", "2026-09-25", hoje)).toContain("A entrada já passou.");
    expect(verificarEstadia(base, [], "2027-12-01", "2027-12-05", hoje)).toContain("Aceita reservas só até 365 dias à frente.");
    expect(verificarEstadia(base, [], "2026-10-10", "2026-10-10", hoje)).toEqual(["A saída precisa ser depois da entrada."]);
  });

  it("dias de chegada e saída", () => {
    expect(diaDaSemana("2026-10-10")).toBe(6); // sábado
    const r = { ...base, diasChegada: [5, 6], diasSaida: [0] };
    expect(verificarEstadia(r, [], "2026-10-10", "2026-10-18", hoje)).toEqual([]);
    expect(verificarEstadia(r, [], "2026-10-12", "2026-10-16", hoje)).toEqual(["Entrada só em: sexta, sábado.", "Saída só em: domingo."]);
  });

  it("sem regras cadastradas, nada é bloqueado (além de datas impossíveis)", () => {
    const livre: RegrasVenda = { ...base, estadiaMinima: null, estadiaMaxima: null, antecedenciaMinima: null, janelaMaxima: null };
    expect(verificarEstadia(livre, [], "2026-10-01", "2026-10-02", hoje)).toEqual([]);
  });
});

describe("cotação", () => {
  it("soma diárias (atravessando o período), limpeza e hóspede extra por noite", () => {
    const c = cotarEstadia(base, [reveillon], "2026-12-26", "2026-12-30", 6);
    // 26, 27 = base; 28, 29 = Réveillon
    expect(c.diarias).toBe(50000 * 2 + 150000 * 2);
    expect(c.limpeza).toBe(25000);
    expect(c.hospedeExtra).toBe(2 * 5000 * 4); // 5º e 6º hóspedes, 4 noites
    expect(c.total).toBe(400000 + 25000 + 40000);
    expect(c.avisos).toEqual([]);
  });

  it("até o limite de hóspedes não cobra extra", () => {
    expect(cotarEstadia(base, [], "2026-10-10", "2026-10-12", 4).hospedeExtra).toBe(0);
    expect(cotarEstadia(base, [], "2026-10-10", "2026-10-12", 5).hospedeExtra).toBe(2 * 5000);
  });

  it("noite sem preço deixa o total pendente, com aviso", () => {
    const c = cotarEstadia({ ...base, precoBase: null, taxaLimpeza: null }, [reveillon], "2026-12-27", "2026-12-29", 2);
    expect(c.total).toBeNull();
    expect(c.avisos).toEqual(["Sem preço definido para 1 noite(s): cadastre o preço base ou um período.", "Taxa de limpeza não cadastrada: considerada zero."]);
  });
});
