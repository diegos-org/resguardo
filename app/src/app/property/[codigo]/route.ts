import { carregarSite } from "@/site/pagina";
import { destinoDoLinkAntigo, imovelDoSite } from "@/site/site";

/**
 * Links antigos do site (`/property/<código>`): redireciona para `/imoveis/<código>` (308); casa que não está (mais) no
 * site, para a consulta com o aviso (307, M7.9).
 */
async function redirecionar(req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const { db, conteudo } = await carregarSite();
  const imovel = conteudo ? await imovelDoSite(db, conteudo.organizacaoId, codigo) : null;
  const r = destinoDoLinkAntigo(new URL(req.url).searchParams, codigo, imovel);
  if (r.status !== 400) return new Response(null, { status: r.status, headers: { Location: r.destino } });
  return new Response(`Confira os dados da estadia: ${r.erro}`, { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export const GET = redirecionar;
export const HEAD = redirecionar;
