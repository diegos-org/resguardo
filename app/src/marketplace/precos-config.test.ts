import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { PESOS_PADRAO_ANTIGO, PRECOS_MARKETPLACE_PADRAO } from "./precos";
import { lerPrecosMarketplace, pesosNoPadraoAntigo, salvarPrecosMarketplace, usarPesosPadrao } from "./precos-config";

let db: Db, close: () => Promise<void>, org: string;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "A" }).returning();
});
afterEach(() => close());

describe("padrão dos pesos do modelo B (M12.5)", () => {
  it("quem nunca gravou usa 6/3/3; quem gravou o 1/1/1 antigo continua com ele, vê o aviso e escolhe trocar (as taxas ficam)", async () => {
    expect((await lerPrecosMarketplace(db, org)).pesos).toEqual({ hospede: 1, proprietario: 1, scl: 2 });
    expect(await pesosNoPadraoAntigo(db, org)).toBe(false);
    await salvarPrecosMarketplace(db, org, { ...PRECOS_MARKETPLACE_PADRAO, taxaPagamentoBp: 398, pesos: { ...PESOS_PADRAO_ANTIGO } }, null);
    expect((await lerPrecosMarketplace(db, org)).pesos).toEqual(PESOS_PADRAO_ANTIGO);
    expect(await pesosNoPadraoAntigo(db, org)).toBe(true);
    expect(await usarPesosPadrao(db, org, null)).toBe(true);
    expect(await lerPrecosMarketplace(db, org)).toEqual({ ...PRECOS_MARKETPLACE_PADRAO, taxaPagamentoBp: 398 });
    expect(await pesosNoPadraoAntigo(db, org)).toBe(false);
    // Outros pesos gravados (escolha de alguém) não são o padrão antigo: sem aviso.
    await salvarPrecosMarketplace(db, org, { ...PRECOS_MARKETPLACE_PADRAO, pesos: { hospede: 2, proprietario: 1, scl: 1 } }, null);
    expect(await pesosNoPadraoAntigo(db, org)).toBe(false);
  });
});
