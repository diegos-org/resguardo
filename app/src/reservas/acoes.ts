"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigir, podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { lerFormReserva } from "./formulario";
import type { ErrosReserva } from "./regras";
import { analisarCsv, importarCsv, type ResultadoImportacao, type SituacaoLinha } from "./importacao";
import { cancelarReserva, criarReserva } from "./repositorio";

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

// --- Importação por CSV (M3.6) --------------------------------------------------------

export type LinhaConferida = { numero: number; situacao: SituacaoLinha; resumo: string; erros: string[]; avisos: string[] };
export type EstadoImportacao = {
  texto?: string;
  erroGeral?: string;
  colunasIgnoradas?: string[];
  linhas?: LinhaConferida[];
  resultado?: Omit<ResultadoImportacao, "erroGeral">;
};

/** Importar mexe em valores (financeiro): só quem edita reservas E o financeiro. */
async function sessaoImportacao() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "reserva:editar", { organizacaoId: sessao.organizacaoId });
  exigir(sessao, "financeiro:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

export async function importacaoAcao(_a: EstadoImportacao, form: FormData): Promise<EstadoImportacao> {
  const sessao = await sessaoImportacao();
  const texto = String(form.get("texto") ?? "");
  const db = getDb();
  if (form.get("op") === "importar") {
    const r = await importarCsv(db, sessao.organizacaoId, texto, sessao.usuarioId);
    if (r.erroGeral) return { texto, erroGeral: r.erroGeral };
    revalidatePath("/painel", "layout");
    return { resultado: { criadas: r.criadas, atualizadas: r.atualizadas, iguais: r.iguais, comErro: r.comErro } };
  }
  const a = await analisarCsv(db, sessao.organizacaoId, texto);
  // Só o necessário para a tela (os dados completos ficam no arquivo do próprio usuário).
  return {
    texto,
    erroGeral: a.erroGeral,
    colunasIgnoradas: a.colunasIgnoradas,
    linhas: a.linhas.map(({ numero, situacao, resumo, erros, avisos }) => ({ numero, situacao, resumo, erros, avisos })),
  };
}
