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
      // A lenta só termina depois que outra organização recebeu (ou desiste em 3s).
      if (org === lenta) await Promise.race([new Promise<void>((ok) => (liberar = ok)), new Promise((ok) => setTimeout(ok, 3000))]);
      enviadas.push(org);
      if (org !== lenta) liberar();
      return { enviados: 1, jaEnviados: 0, falhas: [], aviso: null };
    }),
  };
});

let quebrada = "";
let lenta = "";
let liberar: () => void = () => {};
let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  enviadas.length = 0;
  quebrada = "";
  lenta = "";
});
afterEach(() => close());

describe("agenda de todas as organizações", () => {
  it("erro numa organização não impede as outras; a execução fica como falha", async () => {
    const { agendaDeTodas } = await import("./cron");
    const [a, b] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
    quebrada = a.id;
    await expect(agendaDeTodas(db, new CorreioMemoria(), new Date("2026-10-01T23:00:00Z"))).rejects.toThrow("erro ao montar ou enviar a agenda de uma organização");
    expect(enviadas).toEqual([b.id]);
    const [exec] = await db.select().from(execucoesAutomacao);
    expect(exec.resumo).toContain("1 enviada(s)");
  });

  it("uma organização lenta não segura as outras (várias ao mesmo tempo)", async () => {
    const { agendaDeTodas } = await import("./cron");
    const [a, b] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
    lenta = a.id;
    await agendaDeTodas(db, new CorreioMemoria(), new Date("2026-10-01T23:00:00Z"));
    expect(enviadas).toEqual([b.id, a.id]);
  });
});
