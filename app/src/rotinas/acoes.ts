"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type Acao, exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { hojeISO } from "@/lib/datas";
import { arquivarRotina, criarRotina, editarRotina, registrarExecucao, type Resultado } from "./rotinas";

async function sessao(acao: Acao) {
  const s = await exigirSessaoPainel();
  exigir(s, acao, { organizacaoId: s.organizacaoId });
  return s;
}

function voltar(r: Resultado): never {
  revalidatePath("/painel/rotinas");
  redirect(r.ok ? "/painel/rotinas?salvo=1" : `/painel/rotinas?erro=${encodeURIComponent(r.erro)}`);
}

const campo = (form: FormData, nome: string) => String(form.get(nome) ?? "");
const dados = (form: FormData) => ({ titulo: campo(form, "titulo"), descricao: campo(form, "descricao"), frequencia: campo(form, "frequencia"), proximaData: campo(form, "proximaData") });

export async function criarAcao(form: FormData) {
  const s = await sessao("configuracao:editar");
  voltar(await criarRotina(getDb(), s.organizacaoId, dados(form), s.usuarioId));
}

export async function editarAcao(form: FormData) {
  const s = await sessao("configuracao:editar");
  voltar(await editarRotina(getDb(), s.organizacaoId, campo(form, "id"), dados(form), s.usuarioId));
}

export async function arquivarAcao(form: FormData) {
  const s = await sessao("configuracao:editar");
  voltar(await arquivarRotina(getDb(), s.organizacaoId, campo(form, "id"), campo(form, "ativa") === "sim", s.usuarioId));
}

export async function execucaoAcao(form: FormData) {
  const s = await sessao("rotina:editar");
  const hoje = hojeISO();
  voltar(
    await registrarExecucao(
      getDb(),
      s.organizacaoId,
      campo(form, "id"),
      { prevista: campo(form, "prevista"), feitaEm: campo(form, "feitaEm") || hoje, observacao: campo(form, "observacao"), pulada: campo(form, "pulada") === "sim" },
      hoje,
      s.usuarioId,
    ),
  );
}
