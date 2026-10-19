import { executarCronReservasBeds24 } from "@/beds24/cron-reservas";
import { clienteDeReservasDoAmbiente, leitorDeReservasDoAmbiente } from "@/beds24/http";
import { getDb } from "@/db/client";
import { correioDoAmbiente } from "@/email/correio";
import { avisarErroDoServidor } from "@/observabilidade/aviso-do-servidor";
import { deployDeProducao } from "@/sistema/ambiente";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * A rotina das reservas pagas do site no Beds24 (M8.3c, desenho 9), de 10 em 10 minutos. Só no deploy de produção: sem
 * `VERCEL_ENV=production` responde 403, inclusive sem a variável (diferente das rotinas diárias do Beds24, que deixam passar
 * sem ela). Só aqui as fábricas do ambiente são chamadas: um cliente por volta, com o prazo de cada operação ligado ao `fetch`.
 */
export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.get("authorization") !== `Bearer ${segredo}`) return Response.json({ ok: false }, { status: 401 });
  if (!deployDeProducao(process.env)) return Response.json({ ok: false }, { status: 403 });
  try {
    let prazo: AbortSignal | null = null;
    const comPrazo = { prazo: () => prazo };
    const cliente = clienteDeReservasDoAmbiente(process.env, comPrazo);
    await executarCronReservasBeds24(getDb(), process.env, {
      cliente,
      leitor: cliente ?? leitorDeReservasDoAmbiente(process.env, comPrazo),
      correio: correioDoAmbiente(process.env),
      prazoDaOperacao: (sinal) => {
        prazo = sinal;
      },
    });
    return Response.json({ ok: true });
  } catch (erro) {
    await avisarErroDoServidor(erro, "reservas-beds24");
    return Response.json({ ok: false }, { status: 500 });
  }
}
