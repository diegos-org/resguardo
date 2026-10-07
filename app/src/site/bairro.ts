/**
 * "O bairro à sua porta" (M7.6): lugares perto dos imóveis, editáveis no painel (Configurações → Site) e mostrados na
 * ficha de cada imóvel do site. Configuração "site_bairro": `{ lugares: [{ id, nome, distancia, frase, bairro, fotoId }] }`;
 * a foto (opcional) é uma imagem do site (`imagens-site.ts`).
 *
 * ESBOÇO: a implementação completa vem na parte (c) do M7.6.
 */
import type { Db } from "@/db/types";

/** O que o site recebe de cada lugar (sem ids internos): a foto é o endereço público, ou null. */
export type LugarPublico = { nome: string; distancia: string; frase: string; foto: string | null };

/** Ids das fotos que a configuração do bairro usa (para a entrega pública das imagens do site). */
export function idsDasFotosDoBairro(valor: Record<string, unknown> | null): string[] {
  const lugares = Array.isArray(valor?.lugares) ? (valor.lugares as unknown[]) : [];
  return lugares.map((l) => (l && typeof l === "object" ? (l as Record<string, unknown>).fotoId : null)).filter((id): id is string => typeof id === "string");
}

/** Lugares para a ficha de um imóvel do bairro informado. */
export async function lugaresDoSite(_db: Db, _organizacaoId: string, _bairro: string): Promise<LugarPublico[]> {
  return [];
}
