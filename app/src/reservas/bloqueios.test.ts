import { afterEach, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { historicoDe } from "@/auditoria/auditoria";
import { bloqueios, imoveis, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { criarBloqueio, excluirBloqueio, validarBloqueio } from "./bloqueios";

let db: Db, close: () => Promise<void>, org: string, outra: string, im: string;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }, { id: outra }] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "103", nome: "Boutique" }).returning();
});
afterEach(() => close());

it("valida datas e imóvel; fim é o dia da liberação", () => {
  const erro = (e: Partial<Parameters<typeof validarBloqueio>[0]>) => { const r = validarBloqueio({ imovelId: im, inicio: "2026-10-03", fim: "2026-10-05", motivo: " Uso próprio ", ...e }); return r.ok ? "ok" : r.erro; };
  expect(erro({})).toBe("ok");
  expect(erro({ imovelId: "x" })).toContain("imóvel");
  expect(erro({ fim: "2026-10-03" })).toContain("depois");
  expect(erro({ inicio: "2026-02-30" })).toContain("inválidas");
  expect(erro({ fim: "2101-01-01" })).toContain("2000 e 2100");
});

it("cria com histórico, recusa sobreposição e imóvel de outra empresa; só remove o que o SCL criou", async () => {
  const r = await criarBloqueio(db, org, { imovelId: im, inicio: "2026-10-03", fim: "2026-10-05", motivo: "Uso próprio" }, null);
  expect(r.ok).toBe(true);
  expect(await criarBloqueio(db, org, { imovelId: im, inicio: "2026-10-04", fim: "2026-10-06", motivo: "" }, null)).toMatchObject({ ok: false, erro: expect.stringContaining("Já existe") });
  expect(await criarBloqueio(db, org, { imovelId: im, inicio: "2026-10-05", fim: "2026-10-06", motivo: "" }, null)).toMatchObject({ ok: true });
  expect(await criarBloqueio(db, outra, { imovelId: im, inicio: "2026-11-01", fim: "2026-11-02", motivo: "" }, null)).toMatchObject({ ok: false, erro: "Imóvel não encontrado." });
  const [{ id: importado }] = await db.insert(bloqueios).values({ organizacaoId: org, imovelId: im, inicio: "2026-12-01", fim: "2026-12-02", fonte: "beds24", idFonte: "77" }).returning();
  expect(await excluirBloqueio(db, org, importado, null)).toBe(false);
  if (!r.ok) throw new Error("fixture");
  expect(await excluirBloqueio(db, outra, r.id, null)).toBe(false);
  expect(await excluirBloqueio(db, org, r.id, null)).toBe(true);
  expect(await db.select().from(bloqueios).where(eq(bloqueios.organizacaoId, org))).toHaveLength(2);
  const h = await historicoDe(db, org, "imovel", im);
  expect(h.map((l) => l.acao)).toEqual(["bloqueio.remover", "bloqueio.criar", "bloqueio.criar"]);
  expect(JSON.stringify(h)).toContain("Uso próprio");
});
