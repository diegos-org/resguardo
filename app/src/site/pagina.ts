import "server-only";
import { headers } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";
import { getDb } from "@/db/client";
import { metadadosDaPagina, type PreviaDaPagina } from "./compartilhamento";
import { ICONES_PADRAO } from "./icone";
import { conteudoDoSite } from "./site";

/** Para as páginas do site: sempre por requisição (o que se muda no painel aparece na hora). */
export const carregarSite = cache(async () => {
  await connection();
  const db = getDb();
  return { db, conteudo: await conteudoDoSite(db) };
});

/**
 * Metadados de uma página do site (nome da empresa do site, lido uma vez por requisição): título, a frase da página e a
 * prévia dos links (M7.13; as regras em ./compartilhamento). Sem `previa`, a descrição e a capa do site. O endereço pelo
 * qual a página foi pedida confirma o campo "Site" como base dos endereços completos.
 */
export async function metadadosDoSite(pagina?: string, previa?: PreviaDaPagina) {
  const { conteudo } = await carregarSite();
  return metadadosDaPagina(conteudo, pagina, previa, (await headers()).get("host"));
}

/**
 * Minha reserva (portal do hóspede, M9.1): o título e a frase do site, mas o ícone fixo da marca do estudo, como o painel
 * e o portal do proprietário (M7.18: os portais não seguem a marca enviada; a regra do ícone em ./icone).
 */
export async function metadadosDeMinhaReserva() {
  return { ...(await metadadosDoSite("Minha reserva")), icons: ICONES_PADRAO };
}
