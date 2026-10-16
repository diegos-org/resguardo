/**
 * Ordem das travas na troca da fonte de preços (M8.3a, desenho 3.6 "Exceção de hoje"; seção 10, teste 8): a gravação dos
 * detalhes pega `beds24:<org>` ANTES de travar o imóvel, como a importação e o envio. Travar o imóvel e só depois esperar
 * o Beds24 dava impasse com eles.
 *
 * O PGlite dos testes tem uma conexão só e serializa as transações (quem chega espera a outra terminar inteira): o impasse
 * de duas conexões não acontece aqui. Por isso o teste olha a causa dele — na hora em que a transação pede a trava do
 * Beds24, ela já tem o imóvel travado? (`xmax` da linha = a própria transação) — e roda a importação e a troca da fonte
 * ao mesmo tempo, conferindo que as duas terminam.
 */
import { type SQL, eq, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Beds24Falso } from "@/beds24/falso";
import { sincronizarBeds24 } from "@/beds24/sincronizacao";
import { gravarConfig } from "@/configuracoes/armazem";
import { idsExternos, imoveis, imoveisDetalhes, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { DETALHES_VAZIOS, lerDetalhes, salvarDetalhes, salvarDetalhesComLeitura } from "./detalhes";

let db: Db, close: () => Promise<void>, org: string, im: string;
const dialeto = new PgDialect();

/**
 * Espiona as transações do banco: cada vez que uma delas pede a trava `beds24:<org>`, anota se o imóvel já estava travado
 * por ela. `antes`: roda dentro da primeira transação, antes de tudo (a "outra gravação" que mudou o cadastro no meio).
 */
function espiarOrdem(antes?: (tx: Db) => Promise<unknown>) {
  const imovelJaTravado: boolean[] = [];
  const original = db.transaction.bind(db);
  let primeira = true;
  const espiao = vi.spyOn(db, "transaction").mockImplementation(((fn: (tx: Db) => Promise<unknown>, cfg?: unknown) =>
    original(async (tx) => {
      if (primeira && antes) await antes(tx);
      primeira = false;
      const vigiado = new Proxy(tx, {
        get(alvo, k, receptor) {
          if (k === "execute")
            return async (q: SQL) => {
              const { sql: texto, params } = dialeto.sqlToQuery(q);
              if (texto.includes("pg_advisory_xact_lock(") && params.includes(`beds24:${org}`)) {
                const r = (await alvo.execute(sql`select (xmax = pg_current_xact_id()::xid) as travado from imoveis where id = ${im}`)) as unknown as { rows: { travado: boolean }[] };
                imovelJaTravado.push(r.rows[0]?.travado === true);
              }
              return alvo.execute(q);
            };
          const v = Reflect.get(alvo, k, receptor);
          return typeof v === "function" ? v.bind(alvo) : v;
        },
      });
      return fn(vigiado as Db);
    }, cfg as never)) as typeof db.transaction);
  return { imovelJaTravado, restaurar: () => espiao.mockRestore() };
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Organização de teste" }).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Quatro" }).returning();
  expect(await salvarDetalhes(db, org, im, { ...DETALHES_VAZIOS, precoBase: 50000 }, null)).toBe(true);
});
afterEach(() => close());

describe("fonte de preços e a trava do Beds24 (M8.3a, teste 8)", () => {
  it("salvarDetalhes: a trava do Beds24 vem antes da do imóvel", async () => {
    const e = espiarOrdem();
    expect(await salvarDetalhes(db, org, im, { ...DETALHES_VAZIOS, precoBase: 50000, fontePrecos: "beds24" }, null)).toBe(true);
    e.restaurar();
    expect(e.imovelJaTravado).toEqual([false]);
    expect((await lerDetalhes(db, org, im)).fontePrecos).toBe("beds24");
  });

  it("salvarDetalhesComLeitura (a do portal): a mesma ordem; sem mudar a fonte, nem pede a trava do Beds24", async () => {
    const e = espiarOrdem();
    expect(await salvarDetalhesComLeitura(db, org, im, (atual) => ({ ...atual, fontePrecos: "manual" }), null)).toEqual({ ok: true });
    expect(await salvarDetalhesComLeitura(db, org, im, (atual) => ({ ...atual, precoBase: 60000 }), null)).toEqual({ ok: true });
    e.restaurar();
    expect(e.imovelJaTravado).toEqual([false]);
    expect(await lerDetalhes(db, org, im)).toMatchObject({ fontePrecos: "manual", precoBase: 60000 });
  });

  it("a fonte mudou entre a leitura sem trava e a gravação (outra gravação no meio): recomeça já com a trava do Beds24, nunca depois do imóvel", async () => {
    const e = espiarOrdem((tx) => tx.update(imoveisDetalhes).set({ fontePrecos: "beds24" }).where(eq(imoveisDetalhes.imovelId, im)));
    // A leitura sem trava vê "scl" (igual ao pedido): sem a trava do Beds24. Com o imóvel travado, a fonte já é "beds24".
    expect(await salvarDetalhes(db, org, im, { ...DETALHES_VAZIOS, precoBase: 70000 }, null)).toBe(true);
    e.restaurar();
    expect(e.imovelJaTravado).toEqual([false]);
    expect(await lerDetalhes(db, org, im)).toMatchObject({ fontePrecos: "scl", precoBase: 70000 });
  });

  it("mudar a fonte de preços ao mesmo tempo que a importação: as duas terminam (sem impasse) e na ordem única", async () => {
    await db.insert(idsExternos).values({ organizacaoId: org, imovelId: im, canal: "beds24", idExterno: "10", detalhe: "20" });
    await db.transaction((tx) => gravarConfig(tx, org, "beds24", { automatica: false, desde: "2026-09-01", diasCalendario: 2 }, null));
    const leitor = new Beds24Falso(() => new Date("2026-09-28T12:00:00Z"));
    leitor.properties = [{ id: 10, currency: "BRL", roomTypes: [{ id: 20, name: "Quarto fictício" }] }];
    leitor.bookings = [{ id: 123, propertyId: 10, roomId: 20, status: "confirmed", arrival: "2030-10-10", departure: "2030-10-13", numAdult: 2, price: 1500, channel: "Airbnb", apiReference: "HMFAKE" }];
    leitor.calendarios = [{ roomId: 20, calendar: [{ from: "2026-09-28", to: "2026-09-29", numAvail: 1, price1: 100 }] }];
    const e = espiarOrdem();
    const [importacao, troca] = await Promise.all([
      sincronizarBeds24(db, org, leitor, { agora: new Date("2026-09-28T12:00:00Z") }),
      salvarDetalhes(db, org, im, { ...DETALHES_VAZIOS, precoBase: 50000, fontePrecos: "beds24" }, null),
    ]);
    e.restaurar();
    expect(importacao).toMatchObject({ ok: true, criadas: 1 });
    expect(troca).toBe(true);
    expect(e.imovelJaTravado).toEqual([false]);
    expect((await lerDetalhes(db, org, im)).fontePrecos).toBe("beds24");
  });
});
