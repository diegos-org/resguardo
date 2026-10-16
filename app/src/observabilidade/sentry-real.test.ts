import * as Sentry from "@sentry/nextjs";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { avisarErroDoServidor } from "./aviso-do-servidor";
import { opcoesDoSentry } from "./sentry";

/**
 * M0.9: o pacote do Sentry de verdade (a parte do servidor), ligado com as nossas opções e um transporte falso que só
 * guarda o que seria enviado: nada vai para a rede. Confere que as opções valem de fato no pacote, e não só no papel
 * (a pessoa e o IP somem, os cabeçalhos ficam só com o navegador, os rastros do console não saem, os endereços e as
 * mensagens chegam limpos, a medição fica desligada). Os dados são fictícios.
 */
const enviados: string[] = [];

beforeAll(() => {
  const transport = (opcoes: Parameters<typeof Sentry.createTransport>[0]) =>
    Sentry.createTransport(opcoes, async (pedido) => {
      enviados.push(typeof pedido.body === "string" ? pedido.body : new TextDecoder().decode(pedido.body));
      return { statusCode: 200 };
    });
  const opcoes = opcoesDoSentry({ NEXT_PUBLIC_SENTRY_DSN: "https://chavepublicaficticia@o0.ingest.exemplo.io/0", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_SHA: "abc123" })!;
  Sentry.init({ ...opcoes, transport });
});
beforeEach(() => {
  enviados.length = 0;
});
afterAll(() => Sentry.close());

/** Os itens do único envelope enviado (o do erro: nenhuma sessão, medição ou relatório de envio). */
const unicoEnvio = () => {
  expect(enviados).toHaveLength(1);
  return enviados[0]
    .split("\n")
    .filter(Boolean)
    .map((linha) => JSON.parse(linha));
};

it("um erro do servidor sai limpo pelo pacote do Sentry, sem rede", async () => {
  Sentry.addBreadcrumb({ category: "console", message: "maria.silva@exemplo.com" });
  Sentry.addBreadcrumb({ category: "fetch", type: "http", data: { method: "GET", url: "/reservar/COT-ABCD2345?email=maria%40exemplo.com", status_code: 500 } });
  Sentry.setUser({ email: "maria.silva@exemplo.com", ip_address: "203.0.113.7" });
  Sentry.captureRequestError(
    new Error("Falha para maria.silva@exemplo.com, CPF 529.982.247-25"),
    {
      path: "/reservar/COT-ABCD2345?email=maria%40exemplo.com",
      method: "POST",
      headers: { cookie: "sessao=abc", "user-agent": "Mozilla/5.0 (iPhone)", "x-forwarded-for": "203.0.113.7", referer: "https://site.exemplo/convite/q3Zk1x9VbN0pLr7tYw2eHf5uJc8aMs4dGi6oPk1QwEr" },
    },
    { routerKind: "App Router", routePath: "/reservar/[codigo]", routeType: "render" },
  );
  await Sentry.flush(2000);

  const itens = unicoEnvio();
  const evento = itens.find((i) => i.exception);
  expect(evento.environment).toBe("preview");
  expect(evento.release).toBe("abc123");
  expect(evento.user).toBeUndefined();
  expect(evento.request).toEqual({ method: "POST", headers: { "user-agent": "Mozilla/5.0 (iPhone)" } });
  expect(evento.exception.values[0].value).toBe("Falha para [e-mail], CPF [CPF]");
  expect(evento.exception.values[0].stacktrace.frames.length).toBeGreaterThan(0);
  expect(evento.contexts.nextjs).toMatchObject({ request_path: "/reservar/[código]", router_path: "/reservar/[codigo]" });
  expect(evento.breadcrumbs).toEqual([expect.objectContaining({ category: "fetch", data: { method: "GET", status_code: 500, url: "/reservar/[código]" } })]);
  // Fora a pilha (que traz as linhas do código-fonte deste teste), nada pessoal no que sairia.
  for (const e of evento.exception.values) delete e.stacktrace;
  const tudo = JSON.stringify(itens);
  for (const valor of ["maria.silva@exemplo.com", "maria%40exemplo.com", "529.982.247-25", "203.0.113.7", "sessao=abc", "COT-ABCD2345", "q3Zk1x9VbN0pLr7tYw2eHf5uJc8aMs4dGi6oPk1QwEr"]) {
    expect(tudo, valor).not.toContain(valor);
  }
});

it("um objeto lançado no lugar de um erro sai sem o conteúdo (só os nomes dos campos)", async () => {
  Sentry.captureRequestError(
    { hospede: "Maria Silva", contato: "maria.silva@exemplo.com", tel: "+1 415 555 2671" } as unknown as Error,
    { path: "/api/x", method: "POST", headers: {} },
    { routerKind: "App Router", routePath: "/api/x", routeType: "route" },
  );
  await Sentry.flush(2000);
  const evento = unicoEnvio().find((i) => i.exception);
  expect(evento.extra.__serialized__).toBe("[omitido]");
  expect(evento.exception.values[0].value).toContain("hospede");
  const tudo = JSON.stringify(evento);
  for (const valor of ["Maria Silva", "maria.silva@exemplo.com", "+1 415 555 2671", "415 555 2671"]) expect(tudo, valor).not.toContain(valor);
});

it("o código do erro do Next (digest) chega como está, para achar o aviso pelo código da tela", async () => {
  Sentry.captureException(new Error("falhou ao montar a página"), { tags: { digest: "3353831296" } });
  await Sentry.flush(2000);
  expect(unicoEnvio().find((i) => i.exception).tags).toMatchObject({ digest: "3353831296" });
});

it("erro de uma rotina: vai com o nome da rotina e com a causa (o erro original), limpos", async () => {
  const causa = new Error("Falha ao gravar para maria.silva@exemplo.com");
  await avisarErroDoServidor(new Error("a rotina parou no meio; roda de novo em 10 minutos", { cause: causa }), "pedidos-site");
  const evento = unicoEnvio().find((i) => i.exception);
  expect(evento.tags).toMatchObject({ rotina: "pedidos-site" });
  const valores = evento.exception.values.map((e: { value: string }) => e.value);
  expect(valores).toEqual(expect.arrayContaining(["a rotina parou no meio; roda de novo em 10 minutos", "Falha ao gravar para [e-mail]"]));
  expect(JSON.stringify(evento)).not.toContain("maria.silva@exemplo.com");
});

it("sem medição de desempenho: o pacote não liga as integrações que instrumentam o banco", () => {
  const cliente = Sentry.getClient()!;
  for (const nome of ["Postgres", "PostgresJs", "Prisma"]) expect(cliente.getIntegrationByName(nome), nome).toBeUndefined();
  expect(cliente.getIntegrationByName("Http")).toBeDefined();
  expect(cliente.getIntegrationByName("LinkedErrors")).toBeDefined();
});
