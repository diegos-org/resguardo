import { describe, expect, it } from "vitest";
import { acumuladoDoAno, diariaMedia, diasDoMes, escalaEmMil, limitesDe, mesCurto, nomeDoMes, noitesBloqueadas, noitesNoIntervalo, ocupacao, quadrosDoMes, serieDe12, somarMeses, variacao } from "./metricas";

const mes = (over: Partial<Parameters<typeof quadrosDoMes>[0]["atual"]> = {}) => ({ mes: "2026-10", resultado: 1503780, bruto: 1945000, noitesOcupadas: 18, noitesDoPeriodo: 31, imoveis: 1, noitesBloqueadas: 2, ...over });

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
    expect(ocupacao({ noitesOcupadas: 18, noitesDoPeriodo: 31, imoveis: 1, noitesBloqueadas: 2 })).toEqual({ ocupadas: 18, disponiveis: 29, bloqueadas: 2, percentual: 62 });
    expect(ocupacao({ noitesOcupadas: 0, noitesDoPeriodo: 31, imoveis: 1, noitesBloqueadas: 31 }).percentual).toBeNull();
    expect(ocupacao({ noitesOcupadas: 10, noitesDoPeriodo: 10, imoveis: 2, noitesBloqueadas: 0 }).percentual).toBe(50);
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

  it("quadros do mês: noites e ocupação, diária média, comparação com o mês anterior e com o ano anterior", () => {
    const q = quadrosDoMes({ atual: mes(), anterior: mes({ mes: "2026-09", resultado: 1304000, noitesOcupadas: 16, noitesDoPeriodo: 30, noitesBloqueadas: 0 }), anoAnterior: null, parcialAte: null });
    expect(q[0]).toEqual({ valor: "18 noites", legenda: "62% de ocupação: 18 de 29 noites disponíveis (2 bloqueadas para seu uso)", semDado: false });
    expect(q[1]).toEqual({ valor: "R$ 1.080,56", legenda: "diária média por noite, com limpeza (bruto ÷ noites)", semDado: false });
    expect(q[2]).toEqual({ valor: "+15%", legenda: "resultado comparado a setembro de 2026 (R$ 13.040,00); ocupação de 53% para 62%", semDado: false });
    expect(q[3]).toEqual({ valor: "sem dado no sistema", legenda: "outubro de 2025 não está no sistema; a comparação ano a ano começa quando houver", semDado: true });
  });

  it("quadros: base zero vira diferença em R$; mês inteiro bloqueado não se aplica; sem reserva não há diária; mês parcial não compara e conta as noites até o dia", () => {
    const zero = quadrosDoMes({ atual: mes(), anterior: mes({ mes: "2026-09", resultado: 0, noitesOcupadas: 0, noitesDoPeriodo: 30, noitesBloqueadas: 0 }), anoAnterior: mes({ mes: "2025-10", resultado: 2000000 }), parcialAte: null });
    expect(zero[2]).toMatchObject({ valor: "+ R$ 15.037,80", legenda: expect.stringContaining("setembro de 2026 sem resultado (R$ 0,00)"), semDado: false });
    expect(zero[3]).toMatchObject({ valor: "−25%", legenda: expect.stringContaining("outubro de 2025 (R$ 20.000,00)") });
    const bloqueado = quadrosDoMes({ atual: mes({ noitesOcupadas: 0, bruto: 0, noitesBloqueadas: 31 }), anterior: null, anoAnterior: null, parcialAte: null });
    expect(bloqueado[0]).toEqual({ valor: "0 noites", legenda: "ocupação não se aplica: todas as noites bloqueadas para seu uso", semDado: false });
    expect(bloqueado[1]).toMatchObject({ valor: "sem reserva no mês", semDado: true });
    const parcial = quadrosDoMes({ atual: mes({ noitesOcupadas: 7, noitesDoPeriodo: 10, noitesBloqueadas: 0 }), anterior: mes({ mes: "2026-09" }), anoAnterior: null, parcialAte: 10 });
    expect(parcial[0]).toEqual({ valor: "7 noites até 10/10", legenda: "70% de ocupação: 7 de 10 noites disponíveis", semDado: false });
    expect(parcial[2]).toMatchObject({ valor: "mês em andamento", legenda: expect.stringContaining("até 10/10"), semDado: true });
    expect(parcial[3]).toMatchObject({ valor: "mês em andamento", semDado: true });
  });
});
