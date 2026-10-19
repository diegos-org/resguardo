/**
 * Avisos de erro do sistema pelo Sentry (M0.9), num lugar só: as opções do `Sentry.init`, usadas igual no servidor
 * (`src/instrumentation.ts`, Node e Edge) e no navegador (`src/instrumentation-client.ts`), e a situação que a página
 * Sistema mostra (`situacaoDoSentry`). Funções puras: não carregam o pacote do Sentry nem leem o ambiente sozinhas; quem
 * chama passa as variáveis.
 *
 * Liga só com as duas coisas: o endereço de envio (`NEXT_PUBLIC_SENTRY_DSN`, a mesma variável nos dois lados; é um
 * endereço público, não um segredo) e o deploy de produção ou uma prévia da Vercel, pela regra única de
 * `src/sistema/ambiente.ts` (as prévias ficam separadas no Sentry). Sem o endereço, com um endereço sem a forma de um
 * DSN, no desenvolvimento e nos testes, nada é ligado nem enviado; o endereço estranho aparece como problema na página
 * Sistema (avisar em vez de supor).
 *
 * Privacidade (condição de Diego em 16/10/2026: nada de nome, e-mail ou dado de pagamento):
 * - `dataCollection` (a opção da versão 11 do pacote; a antiga `sendDefaultPii` não existe mais nela): nada da pessoa
 *   (o que também impede o Sentry de guardar o IP de quem usa o site), nem cookies, cabeçalhos (menos o User-Agent,
 *   para mostrar navegador e aparelho), corpo das requisições, parâmetros de busca, dados de consultas ao banco ou
 *   variáveis locais;
 * - sem medição de desempenho: nem `tracesSampleRate` nem `tracesSampler` (qualquer um dos dois, mesmo valendo 0, liga
 *   no pacote o modo de medição e as integrações que instrumentam o banco; sem os dois, o pacote recusa a medição logo
 *   no começo, até para um pedido que chegue com o cabeçalho de rastreio do Sentry), e o `next.config.ts` tira essa
 *   parte do pacote na publicação; sem cabeçalhos do Sentry nas chamadas a outros serviços (`tracePropagationTargets:
 *   []`), sem gravação de tela (Replay), sem formulário de feedback, sem contagem de sessões, sem o idioma e o fuso do
 *   aparelho e sem relatórios de envio: o Sentry só recebe algo quando acontece um erro;
 * - das rotinas automáticas e do aviso do Mercado Pago, só o resumo sem dados pessoais, nunca a mensagem original
 *   (`./erro-de-rotina.ts`, usado por `./aviso-do-servidor.ts`);
 * - e, antes de sair, cada aviso e cada rastro passam pela limpeza (`./limpeza.ts`).
 */
import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import { ambienteDoSistema, deployDeProducao } from "@/sistema/ambiente";
import { limparEvento, limparRastro } from "./limpeza";

/**
 * As variáveis que decidem o Sentry. No servidor, as do `process.env`; no navegador, as públicas equivalentes
 * (`NEXT_PUBLIC_VERCEL_ENV` no lugar de `VERCEL_ENV`, `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` no lugar de `VERCEL_GIT_COMMIT_SHA`).
 */
export type VariaveisDoSentry = {
  readonly NEXT_PUBLIC_SENTRY_DSN?: string;
  readonly VERCEL_ENV?: string;
  readonly NODE_ENV?: string;
  /** O commit publicado, para saber em que versão o erro aconteceu. */
  readonly VERCEL_GIT_COMMIT_SHA?: string;
};

/** Os dois ambientes do Sentry: o deploy de produção e as prévias. */
export type AmbienteDoSentry = "production" | "preview";

/**
 * Integrações padrão do pacote que ficam desligadas: medição de desempenho, contagem de sessões (navegador e servidor),
 * rastros do console, variáveis locais, idioma e fuso do aparelho e, por garantia, gravação de tela, feedback e
 * Spotlight (que nem vêm ligados).
 */
export const INTEGRACOES_DESLIGADAS: readonly string[] = [
  "BrowserTracing",
  "BrowserSession",
  "ProcessSession",
  "Console",
  "LocalVariables",
  "LocalVariablesAsync",
  "CultureContext",
  "Replay",
  "ReplayCanvas",
  "Feedback",
  "Spotlight",
];

/**
 * O ambiente do Sentry pela regra única de `src/sistema/ambiente.ts`: o deploy de produção da Vercel ou uma prévia. Os
 * casos que só contam como produção (um VERCEL_ENV inesperado, um `next start` local) e o desenvolvimento ficam de fora.
 */
export function ambienteDoSentry(env: VariaveisDoSentry): AmbienteDoSentry | null {
  if (deployDeProducao(env)) return "production";
  return ambienteDoSistema(env) === "previa" ? "preview" : null;
}

/**
 * Endereço de envio com a forma que o pacote do Sentry aceita: https://chave@servidor/número do projeto (com porta e
 * caminho opcionais). Um projeto que não é número o pacote não recusa no site publicado, mas o Sentry recusa cada envio.
 */
const dsnValido = (dsn: string) => /^https:\/\/\w+@[\w.-]+(?::\d+)?\/(?:[\w.-]+\/)*\d+$/.test(dsn);

/**
 * Situação do Sentry neste ambiente, a mesma regra de `opcoesDoSentry`: `ligado`, `sem_endereco`, `endereco_invalido`
 * (há um valor, mas sem a forma de um DSN: nada é enviado) ou `fora_do_ambiente` (o desenvolvimento e os testes).
 */
export type SituacaoDoSentry = "ligado" | "sem_endereco" | "endereco_invalido" | "fora_do_ambiente";

export function situacaoDoSentry(env: VariaveisDoSentry): SituacaoDoSentry {
  const dsn = env.NEXT_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) return "sem_endereco";
  if (!dsnValido(dsn)) return "endereco_invalido";
  return ambienteDoSentry(env) ? "ligado" : "fora_do_ambiente";
}

/**
 * Aviso para o registro do servidor quando há um endereço de envio estranho na produção ou numa prévia (sem nunca
 * repetir o valor); `null` nos outros casos.
 */
export function avisoDoSentryDesligado(env: VariaveisDoSentry): string | null {
  if (situacaoDoSentry(env) !== "endereco_invalido" || !ambienteDoSentry(env)) return null;
  return "Avisos de erro (Sentry) desligados: NEXT_PUBLIC_SENTRY_DSN não tem a forma de um endereço de envio do Sentry (https://chave@servidor/número do projeto). Confira o valor na Vercel.";
}

/** Opções do `Sentry.init`, ou `null` quando o Sentry não deve ligar (ver `situacaoDoSentry`). */
export function opcoesDoSentry(env: VariaveisDoSentry) {
  const ambiente = ambienteDoSentry(env);
  if (situacaoDoSentry(env) !== "ligado" || !ambiente) return null;
  const versao = env.VERCEL_GIT_COMMIT_SHA?.trim();
  return {
    dsn: env.NEXT_PUBLIC_SENTRY_DSN!.trim(),
    environment: ambiente,
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
    tracePropagationTargets: [],
    sendClientReports: false,
    integrations: <I extends { name: string }>(padrao: I[]): I[] => padrao.filter((i) => !INTEGRACOES_DESLIGADAS.includes(i.name)),
    beforeSend: (evento: ErrorEvent): ErrorEvent => limparEvento(evento),
    beforeBreadcrumb: (rastro: Breadcrumb): Breadcrumb | null => limparRastro(rastro),
  };
}
