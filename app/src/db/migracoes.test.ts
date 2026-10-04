import { PGlite } from "@electric-sql/pglite";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { aplicarMigracoesPendentes, type Migracao } from "./migracoes";

let db: PGlite;
const executar = (sql: string, params?: unknown[]) => db.query(sql, params);
const registradas = async () => (await db.query<{ hash: string; created_at: string }>('select hash, created_at from "drizzle"."__drizzle_migrations" order by id')).rows;
const tabelas = async () => (await db.query<{ t: string }>("select tablename as t from pg_tables where schemaname = 'public' order by 1")).rows.map((r) => r.t);
const migracao = (sql: string, folderMillis: number): Migracao => ({ sql: [sql], folderMillis, hash: createHash("sha256").update(sql).digest("hex") });

beforeEach(() => {
  db = new PGlite();
});
afterEach(() => db.close());

describe("aplicação das migrações por hash (build da Vercel)", () => {
  it("aplica o que não está registrado, na ordem do journal, e registra como o Drizzle; rodar de novo não faz nada", async () => {
    const a = migracao("create table a (id int)", 100);
    const b = migracao("create table b (id int)", 200);
    expect(await aplicarMigracoesPendentes(executar, [a, b])).toBe(2);
    expect(await tabelas()).toEqual(["a", "b"]);
    expect((await registradas()).map((r) => [r.hash, Number(r.created_at)])).toEqual([[a.hash, 100], [b.hash, 200]]);
    expect(await aplicarMigracoesPendentes(executar, [a, b])).toBe(0);
  });

  it("banco de preview compartilhado: migração de outro branch já registrada com data maior não faz pular a que veio depois com data menor", async () => {
    const a = migracao("create table a (id int)", 100);
    // A de outro branch, aplicada antes, ficou registrada com data 300.
    const outra = migracao("create table outra (id int)", 300);
    await aplicarMigracoesPendentes(executar, [a, outra]);
    // O journal deste branch traz b (200) e c (250): o migrador do Drizzle pularia as duas (200 e 250 < 300); por hash, rodam.
    const b = migracao("create table b (id int)", 200);
    const c = migracao("alter table b add column nome text", 250);
    expect(await aplicarMigracoesPendentes(executar, [a, b, c, outra])).toBe(2);
    expect(await tabelas()).toEqual(["a", "b", "outra"]);
    expect((await db.query<{ n: number }>("select count(*)::int as n from information_schema.columns where table_name = 'b'")).rows[0].n).toBe(2);
    expect((await registradas()).map((r) => Number(r.created_at))).toEqual([100, 300, 200, 250]);
  });

  it("migração que falha é desfeita inteira e não fica registrada; as anteriores ficam", async () => {
    const a = migracao("create table a (id int)", 100);
    const ruim: Migracao = { sql: ["create table b (id int)", "create table a (id int)"], folderMillis: 200, hash: "ruim" };
    await expect(aplicarMigracoesPendentes(executar, [a, ruim])).rejects.toThrow();
    expect(await tabelas()).toEqual(["a"]);
    expect((await registradas()).map((r) => r.hash)).toEqual([a.hash]);
  });

  it("as migrações reais do projeto aplicam do zero, e a 0053 (M12.4) é idempotente sobre um banco que já tem os objetos dela", async () => {
    const todas = readMigrationFiles({ migrationsFolder: join(process.cwd(), "drizzle") });
    expect(await aplicarMigracoesPendentes(executar, todas)).toBe(todas.length);
    expect(await tabelas()).toEqual(expect.arrayContaining(["beds24_envio_imoveis", "repasse_itens", "arquivos"]));
    // Como no banco de preview: os objetos existem, mas a 0053 não está registrada (as antigas do branch é que criaram).
    const ultima = todas.at(-1)!;
    await db.query('delete from "drizzle"."__drizzle_migrations" where hash = $1', [ultima.hash]);
    expect(await aplicarMigracoesPendentes(executar, todas)).toBe(1);
    expect((await registradas()).some((r) => r.hash === ultima.hash)).toBe(true);
  }, 120_000);
});
