/**
 * Agenda diária da equipe (M6.3), chamada pelo agendador da Vercel às 20h (23h UTC; ver
 * `vercel.json`). Só roda com o segredo do agendador (`CRON_SECRET`): sem ele, recusa.
 */
import { agendaDeTodas } from "@/agenda/cron";
import { getDb } from "@/db/client";
import { correioDoAmbiente } from "@/email/correio";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.get("authorization") !== `Bearer ${segredo}`) return Response.json({ ok: false }, { status: 401 });
  try {
    const resumo = await agendaDeTodas(getDb(), correioDoAmbiente(), new Date());
    return Response.json({ ok: true, resumo });
  } catch {
    // O detalhe fica registrado na página "Sistema".
    return Response.json({ ok: false }, { status: 500 });
  }
}
