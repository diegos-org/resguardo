import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { historicoDe } from "@/auditoria/auditoria";
import { beds24Envios, imoveis, organizacoes } from "@/db/schema";
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
    // Um só quarto Beds24 por imóvel: o segundo é recusado (a importação e o envio não aceitam vínculo repetido).
    expect(await adicionarIdExterno(db, org, a, { canal: "beds24", idExterno: "100", detalhe: "3" }, null)).toMatchObject({ ok: false, erro: expect.stringContaining("já tem um quarto Beds24") });

    expect(await resolverImovel(db, org, "beds24", "100", "1")).toBe(a);
    expect(await resolverImovel(db, org, "beds24", "100", "2")).toBe(b);
    expect(await resolverImovel(db, org, "airbnb", "999", "qualquer")).toBe(a);
    expect(await resolverImovel(db, org, "booking", "999")).toBeNull();
    expect(await resolverImovel(db, outra, "airbnb", "999")).toBeNull();

    const [primeiro] = await listarIdsExternos(db, org, a);
    expect((await removerIdExterno(db, outra, primeiro.id, null)).ok).toBe(false);
    expect(await removerIdExterno(db, org, primeiro.id, null)).toEqual({ ok: true });
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

it("vínculo Beds24 não é criado nem removido enquanto um envio de calendário está entre a escrita e o registro; outros canais seguem", async () => {
  const antes = await adicionarIdExterno(db, org, a, { canal: "beds24", idExterno: "100", detalhe: "1" }, null);
  if (!antes.ok) throw new Error(antes.erro);
  const [envio] = await db.insert(beds24Envios).values({ organizacaoId: org, iniciadoEm: new Date(Date.now() - 60_000), modo: "envio", situacao: "executando" }).returning({ id: beds24Envios.id });
  expect(await adicionarIdExterno(db, org, b, { canal: "beds24", idExterno: "100", detalhe: "2" }, null)).toMatchObject({ ok: false, erro: expect.stringContaining("envio de calendário") });
  expect(await removerIdExterno(db, org, antes.registro.id, null)).toMatchObject({ ok: false, erro: expect.stringContaining("envio de calendário") });
  expect((await adicionarIdExterno(db, org, a, { canal: "airbnb", idExterno: "999" }, null)).ok).toBe(true);
  expect(await listarIdsExternos(db, org, a)).toHaveLength(2);
  await db.update(beds24Envios).set({ iniciadoEm: new Date(Date.now() - 11 * 60_000) }).where(eq(beds24Envios.id, envio.id));
  expect(await removerIdExterno(db, org, antes.registro.id, null)).toEqual({ ok: true });
});
