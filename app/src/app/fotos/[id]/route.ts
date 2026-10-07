/** Foto de um imóvel (M7.3), a grande: a do site para todos; as outras só para quem pode ver o imóvel (`entregarFoto`). */
import type { NextRequest } from "next/server";
import { obterSessao } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { entregarFoto } from "@/imoveis/fotos-entrega";
import { organizacaoDoSite } from "@/site/site";

export async function GET(_req: NextRequest, ctx: RouteContext<"/fotos/[id]">) {
  const { id } = await ctx.params;
  const db = getDb();
  return entregarFoto(db, id, "grande", { organizacaoDoSite: await organizacaoDoSite(db), sessao: obterSessao });
}
