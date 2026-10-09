import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { conferirTentativa } from "./conferencia";
import { estornarLiberacaoManual, registrarLiberacaoManual } from "./liberacao";
import { type Cenario, minutos, montarCenario, TOTAL } from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => { c = await montarCenario(db); });

/** O mesmo banco, anotando cada comando SQL (para conferir o modo das travas). */
function espiao(): { db: Db; comandos: string[] } {
  const comandos: string[] = [];
  const cliente = (db as unknown as { $client: PGlite }).$client;
  const espiado = drizzle(cliente, { schema, logger: { logQuery: (q) => comandos.push(q) } }) as unknown as Db;
  return { db: espiado, comandos };
}

describe("ordem e modo das travas do pagamento (M8.2a)", () => {
  it("a reserva é travada com NO KEY UPDATE em toda transação do pagamento (trava da cotação, taxa tardia, confirmação, liberação e estorno): nunca FOR UPDATE, que bloquearia a chave estrangeira de lançamentos e itens de repasse", async () => {
    const s = await c.segurar();
    const p = await c.pix(s.cotacaoId);
    const e = espiao();
    // Aprovado sem a taxa: confirma (confirmação do pedido pago e a sincronização da reserva).
    c.provedor.aprovar(p.idProvedor, {});
    await conferirTentativa(e.db, c.org, p.pagamentoId, c.provedor, minutos(3), { origem: "rotina", forcar: true });
    expect((await c.reserva(s.reservaId)).estado).toBe("confirmada");
    // A taxa chega depois: gravada na reserva com o motor, na mesma transação.
    c.provedor.atualizarFinanceiro(p.idProvedor, { liquido: TOTAL - 1806 });
    await conferirTentativa(e.db, c.org, p.pagamentoId, c.provedor, minutos(10), { origem: "rotina", forcar: true });
    expect((await c.reserva(s.reservaId)).taxaCanal).toBe(1806);
    // Liberação à mão e o estorno dela (este também toma a trava do motor).
    expect(await registrarLiberacaoManual(e.db, c.org, p.pagamentoId, { data: "2026-10-01", liquido: TOTAL - 2000 }, null, minutos(20))).toEqual({ ok: true });
    expect(await estornarLiberacaoManual(e.db, c.org, p.pagamentoId, "valor errado", null, minutos(30))).toEqual({ ok: true });
    const naReserva = e.comandos.filter((q) => /from "reservas"/.test(q) && /\bfor (no key )?update\b/.test(q));
    expect(naReserva.length).toBeGreaterThanOrEqual(5);
    expect(naReserva.filter((q) => /\bfor update\b/.test(q))).toEqual([]);
  });
});
