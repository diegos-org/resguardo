/**
 * Mensagens programadas ao hóspede (M9.2), chamado pelo agendador da Vercel às 10h e às 14h
 * (13h e 17h UTC; ver `vercel.json`). Só roda com o segredo do agendador (`CRON_SECRET`).
 */
import { getDb } from "@/db/client";
import { correioDoAmbiente } from "@/email/correio";
import { mensagensDeTodas } from "@/mensagens/cron";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.get("authorization") !== `Bearer ${segredo}`) return Response.json({ ok: false }, { status: 401 });
  try {
    const resumo = await mensagensDeTodas(getDb(), correioDoAmbiente(), new Date());
    return Response.json({ ok: true, resumo });
  } catch {
    // O detalhe fica registrado na página "Sistema".
    return Response.json({ ok: false }, { status: 500 });
  }
}
