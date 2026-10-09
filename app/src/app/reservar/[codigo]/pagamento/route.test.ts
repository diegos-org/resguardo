import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { COOKIE_CHECKOUT, emitirAutorizacao, validadeDaAutorizacao } from "@/pagamentos/autorizacao";
import { AGORA, type Cenario, EMAIL_HOSPEDE, minutos, montarCenario } from "@/pagamentos/testes";

const m = vi.hoisted(() => ({ db: null as unknown as Db, org: "" as string | null }));
vi.mock("@/db/client", () => ({ getDb: () => m.db }));
vi.mock("@/site/site", async (orig) => ({ ...(await orig<typeof import("@/site/site")>()), organizacaoDoSite: async () => m.org }));
const { GET } = await import("./route");

let db: Db, close: () => Promise<void>, c: Cenario;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  vi.useFakeTimers({ now: AGORA, toFake: ["Date"] });
  vi.stubEnv("AUTH_SECRET", "segredo-de-teste-ficticio");
  c = await montarCenario(db);
  m.db = db;
  m.org = c.org;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const pedir = (codigo: string, cabecalhos: Record<string, string> = {}) =>
  GET(new NextRequest(`http://localhost/reservar/${codigo}/pagamento`, { headers: { "x-real-ip": "203.0.113.70", ...cabecalhos } }), { params: Promise.resolve({ codigo }) });

it("GET /reservar/<código>/pagamento: lê o cookie do pedido (QR só com ele), sem cache, nada pessoal", async () => {
  const s = await c.segurar();
  await c.pix(s.cotacaoId);
  vi.setSystemTime(minutos(1));
  const sem = await pedir(s.codigo);
  expect(sem.status).toBe(200);
  expect(sem.headers.get("Cache-Control")).toBe("no-store");
  expect(await sem.json()).toMatchObject({ estado: "pix_aguardando", pix: null });
  const token = emitirAutorizacao(s.cotacaoId, validadeDaAutorizacao(minutos(30), AGORA));
  const com = await pedir(s.codigo, { cookie: `${COOKIE_CHECKOUT}=${token}` });
  const corpo = await com.text();
  expect(JSON.parse(corpo)).toMatchObject({ estado: "pix_aguardando", pix: { copiaECola: expect.any(String) } });
  expect(corpo).not.toContain(EMAIL_HOSPEDE);
  expect(corpo).not.toContain("Visitante");
});

it("código inválido ou malformado: 400 sem cache; site sem organização: 404", async () => {
  for (const codigo of ["nada", "%E0%A4%A", "COT-ABC"]) {
    const r = await pedir(codigo);
    expect(r.status).toBe(400);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  }
  m.org = null;
  expect((await pedir("COT-ABCDEFGH")).status).toBe(404);
});
