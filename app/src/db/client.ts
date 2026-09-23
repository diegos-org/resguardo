import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import type { Db } from "./types";

let cached: Db | undefined;

/** Conexão com o Neon a partir de `DATABASE_URL` (configurada na Vercel/ambiente). */
export function getDb(): Db {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL não configurada");
  }
  cached = drizzle(neon(url), { schema });
  return cached;
}
