"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigir } from "@/acesso/politica";
import { obterSessao } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { hojeISO } from "@/lib/datas";
import { trocarMinhaSenha } from "./acesso";
import { marcarFeitaPelaProfissional } from "./equipe";

/** "Feita" pelo celular: só a profissional da sessão, só a limpeza dela. */
export async function marcarFeitaAcao(form: FormData): Promise<void> {
  const sessao = await obterSessao();
  if (!sessao || sessao.papel !== "limpeza" || !sessao.profissionalId) redirect("/entrar");
  exigir(sessao, "limpeza:propria", { organizacaoId: sessao.organizacaoId });
  const r = await marcarFeitaPelaProfissional(getDb(), sessao.organizacaoId, sessao.profissionalId, String(form.get("id") ?? ""), hojeISO(), sessao.usuarioId);
  revalidatePath("/equipe");
  redirect(r.ok ? "/equipe?salvo=1" : `/equipe?erro=${encodeURIComponent(r.erro)}`);
}

export type EstadoMinhaSenha = { ok?: boolean; erro?: string };

/** A própria profissional cria ou troca a senha (M6.8). */
export async function trocarMinhaSenhaAcao(_anterior: EstadoMinhaSenha, form: FormData): Promise<EstadoMinhaSenha> {
  const sessao = await obterSessao();
  if (!sessao || sessao.papel !== "limpeza" || !sessao.profissionalId) redirect("/entrar");
  exigir(sessao, "limpeza:propria", { organizacaoId: sessao.organizacaoId });
  const r = await trocarMinhaSenha(getDb(), sessao.usuarioId, { atual: String(form.get("atual") ?? ""), nova: String(form.get("nova") ?? ""), repetir: String(form.get("repetir") ?? "") });
  if (!r.ok) return { erro: r.erro };
  // As sessões de antes da troca (esta inclusive) não valem mais: entra de novo com a senha nova.
  redirect("/entrar?etapa=senha&aviso=senha-trocada");
}
