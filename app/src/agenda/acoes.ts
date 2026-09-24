"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { correioDoAmbiente } from "@/email/correio";
import { type Destinatario, resumoDoEnvio, salvarConfigAgenda } from "./agenda";
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
  voltar(await salvarConfigAgenda(getDb(), s.organizacaoId, { ativa: form.get("ativa") === "sim", destinatarios }, s.usuarioId));
}

export async function enviarAgoraAcao() {
  const s = await sessaoAdmin();
  const r = await agendaManual(getDb(), s.organizacaoId, correioDoAmbiente(), new Date());
  if (r.aviso) voltar({ ok: false, erro: `Agenda não enviada: ${r.aviso}.` });
  if (r.falhas.length) {
    voltar({ ok: false, erro: `${resumoDoEnvio(r)} — ${r.falhas.join("; ")}. Clique em "Enviar agora" de novo para tentar só quem falhou.` });
  }
  voltar({ ok: true, info: resumoDoEnvio(r) });
}
