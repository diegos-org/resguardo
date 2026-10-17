/**
 * Onde o sistema está rodando (M7.12): uma regra só, lida pelo pagamento no site (`pagamentos/ambiente.ts`, M8.2a), pela
 * tela do Mercado Pago em Integrações (e o aviso do deploy de produção sem chaves, `sistema/servicos.ts`), pela faixa
 * "Prévia de teste" no topo das páginas (`components/FaixaPrevia.tsx`) e pelos avisos de erro (`observabilidade/sentry.ts`,
 * M0.9, que no navegador passa as variáveis públicas equivalentes).
 *
 * Deny-by-default: na Vercel vale o VERCEL_ENV — `preview` são as prévias (banco separado, pagamento só de teste),
 * `development` é o `vercel dev`; `production` ou qualquer outro valor conta como produção. Fora da Vercel (sem
 * VERCEL_ENV), o computador de desenvolvimento e os testes rodam com NODE_ENV diferente de production; um `next start`
 * ou um script com NODE_ENV=production conta como produção.
 */
export type AmbienteDoSistema = "producao" | "previa" | "desenvolvimento";

/**
 * Endereço do deploy de produção, num lugar só (M10.1a): os endereços de aviso que se colam no Mercado Pago
 * (`pagamentos/integracao.ts`) e no app da Meta (`whatsapp/integracao.ts`) saem daqui. Na troca de domínio (M11.2) muda
 * esta linha.
 */
export const ENDERECO_PRODUCAO = "https://scl-reconstrucao.vercel.app";

/** As duas variáveis que decidem o ambiente (o `process.env` serve; no navegador, um objeto com as públicas equivalentes). */
export type VariaveisDoAmbiente = { readonly VERCEL_ENV?: string; readonly NODE_ENV?: string };

export function ambienteDoSistema(env: VariaveisDoAmbiente = process.env): AmbienteDoSistema {
  const vercel = env.VERCEL_ENV?.trim();
  if (vercel) return vercel === "preview" ? "previa" : vercel === "development" ? "desenvolvimento" : "producao";
  return env.NODE_ENV === "production" ? "producao" : "desenvolvimento";
}

/**
 * Ambiente de teste (as prévias, o `vercel dev` e o computador de desenvolvimento): só aqui o pagamento do site roda, e
 * só no modo de teste do Mercado Pago; no deploy de produção, nunca.
 */
export const ambienteDeTeste = (env: VariaveisDoAmbiente = process.env): boolean => ambienteDoSistema(env) !== "producao";

/**
 * Por que conta como produção (revisão do M7.12), só para a tela dizer a verdade sobre onde o sistema roda
 * (Integrações → Mercado Pago): `deploy` é o deploy de produção da Vercel (VERCEL_ENV=production); os outros dois só
 * contam como produção pela regra acima, sem ser esse deploy — um VERCEL_ENV inesperado (`vercel_inesperado`) ou, fora da
 * Vercel, NODE_ENV=production (`node_env_producao`, um `next start` ou um script). null fora da produção.
 */
export type MotivoDaProducao = "deploy" | "vercel_inesperado" | "node_env_producao";

export function motivoDaProducao(env: VariaveisDoAmbiente = process.env): MotivoDaProducao | null {
  if (ambienteDoSistema(env) !== "producao") return null;
  const vercel = env.VERCEL_ENV?.trim();
  return vercel === "production" ? "deploy" : vercel ? "vercel_inesperado" : "node_env_producao";
}

/** É o deploy de produção da Vercel? Não inclui os casos que só contam como produção (`motivoDaProducao`). */
export const deployDeProducao = (env: VariaveisDoAmbiente = process.env): boolean => motivoDaProducao(env) === "deploy";
