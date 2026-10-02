// Aplica as migrações de ./drizzle no banco de DATABASE_URL.
// Roda no build da Vercel (script "vercel-build"). Sem DATABASE_URL, não faz nada.
//
// Duas previews podem construir ao mesmo tempo com a mesma migração nova (PRs empilhados
// compartilham o banco de preview). Uma trava consultiva do Postgres serializa as execuções:
// a segunda espera a primeira terminar e só encontra tudo aplicado. A migração roda numa
// transação na mesma conexão que segura a trava (driver com sessão, como o app usa).
import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { migrate as migrateNeon } from "drizzle-orm/neon-serverless/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("[migrar] DATABASE_URL ausente — migrações não aplicadas.");
  process.exit(0);
}
const migrationsFolder = new URL("../drizzle", import.meta.url).pathname;
const host = new URL(url).hostname;
const local = host === "localhost" || host === "127.0.0.1";
const TRAVA = "migracoes-scl";

const pool = local ? new pg.Pool({ connectionString: url }) : new NeonPool({ connectionString: url });
const cliente = await pool.connect();
try {
  await cliente.query("select pg_advisory_lock(hashtext($1))", [TRAVA]);
  try {
    if (local) await migratePg(drizzlePg(cliente), { migrationsFolder });
    else await migrateNeon(drizzleNeon(cliente), { migrationsFolder });
  } finally {
    await cliente.query("select pg_advisory_unlock(hashtext($1))", [TRAVA]);
  }
} finally {
  cliente.release();
  await pool.end();
}
console.log("[migrar] migrações aplicadas.");
