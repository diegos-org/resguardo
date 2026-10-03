"use server";

import { revalidatePath } from "next/cache";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { recalcularReservas } from "@/financeiro/aplicar";
import type { ErrosContrato } from "./regras";
import { alterarBloqueioPortal, criarContrato, encerrarContrato } from "./repositorio";

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
    // Vale da data de início do contrato em diante (nunca antes de hoje).
    if (c.ok) await recalcularReservas(tx, sessao.organizacaoId, { imovelId: c.contrato.imovelId, aPartirDe: c.contrato.inicio }, sessao.usuarioId);
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
    // Só as reservas depois do novo fim do contrato mudam (nunca antes de hoje).
    if (e.ok) await recalcularReservas(tx, sessao.organizacaoId, { imovelId: e.imovelId, aPartirDe: e.fim }, sessao.usuarioId);
    return e;
  });
  if (!r.ok) return { mensagem: r.erro };
  revalidatePath(`/painel/imoveis/${r.imovelId}`);
  return { ok: true };
}

/** Liga/desliga o bloqueio de datas pelo portal num contrato (M5.5). Não mexe em comissão: nada a recalcular. */
export async function bloqueioPortal(_a: EstadoContrato, form: FormData): Promise<EstadoContrato> {
  const sessao = await sessaoFinanceira();
  const valor = String(form.get("permitir") ?? "");
  if (valor !== "sim" && valor !== "nao") return { mensagem: "Escolha se o proprietário pode bloquear datas pelo portal." };
  const r = await alterarBloqueioPortal(getDb(), sessao.organizacaoId, String(form.get("contratoId") ?? ""), valor === "sim", sessao.usuarioId);
  if (!r.ok) return { mensagem: r.erro };
  revalidatePath(`/painel/imoveis/${r.imovelId}`);
  return { ok: true };
}
