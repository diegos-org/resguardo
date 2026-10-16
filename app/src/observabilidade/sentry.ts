/**
 * Avisos de erro do sistema pelo Sentry (M0.9), num lugar só: as opções do `Sentry.init`, usadas igual no servidor
 * (`src/instrumentation.ts`, Node e Edge) e no navegador (`src/instrumentation-client.ts`). Função pura: não carrega o
 * pacote do Sentry nem lê o ambiente sozinha; quem chama passa as variáveis.
 *
 * Liga só com as duas coisas: o endereço de envio (`NEXT_PUBLIC_SENTRY_DSN`, a mesma variável nos dois lados; é um
 * endereço público, não um segredo) e um ambiente da Vercel que seja `production` ou `preview` (as prévias ficam
 * separadas no Sentry). Sem o endereço, ou no desenvolvimento e nos testes, devolve `null`: nada é ligado nem enviado.
 *
 * Privacidade (condição de Diego em 16/10/2026: nada de nome, e-mail ou dado de pagamento):
 * - `dataCollection` (a opção da versão 11 do pacote; a antiga `sendDefaultPii` não existe mais nela): nada da pessoa
 *   (o que também impede o Sentry de guardar o IP de quem usa o site), nem cookies, cabeçalhos (menos o User-Agent,
 *   para mostrar navegador e aparelho), corpo das requisições, parâmetros de busca, dados de consultas ao banco ou
 *   variáveis locais;
 * - sem medição de desempenho (`tracesSampleRate: 0`, e `tracesSampler` sempre 0, para um pedido que chegue com o
 *   cabeçalho de rastreio do Sentry também não ligar a medição), sem cabeçalhos do Sentry nas chamadas
 *   a outros serviços (`tracePropagationTargets: []`), sem gravação de tela (Replay), sem formulário de feedback, sem
 *   contagem de sessões e sem relatórios de envio: o Sentry só recebe algo quando acontece um erro;
 * - e, antes de sair, cada aviso e cada rastro passam pela limpeza (`./limpeza.ts`).
 */
import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import { limparEvento, limparRastro } from "./limpeza";

/** Ambientes que ligam o envio. `development` e o ambiente dos testes nunca ligam. */
export const AMBIENTES_DO_SENTRY = ["production", "preview"] as const;
export type AmbienteDoSentry = (typeof AMBIENTES_DO_SENTRY)[number];

/**
 * Integrações padrão do pacote que ficam desligadas: medição de desempenho, contagem de sessões (navegador e servidor),
 * rastros do console, variáveis locais e, por garantia, gravação de tela, feedback e Spotlight (que nem vêm ligados).
 */
export const INTEGRACOES_DESLIGADAS: readonly string[] = [
  "BrowserTracing",
  "BrowserSession",
  "ProcessSession",
  "Console",
  "LocalVariables",
  "LocalVariablesAsync",
  "Replay",
  "ReplayCanvas",
  "Feedback",
  "Spotlight",
];

export type EntradaDoSentry = {
  /** `NEXT_PUBLIC_SENTRY_DSN`. */
  dsn?: string;
  /** `VERCEL_ENV` no servidor, `NEXT_PUBLIC_VERCEL_ENV` no navegador. */
  ambiente?: string;
  /** O commit publicado (`VERCEL_GIT_COMMIT_SHA` / `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`), para saber em que versão o erro aconteceu. */
  versao?: string;
};

const ehAmbienteDoSentry = (a: string | undefined): a is AmbienteDoSentry => (AMBIENTES_DO_SENTRY as readonly string[]).includes(a ?? "");

/** Endereço de envio com a cara de um DSN do Sentry (https://chave@host/projeto); outra coisa não liga nada. */
const dsnValido = (dsn: string) => /^https:\/\/[^\s/@]+@[^\s/@]+\/\S+$/.test(dsn);

/** Opções do `Sentry.init`, ou `null` quando o Sentry não deve ligar (sem endereço, endereço estranho ou fora da Vercel). */
export function opcoesDoSentry(entrada: EntradaDoSentry) {
  const dsn = entrada.dsn?.trim();
  if (!dsn || !dsnValido(dsn) || !ehAmbienteDoSentry(entrada.ambiente)) return null;
  const versao = entrada.versao?.trim();
  return {
    dsn,
    environment: entrada.ambiente,
    ...(versao ? { release: versao } : {}),
    dataCollection: {
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
    },
    tracesSampleRate: 0,
    tracesSampler: (): number => 0,
    tracePropagationTargets: [],
    sendClientReports: false,
    integrations: <I extends { name: string }>(padrao: I[]): I[] => padrao.filter((i) => !INTEGRACOES_DESLIGADAS.includes(i.name)),
    beforeSend: (evento: ErrorEvent): ErrorEvent => limparEvento(evento),
    beforeBreadcrumb: (rastro: Breadcrumb): Breadcrumb | null => limparRastro(rastro),
  };
}
