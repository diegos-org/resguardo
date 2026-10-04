import { describe, expect, it } from "vitest";
import { classificarParte, type ParteBruta, resumirPartes } from "./extrato";

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
  hoje: "2026-10-12",
  recebido: { recebido: 85000, devido: 85000 },
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
    expect(aMais).toMatchObject({ situacao: "repassado", diferenca: 7750, motivo: "No fechamento de 01/11/2026 (pago em 01/11/2026). Recalculada depois: o repasse incluiu R$ 722,50; R$ 77,50 a mais entram no próximo fechamento mensal." });
    const aMenos = classificarParte({ ...base, valor: 70000, repasse: rep });
    expect(aMenos).toMatchObject({ diferenca: -2250, motivo: expect.stringContaining("R$ 22,50 a menos são descontados no próximo fechamento mensal") });
    // O resumo conta como repassado o que o repasse incluiu e separa o ajuste.
    expect(resumirPartes([aMais, aMenos])).toEqual({ disponivel: 0, aLiberar: 0, informacao: 0, repassadoAPagar: 0, repassadoPago: 144500, ajusteNoFechamento: 5500 });
  });

  it("resumo soma por situação", () => {
    const partes = [
      classificarParte(base),
      classificarParte({ ...base, hoje: "2026-10-10", valor: 1000 }),
      classificarParte({ ...base, efeitoSaldo: 0, valor: 500 }),
      classificarParte({ ...base, valor: 300, repasse: { id: "x", tipo: "antecipado", data: "2026-10-12", situacao: "a_pagar", dataPagamento: null, valor: 300 } }),
      classificarParte({ ...base, valor: 200, repasse: { id: "y", tipo: "fechamento", data: "2026-10-01", situacao: "pago", dataPagamento: "2026-10-01", valor: 200 } }),
    ];
    expect(resumirPartes(partes)).toEqual({ disponivel: 72250, aLiberar: 1000, informacao: 500, repassadoAPagar: 300, repassadoPago: 200, ajusteNoFechamento: 0 });
  });
});
