// Aplica as migrações de ./drizzle no banco de DATABASE_URL.
// Roda no build da Vercel (script "vercel-build"). Sem DATABASE_URL, não faz nada.
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { migrate as migrateNeon } from "drizzle-orm/neon-http/migrator";
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
if (host === "localhost" || host === "127.0.0.1") {
  const pool = new pg.Pool({ connectionString: url });
  await migratePg(drizzlePg(pool), { migrationsFolder });
  await pool.end();
} else {
  await migrateNeon(drizzleNeon(neon(url)), { migrationsFolder });
}
console.log("[migrar] migrações aplicadas.");
