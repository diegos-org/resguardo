"use server";

import { revalidatePath } from "next/cache";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { recalcularReservas } from "@/financeiro/aplicar";
import type { ErrosContrato } from "./regras";
import { criarContrato, encerrarContrato } from "./repositorio";

export type EstadoContrato = { erros?: ErrosContrato; ok?: boolean; mensagem?: string };

async function sessaoFinanceira() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "financeiro:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

export async function novoContrato(_a: EstadoContrato, form: FormData): Promise<EstadoContrato> {
  const sessao = await sessaoFinanceira();
  const imovelId = String(form.get("imovelId") ?? "");
  const r = await criarContrato(getDb(), sessao.organizacaoId, imovelId, Object.fromEntries(form), sessao.usuarioId);
  if (!r.ok) return { erros: r.erros };
  // Contrato novo muda a comissão das reservas desse imóvel: recalcula (idempotente).
  await recalcularReservas(getDb(), sessao.organizacaoId, { imovelId: r.contrato.imovelId }, sessao.usuarioId);
  revalidatePath(`/painel/imoveis/${imovelId}`);
  return { ok: true };
}

export async function encerrar(_a: EstadoContrato, form: FormData): Promise<EstadoContrato> {
  const sessao = await sessaoFinanceira();
  const r = await encerrarContrato(getDb(), sessao.organizacaoId, String(form.get("contratoId") ?? ""), String(form.get("fim") ?? ""), sessao.usuarioId);
  if (!r.ok) return { mensagem: r.erro };
  await recalcularReservas(getDb(), sessao.organizacaoId, { imovelId: r.imovelId }, sessao.usuarioId);
  revalidatePath(`/painel/imoveis/${r.imovelId}`);
  return { ok: true };
}
