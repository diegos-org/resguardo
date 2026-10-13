import { describe, expect, it } from "vitest";
import { avisoIndefinidas, dataDoPagamento, ladoDoInicio, quemRecebeDe, somarDias } from "./inicio";

describe("data do pagamento e lado do início do sistema (M4.12, regras puras)", () => {
  it("somar dias atravessa mês e ano", () => {
    expect(somarDias("2026-09-30", 1)).toBe("2026-10-01");
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(somarDias("2026-10-10", 0)).toBe("2026-10-10");
    expect(somarDias("2026-02-28", 2)).toBe("2026-03-02");
  });

  it("canal que paga direto: check-in + prazo do canal (sem prazo, sem data); empresa: data do recebimento que completou; a confirmar: nenhuma", () => {
    const recebido = { recebido: 85000, devido: 85000, dataCompleto: "2026-10-03" };
    expect(dataDoPagamento({ quemRecebe: "split", checkin: "2026-09-29", recebido }, 1)).toEqual({ data: "2026-09-30", fonte: "canal", prazo: 1 });
    expect(dataDoPagamento({ quemRecebe: "split", checkin: "2026-09-29", recebido }, 0)).toEqual({ data: "2026-09-29", fonte: "canal", prazo: 0 });
    expect(dataDoPagamento({ quemRecebe: "split", checkin: "2026-09-29", recebido }, null)).toBeNull();
    expect(dataDoPagamento({ quemRecebe: "empresa", checkin: "2026-09-29", recebido }, 1)).toEqual({ data: "2026-10-03", fonte: "recebimento" });
    expect(dataDoPagamento({ quemRecebe: "empresa", checkin: "2026-09-29", recebido: { recebido: 50000, devido: 85000, dataCompleto: null } }, null)).toBeNull();
    expect(dataDoPagamento({ quemRecebe: "empresa", checkin: "2026-09-29", recebido: { recebido: 0, devido: 0 } }, null)).toBeNull();
    expect(dataDoPagamento({ quemRecebe: "a_confirmar", checkin: "2026-09-29", recebido }, 1)).toBeNull();
    expect(quemRecebeDe({ estado: "pendente", efeitoSaldo: 0 })).toBe("a_confirmar");
    expect(quemRecebeDe({ estado: "previsto", efeitoSaldo: 0 })).toBe("split");
    expect(quemRecebeDe({ estado: "previsto", efeitoSaldo: 100 })).toBe("empresa");
  });

  it("M8.2c: o dinheiro que voltou ao hóspede (devolução) não apaga a data em que ele pagou — vale o recebimento completo", () => {
    const devolvido = { recebido: 0, devido: 85000, dataCompleto: "2026-10-03" };
    expect(dataDoPagamento({ quemRecebe: "empresa", checkin: "2026-09-29", recebido: devolvido }, null)).toEqual({ data: "2026-10-03", fonte: "recebimento" });
    expect(dataDoPagamento({ quemRecebe: "empresa", checkin: "2026-09-29", recebido: { recebido: -1000, devido: 85000, dataCompleto: "2026-10-03" } }, null)).toEqual({ data: "2026-10-03", fonte: "recebimento" });
    // Sem o recebimento completo (ou sem nada a receber), continua sem data.
    expect(dataDoPagamento({ quemRecebe: "empresa", checkin: "2026-09-29", recebido: { recebido: 0, devido: 85000, dataCompleto: null } }, null)).toBeNull();
    expect(dataDoPagamento({ quemRecebe: "empresa", checkin: "2026-09-29", recebido: { recebido: 0, devido: 0, dataCompleto: "2026-10-03" } }, null)).toBeNull();
  });

  it("lado do início: a data do pagamento decide; sem data, só a reserva que atravessa fica indefinida; sem início, nenhum lado", () => {
    const atravessa = { checkin: "2026-09-29", checkout: "2026-10-02" };
    expect(ladoDoInicio({ ...atravessa, pagamento: { data: "2026-09-30", fonte: "canal", prazo: 1 } }, "2026-10-01")).toBe("antes");
    expect(ladoDoInicio({ ...atravessa, pagamento: { data: "2026-10-01", fonte: "recebimento" } }, "2026-10-01")).toBe("depois");
    expect(ladoDoInicio({ checkin: "2026-10-10", checkout: "2026-10-13", pagamento: { data: "2026-09-25", fonte: "recebimento" } }, "2026-10-01")).toBe("antes");
    expect(ladoDoInicio({ checkin: "2026-09-10", checkout: "2026-09-13", pagamento: { data: "2026-10-05", fonte: "recebimento" } }, "2026-10-01")).toBe("depois");
    expect(ladoDoInicio({ ...atravessa, pagamento: null }, "2026-10-01")).toBe("indefinido");
    expect(ladoDoInicio({ checkin: "2026-09-10", checkout: "2026-09-13", pagamento: null }, "2026-10-01")).toBe("antes");
    expect(ladoDoInicio({ checkin: "2026-09-28", checkout: "2026-10-01", pagamento: null }, "2026-10-01")).toBe("antes");
    expect(ladoDoInicio({ checkin: "2026-10-01", checkout: "2026-10-04", pagamento: null }, "2026-10-01")).toBe("depois");
    expect(ladoDoInicio({ ...atravessa, pagamento: null }, null)).toBeNull();
  });

  it("aviso das indefinidas: por quem recebe, com os códigos; nenhuma, nenhum aviso", () => {
    expect(avisoIndefinidas([], "2026-10-01")).toBeNull();
    const aviso = avisoIndefinidas([{ codigo: "R-1", quemRecebe: "empresa" }, { codigo: "R-2", quemRecebe: "split" }, { codigo: "R-3", quemRecebe: "empresa" }], "2026-10-01")!;
    expect(aviso).toContain("2 reserva(s) que atravessa(m) o início do sistema (01/10/2026) sem data de pagamento (R-1, R-3): registre o recebimento na reserva com a data em que o canal pagou");
    expect(aviso).toContain("1 reserva(s) que atravessa(m) o início do sistema (01/10/2026) de canal que paga direto sem prazo definido (R-2): informe em Configurações → Regras financeiras em quantos dias o canal paga.");
    expect(avisoIndefinidas([{ codigo: "R-9", quemRecebe: "a_confirmar" }], "2026-10-01")).toBeNull();
  });
});
