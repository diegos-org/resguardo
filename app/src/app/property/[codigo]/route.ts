import { carregarSite } from "@/site/pagina";
import { destinoDoLinkAntigo, imovelDoSite } from "@/site/site";

/** Links antigos do site (`/property/<código>`): redireciona para `/imoveis/<código>` (308). */
async function redirecionar(req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const { db, conteudo } = await carregarSite();
  const imovel = conteudo ? await imovelDoSite(db, conteudo.organizacaoId, codigo) : null;
  const r = destinoDoLinkAntigo(new URL(req.url).searchParams, imovel);
  if (r.status === 308) return new Response(null, { status: 308, headers: { Location: r.destino } });
  if (r.status === 404) return new Response("Apartamento não encontrado.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(`Confira os dados da estadia: ${r.erro}`, { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export const GET = redirecionar;
export const HEAD = redirecionar;
