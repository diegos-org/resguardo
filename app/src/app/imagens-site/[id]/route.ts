/** Imagem do site (M7.6): capa, marca e fotos do bairro, só as que a configuração do site usa (`entregarImagemSite`). */
import type { NextRequest } from "next/server";
import { obterSessao } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { entregarImagemSite } from "@/site/imagens-site";
import { organizacaoDoSite } from "@/site/site";

export async function GET(_req: NextRequest, ctx: RouteContext<"/imagens-site/[id]">) {
  const { id } = await ctx.params;
  const db = getDb();
  return entregarImagemSite(db, id, { organizacaoDoSite: await organizacaoDoSite(db), sessao: obterSessao });
}
