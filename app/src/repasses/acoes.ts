"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { hojeISO } from "@/lib/datas";
import { estornarRepasse, fecharMes, limitesDoMes, marcarRepassePago } from "./repasses";

async function sessaoEditora() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "financeiro:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

const voltar = (mes: string, r: { ok: boolean; erro?: string }, sucesso: string) => {
  revalidatePath("/painel/financeiro/repasses");
  revalidatePath("/painel/despesas", "layout");
  const m = limitesDoMes(mes) ? mes : "";
  redirect(`/painel/financeiro/repasses?${m ? `mes=${m}&` : ""}${r.ok ? `salvo=${sucesso}` : `erro=${encodeURIComponent(r.erro ?? "Não foi possível.")}`}`);
};

export async function fecharMesAcao(form: FormData): Promise<void> {
  const sessao = await sessaoEditora();
  const mes = String(form.get("mes") ?? "");
  voltar(mes, await fecharMes(getDb(), sessao.organizacaoId, String(form.get("proprietarioId") ?? ""), mes, hojeISO(), sessao.usuarioId), "fechado");
}

export async function pagarRepasseAcao(form: FormData): Promise<void> {
  const sessao = await sessaoEditora();
  const mes = String(form.get("mes") ?? "");
  voltar(mes, await marcarRepassePago(getDb(), sessao.organizacaoId, String(form.get("id") ?? ""), String(form.get("data") ?? ""), hojeISO(), sessao.usuarioId), "pago");
}

export async function estornarRepasseAcao(form: FormData): Promise<void> {
  const sessao = await sessaoEditora();
  const mes = String(form.get("mes") ?? "");
  voltar(mes, await estornarRepasse(getDb(), sessao.organizacaoId, String(form.get("id") ?? ""), String(form.get("motivo") ?? ""), hojeISO(), sessao.usuarioId), "estornado");
}
