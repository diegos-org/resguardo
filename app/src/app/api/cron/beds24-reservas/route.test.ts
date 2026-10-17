/**
 * A rota da rotina das reservas do site no Beds24 (M8.3c, desenho 9; plano, teste 34): o segredo antes de tudo, o 403 fora do
 * deploy de produção (inclusive sem VERCEL_ENV) e o 500 sem expor o erro. A rotina é falsa aqui: nada lê nem escreve no Beds24.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ db: vi.fn(), executar: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: m.db }));
vi.mock("@/beds24/cron-reservas", () => ({ executarCronReservasBeds24: m.executar }));
import { GET } from "./route";
const req = (token?: string) => new Request("https://example.com/api/cron/beds24-reservas", { headers: token ? { authorization: `Bearer ${token}` } : {} });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CRON_SECRET", "cron-teste");
  vi.stubEnv("VERCEL_ENV", "production");
});
afterEach(() => vi.unstubAllEnvs());

it("exige segredo configurado e correto antes de acessar o banco", async () => {
  expect((await GET(req())).status).toBe(401);
  expect((await GET(req("errado"))).status).toBe(401);
  vi.stubEnv("CRON_SECRET", "");
  expect((await GET(req())).status).toBe(401);
  expect(m.db).not.toHaveBeenCalled();
  expect(m.executar).not.toHaveBeenCalled();
});

it("recusa fora do deploy de produção: a prévia, o vercel dev e também sem VERCEL_ENV", async () => {
  for (const valor of ["preview", "development", ""]) {
    vi.stubEnv("VERCEL_ENV", valor);
    expect((await GET(req("cron-teste"))).status).toBe(403);
  }
  vi.stubEnv("VERCEL_ENV", undefined);
  expect((await GET(req("cron-teste"))).status).toBe(403);
  expect(m.db).not.toHaveBeenCalled();
  expect(m.executar).not.toHaveBeenCalled();
});

it("executa no deploy de produção, com o cliente e o leitor que as fábricas dão (nenhum, nos testes), e falha sem expor o erro", async () => {
  expect((await GET(req("cron-teste"))).status).toBe(200);
  expect(m.executar).toHaveBeenCalledOnce();
  // As fábricas exigem o processo de produção de verdade: no Vitest, nenhum cliente HTTP nasce.
  expect(m.executar.mock.calls[0][2]).toMatchObject({ cliente: null, leitor: null });
  m.executar.mockRejectedValue(new Error("SEGREDO"));
  const r = await GET(req("cron-teste"));
  expect(r.status).toBe(500);
  expect(await r.json()).toEqual({ ok: false });
});
