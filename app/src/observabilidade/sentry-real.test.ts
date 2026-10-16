import * as Sentry from "@sentry/nextjs";
import { afterAll, expect, it } from "vitest";
import { opcoesDoSentry } from "./sentry";

/**
 * M0.9: o pacote do Sentry de verdade (a parte do servidor), ligado com as nossas opções e um transporte falso que só
 * guarda o que seria enviado: nada vai para a rede. Confere que as opções valem de fato no pacote, e não só no papel
 * (a pessoa e o IP somem, os cabeçalhos ficam só com o navegador, os rastros do console não saem, os endereços e as
 * mensagens chegam limpos). Os dados são fictícios.
 */
afterAll(() => Sentry.close());

it("um erro do servidor sai limpo pelo pacote do Sentry, sem rede", async () => {
  const enviados: string[] = [];
  const transport = (opcoes: Parameters<typeof Sentry.createTransport>[0]) =>
    Sentry.createTransport(opcoes, async (pedido) => {
      enviados.push(typeof pedido.body === "string" ? pedido.body : new TextDecoder().decode(pedido.body));
      return { statusCode: 200 };
    });
  const opcoes = opcoesDoSentry({ dsn: "https://chavepublicaficticia@o0.ingest.exemplo.io/0", ambiente: "preview", versao: "abc123" })!;
  Sentry.init({ ...opcoes, transport });

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

  // Um envelope só: o do erro (nenhuma sessão, medição ou relatório de envio).
  expect(enviados).toHaveLength(1);
  const itens = enviados[0].split("\n").filter(Boolean).map((linha) => JSON.parse(linha));
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
