"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AcessoNegado, type Sessao } from "@/acesso/politica";
import { obterSessao } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { hojeISO } from "@/lib/datas";
import { periodicidadeValida } from "@/repasses/periodicidade";
import { escolherPeriodicidade } from "@/repasses/proprietario";
import { gerarAntecipado } from "@/repasses/repasses";
import { bloquearPeloProprietario, liberarPeloProprietario } from "./bloqueios";
import { proprietariosDoUsuario } from "./resumo";

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

/** O proprietário informado é um dos do usuário logado? (deny-by-default) */
async function donoDoUsuario(sessao: Sessao, proprietarioId: string): Promise<boolean> {
  return (await proprietariosDoUsuario(getDb(), sessao.organizacaoId, sessao.usuarioId)).some((d) => d.id === proprietarioId);
}

const voltarPortal = (ok: boolean, chave: string, erro?: string) => {
  revalidatePath("/portal");
  redirect(`/portal?${ok ? `salvo=${chave}` : `erro=${encodeURIComponent(erro ?? "Não foi possível.")}`}#repasses`);
};

/** Portal → "Como quer receber": a escolha vale a partir do próximo repasse (vazio = padrão do contrato). */
export async function escolherPeriodicidadeAcao(form: FormData): Promise<void> {
  const sessao = await sessaoDoPortal();
  const proprietarioId = texto(form, "proprietarioId");
  if (!(await donoDoUsuario(sessao, proprietarioId))) return voltarPortal(false, "", "Você não tem acesso a este cadastro.");
  const escolha = texto(form, "periodicidade");
  const r = await escolherPeriodicidade(getDb(), sessao.organizacaoId, proprietarioId, periodicidadeValida(escolha) ? escolha : null, sessao.usuarioId, { peloProprietario: true });
  voltarPortal(r.ok, "periodicidade", r.ok ? undefined : r.erro);
}

/** Portal → "Pedir repasse agora": antecipado avulso com o que está disponível (nunca no dia 1º). */
export async function pedirRepasseAcao(form: FormData): Promise<void> {
  const sessao = await sessaoDoPortal();
  const proprietarioId = texto(form, "proprietarioId");
  if (!(await donoDoUsuario(sessao, proprietarioId))) return voltarPortal(false, "", "Você não tem acesso a este cadastro.");
  const r = await gerarAntecipado(getDb(), sessao.organizacaoId, proprietarioId, hojeISO(), sessao.usuarioId, { pedidoPeloProprietario: true });
  voltarPortal(r.ok, "repasse", r.ok ? undefined : r.erro);
}
