"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import type { FormaQuitacao } from "@/db/schema";
import { reaisParaCentavos } from "@/lib/dinheiro-form";
import { contestar, desfazerQuitacao, quitar, resolverContestacao } from "./adiantamentos";

async function sessaoEditora() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "despesa:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

const voltar = (id: string, r: { ok: boolean; erro?: string }) => {
  revalidatePath("/painel/despesas", "layout");
  redirect(`/painel/despesas/adiantamentos/${id}?${r.ok ? "salvo=1" : `erro=${encodeURIComponent(r.erro ?? "Não foi possível.")}`}`);
};

export async function quitarAcao(form: FormData): Promise<void> {
  const sessao = await sessaoEditora();
  const id = String(form.get("id") ?? "");
  const valor = reaisParaCentavos(String(form.get("valor") ?? ""));
  const forma = String(form.get("forma") ?? "") as FormaQuitacao;
  // "Empresa assume" só pela resolução de contestação ou explícito aqui; compensação é do repasse (M4.9).
  if (forma !== "reembolso" && forma !== "empresa_assume") return voltar(id, { ok: false, erro: "Forma inválida." });
  const r = valor
    ? await quitar(getDb(), sessao.organizacaoId, id, { forma, valor, data: String(form.get("data") ?? ""), nota: String(form.get("nota") ?? ""), chave: String(form.get("chave") ?? "") }, sessao.usuarioId)
    : { ok: false, erro: "Valor inválido (ex.: 1.500,00)." };
  voltar(id, r);
}

export async function desfazerAcao(form: FormData): Promise<void> {
  const sessao = await sessaoEditora();
  const id = String(form.get("id") ?? "");
  const r = await desfazerQuitacao(getDb(), sessao.organizacaoId, String(form.get("quitacaoId") ?? ""), String(form.get("motivo") ?? ""), sessao.usuarioId);
  voltar(id, r);
}

export async function contestarAcao(form: FormData): Promise<void> {
  const sessao = await sessaoEditora();
  const id = String(form.get("id") ?? "");
  voltar(id, await contestar(getDb(), sessao.organizacaoId, id, String(form.get("motivo") ?? ""), sessao.usuarioId));
}

export async function resolverAcao(form: FormData): Promise<void> {
  const sessao = await sessaoEditora();
  const id = String(form.get("id") ?? "");
  const resolucao = String(form.get("resolucao") ?? "") as "mantida" | "empresa_assume";
  voltar(id, await resolverContestacao(getDb(), sessao.organizacaoId, id, { resolucao, nota: String(form.get("nota") ?? ""), data: String(form.get("data") ?? "") }, sessao.usuarioId));
}
