import { metadadosDaNaoEncontrada, PaginaNaoEncontrada } from "@/components/site/NaoEncontrada";

/**
 * Página não encontrada do site (M7.8): endereço que não existe e `notFound()` das páginas do site sem uma própria (a
 * cotação, as páginas legais). O painel e o portal têm as suas, no visual deles. O Next já responde 404 e põe o
 * `noindex` sozinho.
 */
export const generateMetadata = () => metadadosDaNaoEncontrada("pagina");

export default async function NaoEncontradaNoSite() {
  return PaginaNaoEncontrada({ tipo: "pagina" });
}
