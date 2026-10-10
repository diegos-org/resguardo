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
/** Relatório gerado no dia 2/11: toda data de pagamento de outubro já passou. */
const HOJE = "2026-11-02";

describe("como chega até você (M5.7, pela data em que o canal pagou)", () => {
  it("uma linha por caminho: pago direto pelo canal no mês, noite paga antes, já repassado, a transferir no fechamento, a liberar; e quem paga quem sem chave Pix", () => {
    const { linhas, quemPagaQuem } = comoChega(partes, "2026-10", HOJE, [rodape()], E);
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

  it("relatório de setembro: o que o Airbnb pagou no mês inclui a noite de outubro da reserva que atravessa, discriminada (e a conciliação faz a ponte)", () => {
    const { linhas } = comoChega([zeSetembro, ze], "2026-09", HOJE, [rodape({ situacao: "zerado", valor: 0 })], E);
    expect(linhas.map((l) => [l.texto, l.valor, l.tipo])).toEqual([
      ["Pago a você direto pelo Airbnb em setembro de 2026 (1 reserva, no dia seguinte a cada check-in)", 164900 + 82450, "normal"],
      ["Desse valor, 1 noite de outubro de 2026 da reserva de Zé (29/9 → 2/10), paga junto: entra no resultado de outubro de 2026", 82450, "info"],
    ]);
    // Em outubro, a mesma noite aparece como já paga em setembro (não entra no "pago em outubro").
    const out = comoChega([zeSetembro, ze], "2026-10", HOJE, [rodape({ situacao: "zerado", valor: 0 })], E).linhas;
    expect(out.map((l) => l.tipo)).toEqual(["info"]);
    expect(out[0].texto).toContain("Já pago pelo Airbnb em 30/9");
  });

  it("antecipado que paga uma reserva que atravessa o mês: o Pix inteiro no mês da data dele, com a parte do outro mês discriminada; no outro mês, só informação", () => {
    // Fábio, 30/10 → 2/11 pelo Booking: 1 noite de outubro (R$ 240,83) e 2 de novembro (R$ 481,67) num antecipado só, pago em 31/10 (R$ 722,50).
    const fabioOut = parte({ reservaId: "fabio", hospede: "Fábio", canal: "booking", checkin: "2026-10-30", checkout: "2026-11-02", mes: "2026-10", noitesNoMes: 1, noitesTotal: 3, bruto: 100000, taxa: 15000, comissao: 12750, suaParte: 24083, quemRecebe: "empresa", situacao: "repassado", pagamento: { data: "2026-10-28", fonte: "recebimento" }, repasse: { id: "rep2", tipo: "antecipado", data: "2026-10-31", situacao: "pago", dataPagamento: "2026-10-31", valor: 24083 } });
    const fabioNov = parte({ ...fabioOut, mes: "2026-11", noitesNoMes: 2, bruto: 200000, taxa: 30000, comissao: 25500, suaParte: 48167, repasse: { ...fabioOut.repasse!, valor: 48167 } });
    const out = comoChega([fabioOut, fabioNov], "2026-10", HOJE, [], E).linhas;
    expect(out.map((l) => [l.texto, l.valor, l.tipo, l.origem])).toEqual([
      ["Já repassado em 31/10 (repasse antecipado: Fábio; Pix com comprovante no portal)", 72250, "normal", "antecipado"],
      ["Desse valor, 2 noites de novembro de 2026 da reserva de Fábio (30/10 → 2/11), pagas junto: entram no resultado de novembro de 2026", 48167, "info", "antecipado"],
    ]);
    // Em novembro, as 2 noites aparecem como já repassadas em outubro (informação), sem somar de novo o Pix.
    const nov = comoChega([fabioOut, fabioNov], "2026-11", HOJE, [], E).linhas;
    expect(nov.map((l) => [l.texto, l.valor, l.tipo])).toEqual([["Já repassado em 31/10 (repasse antecipado de outubro de 2026): 2 noites de novembro de 2026 da reserva de Fábio (30/10 → 2/11)", 48167, "info"]]);
    // A pagar: a mesma lógica pela data programada.
    const aPagar = { ...fabioOut.repasse!, situacao: "a_pagar" as const, dataPagamento: null };
    const aPagarOut = comoChega([{ ...fabioOut, repasse: aPagar }, { ...fabioNov, repasse: aPagar }], "2026-10", HOJE, [], E).linhas;
    expect(aPagarOut.map((l) => [l.texto, l.valor])).toEqual([
      ["Repasse antecipado de 31/10 a pagar (Fábio)", 72250],
      ["Desse valor, 2 noites de novembro de 2026 da reserva de Fábio (30/10 → 2/11), pagas junto: entram no resultado de novembro de 2026", 48167],
    ]);
    expect(comoChega([{ ...fabioOut, repasse: aPagar }, { ...fabioNov, repasse: aPagar }], "2026-11", HOJE, [], E).linhas.map((l) => l.texto)).toEqual(["Repasse antecipado de 31/10 a pagar: 2 noites de novembro de 2026 da reserva de Fábio (30/10 → 2/11)"]);
    // Acertado por fora: só as noites do mês, sem linha no mês em que não há parte.
    const porFora = { id: "pf", tipo: "por_fora" as const, data: "2026-09-01", situacao: "pago" as const, dataPagamento: "2026-09-01", valor: 0 };
    expect(comoChega([{ ...fabioOut, repasse: porFora }, { ...fabioNov, repasse: porFora }], "2026-10", HOJE, [], E).linhas).toEqual([{ texto: "Acertado por fora, antes do início do sistema (reserva de Fábio)", valor: 24083, tipo: "info", origem: "antecipado" }]);
    expect(comoChega([{ ...fabioOut, repasse: porFora }], "2026-11", HOJE, [], E).linhas).toEqual([]);
  });

  it("antecipado que também pagou reserva de outro imóvel do dono: a linha traz o Pix inteiro (valor gravado) e discrimina a parte fora deste relatório", () => {
    const linhas = comoChega([bruno], "2026-10", HOJE, [], E, [{ id: "rep1", valor: 216750 + 100000, reservas: ["Bruno", "Gabi"] }]).linhas;
    expect(linhas.map((l) => [l.texto, l.valor, l.tipo])).toEqual([
      ["Já repassado em 16/10 (repasse antecipado: Bruno; Pix com comprovante no portal)", 316750, "normal"],
      ["Desse valor, a parte de Gabi, fora deste relatório (outro imóvel seu ou outro mês): entra no relatório de lá", 100000, "info"],
    ]);
    // Repasse gravado só com as partes deste relatório: nada a discriminar. Sem o repasse gravado, a soma das partes.
    expect(comoChega([bruno], "2026-10", HOJE, [], E, [{ id: "rep1", valor: 216750, reservas: ["Bruno"] }]).linhas).toHaveLength(1);
    expect(comoChega([bruno], "2026-10", HOJE, [], E).linhas[0].valor).toBe(216750);
    // A pagar com data no mês segue a mesma régua (a data programada, como a tabela de repasses), mesmo sem data de pagamento.
    const aPagar = { ...bruno, repasse: { ...bruno.repasse!, situacao: "a_pagar" as const, dataPagamento: null } };
    expect(comoChega([aPagar], "2026-10", HOJE, [], E, [{ id: "rep1", valor: 316750, reservas: ["Bruno", "Gabi"] }]).linhas.map((l) => l.valor)).toEqual([316750, 100000]);
  });

  it("data do canal ainda no futuro (relatório parcial): previsto, não pago — na capa e na conciliação, que continua fechando", () => {
    // Posição de 15/10: Ana (paga em 3/10) já entrou; Diana (18 → 21/10, paga em 19/10) é previsão.
    const { linhas } = comoChega([ana, diana], "2026-10", "2026-10-15", [rodape({ situacao: "parcial", valor: 0 })], E);
    expect(linhas.map((l) => [l.texto, l.valor, l.tipo])).toEqual([
      ["Pago a você direto pelo Airbnb em outubro de 2026 (1 reserva, no dia seguinte a cada check-in)", 272085, "normal"],
      ["Previsto para 19/10: o Airbnb paga a você direto (3 noites de outubro de 2026 da reserva de Diana (18/10 → 21/10))", 239105, "info"],
      ["Saldo parcial a acertar no fechamento de 01/11/2026 (a seu favor)", 0, "info"],
    ]);
    const l = conciliacao([ana, diana], "2026-10", "2026-10-15", E);
    expect(l.map((x) => [x.rotulo, x.suaParte, x.tipo])).toEqual([
      ["Airbnb", 272085, "canal"],
      ["Pago pelos canais em outubro de 2026", 272085, "subtotal"],
      ["+ previstas para 19/10 (Diana (18/10 → 21/10), Airbnb, 3 noites de outubro de 2026)", 239105, "ponte"],
      ["Resultado por noite de outubro de 2026", 272085 + 239105, "total"],
    ]);
    expect(l[2].quemRecebeu).toBe("o Airbnb paga a você direto em 19/10");
    expect(conciliacaoFecha(l)).toBe(true);
    // Relatório de um mês futuro: nada pago, inclusive a noite que o canal pagaria antes do mês.
    const futuro = comoChega([zeSetembro, ze], "2026-10", "2026-09-20", [], E).linhas;
    expect(futuro.map((x) => x.texto)).toEqual(["Previsto para 30/9: o Airbnb paga a você direto (1 noite de outubro de 2026 da reserva de Zé (29/9 → 2/10))"]);
    expect(conciliacaoFecha(conciliacao([zeSetembro, ze], "2026-10", "2026-09-20", E))).toBe(true);
  });

  it("antecipado programado para 31/10 e pago em 1/11: é dinheiro de novembro (data do Pix), e outubro só informa", () => {
    const virada = { ...bruno, repasse: { ...bruno.repasse!, data: "2026-10-31", dataPagamento: "2026-11-01" } };
    expect(comoChega([virada], "2026-10", HOJE, [], E).linhas.map((l) => [l.texto, l.valor, l.tipo])).toEqual([
      ["Já repassado em 1/11 (repasse antecipado de novembro de 2026): 3 noites de outubro de 2026 da reserva de Bruno (7/10 → 10/10)", 216750, "info"],
    ]);
    expect(comoChega([virada], "2026-11", HOJE, [], E, [{ id: "rep1", valor: 216750, reservas: ["Bruno"] }]).linhas.map((l) => [l.texto, l.valor, l.tipo])).toEqual([
      ["Já repassado em 1/11 (repasse antecipado: Bruno; Pix com comprovante no portal)", 216750, "normal"],
      ["Desse valor, 3 noites de outubro de 2026 da reserva de Bruno (7/10 → 10/10), pagas junto: entram no resultado de outubro de 2026", 216750, "info"],
    ]);
    // Enquanto não pago, vale a data programada.
    const aPagar = { ...virada, repasse: { ...virada.repasse!, situacao: "a_pagar" as const, dataPagamento: null } };
    expect(comoChega([aPagar], "2026-10", HOJE, [], E).linhas[0].texto).toBe("Repasse antecipado de 31/10 a pagar (Bruno)");
    expect(comoChega([aPagar], "2026-11", HOJE, [], E).linhas).toEqual([]);
  });

  it("fechamento pago, proprietário que deve, saldo parcial, em conferência, repasse a pagar e sem prazo do canal", () => {
    expect(comoChega([ana], "2026-10", HOJE, [rodape({ situacao: "pago", dataPagamento: "2026-11-01" })], E)).toMatchObject({
      linhas: [expect.anything(), { texto: "Transferido no fechamento, em 01/11/2026", valor: 314800 }],
      quemPagaQuem: expect.stringContaining("transferiu R$ 3.148,00 para Maria Exemplo em 01/11/2026"),
    });
    const deve = comoChega([], "2026-10", HOJE, [rodape({ situacao: "proprietario_deve", valor: 5000, aFavor: "empresa" })], E);
    expect(deve.linhas).toEqual([{ texto: "Você transfere à Sua Casa Leblon no fechamento", valor: 5000, tipo: "aviso", origem: "fechamento", aviso: "voce_transfere" }]);
    expect(deve.quemPagaQuem).toContain("Maria Exemplo transfere R$ 50,00 para a Sua Casa Leblon");
    expect(comoChega([], "2026-10", HOJE, [rodape({ situacao: "parcial", valor: 100 })], E).linhas[0]).toMatchObject({ texto: "Saldo parcial a acertar no fechamento de 01/11/2026 (a seu favor)", tipo: "info" });
    expect(comoChega([], "2026-10", HOJE, [rodape({ situacao: "em_conferencia" })], E).linhas[0]).toMatchObject({ tipo: "aviso", aviso: "em_conferencia", texto: expect.stringContaining("Em conferência") });
    expect(comoChega([], "2026-10", HOJE, [rodape({ situacao: "zerado", valor: 0 })], E)).toEqual({ linhas: [], quemPagaQuem: null });
    const aPagar = comoChega([{ ...bruno, repasse: { ...bruno.repasse!, situacao: "a_pagar", dataPagamento: null } }], "2026-10", HOJE, [], E).linhas[0];
    expect(aPagar).toMatchObject({ texto: "Repasse antecipado de 16/10 a pagar (Bruno)", tipo: "info" });
    // Sem prazo do canal cadastrado: nunca "pago" (a conciliação põe em "a receber"); aviso de dado faltando.
    expect(comoChega([{ ...ana, pagamento: null }], "2026-10", HOJE, [], E).linhas[0]).toMatchObject({ tipo: "aviso", aviso: "sem_prazo_do_canal", texto: "O Airbnb paga a você direto, mas sem data: o prazo do canal não está cadastrado (reserva de Ana (2/10 → 5/10))" });
    expect(conciliacao([{ ...ana, pagamento: null }], "2026-10", HOJE, E).find((l) => l.tipo === "ponte")?.rotulo).toContain("+ a receber");
    // Dois proprietários: o nome em cada linha do fechamento.
    const dois = comoChega([], "2026-10", HOJE, [rodape(), rodape({ nome: "Empresa Dela", valor: 100 })], E);
    expect(dois.linhas.map((l) => l.texto)).toEqual(["A transferir no fechamento, previsto para 01/11/2026 — Maria Exemplo", "A transferir no fechamento, previsto para 01/11/2026 — Empresa Dela"]);
  });
});

describe("conciliação do extrato dos canais ao resultado por noite", () => {
  it("por canal pelo que pagou no mês, subtotal, ponte (noite do mês paga antes; a receber) e total por competência; a ponte fecha", () => {
    const l = conciliacao(partes, "2026-10", HOJE, E);
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
    const set = conciliacao([zeSetembro, ze], "2026-09", HOJE, E);
    expect(set.map((x) => [x.rotulo, x.suaParte, x.tipo])).toEqual([
      ["Airbnb", 164900 + 82450, "canal"],
      ["Pago pelos canais em setembro de 2026", 164900 + 82450, "subtotal"],
      ["− 1 noite de outubro de 2026 paga em setembro de 2026 (Zé (29/9 → 2/10), Airbnb)", -82450, "ponte"],
      ["Resultado por noite de setembro de 2026", 164900, "total"],
    ]);
    expect(conciliacaoFecha(set)).toBe(true);
    const depois = conciliacao([parte({ reservaId: "fim", hospede: "Fim", checkin: "2026-10-31", checkout: "2026-11-02", noitesNoMes: 1, noitesTotal: 2, bruto: 50000, taxa: 1500, comissao: 7275, suaParte: 41225, pagamento: { data: "2026-11-01", fonte: "canal", prazo: 1 } })], "2026-10", HOJE, E);
    expect(depois.map((x) => x.rotulo)).toEqual(["Pago pelos canais em outubro de 2026", "+ paga em 1/11, depois do mês (Fim (31/10 → 2/11), Airbnb, 1 noite de outubro de 2026)", "Resultado por noite de outubro de 2026"]);
    expect(depois[1].quemRecebeu).toBe("o Airbnb pagou a você direto depois do fim do mês");
    expect(conciliacaoFecha(depois)).toBe(true);
    expect(conciliacaoFecha([])).toBe(false);
  });
});

describe("reserva cancelada com devolução ao hóspede depois do repasse (M8.2c)", () => {
  // Novembro: o desconto (parte negativa) da reserva de Bruno, cancelada com devolução integral; outubro já tinha sido repassado.
  const desconto = parte({ ...bruno, mes: "2026-11", noitesNoMes: 0, bruto: -300000, taxa: -45000, comissao: -38250, suaParte: -216750, situacao: "disponivel", motivo: "", pagamento: null, repasse: null, cancelamento: "desconto" });

  it("conciliação: o desconto é uma ponte própria (nenhum canal pagou), e a ponte fecha", () => {
    const l = conciliacao([desconto], "2026-11", HOJE, E);
    expect(l.map((x) => [x.rotulo, x.bruto, x.suaParte, x.quemRecebeu, x.tipo])).toEqual([
      ["Pago pelos canais em novembro de 2026", 0, 0, "", "subtotal"],
      ["− Reserva SCL-1 cancelada com devolução ao hóspede (estadia de 7/10 → 10/10): desconto da parte já repassada", -300000, -216750, "sai do próximo repasse", "ponte"],
      ["Resultado por noite de novembro de 2026", -300000, -216750, "", "total"],
    ]);
    expect(conciliacaoFecha(l)).toBe(true);
    const descontado = conciliacao([{ ...desconto, situacao: "repassado", repasse: { id: "rep2", tipo: "antecipado", data: "2026-11-05", situacao: "pago", dataPagamento: "2026-11-06", valor: -216750 } }], "2026-11", HOJE, E);
    expect(descontado[1].quemRecebeu).toBe("descontada no repasse de 6/11");
  });

  it("como chega: o desconto de outro mês num antecipado sai discriminado, sem falar em noites", () => {
    const carlaNov = parte({ ...carla, mes: "2026-11", repasse: { id: "rep3", tipo: "antecipado", data: "2026-12-04", situacao: "pago", dataPagamento: "2026-12-04", valor: 346800 }, situacao: "repassado" });
    const descontoNov = { ...desconto, mes: "2026-11", situacao: "repassado" as const, repasse: { id: "rep3", tipo: "antecipado" as const, data: "2026-12-04", situacao: "pago" as const, dataPagamento: "2026-12-04", valor: -216750 } };
    const { linhas } = comoChega([carlaNov, descontoNov], "2026-12", "2026-12-10", [], E, [{ id: "rep3", valor: 346800 - 216750, reservas: ["Carla", "Bruno"] }]);
    expect(linhas.map((x) => [x.texto, x.valor])).toEqual([
      ["Já repassado em 4/12 (repasse antecipado: Carla e Bruno; Pix com comprovante no portal)", 130050],
      ["Desse valor, o desconto da parte já repassada da reserva de Bruno (7/10 → 10/10), cancelada com devolução ao hóspede: entra no resultado de novembro de 2026", -216750],
      ["Desse valor, 4 noites de novembro de 2026 da reserva de Carla (12/10 → 16/10), pagas junto: entram no resultado de novembro de 2026", 346800],
    ]);
  });
});

