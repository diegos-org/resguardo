/** Comprovante do Pix de um repasse (M4.10), no portal: só o próprio proprietário baixa (deny-by-default). */
import type { NextRequest } from "next/server";
import { obterSessao } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { proprietariosDoUsuario } from "@/portal/resumo";
import { arquivoDoComprovante, obterRepasse } from "@/repasses/repasses";
import { respostaDoArquivo } from "@/repasses/resposta-arquivo";

export async function GET(_req: NextRequest, ctx: RouteContext<"/portal/repasses/[id]/comprovante">) {
  const sessao = await obterSessao();
  if (!sessao || sessao.papel !== "proprietario") return new Response("Acesso negado.", { status: 403 });
  const { id } = await ctx.params;
  const db = getDb();
  const r = await obterRepasse(db, sessao.organizacaoId, id);
  if (!r) return new Response("Não encontrado.", { status: 404 });
  const meus = await proprietariosDoUsuario(db, sessao.organizacaoId, sessao.usuarioId);
  if (!meus.some((d) => d.id === r.proprietarioId)) return new Response("Acesso negado.", { status: 403 });
  return respostaDoArquivo(await arquivoDoComprovante(db, sessao.organizacaoId, id));
}
