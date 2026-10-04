/** Comprovante do Pix de um repasse (M4.10), para quem lê o financeiro no painel. Arquivo privado, guardado no banco. */
import type { NextRequest } from "next/server";
import { podeFazer } from "@/acesso/politica";
import { obterSessao } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { arquivoDoComprovante } from "@/repasses/repasses";
import { respostaDoArquivo } from "@/repasses/resposta-arquivo";

export async function GET(_req: NextRequest, ctx: RouteContext<"/painel/financeiro/repasses/[id]/comprovante">) {
  const sessao = await obterSessao();
  if (!sessao || sessao.papel === "proprietario" || !podeFazer(sessao.papel, "financeiro:ler")) return new Response("Acesso negado.", { status: 403 });
  const { id } = await ctx.params;
  return respostaDoArquivo(await arquivoDoComprovante(getDb(), sessao.organizacaoId, id));
}
