import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execucoesAutomacao, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { CorreioMemoria } from "@/email/correio";

// A primeira organização quebra no meio do envio; a segunda tem de receber mesmo assim.
const enviadas: string[] = [];
vi.mock("./agenda", async (original) => {
  const real = await original<typeof import("./agenda")>();
  return {
    ...real,
    enviarAgenda: vi.fn(async (_db: Db, org: string) => {
      if (org === quebrada) throw new Error("banco caiu");
      enviadas.push(org);
      return { enviados: 1, jaEnviados: 0, falhas: [], aviso: null };
    }),
  };
});

let quebrada = "";
let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  enviadas.length = 0;
});
afterEach(() => close());

describe("agenda de todas as organizações", () => {
  it("erro numa organização não impede as outras; a execução fica como falha", async () => {
    const { agendaDeTodas } = await import("./cron");
    const [a, b] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
    quebrada = a.id;
    await expect(agendaDeTodas(db, new CorreioMemoria(), new Date("2026-10-01T23:00:00Z"))).rejects.toThrow("erro numa organização: banco caiu");
    expect(enviadas).toEqual([b.id]);
    const [exec] = await db.select().from(execucoesAutomacao);
    expect(exec.resumo).toContain("1 enviada(s)");
  });
});
