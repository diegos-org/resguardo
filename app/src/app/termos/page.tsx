import { PaginaLegal } from "@/components/site/PaginaLegal";
import { metadadosDaPaginaLegal } from "@/site/paginas-legais";

export async function generateMetadata({ searchParams }: PageProps<"/termos">) {
  return metadadosDaPaginaLegal("termos", await searchParams);
}

/** Termos de uso do site (M7.4): a versão em vigor ou, com ?versao=N, uma anterior. Texto em Configurações → Páginas legais do site. */
export default async function Termos({ searchParams }: PageProps<"/termos">) {
  return <PaginaLegal documento="termos" versao={(await searchParams).versao} />;
}
