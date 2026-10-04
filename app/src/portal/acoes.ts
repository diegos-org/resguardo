"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AcessoNegado, type Sessao } from "@/acesso/politica";
import { obterSessao } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import type { EstadoPeriodo } from "@/imoveis/acoes";
import { bloquearPeloProprietario, liberarPeloProprietario } from "./bloqueios";
import { criarPeriodoPeloProprietario, excluirPeriodoPeloProprietario, marcarLimpezaFeitaPeloProprietario, registrarManutencaoPeloProprietario, salvarPrecosPeloProprietario } from "./marketplace";

export type EstadoBloqueioPortal = { ok?: boolean; erro?: string; valores?: Record<string, string> };
/** Formulário de preços e regras do portal marketplace (M12.4): erros por campo e o que foi digitado. */
export type EstadoPrecosPortal = { ok?: boolean; mensagem?: string; erros?: Record<string, string>; valores?: Record<string, string | string[]> };
export type EstadoSimplesPortal = { ok?: boolean; erro?: string; valores?: Record<string, string> };

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

const SEM_ACESSO = "Você não tem acesso a este imóvel.";

function lerForm(form: FormData): Record<string, string | string[]> {
  const saida: Record<string, string | string[]> = {};
  for (const k of new Set(form.keys())) {
    if (k.startsWith("$ACTION")) continue;
    const vs = form.getAll(k).filter((v): v is string => typeof v === "string");
    saida[k] = ["diasChegada", "diasSaida"].includes(k) ? vs : (vs[0] ?? "");
  }
  return saida;
}

// --- Marketplace (M12.4): preços, regras, períodos, limpezas e manutenção pelo proprietário ---

export async function salvarPrecosPortalAcao(_a: EstadoPrecosPortal, form: FormData): Promise<EstadoPrecosPortal> {
  const sessao = await sessaoDoPortal();
  const imovelId = texto(form, "imovelId");
  const valores = lerForm(form);
  try {
    const r = await salvarPrecosPeloProprietario(getDb(), sessao, imovelId, valores);
    revalidatePath("/portal");
    return r.ok ? { ok: true } : { mensagem: r.erro, erros: r.erros as Record<string, string> | undefined, valores };
  } catch (e) {
    if (e instanceof AcessoNegado) return { mensagem: SEM_ACESSO, valores };
    throw e;
  }
}

export async function novoPeriodoPortalAcao(_a: EstadoPeriodo, form: FormData): Promise<EstadoPeriodo> {
  const sessao = await sessaoDoPortal();
  const imovelId = texto(form, "imovelId");
  const valores = Object.fromEntries(Object.entries(lerForm(form)).map(([k, v]) => [k, Array.isArray(v) ? (v[0] ?? "") : v]));
  try {
    const r = await criarPeriodoPeloProprietario(getDb(), sessao, imovelId, valores);
    revalidatePath("/portal");
    return r.ok ? { ok: true } : { erro: r.erro, valores };
  } catch (e) {
    if (e instanceof AcessoNegado) return { erro: SEM_ACESSO, valores };
    throw e;
  }
}

export async function excluirPeriodoPortalAcao(form: FormData): Promise<void> {
  const sessao = await sessaoDoPortal();
  try {
    await excluirPeriodoPeloProprietario(getDb(), sessao, texto(form, "id"));
  } catch (e) {
    if (!(e instanceof AcessoNegado)) throw e;
  }
  revalidatePath("/portal");
}

export async function marcarLimpezaFeitaPortalAcao(_a: EstadoSimplesPortal, form: FormData): Promise<EstadoSimplesPortal> {
  const sessao = await sessaoDoPortal();
  try {
    const r = await marcarLimpezaFeitaPeloProprietario(getDb(), sessao, texto(form, "id"), new Date());
    revalidatePath("/portal");
    return r.ok ? { ok: true } : { erro: r.erro };
  } catch (e) {
    if (e instanceof AcessoNegado) return { erro: SEM_ACESSO };
    throw e;
  }
}

export async function registrarManutencaoPortalAcao(_a: EstadoSimplesPortal, form: FormData): Promise<EstadoSimplesPortal> {
  const sessao = await sessaoDoPortal();
  const valores = { imovelId: texto(form, "imovelId"), titulo: texto(form, "titulo"), descricao: texto(form, "descricao"), data: texto(form, "data") };
  try {
    const r = await registrarManutencaoPeloProprietario(getDb(), sessao, valores, new Date());
    revalidatePath("/portal");
    return r.ok ? { ok: true } : { erro: r.erro, valores };
  } catch (e) {
    if (e instanceof AcessoNegado) return { erro: SEM_ACESSO, valores };
    throw e;
  }
}
