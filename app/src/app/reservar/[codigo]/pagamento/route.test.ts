import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { emitirAutorizacao, validadeDaAutorizacao } from "@/pagamentos/autorizacao";
import { AGORA, alterar, type Cenario, EMAIL_HOSPEDE, minutos, montarCenario, pagarEConfirmar, usuarioDeTeste } from "@/pagamentos/testes";
import { nomeDoCookieDoPedido } from "@/site/checkout";

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
  const com = await pedir(s.codigo, { cookie: `${nomeDoCookieDoPedido(s.cotacaoId)}=${token}` });
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

it("M8.2d: a rota traz a alteração e o pagamento da diferença (a página acompanha os dois); nada pessoal nem Beds24", async () => {
  const x = await pagarEConfirmar(c, { liberar: true });
  const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: await usuarioDeTeste(c) });
  if (!resultado.ok) throw new Error(resultado.erro);
  vi.setSystemTime(minutos(21));
  const r = await pedir(x.codigo);
  expect(r.status).toBe(200);
  const j = await r.json();
  // Sem as chaves do Mercado Pago no ambiente do teste, o portão da rota fica fechado: a diferença não é oferecida agora
  // (a oferta é a de `vistaDoPagamento`, testada no domínio), mas a alteração e o pagamento dela vêm para a página acompanhar.
  expect(j).toMatchObject({ estado: "confirmada", alteracao: { id: resultado.alteracaoId, situacao: "segurada", rumo: "aumento", diferenca: 52800, pagamento: { estado: "sem_pagamento", podeGerar: false } } });
  const texto = JSON.stringify(j);
  expect(texto).not.toContain(EMAIL_HOSPEDE);
  expect(texto).not.toMatch(/beds24/i);
});
