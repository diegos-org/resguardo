import { getDb } from "@/db/client";
import { notaDoIconeDaMarca } from "@/site/icone";
import { enderecoImagemSite, iconeDaMarcaEnviada, lerImagensSite } from "@/site/imagens-site";
import { MARCA_PADRAO } from "@/site/site";
import { ImagensSite } from "./ImagensSite";

/**
 * Configurações → Site, parte "Imagens do site" (M7.6): foto da capa e marca; o aviso da capa sem a versão leve (M7.13) e a
 * nota da marca enviada que não serve de ícone da aba (M7.18, pela mesma conferência que o site usa).
 */
export async function ImagensSitePainel({ organizacaoId }: { organizacaoId: string }) {
  const db = getDb();
  const { capa, capaPequena, marca } = await lerImagensSite(db, organizacaoId);
  const notaIcone = notaDoIconeDaMarca(await iconeDaMarcaEnviada(db, organizacaoId, marca));
  return <ImagensSite capa={capa && enderecoImagemSite(capa)} capaSemPrevia={!!capa && !capaPequena} marca={marca && enderecoImagemSite(marca)} marcaPadrao={MARCA_PADRAO} notaIcone={notaIcone} />;
}
