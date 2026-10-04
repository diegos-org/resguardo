import { describe, expect, it } from "vitest";
import { descreverPeriodicidade, ehDiaDeRepasse, geraAntecipadoEm, periodicidadeEfetiva, proximaDataDeRepasse, REGRAS_REPASSES_PADRAO, regrasDeJson, validarFormRegras } from "./periodicidade";

const R = REGRAS_REPASSES_PADRAO;

describe("periodicidade dos repasses (M4.10)", () => {
  it("leitura tolerante do JSON: inválido volta ao padrão; válido vale", () => {
    expect(regrasDeJson(null)).toEqual(R);
    expect(regrasDeJson({ diaSemanal: 9, diasQuinzenal: [16, 1], padraoPorContrato: { marketplace: "x" } })).toEqual(R);
    expect(regrasDeJson({ diaSemanal: 5, diasQuinzenal: [5, 20], padraoPorContrato: { marketplace: "semanal" } })).toEqual({
      diaSemanal: 5,
      diasQuinzenal: [5, 20],
      padraoPorContrato: { gestao_completa: "mensal", gestao_online: "mensal", marketplace: "semanal" },
    });
  });

  it("formulário: dias de 1 a 28, diferentes e ordenados; periodicidade por tipo de contrato obrigatória", () => {
    const base = { diaSemanal: "1", diaQuinzenal1: "16", diaQuinzenal2: "1", padrao_gestao_completa: "mensal", padrao_gestao_online: "quinzenal", padrao_marketplace: "disponivel" };
    const ok = validarFormRegras(base);
    expect(ok).toMatchObject({ ok: true, regras: { diaSemanal: 1, diasQuinzenal: [1, 16], padraoPorContrato: { gestao_online: "quinzenal", marketplace: "disponivel" } } });
    expect(validarFormRegras({ ...base, diaQuinzenal2: "30" })).toMatchObject({ ok: false, erros: { diasQuinzenal: expect.stringContaining("1 a 28") } });
    expect(validarFormRegras({ ...base, diaQuinzenal2: "16" })).toMatchObject({ ok: false, erros: { diasQuinzenal: expect.stringContaining("diferentes") } });
    expect(validarFormRegras({ ...base, diaSemanal: "7" })).toMatchObject({ ok: false, erros: { diaSemanal: expect.any(String) } });
    expect(validarFormRegras({ ...base, padrao_marketplace: "" })).toMatchObject({ ok: false, erros: { padraoPorContrato: expect.any(String) } });
  });

  it("efetiva: a escolha do proprietário vale; sem escolha, o padrão do contrato mais frequente; sem contrato, mensal", () => {
    const regras = regrasDeJson({ padraoPorContrato: { marketplace: "quinzenal", gestao_online: "semanal" } });
    expect(periodicidadeEfetiva("disponivel", ["gestao_completa"], regras)).toBe("disponivel");
    expect(periodicidadeEfetiva(null, ["gestao_completa"], regras)).toBe("mensal");
    expect(periodicidadeEfetiva(null, ["gestao_completa", "marketplace"], regras)).toBe("quinzenal");
    expect(periodicidadeEfetiva(null, ["marketplace", "gestao_online"], regras)).toBe("semanal");
    expect(periodicidadeEfetiva(undefined, [], regras)).toBe("mensal");
  });

  it("dias de repasse: o dia 1º conta em todas; quinzenal nos dias configurados; semanal no dia da semana; disponível todo dia", () => {
    // Outubro de 2026: 1/10 quinta, 5/10 segunda, 12/10 segunda, 16/10 sexta.
    expect(ehDiaDeRepasse("2026-10-01", "mensal", R)).toBe(true);
    expect(ehDiaDeRepasse("2026-10-16", "mensal", R)).toBe(false);
    expect(ehDiaDeRepasse("2026-10-16", "quinzenal", R)).toBe(true);
    expect(ehDiaDeRepasse("2026-10-15", "quinzenal", R)).toBe(false);
    expect(ehDiaDeRepasse("2026-10-05", "semanal", R)).toBe(true);
    expect(ehDiaDeRepasse("2026-10-06", "semanal", R)).toBe(false);
    expect(ehDiaDeRepasse("2026-10-06", "disponivel", R)).toBe(true);
    expect(ehDiaDeRepasse("2026-10-07", "semanal", { ...R, diaSemanal: 3 })).toBe(true);
  });

  it("a rotina gera antecipado só fora do dia 1º e fora do mensal", () => {
    expect(geraAntecipadoEm("2026-10-01", "disponivel", R)).toBe(false);
    expect(geraAntecipadoEm("2026-10-01", "semanal", R)).toBe(false);
    expect(geraAntecipadoEm("2026-10-02", "disponivel", R)).toBe(true);
    expect(geraAntecipadoEm("2026-10-05", "semanal", R)).toBe(true);
    expect(geraAntecipadoEm("2026-10-16", "quinzenal", R)).toBe(true);
    expect(geraAntecipadoEm("2026-10-16", "mensal", R)).toBe(false);
  });

  it("próxima data: estritamente depois de hoje; o fechamento do dia 1º entra na conta", () => {
    expect(proximaDataDeRepasse("2026-10-10", "mensal", R)).toBe("2026-11-01");
    expect(proximaDataDeRepasse("2026-10-10", "quinzenal", R)).toBe("2026-10-16");
    expect(proximaDataDeRepasse("2026-10-16", "quinzenal", R)).toBe("2026-11-01");
    expect(proximaDataDeRepasse("2026-10-05", "semanal", R)).toBe("2026-10-12");
    expect(proximaDataDeRepasse("2026-10-29", "semanal", R)).toBe("2026-11-01"); // sexta → o dia 1º (domingo) vem antes da segunda 2/11
    expect(proximaDataDeRepasse("2026-10-10", "disponivel", R)).toBe("2026-10-11");
  });

  it("descrição em linguagem simples com os dias configurados", () => {
    expect(descreverPeriodicidade("semanal", { ...R, diaSemanal: 3 })).toContain("quarta-feira");
    expect(descreverPeriodicidade("quinzenal", { ...R, diasQuinzenal: [5, 20] })).toContain("dias 5 e 20");
    expect(descreverPeriodicidade("mensal", R)).toContain("dia 1º");
    expect(descreverPeriodicidade("disponivel", R)).toContain("check-in");
  });
});
