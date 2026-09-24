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
  // Contrato novo muda a comissão das reservas desse imóvel: grava e recalcula juntos
  // (tudo-ou-nada: se o recálculo falhar, o contrato também não é gravado).
  const r = await getDb().transaction(async (tx) => {
    const c = await criarContrato(tx, sessao.organizacaoId, imovelId, Object.fromEntries(form), sessao.usuarioId);
    if (c.ok) await recalcularReservas(tx, sessao.organizacaoId, { imovelId: c.contrato.imovelId }, sessao.usuarioId);
    return c;
  });
  if (!r.ok) return { erros: r.erros };
  revalidatePath(`/painel/imoveis/${imovelId}`);
  return { ok: true };
}

export async function encerrar(_a: EstadoContrato, form: FormData): Promise<EstadoContrato> {
  const sessao = await sessaoFinanceira();
  const r = await getDb().transaction(async (tx) => {
    const e = await encerrarContrato(tx, sessao.organizacaoId, String(form.get("contratoId") ?? ""), String(form.get("fim") ?? ""), sessao.usuarioId);
    if (e.ok) await recalcularReservas(tx, sessao.organizacaoId, { imovelId: e.imovelId }, sessao.usuarioId);
    return e;
  });
  if (!r.ok) return { mensagem: r.erro };
  revalidatePath(`/painel/imoveis/${r.imovelId}`);
  return { ok: true };
}
