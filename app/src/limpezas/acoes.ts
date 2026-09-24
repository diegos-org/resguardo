"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigir, podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { hojeISO } from "@/lib/datas";
import { reaisParaCentavos } from "@/lib/dinheiro-form";
import {
  cancelarLimpeza,
  confirmarLimpeza,
  criarLimpezaAvulsa,
  criarProfissional,
  editarProfissional,
  escolherCategoriaDasLimpezas,
  informarCusto,
  realizarLimpeza,
  reabrirLimpeza,
} from "./limpezas";

async function sessaoEditora() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "limpeza:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

/** Volta para a lista mantendo o filtro que estava na tela. */
function voltar(form: FormData, r: { ok: boolean; erro?: string }, caminho = "/painel/limpezas"): never {
  revalidatePath("/painel/limpezas", "layout");
  const q = new URLSearchParams(String(form.get("voltar") ?? ""));
  q.delete("salvo");
  q.delete("erro");
  if (r.ok) q.set("salvo", "1");
  else q.set("erro", r.erro ?? "Não foi possível.");
  redirect(`${caminho}?${q}`);
}

/** Custo do formulário: em branco = não informado; só quem vê o financeiro informa custo. */
function lerCusto(form: FormData, podeCusto: boolean): number | null | "invalido" {
  const t = String(form.get("custo") ?? "").trim();
  if (!podeCusto || !t) return null;
  return reaisParaCentavos(t) ?? "invalido";
}

export async function confirmarAcao(form: FormData) {
  const s = await sessaoEditora();
  voltar(form, await confirmarLimpeza(getDb(), s.organizacaoId, String(form.get("id") ?? ""), String(form.get("profissionalId") ?? ""), s.usuarioId));
}

export async function realizarAcao(form: FormData) {
  const s = await sessaoEditora();
  const custo = lerCusto(form, podeFazer(s.papel, "financeiro:ler"));
  if (custo === "invalido") voltar(form, { ok: false, erro: "Custo inválido (ex.: 150,00)." });
  voltar(
    form,
    await realizarLimpeza(
      getDb(),
      s.organizacaoId,
      String(form.get("id") ?? ""),
      { profissionalId: String(form.get("profissionalId") ?? ""), custo: custo as number | null, observacao: form.has("observacao") ? String(form.get("observacao")) : undefined },
      hojeISO(),
      s.usuarioId,
    ),
  );
}

export async function custoAcao(form: FormData) {
  const s = await sessaoEditora();
  if (!podeFazer(s.papel, "financeiro:ler")) voltar(form, { ok: false, erro: "Sem permissão para o custo." });
  const custo = lerCusto(form, true);
  if (custo === "invalido") voltar(form, { ok: false, erro: "Custo inválido (ex.: 150,00)." });
  voltar(form, await informarCusto(getDb(), s.organizacaoId, String(form.get("id") ?? ""), custo as number | null, s.usuarioId));
}

export async function reabrirAcao(form: FormData) {
  const s = await sessaoEditora();
  voltar(form, await reabrirLimpeza(getDb(), s.organizacaoId, String(form.get("id") ?? ""), s.usuarioId));
}

export async function cancelarAcao(form: FormData) {
  const s = await sessaoEditora();
  voltar(form, await cancelarLimpeza(getDb(), s.organizacaoId, String(form.get("id") ?? ""), String(form.get("motivo") ?? ""), s.usuarioId));
}

export async function avulsaAcao(form: FormData) {
  const s = await sessaoEditora();
  voltar(
    form,
    await criarLimpezaAvulsa(getDb(), s.organizacaoId, { imovelId: String(form.get("imovelId") ?? ""), data: String(form.get("data") ?? ""), observacao: String(form.get("observacao") ?? "") }, s.usuarioId),
  );
}

export async function criarProfissionalAcao(form: FormData) {
  const s = await sessaoEditora();
  voltar(
    form,
    await criarProfissional(getDb(), s.organizacaoId, { nome: String(form.get("nome") ?? ""), telefone: String(form.get("telefone") ?? ""), observacoes: String(form.get("observacoes") ?? "") }, s.usuarioId),
    "/painel/limpezas/profissionais",
  );
}

export async function editarProfissionalAcao(form: FormData) {
  const s = await sessaoEditora();
  voltar(
    form,
    await editarProfissional(
      getDb(),
      s.organizacaoId,
      String(form.get("id") ?? ""),
      { nome: String(form.get("nome") ?? ""), telefone: String(form.get("telefone") ?? ""), observacoes: String(form.get("observacoes") ?? ""), ativo: form.get("ativo") === "on" },
      s.usuarioId,
    ),
    "/painel/limpezas/profissionais",
  );
}

/** Categoria de despesa das limpezas: só quem edita despesas. */
export async function categoriaAcao(form: FormData) {
  const s = await exigirSessaoPainel();
  exigir(s, "despesa:editar", { organizacaoId: s.organizacaoId });
  voltar(form, await escolherCategoriaDasLimpezas(getDb(), s.organizacaoId, String(form.get("categoriaId") ?? ""), s.usuarioId));
}
