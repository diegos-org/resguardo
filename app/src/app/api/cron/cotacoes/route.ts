/**
 * Holds do site (M8.1): a cada 10 minutos, vence os pedidos cujo prazo acabou (as noites voltam à venda)
 * e fecha as cotações cujo pedido a equipe já confirmou ou cancelou. Só roda com o segredo do agendador
 * (`CRON_SECRET`) e só em produção.
 */
import { getDb } from "@/db/client";
import { expirarHoldsVencidos } from "@/site/cotacoes";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.get("authorization") !== `Bearer ${segredo}`) return Response.json({ ok: false }, { status: 401 });
  // O cron da Vercel só roda em produção; impedir também disparos manuais numa preview.
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return Response.json({ ok: false }, { status: 403 });
  try {
    const resumo = await expirarHoldsVencidos(getDb(), null, new Date());
    return Response.json({ ok: true, resumo });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
