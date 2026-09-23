"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { correioDoAmbiente } from "@/email/correio";
import { loginCodigoConfigurado, signIn } from "./auth";
import { pedirCodigo } from "./codigo-email";
import { lerAdminEmails } from "./entrada";

const paraCodigo = (email: string, erro?: string) => `/entrar?etapa=codigo&email=${encodeURIComponent(email)}${erro ? `&erro=${erro}` : ""}`;

export async function pedirCodigoAcao(form: FormData): Promise<void> {
  const correio = correioDoAmbiente();
  if (!loginCodigoConfigurado || !correio) redirect("/entrar");
  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  if (!email) redirect("/entrar?erro=email-vazio");
  let r: Awaited<ReturnType<typeof pedirCodigo>>;
  try {
    r = await pedirCodigo(getDb(), correio, email, { segredo: process.env.AUTH_SECRET!, adminEmails: lerAdminEmails(process.env.ADMIN_EMAILS) });
  } catch (e) {
    console.error("[entrar] falha ao enviar código", e);
    redirect("/entrar?erro=envio");
  }
  redirect(r === "limite" ? "/entrar?erro=limite" : paraCodigo(email));
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
