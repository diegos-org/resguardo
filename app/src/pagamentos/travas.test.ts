import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { estornarRecebimento, registrarRecebimento } from "@/repasses/recebimentos";
import { criarReserva, sincronizarReserva } from "@/reservas/repositorio";
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

  it("quem ocupa noites trava o imóvel como o pagamento (NO KEY UPDATE, antes da reserva): importação do Beds24 ou da planilha e reserva lançada no painel", async () => {
    const e = espiao();
    const dados: Parameters<typeof sincronizarReserva>[4] = {
      imovelId: c.imovel, origem: "airbnb", estado: "confirmada", checkin: "2026-11-20", checkout: "2026-11-23", hospedes: 2,
      hospedeNome: "Hóspede Fictício", hospedeEmail: "", hospedeTelefone: "", hospedeOrigem: "", moeda: "BRL",
      valorBruto: 100000, taxaCanal: null, valorLiquido: null, codigoCanal: "", observacoes: "",
    };
    expect(await sincronizarReserva(e.db, c.org, "beds24", "999001", dados)).toMatchObject({ ok: true });
    expect(await criarReserva(e.db, c.org, { ...dados, checkin: "2026-11-25", checkout: "2026-11-27" }, null)).toMatchObject({ ok: true });
    const noImovel = e.comandos.filter((q) => /from "imoveis"/.test(q) && /\bfor no key update\b/.test(q));
    expect(noImovel.length).toBeGreaterThanOrEqual(2);
    // A trava do imóvel vem antes de qualquer trava da reserva na mesma transação.
    const primeiroImovel = e.comandos.findIndex((q) => /from "imoveis"/.test(q) && /\bfor no key update\b/.test(q));
    const primeiraReserva = e.comandos.findIndex((q) => /from "reservas"/.test(q) && /\bfor (no key )?update\b/.test(q));
    expect(primeiroImovel).toBeGreaterThanOrEqual(0);
    expect(primeiraReserva === -1 || primeiroImovel < primeiraReserva).toBe(true);
  });

  it("recebimento à mão trava a reserva (NO KEY UPDATE) antes de conferir o pagamento pelo site: não cruza com o Pix criado ou aprovado ao mesmo tempo", async () => {
    const s = await c.segurar();
    const e = espiao();
    const r = await registrarRecebimento(e.db, c.org, { reservaId: s.reservaId, data: "2026-10-01", valor: 1000, nota: "" }, null, "2026-10-01");
    expect(r).toMatchObject({ ok: true });
    const trava = e.comandos.findIndex((q) => /from "reservas"/.test(q) && /\bfor no key update\b/.test(q));
    const conferencia = e.comandos.findIndex((q) => /from "pagamentos"/.test(q));
    expect(trava).toBeGreaterThanOrEqual(0);
    expect(conferencia).toBeGreaterThan(trava);
    // Em outra cotação, com o Pix já criado (visto depois da trava), o recebimento à mão é recusado.
    const outra = await c.segurar({ entrada: "2026-11-02", saida: "2026-11-05", email: "outra@example.com" });
    await c.pix(outra.cotacaoId);
    expect(await registrarRecebimento(db, c.org, { reservaId: outra.reservaId, data: "2026-10-01", valor: 1000, nota: "" }, null, "2026-10-01")).toMatchObject({ ok: false, erro: expect.stringContaining("pagamento pelo site") });
  });

  it("estorno do recebimento à mão trava a reserva (NO KEY UPDATE) antes do lançamento: a aprovação do pagamento pelo site nunca vê um recebimento a meio estorno", async () => {
    const s = await c.segurar();
    const r = await registrarRecebimento(db, c.org, { reservaId: s.reservaId, data: "2026-10-01", valor: 1000, nota: "" }, null, "2026-10-01");
    if (!r.ok) throw new Error(r.erro);
    const e = espiao();
    expect(await estornarRecebimento(e.db, c.org, r.id, "registrado por engano", null)).toMatchObject({ ok: true });
    const trava = e.comandos.findIndex((q) => /from "reservas"/.test(q) && /\bfor no key update\b/.test(q));
    const livro = e.comandos.findIndex((q) => /from "lancamentos"/.test(q) && /\bfor update\b/.test(q));
    expect(trava).toBeGreaterThanOrEqual(0);
    expect(livro).toBeGreaterThan(trava);
  });
});
