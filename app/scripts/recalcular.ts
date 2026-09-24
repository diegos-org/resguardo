/**
 * Recalcula o financeiro de todas as reservas com as regras atuais (idempotente).
 * Roda no build da Vercel depois das migrações: quando uma regra padrão muda numa versão
 * nova do sistema, os lançamentos antigos acompanham — sem duas versões da mesma regra.
 *
 *   DATABASE_URL=... npx tsx scripts/recalcular.ts
 */
import { getDb } from "../src/db/client";
import { organizacoes } from "../src/db/schema";
import { recalcularPendentes, recalcularReservas } from "../src/financeiro/aplicar";
import { registrarExecucao } from "../src/sistema/automacoes";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("[recalcular] DATABASE_URL ausente — nada feito.");
    return;
  }
  const db = getDb();
  // Registrado na página "Sistema" (M1.6): quando rodou, se deu certo e o resumo.
  const resumo = await registrarExecucao(db, "recalculo-deploy", async () => {
    const partes: string[] = [];
    for (const org of await db.select({ id: organizacoes.id }).from(organizacoes)) {
      const r = await recalcularReservas(db, org.id);
      partes.push(`${r.reservas} reserva(s) conferida(s), ${r.criados} lançamento(s) novo(s), ${r.estornados} estornado(s)`);
      // Pendentes calculadas por versões antigas (de qualquer data): saem do financeiro até confirmar.
      const p = await recalcularPendentes(db, org.id);
      if (p.reservas) partes.push(`${p.reservas} pendente(s) com lançamentos antigos, ${p.estornados} estornado(s), ${p.protegidas} com dinheiro já movimentado (aviso no Início)`);
    }
    return partes.join("; ") || "nenhuma organização";
  });
  console.log(`[recalcular] ${resumo}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
