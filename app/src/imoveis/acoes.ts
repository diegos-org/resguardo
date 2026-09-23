"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { atualizarImovel, CodigoDuplicado, criarImovel } from "./repositorio";
import { type ErrosImovel, validarImovel } from "./validacao";

export type EstadoFormImovel = { erros?: ErrosImovel; mensagem?: string };

export async function salvarImovel(_anterior: EstadoFormImovel, form: FormData): Promise<EstadoFormImovel> {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "imovel:editar", { organizacaoId: sessao.organizacaoId });

  const resultado = validarImovel(Object.fromEntries(form));
  if (!resultado.ok) return { erros: resultado.erros, mensagem: "Confira os campos destacados." };

  const id = form.get("id");
  try {
    if (typeof id === "string" && id) {
      const salvo = await atualizarImovel(getDb(), sessao.organizacaoId, id, resultado.dados);
      if (!salvo) return { mensagem: "Imóvel não encontrado." };
    } else {
      await criarImovel(getDb(), sessao.organizacaoId, resultado.dados);
    }
  } catch (e) {
    if (e instanceof CodigoDuplicado) return { erros: { codigo: e.message }, mensagem: "Confira os campos destacados." };
    throw e;
  }

  revalidatePath("/painel", "layout");
  redirect("/painel/imoveis?salvo=1");
}
