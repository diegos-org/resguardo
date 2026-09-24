"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { ORIGENS_RESERVA } from "@/db/schema";
import { criarPeriodo, type ErrosDetalhes, excluirPeriodo, salvarDetalhes, validarDetalhes } from "./detalhes";
import { type ConfigRecebimento, salvarRecebimento } from "./recebimento";
import { atualizarImovel, CodigoDuplicado, criarImovel } from "./repositorio";
import { type ErrosImovel, validarImovel } from "./validacao";

export type EstadoFormImovel = { erros?: ErrosImovel; mensagem?: string };

export async function salvarImovel(_anterior: EstadoFormImovel, form: FormData): Promise<EstadoFormImovel> {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "imovel:editar", { organizacaoId: sessao.organizacaoId });

  const resultado = validarImovel(Object.fromEntries(form));
  if (!resultado.ok) return { erros: resultado.erros, mensagem: "Confira os campos destacados." };

  const id = form.get("id");
  try {
    if (typeof id === "string" && id) {
      const salvo = await atualizarImovel(getDb(), sessao.organizacaoId, id, resultado.dados, sessao.usuarioId);
      if (!salvo) return { mensagem: "Imóvel não encontrado." };
    } else {
      await criarImovel(getDb(), sessao.organizacaoId, resultado.dados, sessao.usuarioId);
    }
  } catch (e) {
    if (e instanceof CodigoDuplicado) return { erros: { codigo: e.message }, mensagem: "Confira os campos destacados." };
    throw e;
  }

  revalidatePath("/painel", "layout");
  redirect("/painel/imoveis?salvo=1");
}

export type EstadoRecebimento = { ok?: boolean; mensagem?: string };

/** "Quem recebe o pagamento" por canal, para este imóvel. Só quem edita o financeiro. */
export async function salvarRecebimentoAcao(_a: EstadoRecebimento, form: FormData): Promise<EstadoRecebimento> {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "financeiro:editar", { organizacaoId: sessao.organizacaoId });
  const imovelId = String(form.get("imovelId") ?? "");
  const config: ConfigRecebimento = {};
  for (const origem of ORIGENS_RESERVA) {
    const v = String(form.get(`recebimento_${origem}`) ?? "");
    if (v === "split" || v === "empresa") config[origem] = v;
  }
  const ok = await salvarRecebimento(getDb(), sessao.organizacaoId, imovelId, config, sessao.usuarioId);
  if (!ok) return { mensagem: "Não foi possível salvar." };
  revalidatePath(`/painel/imoveis/${imovelId}`);
  return { ok: true };
}

// --- Cadastro completo (M2.6) ----------------------------------------------------------

export type EstadoDetalhes = { ok?: boolean; mensagem?: string; erros?: ErrosDetalhes; valores?: Record<string, string | string[]> };

/** Formulário → objeto, mantendo como lista os campos que se repetem (comodidades, dias). */
function lerForm(form: FormData): Record<string, string | string[]> {
  const saida: Record<string, string | string[]> = {};
  for (const k of new Set(form.keys())) {
    if (k.startsWith("$ACTION")) continue; // campos internos do Next.js
    const vs = form.getAll(k).filter((v): v is string => typeof v === "string");
    saida[k] = ["comodidades", "diasChegada", "diasSaida"].includes(k) ? vs : (vs[0] ?? "");
  }
  return saida;
}

export async function salvarDetalhesAcao(_a: EstadoDetalhes, form: FormData): Promise<EstadoDetalhes> {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "imovel:editar", { organizacaoId: sessao.organizacaoId });
  const imovelId = String(form.get("imovelId") ?? "");
  const valores = lerForm(form);
  const v = validarDetalhes(valores);
  if (!v.ok) return { erros: v.erros, mensagem: "Confira os campos destacados.", valores };
  if (!(await salvarDetalhes(getDb(), sessao.organizacaoId, imovelId, v.dados, sessao.usuarioId))) return { mensagem: "Imóvel não encontrado." };
  revalidatePath(`/painel/imoveis/${imovelId}`);
  return { ok: true };
}

export type EstadoPeriodo = { ok?: boolean; erro?: string; valores?: Record<string, string> };

export async function novoPeriodoAcao(_a: EstadoPeriodo, form: FormData): Promise<EstadoPeriodo> {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "imovel:editar", { organizacaoId: sessao.organizacaoId });
  const imovelId = String(form.get("imovelId") ?? "");
  const valores = lerForm(form) as Record<string, string>;
  const r = await criarPeriodo(getDb(), sessao.organizacaoId, imovelId, valores, sessao.usuarioId);
  revalidatePath(`/painel/imoveis/${imovelId}`);
  return r.ok ? { ok: true } : { erro: r.erro, valores };
}

export async function excluirPeriodoAcao(form: FormData): Promise<void> {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "imovel:editar", { organizacaoId: sessao.organizacaoId });
  await excluirPeriodo(getDb(), sessao.organizacaoId, String(form.get("id") ?? ""), sessao.usuarioId);
  revalidatePath(`/painel/imoveis/${String(form.get("imovelId") ?? "")}`);
}
