"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { ORIGENS_RESERVA } from "@/db/schema";
import { type ConfigRecebimento, salvarRecebimento } from "./recebimento";
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
      const salvo = await atualizarImovel(getDb(), sessao.organizacaoId, id, resultado.dados, sessao.usuarioId);
      if (!salvo) return { mensagem: "Imóvel não encontrado." };
    } else {
      await criarImovel(getDb(), sessao.organizacaoId, resultado.dados, sessao.usuarioId);
    }
  } catch (e) {
    if (e instanceof CodigoDuplicado) return { erros: { codigo: e.message }, mensagem: "Confira os campos destacados." };
    throw e;
  }

  revalidatePath("/painel", "layout");
  redirect("/painel/imoveis?salvo=1");
}

export type EstadoRecebimento = { ok?: boolean; mensagem?: string };

/** "Quem recebe o pagamento" por canal, para este imóvel. Só quem edita o financeiro. */
export async function salvarRecebimentoAcao(_a: EstadoRecebimento, form: FormData): Promise<EstadoRecebimento> {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "financeiro:editar", { organizacaoId: sessao.organizacaoId });
  const imovelId = String(form.get("imovelId") ?? "");
  const config: ConfigRecebimento = {};
  for (const origem of ORIGENS_RESERVA) {
    const v = String(form.get(`recebimento_${origem}`) ?? "");
    if (v === "split" || v === "empresa") config[origem] = v;
  }
  const ok = await salvarRecebimento(getDb(), sessao.organizacaoId, imovelId, config, sessao.usuarioId);
  if (!ok) return { mensagem: "Não foi possível salvar." };
  revalidatePath(`/painel/imoveis/${imovelId}`);
  return { ok: true };
}
