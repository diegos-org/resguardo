import { describe, expect, it } from "vitest";
import { calcularReserva, comissao, noitesPorMes, ratear, REGRAS_PADRAO, reservaCalculadaPeloMotor, type ReservaParaMotor } from "./motor";

const reserva = (over: Partial<ReservaParaMotor> = {}): ReservaParaMotor => ({
  id: "r1",
  codigo: "SCL-TESTE1",
  imovelId: "i1",
  origem: "booking",
  estado: "confirmada",
  checkin: "2026-10-10",
  checkout: "2026-10-13",
  valorBruto: 150000,
  taxaCanal: 22500,
  recebimento: null,
  ...over,
});
const quinzePorCento = [{ tipo: "gestao_completa" as const, comissaoBp: 1500, inicio: "2025-01-01", fim: null }];
const soma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("utilitários", () => {
  it("noites por mês na virada", () => {
    expect(noitesPorMes("2026-10-29", "2026-11-02")).toEqual([
      ["2026-10", 3],
      ["2026-11", 1],
    ]);
    expect(noitesPorMes("2026-12-31", "2027-01-01")).toEqual([["2026-12", 1]]);
  });

  it("rateio nunca perde nem cria centavo", () => {
    expect(ratear(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(ratear(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    for (const total of [1, 7, 99999, 123457]) expect(soma(ratear(total, [3, 1, 5]))).toBe(total);
    expect(ratear(50, [0, 0])).toEqual([0, 0]);
  });

  it("comissão arredonda meio centavo para cima", () => {
    expect(comissao(127500, 1500)).toBe(19125);
    expect(comissao(100003, 1500)).toBe(15000); // 15000,45 → 15000
    expect(comissao(100010, 1500)).toBe(15002); // 15001,5 → 15002
    expect(comissao(-100010, 1500)).toBe(-15002);
  });
});

describe("calcularReserva", () => {
  it("Booking (empresa recebe tudo): comissão sobre o líquido do canal e parte do proprietário no acerto", () => {
    const { lancamentos, avisos } = calcularReserva(reserva(), quinzePorCento, ["p1"]);
    expect(avisos).toEqual([]);
    const por = Object.fromEntries(lancamentos.map((l) => [l.tipo, l]));
    expect(por.receita_bruta.valor).toBe(150000);
    expect(por.taxa_canal.valor).toBe(-22500);
    expect(por.comissao.valor).toBe(19125); // 15% de 127.500
    expect(por.direito_proprietario).toMatchObject({ valor: 108375, efeitoSaldo: 108375, proprietarioId: "p1" });
    expect(lancamentos.every((l) => l.competencia === "2026-10-01" && l.chaveOrigem?.startsWith("reserva:r1:"))).toBe(true);
  });

  it("Airbnb confirmado como split: parte do proprietário não entra no acerto", () => {
    const { lancamentos } = calcularReserva(reserva({ origem: "airbnb", recebimento: "split" }), quinzePorCento, ["p1"]);
    const direito = lancamentos.find((l) => l.tipo === "direito_proprietario")!;
    expect(direito.efeitoSaldo).toBe(0);
    expect(direito.estado).toBe("previsto");
    expect(direito.descricao).toContain("paga direto pelo canal");
  });

  it("Airbnb sem nada gravado na reserva: split por padrão (decisão de 24/09)", () => {
    const { lancamentos } = calcularReserva(reserva({ origem: "airbnb" }), quinzePorCento, ["p1"]);
    expect(lancamentos.find((l) => l.tipo === "direito_proprietario")).toMatchObject({ efeitoSaldo: 0, estado: "previsto" });
  });

  it("ordem de prioridade: reserva > configuração do imóvel > padrão", () => {
    const direito = (r: Partial<ReservaParaMotor>, imovel = {}) =>
      calcularReserva(reserva(r), quinzePorCento, ["p1"], REGRAS_PADRAO, imovel).lancamentos.find((l) => l.tipo === "direito_proprietario")!.efeitoSaldo;
    expect(direito({ origem: "booking" })).toBe(108375); // padrão: empresa recebe
    expect(direito({ origem: "booking" }, { booking: "split" })).toBe(0); // imóvel diz split
    expect(direito({ origem: "booking", recebimento: "empresa" }, { booking: "split" })).toBe(108375); // reserva manda
    expect(direito({ origem: "airbnb" }, { airbnb: "empresa" })).toBe(108375);
  });

  it("regra 'a confirmar' (para canal novo): acerto pendente e aviso", () => {
    const regras = { ...REGRAS_PADRAO, recebimento: { ...REGRAS_PADRAO.recebimento, outro: "a_confirmar" as const } };
    const { lancamentos, avisos } = calcularReserva(reserva({ origem: "outro" }), quinzePorCento, ["p1"], regras);
    expect(lancamentos.find((l) => l.tipo === "direito_proprietario")).toMatchObject({ efeitoSaldo: 0, estado: "pendente" });
    expect(avisos.some((a) => a.includes("split"))).toBe(true);
  });

  it("Airbnb em que a empresa recebe tudo: parte do proprietário entra no acerto", () => {
    const { lancamentos } = calcularReserva(reserva({ origem: "airbnb", recebimento: "empresa" }), quinzePorCento, ["p1"]);
    expect(lancamentos.find((l) => l.tipo === "direito_proprietario")).toMatchObject({ efeitoSaldo: 108375, proprietarioId: "p1" });
  });

  it("estadia entre meses: rateio pelas noites, somas exatas", () => {
    const { lancamentos } = calcularReserva(reserva({ checkin: "2026-10-29", checkout: "2026-11-02", valorBruto: 100001, taxaCanal: 15001 }), quinzePorCento, ["p1"]);
    const doTipo = (t: string) => lancamentos.filter((l) => l.tipo === t);
    expect(doTipo("receita_bruta").map((l) => l.competencia)).toEqual(["2026-10-01", "2026-11-01"]);
    expect(soma(doTipo("receita_bruta").map((l) => l.valor))).toBe(100001);
    expect(soma(doTipo("comissao").map((l) => l.valor)) + soma(doTipo("direito_proprietario").map((l) => l.valor))).toBe(100001 - 15001);
    expect(doTipo("comissao")[0].descricao).toContain("3 de 4 noites");
  });

  it("usa o contrato vigente na data de entrada (virada 2026→2027)", () => {
    const contratos = [
      { tipo: "gestao_completa" as const, comissaoBp: 2000, inicio: "2025-01-01", fim: "2026-12-31" },
      { tipo: "gestao_completa" as const, comissaoBp: 1500, inicio: "2027-01-01", fim: null },
    ];
    const antes = calcularReserva(reserva({ checkin: "2026-12-30", checkout: "2027-01-02", taxaCanal: 0, valorBruto: 30000 }), contratos, ["p1"]);
    const depois = calcularReserva(reserva({ checkin: "2027-01-01", checkout: "2027-01-04", taxaCanal: 0, valorBruto: 30000 }), contratos, ["p1"]);
    const totalComissao = (r: typeof antes) => soma(r.lancamentos.filter((l) => l.tipo === "comissao").map((l) => l.valor));
    expect(totalComissao(antes)).toBe(6000);
    expect(totalComissao(depois)).toBe(4500);
  });

  it("base 'bruto' quando configurado", () => {
    const { lancamentos } = calcularReserva(reserva(), quinzePorCento, ["p1"], {
      base: "bruto",
      recebimento: { airbnb: "split", booking: "empresa", site: "empresa", direta: "empresa", outro: "empresa" },
    });
    expect(lancamentos.find((l) => l.tipo === "comissao")!.valor).toBe(22500);
  });

  it("reserva pendente não gera lançamentos até ser confirmada (M4.8)", () => {
    const r = calcularReserva(reserva({ estado: "pendente" }), quinzePorCento, ["p1"]);
    expect(r.lancamentos).toEqual([]);
    expect(r.avisos[0]).toContain("confirmada");
  });

  it("não inventa: cancelada, sem valor, sem contrato ou marketplace pendente não geram lançamentos", () => {
    expect(calcularReserva(reserva({ estado: "cancelada" }), quinzePorCento, ["p1"]).lancamentos).toEqual([]);
    expect(calcularReserva(reserva({ valorBruto: null }), quinzePorCento, ["p1"]).avisos[0]).toContain("pendente");
    expect(calcularReserva(reserva(), [], ["p1"]).avisos[0]).toContain("Sem contrato");
    expect(calcularReserva(reserva(), [{ tipo: "marketplace", comissaoBp: null, inicio: "2025-01-01", fim: null }], ["p1"]).avisos[0]).toContain("marketplace");
  });

  it("sem proprietário vinculado: calcula, avisa e deixa o acerto pendente", () => {
    const { lancamentos, avisos } = calcularReserva(reserva(), quinzePorCento, []);
    expect(avisos.some((a) => a.includes("sem proprietário"))).toBe(true);
    expect(lancamentos.find((l) => l.tipo === "direito_proprietario")).toMatchObject({ efeitoSaldo: 0, estado: "pendente" });
  });

  it("mais de um proprietário: não atribui a nenhum deles, acerto pendente", () => {
    const { lancamentos, avisos } = calcularReserva(reserva(), quinzePorCento, ["p1", "p2"]);
    expect(avisos.some((a) => a.includes("mais de um proprietário"))).toBe(true);
    expect(lancamentos.find((l) => l.tipo === "direito_proprietario")).toMatchObject({ proprietarioId: null, efeitoSaldo: 0, estado: "pendente" });
  });
});


it.each(["consulta", "pedido"] as const)("%s não gera receita, comissão ou repasse", estado => {
  expect(calcularReserva(reserva({ estado }), quinzePorCento, ["p1"]).lancamentos).toEqual([]);
});

describe("cancelada com valor retido pela política (M8.2c)", () => {
  it("valor retido igual ao bruto: os mesmos lançamentos e chaves de uma confirmada, com o aviso", () => {
    const confirmada = calcularReserva(reserva({ origem: "site" }), quinzePorCento, ["p1"]);
    const retida = calcularReserva(reserva({ origem: "site", estado: "cancelada", valorRetido: 150000 }), quinzePorCento, ["p1"]);
    expect(retida.lancamentos).toEqual(confirmada.lancamentos);
    expect(retida.avisos).toEqual(["Reserva cancelada com valor retido pela política: dividido como uma reserva normal.", ...confirmada.avisos]);
  });

  it("o valor retido é a base, não o valor da reserva", () => {
    const { lancamentos } = calcularReserva(reserva({ estado: "cancelada", valorBruto: 999999, valorRetido: 150000 }), quinzePorCento, ["p1"]);
    expect(lancamentos.find((l) => l.tipo === "receita_bruta")!.valor).toBe(150000);
    expect(lancamentos.find((l) => l.tipo === "direito_proprietario")!.valor).toBe(108375);
  });

  it("sem valor retido (nulo ou zero): nenhum lançamento", () => {
    for (const valorRetido of [null, 0, undefined])
      expect(calcularReserva(reserva({ estado: "cancelada", valorRetido }), quinzePorCento, ["p1"])).toEqual({ lancamentos: [], avisos: ["Reserva cancelada: sem lançamentos."] });
  });

  it("taxa do Mercado Pago ainda desconhecida: taxa zero e o aviso, como numa confirmada", () => {
    const { lancamentos, avisos } = calcularReserva(reserva({ origem: "site", estado: "cancelada", taxaCanal: null, valorRetido: 150000 }), quinzePorCento, ["p1"]);
    expect(lancamentos.some((l) => l.tipo === "taxa_canal")).toBe(false);
    expect(lancamentos.find((l) => l.tipo === "comissao")!.valor).toBe(22500);
    expect(avisos).toContain("Taxa do canal não informada: considerada zero.");
  });

  it("reservaCalculadaPeloMotor: confirmada e cancelada com valor retido; o resto não", () => {
    expect(reservaCalculadaPeloMotor({ estado: "confirmada", valorRetido: null })).toBe(true);
    expect(reservaCalculadaPeloMotor({ estado: "cancelada", valorRetido: 150000 })).toBe(true);
    expect(reservaCalculadaPeloMotor({ estado: "cancelada", valorRetido: null })).toBe(false);
    expect(reservaCalculadaPeloMotor({ estado: "cancelada", valorRetido: 0 })).toBe(false);
    for (const estado of ["pendente", "pedido", "consulta"] as const) expect(reservaCalculadaPeloMotor({ estado, valorRetido: 150000 })).toBe(false);
  });
});
