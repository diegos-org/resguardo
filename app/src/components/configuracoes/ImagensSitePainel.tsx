import { getDb } from "@/db/client";
import { enderecoImagemSite, lerImagensSite } from "@/site/imagens-site";
import { MARCA_PADRAO } from "@/site/site";
import { ImagensSite } from "./ImagensSite";

/** Configurações → Site, parte "Imagens do site" (M7.6): foto da capa e marca. */
export async function ImagensSitePainel({ organizacaoId }: { organizacaoId: string }) {
  const { capa, marca } = await lerImagensSite(getDb(), organizacaoId);
  return <ImagensSite capa={capa && enderecoImagemSite(capa)} marca={marca && enderecoImagemSite(marca)} marcaPadrao={MARCA_PADRAO} />;
}
