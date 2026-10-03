"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { criarCotacao, segurarDatas } from "./cotacoes";
import { conteudoDoSite } from "./site";

export type EstadoSegurar = { erro?: string; erros?: Record<string, string>; motivos?: string[]; valores?: Record<string, string> };

const texto = (f: FormData, k: string) => String(f.get(k) ?? "").slice(0, 120);

/** "Segurar estas datas" (consulta e página do imóvel): grava a cotação do que o site mostrou e abre a página dela. */
export async function criarCotacaoAcao(form: FormData): Promise<void> {
  const db = getDb();
  const conteudo = await conteudoDoSite(db);
  const p = { imovel: texto(form, "imovel"), entrada: texto(form, "entrada"), saida: texto(form, "saida"), hospedes: texto(form, "hospedes") };
  if (!conteudo) redirect("/consulta");
  const r = await criarCotacao(db, conteudo.organizacaoId, p);
  // Mudou entre a tela e o clique: volta à consulta, que mostra a situação atual.
  if (!r.ok) redirect(`/consulta?${new URLSearchParams({ ...p, aviso: "mudou" })}`);
  redirect(`/reservar/${r.cotacao.codigo}`);
}

/** Formulário de contato da página da cotação: segura as datas (cria o pedido) e recarrega a página. */
export async function segurarDatasAcao(_a: EstadoSegurar, form: FormData): Promise<EstadoSegurar> {
  const db = getDb();
  const conteudo = await conteudoDoSite(db);
  const codigo = texto(form, "codigo").toUpperCase();
  const valores = { nome: texto(form, "nome"), email: texto(form, "email"), telefone: texto(form, "telefone") };
  if (!conteudo) return { erro: "O site ainda está em configuração.", valores };
  const r = await segurarDatas(db, conteudo.organizacaoId, codigo, valores);
  revalidatePath(`/reservar/${codigo}`);
  if (!r.ok) return { erro: r.erro, erros: r.erros, motivos: r.motivos, valores };
  return {};
}
