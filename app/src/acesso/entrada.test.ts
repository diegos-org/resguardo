import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { organizacoes, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { decidirEntrada, lerAdminEmails } from "./entrada";
import { destinoPainel } from "./painel";

let db: Db;
let close: () => Promise<void>;
const config = { adminEmails: ["chefe@example.com"], nomeOrganizacao: "Org Teste" };

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(() => close());

describe("lerAdminEmails", () => {
  it("separa por vírgula, normaliza e ignora lixo", () => {
    expect(lerAdminEmails(" Chefe@Example.com, ,x , outro@example.com")).toEqual(["chefe@example.com", "outro@example.com"]);
    expect(lerAdminEmails(undefined)).toEqual([]);
  });
});

describe("decidirEntrada", () => {
  it("nega e-mail desconhecido que não é admin", async () => {
    expect(await decidirEntrada(db, "estranho@example.com", config)).toBeNull();
    expect(await db.select().from(usuarios)).toEqual([]);
  });

  it("primeiro acesso de ADMIN_EMAILS cria organização e admin, uma vez só", async () => {
    const id = await decidirEntrada(db, "CHEFE@example.com", config);
    expect(id).toBeTruthy();
    const [u] = await db.select().from(usuarios);
    expect(u).toMatchObject({ id, email: "chefe@example.com", papel: "admin", ativo: true });
    expect((await db.select().from(organizacoes)).map((o) => o.nome)).toEqual(["Org Teste"]);

    expect(await decidirEntrada(db, "chefe@example.com", config)).toBe(id);
    expect(await db.select().from(usuarios)).toHaveLength(1);
  });

  it("usuário cadastrado entra; desativado não entra (nem se estiver em ADMIN_EMAILS)", async () => {
    const [org] = await db.insert(organizacoes).values({ nome: "Org" }).returning();
    const [op] = await db
      .insert(usuarios)
      .values([
        { organizacaoId: org.id, email: "Equipe@Example.com", nome: "Equipe", papel: "operacao" },
        { organizacaoId: org.id, email: "chefe@example.com", nome: "Chefe", papel: "admin", ativo: false },
      ])
      .returning();
    expect(await decidirEntrada(db, "equipe@example.com", config)).toBe(op.id);
    expect(await decidirEntrada(db, "chefe@example.com", config)).toBeNull();
    await db.update(usuarios).set({ ativo: false }).where(eq(usuarios.id, op.id));
    expect(await decidirEntrada(db, "equipe@example.com", config)).toBeNull();
  });

  it("dois primeiros logins simultâneos de admins caem na mesma organização", async () => {
    const cfg = { ...config, adminEmails: ["chefe@example.com", "socia@example.com"] };
    const [a, b] = await Promise.all([decidirEntrada(db, "chefe@example.com", cfg), decidirEntrada(db, "socia@example.com", cfg)]);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(await db.select().from(organizacoes)).toHaveLength(1);
    const orgs = new Set((await db.select().from(usuarios)).map((u) => u.organizacaoId));
    expect(orgs.size).toBe(1);
  });

  it("usa a organização existente no bootstrap", async () => {
    const [org] = await db.insert(organizacoes).values({ nome: "Existente" }).returning();
    await decidirEntrada(db, "chefe@example.com", config);
    const [u] = await db.select().from(usuarios);
    expect(u.organizacaoId).toBe(org.id);
  });
});

describe("destinoPainel", () => {
  const base = { usuarioId: "u", organizacaoId: "o", imovelIds: [] };
  it("sem sessão vai para /entrar", () => {
    expect(destinoPainel(null)).toEqual({ ok: false, redirecionar: "/entrar" });
  });
  it("admin e operação entram; proprietário e hóspede não", () => {
    expect(destinoPainel({ ...base, papel: "admin" }).ok).toBe(true);
    expect(destinoPainel({ ...base, papel: "operacao" }).ok).toBe(true);
    expect(destinoPainel({ ...base, papel: "proprietario" })).toEqual({ ok: false, redirecionar: "/portal" });
    expect(destinoPainel({ ...base, papel: "hospede" }).ok).toBe(false);
  });
});
