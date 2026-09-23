import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { imoveis, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { adicionarIdExterno, listarIdsExternos, removerIdExterno, resolverImovel, validarIdExterno } from "./ids-externos";

let db: Db;
let close: () => Promise<void>;
let org: string;
let outra: string;
let a: string;
let b: string;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const [o1, o2] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
  org = o1.id;
  outra = o2.id;
  const [i1, i2] = await db
    .insert(imoveis)
    .values([
      { organizacaoId: org, codigo: "t1", nome: "Um" },
      { organizacaoId: org, codigo: "t2", nome: "Dois" },
    ])
    .returning();
  a = i1.id;
  b = i2.id;
});
afterEach(() => close());

describe("validarIdExterno", () => {
  it("aceita IDs simples e recusa lixo", () => {
    expect(validarIdExterno({ canal: "beds24", idExterno: " 123 ", detalhe: "456" })).toEqual({ ok: true, canal: "beds24", idExterno: "123", detalhe: "456" });
    expect(validarIdExterno({ canal: "vrbo", idExterno: "1" }).ok).toBe(false);
    expect(validarIdExterno({ canal: "airbnb", idExterno: "" }).ok).toBe(false);
    expect(validarIdExterno({ canal: "airbnb", idExterno: "1 2" }).ok).toBe(false);
  });
});

describe("IDs externos", () => {
  it("liga, resolve (com e sem detalhe) e remove, com histórico", async () => {
    await adicionarIdExterno(db, org, a, { canal: "beds24", idExterno: "100", detalhe: "1" }, null);
    await adicionarIdExterno(db, org, b, { canal: "beds24", idExterno: "100", detalhe: "2" }, null);
    await adicionarIdExterno(db, org, a, { canal: "airbnb", idExterno: "999" }, null);

    expect(await resolverImovel(db, org, "beds24", "100", "1")).toBe(a);
    expect(await resolverImovel(db, org, "beds24", "100", "2")).toBe(b);
    expect(await resolverImovel(db, org, "airbnb", "999", "qualquer")).toBe(a);
    expect(await resolverImovel(db, org, "booking", "999")).toBeNull();
    expect(await resolverImovel(db, outra, "airbnb", "999")).toBeNull();

    const [primeiro] = await listarIdsExternos(db, org, a);
    expect(await removerIdExterno(db, outra, primeiro.id, null)).toBe(false);
    expect(await removerIdExterno(db, org, primeiro.id, null)).toBe(true);
    const acoes = (await historicoDe(db, org, "imovel", a)).map((h) => h.acao);
    expect(acoes.filter((x) => x.startsWith("idexterno"))).toHaveLength(3);
  });

  it("o mesmo ID não pode apontar para dois imóveis", async () => {
    expect((await adicionarIdExterno(db, org, a, { canal: "airbnb", idExterno: "5" }, null)).ok).toBe(true);
    expect(await adicionarIdExterno(db, org, b, { canal: "airbnb", idExterno: "5" }, null)).toEqual({ ok: false, erro: "Este ID já está ligado a um imóvel." });
  });

  it("não liga em imóvel de outra organização", async () => {
    expect(await adicionarIdExterno(db, outra, a, { canal: "airbnb", idExterno: "5" }, null)).toEqual({ ok: false, erro: "Imóvel não encontrado." });
  });
});
