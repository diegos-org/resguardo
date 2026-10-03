import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { imoveis, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { alterarBloqueioPortal, criarContrato, encerrarContrato, listarContratos } from "./repositorio";

let db: Db;
let close: () => Promise<void>;
let org: string;
let outra: string;
let imovel: string;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const [a, b] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
  org = a.id;
  outra = b.id;
  [{ id: imovel }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "t1", nome: "Um" }).returning();
});
afterEach(() => close());

describe("contratos", () => {
  it("bloqueio pelo portal (M5.5): 'sim' por padrão, 'nao' desliga, valor estranho é recusado", async () => {
    const padrao = await criarContrato(db, org, imovel, { tipo: "gestao_completa", comissao: "20", inicio: "2025-01-01", fim: "2025-12-31" }, null);
    expect(padrao.ok && padrao.contrato.proprietarioBloqueia).toBe(true);
    const sem = await criarContrato(db, org, imovel, { tipo: "gestao_completa", comissao: "20", inicio: "2026-01-01", fim: "2026-12-31", proprietarioBloqueia: "nao" }, null);
    expect(sem.ok && sem.contrato.proprietarioBloqueia).toBe(false);
    expect(await criarContrato(db, org, imovel, { tipo: "gestao_completa", comissao: "20", inicio: "2027-01-01", proprietarioBloqueia: "talvez" }, null)).toMatchObject({ ok: false, erros: { proprietarioBloqueia: expect.stringContaining("Escolha") } });
  });

  it("bloqueio pelo portal pode ser ligado/desligado no contrato existente, com histórico; outra organização não mexe", async () => {
    const r = await criarContrato(db, org, imovel, { tipo: "gestao_completa", comissao: "20", inicio: "2025-01-01" }, null);
    if (!r.ok) throw new Error("contrato");
    expect(await alterarBloqueioPortal(db, org, r.contrato.id, false, null)).toEqual({ ok: true, imovelId: imovel });
    expect((await listarContratos(db, org, imovel))[0].proprietarioBloqueia).toBe(false);
    // Repetir o mesmo valor não gera histórico; voltar a ligar gera.
    expect(await alterarBloqueioPortal(db, org, r.contrato.id, false, null)).toEqual({ ok: true, imovelId: imovel });
    expect(await alterarBloqueioPortal(db, org, r.contrato.id, true, null)).toEqual({ ok: true, imovelId: imovel });
    expect((await historicoDe(db, org, "imovel", imovel)).filter((h) => h.acao === "contrato.bloqueio_portal")).toHaveLength(2);
    expect(await alterarBloqueioPortal(db, outra, r.contrato.id, false, null)).toEqual({ ok: false, erro: "Contrato não encontrado." });
    expect(await alterarBloqueioPortal(db, org, "nao-e-uuid", false, null)).toEqual({ ok: false, erro: "Contrato não encontrado." });
    expect((await listarContratos(db, org, imovel))[0].proprietarioBloqueia).toBe(true);
  });

  it("troca de percentual: encerra o atual e cria o novo, com histórico no imóvel", async () => {
    const r1 = await criarContrato(db, org, imovel, { tipo: "gestao_completa", comissao: "20", inicio: "2025-01-01" }, null);
    expect(r1.ok).toBe(true);
    const bloqueado = await criarContrato(db, org, imovel, { tipo: "gestao_completa", comissao: "15", inicio: "2027-01-01" }, null);
    expect(bloqueado.ok).toBe(false);

    const id = r1.ok ? r1.contrato.id : "";
    expect(await encerrarContrato(db, org, id, "2026-12-31", null)).toMatchObject({ ok: true });
    expect((await criarContrato(db, org, imovel, { tipo: "gestao_completa", comissao: "15", inicio: "2027-01-01" }, null)).ok).toBe(true);

    const lista = await listarContratos(db, org, imovel);
    expect(lista.map((c) => [c.comissaoBp, c.inicio, c.fim])).toEqual([
      [2000, "2025-01-01", "2026-12-31"],
      [1500, "2027-01-01", null],
    ]);
    const acoes = (await historicoDe(db, org, "imovel", imovel)).map((h) => h.acao);
    expect(acoes).toEqual(["contrato.criar", "contrato.encerrar", "contrato.criar"]);
  });

  it("encerrar: não estende, não vai antes do início e respeita organização", async () => {
    const r = await criarContrato(db, org, imovel, { tipo: "gestao_online", comissao: "10", inicio: "2026-01-01", fim: "2026-06-30" }, null);
    const id = r.ok ? r.contrato.id : "";
    expect((await encerrarContrato(db, org, id, "2026-12-31", null)).ok).toBe(false);
    expect((await encerrarContrato(db, org, id, "2025-12-31", null)).ok).toBe(false);
    expect((await encerrarContrato(db, org, id, "2026-02-30", null)).ok).toBe(false);
    expect((await encerrarContrato(db, outra, id, "2026-03-31", null)).ok).toBe(false);
    expect((await encerrarContrato(db, org, id, "2026-03-31", null)).ok).toBe(true);
  });

  it("não cria contrato em imóvel de outra organização", async () => {
    const r = await criarContrato(db, outra, imovel, { tipo: "gestao_online", comissao: "10", inicio: "2026-01-01" }, null);
    expect(r).toEqual({ ok: false, erros: { geral: "Imóvel não encontrado." } });
    expect(await listarContratos(db, outra, imovel)).toEqual([]);
  });
});

describe("encerramentos concorrentes", () => {
  it("o segundo encerramento lê o fim já gravado pelo primeiro e não estende o contrato", async () => {
    const r = await criarContrato(db, org, imovel, { tipo: "gestao_online", comissao: "10", inicio: "2026-01-01" }, null);
    const id = r.ok ? r.contrato.id : "";
    const [a, b] = await Promise.all([encerrarContrato(db, org, id, "2026-03-31", null), encerrarContrato(db, org, id, "2026-06-30", null)]);
    expect(a).toMatchObject({ ok: true });
    expect(b.ok).toBe(false);
    expect((await listarContratos(db, org, imovel))[0].fim).toBe("2026-03-31");
  });
});
