"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { correioDoAmbiente } from "@/email/correio";
import { type Destinatario, type Formato, resumoDoEnvio, salvarConfigAgenda } from "./agenda";
import { agendaManual } from "./cron";

function voltar(r: { ok: boolean; erro?: string; info?: string }): never {
  revalidatePath("/painel/agenda");
  const q = new URLSearchParams();
  if (r.ok) q.set("salvo", r.info ?? "1");
  else q.set("erro", r.erro ?? "Não foi possível.");
  redirect(`/painel/agenda?${q}`);
}

async function sessaoAdmin() {
  const s = await exigirSessaoPainel();
  exigir(s, "configuracao:editar", { organizacaoId: s.organizacaoId });
  return s;
}

export async function salvarAgendaAcao(form: FormData) {
  const s = await sessaoAdmin();
  const n = Math.min(Number(form.get("linhas") ?? 0) || 0, 40);
  const destinatarios: Destinatario[] = [];
  for (let i = 0; i < n; i++) {
    destinatarios.push({ email: String(form.get(`email_${i}`) ?? ""), cidades: form.getAll(`cidade_${i}`).map(String) });
  }
  // Formato de cada cidade ("automático" = sem escolha).
  const formatos: Record<string, Formato> = {};
  const nc = Math.min(Number(form.get("cidades") ?? 0) || 0, 40);
  for (let i = 0; i < nc; i++) {
    const cidade = String(form.get(`formato_cidade_${i}`) ?? "");
    const f = String(form.get(`formato_${i}`) ?? "");
    if (cidade && f && f !== "automatico") formatos[cidade] = f as Formato;
  }
  voltar(
    await salvarConfigAgenda(
      getDb(),
      s.organizacaoId,
      { ativa: form.get("ativa") === "sim", destinatarios, formatos, horaEntrada: String(form.get("horaEntrada") ?? ""), horaSaida: String(form.get("horaSaida") ?? "") },
      s.usuarioId,
    ),
  );
}

export async function enviarAgoraAcao() {
  const s = await sessaoAdmin();
  const r = await agendaManual(getDb(), s.organizacaoId, correioDoAmbiente(), new Date(), s.usuarioId);
  if (r.aviso) voltar({ ok: false, erro: `Agenda não enviada: ${r.aviso}.` });
  if (r.falhas.length) {
    voltar({ ok: false, erro: `${resumoDoEnvio(r)} — ${r.falhas.join("; ")}. Clique em "Enviar agora" de novo para tentar só quem falhou.` });
  }
  voltar({ ok: true, info: resumoDoEnvio(r) });
}
