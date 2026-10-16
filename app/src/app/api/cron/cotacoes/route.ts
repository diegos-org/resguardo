/**
 * Pedidos e pagamentos do site (M8.1, M8.2a): a cada 10 minutos, primeiro confere os pagamentos do site que ainda
 * esperam o Mercado Pago (para nunca vencer um pedido cujo Pix já foi pago) e depois vence os pedidos cujo prazo
 * acabou (as noites voltam à venda) e fecha as cotações cujo pedido a equipe já confirmou ou cancelou. Só roda com
 * o segredo do agendador (`CRON_SECRET`) e só em produção — onde o teste do pagamento não roda, então ali só os
 * pedidos vencem (nas prévias, a conferência é o "Conferir agora" do painel e a página do hóspede).
 */
import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { provedorDeConferencia } from "@/pagamentos/oferta";
import { rotinaDoSite } from "@/pagamentos/rotina";
import { registrarExecucao } from "@/sistema/automacoes";
import { avisarErroDoServidor } from "@/observabilidade/aviso-do-servidor";
import { ErroDeRotina } from "@/observabilidade/erro-de-rotina";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Resultado = Awaited<ReturnType<typeof rotinaDoSite>>;

/** Resumo para a página Sistema (só números, nada de dado do pedido). */
function resumoDaRotina(r: Resultado): string {
  const p = r.pagamentos;
  const pagamentos = p
    ? `Pagamentos: ${p.conferidas} conferido(s), ${p.mudaram} com mudança, ${p.devolucoes} devolução(ões) confirmada(s), ${p.canceladas} Pix cancelado(s), ${p.falhas} falha(s)`
    : "Pagamentos: não conferidos neste ambiente (o teste roda nas prévias)";
  const h = r.holds;
  const falhas = h.falhas ? `, ${h.falhas} não fechado(s) nesta volta` : "";
  // M8.2d: as alterações de reserva paga com as datas seguradas vencidas.
  const alteracoes = r.alteracoes?.expiradas ? ` · Alterações: ${r.alteracoes.expiradas} vencida(s)` : "";
  return `${pagamentos} · Pedidos: ${h.expiradas} vencido(s), ${h.convertidas} confirmado(s), ${h.canceladas} cancelado(s)${falhas}${alteracoes}`;
}

async function executar(db: Db): Promise<Resultado> {
  const saida: { r?: Resultado } = {};
  await registrarExecucao(db, "pedidos-site", async () => {
    let r: Resultado;
    try {
      const gate = await provedorDeConferencia();
      r = await rotinaDoSite(db, gate.ok ? gate.provedor : null, new Date());
    } catch (erro) {
      // A página Sistema mostra o resumo: só um texto fixo, nunca a mensagem crua do erro. O erro original segue como
      // causa só para o aviso ao Sentry, sem a mensagem dele (o tipo, o código técnico e a pilha; M0.9).
      throw new ErroDeRotina("a rotina parou no meio; roda de novo em 10 minutos", { rotina_interrompida: 1 }, { cause: erro });
    }
    saida.r = r;
    return resumoDaRotina(r);
  });
  return saida.r!;
}

export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.get("authorization") !== `Bearer ${segredo}`) return Response.json({ ok: false }, { status: 401 });
  // O cron da Vercel só roda em produção; impedir também disparos manuais numa preview.
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return Response.json({ ok: false }, { status: 403 });
  try {
    const r = await executar(getDb());
    return Response.json({ ok: true, resumo: r.holds, pagamentos: r.pagamentos });
  } catch (erro) {
    await avisarErroDoServidor(erro, "pedidos-site");
    return Response.json({ ok: false }, { status: 500 });
  }
}
