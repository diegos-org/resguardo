import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { imoveis, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { criarContrato, encerrarContrato, listarContratos } from "./repositorio";

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
  it("troca de percentual: encerra o atual e cria o novo, com histórico no imóvel", async () => {
    const r1 = await criarContrato(db, org, imovel, { tipo: "gestao_completa", comissao: "20", inicio: "2025-01-01" }, null);
    expect(r1.ok).toBe(true);
    const bloqueado = await criarContrato(db, org, imovel, { tipo: "gestao_completa", comissao: "15", inicio: "2027-01-01" }, null);
    expect(bloqueado.ok).toBe(false);

    const id = r1.ok ? r1.contrato.id : "";
    expect(await encerrarContrato(db, org, id, "2026-12-31", null)).toEqual({ ok: true });
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
    expect((await encerrarContrato(db, outra, id, "2026-03-31", null)).ok).toBe(false);
    expect((await encerrarContrato(db, org, id, "2026-03-31", null)).ok).toBe(true);
  });

  it("não cria contrato em imóvel de outra organização", async () => {
    const r = await criarContrato(db, outra, imovel, { tipo: "gestao_online", comissao: "10", inicio: "2026-01-01" }, null);
    expect(r).toEqual({ ok: false, erros: { geral: "Imóvel não encontrado." } });
    expect(await listarContratos(db, outra, imovel)).toEqual([]);
  });
});
