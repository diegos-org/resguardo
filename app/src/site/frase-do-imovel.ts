import type { ImovelPublico } from "./site";

/**
 * A frase do cartão da casa (vitrines do site e da página para proprietários, Nossas casas e a busca) e da prévia do
 * link (M7.13) — uma regra, um lugar: a frase de abertura da casa (M7.17, escrita na ficha do imóvel) quando houver;
 * sem ela, a primeira frase da descrição (até 120 caracteres); sem descrição, bairro e cidade.
 *
 * Pura e sem estilos, para o painel (aba Anúncios) mostrar o que o cartão usa sem carregar o CSS do site.
 */
export function fraseDoImovel(i: Pick<ImovelPublico, "frase" | "descricao" | "bairro" | "cidade">): string {
  const propria = i.frase.trim();
  if (propria) return propria;
  const frase = i.descricao.trim().split(/(?<=[.!?])\s+/)[0] ?? "";
  if (frase) return frase.length > 120 ? `${frase.slice(0, 119).trimEnd()}…` : frase;
  return [i.bairro, i.cidade].filter(Boolean).join(", ");
}
