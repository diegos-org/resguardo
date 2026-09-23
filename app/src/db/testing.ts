import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import * as schema from "./schema";
import type { Db } from "./types";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/**
 * Banco Postgres em memória (PGlite) com todas as migrações aplicadas.
 * Uso exclusivo em testes: sem rede e sem credenciais.
 */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return { db, close: () => client.close() };
}
