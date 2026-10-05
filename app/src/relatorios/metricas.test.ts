import { describe, expect, it } from "vitest";
import { acumuladoDoAno, diariaMedia, diasDeImovel, diasDoMes, escalaEmMil, intervalosDePosse, limitesDe, mesCurto, nomeDoMes, noitesBloqueadas, noitesContadasPorEstadia, noitesNoIntervalo, noitesOcupadasNoIntervalo, ocupacao, quadrosDoMes, serieDe12, somarMeses, trechosNaPosse, variacao } from "./metricas";

const mes = (over: Partial<Parameters<typeof quadrosDoMes>[0]["atual"]> = {}) => ({ mes: "2026-10", resultado: 1503780, bruto: 1945000, noitesOcupadas: 18, noitesDoPeriodo: 31, imoveis: 1, diasImovel: 31, noitesBloqueadas: 2, ...over });

describe("métricas do relatório mensal (M5.7, regras puras)", () => {
  it("meses: soma, dias, limites, nomes", () => {
    expect(somarMeses("2026-10", -11)).toBe("2025-11");
    expect(somarMeses("2026-12", 1)).toBe("2027-01");
    expect(somarMeses("2026-01", -1)).toBe("2025-12");
    expect(diasDoMes("2026-10")).toBe(31);
    expect(diasDoMes("2028-02")).toBe(29);
    expect(limitesDe("2026-12")).toEqual({ inicio: "2026-12-01", fim: "2027-01-01" });
    expect(nomeDoMes("2026-10")).toBe("outubro de 2026");
    expect(mesCurto("2025-11")).toBe("nov/25");
  });

  it("noites de imóvel para vender: por imóvel, desde o vínculo; antes do período inteiro, no meio, depois do fim", () => {
    expect(diasDeImovel([{ desde: null }], "2026-10-01", "2026-11-01")).toBe(31);
    expect(diasDeImovel([{ desde: "2025-01-01" }, { desde: "2026-10-11" }], "2026-10-01", "2026-11-01")).toBe(31 + 21);
    expect(diasDeImovel([{ desde: "2026-11-05" }], "2026-10-01", "2026-11-01")).toBe(0);
    // Parcial até o dia 10 (fim exclusivo 11/10) com vínculo em 5/10: 6 noites.
    expect(diasDeImovel([{ desde: "2026-10-05" }], "2026-10-01", "2026-10-11")).toBe(6);
    expect(diasDeImovel([], "2026-10-01", "2026-11-01")).toBe(0);
    // Dono antigo: a posse termina no dia em que o seguinte foi vinculado (11/10 → 10 noites); acabou antes do mês → zero.
    expect(diasDeImovel([{ desde: null, ate: "2026-10-11" }], "2026-10-01", "2026-11-01")).toBe(10);
    expect(diasDeImovel([{ desde: "2026-10-03", ate: "2026-10-11" }], "2026-10-01", "2026-11-01")).toBe(8);
    expect(diasDeImovel([{ desde: null, ate: "2026-09-20" }], "2026-10-01", "2026-11-01")).toBe(0);
    // A ocupação usa essas noites: 18 ocupadas de 21 (vínculo em 11/10), com 1 bloqueada → 18 de 20.
    expect(ocupacao({ noitesOcupadas: 18, diasImovel: 21, noitesBloqueadas: 1 })).toEqual({ ocupadas: 18, disponiveis: 20, bloqueadas: 1, percentual: 90 });
  });

  it("noites no intervalo: só as do mês, fim exclusivo; estada fora do mês dá zero", () => {
    expect(noitesNoIntervalo("2026-09-29", "2026-10-02", "2026-10-01", "2026-11-01")).toBe(1);
    expect(noitesNoIntervalo("2026-10-30", "2026-11-02", "2026-10-01", "2026-11-01")).toBe(2);
    expect(noitesNoIntervalo("2026-10-10", "2026-10-13", "2026-10-01", "2026-11-01")).toBe(3);
    expect(noitesNoIntervalo("2026-09-10", "2026-09-13", "2026-10-01", "2026-11-01")).toBe(0);
    // Parcial até o dia 10: fim exclusivo em 11/10.
    expect(noitesNoIntervalo("2026-10-08", "2026-10-20", "2026-10-01", "2026-10-11")).toBe(3);
  });

  it("noites bloqueadas: recorte no intervalo, sem contar duas vezes a mesma noite do mesmo imóvel; imóveis diferentes somam", () => {
    const b = [
      { imovelId: "a", inicio: "2026-09-29", fim: "2026-10-03" },
      { imovelId: "a", inicio: "2026-10-02", fim: "2026-10-05" },
      { imovelId: "b", inicio: "2026-10-30", fim: "2026-11-05" },
    ];
    expect(noitesBloqueadas(b, "2026-10-01", "2026-11-01")).toBe(4 + 2);
    expect(noitesBloqueadas([], "2026-10-01", "2026-11-01")).toBe(0);
  });

  it("ocupação: ocupadas ÷ disponíveis (noites × imóveis − bloqueadas); sem disponível, não se aplica; diária média sem noite é null", () => {
    expect(ocupacao({ noitesOcupadas: 18, diasImovel: 31, noitesBloqueadas: 2 })).toEqual({ ocupadas: 18, disponiveis: 29, bloqueadas: 2, percentual: 62 });
    expect(ocupacao({ noitesOcupadas: 0, diasImovel: 31, noitesBloqueadas: 31 }).percentual).toBeNull();
    expect(ocupacao({ noitesOcupadas: 10, diasImovel: 20, noitesBloqueadas: 0 }).percentual).toBe(50);
    expect(diariaMedia(1945000, 18)).toBe(108056);
    expect(diariaMedia(0, 0)).toBeNull();
  });

  it("variação: percentual sobre o anterior; base zero vira diferença em R$; sem dado é null", () => {
    expect(variacao(1503780, 1304000)).toEqual({ tipo: "percentual", valor: 15 });
    expect(variacao(800, 1000)).toEqual({ tipo: "percentual", valor: -20 });
    expect(variacao(500, 0)).toEqual({ tipo: "diferenca", valor: 500 });
    expect(variacao(500, -1000)).toEqual({ tipo: "percentual", valor: 150 });
    expect(variacao(500, null)).toBeNull();
  });

  it("série de 12 meses e acumulado do ano: meses sem dado ficam null; acumulado diz desde quando há dado", () => {
    const r = new Map<string, number | null>([
      ["2026-05", 980000],
      ["2026-06", 1120000],
      ["2026-07", 1390000],
      ["2026-08", 1210000],
      ["2026-09", 1304000],
      ["2026-10", 1503780],
    ]);
    const s = serieDe12(r, "2026-10");
    expect(s).toHaveLength(12);
    expect(s[0]).toEqual({ mes: "2025-11", resultado: null, atual: false });
    expect(s[11]).toEqual({ mes: "2026-10", resultado: 1503780, atual: true });
    expect(s.filter((p) => p.resultado === null)).toHaveLength(6);
    expect(acumuladoDoAno(r, "2026-10")).toEqual({ valor: 7507780, desde: "2026-05" });
    expect(acumuladoDoAno(r, "2026-04")).toBeNull();
    expect(acumuladoDoAno(new Map([["2026-01", 100], ["2026-12", 5]]), "2026-10")).toEqual({ valor: 100, desde: "2026-01" });
    expect(escalaEmMil(1503780)).toEqual({ teto: 16, passo: 4 });
    expect(escalaEmMil(0)).toEqual({ teto: 1, passo: 1 });
    expect(escalaEmMil(42_000_00)).toEqual({ teto: 60, passo: 20 });
  });

  it("noites contadas por estadia: na posse e no período, fora das bloqueadas; a noite disputada fica com quem entrou primeiro", () => {
    const e = (imovelId: string, checkin: string, checkout: string) => ({ imovelId, checkin, trechos: [{ inicio: checkin, fim: checkout }] });
    // 10→13 e 12→15 no mesmo imóvel: a noite de 12 é da primeira; a segunda fica com 13 e 14. Total 5, como em noitesOcupadasNoIntervalo.
    expect(noitesContadasPorEstadia([e("a", "2026-10-12", "2026-10-15"), e("a", "2026-10-10", "2026-10-13")], [], "2026-10-01", "2026-11-01")).toEqual([2, 3]);
    // Mesmo check-in: a ordem da lista desempata. Outro imóvel não disputa.
    expect(noitesContadasPorEstadia([e("a", "2026-10-10", "2026-10-12"), e("a", "2026-10-10", "2026-10-12"), e("b", "2026-10-10", "2026-10-12")], [], "2026-10-01", "2026-11-01")).toEqual([2, 0, 2]);
    // Noite bloqueada não conta; só o que cai no intervalo; só os trechos dados (posse).
    expect(noitesContadasPorEstadia([e("a", "2026-10-10", "2026-10-13")], [{ imovelId: "a", inicio: "2026-10-12", fim: "2026-10-13" }], "2026-10-01", "2026-11-01")).toEqual([2]);
    expect(noitesContadasPorEstadia([e("a", "2026-09-29", "2026-10-02")], [], "2026-10-01", "2026-11-01")).toEqual([1]);
    expect(noitesContadasPorEstadia([{ imovelId: "a", checkin: "2026-10-10", trechos: [{ inicio: "2026-10-11", fim: "2026-10-13" }] }], [], "2026-10-01", "2026-11-01")).toEqual([2]);
  });

  it("trechos na posse: uma estadia ou bloqueio que atravessa a troca de dono fica só com os dias de cada dono; fora da posse, nada", () => {
    expect(trechosNaPosse("2026-10-10", "2026-10-13", [{ desde: null, ate: "2026-10-11" }])).toEqual([{ inicio: "2026-10-10", fim: "2026-10-11" }]);
    expect(trechosNaPosse("2026-10-10", "2026-10-13", [{ desde: "2026-10-11", ate: null }])).toEqual([{ inicio: "2026-10-11", fim: "2026-10-13" }]);
    expect(trechosNaPosse("2026-10-10", "2026-10-13", [{ desde: null, ate: null }])).toEqual([{ inicio: "2026-10-10", fim: "2026-10-13" }]);
    expect(trechosNaPosse("2026-10-10", "2026-10-13", [{ desde: "2026-11-05", ate: null }])).toEqual([]);
    // Dois intervalos (o imóvel saiu e voltou): a estadia longa fica em dois trechos.
    expect(trechosNaPosse("2026-10-01", "2026-12-10", [{ desde: null, ate: "2026-10-11" }, { desde: "2026-12-01", ate: null }])).toEqual([{ inicio: "2026-10-01", fim: "2026-10-11" }, { inicio: "2026-12-01", fim: "2026-12-10" }]);
    // Noites ocupadas só dentro da posse: o dono antigo conta 1 noite da estadia de 10 a 13/10, não 3.
    const trechos = trechosNaPosse("2026-10-10", "2026-10-13", [{ desde: null, ate: "2026-10-11" }]).map((t) => ({ imovelId: "a", checkin: t.inicio, checkout: t.fim }));
    expect(noitesOcupadasNoIntervalo(trechos, [], "2026-10-01", "2026-11-01")).toBe(1);
  });

  it("intervalos de posse: pelo histórico (ganhou/perdeu) e pelos vínculos; perda sem ganho = desde sempre; imóvel que volta = dois intervalos; sem nada = até o vínculo do seguinte", () => {
    const ev = (proprietarioId: string, antes: string[], depois: string[], dia: string) => ({ proprietarioId, mudancas: { imoveis: [antes, depois] }, dia });
    // Vínculo atual sem histórico: desde o vínculo.
    expect(intervalosDePosse("a", ["A"], [{ imovelId: "a", proprietarioId: "A", dia: "2026-10-11" }], [])).toEqual([{ desde: "2026-10-11", ate: null }]);
    // Dono antigo sem histórico: até o vínculo do seguinte; sem ninguém, o período inteiro.
    expect(intervalosDePosse("a", ["A"], [{ imovelId: "a", proprietarioId: "B", dia: "2026-10-11" }], [])).toEqual([{ desde: null, ate: "2026-10-11" }]);
    expect(intervalosDePosse("a", ["A"], [], [])).toEqual([{ desde: null, ate: null }]);
    // Histórico: A perde em 11/10 (sem ganho registrado: era dele desde sempre) e volta em 1/12 (vínculo novo).
    const hist = [ev("A", ["a", "b"], ["b"], "2026-10-11"), ev("B", [], ["a"], "2026-10-11"), ev("B", ["a"], [], "2026-12-01"), ev("A", ["b"], ["b", "a"], "2026-12-01")];
    const vinc = [{ imovelId: "a", proprietarioId: "A", dia: "2026-12-01" }];
    expect(intervalosDePosse("a", ["A"], vinc, hist)).toEqual([{ desde: null, ate: "2026-10-11" }, { desde: "2026-12-01", ate: null }]);
    expect(intervalosDePosse("a", ["B"], vinc, hist)).toEqual([{ desde: "2026-10-11", ate: "2026-12-01" }]);
    // Histórico de outro imóvel ou de outro dono não entra; mudança malformada é ignorada.
    expect(intervalosDePosse("b", ["A"], [{ imovelId: "b", proprietarioId: "A", dia: "2026-01-05" }], [...hist, { proprietarioId: "A", mudancas: { imoveis: "x" }, dia: "2026-02-01" }])).toEqual([{ desde: "2026-01-05", ate: null }]);
    // Os intervalos somam nas noites para vender: outubro de A = 10 noites; de B = 21.
    expect(diasDeImovel(intervalosDePosse("a", ["A"], vinc, hist), "2026-10-01", "2026-11-01")).toBe(10);
    expect(diasDeImovel(intervalosDePosse("a", ["B"], vinc, hist), "2026-10-01", "2026-11-01")).toBe(21);
  });

  it("noites ocupadas: cada noite de cada imóvel conta uma vez (overbooking), noite bloqueada para uso próprio não conta, fora do intervalo não conta", () => {
    const r = (imovelId: string, checkin: string, checkout: string) => ({ imovelId, checkin, checkout });
    // Duas reservas sobrepostas no mesmo imóvel (10→13 e 12→15): 5 noites, não 6; outro imóvel soma à parte.
    expect(noitesOcupadasNoIntervalo([r("x", "2026-10-10", "2026-10-13"), r("x", "2026-10-12", "2026-10-15"), r("y", "2026-10-12", "2026-10-13")], [], "2026-10-01", "2026-11-01")).toBe(6);
    // Noite de 12/10 bloqueada pelo dono no imóvel x: sai das ocupadas (já saiu das disponíveis); o bloqueio de y não afeta x.
    expect(noitesOcupadasNoIntervalo([r("x", "2026-10-10", "2026-10-13")], [{ imovelId: "x", inicio: "2026-10-12", fim: "2026-10-13" }, { imovelId: "y", inicio: "2026-10-10", fim: "2026-10-11" }], "2026-10-01", "2026-11-01")).toBe(2);
    // Só o que cai no intervalo (mês parcial até o dia 11: fim exclusivo 12/10).
    expect(noitesOcupadasNoIntervalo([r("x", "2026-10-10", "2026-10-13")], [], "2026-10-01", "2026-10-12")).toBe(2);
    expect(noitesOcupadasNoIntervalo([r("x", "2026-09-29", "2026-10-02")], [], "2026-10-01", "2026-11-01")).toBe(1);
    expect(noitesOcupadasNoIntervalo([], [], "2026-10-01", "2026-11-01")).toBe(0);
  });

  it("quadros do mês: noites e ocupação, diária média, comparação com o mês anterior e com o ano anterior", () => {
    const q = quadrosDoMes({ atual: mes(), anterior: mes({ mes: "2026-09", resultado: 1304000, noitesOcupadas: 16, noitesDoPeriodo: 30, diasImovel: 30, noitesBloqueadas: 0 }), anoAnterior: null, parcialAte: null });
    expect(q[0]).toEqual({ valor: "18 noites", legenda: "62% de ocupação: 18 de 29 noites disponíveis (2 bloqueadas para seu uso)", semDado: false });
    expect(q[1]).toEqual({ valor: "R$ 1.080,56", legenda: "diária média por noite, com limpeza (bruto ÷ noites)", semDado: false });
    expect(q[2]).toEqual({ valor: "+15%", legenda: "resultado comparado a setembro de 2026 (R$ 13.040,00); ocupação de 53% para 62%", semDado: false });
    expect(q[3]).toEqual({ valor: "sem dado no sistema", legenda: "outubro de 2025 não está no sistema; a comparação ano a ano começa quando houver", semDado: true });
  });

  it("quadros: base zero vira diferença em R$; mês inteiro bloqueado não se aplica; sem reserva não há diária; mês parcial não compara e conta as noites até o dia", () => {
    const zero = quadrosDoMes({ atual: mes(), anterior: mes({ mes: "2026-09", resultado: 0, noitesOcupadas: 0, noitesDoPeriodo: 30, diasImovel: 30, noitesBloqueadas: 0 }), anoAnterior: mes({ mes: "2025-10", resultado: 2000000 }), parcialAte: null });
    expect(zero[2]).toMatchObject({ valor: "+ R$ 15.037,80", legenda: expect.stringContaining("setembro de 2026 sem resultado (R$ 0,00)"), semDado: false });
    expect(zero[3]).toMatchObject({ valor: "−25%", legenda: expect.stringContaining("outubro de 2025 (R$ 20.000,00)") });
    const bloqueado = quadrosDoMes({ atual: mes({ noitesOcupadas: 0, bruto: 0, noitesBloqueadas: 31 }), anterior: null, anoAnterior: null, parcialAte: null });
    expect(bloqueado[0]).toEqual({ valor: "0 noites", legenda: "ocupação não se aplica: todas as noites bloqueadas para seu uso", semDado: false });
    expect(bloqueado[1]).toMatchObject({ valor: "sem reserva no mês", semDado: true });
    const parcial = quadrosDoMes({ atual: mes({ noitesOcupadas: 7, noitesDoPeriodo: 10, diasImovel: 10, noitesBloqueadas: 0 }), anterior: mes({ mes: "2026-09" }), anoAnterior: null, parcialAte: 10 });
    expect(parcial[0]).toEqual({ valor: "7 noites até 10/10", legenda: "70% de ocupação: 7 de 10 noites disponíveis", semDado: false });
    expect(parcial[2]).toMatchObject({ valor: "mês em andamento", legenda: expect.stringContaining("até 10/10"), semDado: true });
    expect(parcial[3]).toMatchObject({ valor: "mês em andamento", semDado: true });
  });
});
