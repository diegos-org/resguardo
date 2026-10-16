import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { politicaDaPaginaDePagamento } from "@/site/politica-de-frames";
import { INTEGRACOES_DESLIGADAS, opcoesDoSentry } from "./sentry";

/** M0.9: as opções do Sentry, por ambiente, e o que elas deixam (ou não) sair. O endereço de envio abaixo é fictício. */
const DSN = "https://chavepublicaficticia@o0.ingest.exemplo.io/0";

describe("quando o Sentry liga (M0.9)", () => {
  it("sem endereço de envio, nada liga, em nenhum ambiente", () => {
    for (const ambiente of ["production", "preview", "development", undefined]) {
      expect(opcoesDoSentry({ ambiente }), String(ambiente)).toBeNull();
      expect(opcoesDoSentry({ dsn: "", ambiente }), String(ambiente)).toBeNull();
      expect(opcoesDoSentry({ dsn: "   ", ambiente }), String(ambiente)).toBeNull();
    }
  });

  it("só na produção e nas prévias da Vercel; o desenvolvimento, os testes e um ambiente desconhecido nunca ligam", () => {
    expect(opcoesDoSentry({ dsn: DSN, ambiente: "production" })?.environment).toBe("production");
    expect(opcoesDoSentry({ dsn: DSN, ambiente: "preview" })?.environment).toBe("preview");
    for (const ambiente of ["development", "test", "", "Production", undefined]) expect(opcoesDoSentry({ dsn: DSN, ambiente }), String(ambiente)).toBeNull();
  });

  it("endereço de envio sem a forma de um DSN não liga (avisar em vez de supor)", () => {
    for (const dsn of ["http://chave@o0.ingest.exemplo.io/0", "https://o0.ingest.exemplo.io/0", "chave", "https://chave@o0.ingest.exemplo.io"]) {
      expect(opcoesDoSentry({ dsn, ambiente: "production" }), dsn).toBeNull();
    }
    expect(opcoesDoSentry({ dsn: `  ${DSN} `, ambiente: "production" })?.dsn).toBe(DSN);
  });

  it("a versão publicada vai junto quando existe", () => {
    expect(opcoesDoSentry({ dsn: DSN, ambiente: "production", versao: "abc123" })?.release).toBe("abc123");
    expect(opcoesDoSentry({ dsn: DSN, ambiente: "production", versao: "" })).not.toHaveProperty("release");
  });
});

describe("o que as opções deixam sair (M0.9)", () => {
  const opcoes = opcoesDoSentry({ dsn: DSN, ambiente: "production" })!;

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
    expect(opcoes.tracesSampleRate).toBe(0);
    // O sorteio da medição é sempre 0, mesmo quando o pedido chega dizendo que a medição já foi sorteada.
    expect(opcoes.tracesSampler()).toBe(0);
    expect(opcoes.tracePropagationTargets).toEqual([]);
    expect(opcoes.sendClientReports).toBe(false);
  });

  it("desliga desempenho, sessões, console e variáveis locais; não liga gravação de tela nem feedback", () => {
    const padrao = ["Breadcrumbs", "GlobalHandlers", "LinkedErrors", "Dedupe", "HttpContext", "BrowserTracing", "BrowserSession", "Console", "ProcessSession", "LocalVariablesAsync", "Http", "RequestData", "OnUncaughtException"].map((name) => ({ name }));
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
    for (const arquivo of ["src/observabilidade/sentry.ts", "src/observabilidade/limpeza.ts", "src/observabilidade/aviso-de-erro.ts", "src/instrumentation.ts", "src/instrumentation-client.ts", "next.config.ts"]) {
      expect(readFileSync(join(app, arquivo), "utf8"), arquivo).not.toMatch(/sentry\.io|ingest\.us/);
    }
  });
});
