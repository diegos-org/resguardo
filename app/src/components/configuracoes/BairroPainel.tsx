import { getDb } from "@/db/client";
import { bairrosDoSite, LIMITES_BAIRRO, lerBairro, mesmoBairro } from "@/site/bairro";
import { enderecoImagemSite } from "@/site/imagens-site";
import { LugaresBairro } from "./LugaresBairro";

/**
 * Configurações → Site, parte "O bairro à sua porta" (M7.6). A página só abre para quem edita as configurações; aqui só
 * se carrega a seção e os bairros dos imóveis do site (sugestão no campo e aviso de lugar que não aparece em nenhuma ficha).
 */
export async function BairroPainel({ organizacaoId }: { organizacaoId: string }) {
  const db = getDb();
  const [config, bairros] = await Promise.all([lerBairro(db, organizacaoId), bairrosDoSite(db, organizacaoId)]);
  const lugares = config.lugares.map(({ fotoId, ...l }) => ({
    ...l,
    foto: fotoId ? enderecoImagemSite(fotoId) : null,
    semImovel: l.bairro !== "" && !bairros.some((b) => mesmoBairro(b, l.bairro)),
  }));
  return <LugaresBairro titulo={config.titulo} subtitulo={config.subtitulo} lugares={lugares} bairros={bairros} limites={LIMITES_BAIRRO} />;
}
