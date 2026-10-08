"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { arquivarPedido, marcarRespondido, type ResultadoDecisao } from "./pedidos-contato";

const PAGINA = "/painel/proprietarios/contatos";

/** Mesma permissão dos cadastros pelo site: dados pessoais, só quem edita proprietários. */
async function sessaoEditora() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "proprietario:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

/** Volta para a tela com o resultado (só um código no endereço, nunca texto livre). */
function voltar(r: ResultadoDecisao, feito: "respondido" | "arquivado"): never {
  revalidatePath(PAGINA);
  // A contagem de novos aparece na lista de proprietários e no Início.
  revalidatePath("/painel/proprietarios");
  revalidatePath("/painel");
  redirect(`${PAGINA}?${r.ok ? `feito=${feito}` : `erro=${r.erro}`}`);
}

const ler = (form: FormData, k: string, max: number) => String(form.get(k) ?? "").slice(0, max);

export async function marcarRespondidoAcao(form: FormData): Promise<void> {
  const sessao = await sessaoEditora();
  const r = await marcarRespondido(getDb(), sessao.organizacaoId, ler(form, "id", 64), ler(form, "nota", 1000), sessao.usuarioId);
  voltar(r, "respondido");
}

export async function arquivarPedidoAcao(form: FormData): Promise<void> {
  const sessao = await sessaoEditora();
  const r = await arquivarPedido(getDb(), sessao.organizacaoId, ler(form, "id", 64), ler(form, "nota", 1000), sessao.usuarioId);
  voltar(r, "arquivado");
}
