import type { NextRequest } from "next/server";
import { obterSessao } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { relatorioDoPortal } from "@/relatorios/gerar";
import { respostaDoRelatorio } from "@/relatorios/resposta";

/** PDF do mês escolhido no portal (M5.3): mesmos filtros da página (imovel, ano, mes). */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const params = { imovel: q.getAll("imovel"), ano: q.get("ano") ?? undefined, mes: q.get("mes") ?? undefined };
  return respostaDoRelatorio(await relatorioDoPortal(getDb(), await obterSessao(), params));
}
