import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool as PgPool } from "pg";
import * as schema from "./schema";
import type { Db } from "./types";

let cached: Db | undefined;

/** Postgres local (desenvolvimento/testes manuais) usa o driver comum; o resto é Neon. */
export function ehBancoLocal(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * Conexão a partir de `DATABASE_URL` (configurada na Vercel/ambiente).
 * No Neon usa o driver com WebSocket (Pool), que suporta transações — gravar um dado e
 * seu histórico precisa ser tudo-ou-nada.
 */
export function getDb(): Db {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL não configurada");
  }
  cached = ehBancoLocal(url)
    ? drizzlePg(new PgPool({ connectionString: url }), { schema })
    : drizzleNeon(new NeonPool({ connectionString: url }), { schema });
  return cached;
}
