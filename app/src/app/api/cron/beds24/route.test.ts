import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ db: vi.fn(), executar: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: m.db }));
vi.mock("@/beds24/cron", () => ({ executarCronBeds24: m.executar }));
import { GET } from "./route";
const req = (token?: string) => new Request("https://example.com/api/cron/beds24", { headers: token ? { authorization: `Bearer ${token}` } : {} });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("CRON_SECRET", "cron-teste"); vi.stubEnv("VERCEL_ENV", "production"); });
afterEach(() => vi.unstubAllEnvs());
it("exige segredo configurado e correto antes de acessar o banco", async () => {
  expect((await GET(req())).status).toBe(401);
  expect((await GET(req("errado"))).status).toBe(401);
  vi.stubEnv("CRON_SECRET", "");
  expect((await GET(req())).status).toBe(401);
  expect(m.db).not.toHaveBeenCalled();
  expect(m.executar).not.toHaveBeenCalled();
});
it("recusa execução agendada na preview", async () => {
  vi.stubEnv("VERCEL_ENV", "preview");
  expect((await GET(req("cron-teste"))).status).toBe(403);
  expect(m.db).not.toHaveBeenCalled();
});
it("executa em produção e falha sem expor o erro", async () => {
  expect((await GET(req("cron-teste"))).status).toBe(200);
  expect(m.executar).toHaveBeenCalledOnce();
  m.executar.mockRejectedValue(new Error("SEGREDO"));
  const r = await GET(req("cron-teste"));
  expect(r.status).toBe(500);
  expect(await r.json()).toEqual({ ok: false });
});
