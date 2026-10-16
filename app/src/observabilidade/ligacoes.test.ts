import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M0.9: as ligações finas com o Next (src/instrumentation.ts no servidor, src/instrumentation-client.ts no navegador)
 * só chamam o Sentry com as opções de src/observabilidade/sentry.ts. O pacote do Sentry é falso aqui: nada sai.
 */
const m = vi.hoisted(() => ({ init: vi.fn(), captureRequestError: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ init: m.init, captureRequestError: m.captureRequestError }));

const DSN = "https://chavepublicaficticia@o0.ingest.exemplo.io/0";

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  for (const v of ["NEXT_PUBLIC_SENTRY_DSN", "VERCEL_ENV", "NEXT_PUBLIC_VERCEL_ENV", "VERCEL_GIT_COMMIT_SHA", "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA", "NEXT_RUNTIME"]) vi.stubEnv(v, "");
});
afterEach(() => vi.unstubAllEnvs());

describe("servidor: src/instrumentation.ts", () => {
  it("liga no Node e no Edge, com o ambiente e a versão da Vercel", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abc123");
    for (const runtime of ["nodejs", "edge"]) {
      vi.stubEnv("NEXT_RUNTIME", runtime);
      const { register } = await import("../instrumentation");
      register();
    }
    expect(m.init).toHaveBeenCalledTimes(2);
    expect(m.init.mock.calls[0][0]).toMatchObject({ dsn: DSN, environment: "production", release: "abc123" });
    expect(m.init.mock.calls[0][0]).not.toHaveProperty("tracesSampleRate");
  });

  it("não liga sem o endereço de envio, no desenvolvimento nem fora do Node e do Edge", async () => {
    const { register } = await import("../instrumentation");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("VERCEL_ENV", "production");
    register();
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    vi.stubEnv("VERCEL_ENV", "development");
    register();
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_RUNTIME", "");
    register();
    expect(m.init).not.toHaveBeenCalled();
  });

  it("endereço de envio estranho na produção ou numa prévia: não liga e deixa um aviso no registro, sem o valor", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { register } = await import("../instrumentation");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://chave@o0.ingest.exemplo.io/xyzzy");
    for (const ambiente of ["production", "preview"]) {
      vi.stubEnv("VERCEL_ENV", ambiente);
      register();
    }
    // No desenvolvimento, nada a avisar; sem endereço, também não (é só desligado).
    vi.stubEnv("VERCEL_ENV", "development");
    register();
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    register();
    expect(m.init).not.toHaveBeenCalled();
    expect(aviso).toHaveBeenCalledTimes(2);
    expect(String(aviso.mock.calls[0][0])).toContain("NEXT_PUBLIC_SENTRY_DSN não tem a forma de um endereço de envio do Sentry");
    expect(String(aviso.mock.calls[0][0])).not.toMatch(/xyzzy|o0\.ingest/);
    aviso.mockRestore();
  });

  it("os erros que o Next captura vão para o Sentry pela função do próprio pacote", async () => {
    const { onRequestError } = await import("../instrumentation");
    expect(onRequestError).toBe(m.captureRequestError);
  });
});

describe("navegador: src/instrumentation-client.ts", () => {
  it("liga com as variáveis públicas, na prévia", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "preview");
    await import("../instrumentation-client");
    expect(m.init).toHaveBeenCalledTimes(1);
    expect(m.init.mock.calls[0][0]).toMatchObject({ dsn: DSN, environment: "preview" });
  });

  it("não liga sem o endereço de envio nem no desenvolvimento", async () => {
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "production");
    await import("../instrumentation-client");
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "development");
    await import("../instrumentation-client");
    expect(m.init).not.toHaveBeenCalled();
  });
});
