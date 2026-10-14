import { notFound } from "next/navigation";

/**
 * Qualquer outro endereço dentro do portal (M7.8): a página não encontrada do portal, no visual dele. Sem isto, o Next
 * usaria a do site (a da raiz), com o menu do site.
 */
export default function PortalNaoEncontrado(): never {
  notFound();
}
