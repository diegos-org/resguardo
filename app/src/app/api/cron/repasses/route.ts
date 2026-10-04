/**
 * Repasses por periodicidade (M4.10), chamado pelo agendador da Vercel todo dia às 8h (11h UTC; ver
 * `vercel.json`): gera os repasses antecipados do dia e manda os e-mails dos repasses pagos com
 * comprovante. A repetição dos e-mails sem confirmação roda de hora em hora em `/api/cron/repasses-emails`.
 * Só roda com o segredo do agendador (`CRON_SECRET`): sem ele, recusa.
 */
import { getDb } from "@/db/client";
import { correioDoAmbiente } from "@/email/correio";
import { repassesDeTodas } from "@/repasses/cron";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.get("authorization") !== `Bearer ${segredo}`) return Response.json({ ok: false }, { status: 401 });
  try {
    const resumo = await repassesDeTodas(getDb(), correioDoAmbiente(), new Date());
    return Response.json({ ok: true, resumo });
  } catch {
    // O detalhe fica registrado na página "Sistema".
    return Response.json({ ok: false }, { status: 500 });
  }
}
