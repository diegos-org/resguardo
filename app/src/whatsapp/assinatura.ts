/**
 * Assinatura dos avisos do WhatsApp (M10.1a, desenho na seção "Rota" de `requisitos/product/WHATSAPP.md`). O cabeçalho
 * `x-hub-signature-256` traz `sha256=<hex>`: o HMAC-SHA256 dos bytes crus do corpo, com a chave secreta do app
 * (WHATSAPP_APP_SECRET). Confere-se sobre os bytes exatamente como chegaram, antes de qualquer decodificação: o mesmo JSON
 * com outro espaçamento (ou `JSON.stringify(JSON.parse(corpo))`) já não confere. Hex em maiúsculas é aceito (não
 * documentado; comparado em minúsculas). Puro: sem banco, sem rede e sem relógio. O Mercado Pago tem outro formato
 * (`pagamentos/assinatura.ts`, que não muda).
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Teto do cabeçalho antes da regex ("sha256=" + 64 hex = 71). */
const LIMITE_CABECALHO = 100;
const CABECALHO = /^sha256=([0-9a-fA-F]{64})$/;

/** "sha256=<64 hex>" (hex maiúsculo aceito) → os 32 bytes; qualquer outra forma (sem prefixo, sha1=, 63 ou 65 hex) = null. */
export function lerCabecalhoAssinatura(v: string | null): Buffer | null {
  if (typeof v !== "string" || v.length > LIMITE_CABECALHO) return null;
  const m = CABECALHO.exec(v);
  return m ? Buffer.from(m[1].toLowerCase(), "hex") : null;
}

/** HMAC-SHA256(segredo, bytes crus) comparado em tempo constante; assinatura de outro tamanho ou segredo vazio = false. */
export function assinaturaConfere(bytes: Buffer, assinatura: Buffer, segredo: string): boolean {
  if (typeof segredo !== "string" || !segredo || !Buffer.isBuffer(assinatura)) return false;
  const esperada = createHmac("sha256", segredo).update(bytes).digest();
  return esperada.length === assinatura.length && timingSafeEqual(esperada, assinatura);
}

const resumo = (s: string) => createHash("sha256").update(s).digest();

/**
 * A senha digitada (o `hub.verify_token` do GET) confere com a esperada? Compara os resumos sha256 dos dois lados (mesmo
 * tamanho sempre, como `pagamentos/limites.ts`), também quando falta a digitada: tamanhos diferentes não lançam.
 */
export function tokenConfere(digitado: string | null, esperado: string): boolean {
  const veio = typeof digitado === "string";
  const confere = timingSafeEqual(resumo(veio ? digitado : "\u0000sem-token"), resumo(typeof esperado === "string" ? esperado : ""));
  return veio && typeof esperado === "string" && esperado.length > 0 && confere;
}

/** `hub.challenge` devolvido no corpo do GET: só [A-Za-z0-9_-], de 1 a 128 caracteres. */
export const CHALLENGE_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;
