/** Foto de um imóvel (M7.3), a versão pequena (cartões, miniaturas); sem ela, a grande. Mesmas regras de `entregarFoto`. */
import type { NextRequest } from "next/server";
import { obterSessao } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { entregarFoto } from "@/imoveis/fotos-entrega";
import { organizacaoDoSite } from "@/site/site";

export async function GET(_req: NextRequest, ctx: RouteContext<"/fotos/[id]/pequena">) {
  const { id } = await ctx.params;
  const db = getDb();
  return entregarFoto(db, id, "pequena", { organizacaoDoSite: await organizacaoDoSite(db), sessao: obterSessao });
}
