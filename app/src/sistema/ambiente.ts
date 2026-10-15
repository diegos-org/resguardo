/**
 * Onde o sistema está rodando (M7.12): uma regra só, lida pelo pagamento no site (`pagamentos/ambiente.ts`, M8.2a), pela
 * tela do Mercado Pago em Integrações e pela faixa "Prévia de teste" no topo das páginas (`components/FaixaPrevia.tsx`).
 *
 * Deny-by-default: na Vercel vale o VERCEL_ENV — `preview` são as prévias (banco separado, pagamento só de teste),
 * `development` é o `vercel dev`; `production` ou qualquer outro valor conta como produção. Fora da Vercel (sem
 * VERCEL_ENV), o computador de desenvolvimento e os testes rodam com NODE_ENV diferente de production; um `next start`
 * ou um script com NODE_ENV=production conta como produção.
 */
export type AmbienteDoSistema = "producao" | "previa" | "desenvolvimento";

export function ambienteDoSistema(env: NodeJS.ProcessEnv = process.env): AmbienteDoSistema {
  const vercel = env.VERCEL_ENV?.trim();
  if (vercel) return vercel === "preview" ? "previa" : vercel === "development" ? "desenvolvimento" : "producao";
  return env.NODE_ENV === "production" ? "producao" : "desenvolvimento";
}

/**
 * Ambiente de teste (as prévias, o `vercel dev` e o computador de desenvolvimento): só aqui o pagamento do site roda, e
 * só no modo de teste do Mercado Pago; no deploy de produção, nunca.
 */
export const ambienteDeTeste = (env: NodeJS.ProcessEnv = process.env): boolean => ambienteDoSistema(env) !== "producao";
