"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { nomeDaEmpresa } from "@/configuracoes/empresa";
import { enderecoDaRequisicao, enviarEmailConvite } from "@/convites/email";
import { getDb } from "@/db/client";
import { correioDoAmbiente } from "@/email/correio";
import { criarToken } from "@/lib/token-assinado";
import { organizacaoDoSite } from "@/site/site";
import { COOKIE_CADASTRO, emailDoCadastro, INICIO_CADASTRO, VALIDADE_SESSAO_CADASTRO_MS } from "./sessao";
import { aprovarCadastro, type ErrosCadastro, enviarCadastro, pedirCodigoCadastro, recusarCadastro, validarCadastro, verificarCodigoCadastro } from "./cadastro";

const INICIO = INICIO_CADASTRO;
const COOKIE = COOKIE_CADASTRO;
const VALIDADE_MS = VALIDADE_SESSAO_CADASTRO_MS;
const paraCodigo = (email: string, erro?: string) => `${INICIO}?etapa=codigo&email=${encodeURIComponent(email)}${erro ? `&erro=${erro}` : ""}`;

export async function pedirCodigoCadastroAcao(form: FormData): Promise<void> {
  const correio = correioDoAmbiente();
  if (!process.env.AUTH_SECRET || !correio) redirect(INICIO);
  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  if (!email) redirect(`${INICIO}?erro=email-vazio`);
  // Depois da resposta: a tela é a mesma para qualquer e-mail, e falha do provedor não aparece.
  after(async () => {
    try {
      const db = getDb();
      const organizacaoId = await organizacaoDoSite(db);
      if (!organizacaoId) return;
      const r = await pedirCodigoCadastro(db, correio, organizacaoId, email, { segredo: process.env.AUTH_SECRET! });
      if (r === "limite") console.warn("[cadastro] limite de códigos atingido");
    } catch (e) {
      console.error("[cadastro] falha ao enviar código", e);
    }
  });
  redirect(paraCodigo(email));
}

export async function entrarCadastroAcao(form: FormData): Promise<void> {
  const segredo = process.env.AUTH_SECRET;
  if (!segredo) redirect(INICIO);
  const email = String(form.get("email") ?? "").slice(0, 200);
  const codigo = String(form.get("codigo") ?? "").slice(0, 20);
  const r = await verificarCodigoCadastro(getDb(), email, codigo, { segredo });
  if (!r.ok) redirect(paraCodigo(email, "codigo"));
  (await cookies()).set(COOKIE, criarToken("cadastro-marketplace:sessao:v1", r.email, segredo, new Date(), VALIDADE_MS), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: INICIO,
    maxAge: VALIDADE_MS / 1000,
  });
  redirect(`${INICIO}/dados`);
}

export type EstadoCadastro = { erros?: ErrosCadastro; mensagem?: string; valores?: Record<string, string> };

export async function enviarCadastroAcao(_a: EstadoCadastro, form: FormData): Promise<EstadoCadastro> {
  const email = await emailDoCadastro();
  if (!email) redirect(INICIO);
  const valores = Object.fromEntries([...form.entries()].filter((e): e is [string, string] => typeof e[1] === "string" && !e[0].startsWith("$ACTION")));
  const v = validarCadastro(valores);
  if (!v.ok) return { erros: v.erros, mensagem: "Confira os campos destacados.", valores };
  const db = getDb();
  const organizacaoId = await organizacaoDoSite(db);
  if (!organizacaoId) return { mensagem: "O cadastro ainda não está disponível. Fale com a gente pelo contato do site.", valores };
  const r = await enviarCadastro(db, organizacaoId, email, v.dados, new Date());
  if (!r.ok) return { mensagem: r.erro, valores };
  (await cookies()).delete({ name: COOKIE, path: INICIO });
  redirect(`${INICIO}/enviado`);
}

// --- Painel: revisão dos cadastros ---------------------------------------------------------

async function sessaoRevisora() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "proprietario:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

export type EstadoDecisao = { erro?: string; ok?: string };

export async function aprovarCadastroAcao(_a: EstadoDecisao, form: FormData): Promise<EstadoDecisao> {
  const sessao = await sessaoRevisora();
  const db = getDb();
  const r = await aprovarCadastro(db, sessao.organizacaoId, String(form.get("id") ?? ""), String(form.get("codigo") ?? ""), sessao.usuarioId);
  if (!r.ok) return { erro: r.erro };
  const link = enderecoDaRequisicao(await headers(), `/convite/${r.token}`);
  const correio = correioDoAmbiente();
  const empresa = await nomeDaEmpresa(db, sessao.organizacaoId);
  if (correio) {
    after(async () => {
      try {
        await enviarEmailConvite(correio, r.email, empresa, link);
      } catch (e) {
        console.error("[cadastro] falha ao enviar convite", e);
      }
    });
  }
  revalidatePath("/painel/proprietarios/cadastros");
  revalidatePath("/painel/proprietarios");
  return {
    ok: correio
      ? `Aprovado. O convite do portal foi enviado para ${r.email}.`
      : `Aprovado. O e-mail do sistema não está configurado: envie este link para ${r.email}: ${link}`,
  };
}

export async function recusarCadastroAcao(_a: EstadoDecisao, form: FormData): Promise<EstadoDecisao> {
  const sessao = await sessaoRevisora();
  const r = await recusarCadastro(getDb(), sessao.organizacaoId, String(form.get("id") ?? ""), String(form.get("motivo") ?? "").slice(0, 600), sessao.usuarioId);
  revalidatePath("/painel/proprietarios/cadastros");
  return r.ok ? { ok: "Recusado. O motivo ficou registrado." } : { erro: r.erro };
}
