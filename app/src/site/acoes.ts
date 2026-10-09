"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { origemDoPedido } from "@/acesso/senha";
import { getDb } from "@/db/client";
import { validadeDaAutorizacao } from "@/pagamentos/autorizacao";
import { conferirLimite } from "@/pagamentos/limites";
import { gravarAutorizacao } from "./checkout";
import { criarCotacao, segurarDatas, validarContato } from "./cotacoes";
import { conteudoDoSite } from "./site";

/** Estado do formulário de contato: erros e motivos, nunca os dados digitados (o formulário guarda o que digitou). */
export type EstadoSegurar = { erro?: string; erros?: Record<string, string>; motivos?: string[] };

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

/**
 * Formulário de contato da página da cotação: segura as datas (cria o pedido) e recarrega a página. Dados
 * inválidos voltam sem gastar o freio; depois, o freio por endereço de internet (M8.2a) e o hold. Segurou: o
 * navegador recebe a autorização do pagamento (cookie só para /reservar, até o fim do pedido).
 */
export async function segurarDatasAcao(_a: EstadoSegurar, form: FormData): Promise<EstadoSegurar> {
  const db = getDb();
  const conteudo = await conteudoDoSite(db);
  const codigo = texto(form, "codigo").toUpperCase();
  const contato = { nome: texto(form, "nome"), email: texto(form, "email"), telefone: texto(form, "telefone") };
  if (!conteudo) return { erro: "O site ainda está em configuração." };
  const v = validarContato(contato);
  if (!v.ok) return { erro: "Confira seus dados.", erros: v.erros };
  const agora = new Date();
  const limite = await conferirLimite(db, conteudo.organizacaoId, "segurar", origemDoPedido(await headers()), agora);
  if (!limite.ok) return { erro: limite.erro };
  const r = await segurarDatas(db, conteudo.organizacaoId, codigo, contato, agora);
  revalidatePath(`/reservar/${codigo}`);
  if (!r.ok) return { erro: r.erro, erros: r.erros, motivos: r.motivos };
  try {
    await gravarAutorizacao(r.cotacao.id, validadeDaAutorizacao(r.holdAte, agora));
  } catch {
    // Sem AUTH_SECRET o pedido segue pela conversa (o Pix exige a autorização).
    console.error("[site] autorização do pagamento não emitida (AUTH_SECRET)");
  }
  return {};
}
