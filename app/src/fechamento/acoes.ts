"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { correioDoAmbiente } from "@/email/correio";
import { limitesDoMes } from "@/repasses/repasses";
import { fechamentoManual } from "./cron";
import { envioManualFalhou, resumoDoFechamentoEmail, salvarConfigFechamentoEmail } from "./email";

async function sessaoEditora() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "financeiro:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

function voltar(mes: string, r: { ok: boolean; erro?: string; info?: string }): never {
  revalidatePath("/painel/financeiro/repasses");
  const q = new URLSearchParams();
  if (limitesDoMes(mes)) q.set("mes", mes);
  if (r.ok) q.set("info", r.info ?? "Salvo.");
  else q.set("erro", r.erro ?? "Não foi possível.");
  redirect(`/painel/financeiro/repasses?${q}`);
}

export async function salvarFechamentoEmailAcao(form: FormData): Promise<void> {
  const s = await sessaoEditora();
  const mes = String(form.get("mes") ?? "");
  const r = await salvarConfigFechamentoEmail(
    getDb(),
    s.organizacaoId,
    { ativo: form.get("ativo") === "sim", assunto: String(form.get("assunto") ?? ""), texto: String(form.get("texto") ?? "") },
    s.usuarioId,
  );
  voltar(mes, r.ok ? { ok: true, info: "Configuração do e-mail do fechamento salva." } : r);
}

/** Envia o fechamento do mês: de um proprietário (ou de novo, com `reenviar`), ou de todos os prontos. */
export async function enviarFechamentoAcao(form: FormData): Promise<void> {
  const s = await sessaoEditora();
  const mes = String(form.get("mes") ?? "");
  if (!limitesDoMes(mes)) voltar(mes, { ok: false, erro: "Mês inválido." });
  const proprietarioId = String(form.get("proprietarioId") ?? "") || undefined;
  const r = await fechamentoManual(getDb(), s.organizacaoId, correioDoAmbiente(), new Date(), { mes, proprietarioId, reenviar: form.get("reenviar") === "sim" }, s.usuarioId);
  if (r.aviso) voltar(mes, { ok: false, erro: `E-mail não enviado: ${r.aviso}.` });
  const faltam = [
    ...r.falhas,
    ...(r.pendentes.length ? [`mês ainda não fechado: ${r.pendentes.join(", ")}`] : []),
    ...(r.semEmail.length ? [`sem e-mail cadastrado: ${r.semEmail.join(", ")}`] : []),
    ...(r.semRelatorio.length ? [`sem imóvel nem lançamento no mês (não há relatório): ${r.semRelatorio.join(", ")}`] : []),
    ...(r.incertos.length ? [`sem confirmação do provedor (pode ter chegado; confira antes de reenviar): ${r.incertos.join(", ")}`] : []),
  ];
  if (envioManualFalhou(r, !!proprietarioId)) voltar(mes, { ok: false, erro: `${resumoDoFechamentoEmail(r)} — ${faltam.join("; ")}` });
  voltar(mes, { ok: true, info: `${resumoDoFechamentoEmail(r)}${faltam.length ? ` — ${faltam.join("; ")}` : ""}.` });
}
