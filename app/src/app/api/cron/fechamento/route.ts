/**
 * E-mail do fechamento mensal aos proprietários (M5.4), chamado pelo agendador da Vercel todo dia
 * às 9h (12h UTC; ver `vercel.json`): do dia 1º em diante, sai para quem já tem o mês fechado.
 * Só roda com o segredo do agendador (`CRON_SECRET`): sem ele, recusa.
 */
import { getDb } from "@/db/client";
import { correioDoAmbiente } from "@/email/correio";
import { fechamentoDeTodas } from "@/fechamento/cron";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.get("authorization") !== `Bearer ${segredo}`) return Response.json({ ok: false }, { status: 401 });
  try {
    const resumo = await fechamentoDeTodas(getDb(), correioDoAmbiente(), new Date());
    return Response.json({ ok: true, resumo });
  } catch {
    // O detalhe fica registrado na página "Sistema".
    return Response.json({ ok: false }, { status: 500 });
  }
}
