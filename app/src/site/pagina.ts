import "server-only";
import { connection } from "next/server";
import { getDb } from "@/db/client";
import { conteudoDoSite } from "./site";

/** Para as páginas do site: sempre por requisição (o que se muda no painel aparece na hora). */
export async function carregarSite() {
  await connection();
  const db = getDb();
  return { db, conteudo: await conteudoDoSite(db) };
}
