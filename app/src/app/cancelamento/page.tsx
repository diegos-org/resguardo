import { PaginaLegal } from "@/components/site/PaginaLegal";
import { metadadosDaPaginaLegal } from "@/site/paginas-legais";

export async function generateMetadata({ searchParams }: PageProps<"/cancelamento">) {
  return metadadosDaPaginaLegal("cancelamento", await searchParams);
}

/** Política de cancelamento do site (M7.4): a versão em vigor ou, com ?versao=N, uma anterior. Texto em Configurações → Páginas legais do site. */
export default async function Cancelamento({ searchParams }: PageProps<"/cancelamento">) {
  return <PaginaLegal documento="cancelamento" versao={(await searchParams).versao} />;
}
