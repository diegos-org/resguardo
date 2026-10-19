/**
 * A rota da rotina do WhatsApp (M10.1a, desenho 4.6): o segredo do agendador, só no deploy de produção, o registro em
 * Sistema com o resumo e o erro ao Sentry com o nome da rotina, sem a mensagem. A rotina é simulada; o Sentry é falso.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ db: vi.fn(), rotina: vi.fn(), registrar: vi.fn(), captureException: vi.fn(), flush: vi.fn(async () => true) }));
vi.mock("@/db/client", () => ({ getDb: m.db }));
vi.mock("@/whatsapp/cron", () => ({ rotinaWhatsapp: m.rotina }));
vi.mock("@/sistema/automacoes", () => ({ registrarExecucao: m.registrar }));
vi.mock("@/email/correio", () => ({ correioDoAmbiente: () => null }));
vi.mock("@sentry/nextjs", () => ({ captureException: m.captureException, flush: m.flush }));
import { ErroDeRotina, MENSAGEM_OMITIDA } from "@/observabilidade/erro-de-rotina";
import { CANARIOS } from "@/whatsapp/testes";
import { GET } from "./route";

const req = (token?: string) => new Request("https://example.com/api/cron/whatsapp", { headers: token ? { authorization: `Bearer ${token}` } : {} });
const RESUMO = "2 aviso(s) antigo(s) apagado(s); 1 e-mail(s) da conta enviado(s); 0 falhou(aram); 0 sem e-mail da empresa; 0 sem o e-mail do sistema";
/** O erro e as causas encadeadas: tudo o que o Sentry lê. */
const cadeia = (e: unknown): Error[] => (e instanceof Error ? [e, ...cadeia(e.cause)] : []);
let resumos: string[];
let erros: unknown[];

beforeEach(() => {
  vi.resetAllMocks();
  m.flush.mockResolvedValue(true);
  vi.stubEnv("CRON_SECRET", "cron-teste");
  vi.stubEnv("VERCEL_ENV", "production");
  m.db.mockReturnValue({ banco: true });
  resumos = [];
  erros = [];
  // Como a de verdade: roda a função e guarda o resumo (ou o "Falhou: <mensagem>"); o erro sobe.
  m.registrar.mockImplementation(async (_db: unknown, _nome: string, fn: () => Promise<string>) => {
    try {
      const r = await fn();
      resumos.push(r);
      return r;
    } catch (e) {
      erros.push(e);
      resumos.push(`Falhou: ${(e as Error).message}`);
      throw e;
    }
  });
});
afterEach(() => vi.unstubAllEnvs());

it("exige o segredo do agendador antes de acessar o banco", async () => {
  expect((await GET(req())).status).toBe(401);
  expect((await GET(req("errado"))).status).toBe(401);
  vi.stubEnv("CRON_SECRET", "");
  expect((await GET(req("cron-teste"))).status).toBe(401);
  expect(m.db).not.toHaveBeenCalled();
  expect(m.rotina).not.toHaveBeenCalled();
});

it("fora do deploy de produção não roda (prévia, desenvolvimento ou sem VERCEL_ENV)", async () => {
  for (const ambiente of ["preview", "development", ""]) {
    vi.stubEnv("VERCEL_ENV", ambiente);
    expect((await GET(req("cron-teste"))).status, ambiente).toBe(403);
  }
  expect(m.db).not.toHaveBeenCalled();
  expect(m.rotina).not.toHaveBeenCalled();
});

it("roda a rotina registrada em Sistema como \"whatsapp\", com o resumo só de números", async () => {
  m.rotina.mockResolvedValue(RESUMO);
  const r = await GET(req("cron-teste"));
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ ok: true, resumo: RESUMO });
  expect(m.registrar).toHaveBeenCalledWith({ banco: true }, "whatsapp", expect.any(Function));
  expect(m.rotina).toHaveBeenCalledWith({ banco: true }, null, expect.any(Date));
  expect(resumos).toEqual([RESUMO]);
  expect(m.captureException).not.toHaveBeenCalled();
});

it("e-mail que falhou: 500, e o Sentry recebe só as contagens com a rotina whatsapp", async () => {
  m.rotina.mockRejectedValue(new ErroDeRotina(RESUMO.replace("0 falhou", "1 falhou"), { email_nao_enviado: 1 }));
  const r = await GET(req("cron-teste"));
  expect(r.status).toBe(500);
  expect(await r.json()).toEqual({ ok: false });
  expect(m.captureException).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: "ErroDeRotina", message: "1 e-mail(s) não enviado(s) (detalhe na página Sistema)" }), { tags: { rotina: "whatsapp" } });
  expect(m.flush).toHaveBeenCalledWith(2000);
});

it("erro inesperado (o banco, com um telefone na mensagem): Sistema fica com um texto fixo e o Sentry com o tipo e o código, sem a mensagem", async () => {
  m.rotina.mockRejectedValue(Object.assign(new Error(`Failed query: select ... params: ${CANARIOS.waIdBr}`), { code: "22P02" }));
  const r = await GET(req("cron-teste"));
  expect(r.status).toBe(500);
  expect(resumos).toEqual(["Falhou: a rotina parou no meio; roda de novo na próxima hora"]);
  const [erro, contexto] = m.captureException.mock.calls[0] as unknown as [Error, unknown];
  expect(contexto).toEqual({ tags: { rotina: "whatsapp" } });
  expect(cadeia(erro).map((e) => e.message)).toEqual(["1 rotina interrompida no meio (detalhe na página Sistema)", `${MENSAGEM_OMITIDA}; código 22P02`]);
  expect(JSON.stringify(cadeia(erro).map((e) => [e.name, e.message, e.stack]))).not.toContain(CANARIOS.waIdBr);
  expect(JSON.stringify(resumos)).not.toContain(CANARIOS.waIdBr);
});
