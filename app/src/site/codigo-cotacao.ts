/**
 * Código público da cotação do site (M8.1): puro, sem banco, sem rede e sem relógio. Mora aqui, e não em `cotacoes.ts`,
 * para quem só lê códigos (a sugestão de vínculo da conversa do WhatsApp, M10.1a) não importar o módulo que grava
 * cotações e reservas; `cotacoes.ts` reexporta tudo, e quem já importava de lá continua igual.
 */
import { randomInt } from "node:crypto";

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I
/** Código público da cotação, ex.: COT-7K2QXM9A. Não é credencial. */
export function gerarCodigoCotacao(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALFABETO[randomInt(ALFABETO.length)];
  return `COT-${s}`;
}
export const codigoCotacaoValido = (c: string) => /^COT-[A-HJ-NP-Z2-9]{8}$/.test(c);
/**
 * Os códigos de cotação que aparecem soltos num texto (M10.1a: sugestão de vínculo da conversa do WhatsApp), no mesmo
 * alfabeto de `codigoCotacaoValido`, sem repetição e na ordem em que aparecem. Grudado em outra letra ou número não
 * conta. Como `codigosDeReservaNoTexto` (reservas/regras.ts), só maiúsculas: quem chama passa o texto em maiúsculas.
 */
export function codigosDeCotacaoNoTexto(t: string): string[] {
  return [...new Set(t.match(/\bCOT-[A-HJ-NP-Z2-9]{8}\b/g) ?? [])];
}
