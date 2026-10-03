"use server";

import { revalidatePath } from "next/cache";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { adicionarIdExterno, removerIdExterno } from "./ids-externos";

export type EstadoIdExterno = { erro?: string; ok?: boolean };

export async function novoIdExterno(_a: EstadoIdExterno, form: FormData): Promise<EstadoIdExterno> {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "imovel:editar", { organizacaoId: sessao.organizacaoId });
  const imovelId = String(form.get("imovelId") ?? "");
  const r = await adicionarIdExterno(
    getDb(),
    sessao.organizacaoId,
    imovelId,
    { canal: String(form.get("canal") ?? ""), idExterno: String(form.get("idExterno") ?? ""), detalhe: String(form.get("detalhe") ?? "") },
    sessao.usuarioId,
  );
  if (!r.ok) return { erro: r.erro };
  revalidatePath(`/painel/imoveis/${imovelId}`);
  return { ok: true };
}

export async function excluirIdExterno(_a: EstadoIdExterno, form: FormData): Promise<EstadoIdExterno> {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "imovel:editar", { organizacaoId: sessao.organizacaoId });
  const r = await removerIdExterno(getDb(), sessao.organizacaoId, String(form.get("registroId") ?? ""), sessao.usuarioId);
  revalidatePath(`/painel/imoveis/${String(form.get("imovelId") ?? "")}`);
  return r.ok ? { ok: true } : { erro: r.erro };
}
