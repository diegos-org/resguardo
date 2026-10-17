/**
 * WhatsApp (M10.1a), chamado pelo agendador da Vercel de hora em hora, aos 17 minutos (ver `vercel.json`): apaga os
 * avisos e contadores com mais de 90 dias e repete o e-mail da conta desconectada que ainda não saiu
 * (`whatsapp/cron.ts`). Só roda com o segredo do agendador (`CRON_SECRET`) e só no deploy de produção (nas prévias o
 * aviso da Meta não chega). O resumo em Sistema só tem números; o erro vai para o Sentry sem a mensagem (M0.9).
 */
import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { correioDoAmbiente } from "@/email/correio";
import { avisarErroDoServidor } from "@/observabilidade/aviso-do-servidor";
import { ErroDeRotina } from "@/observabilidade/erro-de-rotina";
import { deployDeProducao } from "@/sistema/ambiente";
import { registrarExecucao } from "@/sistema/automacoes";
import { rotinaWhatsapp } from "@/whatsapp/cron";

export const dynamic = "force-dynamic";

async function executar(db: Db): Promise<string> {
  return registrarExecucao(db, "whatsapp", async () => {
    try {
      return await rotinaWhatsapp(db, correioDoAmbiente(), new Date());
    } catch (erro) {
      // O e-mail que falhou já vem como ErroDeRotina (só números). Outro erro: a página Sistema mostra um texto fixo, e o
      // erro original segue como causa só para o aviso ao Sentry, sem a mensagem dele (o tipo, o código e a pilha).
      if (erro instanceof ErroDeRotina) throw erro;
      throw new ErroDeRotina("a rotina parou no meio; roda de novo na próxima hora", { rotina_interrompida: 1 }, { cause: erro });
    }
  });
}

export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.get("authorization") !== `Bearer ${segredo}`) return Response.json({ ok: false }, { status: 401 });
  // Só o deploy de produção recebe os avisos da Meta: fora dele (prévia, computador), a rotina não roda.
  if (!deployDeProducao()) return Response.json({ ok: false }, { status: 403 });
  try {
    return Response.json({ ok: true, resumo: await executar(getDb()) });
  } catch (erro) {
    await avisarErroDoServidor(erro, "whatsapp");
    // O detalhe fica registrado na página "Sistema".
    return Response.json({ ok: false }, { status: 500 });
  }
}
