/**
 * E-mails dos repasses (M4.10), chamado pelo agendador da Vercel de hora em hora (ver `vercel.json`):
 * manda os e-mails dos repasses pagos com comprovante que ainda não saíram e repete, com a mesma
 * chave, a tentativa sem confirmação do provedor enquanto a chave vale. A rotina diária das 8h
 * (`/api/cron/repasses`) continua gerando os antecipados. Só roda com o segredo do agendador
 * (`CRON_SECRET`): sem ele, recusa.
 */
import { getDb } from "@/db/client";
import { correioDoAmbiente } from "@/email/correio";
import { emailsDeRepassesDeTodas } from "@/repasses/cron";
import { avisarErroDoServidor } from "@/observabilidade/aviso-do-servidor";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.get("authorization") !== `Bearer ${segredo}`) return Response.json({ ok: false }, { status: 401 });
  try {
    const resumo = await emailsDeRepassesDeTodas(getDb(), correioDoAmbiente(), new Date());
    return Response.json({ ok: true, resumo });
  } catch (erro) {
    await avisarErroDoServidor(erro, "repasses-emails");
    // O detalhe fica registrado na página "Sistema".
    return Response.json({ ok: false }, { status: 500 });
  }
}
