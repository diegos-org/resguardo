import { describe, expect, it } from "vitest";
import { DIAS_ARREPENDIMENTO, decidirPelaPolitica, type EntradaPolitica, entradaQueConta, fimDoArrependimento, HORA_ENTRADA_PADRAO, HORA_LIMITE_DO_DIA, horaDeEntrada, regrasComPadrao } from "./politica-cancelamento";

const SP = "America/Sao_Paulo";
/** Um instante dado pelo relógio de São Paulo (UTC−3, sem horário de verão desde 2019). */
const sp = (dataHora: string) => new Date(`${dataHora}:00-03:00`);

// Política de 14 dias e entrada em 30/10 às 15:00: reembolso integral para pedidos até 16/10, 23:59.
const base: EntradaPolitica = {
  regras: { diasReembolsoIntegral: 14, arrependimentoAteEntrada: true },
  checkin: "2026-10-30",
  horaEntrada: "15:00",
  fuso: SP,
  aprovadoEm: sp("2026-09-01T10:00"),
  pedidoRecebidoEm: sp("2026-10-10T10:00"),
  quemCancela: "hospede",
  valorBase: 182400,
};
const decidir = (over: Partial<EntradaPolitica>) => decidirPelaPolitica({ ...base, ...over });

describe("decidirPelaPolitica (M8.2c, regra pura)", () => {
  it("prazo do reembolso integral: até 23:59 do último dia (HORA_LIMITE_DO_DIA), no fuso do imóvel", () => {
    // A hora que as frases escrevem (M7.22: "23:59", não "23h59") é a última que a regra aceita.
    expect(HORA_LIMITE_DO_DIA).toBe("23:59");
    expect(decidir({ pedidoRecebidoEm: sp(`2026-10-16T${HORA_LIMITE_DO_DIA}`) })).toMatchObject({ calculado: "integral", base: "prazo" });
    expect(decidir({ pedidoRecebidoEm: sp("2026-10-16T23:59") })).toEqual({
      calculado: "integral",
      base: "prazo",
      valorADevolver: 182400,
      integralAte: "2026-10-16",
      arrependimentoAte: "2026-09-08",
      entradaEm: sp("2026-10-30T15:00"),
      comecou: false,
    });
    expect(decidir({ pedidoRecebidoEm: sp("2026-10-17T00:00") })).toMatchObject({ calculado: "nenhum", base: "fora_do_prazo", valorADevolver: 0, integralAte: "2026-10-16" });
  });

  it("o mesmo instante lido no fuso do imóvel decide o dia (não o UTC)", () => {
    // 17/10 01:00 UTC = 16/10 22:00 em São Paulo.
    const instante = new Date("2026-10-17T01:00:00Z");
    expect(decidir({ pedidoRecebidoEm: instante })).toMatchObject({ calculado: "integral", base: "prazo" });
    expect(decidir({ pedidoRecebidoEm: instante, fuso: "UTC" })).toMatchObject({ calculado: "nenhum", base: "fora_do_prazo" });
  });

  it("arrependimento: dia da aprovação + 7 dias, até 23:59, integral mesmo depois do prazo da política", () => {
    expect(DIAS_ARREPENDIMENTO).toBe(7);
    // Entrada em 25/3 (14 dias: integral só até 11/3); pagamento aprovado em 10/3.
    const marco = { checkin: "2026-03-25", aprovadoEm: sp("2026-03-10T09:00") };
    expect(decidir({ ...marco, pedidoRecebidoEm: sp("2026-03-17T23:59") })).toMatchObject({ calculado: "integral", base: "arrependimento", arrependimentoAte: "2026-03-17", integralAte: "2026-03-11" });
    expect(decidir({ ...marco, pedidoRecebidoEm: sp("2026-03-18T00:00") })).toMatchObject({ calculado: "nenhum", base: "fora_do_prazo" });
    // Aprovado às 23h30 do dia 10 em São Paulo (02h30 do dia 11 em UTC): conta o dia 10.
    expect(decidir({ ...marco, aprovadoEm: new Date("2026-03-11T02:30:00Z"), pedidoRecebidoEm: sp("2026-03-17T23:59") })).toMatchObject({ base: "arrependimento", arrependimentoAte: "2026-03-17" });
  });

  it("fora dos 14 dias da política, mas dentro dos 7 do arrependimento: integral pelo arrependimento", () => {
    expect(decidir({ aprovadoEm: sp("2026-10-20T12:00"), pedidoRecebidoEm: sp("2026-10-22T08:00") })).toMatchObject({ calculado: "integral", base: "arrependimento", valorADevolver: 182400 });
    // Dentro do prazo da política vale o prazo (vem primeiro), mesmo dentro do arrependimento.
    expect(decidir({ aprovadoEm: sp("2026-10-05T12:00"), pedidoRecebidoEm: sp("2026-10-08T08:00") })).toMatchObject({ base: "prazo" });
  });

  it("depois do horário de entrada: com o limite, estadia iniciada; sem o limite, arrependimento; ausente vale como com", () => {
    const tarde = { aprovadoEm: sp("2026-10-25T12:00"), pedidoRecebidoEm: sp("2026-10-30T16:00") };
    expect(decidir(tarde)).toMatchObject({ calculado: "nenhum", base: "estadia_iniciada", comecou: true });
    expect(decidir({ ...tarde, regras: { diasReembolsoIntegral: 14, arrependimentoAteEntrada: false } })).toMatchObject({ calculado: "integral", base: "arrependimento", comecou: true });
    expect(decidir({ ...tarde, regras: { diasReembolsoIntegral: 14 } })).toMatchObject({ calculado: "nenhum", base: "estadia_iniciada" });
    // No instante da entrada já começou; um minuto antes, não.
    expect(decidir({ ...tarde, pedidoRecebidoEm: sp("2026-10-30T15:00") })).toMatchObject({ comecou: true, base: "estadia_iniciada" });
    expect(decidir({ ...tarde, pedidoRecebidoEm: sp("2026-10-30T14:59") })).toMatchObject({ comecou: false, base: "arrependimento" });
    // Depois da entrada e fora de tudo: estadia iniciada (nunca "fora do prazo").
    expect(decidir({ pedidoRecebidoEm: sp("2026-10-31T10:00") })).toMatchObject({ calculado: "nenhum", base: "estadia_iniciada" });
  });

  it("a SCL cancela: integral a qualquer momento; não comparecimento: nada, mesmo dentro do prazo", () => {
    expect(decidir({ quemCancela: "empresa", pedidoRecebidoEm: sp("2026-11-01T10:00") })).toMatchObject({ calculado: "integral", base: "empresa", valorADevolver: 182400, comecou: true });
    expect(decidir({ quemCancela: "empresa", pedidoRecebidoEm: sp("2026-10-01T10:00") })).toMatchObject({ base: "empresa" });
    expect(decidir({ quemCancela: "nao_comparecimento", pedidoRecebidoEm: sp("2026-10-31T12:00") })).toMatchObject({ calculado: "nenhum", base: "nao_comparecimento", valorADevolver: 0 });
    expect(decidir({ quemCancela: "nao_comparecimento", pedidoRecebidoEm: sp("2026-10-10T12:00") })).toMatchObject({ base: "nao_comparecimento" });
  });

  it("sem política aceita: nada calculado, sem datas", () => {
    expect(decidir({ regras: null })).toEqual({ calculado: "sem_politica", base: "sem_politica", valorADevolver: 0, integralAte: null, arrependimentoAte: null, entradaEm: sp("2026-10-30T15:00"), comecou: false });
    expect(decidir({ regras: null, quemCancela: "empresa" })).toMatchObject({ calculado: "sem_politica", valorADevolver: 0 });
  });

  it("prazos de 1 e de 365 dias; o horário de entrada do imóvel conta", () => {
    expect(decidir({ regras: { diasReembolsoIntegral: 1 }, pedidoRecebidoEm: sp("2026-10-29T23:59") })).toMatchObject({ base: "prazo", integralAte: "2026-10-29" });
    expect(decidir({ regras: { diasReembolsoIntegral: 1 }, pedidoRecebidoEm: sp("2026-10-30T00:00") })).toMatchObject({ base: "fora_do_prazo" });
    expect(decidir({ regras: { diasReembolsoIntegral: 365 } })).toMatchObject({ base: "fora_do_prazo", integralAte: "2025-10-30" });
    expect(decidir({ horaEntrada: "11:30" }).entradaEm).toEqual(sp("2026-10-30T11:30"));
  });

  it("valor: devolve o valor-base no integral e zero sem devolução", () => {
    expect(decidir({ valorBase: 1 }).valorADevolver).toBe(1);
    expect(decidir({ valorBase: 0 }).valorADevolver).toBe(0);
    expect(decidir({ valorBase: 99999, pedidoRecebidoEm: sp("2026-10-20T10:00") }).valorADevolver).toBe(0);
  });

  it("entrada inválida é erro (nunca uma decisão por palpite)", () => {
    for (const over of [
      { checkin: "2026-13-01" },
      { checkin: "30/10/2026" },
      { horaEntrada: "25:00" },
      { horaEntrada: "9:00" },
      { fuso: "Marte/Olimpo" },
      { valorBase: -1 },
      { valorBase: 1.5 },
      { regras: { diasReembolsoIntegral: 1.5 } },
      { aprovadoEm: new Date("x") },
      { pedidoRecebidoEm: new Date("x") },
    ] satisfies Partial<EntradaPolitica>[])
      expect(() => decidir(over)).toThrow();
  });

  it("regrasComPadrao: o limite ausente vale sim", () => {
    expect(regrasComPadrao({ diasReembolsoIntegral: 14 })).toEqual({ diasReembolsoIntegral: 14, arrependimentoAteEntrada: true });
    expect(regrasComPadrao({ diasReembolsoIntegral: 14, arrependimentoAteEntrada: false })).toEqual({ diasReembolsoIntegral: 14, arrependimentoAteEntrada: false });
  });

  it("horaDeEntrada: o horário cadastrado no imóvel; sem ele, ou inválido, 15:00 (nunca um palpite fora do formato)", () => {
    expect(horaDeEntrada("14:00")).toBe("14:00");
    expect(horaDeEntrada("00:30")).toBe("00:30");
    for (const estranho of [null, undefined, "", "25:00", "9:00", "14h"]) expect(horaDeEntrada(estranho)).toBe(HORA_ENTRADA_PADRAO);
    expect(HORA_ENTRADA_PADRAO).toBe("15:00");
  });
});

describe("depois de uma alteração (M8.2d): a entrada que conta e a entrada atual", () => {
  it("fimDoArrependimento: 7 dias depois do pagamento ou, com a política parando na entrada, a entrada quando vem antes", () => {
    expect(fimDoArrependimento("2026-10-08", true, "2026-10-05")).toEqual({ ate: "2026-10-05", ateEntrada: true });
    expect(fimDoArrependimento("2026-10-08", true, "2026-10-08")).toEqual({ ate: "2026-10-08", ateEntrada: true });
    expect(fimDoArrependimento("2026-10-08", true, "2026-10-12")).toEqual({ ate: "2026-10-08", ateEntrada: false });
    expect(fimDoArrependimento("2026-10-08", false, "2026-10-05")).toEqual({ ate: "2026-10-08", ateEntrada: false });
    expect(fimDoArrependimento("2026-10-08", null, "2026-10-05")).toEqual({ ate: "2026-10-08", ateEntrada: false });
    expect(fimDoArrependimento("2026-10-08", true, null)).toEqual({ ate: "2026-10-08", ateEntrada: false });
  });

  it("entradaQueConta: a menor entre a da cotação original e a atual; data inválida é erro", () => {
    expect(entradaQueConta("2027-01-15", "2026-11-28")).toBe("2026-11-28");
    expect(entradaQueConta("2026-11-28", "2027-01-15")).toBe("2026-11-28");
    expect(entradaQueConta("2026-11-28", "2026-11-28")).toBe("2026-11-28");
    expect(() => entradaQueConta("2026-13-01", "2026-11-28")).toThrow();
    expect(() => entradaQueConta("2026-11-28", "28/11/2026")).toThrow();
    // Várias alterações (M8.2d): 15/01 adiantada para 28/11 e depois adiada para 01/02 — conta 28/11 (adiar não reabre).
    expect(entradaQueConta("2027-01-15", "2027-02-01", ["2027-01-15", "2026-11-28", "2026-11-28", "2027-02-01"])).toBe("2026-11-28");
    expect(entradaQueConta("2027-01-15", "2027-02-01", [])).toBe("2027-01-15");
    expect(() => entradaQueConta("2027-01-15", "2027-02-01", ["2026-02-30"])).toThrow();
  });

  it("entrada atual depois da que conta: o prazo conta da que conta; o começo da estadia e o arrependimento, da atual", () => {
    // Conta 30/10 (integral até 16/10); a estadia foi para 20/11. Pedido em 01/11: fora do prazo, mas a estadia não começou.
    const mudada = { entradaAtual: "2026-11-20", pedidoRecebidoEm: sp("2026-11-01T10:00") };
    expect(decidir(mudada)).toMatchObject({ calculado: "nenhum", base: "fora_do_prazo", integralAte: "2026-10-16", comecou: false, entradaEm: sp("2026-11-20T15:00") });
    // Sem a entrada atual (M8.2c), o mesmo pedido já seria "estadia iniciada" (contando de 30/10).
    expect(decidir({ pedidoRecebidoEm: sp("2026-11-01T10:00") })).toMatchObject({ base: "estadia_iniciada", comecou: true });
    // Arrependimento (aprovado em 28/10, até 04/11): vale, porque a estadia de agora ainda não começou.
    expect(decidir({ ...mudada, aprovadoEm: sp("2026-10-28T09:00") })).toMatchObject({ calculado: "integral", base: "arrependimento", arrependimentoAte: "2026-11-04" });
    expect(decidir({ aprovadoEm: sp("2026-10-28T09:00"), pedidoRecebidoEm: sp("2026-11-01T10:00") })).toMatchObject({ calculado: "nenhum", base: "estadia_iniciada" });
    // Depois da entrada atual: estadia iniciada.
    expect(decidir({ ...mudada, pedidoRecebidoEm: sp("2026-11-20T15:00") })).toMatchObject({ base: "estadia_iniciada", comecou: true });
  });

  it("com a entrada atual, o prazo integral exige que a estadia não tenha começado (prazo de 0 dias, pedido depois da entrada)", () => {
    const zero = { regras: { diasReembolsoIntegral: 0, arrependimentoAteEntrada: true }, pedidoRecebidoEm: sp("2026-10-30T16:00") };
    // M8.2c (sem a entrada atual): o dia do pedido ainda está no prazo, e o prazo vem primeiro.
    expect(decidir(zero)).toMatchObject({ calculado: "integral", base: "prazo", integralAte: "2026-10-30", comecou: true });
    expect(decidir({ ...zero, entradaAtual: "2026-10-30" })).toMatchObject({ calculado: "nenhum", base: "estadia_iniciada", comecou: true });
    // Antes do horário de entrada, no mesmo dia, o prazo vale.
    expect(decidir({ ...zero, entradaAtual: "2026-10-30", pedidoRecebidoEm: sp("2026-10-30T14:59") })).toMatchObject({ calculado: "integral", base: "prazo" });
  });

  it("exemplo C′: mudar para antes fecha a janela; mudar para depois nunca a reabre nem a estende", () => {
    const comum = { aprovadoEm: sp("2026-10-01T10:00") };
    // Original 15/01; mudou para 28/11. Pedido em 01/12, já na estadia: nada (antes da mudança, contando de 15/01, seria integral).
    const antes = entradaQueConta("2027-01-15", "2026-11-28");
    expect(decidir({ ...comum, checkin: antes, entradaAtual: "2026-11-28", pedidoRecebidoEm: sp("2026-12-01T10:00") })).toMatchObject({ calculado: "nenhum", base: "estadia_iniciada", integralAte: "2026-11-14" });
    expect(decidir({ ...comum, checkin: "2027-01-15", pedidoRecebidoEm: sp("2026-12-01T10:00") })).toMatchObject({ calculado: "integral", base: "prazo" });
    // Pedido em 20/11 (depois do limite de 14/11, antes da nova entrada): nada, fora do prazo.
    expect(decidir({ ...comum, checkin: antes, entradaAtual: "2026-11-28", pedidoRecebidoEm: sp("2026-11-20T10:00") })).toMatchObject({ calculado: "nenhum", base: "fora_do_prazo" });
    // Original 28/11; mudou para 15/01: continua contando de 28/11 (o prazo não se estende), sem "estadia iniciada" em 01/12.
    const depois = entradaQueConta("2026-11-28", "2027-01-15");
    expect(decidir({ ...comum, checkin: depois, entradaAtual: "2027-01-15", pedidoRecebidoEm: sp("2026-11-20T10:00") })).toMatchObject({ calculado: "nenhum", base: "fora_do_prazo", integralAte: "2026-11-14" });
    expect(decidir({ ...comum, checkin: depois, entradaAtual: "2027-01-15", pedidoRecebidoEm: sp("2026-12-01T10:00") })).toMatchObject({ base: "fora_do_prazo", comecou: false });
    expect(decidir({ ...comum, checkin: depois, entradaAtual: "2027-01-15", pedidoRecebidoEm: sp("2026-11-10T10:00") })).toMatchObject({ calculado: "integral", base: "prazo" });
  });

  it("a entrada atual igual à que conta (sem mudança) dá o mesmo que o M8.2c fora do caso do prazo de 0 dias; inválida é erro", () => {
    for (const pedido of ["2026-10-16T23:59", "2026-10-17T00:00", "2026-10-30T16:00", "2026-11-02T10:00"]) {
      expect(decidir({ entradaAtual: "2026-10-30", pedidoRecebidoEm: sp(pedido) }), pedido).toEqual(decidir({ pedidoRecebidoEm: sp(pedido) }));
    }
    expect(() => decidir({ entradaAtual: "2026-02-30" })).toThrow();
    expect(() => decidir({ entradaAtual: "30/10/2026" })).toThrow();
  });
});
