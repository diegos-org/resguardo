import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ db: vi.fn(), rotina: vi.fn(), gate: vi.fn(), registrar: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: m.db }));
vi.mock("@/pagamentos/rotina", () => ({ rotinaDoSite: m.rotina }));
vi.mock("@/pagamentos/oferta", () => ({ provedorDeConferencia: m.gate }));
vi.mock("@/sistema/automacoes", () => ({ registrarExecucao: m.registrar }));
import { GET } from "./route";
const req = (token?: string) => new Request("https://example.com/api/cron/cotacoes", { headers: token ? { authorization: `Bearer ${token}` } : {} });
const holds = { expiradas: 2, convertidas: 1, canceladas: 0, removidas: 3 };
const pagamentos = { conferidas: 4, mudaram: 1, devolucoes: 0, canceladas: 0, falhas: 1 };
const provedor = { nome: "falso" };
let resumos: string[];
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CRON_SECRET", "cron-teste");
  vi.stubEnv("VERCEL_ENV", "production");
  m.db.mockReturnValue({ banco: true });
  resumos = [];
  // Como a de verdade: roda a função e guarda o resumo; o erro sobe.
  m.registrar.mockImplementation(async (_db: unknown, _nome: string, fn: () => Promise<string>) => {
    const r = await fn();
    resumos.push(r);
    return r;
  });
});
afterEach(() => vi.unstubAllEnvs());

it("exige segredo configurado e correto antes de acessar o banco", async () => {
  expect((await GET(req())).status).toBe(401);
  expect((await GET(req("errado"))).status).toBe(401);
  vi.stubEnv("CRON_SECRET", "");
  expect((await GET(req())).status).toBe(401);
  expect(m.db).not.toHaveBeenCalled();
  expect(m.rotina).not.toHaveBeenCalled();
});

it("recusa execução agendada na preview", async () => {
  vi.stubEnv("VERCEL_ENV", "preview");
  expect((await GET(req("cron-teste"))).status).toBe(403);
  expect(m.db).not.toHaveBeenCalled();
});

it("com o provedor de conferência: confere os pagamentos e vence os holds de todas as empresas, registrado em Sistema", async () => {
  m.gate.mockResolvedValue({ ok: true, provedor, ambiente: "teste" });
  m.rotina.mockResolvedValue({ pagamentos, holds });
  const r = await GET(req("cron-teste"));
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ ok: true, resumo: holds, pagamentos });
  expect(m.rotina).toHaveBeenCalledWith({ banco: true }, provedor, expect.any(Date));
  expect(m.registrar).toHaveBeenCalledWith({ banco: true }, "pedidos-site", expect.any(Function));
  expect(resumos[0]).toBe("Pagamentos: 4 conferido(s), 1 com mudança, 0 devolução(ões) confirmada(s), 0 Pix cancelado(s), 1 falha(s) · Pedidos: 2 vencido(s), 1 confirmado(s), 0 cancelado(s)");
});

it("hold que não deu para fechar aparece no resumo (a rotina segue com os outros)", async () => {
  m.gate.mockResolvedValue({ ok: false, motivo: "so_nas_previas", texto: "nas prévias" });
  m.rotina.mockResolvedValue({ pagamentos: null, holds: { ...holds, falhas: 1 }, eventosApagados: 0 });
  await GET(req("cron-teste"));
  expect(resumos[0]).toContain("Pedidos: 2 vencido(s), 1 confirmado(s), 0 cancelado(s), 1 não fechado(s) nesta volta");
});

it("M8.2d: as alterações com as datas seguradas vencidas entram no resumo (só com alguma vencida)", async () => {
  m.gate.mockResolvedValue({ ok: false, motivo: "so_nas_previas", texto: "nas prévias" });
  m.rotina.mockResolvedValue({ pagamentos: null, holds, alteracoes: { expiradas: 2, falhas: 0, puladas: 0 }, eventosApagados: 0 });
  await GET(req("cron-teste"));
  expect(resumos[0]).toBe("Pagamentos: não conferidos neste ambiente (o teste roda nas prévias) · Pedidos: 2 vencido(s), 1 confirmado(s), 0 cancelado(s) · Alterações: 2 vencida(s)");
  m.rotina.mockResolvedValue({ pagamentos: null, holds, alteracoes: { expiradas: 0, falhas: 0, puladas: 0 }, eventosApagados: 0 });
  await GET(req("cron-teste"));
  expect(resumos[1]).not.toContain("Alterações");
});

it("sem provedor (deploy de produção): só vence os holds", async () => {
  m.gate.mockResolvedValue({ ok: false, motivo: "so_nas_previas", texto: "nas prévias" });
  m.rotina.mockResolvedValue({ pagamentos: null, holds });
  const r = await GET(req("cron-teste"));
  expect(await r.json()).toEqual({ ok: true, resumo: holds, pagamentos: null });
  expect(m.rotina).toHaveBeenCalledWith({ banco: true }, null, expect.any(Date));
  expect(resumos[0]).toContain("não conferidos neste ambiente");
});

it("falha sem expor o erro (nem na resposta nem no resumo de Sistema)", async () => {
  m.gate.mockResolvedValue({ ok: false, motivo: "desligado", texto: "" });
  m.rotina.mockRejectedValue(new Error("SEGREDO"));
  let erro: unknown;
  m.registrar.mockImplementation(async (_db: unknown, _nome: string, fn: () => Promise<string>) => {
    try {
      return await fn();
    } catch (e) {
      erro = e;
      throw e;
    }
  });
  const f = await GET(req("cron-teste"));
  expect(f.status).toBe(500);
  expect(await f.json()).toEqual({ ok: false });
  expect(String(erro)).not.toContain("SEGREDO");
});
