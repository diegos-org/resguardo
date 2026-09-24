import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { organizacoes, rotinas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import {
  arquivarRotina,
  criarRotina,
  editarRotina,
  garantirRotinasIniciais,
  listarRotinas,
  proximaDepois,
  registrarExecucao,
  ROTINAS_INICIAIS,
  rotinasPendentes,
  situacaoDa,
  somarPeriodo,
} from "./rotinas";

describe("datas das rotinas (regra pura)", () => {
  it("soma semanas, 15 dias, meses e anos; mês curto fica no último dia", () => {
    expect(somarPeriodo("2026-10-01", "semanal")).toBe("2026-10-08");
    expect(somarPeriodo("2026-10-01", "quinzenal")).toBe("2026-10-16");
    expect(somarPeriodo("2026-01-31", "mensal")).toBe("2026-02-28");
    expect(somarPeriodo("2026-01-31", "mensal", 2)).toBe("2026-03-31");
    expect(somarPeriodo("2028-02-29", "anual")).toBe("2029-02-28");
    expect(somarPeriodo("2028-02-29", "anual", 4)).toBe("2032-02-29");
    expect(somarPeriodo("2026-12-15", "mensal")).toBe("2027-01-15");
  });

  it("próxima data: primeiro vencimento depois do dia, no ritmo contado da âncora", () => {
    expect(proximaDepois("2026-10-05", "semanal", "2026-10-05")).toBe("2026-10-12");
    // Atrasada três semanas: não acumula três conferências.
    expect(proximaDepois("2026-10-05", "semanal", "2026-10-27")).toBe("2026-11-02");
    // Mensal no dia 31: fevereiro no último dia e depois de novo 31.
    expect(proximaDepois("2026-01-31", "mensal", "2026-01-31")).toBe("2026-02-28");
    expect(proximaDepois("2026-01-31", "mensal", "2026-02-28")).toBe("2026-03-31");
  });

  it("situação: atrasada, hoje, esta semana, em dia, arquivada", () => {
    const hoje = "2026-10-10";
    expect(situacaoDa({ ativa: true, proximaData: "2026-10-09" }, hoje)).toBe("atrasada");
    expect(situacaoDa({ ativa: true, proximaData: hoje }, hoje)).toBe("hoje");
    expect(situacaoDa({ ativa: true, proximaData: "2026-10-17" }, hoje)).toBe("esta_semana");
    expect(situacaoDa({ ativa: true, proximaData: "2026-10-18" }, hoje)).toBe("em_dia");
    expect(situacaoDa({ ativa: false, proximaData: "2026-10-01" }, hoje)).toBe("arquivada");
  });
});

let db: Db;
let close: () => Promise<void>;
let org: string;
let outra: string;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }, { id: outra }] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
});
afterEach(() => close());

const nova = (over: Partial<Parameters<typeof criarRotina>[2]> = {}) =>
  criarRotina(db, org, { titulo: "Conferência das faxinas", descricao: "", frequencia: "semanal", proximaData: "2026-10-05", ...over }, null);

describe("cadastro e execução", () => {
  it("valida o cadastro; edita e arquiva com histórico (nada é apagado)", async () => {
    expect(await nova({ titulo: " " })).toMatchObject({ ok: false });
    expect(await nova({ frequencia: "diaria" })).toMatchObject({ ok: false });
    expect(await nova({ proximaData: "2026-02-30" })).toMatchObject({ ok: false });
    expect(await nova()).toEqual({ ok: true });
    const [r] = await listarRotinas(db, org, "2026-10-01");
    expect(r).toMatchObject({ titulo: "Conferência das faxinas", situacao: "esta_semana" });
    expect(await editarRotina(db, org, r.id, { titulo: "Conferir faxinas", descricao: "Ver custos", frequencia: "quinzenal", proximaData: "2026-10-20", proximaAnterior: "2026-10-05" }, null)).toEqual({ ok: true });
    expect(await arquivarRotina(db, org, r.id, false, null)).toEqual({ ok: true });
    expect(await listarRotinas(db, org, "2026-10-01")).toEqual([]);
    expect((await listarRotinas(db, org, "2026-10-01", { incluirArquivadas: true }))[0]).toMatchObject({ titulo: "Conferir faxinas", frequencia: "quinzenal", situacao: "arquivada" });
    expect(await registrarExecucao(db, org, r.id, { prevista: "2026-10-20", feitaEm: "2026-10-01", observacao: "", pulada: false }, "2026-10-01", null)).toMatchObject({ ok: false, erro: expect.stringContaining("arquivada") });
    expect(await arquivarRotina(db, org, r.id, true, null)).toEqual({ ok: true });
    expect((await historicoDe(db, org, "rotina", r.id)).map((h) => h.acao).sort()).toEqual(["rotina.arquivar", "rotina.criar", "rotina.editar", "rotina.reativar"]);
  });

  it("feita leva a próxima data; atrasada não acumula; pular exige motivo; data futura recusada", async () => {
    await nova();
    const [r] = await listarRotinas(db, org, "2026-10-27");
    expect(r.situacao).toBe("atrasada");
    expect(await rotinasPendentes(db, org, "2026-10-27")).toBe(1);
    expect(await registrarExecucao(db, org, r.id, { prevista: "2026-10-05", feitaEm: "2026-10-28", observacao: "", pulada: false }, "2026-10-27", null)).toMatchObject({ ok: false });
    expect(await registrarExecucao(db, org, r.id, { prevista: "2026-10-05", feitaEm: "2026-10-27", observacao: "tudo certo", pulada: false }, "2026-10-27", null)).toEqual({ ok: true });
    let [depois] = await listarRotinas(db, org, "2026-10-27");
    expect(depois).toMatchObject({ proximaData: "2026-11-02", situacao: "esta_semana" });
    expect(depois.ultimas[0]).toMatchObject({ prevista: "2026-10-05", feitaEm: "2026-10-27", pulada: false, observacao: "tudo certo" });
    expect(await registrarExecucao(db, org, r.id, { prevista: "2026-11-02", feitaEm: "2026-11-02", observacao: " ", pulada: true }, "2026-11-02", null)).toMatchObject({ ok: false, erro: expect.stringContaining("motivo") });
    expect(await registrarExecucao(db, org, r.id, { prevista: "2026-11-02", feitaEm: "2026-11-02", observacao: "feriado", pulada: true }, "2026-11-02", null)).toEqual({ ok: true });
    [depois] = await listarRotinas(db, org, "2026-11-02");
    expect(depois).toMatchObject({ proximaData: "2026-11-09" });
    expect(depois.ultimas.map((e) => [e.prevista, e.pulada])).toEqual([
      ["2026-11-02", true],
      ["2026-10-05", false],
    ]);
    // Próxima data editada de volta para um vencimento já registrado: avisa em vez de duplicar.
    await editarRotina(db, org, r.id, { titulo: r.titulo, descricao: "", frequencia: "semanal", proximaData: "2026-10-05", proximaAnterior: "2026-11-09" }, null);
    expect(await registrarExecucao(db, org, r.id, { prevista: "2026-10-05", feitaEm: "2026-11-03", observacao: "", pulada: false }, "2026-11-03", null)).toMatchObject({ ok: false, erro: expect.stringContaining("já foi registrado") });
  });

  it("mensal no dia 31 continua no fim do mês em execuções seguidas; quinzenal anda 15 dias", async () => {
    await nova({ titulo: "Mensal", frequencia: "mensal", proximaData: "2026-01-31" });
    await nova({ titulo: "Quinzenal", frequencia: "quinzenal", proximaData: "2026-10-01" });
    const achar = async (t: string, hoje: string) => (await listarRotinas(db, org, hoje)).find((r) => r.titulo === t)!;
    let m = await achar("Mensal", "2026-01-31");
    await registrarExecucao(db, org, m.id, { prevista: "2026-01-31", feitaEm: "2026-01-31", observacao: "", pulada: false }, "2026-01-31", null);
    m = await achar("Mensal", "2026-02-28");
    expect(m.proximaData).toBe("2026-02-28");
    await registrarExecucao(db, org, m.id, { prevista: "2026-02-28", feitaEm: "2026-02-28", observacao: "", pulada: false }, "2026-02-28", null);
    expect((await achar("Mensal", "2026-03-01")).proximaData).toBe("2026-03-31");
    const q = await achar("Quinzenal", "2026-10-01");
    await registrarExecucao(db, org, q.id, { prevista: "2026-10-01", feitaEm: "2026-10-01", observacao: "", pulada: false }, "2026-10-01", null);
    expect((await achar("Quinzenal", "2026-10-01")).proximaData).toBe("2026-10-16");
  });

  it("editar só o nome mantém o fim de mês; edição com a tela desatualizada é recusada", async () => {
    await nova({ titulo: "Mensal", frequencia: "mensal", proximaData: "2026-01-31" });
    const [r] = await listarRotinas(db, org, "2026-01-31");
    await registrarExecucao(db, org, r.id, { prevista: "2026-01-31", feitaEm: "2026-01-31", observacao: "", pulada: false }, "2026-01-31", null);
    // A tela de edição foi aberta antes de registrar: recusada (não volta a data para trás).
    expect(await editarRotina(db, org, r.id, { titulo: "Outro nome", descricao: "", frequencia: "mensal", proximaData: "2026-01-31", proximaAnterior: "2026-01-31" }, null)).toMatchObject({
      ok: false,
      erro: expect.stringContaining("mudou enquanto"),
    });
    // Com a tela atual (28/02), mudar só o nome não mexe no ritmo: a seguinte continua 31/03.
    expect(await editarRotina(db, org, r.id, { titulo: "Outro nome", descricao: "", frequencia: "mensal", proximaData: "2026-02-28", proximaAnterior: "2026-02-28" }, null)).toEqual({ ok: true });
    await registrarExecucao(db, org, r.id, { prevista: "2026-02-28", feitaEm: "2026-02-28", observacao: "", pulada: false }, "2026-02-28", null);
    expect((await listarRotinas(db, org, "2026-03-01"))[0]).toMatchObject({ titulo: "Outro nome", proximaData: "2026-03-31" });
  });

  it("dois cliques ao mesmo tempo registram uma vez só", async () => {
    await nova();
    const [r] = await listarRotinas(db, org, "2026-10-05");
    const reg = () => registrarExecucao(db, org, r.id, { prevista: "2026-10-05", feitaEm: "2026-10-05", observacao: "", pulada: false }, "2026-10-05", null);
    const resultados = await Promise.all([reg(), reg()]);
    expect(resultados.filter((x) => x.ok)).toHaveLength(1);
    expect(resultados.find((x) => !x.ok)).toMatchObject({ erro: expect.stringContaining("já foi registrado") });
    const [depois] = await listarRotinas(db, org, "2026-10-05");
    expect(depois.ultimas.map((e) => e.prevista)).toEqual(["2026-10-05"]);
    expect(depois.proximaData).toBe("2026-10-12");
  });

  it("outra organização não vê nem mexe", async () => {
    await nova();
    const [r] = await listarRotinas(db, org, "2026-10-05");
    expect(await listarRotinas(db, outra, "2026-10-05")).toEqual([]);
    expect(await editarRotina(db, outra, r.id, { titulo: "x", descricao: "", frequencia: "semanal", proximaData: "2026-10-05", proximaAnterior: "2026-10-05" }, null)).toMatchObject({ ok: false });
    expect(await registrarExecucao(db, outra, r.id, { prevista: "2026-10-05", feitaEm: "2026-10-05", observacao: "", pulada: false }, "2026-10-05", null)).toMatchObject({ ok: false });
    expect(await arquivarRotina(db, outra, r.id, false, null)).toMatchObject({ ok: false });
  });

  it("rotinas iniciais: criadas uma vez, vencendo hoje; se arquivadas, não voltam", async () => {
    await garantirRotinasIniciais(db, org, "2026-10-01");
    const lista = await listarRotinas(db, org, "2026-10-01");
    expect(lista.map((r) => r.titulo).sort()).toEqual(ROTINAS_INICIAIS.map((r) => r.titulo).sort());
    expect(lista.every((r) => r.proximaData === "2026-10-01" && r.situacao === "hoje")).toBe(true);
    for (const r of lista) await arquivarRotina(db, org, r.id, false, null);
    await garantirRotinasIniciais(db, org, "2026-10-02");
    expect(await listarRotinas(db, org, "2026-10-02")).toEqual([]);
    expect(await db.select().from(rotinas).where(eq(rotinas.organizacaoId, org))).toHaveLength(4);
  });
});
