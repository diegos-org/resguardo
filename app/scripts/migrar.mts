// Aplica as migrações de ./drizzle no banco de DATABASE_URL.
// Roda no build da Vercel (script "vercel-build"). Sem DATABASE_URL, não faz nada.
//
// Duas previews podem construir ao mesmo tempo com a mesma migração nova (os PRs compartilham o
// banco de preview). Uma trava consultiva do Postgres serializa as execuções: a segunda espera a
// primeira terminar e só encontra tudo aplicado. Cada migração roda numa transação na mesma
// conexão que segura a trava (driver com sessão, como o app usa).
//
// As migrações são aplicadas por hash (ver src/db/migracoes.ts), não pela data da última aplicada:
// no banco de preview compartilhado, migrações de branches diferentes se cruzam no tempo e o
// migrador do Drizzle pularia as que viessem com data menor que a última registrada.
import { Pool as NeonPool } from "@neondatabase/serverless";
import { readMigrationFiles } from "drizzle-orm/migrator";
import pg from "pg";
import { aplicarMigracoesPendentes } from "../src/db/migracoes";

type Conexao = { query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>; release(): void };

const TRAVA = "migracoes-scl";

async function conectar(url: string): Promise<{ cliente: Conexao; fim: () => Promise<void> }> {
  const host = new URL(url).hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    const pool = new pg.Pool({ connectionString: url });
    return { cliente: await pool.connect(), fim: () => pool.end() };
  }
  const pool = new NeonPool({ connectionString: url });
  return { cliente: await pool.connect(), fim: () => pool.end() };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("[migrar] DATABASE_URL ausente — migrações não aplicadas.");
    return;
  }
  const migrationsFolder = new URL("../drizzle", import.meta.url).pathname;
  const { cliente, fim } = await conectar(url);
  try {
    await cliente.query("select pg_advisory_lock(hashtext($1))", [TRAVA]);
    try {
      const n = await aplicarMigracoesPendentes((sql, params) => cliente.query(sql, params), readMigrationFiles({ migrationsFolder }));
      console.log(`[migrar] ${n} migração(ões) aplicada(s).`);
    } finally {
      await cliente.query("select pg_advisory_unlock(hashtext($1))", [TRAVA]);
    }
  } finally {
    cliente.release();
    await fim();
  }
}

await main();
