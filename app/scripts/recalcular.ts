/**
 * Recalcula o financeiro de todas as reservas com as regras atuais (idempotente).
 * Roda no build da Vercel depois das migrações: quando uma regra padrão muda numa versão
 * nova do sistema, os lançamentos antigos acompanham — sem duas versões da mesma regra.
 *
 *   DATABASE_URL=... npx tsx scripts/recalcular.ts
 */
import { getDb } from "../src/db/client";
import { organizacoes } from "../src/db/schema";
import { recalcularReservas } from "../src/financeiro/aplicar";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("[recalcular] DATABASE_URL ausente — nada feito.");
    return;
  }
  const db = getDb();
  for (const org of await db.select({ id: organizacoes.id }).from(organizacoes)) {
    const r = await recalcularReservas(db, org.id);
    console.log(`[recalcular] ${r.reservas} reserva(s): ${r.criados} lançamento(s) novo(s), ${r.estornados} estornado(s).`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
