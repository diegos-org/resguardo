import { describe, expect, it } from "vitest";
import { dividirDevolucao, noitesNovas, principalEJuros, rumoDa, situacaoEfetiva, taxaAtribuida, valorNovo } from "./alteracao-regras";

describe("noitesNovas: o que a alteração precisa segurar (M8.2d)", () => {
  const antes = { checkin: "2026-11-10", checkout: "2026-11-14" };

  it("estadias que não se tocam: a nova inteira (também encostada na de antes)", () => {
    expect(noitesNovas(antes, { checkin: "2026-12-05", checkout: "2026-12-09" })).toEqual({ inicio: "2026-12-05", fim: "2026-12-09" });
    expect(noitesNovas(antes, { checkin: "2026-11-14", checkout: "2026-11-16" })).toEqual({ inicio: "2026-11-14", fim: "2026-11-16" });
    expect(noitesNovas(antes, { checkin: "2026-11-01", checkout: "2026-11-10" })).toEqual({ inicio: "2026-11-01", fim: "2026-11-10" });
  });

  it("estende depois da saída ou antes da entrada: só as noites acrescentadas (exemplo A: 14/11 a 15/11)", () => {
    expect(noitesNovas(antes, { checkin: "2026-11-10", checkout: "2026-11-15" })).toEqual({ inicio: "2026-11-14", fim: "2026-11-15" });
    expect(noitesNovas(antes, { checkin: "2026-11-12", checkout: "2026-11-16" })).toEqual({ inicio: "2026-11-14", fim: "2026-11-16" });
    expect(noitesNovas(antes, { checkin: "2026-11-08", checkout: "2026-11-14" })).toEqual({ inicio: "2026-11-08", fim: "2026-11-10" });
    expect(noitesNovas(antes, { checkin: "2026-11-08", checkout: "2026-11-11" })).toEqual({ inicio: "2026-11-08", fim: "2026-11-10" });
  });

  it("acrescenta dos dois lados: duas_pontas; cabe na de antes (menos noites, ou só pessoas/valor): nenhuma", () => {
    expect(noitesNovas(antes, { checkin: "2026-11-09", checkout: "2026-11-15" })).toBe("duas_pontas");
    expect(noitesNovas(antes, { checkin: "2026-11-11", checkout: "2026-11-13" })).toBeNull();
    expect(noitesNovas(antes, antes)).toBeNull();
  });

  it("estadia inválida é erro de quem chama", () => {
    expect(() => noitesNovas(antes, { checkin: "2026-11-14", checkout: "2026-11-14" })).toThrow();
    expect(() => noitesNovas({ checkin: "2026-02-30", checkout: "2026-03-02" }, antes)).toThrow();
    expect(() => noitesNovas(antes, { checkin: "10/11/2026", checkout: "2026-11-15" })).toThrow();
  });
});

describe("rumo, situação que vale agora e valor que fica com a reserva", () => {
  it("rumoDa: aumento, redução ou igual", () => {
    expect([rumoDa(1), rumoDa(-1), rumoDa(0)]).toEqual(["aumento", "reducao", "igual"]);
  });

  it("situacaoEfetiva: segurada vencida e fora da carência vale expirada; na carência ou no prazo continua segurada; as finais não mudam", () => {
    const agora = new Date("2026-10-01T15:00:00Z");
    const em = (minutos: number) => new Date(agora.getTime() + minutos * 60_000);
    expect(situacaoEfetiva({ situacao: "segurada", holdAte: em(1) }, agora, false)).toBe("segurada");
    expect(situacaoEfetiva({ situacao: "segurada", holdAte: agora }, agora, false)).toBe("expirada");
    expect(situacaoEfetiva({ situacao: "segurada", holdAte: em(-5) }, agora, true)).toBe("segurada");
    expect(situacaoEfetiva({ situacao: "segurada", holdAte: null }, agora, false)).toBe("expirada");
    for (const s of ["aplicada", "expirada", "desistida"] as const) expect(situacaoEfetiva({ situacao: s, holdAte: em(30) }, agora, true)).toBe(s);
  });

  it("valorNovo: aumento soma a diferença paga; redução com devolução fica no valor novo; retida ou igual, o de antes", () => {
    expect(valorNovo({ valorAntes: 150_000, valorDepois: 190_000, diferenca: 40_000, direito: null })).toBe(190_000);
    expect(valorNovo({ valorAntes: 150_000, valorDepois: 120_000, diferenca: -30_000, direito: "integral" })).toBe(120_000);
    expect(valorNovo({ valorAntes: 150_000, valorDepois: 120_000, diferenca: -30_000, direito: "nenhum" })).toBe(150_000);
    expect(valorNovo({ valorAntes: 150_000, valorDepois: 150_000, diferenca: 0, direito: null })).toBe(150_000);
  });
});

describe("taxa atribuída ao principal devolvido (D19)", () => {
  const p = { taxa: 1_485, valor: 150_000 };

  it("1485 × 30000/150000 = 297; 1485 × 29000/150000 = 287,1 → 287", () => {
    expect(taxaAtribuida(p, 30_000)).toBe(297);
    expect(taxaAtribuida(p, 29_000)).toBe(287);
    expect(taxaAtribuida(p, 0)).toBe(0);
    expect(taxaAtribuida(p, 150_000)).toBe(1_485);
    // Meio centavo para cima: 1 × 1 / 2 = 0,5 → 1.
    expect(taxaAtribuida({ taxa: 1, valor: 2 }, 1)).toBe(1);
  });

  it("acumulada, nunca escorrega: 29000 e depois 1000 dá 287 + 10 = 297 (exemplo D)", () => {
    const daDevolucao = (antes: number, valor: number) => taxaAtribuida(p, antes + valor)! - taxaAtribuida(p, antes)!;
    expect(daDevolucao(0, 29_000)).toBe(287);
    expect(daDevolucao(29_000, 1_000)).toBe(10);
    // Muitas partes pequenas somam exatamente a taxa inteira.
    let soma = 0;
    for (let feito = 0; feito < 150_000; feito += 7_000) soma += taxaAtribuida(p, Math.min(feito + 7_000, 150_000))! - taxaAtribuida(p, feito)!;
    expect(soma).toBe(1_485);
  });

  it("com juros do parcelamento (pago 165000), nunca passa da taxa: os juros não têm taxa atribuída", () => {
    expect(taxaAtribuida(p, 165_000)).toBe(1_485);
    expect(taxaAtribuida(p, 1_000_000)).toBe(1_485);
  });

  it("taxa desconhecida: null; valores inválidos são erro (sem palpite)", () => {
    expect(taxaAtribuida({ taxa: null, valor: 150_000 }, 30_000)).toBeNull();
    expect(() => taxaAtribuida({ taxa: 1_485, valor: 0 }, 1)).toThrow();
    expect(() => taxaAtribuida({ taxa: -1, valor: 150_000 }, 1)).toThrow();
    expect(() => taxaAtribuida(p, 1.5)).toThrow();
  });

  it("valor alto não perde precisão (conta em BigInt)", () => {
    expect(taxaAtribuida({ taxa: 99_999_999, valor: 999_999_999 }, 333_333_333)).toBe(33_333_333);
  });
});

describe("principal e juros de uma devolução (exemplo G)", () => {
  const p = { valor: 150_000 };

  it("redução de 30000: só principal; o restante do cancelamento (135000) cruza o valor: 120000 de principal e 15000 de juros", () => {
    expect(principalEJuros(p, 0, 30_000)).toEqual({ principal: 30_000, juros: 0 });
    expect(principalEJuros(p, 30_000, 135_000)).toEqual({ principal: 120_000, juros: 15_000 });
    // Depois de passar do valor, tudo é juros.
    expect(principalEJuros(p, 150_000, 5_000)).toEqual({ principal: 0, juros: 5_000 });
    expect(() => principalEJuros(p, -1, 1)).toThrow();
  });
});

describe("dividirDevolucao: de qual pagamento sai cada parte", () => {
  const dia = (d: number) => new Date(Date.UTC(2026, 9, d, 12));

  it("primeiro os que podem sair agora; dentro do grupo, o mais novo; empate pelo id; cada um até o saldo", () => {
    const p1 = { id: "a1", criadoEm: dia(1), saldoPrincipal: 150_000, podeSairAgora: true };
    const p2 = { id: "b2", criadoEm: dia(5), saldoPrincipal: 40_000, podeSairAgora: false };
    expect(dividirDevolucao(30_000, [p2, p1])).toEqual([{ pagamentoId: "a1", valor: 30_000 }]);
    expect(dividirDevolucao(160_000, [p2, p1])).toEqual([{ pagamentoId: "a1", valor: 150_000 }, { pagamentoId: "b2", valor: 10_000 }]);
    // Os dois podem sair: o mais novo primeiro.
    const p3 = { ...p2, podeSairAgora: true };
    expect(dividirDevolucao(50_000, [p1, p3])).toEqual([{ pagamentoId: "b2", valor: 40_000 }, { pagamentoId: "a1", valor: 10_000 }]);
    // Mesma data e grupo: pelo id.
    const x = { id: "x", criadoEm: dia(3), saldoPrincipal: 10_000, podeSairAgora: true };
    const y = { ...x, id: "y" };
    expect(dividirDevolucao(15_000, [y, x])).toEqual([{ pagamentoId: "x", valor: 10_000 }, { pagamentoId: "y", valor: 5_000 }]);
  });

  it("saldo que não cobre: null; zero: nenhuma parte; saldo zero é pulado", () => {
    expect(dividirDevolucao(200_001, [{ id: "a", criadoEm: dia(1), saldoPrincipal: 200_000, podeSairAgora: true }])).toBeNull();
    expect(dividirDevolucao(0, [{ id: "a", criadoEm: dia(1), saldoPrincipal: 200_000, podeSairAgora: true }])).toEqual([]);
    expect(dividirDevolucao(10, [{ id: "a", criadoEm: dia(9), saldoPrincipal: 0, podeSairAgora: true }, { id: "b", criadoEm: dia(1), saldoPrincipal: 10, podeSairAgora: false }])).toEqual([{ pagamentoId: "b", valor: 10 }]);
    expect(() => dividirDevolucao(-1, [])).toThrow();
  });
});
