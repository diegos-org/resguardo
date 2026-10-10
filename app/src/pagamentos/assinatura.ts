/**
 * Assinatura dos avisos (webhooks) do Mercado Pago. O cabeçalho `x-signature` traz
 * `ts=<carimbo>,v1=<hex>`; v1 é o HMAC-SHA256 (hex) do manifesto
 * `id:<data.id da URL>;request-id:<x-request-id>;ts:<ts>;`, com a chave secreta do painel.
 * Partes ausentes ficam fora do manifesto (regra da documentação).
 *
 * Divergência conhecida: a documentação manda pôr o data.id em minúsculas e o SDK oficial
 * (mercadopago 3.6.1) usa o valor como veio. Aceitamos as duas formas até o sandbox dizer qual
 * vale. Não há tolerância de horário: a unidade do ts (segundos ou milissegundos) também diverge
 * entre documentação e SDK; `momentoDaAssinatura` lê o ts para quem quiser registrar.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type CabecalhoAssinatura = { ts: string | null; v1: string };

const LIMITE = 1024;

/**
 * Lê "ts=…,v1=…" (espaços tolerados, qualquer ordem, chaves extras ignoradas). null se não
 * há v1 em hexadecimal de 64 dígitos, se uma chave se repete ou se o formato não fecha.
 */
export function lerCabecalhoAssinatura(xSignature: string | null | undefined): CabecalhoAssinatura | null {
  if (typeof xSignature !== "string" || !xSignature.trim() || xSignature.length > LIMITE) return null;
  const partes = new Map<string, string>();
  for (const pedaco of xSignature.split(",")) {
    if (!pedaco.trim()) continue;
    const i = pedaco.indexOf("=");
    if (i <= 0) return null;
    const chave = pedaco.slice(0, i).trim().toLowerCase();
    const valor = pedaco.slice(i + 1).trim();
    if (!chave || !valor || partes.has(chave)) return null;
    partes.set(chave, valor);
  }
  const v1 = partes.get("v1");
  if (!v1 || !/^[0-9a-f]{64}$/i.test(v1)) return null;
  const ts = partes.get("ts") ?? null;
  if (ts !== null && !/^\d{1,20}$/.test(ts)) return null;
  return { ts, v1: v1.toLowerCase() };
}

/**
 * Momento do ts, se houver: 13 dígitos ou mais = milissegundos; menos = segundos (a
 * documentação e o SDK divergem; os exemplos trazem as duas formas). Só informativo.
 */
export function momentoDaAssinatura(xSignature: string | null | undefined): Date | null {
  const c = lerCabecalhoAssinatura(xSignature);
  if (!c?.ts) return null;
  const n = Number(c.ts);
  if (!Number.isSafeInteger(n)) return null;
  const d = new Date(c.ts.length >= 13 ? n : n * 1000);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Manifesto com só as partes presentes, nesta ordem: id, request-id, ts. */
export function manifestoAssinatura(dataId: string | null, xRequestId: string | null, ts: string | null): string {
  return [
    dataId ? `id:${dataId};` : "",
    xRequestId ? `request-id:${xRequestId};` : "",
    ts ? `ts:${ts};` : "",
  ].join("");
}

const presente = (v: string | null | undefined, limite: number): string | null | false => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" || v.length > limite) return false;
  const t = v.trim();
  return t || null;
};

/**
 * true só se o v1 confere com o HMAC do manifesto (data.id como veio ou em minúsculas).
 * Segredo vazio, cabeçalho malformado ou valores grandes demais → false.
 */
export function conferirAssinatura(p: {
  xSignature: string | null | undefined;
  xRequestId: string | null | undefined;
  dataId: string | null | undefined;
  segredo: string | null | undefined;
}): boolean {
  if (typeof p.segredo !== "string" || !p.segredo) return false;
  const cabecalho = lerCabecalhoAssinatura(p.xSignature);
  if (!cabecalho) return false;
  const dataId = presente(p.dataId, 256);
  const requestId = presente(p.xRequestId, 256);
  if (dataId === false || requestId === false) return false;
  // Sem nada assinável além do ts não há o que conferir.
  if (!dataId && !requestId) return false;
  const recebido = Buffer.from(cabecalho.v1, "utf8");
  const ids = dataId && dataId.toLowerCase() !== dataId ? [dataId, dataId.toLowerCase()] : [dataId];
  let confere = false;
  for (const id of ids) {
    const esperado = Buffer.from(createHmac("sha256", p.segredo).update(manifestoAssinatura(id, requestId, cabecalho.ts)).digest("hex"), "utf8");
    // Sempre calcula as duas formas (sem atalho), para o tempo não depender de qual conferiu.
    if (esperado.length === recebido.length && timingSafeEqual(esperado, recebido)) confere = true;
  }
  return confere;
}
