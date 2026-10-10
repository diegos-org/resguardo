import { describe, expect, it } from "vitest";
import { classificarParte, ehDescontoDeCancelamento, type ParteBruta, resumirPartes } from "./extrato";

const base: ParteBruta = {
  lancamentoId: "l1",
  proprietarioId: "d1",
  reservaId: "r1",
  codigoReserva: "R-1",
  imovelId: "i1",
  codigoImovel: "403",
  competencia: "2026-10-01",
  valor: 72250,
  efeitoSaldo: 72250,
  estado: "previsto",
  checkin: "2026-10-10",
  checkout: "2026-10-13",
  hospede: "Hóspede",
  origem: "booking",
  hoje: "2026-10-12",
  recebido: { recebido: 85000, devido: 85000 },
  pagamento: null,
  emConferencia: false,
  repasse: null,
};

describe("situação da parte do proprietário (M4.10, regra pura)", () => {
  it("disponível: empresa recebe, check-in até ontem, dinheiro com a empresa, sem repasse", () => {
    expect(classificarParte(base)).toMatchObject({ quemRecebe: "empresa", situacao: "disponivel" });
    // Check-in ontem conta; hoje ainda não.
    expect(classificarParte({ ...base, hoje: "2026-10-11" }).situacao).toBe("disponivel");
    expect(classificarParte({ ...base, hoje: "2026-10-10" })).toMatchObject({ situacao: "a_liberar", motivo: expect.stringContaining("depois do check-in (10/10/2026)") });
  });

  it("split é informação; quem recebe a confirmar fica a liberar fora de qualquer repasse", () => {
    expect(classificarParte({ ...base, efeitoSaldo: 0 })).toMatchObject({ quemRecebe: "split", situacao: "informacao" });
    expect(classificarParte({ ...base, efeitoSaldo: 0, estado: "pendente" })).toMatchObject({ quemRecebe: "a_confirmar", situacao: "a_liberar", motivo: expect.stringContaining("a confirmar") });
  });

  it("dinheiro ainda não com a empresa: nada registrado, ou recebido parcial, fica a liberar com o motivo", () => {
    expect(classificarParte({ ...base, recebido: { recebido: 0, devido: 85000 } })).toMatchObject({ situacao: "a_liberar", motivo: expect.stringContaining("ainda não registrou o recebimento") });
    expect(classificarParte({ ...base, recebido: { recebido: 50000, devido: 85000 } })).toMatchObject({ situacao: "a_liberar", motivo: "Recebido R$ 500,00 de R$ 850,00: libera quando o restante entrar." });
    // Sem valor devido conhecido (sem lançamentos do motor), nunca é disponível.
    expect(classificarParte({ ...base, recebido: { recebido: 0, devido: 0 } }).situacao).toBe("a_liberar");
  });

  it("em conferência fica a liberar; já repassado mostra o repasse (a pagar ou pago)", () => {
    expect(classificarParte({ ...base, emConferencia: true })).toMatchObject({ situacao: "a_liberar", motivo: expect.stringContaining("conferência") });
    const rep = { id: "x", tipo: "antecipado" as const, data: "2026-10-12", situacao: "a_pagar" as const, dataPagamento: null, valor: 72250 };
    expect(classificarParte({ ...base, repasse: rep })).toMatchObject({ situacao: "repassado", motivo: "Repasse de 12/10/2026 (a pagar).", diferenca: 0 });
    expect(classificarParte({ ...base, repasse: { ...rep, tipo: "fechamento", situacao: "pago", dataPagamento: "2026-11-02" } }).motivo).toBe("No fechamento de 12/10/2026 (pago em 02/11/2026).");
    // Repassado vale mesmo que hoje a parte não estivesse disponível (ex.: recebimento estornado depois).
    expect(classificarParte({ ...base, repasse: rep, recebido: { recebido: 0, devido: 85000 } }).situacao).toBe("repassado");
  });

  it("parte recalculada depois de um fechamento antigo: repassada pelo valor que o fechamento incluiu, e a diferença vai ao próximo fechamento mensal", () => {
    const rep = { id: "y", tipo: "fechamento" as const, data: "2026-11-01", situacao: "pago" as const, dataPagamento: "2026-11-01", valor: 72250 };
    const aMais = classificarParte({ ...base, valor: 80000, repasse: rep });
    expect(aMais).toMatchObject({ situacao: "repassado", diferenca: 7750, motivo: "No fechamento de 01/11/2026 (pago em 01/11/2026). Recalculada depois: o repasse incluiu R$ 722,50; a diferença de R$ 77,50 a mais é acertada pelo fechamento mensal." });
    const aMenos = classificarParte({ ...base, valor: 70000, repasse: rep });
    expect(aMenos).toMatchObject({ diferenca: -2250, motivo: expect.stringContaining("a diferença de R$ 22,50 a menos é descontada pelo fechamento mensal") });
    // O resumo conta como repassado o que o repasse incluiu e separa o ajuste.
    expect(resumirPartes([aMais, aMenos])).toEqual({ disponivel: 0, aLiberar: 0, informacao: 0, repassadoAPagar: 0, repassadoPago: 144500, ajusteNoFechamento: 5500, acertadoPorFora: 0 });
  });

  it("resumo soma por situação", () => {
    const partes = [
      classificarParte(base),
      classificarParte({ ...base, hoje: "2026-10-10", valor: 1000 }),
      classificarParte({ ...base, efeitoSaldo: 0, valor: 500 }),
      classificarParte({ ...base, valor: 300, repasse: { id: "x", tipo: "antecipado", data: "2026-10-12", situacao: "a_pagar", dataPagamento: null, valor: 300 } }),
      classificarParte({ ...base, valor: 200, repasse: { id: "y", tipo: "fechamento", data: "2026-10-01", situacao: "pago", dataPagamento: "2026-10-01", valor: 200 } }),
    ];
    expect(resumirPartes(partes)).toEqual({ disponivel: 72250, aLiberar: 1000, informacao: 500, repassadoAPagar: 300, repassadoPago: 200, ajusteNoFechamento: 0, acertadoPorFora: 0 });
    // M4.11: parte de antes do início do sistema, acertada por fora — "repassada", mas à parte do que o sistema pagou.
    const porFora = classificarParte({ ...base, competencia: "2026-09-01", repasse: { id: "pf", tipo: "por_fora", data: "2026-09-30", situacao: "pago", dataPagamento: "2026-09-30", valor: 72250 } });
    expect(porFora).toMatchObject({ situacao: "repassado", motivo: "Acertada por fora, antes do início do sistema (até 30/09/2026).", diferenca: 0 });
    expect(resumirPartes([porFora, ...partes])).toMatchObject({ acertadoPorFora: 72250, repassadoPago: 200, repassadoAPagar: 300 });
    // Com o início do sistema definido, a parte de reserva de antes dele nunca fica disponível (aguarda a marcação); a de depois segue a regra normal.
    const deAntes = { ...base, competencia: "2026-09-01", checkin: "2026-09-10", checkout: "2026-09-13" };
    expect(classificarParte(deAntes, "2026-10-01")).toMatchObject({ situacao: "a_liberar", motivo: "Reserva paga antes do início do sistema (01/10/2026): já acertada por fora; aguarda a marcação em Financeiro → Repasses." });
    expect(classificarParte(base, "2026-10-01").situacao).toBe("disponivel");
    expect(classificarParte(deAntes, null).situacao).toBe("disponivel");
    // Já marcada, ou paga pelo canal, a parte de antes não muda de situação por causa do início.
    expect(classificarParte({ ...base, competencia: "2026-09-01", repasse: { id: "pf", tipo: "por_fora", data: "2026-09-30", situacao: "pago", dataPagamento: "2026-09-30", valor: 72250 } }, "2026-10-01").situacao).toBe("repassado");
    expect(classificarParte({ ...base, competencia: "2026-09-01", efeitoSaldo: 0 }, "2026-10-01").situacao).toBe("informacao");
  });
});

describe("lado do início do sistema pela data do pagamento (M4.12, regra pura)", () => {
  const inicio = "2026-10-01";
  const atravessa = { checkin: "2026-09-29", checkout: "2026-10-02" };

  it("empresa recebe: paga antes do início é a liberar (acertada por fora) em qualquer mês; paga a partir dele entra inteira; sem data e atravessando, a liberar com o aviso", () => {
    expect(classificarParte({ ...base, ...atravessa, competencia: "2026-10-01", pagamento: { data: "2026-09-30", fonte: "recebimento" } }, inicio)).toMatchObject({
      situacao: "a_liberar",
      motivo: "Reserva paga antes do início do sistema (01/10/2026), em 30/09/2026: já acertada por fora; aguarda a marcação em Financeiro → Repasses.",
    });
    expect(classificarParte({ ...base, ...atravessa, competencia: "2026-09-01", pagamento: { data: "2026-10-03", fonte: "recebimento" } }, inicio).situacao).toBe("disponivel");
    expect(classificarParte({ ...base, ...atravessa, competencia: "2026-09-01", recebido: { recebido: 0, devido: 85000 } }, inicio)).toMatchObject({
      situacao: "a_liberar",
      motivo: expect.stringContaining("Reserva que atravessa o início do sistema (01/10/2026) sem data de pagamento: registre o recebimento completo"),
    });
    // Sem data: inteira antes do início é de antes; inteira depois entra (e segue as regras normais).
    expect(classificarParte({ ...base, competencia: "2026-09-01", checkin: "2026-09-10", checkout: "2026-09-13", recebido: { recebido: 0, devido: 85000 } }, inicio)).toMatchObject({
      situacao: "a_liberar",
      motivo: "Reserva paga antes do início do sistema (01/10/2026): já acertada por fora; aguarda a marcação em Financeiro → Repasses.",
    });
    expect(classificarParte({ ...base, recebido: { recebido: 0, devido: 85000 } }, inicio)).toMatchObject({ situacao: "a_liberar", motivo: expect.stringContaining("ainda não registrou o recebimento") });
    // Sem início definido, a data do pagamento não muda nada.
    expect(classificarParte({ ...base, pagamento: { data: "2026-09-30", fonte: "recebimento" } }).situacao).toBe("disponivel");
  });

  it("canal paga direto: informação com a data (pago ou previsto) e o prazo; antes do início, já acertada por fora", () => {
    const split: ParteBruta = { ...base, origem: "airbnb", efeitoSaldo: 0 };
    expect(classificarParte({ ...split, pagamento: { data: "2026-10-11", fonte: "canal", prazo: 1 } }, inicio).motivo).toBe("O canal paga sua parte direto a você (pago em 11/10/2026, 1 dia(s) depois do check-in): não entra em repasse.");
    expect(classificarParte({ ...split, hoje: "2026-10-10", pagamento: { data: "2026-10-11", fonte: "canal", prazo: 1 } }, inicio).motivo).toContain("(previsto em 11/10/2026, 1 dia(s) depois do check-in)");
    expect(classificarParte({ ...split, pagamento: { data: "2026-10-10", fonte: "canal", prazo: 0 } }, inicio).motivo).toContain("(pago em 10/10/2026, no check-in)");
    expect(classificarParte({ ...split, ...atravessa, competencia: "2026-10-01", pagamento: { data: "2026-09-30", fonte: "canal", prazo: 1 } }, inicio)).toMatchObject({
      situacao: "informacao",
      motivo: "O canal pagou sua parte direto a você (pago em 30/09/2026, 1 dia(s) depois do check-in), antes do início do sistema (01/10/2026): já acertada por fora.",
    });
    expect(classificarParte({ ...split, ...atravessa, pagamento: null }, inicio).motivo).toBe("O canal paga sua parte direto a você: não entra em repasse.");
  });
});

describe("cancelamento pela política do site (M8.2c, regra pura)", () => {
  const desconto: ParteBruta = { ...base, lancamentoId: "d1", competencia: "2026-11-01", valor: -72250, efeitoSaldo: -72250, origemLancamento: "cancelamento", hoje: "2026-11-03", recebido: { recebido: 85000, devido: 0 } };

  it("desconto da parte já repassada: disponível na hora, nunca a liberar (nem dinheiro, nem check-in, nem conferência)", () => {
    expect(ehDescontoDeCancelamento(desconto)).toBe(true);
    expect(ehDescontoDeCancelamento({ ...desconto, origemLancamento: "motor" })).toBe(false);
    expect(ehDescontoDeCancelamento({ ...desconto, valor: 100 })).toBe(false);
    expect(classificarParte(desconto)).toMatchObject({
      quemRecebe: "empresa",
      situacao: "disponivel",
      motivo: "Desconto da sua parte já repassada da reserva R-1 (cancelada com devolução integral ao hóspede): sai do próximo repasse.",
    });
    expect(classificarParte({ ...desconto, recebido: { recebido: 0, devido: 0 }, checkin: "2026-12-01", emConferencia: true }).situacao).toBe("disponivel");
    // Vinculado a um repasse: descontado (pelo repasse ou pelo fechamento).
    const rep = { id: "x", tipo: "antecipado" as const, data: "2026-11-05", situacao: "pago" as const, dataPagamento: "2026-11-06", valor: -72250 };
    expect(classificarParte({ ...desconto, repasse: rep })).toMatchObject({
      situacao: "repassado",
      motivo: "Desconto da sua parte já repassada da reserva R-1 (cancelada com devolução integral ao hóspede): descontado no repasse de 05/11/2026 (pago em 06/11/2026).",
      diferenca: 0,
    });
    expect(classificarParte({ ...desconto, repasse: { ...rep, tipo: "fechamento", situacao: "a_pagar", dataPagamento: null } }).motivo).toContain("descontado no fechamento de 05/11/2026 (a pagar).");
    // No resumo, o desconto sai do disponível.
    expect(resumirPartes([classificarParte(base), classificarParte(desconto)])).toMatchObject({ disponivel: 0 });
  });

  it("cancelada sem devolução (valor retido): libera depois da entrada original, com o motivo próprio; depois segue a regra", () => {
    const retida: ParteBruta = { ...base, canceladaComRetencao: true, checkin: "2026-12-10", checkout: "2026-12-13", competencia: "2026-12-01" };
    expect(classificarParte(retida)).toMatchObject({
      situacao: "a_liberar",
      motivo: "Reserva cancelada sem devolução ao hóspede (política de cancelamento): o valor retido é dividido como uma reserva normal. Libera depois da data de entrada original (10/12/2026), com o dinheiro já com a empresa.",
    });
    expect(classificarParte({ ...retida, hoje: "2026-12-11" }).situacao).toBe("disponivel");
    // Sem o dinheiro com a empresa, vale o motivo do dinheiro.
    expect(classificarParte({ ...retida, hoje: "2026-12-11", recebido: { recebido: 0, devido: 85000 } }).motivo).toContain("ainda não registrou o recebimento");
  });
});
