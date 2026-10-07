"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getDb } from "@/db/client";
import { correioDoAmbiente } from "@/email/correio";
import { loginCodigoConfigurado, signIn } from "./auth";
import { pedirCodigo } from "./codigo-email";
import { lerAdminEmails } from "./entrada";
import { loginBloqueado } from "./senha";

const paraCodigo = (email: string, erro?: string) => `/entrar?etapa=codigo&email=${encodeURIComponent(email)}${erro ? `&erro=${erro}` : ""}`;

export async function pedirCodigoAcao(form: FormData): Promise<void> {
  const correio = correioDoAmbiente();
  if (!loginCodigoConfigurado || !correio) redirect("/entrar");
  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  if (!email) redirect("/entrar?erro=email-vazio");
  // Tudo depois da resposta: a tela é igual para qualquer e-mail, com ou sem acesso,
  // e mesmo se o provedor de e-mail falhar.
  after(async () => {
    try {
      const r = await pedirCodigo(getDb(), correio, email, { segredo: process.env.AUTH_SECRET!, adminEmails: lerAdminEmails(process.env.ADMIN_EMAILS) });
      if (r === "limite") console.warn("[entrar] limite de códigos atingido");
    } catch (e) {
      console.error("[entrar] falha ao enviar código", e);
    }
  });
  redirect(paraCodigo(email));
}

export async function entrarComCodigo(form: FormData): Promise<void> {
  const email = String(form.get("email") ?? "").slice(0, 200);
  const codigo = String(form.get("codigo") ?? "").slice(0, 20);
  try {
    await signIn("codigo", { email, codigo, redirectTo: "/painel" });
  } catch (e) {
    // Sucesso também "lança" (é o redirecionamento do Next): só o erro de login é tratado aqui.
    if (e instanceof AuthError) redirect(paraCodigo(email, "codigo"));
    throw e;
  }
}

const paraSenha = (login: string, erro: string) => `/entrar?etapa=senha&login=${encodeURIComponent(login)}&erro=${erro}`;

/**
 * Usuário (ou e-mail) e senha (M6.8). A espera depois de muitos erros é conferida antes, para a tela dizer "espere"
 * sem gastar tentativa; o erro diz só "não confere" (não revela se o usuário existe).
 */
export async function entrarComSenhaAcao(form: FormData): Promise<void> {
  const login = String(form.get("login") ?? "").trim().slice(0, 200);
  const senha = String(form.get("senha") ?? "").slice(0, 200);
  if (!login || !senha) redirect(paraSenha(login, "senha-vazia"));
  if (await loginBloqueado(getDb(), login)) redirect(paraSenha(login, "espere"));
  try {
    await signIn("senha", { login, senha, redirectTo: "/painel" });
  } catch (e) {
    // Sucesso também "lança" (é o redirecionamento do Next): só o erro de login é tratado aqui.
    if (e instanceof AuthError) redirect(paraSenha(login, (await loginBloqueado(getDb(), login)) ? "espere" : "senha"));
    throw e;
  }
}
