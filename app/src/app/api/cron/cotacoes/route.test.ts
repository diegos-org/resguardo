import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ db: vi.fn(), expirar: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: m.db }));
vi.mock("@/site/cotacoes", () => ({ expirarHoldsVencidos: m.expirar }));
import { GET } from "./route";
const req = (token?: string) => new Request("https://example.com/api/cron/cotacoes", { headers: token ? { authorization: `Bearer ${token}` } : {} });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("CRON_SECRET", "cron-teste"); vi.stubEnv("VERCEL_ENV", "production"); });
afterEach(() => vi.unstubAllEnvs());
it("exige segredo configurado e correto antes de acessar o banco", async () => {
  expect((await GET(req())).status).toBe(401);
  expect((await GET(req("errado"))).status).toBe(401);
  vi.stubEnv("CRON_SECRET", "");
  expect((await GET(req())).status).toBe(401);
  expect(m.db).not.toHaveBeenCalled();
  expect(m.expirar).not.toHaveBeenCalled();
});
it("recusa execução agendada na preview", async () => {
  vi.stubEnv("VERCEL_ENV", "preview");
  expect((await GET(req("cron-teste"))).status).toBe(403);
  expect(m.db).not.toHaveBeenCalled();
});
it("vence os holds de todas as empresas e falha sem expor o erro", async () => {
  m.expirar.mockResolvedValue({ expiradas: 2, convertidas: 1, canceladas: 0 });
  const r = await GET(req("cron-teste"));
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ ok: true, resumo: { expiradas: 2, convertidas: 1, canceladas: 0 } });
  expect(m.expirar).toHaveBeenCalledWith(undefined, null, expect.any(Date));
  m.expirar.mockRejectedValue(new Error("SEGREDO"));
  const f = await GET(req("cron-teste"));
  expect(f.status).toBe(500);
  expect(await f.json()).toEqual({ ok: false });
});
