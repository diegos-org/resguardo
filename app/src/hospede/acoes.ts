"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getDb } from "@/db/client";
import { correioDoAmbiente } from "@/email/correio";
import { organizacaoDoSite } from "@/site/site";
import { pedirCodigoHospede, verificarCodigoHospede } from "./portal";
import { COOKIE_HOSPEDE, criarSessaoHospede, VALIDADE_SESSAO_HOSPEDE_MS } from "./sessao";

const ENTRAR = "/hospede/entrar";
const paraCodigo = (email: string, erro?: string) => `${ENTRAR}?etapa=codigo&email=${encodeURIComponent(email)}${erro ? `&erro=${erro}` : ""}`;

export async function pedirCodigoHospedeAcao(form: FormData): Promise<void> {
  const correio = correioDoAmbiente();
  if (!process.env.AUTH_SECRET || !correio) redirect(ENTRAR);
  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  if (!email) redirect(`${ENTRAR}?erro=email-vazio`);
  // Tudo depois da resposta: a tela é igual para qualquer e-mail, com ou sem reserva.
  after(async () => {
    try {
      const db = getDb();
      // Só reservas da empresa deste site.
      const organizacaoId = await organizacaoDoSite(db);
      if (!organizacaoId) return;
      const r = await pedirCodigoHospede(db, correio, organizacaoId, email, { segredo: process.env.AUTH_SECRET! });
      if (r === "limite") console.warn("[hospede] limite de códigos atingido");
    } catch (e) {
      console.error("[hospede] falha ao enviar código", e);
    }
  });
  redirect(paraCodigo(email));
}

export async function entrarHospede(form: FormData): Promise<void> {
  const segredo = process.env.AUTH_SECRET;
  if (!segredo) redirect(ENTRAR);
  const email = String(form.get("email") ?? "").slice(0, 200);
  const codigo = String(form.get("codigo") ?? "").slice(0, 20);
  const db = getDb();
  const organizacaoId = await organizacaoDoSite(db);
  if (!organizacaoId) redirect(ENTRAR);
  const r = await verificarCodigoHospede(db, organizacaoId, email, codigo, { segredo });
  if (!r.ok) redirect(paraCodigo(email, "codigo"));
  const agora = new Date();
  (await cookies()).set(COOKIE_HOSPEDE, criarSessaoHospede(r.email, segredo, agora), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/hospede",
    maxAge: VALIDADE_SESSAO_HOSPEDE_MS / 1000,
  });
  redirect("/hospede");
}

export async function sairHospede(): Promise<void> {
  (await cookies()).delete({ name: COOKIE_HOSPEDE, path: "/hospede" });
  redirect(ENTRAR);
}
