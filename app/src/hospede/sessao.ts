/**
 * Sessão do portal do hóspede (M9.1): separada do login da equipe e dos proprietários. É um
 * cookie assinado (HMAC com o segredo do ambiente) com o e-mail verificado pelo código e o
 * vencimento. O cookie só diz QUEM é; o que ele pode ver é decidido a cada acesso, no servidor,
 * pelas reservas que têm esse e-mail agora.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_HOSPEDE = "scl_hospede";
export const VALIDADE_SESSAO_HOSPEDE_MS = 7 * 24 * 60 * 60 * 1000;

const chave = (segredo: string) => createHmac("sha256", segredo).update("portal-hospede:sessao:v1").digest();
const assinar = (segredo: string, corpo: string) => createHmac("sha256", chave(segredo)).update(corpo).digest("base64url");

export function criarSessaoHospede(email: string, segredo: string, agora: Date): string {
  const corpo = Buffer.from(JSON.stringify({ e: email, x: agora.getTime() + VALIDADE_SESSAO_HOSPEDE_MS })).toString("base64url");
  return `${corpo}.${assinar(segredo, corpo)}`;
}

/** E-mail da sessão, ou null se o cookie é inválido, adulterado ou venceu. */
export function lerSessaoHospede(token: string | undefined, segredo: string | undefined, agora: Date): string | null {
  if (!token || !segredo || token.length > 1000) return null;
  const [corpo, assinatura, ...resto] = token.split(".");
  if (!corpo || !assinatura || resto.length) return null;
  const esperado = Buffer.from(assinar(segredo, corpo));
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
