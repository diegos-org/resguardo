// Aplica as migrações de ./drizzle no banco de DATABASE_URL (Neon).
// Roda no build da Vercel (script "vercel-build"). Sem DATABASE_URL, não faz nada.
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("[migrar] DATABASE_URL ausente — migrações não aplicadas.");
  process.exit(0);
}
await migrate(drizzle(neon(url)), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
console.log("[migrar] migrações aplicadas.");
