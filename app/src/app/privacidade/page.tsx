import { PaginaLegal } from "@/components/site/PaginaLegal";
import { metadadosDaPaginaLegal } from "@/site/paginas-legais";

export async function generateMetadata({ searchParams }: PageProps<"/privacidade">) {
  return metadadosDaPaginaLegal("privacidade", await searchParams);
}

/** Política de privacidade do site (M7.4): a versão em vigor ou, com ?versao=N, uma anterior. Texto em Configurações → Páginas legais do site. */
export default async function Privacidade({ searchParams }: PageProps<"/privacidade">) {
  return <PaginaLegal documento="privacidade" versao={(await searchParams).versao} />;
}
