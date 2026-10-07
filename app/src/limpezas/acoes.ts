"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { exigir, podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { correioDoAmbiente } from "@/email/correio";
import { definirCidades, definirSenhaPelaEmpresa } from "@/equipe/acesso";
import { avisarAtribuicao, darAcesso, tirarAcesso } from "@/equipe/equipe";
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
function voltar(form: FormData, r: { ok: boolean; erro?: string; aviso?: string | null }, caminho = "/painel/limpezas"): never {
  revalidatePath("/painel/limpezas", "layout");
  const q = new URLSearchParams(String(form.get("voltar") ?? ""));
  q.delete("salvo");
  q.delete("erro");
  if (r.ok) q.set("salvo", "1");
  else q.set("erro", r.erro ?? "Não foi possível.");
  // Deu certo, mas com algo a dizer (ex.: o e-mail para a profissional falhou).
  if (r.ok && r.aviso) q.set("erro", r.aviso);
  redirect(`${caminho}?${q}`);
}

/** Custo do formulário: em branco = não informado; só quem vê o financeiro informa custo. */
function lerCusto(form: FormData, podeCusto: boolean): number | null | "invalido" {
  const t = String(form.get("custo") ?? "").trim();
  if (!podeCusto || !t) return null;
  return reaisParaCentavos(t) ?? "invalido";
}

/** Endereço da tela da equipe no mesmo site em que o painel está. */
async function linkDaEquipe() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/equipe`;
}

export async function confirmarAcao(form: FormData) {
  const s = await sessaoEditora();
  const id = String(form.get("id") ?? "");
  const r = await confirmarLimpeza(getDb(), s.organizacaoId, id, String(form.get("profissionalId") ?? ""), s.usuarioId);
  // A profissional com acesso pelo celular é avisada por e-mail (WhatsApp quando o M10 estiver ligado).
  const aviso = r.ok ? (await avisarAtribuicao(getDb(), s.organizacaoId, id, correioDoAmbiente(), await linkDaEquipe())).aviso : null;
  voltar(form, { ...r, aviso });
}

/** Acesso pelo celular da profissional: dar (com o e-mail) ou tirar. */
export async function acessoProfissionalAcao(form: FormData) {
  const s = await sessaoEditora();
  const id = String(form.get("id") ?? "");
  const r =
    form.get("op") === "tirar"
      ? await tirarAcesso(getDb(), s.organizacaoId, id, s.usuarioId)
      : await darAcesso(getDb(), s.organizacaoId, id, String(form.get("email") ?? ""), s.usuarioId);
  voltar(form, r, "/painel/limpezas/profissionais");
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

export type EstadoSenhaProfissional = { ok?: boolean; erro?: string; login?: string; senha?: string };

/**
 * Usuário e senha provisória da profissional (M6.8). Só quem gerencia usuários (o admin): é uma credencial de outra
 * pessoa. A senha volta só para esta tela, uma vez, para ser copiada e mandada pelo WhatsApp; nunca vai para a URL.
 */
export async function senhaProfissionalAcao(_anterior: EstadoSenhaProfissional, form: FormData): Promise<EstadoSenhaProfissional> {
  const s = await exigirSessaoPainel();
  exigir(s, "usuario:gerenciar", { organizacaoId: s.organizacaoId });
  const r = await definirSenhaPelaEmpresa(getDb(), s.organizacaoId, String(form.get("id") ?? ""), { login: String(form.get("login") ?? ""), senha: String(form.get("senha") ?? "") }, s.usuarioId);
  revalidatePath("/painel/limpezas/profissionais");
  return r.ok ? { ok: true, login: r.login, senha: r.senha } : { erro: r.erro };
}

/** Cidades da agenda que a profissional vê no acesso dela (M6.8). */
export async function cidadesProfissionalAcao(form: FormData) {
  const s = await sessaoEditora();
  const r = await definirCidades(getDb(), s.organizacaoId, String(form.get("id") ?? ""), form.getAll("cidade").map(String), s.usuarioId);
  voltar(form, r, "/painel/limpezas/profissionais");
}
