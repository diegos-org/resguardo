"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { adicionarRepresentante, atualizarProprietario, criarProprietario, definirImoveis, imoveisDeOutroDono, mensagemConflito, removerRepresentante } from "./repositorio";
import { type DadosProprietario, type DadosRepresentante, validarProprietario, validarRepresentante } from "./validacao";

export type EstadoForm<T> = { erros?: Partial<Record<keyof T, string>>; mensagem?: string; ok?: boolean };

async function sessaoEditora() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "proprietario:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

export async function salvarProprietario(_a: EstadoForm<DadosProprietario>, form: FormData): Promise<EstadoForm<DadosProprietario>> {
  const sessao = await sessaoEditora();
  const r = validarProprietario(Object.fromEntries(form));
  if (!r.ok) return { erros: r.erros, mensagem: "Confira os campos destacados." };

  const db = getDb();
  const imovelIds = form.getAll("imovel").filter((v): v is string => typeof v === "string");
  const idForm = form.get("id");
  // Confere antes de gravar qualquer coisa: cada imóvel tem um proprietário só.
  const conflitos = await imoveisDeOutroDono(db, sessao.organizacaoId, imovelIds, typeof idForm === "string" ? idForm : undefined);
  if (conflitos.length) return { mensagem: mensagemConflito(conflitos) };
  let id: string;
  if (typeof idForm === "string" && idForm) {
    const salvo = await atualizarProprietario(db, sessao.organizacaoId, idForm, r.dados, sessao.usuarioId);
    if (!salvo) return { mensagem: "Proprietário não encontrado." };
    id = salvo.id;
  } else {
    id = (await criarProprietario(db, sessao.organizacaoId, r.dados, sessao.usuarioId)).id;
  }
  const vinculo = await definirImoveis(db, sessao.organizacaoId, id, imovelIds, sessao.usuarioId);
  if (typeof vinculo === "string") return { mensagem: vinculo };

  revalidatePath("/painel/proprietarios");
  redirect(`/painel/proprietarios/${id}?salvo=1`);
}

export async function salvarRepresentante(_a: EstadoForm<DadosRepresentante>, form: FormData): Promise<EstadoForm<DadosRepresentante>> {
  const sessao = await sessaoEditora();
  const r = validarRepresentante(Object.fromEntries(form));
  if (!r.ok) return { erros: r.erros, mensagem: "Confira os campos do representante." };
  const proprietarioId = String(form.get("proprietarioId") ?? "");
  const rep = await adicionarRepresentante(getDb(), sessao.organizacaoId, proprietarioId, r.dados, sessao.usuarioId);
  if (!rep) return { mensagem: "Proprietário não encontrado." };
  revalidatePath(`/painel/proprietarios/${proprietarioId}`);
  return { ok: true };
}

export async function excluirRepresentante(form: FormData): Promise<void> {
  const sessao = await sessaoEditora();
  const proprietarioId = String(form.get("proprietarioId") ?? "");
  await removerRepresentante(getDb(), sessao.organizacaoId, proprietarioId, String(form.get("representanteId") ?? ""), sessao.usuarioId);
  revalidatePath(`/painel/proprietarios/${proprietarioId}`);
}
