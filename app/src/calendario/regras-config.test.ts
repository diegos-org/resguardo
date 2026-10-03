import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { imoveis, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { adicionarEvento, lerData, lerRegrasCalendario, multiplicadorParaCentesimos, REGRAS_CALENDARIO_PADRAO, regrasDeJson, removerEvento, salvarRegrasCalendario, validarEvento, validarFormRegras } from "./regras-config";

const IM = "11111111-1111-4111-8111-111111111111";
const form = (over: Record<string, unknown> = {}) => ({
  minimo_0: "1", minimo_1: "1", minimo_2: "1", minimo_3: "1", minimo_4: "1", minimo_5: "2", minimo_6: "2",
  estadiaMaxima: "27", horizonteDias: "270", feriados: "02/11/2026 Finados\n2026-11-20 Consciência Negra\n02/11/2026 repetido",
  feriadoMinimo: "3", feriadoMultiplicador: "2", feriadoTodos: "", feriadoImoveis: [IM, "lixo"],
  ultimaHoraModo: "beds24", faixa1De: "3", faixa1Ate: "7", faixa1Pct: "15", faixa2De: "0", faixa2Ate: "2", faixa2Pct: "25",
  envioImoveis: IM, envioAutomatico: "on", siteValidadeHoras: "36", siteMaximoNoites: "90", siteMinutosHold: "30", ...over,
});

describe("formulário das regras", () => {
  it("lê números, feriados em duas grafias (sem repetir), seleções de imóveis só da empresa e preserva os eventos", () => {
    const atual = { ...REGRAS_CALENDARIO_PADRAO, eventos: [{ id: IM, nome: "X", inicio: "2026-12-25", fim: "2027-01-01", multiplicador: 400, estadiaMinima: 5, todosImoveis: true, imoveis: [] }] };
    const r = validarFormRegras(form(), atual, [IM]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.regras).toMatchObject({
      minimoPorDia: [1, 1, 1, 1, 1, 2, 2], estadiaMaxima: 27, horizonteDias: 270,
      feriados: [{ data: "2026-11-02", nome: "Finados" }, { data: "2026-11-20", nome: "Consciência Negra" }],
      janelaFeriado: { estadiaMinima: 3, multiplicador: 200, todosImoveis: false, imoveis: [IM] },
      ultimaHora: { aplicadoPor: "beds24", faixas: [{ deDias: 3, ateDias: 7, percentual: 15 }, { deDias: 0, ateDias: 2, percentual: 25 }] },
      envio: { imoveis: [IM], automatico: true },
      site: { validadeLeituraHoras: 36, maximoNoitesConsulta: 90, minutosHold: 30 },
    });
    expect(r.regras.eventos).toBe(atual.eventos);
  });
  it("recusa valores fora do limite, feriado mal escrito, faixas cruzadas e modo desconhecido", () => {
    const r = validarFormRegras(form({ minimo_5: "0", estadiaMaxima: "400", horizonteDias: "3", feriados: "32/13/2026 Nada", feriadoMinimo: "", feriadoMultiplicador: "0,5", faixa1De: "8", faixa1Ate: "7", faixa2De: "1", faixa2Ate: "9", ultimaHoraModo: "x", siteValidadeHoras: "0", siteMaximoNoites: "400" }), REGRAS_CALENDARIO_PADRAO, [IM]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.erros).sort()).toEqual(["estadiaMaxima", "faixa1Ate", "feriadoMinimo", "feriadoMultiplicador", "feriados", "horizonteDias", "minimo_5", "siteMaximoNoites", "siteValidadeHoras", "ultimaHoraModo"]);
    // Mínimo do feriadão fora da faixa nunca é salvo como 1 em silêncio.
    const soMinimo = validarFormRegras(form({ feriadoMinimo: "40" }), REGRAS_CALENDARIO_PADRAO, [IM]);
    expect(soMinimo).toMatchObject({ ok: false, erros: { feriadoMinimo: expect.stringContaining("entre 1 e 30") } });
    const cruzadas = validarFormRegras(form({ faixa1De: "2", faixa1Ate: "7", faixa2De: "0", faixa2Ate: "2" }), REGRAS_CALENDARIO_PADRAO, [IM]);
    expect(cruzadas.ok).toBe(false);
    if (!cruzadas.ok) expect(cruzadas.erros.faixa2Ate).toContain("mais próxima da data");
    // Ordem trocada (1ª faixa perto da data, 2ª longe) trocaria os pisos da ficha do imóvel em silêncio: recusada.
    const trocadas = validarFormRegras(form({ faixa1De: "0", faixa1Ate: "2", faixa2De: "3", faixa2Ate: "7" }), REGRAS_CALENDARIO_PADRAO, [IM]);
    expect(trocadas.ok).toBe(false);
    if (!trocadas.ok) expect(Object.keys(trocadas.erros)).toEqual(["faixa2Ate"]);
    // Guardado com a ordem trocada (fora do formulário): volta ao padrão, nunca aplica pisos trocados.
    expect(regrasDeJson({ ultimaHora: { aplicadoPor: "scl", faixas: [{ deDias: 0, ateDias: 2, percentual: 25 }, { deDias: 3, ateDias: 7, percentual: 15 }] } }).ultimaHora).toEqual({ aplicadoPor: "scl", faixas: REGRAS_CALENDARIO_PADRAO.ultimaHora.faixas });
  });
  it("multiplicador e data aceitam a grafia brasileira", () => {
    expect([multiplicadorParaCentesimos("2"), multiplicadorParaCentesimos("2,5"), multiplicadorParaCentesimos("4.00"), multiplicadorParaCentesimos("3x"), multiplicadorParaCentesimos("0,99"), multiplicadorParaCentesimos("11"), multiplicadorParaCentesimos("abc")]).toEqual([200, 250, 400, 300, undefined, undefined, undefined]);
    expect([lerData("25/12/2026"), lerData("2026-12-25"), lerData("31/02/2026"), lerData("x")]).toEqual(["2026-12-25", "2026-12-25", null, null]);
  });
  it("evento: nome, datas, multiplicador, mínimo e imóveis (todos ou escolhidos)", () => {
    const ok = validarEvento({ nome: "Carnaval 2027", inicio: "01/02/2027", fim: "2027-02-10", multiplicador: "4", estadiaMinima: "5", imoveis: [IM, "outro"] }, [IM]);
    expect(ok).toEqual({ ok: true, evento: { nome: "Carnaval 2027", inicio: "2027-02-01", fim: "2027-02-10", multiplicador: 400, estadiaMinima: 5, todosImoveis: false, imoveis: [IM] } });
    expect(validarEvento({ nome: "Rock in Rio", inicio: "2027-09-10", fim: "2027-09-12", multiplicador: "3", estadiaMinima: "", todosImoveis: "on" }, [IM])).toMatchObject({ ok: true, evento: { estadiaMinima: null, todosImoveis: true, imoveis: [] } });
    const erro = (e: Record<string, unknown>) => { const r = validarEvento({ nome: "E", inicio: "2027-01-01", fim: "2027-01-02", multiplicador: "2", todosImoveis: "on", ...e }, [IM]); return r.ok ? "ok" : r.erro; };
    expect(erro({ nome: "" })).toContain("nome");
    expect(erro({ fim: "2026-12-31" })).toContain("antes da primeira");
    expect(erro({ multiplicador: "20" })).toContain("Multiplicador");
    expect(erro({ estadiaMinima: "40" })).toContain("1 a 30");
    expect(erro({ todosImoveis: "", imoveis: ["outro"] })).toContain("Escolha os imóveis");
  });
  it("JSON gravado inválido volta ao padrão sem inventar feriados ou eventos", () => {
    expect(regrasDeJson(null)).toEqual(REGRAS_CALENDARIO_PADRAO);
    const r = regrasDeJson({ minimoPorDia: [1, 2], estadiaMaxima: "x", horizonteDias: 900, feriados: [{ data: "2026-02-30", nome: "falsa" }, { data: "2026-12-25", nome: 7 }, { data: "2026-12-25" }], eventos: [{ id: "sem-uuid" }, { id: IM, nome: "Ok", inicio: "2026-12-25", fim: "2027-01-01", multiplicador: 400, estadiaMinima: 99, imoveis: ["lixo", IM] }], janelaFeriado: { multiplicador: 50 }, ultimaHora: { aplicadoPor: "scl", faixas: [{ deDias: 9, ateDias: 3, percentual: 15 }] }, envio: { imoveis: [IM], automatico: "sim" }, site: { validadeLeituraHoras: 12, maximoNoitesConsulta: "x" } });
    expect(r).toEqual({
      ...REGRAS_CALENDARIO_PADRAO,
      feriados: [{ data: "2026-12-25", nome: "" }],
      eventos: [{ id: IM, nome: "Ok", inicio: "2026-12-25", fim: "2027-01-01", multiplicador: 400, estadiaMinima: null, todosImoveis: false, imoveis: [IM] }],
      ultimaHora: { ...REGRAS_CALENDARIO_PADRAO.ultimaHora, aplicadoPor: "scl" },
      envio: { imoveis: [IM], automatico: false },
      site: { validadeLeituraHoras: 12, maximoNoitesConsulta: 90, minutosHold: 30 },
    });
  });
});

describe("com banco", () => {
  let db: Db, close: () => Promise<void>, org: string, outra: string, im: string;
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    [{ id: org }, { id: outra }] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
    [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "103", nome: "Boutique" }).returning();
  });
  afterEach(() => close());

  it("salva, relê, registra histórico e isola por organização; eventos entram e saem com trava", async () => {
    expect(await lerRegrasCalendario(db, org)).toEqual(REGRAS_CALENDARIO_PADRAO);
    const v = validarFormRegras(form({ envioImoveis: im, feriadoImoveis: im }), REGRAS_CALENDARIO_PADRAO, [im]);
    if (!v.ok) throw new Error("fixture");
    expect(await salvarRegrasCalendario(db, org, v.regras, null)).toBe(true);
    expect(await salvarRegrasCalendario(db, org, v.regras, null)).toBe(false);
    expect((await lerRegrasCalendario(db, org)).envio).toEqual({ imoveis: [im], automatico: true });
    expect(await lerRegrasCalendario(db, outra)).toEqual(REGRAS_CALENDARIO_PADRAO);
    const ev = validarEvento({ nome: "Réveillon", inicio: "25/12/2026", fim: "01/01/2027", multiplicador: "4", estadiaMinima: "5", imoveis: im }, [im]);
    if (!ev.ok) throw new Error("fixture");
    const a = await adicionarEvento(db, org, ev.evento, null);
    expect(a.ok).toBe(true);
    const lidas = await lerRegrasCalendario(db, org);
    expect(lidas.eventos).toHaveLength(1);
    expect(lidas.eventos[0]).toMatchObject({ nome: "Réveillon", multiplicador: 400, imoveis: [im] });
    expect(lidas.envio.imoveis).toEqual([im]);
    // Salvar as regras gerais com uma leitura antiga (sem o evento) preserva o evento gravado depois.
    expect(await salvarRegrasCalendario(db, org, { ...v.regras, horizonteDias: 120, eventos: [] }, null)).toBe(true);
    const depois = await lerRegrasCalendario(db, org);
    expect(depois.horizonteDias).toBe(120);
    expect(depois.eventos).toHaveLength(1);
    expect(await removerEvento(db, outra, lidas.eventos[0].id, null)).toBe(false);
    expect(await removerEvento(db, org, "nao-uuid", null)).toBe(false);
    expect(await removerEvento(db, org, lidas.eventos[0].id, null)).toBe(true);
    expect((await lerRegrasCalendario(db, org)).eventos).toEqual([]);
    const h = await historicoDe(db, org, "configuracao", org);
    expect(h.length).toBeGreaterThanOrEqual(3);
    expect(h.every((l) => l.acao === "configuracao.calendario_regras")).toBe(true);
  });
});
