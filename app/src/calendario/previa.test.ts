import { describe, expect, it } from "vitest";
import { DETALHES_VAZIOS, regrasDeVenda } from "@/imoveis/detalhes";
import { montarPrevia, validarIntervaloPrevia } from "./previa";

const entrada = {
  inicio: "2026-12-28", fim: "2026-12-30", hoje: "2026-12-28",
  regras: regrasDeVenda({ ...DETALHES_VAZIOS, precoBase: 45000, estadiaMinima: 2 }),
  periodos: [], reservas: [], bloqueios: [], observacoes: [],
};
const obs = { data: "2026-12-28", preco: 45000, minimoNoites: 2, livres: 1, observadoEm: new Date("2026-12-27T15:00:00Z") };

describe("intervalo da conferência", () => {
  it("aceita uma noite e exatamente 92 noites, inclusive ano bissexto", () => {
    expect(validarIntervaloPrevia("2026-12-28", "2026-12-28")).toBeNull();
    expect(validarIntervaloPrevia("2026-10-01", "2026-12-31")).toBeNull();
    expect(validarIntervaloPrevia("2028-02-29", "2028-02-29")).toBeNull();
  });
  it.each([["2026-02-29", "2026-03-01"], ["x", "2026-03-01"], ["2026-12-31", "2026-12-30"], ["2026-10-01", "2027-01-01"], ["0010-01-01", "0010-01-01"], ["9999-12-31", "9999-12-31"]])("recusa intervalo inválido ou excessivo: %s / %s", (inicio, fim) => {
    expect(validarIntervaloPrevia(inicio, fim)).not.toBeNull();
    expect(() => montarPrevia({ ...entrada, inicio, fim })).toThrow();
  });
});

it("gera primeira e última noite e mantém ausência diferente de zero/igualdade", () => {
  const linhas = montarPrevia(entrada);
  expect(linhas.map(l => l.data)).toEqual(["2026-12-28", "2026-12-29", "2026-12-30"]);
  expect(linhas[0]).toMatchObject({ comparacaoPreco: "sem_dados", comparacaoMinimo: "sem_dados", observacao: null, reservas: 0 });
  expect(linhas[0].avisos).toContain("Sem leitura do Beds24 para esta noite; disponibilidade desconhecida.");
  const [zero] = montarPrevia({ ...entrada, observacoes: [{ ...obs, preco: 0, minimoNoites: 0, livres: 0 }] });
  expect(zero).toMatchObject({ comparacaoPreco: "diferente", comparacaoMinimo: "diferente", observacao: { livres: 0, preco: 0 } });
});

it("mostra igualdade apenas nos campos conhecidos e mantém a data da observação", () => {
  const [l] = montarPrevia({ ...entrada, observacoes: [obs] });
  expect(l).toMatchObject({ comparacaoPreco: "igual", comparacaoMinimo: "igual", observacao: obs });
  expect(montarPrevia({ ...entrada, observacoes: [{ ...obs, preco: null, livres: null }] })[0]).toMatchObject({ comparacaoPreco: "sem_dados", comparacaoMinimo: "igual" });
});

it("protege reservas e bloqueios; checkout e fim de bloqueio não ocupam a noite seguinte", () => {
  const linhas = montarPrevia({ ...entrada, observacoes: [obs], reservas: [
    { checkin: "2026-12-27", checkout: "2026-12-29", estado: "confirmada" },
    { checkin: "2026-12-29", checkout: "2026-12-30", estado: "pedido" },
    { checkin: "2026-12-28", checkout: "2026-12-31", estado: "consulta" },
    { checkin: "2026-12-28", checkout: "2026-12-31", estado: "cancelada" },
  ], bloqueios: [{ inicio: "2026-12-28", fim: "2026-12-29" }] });
  expect(linhas.map(l => [l.reservas, l.bloqueios])).toEqual([[1, 1], [1, 0], [0, 0]]);
  expect(linhas[0].avisos).toContain("Beds24 informou unidades livres, mas há reserva ou bloqueio no SCL: conferir.");
  expect(linhas[0].avisos).toContain("Reserva e bloqueio se sobrepõem nesta noite.");
});

it("preço explícito supera o teto e não recebe descontos implícitos de última hora", () => {
  const linhas = montarPrevia({ ...entrada, regras: { ...entrada.regras, precoDinamico: true, precoMaximo: 60000 }, periodos: [
    { nome: "Evento", inicio: "2026-12-28", fim: "2026-12-29", precoNoite: 180000, estadiaMinima: 5 },
  ] });
  expect(linhas.map(l => [l.preco.valor, l.minimo])).toEqual([[180000, 5], [180000, 5], [45000, 2]]);
});

it("aplica restrições locais de dia, antecedência e horizonte sem afirmar disponibilidade", () => {
  const linhas = montarPrevia({ ...entrada, regras: { ...entrada.regras, diasChegada: [1, 2], diasSaida: [3], antecedenciaMinima: 1, janelaMaxima: 1 } });
  expect(linhas.map(l => [l.entradaPeloCadastro, l.saidaPeloCadastro])).toEqual([[false, false], [true, false], [false, true]]);
});

it("sinaliza passado e mínimo de período incompatível com máximo", () => {
  const [l] = montarPrevia({ ...entrada, hoje: "2026-12-29", regras: { ...entrada.regras, estadiaMaxima: 2 }, periodos: [
    { nome: "Evento", inicio: "2026-12-28", fim: "2026-12-29", precoNoite: null, estadiaMinima: 5 },
  ] });
  expect(l.avisos).toContain("Noite passada: o cadastro atual não reconstitui a tarifa histórica.");
  expect(l.avisos).toContain("Mínimo do período supera a estadia máxima do cadastro.");
  expect(l.entradaPeloCadastro).toBe(false);
});
