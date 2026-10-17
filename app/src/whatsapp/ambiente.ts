/**
 * WhatsApp a partir do ambiente (M10.1a, desenho na seção "Rota" de `requisitos/product/WHATSAPP.md`). Deny-by-default:
 * variável ausente ou com valor inesperado desliga. Nada aqui registra ou devolve o segredo do app ou a senha de
 * verificação para fora da rota.
 * - WHATSAPP_RECEBIMENTO: só "ligada" (aparado, como a BEDS24_ESCRITA) liga o recebimento dos avisos (POST); quem liga é
 *   Diego. Desligada, o POST responde 503 e a Meta reenvia por até 7 dias.
 * - WHATSAPP_APP_SECRET: a chave secreta do app na Meta; assina cada aviso (`x-hub-signature-256`). Sem ela nenhum aviso
 *   é aceito.
 * - WHATSAPP_VERIFY_TOKEN: a senha de verificação que Diego salva no app junto com o endereço; a Meta a manda na URL do
 *   GET. O GET de verificação não depende de WHATSAPP_RECEBIMENTO (a Meta verifica ao salvar o endereço, antes de o
 *   recebimento ser ligado).
 */

export const recebimentoLigado = (env: NodeJS.ProcessEnv = process.env): boolean => env.WHATSAPP_RECEBIMENTO?.trim() === "ligada";

export const segredoDoApp = (env: NodeJS.ProcessEnv = process.env): string | null => env.WHATSAPP_APP_SECRET?.trim() || null;

/**
 * A Meta manda a senha de verificação na URL do GET, e o registro de acessos da Vercel guarda o endereço com a consulta
 * (o Sentry não guarda: `urlQueryParams: false`): exige um valor aleatório e longo, gerado só para isso.
 */
export const TOKEN_MINIMO = 32;

/** "falta" (ausente ou vazia), "curto" (menos de `TOKEN_MINIMO` caracteres, já aparada) ou "ok". Nunca devolve o valor. */
export function situacaoDoToken(env: NodeJS.ProcessEnv = process.env): "falta" | "curto" | "ok" {
  const token = env.WHATSAPP_VERIFY_TOKEN?.trim() ?? "";
  if (!token) return "falta";
  return token.length < TOKEN_MINIMO ? "curto" : "ok";
}

/** A senha aparada, só quando `situacaoDoToken` é "ok"; curta ou ausente = null (o GET responde 403). */
export const tokenDeVerificacao = (env: NodeJS.ProcessEnv = process.env): string | null =>
  situacaoDoToken(env) === "ok" ? env.WHATSAPP_VERIFY_TOKEN!.trim() : null;
