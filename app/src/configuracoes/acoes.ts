"use server";

import { revalidatePath } from "next/cache";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { type ErrosEmpresa, salvarEmpresa, validarEmpresa } from "./empresa";
import { atualizarModelo, criarModelo, type ErrosModelo, excluirModelo } from "./modelos";
import { lerFormRegras } from "./regras-financeiras";
import { salvarRegrasFinanceiras } from "./salvar-regras";
import { salvarTextosSite, type TextosSite, validarTextosSite } from "./textos-site";
import { alterarUsuario, criarUsuarioEquipe } from "./usuarios";

/** `valores`: o que foi digitado, devolvido quando há erro (o React limpa o formulário após enviar). */
export type EstadoForm<E = Record<string, string>> = { erros?: E; mensagem?: string; ok?: boolean; aviso?: string; valores?: Record<string, string> };

async function sessaoConfig() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "configuracao:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

/** Campos de texto do formulário, sem os internos do Next.js ($ACTION_…). */
const campos = (form: FormData) =>
  Object.fromEntries([...form.entries()].filter((e): e is [string, string] => typeof e[1] === "string" && !e[0].startsWith("$ACTION")));

export async function salvarEmpresaAcao(_a: EstadoForm<ErrosEmpresa>, form: FormData): Promise<EstadoForm<ErrosEmpresa>> {
  const sessao = await sessaoConfig();
  const v = validarEmpresa(campos(form));
  if (!v.ok) return { erros: v.erros, mensagem: "Confira os campos destacados.", valores: campos(form) };
  await salvarEmpresa(getDb(), sessao.organizacaoId, v.dados, sessao.usuarioId);
  revalidatePath("/painel", "layout");
  return { ok: true };
}

export async function salvarRegrasAcao(_a: EstadoForm, form: FormData): Promise<EstadoForm> {
  const sessao = await sessaoConfig();
  const regras = lerFormRegras(campos(form));
  if (!regras) return { mensagem: "Escolha uma opção válida em cada linha." };
  const r = await salvarRegrasFinanceiras(getDb(), sessao.organizacaoId, regras, sessao.usuarioId);
  revalidatePath("/painel", "layout");
  if (!r.mudou) return { ok: true, aviso: "Nada mudou." };
  return { ok: true, aviso: `Salvo. ${r.recalculo?.reservas ?? 0} reserva(s) com entrada de hoje em diante recalculada(s); o passado não mudou.` };
}

export async function salvarTextosAcao(_a: EstadoForm<Partial<TextosSite>>, form: FormData): Promise<EstadoForm<Partial<TextosSite>>> {
  const sessao = await sessaoConfig();
  const v = validarTextosSite(campos(form));
  if (!v.ok) return { erros: v.erros, mensagem: "Confira os campos destacados.", valores: campos(form) };
  const mudou = await salvarTextosSite(getDb(), sessao.organizacaoId, v.textos, sessao.usuarioId);
  revalidatePath("/painel/configuracoes/site");
  return { ok: true, aviso: mudou ? "Salvo." : "Nada mudou." };
}

// --- Usuários ------------------------------------------------------------------------

async function sessaoUsuarios() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "usuario:gerenciar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

export async function novoUsuarioAcao(_a: EstadoForm, form: FormData): Promise<EstadoForm> {
  const sessao = await sessaoUsuarios();
  const r = await criarUsuarioEquipe(
    getDb(),
    sessao.organizacaoId,
    { nome: String(form.get("nome") ?? ""), email: String(form.get("email") ?? ""), papel: String(form.get("papel") ?? "") },
    sessao.usuarioId,
  );
  revalidatePath("/painel/configuracoes/usuarios");
  return r.ok ? { ok: true } : { mensagem: r.erro, valores: campos(form) };
}

export async function alterarUsuarioAcao(_a: EstadoForm, form: FormData): Promise<EstadoForm> {
  const sessao = await sessaoUsuarios();
  const op = String(form.get("op") ?? "");
  const mudanca =
    op === "desativar" ? { ativo: false } : op === "reativar" ? { ativo: true } : { papel: String(form.get("papel") ?? ""), nome: String(form.get("nome") ?? "") };
  const r = await alterarUsuario(getDb(), sessao.organizacaoId, String(form.get("id") ?? ""), mudanca, sessao.usuarioId);
  revalidatePath("/painel/configuracoes/usuarios");
  return r.ok ? { ok: true } : { mensagem: r.erro };
}

// --- Modelos de mensagem ---------------------------------------------------------------

export async function novoModeloAcao(_a: EstadoForm<ErrosModelo>, form: FormData): Promise<EstadoForm<ErrosModelo>> {
  const sessao = await sessaoConfig();
  const r = await criarModelo(getDb(), sessao.organizacaoId, campos(form), sessao.usuarioId);
  revalidatePath("/painel/configuracoes/mensagens");
  return r.ok ? { ok: true } : { erros: r.erros, mensagem: "Confira os campos destacados.", valores: campos(form) };
}

export async function editarModeloAcao(_a: EstadoForm<ErrosModelo>, form: FormData): Promise<EstadoForm<ErrosModelo>> {
  const sessao = await sessaoConfig();
  const id = String(form.get("id") ?? "");
  const op = String(form.get("op") ?? "");
  const db = getDb();
  if (op === "excluir") {
    const ok = await excluirModelo(db, sessao.organizacaoId, id, sessao.usuarioId);
    revalidatePath("/painel/configuracoes/mensagens");
    return ok ? { ok: true } : { mensagem: "Modelo não encontrado." };
  }
  const r = await atualizarModelo(
    db,
    sessao.organizacaoId,
    id,
    op === "arquivar" ? { ativo: false } : op === "reativar" ? { ativo: true } : { dados: campos(form) },
    sessao.usuarioId,
  );
  revalidatePath("/painel/configuracoes/mensagens");
  return r.ok ? { ok: true, aviso: "Salvo." } : { erros: r.erros, mensagem: "Confira os campos destacados.", valores: campos(form) };
}
