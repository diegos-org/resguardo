import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";
import type { Db } from "./types";

let cached: Db | undefined;

/**
 * Conexão com o Neon a partir de `DATABASE_URL` (configurada na Vercel/ambiente).
 * Usa o driver com WebSocket (Pool) porque ele suporta transações — gravar um dado e
 * seu histórico precisa ser tudo-ou-nada.
 */
export function getDb(): Db {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL não configurada");
  }
  cached = drizzle(new Pool({ connectionString: url }), { schema });
  return cached;
}
