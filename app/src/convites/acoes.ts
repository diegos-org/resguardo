"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { correioDoAmbiente } from "@/email/correio";
import { criarConvite, lerConvite, revogarConvite } from "./convites";
import { guardarTokenConvite } from "./cookie";

export type EstadoConvite = { erro?: string; link?: string; email?: string; enviadoPorEmail?: boolean };

async function sessaoEditora() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "proprietario:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

async function endereco(caminho: string) {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}${caminho}`;
}

export async function convidar(_a: EstadoConvite, form: FormData): Promise<EstadoConvite> {
  const sessao = await sessaoEditora();
  const proprietarioId = String(form.get("proprietarioId") ?? "");
  const r = await criarConvite(getDb(), sessao.organizacaoId, proprietarioId, String(form.get("email") ?? ""), sessao.usuarioId);
  if (!r.ok) return { erro: r.erro };
  const link = await endereco(`/convite/${r.token}`);
  const correio = correioDoAmbiente();
  if (correio) {
    after(async () => {
      try {
        await correio.enviar({
          para: r.convite.email,
          assunto: "Convite para o portal da Sua Casa Leblon",
          texto: `Olá! Você foi convidado para acompanhar seus imóveis no portal da Sua Casa Leblon.\n\nAbra o link abaixo e entre com este e-mail (${r.convite.email}). O convite vale por 7 dias e só pode ser usado uma vez.\n\n${link}\n\nSe você não esperava este convite, ignore este e-mail.`,
        });
      } catch (e) {
        console.error("[convite] falha ao enviar e-mail", e);
      }
    });
  }
  revalidatePath(`/painel/proprietarios/${proprietarioId}`);
  return { link, email: r.convite.email, enviadoPorEmail: Boolean(correio) };
}

export async function revogar(form: FormData): Promise<void> {
  const sessao = await sessaoEditora();
  const proprietarioId = String(form.get("proprietarioId") ?? "");
  await revogarConvite(getDb(), sessao.organizacaoId, String(form.get("conviteId") ?? ""), sessao.usuarioId);
  revalidatePath(`/painel/proprietarios/${proprietarioId}`);
}

/** Botão da página do link: lembra o convite (cookie curto) e leva para o login com o e-mail. */
export async function seguirConvite(form: FormData): Promise<void> {
  const token = String(form.get("token") ?? "");
  const r = await lerConvite(getDb(), token);
  if (!r.ok) redirect(`/convite/${encodeURIComponent(token)}`);
  await guardarTokenConvite(token);
  redirect(`/entrar?email=${encodeURIComponent(r.convite.email)}`);
}
