import { executarCronBeds24 } from "@/beds24/cron";
import { getDb } from "@/db/client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.get("authorization") !== `Bearer ${segredo}`) return Response.json({ ok: false }, { status: 401 });
  // O cron da Vercel só roda em produção; impedir também disparos manuais numa preview.
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return Response.json({ ok: false }, { status: 403 });
  try {
    await executarCronBeds24(getDb());
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
