"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AcessoNegado, type Sessao } from "@/acesso/politica";
import { obterSessao } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { bloquearPeloProprietario, liberarPeloProprietario } from "./bloqueios";

export type EstadoBloqueioPortal = { ok?: boolean; erro?: string; valores?: Record<string, string> };

async function sessaoDoPortal(): Promise<Sessao> {
  const sessao = await obterSessao();
  if (!sessao) redirect("/entrar");
  if (sessao.papel !== "proprietario") redirect("/painel");
  return sessao;
}

const texto = (form: FormData, k: string) => String(form.get(k) ?? "");

export async function bloquearDatasAcao(_a: EstadoBloqueioPortal, form: FormData): Promise<EstadoBloqueioPortal> {
  const sessao = await sessaoDoPortal();
  const valores = { imovelId: texto(form, "imovelId"), inicio: texto(form, "inicio"), fim: texto(form, "fim"), motivo: texto(form, "motivo") };
  try {
    const r = await bloquearPeloProprietario(getDb(), sessao, valores);
    revalidatePath("/portal");
    return r.ok ? { ok: true } : { erro: r.erro, valores };
  } catch (e) {
    if (e instanceof AcessoNegado) return { erro: "Você não tem acesso a este imóvel.", valores };
    throw e;
  }
}

export async function liberarDatasAcao(_a: EstadoBloqueioPortal, form: FormData): Promise<EstadoBloqueioPortal> {
  const sessao = await sessaoDoPortal();
  try {
    const r = await liberarPeloProprietario(getDb(), sessao, texto(form, "id"));
    revalidatePath("/portal");
    return r.ok ? { ok: true } : { erro: r.erro };
  } catch (e) {
    if (e instanceof AcessoNegado) return { erro: "Você não tem acesso a este imóvel." };
    throw e;
  }
}
