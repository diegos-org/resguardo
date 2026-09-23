import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { imoveis, organizacoes, proprietarioImoveis, proprietarioUsuarios, proprietarios, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { autorizar } from "./politica";
import { carregarSessao } from "./sessao";

let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(() => close());

async function cenario() {
  const [scl] = await db.insert(organizacoes).values({ nome: "Organização Teste" }).returning();
  const [outra] = await db.insert(organizacoes).values({ nome: "Outra" }).returning();
  const [a, b] = await db
    .insert(imoveis)
    .values([
      { organizacaoId: scl.id, codigo: "T1", nome: "Teste 1" },
      { organizacaoId: scl.id, codigo: "T2", nome: "Teste 2" },
    ])
    .returning();
  const [deOutra] = await db.insert(imoveis).values({ organizacaoId: outra.id, codigo: "X1", nome: "Outra org" }).returning();
  const [prop] = await db.insert(proprietarios).values({ organizacaoId: scl.id, nome: "Proprietária Fictícia" }).returning();
  await db.insert(proprietarioImoveis).values([
    { proprietarioId: prop.id, imovelId: a.id },
    { proprietarioId: prop.id, imovelId: deOutra.id },
  ]);
  const [dona, representante, admin] = await db
    .insert(usuarios)
    .values([
      { organizacaoId: scl.id, email: "dona@example.com", nome: "Dona", papel: "proprietario" },
      { organizacaoId: scl.id, email: "rep@example.com", nome: "Representante", papel: "proprietario" },
      { organizacaoId: scl.id, email: "admin@example.com", nome: "Admin", papel: "admin" },
    ])
    .returning();
  await db.insert(proprietarioUsuarios).values([
    { proprietarioId: prop.id, usuarioId: dona.id },
    { proprietarioId: prop.id, usuarioId: representante.id },
  ]);
  return { scl, a, b, deOutra, dona, representante, admin };
}

describe("carregarSessao", () => {
  it("resolve os imóveis do proprietário pelos vínculos, só da mesma organização", async () => {
    const c = await cenario();
    const s = await carregarSessao(db, c.dona.id);
    expect(s).toEqual({ usuarioId: c.dona.id, organizacaoId: c.scl.id, papel: "proprietario", imovelIds: [c.a.id] });

    expect(autorizar(s, "financeiro:ler", { organizacaoId: c.scl.id, imovelId: c.a.id }).permitido).toBe(true);
    expect(autorizar(s, "financeiro:ler", { organizacaoId: c.scl.id, imovelId: c.b.id }).permitido).toBe(false);
  });

  it("representante vinculado vê os mesmos imóveis", async () => {
    const c = await cenario();
    expect((await carregarSessao(db, c.representante.id))?.imovelIds).toEqual([c.a.id]);
  });

  it("admin não recebe lista de imóveis (acesso é por papel)", async () => {
    const c = await cenario();
    expect((await carregarSessao(db, c.admin.id))?.imovelIds).toEqual([]);
  });

  it("usuário inativo ou inexistente não tem sessão", async () => {
    const c = await cenario();
    await db.update(usuarios).set({ ativo: false }).where(eq(usuarios.id, c.dona.id));
    expect(await carregarSessao(db, c.dona.id)).toBeNull();
    expect(await carregarSessao(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("e-mail é único sem diferenciar maiúsculas", async () => {
    const c = await cenario();
    await expect(
      db.insert(usuarios).values({ organizacaoId: c.scl.id, email: "DONA@example.com", nome: "Cópia", papel: "admin" }),
    ).rejects.toThrow();
  });
});
