/**
 * Token assinado com o segredo do ambiente (HMAC), para sessões curtas fora do login principal:
 * portal do hóspede (M9.1), cadastro público do marketplace (M12.3) e autorização do pagamento no site
 * (M8.2a: o "e-mail" do token é o id da cotação). Cada finalidade usa uma
 * chave derivada própria, então o token de uma não vale na outra. Guarda só o e-mail verificado e
 * o vencimento; o que a pessoa pode fazer é decidido no servidor a cada acesso.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type FinalidadeToken = "portal-hospede:sessao:v1" | "cadastro-marketplace:sessao:v1" | "checkout-site:v1";

const chave = (segredo: string, finalidade: FinalidadeToken) => createHmac("sha256", segredo).update(finalidade).digest();
const assinar = (segredo: string, finalidade: FinalidadeToken, corpo: string) => createHmac("sha256", chave(segredo, finalidade)).update(corpo).digest("base64url");

export function criarToken(finalidade: FinalidadeToken, email: string, segredo: string, agora: Date, validadeMs: number): string {
  const corpo = Buffer.from(JSON.stringify({ e: email, x: agora.getTime() + validadeMs })).toString("base64url");
  return `${corpo}.${assinar(segredo, finalidade, corpo)}`;
}

/** E-mail do token, ou null se é inválido, adulterado, de outra finalidade ou venceu. */
export function lerToken(finalidade: FinalidadeToken, token: string | undefined, segredo: string | undefined, agora: Date): string | null {
  if (!token || !segredo || token.length > 1000) return null;
  const [corpo, assinatura, ...resto] = token.split(".");
  if (!corpo || !assinatura || resto.length) return null;
  const esperado = Buffer.from(assinar(segredo, finalidade, corpo));
  const recebido = Buffer.from(assinatura);
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return null;
  try {
    const { e, x } = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")) as { e?: unknown; x?: unknown };
    if (typeof e !== "string" || typeof x !== "number" || x <= agora.getTime()) return null;
    return e;
  } catch {
    return null;
  }
}
