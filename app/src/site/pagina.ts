import "server-only";
import { connection } from "next/server";
import { cache } from "react";
import { getDb } from "@/db/client";
import { metadadosDaPagina, type PreviaDaPagina } from "./compartilhamento";
import { conteudoDoSite } from "./site";

/** Para as páginas do site: sempre por requisição (o que se muda no painel aparece na hora). */
export const carregarSite = cache(async () => {
  await connection();
  const db = getDb();
  return { db, conteudo: await conteudoDoSite(db) };
});

/**
 * Metadados de uma página do site (nome da empresa do site, lido uma vez por requisição): título, a frase da página e a
 * prévia dos links (M7.13; as regras em ./compartilhamento). Sem `previa`, a descrição e a capa do site.
 */
export async function metadadosDoSite(pagina?: string, previa?: PreviaDaPagina) {
  const { conteudo } = await carregarSite();
  return metadadosDaPagina(conteudo, pagina, previa);
}
