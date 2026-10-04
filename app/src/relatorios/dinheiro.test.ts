import { describe, expect, it } from "vitest";
import type { Rodape } from "@/portal/rodape";
import { comoChega, conciliacao, conciliacaoFecha, type ParteDoRelatorio } from "./dinheiro";

// As reservas do protótipo (dados fictícios): outubro de 2026, Studio Exemplo 701.
const parte = (over: Partial<ParteDoRelatorio>): ParteDoRelatorio => ({
  reservaId: "r", codigo: "SCL-1", codigoCanal: "", hospede: "Hóspede", canal: "airbnb", checkin: "2026-10-02", checkout: "2026-10-05", mes: "2026-10", noitesNoMes: 3, noitesTotal: 3,
  bruto: 330000, taxa: 9900, comissao: 48015, suaParte: 272085, quemRecebe: "split", situacao: "informacao", motivo: "", pagamento: { data: "2026-10-03", fonte: "canal", prazo: 1 }, repasse: null, ...over,
});
const ze = parte({ reservaId: "ze", hospede: "Zé Fictício", checkin: "2026-09-29", checkout: "2026-10-02", noitesNoMes: 1, noitesTotal: 3, bruto: 100000, taxa: 3000, comissao: 14550, suaParte: 82450, pagamento: { data: "2026-09-30", fonte: "canal", prazo: 1 } });
const zeSetembro = parte({ ...ze, mes: "2026-09", noitesNoMes: 2, bruto: 200000, taxa: 6000, comissao: 29100, suaParte: 164900 });
const ana = parte({ reservaId: "ana", hospede: "Ana" });
const bruno = parte({ reservaId: "bruno", hospede: "Bruno", canal: "booking", checkin: "2026-10-07", checkout: "2026-10-10", bruto: 300000, taxa: 45000, comissao: 38250, suaParte: 216750, quemRecebe: "empresa", situacao: "repassado", pagamento: { data: "2026-10-14", fonte: "recebimento" }, repasse: { id: "rep1", tipo: "antecipado", data: "2026-10-16", situacao: "pago", dataPagamento: "2026-10-16", valor: 216750 } });
const carla = parte({ reservaId: "carla", hospede: "Carla", canal: "site", checkin: "2026-10-12", checkout: "2026-10-16", noitesNoMes: 4, noitesTotal: 4, bruto: 425000, taxa: 17000, comissao: 61200, suaParte: 346800, quemRecebe: "empresa", situacao: "disponivel", pagamento: { data: "2026-10-20", fonte: "recebimento" } });
const diana = parte({ reservaId: "diana", hospede: "Diana", checkin: "2026-10-18", checkout: "2026-10-21", bruto: 290000, taxa: 8700, comissao: 42195, suaParte: 239105, pagamento: { data: "2026-10-19", fonte: "canal", prazo: 1 } });
const eduardo = parte({ reservaId: "eduardo", hospede: "Eduardo", checkin: "2026-10-23", checkout: "2026-10-25", noitesNoMes: 2, noitesTotal: 2, bruto: 170000, taxa: 5100, comissao: 24735, suaParte: 140165, pagamento: { data: "2026-10-24", fonte: "canal", prazo: 1 } });
const elisa = parte({ reservaId: "elisa", hospede: "Elisa", canal: "booking", checkin: "2026-10-30", checkout: "2026-11-02", noitesNoMes: 2, noitesTotal: 3, bruto: 330000, taxa: 49500, comissao: 42075, suaParte: 238425, quemRecebe: "empresa", situacao: "a_liberar", motivo: "A empresa ainda não registrou o recebimento desta reserva.", pagamento: null });
const partes = [zeSetembro, ze, ana, bruno, carla, diana, eduardo, elisa];
const rodape = (over: Partial<Rodape> = {}): Rodape => ({ proprietarioId: "p", nome: "Maria Exemplo", situacao: "empresa_deve", saldo: 314800, descontado: 0, valor: 314800, aFavor: "proprietario", chavePix: "chave-pix-secreta@example.com", dataPagamento: null, diferenca: 0, emConferencia: false, repassePosterior: null, ...over });
const E = "Sua Casa Leblon";

describe("como chega até você (M5.7, pela data em que o canal pagou)", () => {
  it("uma linha por caminho: pago direto pelo canal no mês, noite paga antes, já repassado, a transferir no fechamento, a liberar; e quem paga quem sem chave Pix", () => {
    const { linhas, quemPagaQuem } = comoChega(partes, "2026-10", [rodape()], E);
    expect(linhas.map((l) => [l.texto, l.valor, l.tipo])).toEqual([
      ["Pago a você direto pelo Airbnb em outubro de 2026 (3 reservas, no dia seguinte a cada check-in)", 272085 + 239105 + 140165, "normal"],
      ["Já pago pelo Airbnb em 30/9: 1 noite de outubro de 2026 da reserva de Zé (29/9 → 2/10) — está no extrato de setembro de 2026", 82450, "info"],
      ["Já repassado em 16/10 (repasse antecipado: Bruno; Pix com comprovante no portal)", 216750, "normal"],
      ["A transferir no fechamento, previsto para 01/11/2026", 314800, "normal"],
      ["A liberar — Elisa (30/10 → 2/11), Booking.com: A empresa ainda não registrou o recebimento desta reserva.", 238425, "aviso"],
    ]);
    expect(quemPagaQuem).toBe("A Sua Casa Leblon transfere R$ 3.148,00 para Maria Exemplo em 01/11/2026, pela chave Pix cadastrada no portal. O valor a liberar entra no próximo repasse assim que o canal pagar.");
    expect(JSON.stringify(linhas) + quemPagaQuem).not.toContain("chave-pix-secreta");
  });

  it("fechamento pago, proprietário que deve, saldo parcial, em conferência, repasse a pagar e sem prazo do canal", () => {
    expect(comoChega([ana], "2026-10", [rodape({ situacao: "pago", dataPagamento: "2026-11-01" })], E)).toMatchObject({
      linhas: [expect.anything(), { texto: "Transferido no fechamento, em 01/11/2026", valor: 314800 }],
      quemPagaQuem: expect.stringContaining("transferiu R$ 3.148,00 para Maria Exemplo em 01/11/2026"),
    });
    const deve = comoChega([], "2026-10", [rodape({ situacao: "proprietario_deve", valor: 5000, aFavor: "empresa" })], E);
    expect(deve.linhas).toEqual([{ texto: "Você transfere à Sua Casa Leblon no fechamento", valor: 5000, tipo: "aviso" }]);
    expect(deve.quemPagaQuem).toContain("Maria Exemplo transfere R$ 50,00 para a Sua Casa Leblon");
    expect(comoChega([], "2026-10", [rodape({ situacao: "parcial", valor: 100 })], E).linhas[0]).toMatchObject({ texto: "Saldo parcial a acertar no fechamento de 01/11/2026 (a seu favor)", tipo: "info" });
    expect(comoChega([], "2026-10", [rodape({ situacao: "em_conferencia" })], E).linhas[0]).toMatchObject({ tipo: "aviso", texto: expect.stringContaining("Em conferência") });
    expect(comoChega([], "2026-10", [rodape({ situacao: "zerado", valor: 0 })], E)).toEqual({ linhas: [], quemPagaQuem: null });
    const aPagar = comoChega([{ ...bruno, repasse: { ...bruno.repasse!, situacao: "a_pagar", dataPagamento: null } }], "2026-10", [], E).linhas[0];
    expect(aPagar).toMatchObject({ texto: "Repasse antecipado de 16/10 a pagar (Bruno)", tipo: "info" });
    expect(comoChega([{ ...ana, pagamento: null }], "2026-10", [], E).linhas[0].texto).toContain("sem prazo do canal cadastrado");
    // Dois proprietários: o nome em cada linha do fechamento.
    const dois = comoChega([], "2026-10", [rodape(), rodape({ nome: "Empresa Dela", valor: 100 })], E);
    expect(dois.linhas.map((l) => l.texto)).toEqual(["A transferir no fechamento, previsto para 01/11/2026 — Maria Exemplo", "A transferir no fechamento, previsto para 01/11/2026 — Empresa Dela"]);
  });
});

describe("conciliação do extrato dos canais ao resultado por noite", () => {
  it("por canal pelo que pagou no mês, subtotal, ponte (noite do mês paga antes; a receber) e total por competência; a ponte fecha", () => {
    const l = conciliacao(partes, "2026-10", E);
    expect(l.map((x) => [x.rotulo, x.reservas, x.bruto, x.taxa, x.suaParte, x.tipo])).toEqual([
      ["Airbnb", 3, 790000, 23700, 651355, "canal"],
      ["Booking.com", 1, 300000, 45000, 216750, "canal"],
      ["Site Sua Casa Leblon", 1, 425000, 17000, 346800, "canal"],
      ["Pago pelos canais em outubro de 2026", 5, 1515000, 85700, 1214905, "subtotal"],
      ["+ 1 noite de outubro de 2026 paga em setembro de 2026 (Zé (29/9 → 2/10), Airbnb, paga em 30/9)", 1, 100000, 3000, 82450, "ponte"],
      ["+ a receber (Elisa (30/10 → 2/11), Booking.com, 2 noites de outubro de 2026)", 1, 330000, 49500, 238425, "ponte"],
      ["Resultado por noite de outubro de 2026", 7, 1945000, 138200, 1535780, "total"],
    ]);
    expect(l[0].quemRecebeu).toBe("o Airbnb pagou a você direto em 3/10, 19/10 e 24/10 (, no dia seguinte a cada check-in)".replace("(, ", "("));
    expect(l[1].quemRecebeu).toBe("pagou à Sua Casa Leblon em 14/10");
    expect(l[4].quemRecebeu).toContain("já na sua conta desde então");
    expect(l[5].quemRecebeu).toBe("o Booking.com ainda não pagou: a parte fica a liberar e entra no próximo repasse");
    expect(conciliacaoFecha(l)).toBe(true);
  });

  it("noite de outro mês paga neste mês entra negativa (ponte), e paga depois do mês aparece como tal", () => {
    // Relatório de setembro: as duas noites de setembro de Zé foram pagas em 30/9, e a de outubro também (sai na ponte).
    const set = conciliacao([zeSetembro, ze], "2026-09", E);
    expect(set.map((x) => [x.rotulo, x.suaParte, x.tipo])).toEqual([
      ["Airbnb", 164900 + 82450, "canal"],
      ["Pago pelos canais em setembro de 2026", 164900 + 82450, "subtotal"],
      ["− 1 noite de outubro de 2026 paga em setembro de 2026 (Zé (29/9 → 2/10), Airbnb)", -82450, "ponte"],
      ["Resultado por noite de setembro de 2026", 164900, "total"],
    ]);
    expect(conciliacaoFecha(set)).toBe(true);
    const depois = conciliacao([parte({ reservaId: "fim", hospede: "Fim", checkin: "2026-10-31", checkout: "2026-11-02", noitesNoMes: 1, noitesTotal: 2, bruto: 50000, taxa: 1500, comissao: 7275, suaParte: 41225, pagamento: { data: "2026-11-01", fonte: "canal", prazo: 1 } })], "2026-10", E);
    expect(depois.map((x) => x.rotulo)).toEqual(["Pago pelos canais em outubro de 2026", "+ paga em 1/11, depois do mês (Fim (31/10 → 2/11), Airbnb, 1 noite de outubro de 2026)", "Resultado por noite de outubro de 2026"]);
    expect(depois[1].quemRecebeu).toBe("o Airbnb pagou a você direto depois do fim do mês");
    expect(conciliacaoFecha(depois)).toBe(true);
    expect(conciliacaoFecha([])).toBe(false);
  });
});
