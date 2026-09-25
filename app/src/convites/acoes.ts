"use server";

import { nomeDaEmpresa } from "@/configuracoes/empresa";
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
import { enderecoDaRequisicao, enviarEmailConvite } from "./email";

export type EstadoConvite = { erro?: string; link?: string; email?: string; enviadoPorEmail?: boolean };

async function sessaoEditora() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "proprietario:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

async function endereco(caminho: string) {
  return enderecoDaRequisicao(await headers(), caminho);
}

export async function convidar(_a: EstadoConvite, form: FormData): Promise<EstadoConvite> {
  const sessao = await sessaoEditora();
  const proprietarioId = String(form.get("proprietarioId") ?? "");
  const r = await criarConvite(getDb(), sessao.organizacaoId, proprietarioId, String(form.get("email") ?? ""), sessao.usuarioId);
  if (!r.ok) return { erro: r.erro };
  const link = await endereco(`/convite/${r.token}`);
  const correio = correioDoAmbiente();
  const empresa = await nomeDaEmpresa(getDb(), sessao.organizacaoId);
  if (correio) {
    after(async () => {
      try {
        await enviarEmailConvite(correio, r.convite.email, empresa, link);
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
