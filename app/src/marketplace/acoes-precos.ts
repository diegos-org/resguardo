"use server";

import { revalidatePath } from "next/cache";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { type ErrosPrecos, validarFormPrecos } from "./precos";
import { salvarPrecosMarketplace, usarPesosPadrao } from "./precos-config";

export type EstadoPrecos = { ok?: boolean; mensagem?: string; aviso?: string; erros?: ErrosPrecos; valores?: Record<string, string> };

const ABA = "/painel/configuracoes/marketplace";

const campos = (form: FormData) => Object.fromEntries([...form.entries()].filter((e): e is [string, string] => typeof e[1] === "string" && !e[0].startsWith("$ACTION")));

/** Salva taxas de referência e pesos do modelo B (Configurações → Marketplace). Vale para as cotações novas do site. */
export async function salvarPrecosMarketplaceAcao(_a: EstadoPrecos, form: FormData): Promise<EstadoPrecos> {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "configuracao:editar", { organizacaoId: sessao.organizacaoId });
  const valores = campos(form);
  const v = validarFormPrecos(valores);
  if (!v.ok) return { erros: v.erros, mensagem: "Confira os campos destacados.", valores };
  const mudou = await salvarPrecosMarketplace(getDb(), sessao.organizacaoId, v.precos, sessao.usuarioId);
  revalidatePath(ABA);
  return { ok: true, aviso: mudou ? "Salvo. Vale para as próximas cotações do site; as já feitas guardam o valor que mostraram." : "Nada mudou." };
}

/** "Usar o padrão novo" (M12.5): troca só os pesos pelo padrão de 7/10 (hóspede 1, proprietário 1, SCL 2). */
export async function usarPesosPadraoAcao(): Promise<void> {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "configuracao:editar", { organizacaoId: sessao.organizacaoId });
  await usarPesosPadrao(getDb(), sessao.organizacaoId, sessao.usuarioId);
  revalidatePath(ABA);
}
