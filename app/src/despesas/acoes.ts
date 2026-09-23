"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { estornar, LancamentoInvalido, mudarEstado } from "@/financeiro/ledger";
import { hojeISO } from "@/lib/datas";
import { dataValida } from "@/reservas/regras";
import { atualizarCategoria, criarCategoria, excluirCategoria } from "./categorias";
import { type ErrosDespesa, obterDespesa, registrarDespesa } from "./despesas";
import { lerFormDespesa } from "./formulario";

export type EstadoFormDespesa = { erros?: ErrosDespesa; mensagem?: string };
export type EstadoCategoria = { erro?: string; ok?: boolean };

async function sessaoEditora() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "despesa:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

export async function salvarDespesa(_a: EstadoFormDespesa, form: FormData): Promise<EstadoFormDespesa> {
  const sessao = await sessaoEditora();
  const lido = lerFormDespesa(Object.fromEntries(form));
  if (!lido.ok) return { erros: lido.erros, mensagem: "Confira os campos destacados." };
  const r = await registrarDespesa(getDb(), sessao.organizacaoId, lido.dados, sessao.usuarioId);
  if (!r.ok) return { erros: r.erros, mensagem: "Confira os campos destacados." };
  revalidatePath("/painel/despesas");
  redirect(`/painel/despesas/${r.lancamento.id}?salvo=1`);
}

export async function marcarPaga(form: FormData): Promise<void> {
  const sessao = await sessaoEditora();
  const id = String(form.get("id") ?? "");
  const data = String(form.get("dataPagamento") ?? "") || hojeISO();
  const db = getDb();
  const d = await obterDespesa(db, sessao.organizacaoId, id);
  if (!d || d.estornada || !dataValida(data)) redirect(`/painel/despesas/${id}?erro=pagamento`);
  await mudarEstado(db, sessao.organizacaoId, id, "realizado", sessao.usuarioId, data);
  revalidatePath(`/painel/despesas/${id}`);
  revalidatePath("/painel/despesas");
}

export async function estornarDespesa(form: FormData): Promise<void> {
  const sessao = await sessaoEditora();
  const id = String(form.get("id") ?? "");
  const motivo = String(form.get("motivo") ?? "").trim();
  const db = getDb();
  const d = await obterDespesa(db, sessao.organizacaoId, id);
  if (!d || d.estornada || !motivo) redirect(`/painel/despesas/${id}?erro=estorno`);
  try {
    await estornar(db, sessao.organizacaoId, id, motivo, sessao.usuarioId);
  } catch (e) {
    if (e instanceof LancamentoInvalido) redirect(`/painel/despesas/${id}?erro=estorno`);
    throw e;
  }
  revalidatePath(`/painel/despesas/${id}`);
  revalidatePath("/painel/despesas");
}

export async function novaCategoria(_a: EstadoCategoria, form: FormData): Promise<EstadoCategoria> {
  const sessao = await sessaoEditora();
  const r = await criarCategoria(getDb(), sessao.organizacaoId, String(form.get("nome") ?? ""), sessao.usuarioId);
  revalidatePath("/painel/despesas/categorias");
  return r.ok ? { ok: true } : { erro: r.erro };
}

export async function editarCategoria(_a: EstadoCategoria, form: FormData): Promise<EstadoCategoria> {
  const sessao = await sessaoEditora();
  const id = String(form.get("id") ?? "");
  const op = String(form.get("op") ?? "");
  const db = getDb();
  const r =
    op === "excluir"
      ? await excluirCategoria(db, sessao.organizacaoId, id, sessao.usuarioId)
      : await atualizarCategoria(
          db,
          sessao.organizacaoId,
          id,
          op === "arquivar" ? { ativa: false } : op === "reativar" ? { ativa: true } : { nome: String(form.get("nome") ?? "") },
          sessao.usuarioId,
        );
  revalidatePath("/painel/despesas/categorias");
  return r.ok ? { ok: true } : { erro: r.erro };
}
