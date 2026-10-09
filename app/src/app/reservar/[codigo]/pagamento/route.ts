/**
 * Situação do pagamento da cotação (M8.2a), que a página consulta enquanto espera o Pix (`responderPagamento`).
 * Fica sob /reservar porque o cookie da autorização do pedido só vale ali: com ele, a resposta traz o QR.
 */
import type { NextRequest } from "next/server";
import { origemDoPedido } from "@/acesso/senha";
import { getDb } from "@/db/client";
import { COOKIE_CHECKOUT } from "@/pagamentos/autorizacao";
import { responderPagamento } from "@/site/pagamento";
import { organizacaoDoSite } from "@/site/site";

export async function GET(req: NextRequest, ctx: RouteContext<"/reservar/[codigo]/pagamento">) {
  const { codigo } = await ctx.params;
  const db = getDb();
  let bruto = "";
  try {
    bruto = decodeURIComponent(codigo);
  } catch {
    // Código malformado: a conferência do formato recusa.
  }
  return responderPagamento(db, bruto, { organizacao: () => organizacaoDoSite(db), token: req.cookies.get(COOKIE_CHECKOUT)?.value, origem: origemDoPedido(req.headers) });
}
