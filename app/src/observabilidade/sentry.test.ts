import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { politicaDaPaginaDePagamento } from "@/site/politica-de-frames";
import { ambienteDoSentry, avisoDoSentryDesligado, INTEGRACOES_DESLIGADAS, opcoesDoSentry, situacaoDoSentry } from "./sentry";

/** M0.9: as opções do Sentry, por ambiente, e o que elas deixam (ou não) sair. O endereço de envio abaixo é fictício. */
const DSN = "https://chavepublicaficticia@o0.ingest.exemplo.io/0";
const PRODUCAO = { NEXT_PUBLIC_SENTRY_DSN: DSN, VERCEL_ENV: "production" };

describe("quando o Sentry liga (M0.9)", () => {
  it("sem endereço de envio, nada liga, em nenhum ambiente", () => {
    for (const VERCEL_ENV of ["production", "preview", "development", undefined]) {
      for (const NEXT_PUBLIC_SENTRY_DSN of [undefined, "", "   "]) {
        expect(opcoesDoSentry({ NEXT_PUBLIC_SENTRY_DSN, VERCEL_ENV }), String(VERCEL_ENV)).toBeNull();
        expect(situacaoDoSentry({ NEXT_PUBLIC_SENTRY_DSN, VERCEL_ENV })).toBe("sem_endereco");
      }
    }
  });

  it("só no deploy de produção e nas prévias da Vercel, pela regra única de sistema/ambiente.ts; o resto nunca liga", () => {
    expect(opcoesDoSentry(PRODUCAO)?.environment).toBe("production");
    expect(opcoesDoSentry({ ...PRODUCAO, VERCEL_ENV: " production " })?.environment).toBe("production");
    expect(opcoesDoSentry({ ...PRODUCAO, VERCEL_ENV: "preview" })?.environment).toBe("preview");
    for (const VERCEL_ENV of ["development", "test", "", "Production", "outro", undefined]) {
      for (const NODE_ENV of ["production", "development", "test"]) {
        const env = { NEXT_PUBLIC_SENTRY_DSN: DSN, VERCEL_ENV, NODE_ENV };
        expect(opcoesDoSentry(env), `${VERCEL_ENV} ${NODE_ENV}`).toBeNull();
        expect(ambienteDoSentry(env)).toBeNull();
        expect(situacaoDoSentry(env)).toBe("fora_do_ambiente");
      }
    }
  });

  it("endereço de envio sem a forma de um DSN (ou com o projeto que não é número) não liga e é avisado, sem repetir o valor", () => {
    const estranhos = [
      "http://chave@o0.ingest.exemplo.io/0",
      "https://o0.ingest.exemplo.io/0",
      "valorqualquer",
      "https://chave@o0.ingest.exemplo.io",
      "https://chave@o0.ingest.exemplo.io/abc",
      `"${DSN}"`,
    ];
    for (const dsn of estranhos) {
      const env = { ...PRODUCAO, NEXT_PUBLIC_SENTRY_DSN: dsn };
      expect(opcoesDoSentry(env), dsn).toBeNull();
      expect(situacaoDoSentry(env), dsn).toBe("endereco_invalido");
      const aviso = avisoDoSentryDesligado(env);
      expect(aviso, dsn).toContain("NEXT_PUBLIC_SENTRY_DSN não tem a forma de um endereço de envio do Sentry");
      expect(aviso).not.toContain(dsn);
    }
    // Fora da produção e das prévias, e com o endereço certo, nada a avisar no registro.
    expect(avisoDoSentryDesligado({ NEXT_PUBLIC_SENTRY_DSN: "valorqualquer", VERCEL_ENV: "development" })).toBeNull();
    expect(avisoDoSentryDesligado(PRODUCAO)).toBeNull();
    expect(avisoDoSentryDesligado({ VERCEL_ENV: "production" })).toBeNull();
    // Com porta e caminho antes do projeto, como o pacote aceita.
    expect(opcoesDoSentry({ ...PRODUCAO, NEXT_PUBLIC_SENTRY_DSN: "https://chave@sentry.exemplo.io:9000/caminho/42" })?.dsn).toBe("https://chave@sentry.exemplo.io:9000/caminho/42");
    expect(opcoesDoSentry({ ...PRODUCAO, NEXT_PUBLIC_SENTRY_DSN: `  ${DSN} ` })?.dsn).toBe(DSN);
  });

  it("a versão publicada vai junto quando existe", () => {
    expect(opcoesDoSentry({ ...PRODUCAO, VERCEL_GIT_COMMIT_SHA: "abc123" })?.release).toBe("abc123");
    expect(opcoesDoSentry({ ...PRODUCAO, VERCEL_GIT_COMMIT_SHA: "" })).not.toHaveProperty("release");
  });
});

describe("o que as opções deixam sair (M0.9)", () => {
  const opcoes = opcoesDoSentry(PRODUCAO)!;

  it("nada da pessoa (nem o IP), cookies, cabeçalhos além do navegador, corpos, parâmetros, consultas ao banco ou variáveis", () => {
    expect(opcoes.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ["user-agent"] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    });
  });

  it("sem medição de desempenho, sem cabeçalhos do Sentry nas chamadas a outros serviços e sem relatórios de envio", () => {
    // Nem 0: qualquer uma das duas opções liga no pacote o modo de medição (e as integrações que instrumentam o banco).
    expect(opcoes).not.toHaveProperty("tracesSampleRate");
    expect(opcoes).not.toHaveProperty("tracesSampler");
    expect(opcoes.tracePropagationTargets).toEqual([]);
    expect(opcoes.sendClientReports).toBe(false);
  });

  it("desliga desempenho, sessões, console, variáveis locais e o idioma e o fuso do aparelho; não liga gravação de tela nem feedback", () => {
    const padrao = ["Breadcrumbs", "GlobalHandlers", "LinkedErrors", "Dedupe", "HttpContext", "CultureContext", "BrowserTracing", "BrowserSession", "Console", "ProcessSession", "LocalVariablesAsync", "Http", "RequestData", "OnUncaughtException"].map((name) => ({ name }));
    expect(opcoes.integrations(padrao).map((i) => i.name)).toEqual(["Breadcrumbs", "GlobalHandlers", "LinkedErrors", "Dedupe", "HttpContext", "Http", "RequestData", "OnUncaughtException"]);
    for (const nome of ["Replay", "ReplayCanvas", "Feedback", "BrowserTracing", "BrowserSession"]) expect(INTEGRACOES_DESLIGADAS).toContain(nome);
  });

  it("cada aviso e cada rastro passam pela limpeza antes de sair", () => {
    const evento = { type: undefined, user: { email: "maria@exemplo.com" }, message: "Falha para maria@exemplo.com" } as ErrorEvent;
    expect(opcoes.beforeSend(evento)).toEqual({ type: undefined, message: "Falha para [e-mail]" });
    expect(opcoes.beforeBreadcrumb({ category: "console", message: "qualquer coisa" })).toBeNull();
    expect(opcoes.beforeBreadcrumb({ category: "navigation", data: { to: "/reservar/COT-ABCD2345" } })).toEqual({ category: "navigation", data: { to: "/reservar/[código]" } });
  });
});

describe("ligação com o resto do sistema (M0.9)", () => {
  it("a página do pagamento não limita para onde envia (sem connect-src nem default-src): o aviso do navegador chega ao Sentry sem afrouxar nada", () => {
    // Se esta regra mudar, a política precisa incluir a origem do NEXT_PUBLIC_SENTRY_DSN e os domínios do Mercado Pago.
    expect(politicaDaPaginaDePagamento()).not.toMatch(/(^|;)\s*(connect-src|default-src)\b/);
  });

  it("o endereço de envio de verdade não fica no código: vem só da variável NEXT_PUBLIC_SENTRY_DSN", () => {
    const app = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
    for (const arquivo of ["src/observabilidade/sentry.ts", "src/observabilidade/limpeza.ts", "src/observabilidade/aviso-de-erro.ts", "src/observabilidade/aviso-do-servidor.ts", "src/instrumentation.ts", "src/instrumentation-client.ts", "next.config.ts"]) {
      expect(readFileSync(join(app, arquivo), "utf8"), arquivo).not.toMatch(/sentry\.io|ingest\.us/);
    }
  });
});

describe("o pacote na publicação (M0.9)", () => {
  it("o next.config.ts tira do pacote a parte de medição e as mensagens de depuração (booleanos, como o pacote espera)", async () => {
    const { default: config } = await import("../../next.config");
    expect(config.compiler?.define).toEqual({ __SENTRY_TRACING__: false, __SENTRY_DEBUG__: false });
  });
});
