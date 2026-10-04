"use server";

import { revalidatePath } from "next/cache";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { hojeISO } from "@/lib/datas";
import { TIPOS_MENSAGEM_HOSPEDE } from "@/db/schema";
import { salvarConfigMensagens } from "@/mensagens/hospede";
import { type ErrosEmpresa, salvarEmpresa, validarEmpresa } from "./empresa";
import { atualizarModelo, criarModelo, type ErrosModelo, excluirModelo } from "./modelos";
import { lerFormRegras } from "./regras-financeiras";
import { salvarRegrasFinanceiras } from "./salvar-regras";
import { publicarComoFunciona, validarSecoes } from "./como-funciona";
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

/** "Como funciona" para o proprietário (M5.6): publica uma versão nova quando o texto mudou. */
export async function publicarComoFuncionaAcao(_a: EstadoForm<Record<string, string>>, form: FormData): Promise<EstadoForm<Record<string, string>>> {
  const sessao = await sessaoConfig();
  const v = validarSecoes(campos(form));
  if (!v.ok) return { erros: v.erros, mensagem: v.mensagem, valores: campos(form) };
  // A versão que o formulário mostrava: publicar por cima de uma versão que outra pessoa acabou de publicar é recusado.
  const base = String(form.get("versaoBase") ?? "");
  if (!/^\d{1,6}$/.test(base)) return { mensagem: "Recarregue a página e tente de novo.", valores: campos(form) };
  const r = await publicarComoFunciona(getDb(), sessao.organizacaoId, v.secoes, sessao.usuarioId, hojeISO(), Number(base));
  // Recusado (outra pessoa publicou no meio): a página não é revalidada — o texto digitado e a versão base que o formulário
  // declarava ficam como estavam (os valores devolvidos trazem `versaoBase`), e reenviar sem recarregar é recusado de novo.
  // Só a recarga explícita troca o texto e a base pela versão nova (4ª rodada do Codex).
  if (!r.ok) return { mensagem: r.erro, valores: campos(form) };
  revalidatePath("/painel/configuracoes/como-funciona");
  revalidatePath("/portal", "layout");
  const data = r.versao.data.split("-").reverse().join("/");
  return { ok: true, aviso: r.mudou ? `Versão ${r.versao.numero} publicada em ${data}. Cada proprietário vai ler e aceitar no portal; quem já tinha aceitado a anterior precisa aceitar de novo.` : `Nada mudou no texto: a versão ${r.versao.numero}, de ${data}, continua valendo.` };
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

// --- Mensagens automáticas ao hóspede (M9.2) --------------------------------------------

export async function salvarMensagensAcao(_a: EstadoForm, form: FormData): Promise<EstadoForm> {
  const sessao = await sessaoConfig();
  const modelos = Object.fromEntries(TIPOS_MENSAGEM_HOSPEDE.map((t) => [t, String(form.get(`modelo_${t}`) ?? "")]));
  const r = await salvarConfigMensagens(
    getDb(),
    sessao.organizacaoId,
    { ativo: form.get("ativo") === "on", origens: form.getAll("origens").map(String), modelos },
    sessao.usuarioId,
  );
  revalidatePath("/painel/configuracoes/mensagens");
  return r.ok ? { ok: true, aviso: "Mensagens automáticas salvas." } : { mensagem: r.erro };
}
