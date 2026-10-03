"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { alterarHorario } from "./horarios";

export async function alterarHorarioAcao(form: FormData): Promise<void> {
  const sessao = await exigirSessaoPainel();
  const id = String(form.get("id") ?? "");
  const r = await alterarHorario(getDb(), sessao, {
    reservaId: id, tipo: String(form.get("tipo") ?? ""), acao: String(form.get("acao") ?? ""),
    versao: Number(form.get("versao")), hora: String(form.get("hora") ?? ""), canal: String(form.get("canal") ?? ""),
    referencia: String(form.get("referencia") ?? ""), aceiteExplicito: form.get("aceite") === "sim",
  });
  revalidatePath(`/painel/reservas/${id}`);
  revalidatePath("/painel/agenda");
  redirect(`/painel/reservas/${encodeURIComponent(id)}?${r.ok ? "salvo=1" : `erro=${encodeURIComponent(r.erro ?? "Não foi possível salvar.")}`}`);
}
