"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigir, podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { lerFormReserva } from "./formulario";
import type { ErrosReserva } from "./regras";
import { analisarCsv, importarCsv, type ResultadoImportacao, type SituacaoLinha } from "./importacao";
import { cancelarReserva, confirmarReserva, criarReserva, resolverConferencia } from "./repositorio";

export type EstadoFormReserva = { erros?: ErrosReserva; mensagem?: string };

export async function salvarNovaReserva(_a: EstadoFormReserva, form: FormData): Promise<EstadoFormReserva> {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "reserva:editar", { organizacaoId: sessao.organizacaoId });
  const entrada = Object.fromEntries(form);
  // Valores financeiros só são aceitos de quem pode editar o financeiro.
  if (!podeFazer(sessao.papel, "financeiro:editar")) {
    for (const campo of ["valorBruto", "taxaCanal", "valorLiquido", "recebimento"]) delete entrada[campo];
  }
  const lido = lerFormReserva(entrada);
  if (!lido.ok) return { erros: lido.erros, mensagem: "Confira os campos destacados." };
  const r = await criarReserva(getDb(), sessao.organizacaoId, lido.dados, sessao.usuarioId);
  if (!r.ok) return { erros: r.erros, mensagem: "Confira os campos destacados." };
  revalidatePath("/painel/reservas");
  redirect(`/painel/reservas/${r.reserva.id}?salvo=1`);
}

export async function cancelar(form: FormData): Promise<void> {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "reserva:editar", { organizacaoId: sessao.organizacaoId });
  const id = String(form.get("id") ?? "");
  await cancelarReserva(getDb(), sessao.organizacaoId, id, sessao.usuarioId);
  revalidatePath(`/painel/reservas/${id}`);
  revalidatePath("/painel/reservas");
}

export async function confirmar(form: FormData): Promise<void> {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "reserva:editar", { organizacaoId: sessao.organizacaoId });
  const id = String(form.get("id") ?? "");
  const r = await confirmarReserva(getDb(), sessao.organizacaoId, id, sessao.usuarioId);
  revalidatePath(`/painel/reservas/${id}`);
  revalidatePath("/painel/reservas");
  if (r.aviso) redirect(`/painel/reservas/${id}?erro=${encodeURIComponent(r.aviso)}`);
}

/** Dá por resolvida a conferência de reserva não confirmada com dinheiro movimentado (M4.8). */
export async function resolverConferenciaAcao(form: FormData): Promise<void> {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "financeiro:editar", { organizacaoId: sessao.organizacaoId });
  const id = String(form.get("id") ?? "");
  await resolverConferencia(getDb(), sessao.organizacaoId, id, sessao.usuarioId);
  revalidatePath(`/painel/reservas/${id}`);
  revalidatePath("/painel");
}

// --- Importação por CSV (M3.6) --------------------------------------------------------

export type LinhaConferida = { numero: number; situacao: SituacaoLinha; resumo: string; erros: string[]; avisos: string[] };
/**
 * Conferência e importação são ações separadas, cada uma com o seu estado: a lista conferida
 * nunca volta ao servidor junto com o arquivo (limite de 1 MB por envio).
 */
export type EstadoConferencia = { erroGeral?: string; colunasIgnoradas?: string[]; linhas?: LinhaConferida[] };
export type EstadoImportacao = { erroGeral?: string; resultado?: Omit<ResultadoImportacao, "erroGeral"> };

/** Importar mexe em valores (financeiro): só quem edita reservas E o financeiro. */
async function sessaoImportacao() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "reserva:editar", { organizacaoId: sessao.organizacaoId });
  exigir(sessao, "financeiro:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

export async function conferirCsvAcao(_a: EstadoConferencia, form: FormData): Promise<EstadoConferencia> {
  const sessao = await sessaoImportacao();
  const a = await analisarCsv(getDb(), sessao.organizacaoId, String(form.get("texto") ?? ""));
  // Só o necessário para a tela (os dados completos ficam no arquivo do próprio usuário).
  return {
    erroGeral: a.erroGeral,
    colunasIgnoradas: a.colunasIgnoradas,
    linhas: a.linhas.map(({ numero, situacao, resumo, erros, avisos }) => ({ numero, situacao, resumo, erros, avisos })),
  };
}

export async function importarCsvAcao(_a: EstadoImportacao, form: FormData): Promise<EstadoImportacao> {
  const sessao = await sessaoImportacao();
  const r = await importarCsv(getDb(), sessao.organizacaoId, String(form.get("texto") ?? ""), sessao.usuarioId);
  if (r.erroGeral) return { erroGeral: r.erroGeral };
  revalidatePath("/painel", "layout");
  return { resultado: { criadas: r.criadas, atualizadas: r.atualizadas, iguais: r.iguais, comErro: r.comErro, semRecalculo: r.semRecalculo, avisosFinanceiro: r.avisosFinanceiro } };
}
