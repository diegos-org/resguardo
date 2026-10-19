import { describe, expect, it } from "vitest";
import { comDiaDeFechamento, dataDoFechamento, descreverPeriodicidade, diaDoFechamento, diaDoFechamentoAtual, ehDiaDeFechamento, ehDiaDeRepasse, geraAntecipadoEm, periodicidadeEfetiva, proximaDataDeRepasse, proximoFechamento, REGRAS_REPASSES_PADRAO, regrasDeJson, validarFormRegras } from "./periodicidade";

const R = REGRAS_REPASSES_PADRAO;

describe("periodicidade dos repasses (M4.10)", () => {
  it("leitura tolerante do JSON: inválido volta ao padrão; válido vale", () => {
    expect(regrasDeJson(null)).toEqual(R);
    expect(regrasDeJson({ diaSemanal: 9, diasQuinzenal: [16, 1], padraoPorContrato: { marketplace: "x" } })).toEqual(R);
    expect(regrasDeJson({ diaSemanal: 5, diasQuinzenal: [5, 20], padraoPorContrato: { marketplace: "semanal" } })).toEqual({
      diaSemanal: 5,
      diasQuinzenal: [5, 20],
      padraoPorContrato: { gestao_completa: "mensal", gestao_online: "mensal", marketplace: "semanal" },
      fechamento: [],
    });
    // Dia do fechamento (M4.13): só versões válidas (dia 1 a 5, mês "AAAA-MM"), em ordem.
    expect(regrasDeJson({ fechamento: [{ dia: 3, desde: "2026-12" }, { dia: 6, desde: "2026-10" }, { dia: 1, desde: "2026-10" }, { dia: 2, desde: "outubro" }, "x"] }).fechamento).toEqual([
      { dia: 1, desde: "2026-10" },
      { dia: 3, desde: "2026-12" },
    ]);
  });

  it("formulário: dias de 1 a 28, diferentes e ordenados; periodicidade por tipo de contrato obrigatória", () => {
    const base = { diaSemanal: "1", diaQuinzenal1: "16", diaQuinzenal2: "1", padrao_gestao_completa: "mensal", padrao_gestao_online: "quinzenal", padrao_marketplace: "disponivel", diaFechamento: "2" };
    const ok = validarFormRegras(base);
    expect(ok).toMatchObject({ ok: true, regras: { diaSemanal: 1, diasQuinzenal: [1, 16], padraoPorContrato: { gestao_online: "quinzenal", marketplace: "disponivel" }, fechamento: [] }, diaFechamento: 2 });
    for (const diaFechamento of ["0", "6", "", "x"]) expect(validarFormRegras({ ...base, diaFechamento })).toMatchObject({ ok: false, erros: { diaFechamento: expect.stringContaining("1 a 5") } });
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

  it("dias de repasse: o dia do fechamento (dia 2 por padrão) conta em todas; quinzenal nos dias configurados; semanal no dia da semana; disponível todo dia", () => {
    // Outubro de 2026: 1/10 quinta, 5/10 segunda, 12/10 segunda, 16/10 sexta.
    expect(ehDiaDeRepasse("2026-10-01", "mensal", R)).toBe(false);
    expect(ehDiaDeRepasse("2026-10-02", "mensal", R)).toBe(true);
    expect(ehDiaDeRepasse("2026-10-01", "mensal", { ...R, fechamento: [{ dia: 1, desde: "2026-09" }] })).toBe(true);
    expect(ehDiaDeRepasse("2026-10-02", "mensal", { ...R, fechamento: [{ dia: 1, desde: "2026-09" }] })).toBe(false);
    expect(ehDiaDeRepasse("2026-10-16", "mensal", R)).toBe(false);
    expect(ehDiaDeRepasse("2026-10-16", "quinzenal", R)).toBe(true);
    expect(ehDiaDeRepasse("2026-10-15", "quinzenal", R)).toBe(false);
    expect(ehDiaDeRepasse("2026-10-05", "semanal", R)).toBe(true);
    expect(ehDiaDeRepasse("2026-10-06", "semanal", R)).toBe(false);
    expect(ehDiaDeRepasse("2026-10-06", "disponivel", R)).toBe(true);
    expect(ehDiaDeRepasse("2026-10-07", "semanal", { ...R, diaSemanal: 3 })).toBe(true);
  });

  it("a rotina gera antecipado só fora do dia do fechamento e fora do mensal", () => {
    expect(geraAntecipadoEm("2026-10-02", "disponivel", R)).toBe(false);
    expect(geraAntecipadoEm("2026-11-02", "semanal", R)).toBe(false); // segunda, mas dia do fechamento
    expect(geraAntecipadoEm("2026-10-01", "disponivel", R)).toBe(true);
    expect(geraAntecipadoEm("2026-10-03", "disponivel", R)).toBe(true);
    expect(geraAntecipadoEm("2026-10-01", "disponivel", { ...R, fechamento: [{ dia: 1, desde: "2026-09" }] })).toBe(false);
    expect(geraAntecipadoEm("2026-10-05", "semanal", R)).toBe(true);
    expect(geraAntecipadoEm("2026-10-16", "quinzenal", R)).toBe(true);
    expect(geraAntecipadoEm("2026-10-16", "mensal", R)).toBe(false);
  });

  it("próxima data: estritamente depois de hoje; o dia do fechamento entra na conta", () => {
    expect(proximaDataDeRepasse("2026-10-10", "mensal", R)).toBe("2026-11-02");
    expect(proximaDataDeRepasse("2026-10-10", "mensal", { ...R, fechamento: [{ dia: 1, desde: "2026-10" }] })).toBe("2026-11-01");
    expect(proximaDataDeRepasse("2026-10-10", "quinzenal", R)).toBe("2026-10-16");
    expect(proximaDataDeRepasse("2026-10-16", "quinzenal", R)).toBe("2026-11-01");
    expect(proximaDataDeRepasse("2026-10-05", "semanal", R)).toBe("2026-10-12");
    expect(proximaDataDeRepasse("2026-10-29", "semanal", R)).toBe("2026-11-02"); // quinta → a segunda 2/11 é também o dia do fechamento
    expect(proximaDataDeRepasse("2026-10-29", "semanal", { ...R, fechamento: [{ dia: 1, desde: "2026-10" }] })).toBe("2026-11-01"); // o dia 1º (domingo) vem antes
    expect(proximaDataDeRepasse("2026-10-10", "disponivel", R)).toBe("2026-10-11");
  });

  it("descrição em linguagem simples com os dias configurados", () => {
    const hoje = "2026-10-10";
    // Os sete dias, com "todo" no domingo e no sábado e "toda" nos dias que terminam em "-feira" (M7.22).
    const semanal = ["todo domingo", "toda segunda-feira", "toda terça-feira", "toda quarta-feira", "toda quinta-feira", "toda sexta-feira", "todo sábado"];
    for (const [diaSemanal, nome] of semanal.entries()) {
      expect(descreverPeriodicidade("semanal", { ...R, diaSemanal }, hoje)).toBe(`semanal, ${nome} (e no dia 2, junto com o fechamento)`);
    }
    expect(descreverPeriodicidade("quinzenal", { ...R, diasQuinzenal: [5, 20] }, hoje)).toContain("dias 5 e 20");
    expect(descreverPeriodicidade("mensal", R, hoje)).toContain("dia 2");
    expect(descreverPeriodicidade("mensal", { ...R, fechamento: [{ dia: 1, desde: "2026-10" }] }, hoje)).toContain("dia 1,");
    expect(descreverPeriodicidade("semanal", { ...R, fechamento: [{ dia: 3, desde: "2026-10" }] }, hoje)).toContain("no dia 3, junto com o fechamento");
    expect(descreverPeriodicidade("disponivel", R, hoje)).toContain("check-in");
    // O dia mostrado é o do próximo fechamento: dia mudado para 5 em 1/11 — outubro ainda fecha no dia 2, e é isso que o texto diz até lá.
    const mudado = { ...R, fechamento: [{ dia: 5, desde: "2026-11" }] };
    expect(descreverPeriodicidade("mensal", mudado, "2026-11-01")).toContain("dia 2");
    expect(descreverPeriodicidade("mensal", mudado, "2026-11-02")).toContain("dia 2");
    expect(descreverPeriodicidade("mensal", mudado, "2026-11-03")).toContain("dia 5");
    expect(proximaDataDeRepasse("2026-11-01", "mensal", mudado)).toBe("2026-11-02");
    expect(proximaDataDeRepasse("2026-11-02", "mensal", mudado)).toBe("2026-12-05");
  });

  it("dia do fechamento (M4.13): padrão 2; versões por mês de competência; data e teste do dia", () => {
    const v = { fechamento: [{ dia: 1, desde: "2026-10" }, { dia: 3, desde: "2026-12" }] };
    expect(diaDoFechamento(R, "2026-10")).toBe(2);
    expect(["2026-09", "2026-10", "2026-11", "2026-12", "2027-01"].map((m) => diaDoFechamento(v, m))).toEqual([2, 1, 1, 3, 3]);
    expect(diaDoFechamentoAtual(R)).toBe(2);
    expect(diaDoFechamentoAtual(v)).toBe(3);
    expect(dataDoFechamento(R, "2026-10")).toBe("2026-11-02");
    expect(dataDoFechamento(R, "2026-12")).toBe("2027-01-02");
    expect(dataDoFechamento(v, "2026-12")).toBe("2027-01-03");
    expect(ehDiaDeFechamento("2026-11-02", R)).toBe(true);
    expect(ehDiaDeFechamento("2026-11-01", R)).toBe(false);
    expect(ehDiaDeFechamento("2027-01-02", R)).toBe(true);
    expect(ehDiaDeFechamento("2026-11-01", v)).toBe(true); // outubro fecha no dia 1
    expect(ehDiaDeFechamento("2026-11-02", v)).toBe(false);
    expect(ehDiaDeFechamento("2027-01-03", v)).toBe(true); // dezembro fecha no dia 3
    expect(ehDiaDeFechamento("2027-01-02", v)).toBe(false);
  });

  it("próximo fechamento a partir de hoje: o do mês anterior enquanto o dia dele não passou; depois, o do mês corrente", () => {
    expect(proximoFechamento(R, "2026-11-01")).toEqual({ mes: "2026-10", data: "2026-11-02", dia: 2 });
    expect(proximoFechamento(R, "2026-11-02")).toEqual({ mes: "2026-10", data: "2026-11-02", dia: 2 });
    expect(proximoFechamento(R, "2026-11-03")).toEqual({ mes: "2026-11", data: "2026-12-02", dia: 2 });
    const v = { fechamento: [{ dia: 5, desde: "2026-11" }] };
    expect(proximoFechamento(v, "2026-11-01")).toEqual({ mes: "2026-10", data: "2026-11-02", dia: 2 });
    expect(proximoFechamento(v, "2026-11-03")).toEqual({ mes: "2026-11", data: "2026-12-05", dia: 5 });
    expect(proximoFechamento(v, "2026-12-05")).toEqual({ mes: "2026-11", data: "2026-12-05", dia: 5 });
    expect(proximoFechamento(R, "2027-01-02")).toEqual({ mes: "2026-12", data: "2027-01-02", dia: 2 });
  });

  it("mudar o dia do fechamento: vale do mês de hoje em diante; igual ao que já valeria não cria versão; mesmo mês substitui", () => {
    expect(comDiaDeFechamento([], 2, "2026-10")).toEqual([]);
    const v1 = comDiaDeFechamento([], 1, "2026-10");
    expect(v1).toEqual([{ dia: 1, desde: "2026-10" }]);
    expect(comDiaDeFechamento(v1, 3, "2026-10")).toEqual([{ dia: 3, desde: "2026-10" }]);
    expect(comDiaDeFechamento(v1, 1, "2026-11")).toEqual(v1);
    expect(comDiaDeFechamento(v1, 2, "2026-11")).toEqual([{ dia: 1, desde: "2026-10" }, { dia: 2, desde: "2026-11" }]);
    // Em novembro de 2026 (hoje), outubro ainda não fechou mas segue no dia que valia; o dia novo vale do fechamento de novembro (em dezembro) em diante.
    const v2 = comDiaDeFechamento(v1, 2, "2026-11");
    expect(dataDoFechamento({ fechamento: v2 }, "2026-10")).toBe("2026-11-01");
    expect(dataDoFechamento({ fechamento: v2 }, "2026-11")).toBe("2026-12-02");
  });
});
