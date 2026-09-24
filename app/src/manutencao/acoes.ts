"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type Acao, exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import type { Responsavel } from "@/despesas/despesas";
import { hojeISO } from "@/lib/datas";
import { reaisParaCentavos } from "@/lib/dinheiro-form";
import {
  aprovarManutencao,
  cancelarManutencao,
  criarManutencao,
  lancarCusto,
  realizarManutencao,
  recusarManutencao,
  registrarOrcamento,
  type Resultado,
} from "./manutencao";

async function sessao(...acoes: Acao[]) {
  const s = await exigirSessaoPainel();
  for (const a of acoes) exigir(s, a, { organizacaoId: s.organizacaoId });
  return s;
}

/** Volta para a lista mantendo o filtro que estava na tela. */
function voltar(form: FormData, r: Resultado): never {
  revalidatePath("/painel/manutencao");
  const q = new URLSearchParams(String(form.get("voltar") ?? ""));
  q.delete("salvo");
  q.delete("erro");
  if (r.ok) q.set("salvo", "1");
  else q.set("erro", r.erro);
  redirect(`/painel/manutencao?${q}`);
}

const campo = (form: FormData, nome: string) => String(form.get(nome) ?? "");
/** Valor em reais do formulário; inválido ou vazio vira -1 (recusado na validação). */
const valor = (form: FormData, nome: string) => reaisParaCentavos(campo(form, nome)) ?? -1;

export async function criarAcao(form: FormData) {
  const s = await sessao("manutencao:editar");
  voltar(form, await criarManutencao(getDb(), s.organizacaoId, { imovelId: campo(form, "imovelId"), titulo: campo(form, "titulo"), descricao: campo(form, "descricao") }, s.usuarioId));
}

export async function orcamentoAcao(form: FormData) {
  const s = await sessao("manutencao:editar");
  voltar(form, await registrarOrcamento(getDb(), s.organizacaoId, campo(form, "id"), { fornecedor: campo(form, "fornecedor"), valor: valor(form, "valor") }, s.usuarioId));
}

export async function aprovarAcao(form: FormData) {
  const s = await sessao("manutencao:aprovar");
  voltar(form, await aprovarManutencao(getDb(), s.organizacaoId, campo(form, "id"), campo(form, "responsavel"), s.usuarioId));
}

export async function recusarAcao(form: FormData) {
  const s = await sessao("manutencao:aprovar");
  voltar(form, await recusarManutencao(getDb(), s.organizacaoId, campo(form, "id"), campo(form, "motivo"), s.usuarioId));
}

export async function cancelarAcao(form: FormData) {
  const s = await sessao("manutencao:editar");
  voltar(form, await cancelarManutencao(getDb(), s.organizacaoId, campo(form, "id"), campo(form, "motivo"), s.usuarioId));
}

export async function realizarAcao(form: FormData) {
  const s = await sessao("manutencao:editar");
  voltar(form, await realizarManutencao(getDb(), s.organizacaoId, campo(form, "id"), campo(form, "data"), hojeISO(), s.usuarioId));
}

export async function custoAcao(form: FormData) {
  const s = await sessao("manutencao:editar", "despesa:editar");
  const paga = form.get("paga") === "on";
  voltar(
    form,
    await lancarCusto(
      getDb(),
      s.organizacaoId,
      campo(form, "id"),
      {
        categoriaId: campo(form, "categoriaId"),
        valor: valor(form, "valor"),
        paga,
        dataPagamento: paga ? campo(form, "dataPagamento") : null,
        pagoPor: (campo(form, "pagoPor") || "empresa") as Responsavel,
        comprovante: campo(form, "comprovante"),
      },
      s.usuarioId,
    ),
  );
}
