/**
 * Quem pode ver uma foto de imóvel (M7.3), decidido a cada pedido: foto de imóvel que está no site (público e ativo)
 * vai para qualquer um, com cache; as outras só para quem entrou e pode ver aquele imóvel (equipe no painel; o
 * proprietário, só as dos imóveis dele). Fora isso, "não encontrado" — sem dizer se a foto existe.
 */
import { autorizar, type Sessao } from "@/acesso/politica";
import type { Db } from "@/db/types";
import { conteudoDaFoto, type ConteudoFoto } from "./fotos";

/** Foto do site fica uma hora no cache: tirar o imóvel do site (ou apagar a foto) some de vez em até uma hora. */
export const CACHE_FOTO_PUBLICA = "public, max-age=3600, s-maxage=3600";

const resposta = (c: ConteudoFoto, cache: string) =>
  new Response(new Uint8Array(c.conteudo), {
    headers: { "Content-Type": c.tipo, "Content-Disposition": "inline", "Cache-Control": cache, "X-Content-Type-Options": "nosniff" },
  });

export async function entregarFoto(
  db: Db,
  id: string,
  tamanho: "grande" | "pequena",
  contexto: { organizacaoDoSite: string | null; sessao: () => Promise<Sessao | null> },
): Promise<Response> {
  if (contexto.organizacaoDoSite) {
    const doSite = await conteudoDaFoto(db, contexto.organizacaoDoSite, id, tamanho);
    if (doSite?.publica) return resposta(doSite, CACHE_FOTO_PUBLICA);
  }
  const sessao = await contexto.sessao();
  if (sessao) {
    const interna = await conteudoDaFoto(db, sessao.organizacaoId, id, tamanho);
    if (interna && autorizar(sessao, "imovel:ler", { organizacaoId: sessao.organizacaoId, imovelId: interna.imovelId }).permitido) return resposta(interna, "private, no-store");
  }
  return new Response("Não encontrado.", { status: 404, headers: { "Cache-Control": "no-store" } });
}
