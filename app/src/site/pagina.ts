import "server-only";
import { connection } from "next/server";
import { cache } from "react";
import { getDb } from "@/db/client";
import { conteudoDoSite, tituloDoSite } from "./site";

/** Para as páginas do site: sempre por requisição (o que se muda no painel aparece na hora). */
export const carregarSite = cache(async () => {
  await connection();
  const db = getDb();
  return { db, conteudo: await conteudoDoSite(db) };
});

/** Metadados de uma página do site (nome da empresa do site, lido uma vez por requisição). */
export async function metadadosDoSite(pagina?: string) {
  const { conteudo } = await carregarSite();
  return { title: tituloDoSite(conteudo, pagina) || "Site em configuração" };
}
