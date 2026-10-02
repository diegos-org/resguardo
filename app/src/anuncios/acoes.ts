"use server";

import { revalidatePath } from "next/cache";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { salvarAnuncio } from "./repositorio";

export type EstadoAnuncio = { ok?: boolean; erro?: string };
export async function salvarAnuncioAcao(_anterior: EstadoAnuncio, form: FormData): Promise<EstadoAnuncio> {
  const s = await exigirSessaoPainel();
  exigir(s, "imovel:editar", { organizacaoId: s.organizacaoId });
  const id = String(form.get("imovelId") ?? "");
  const r = await salvarAnuncio(getDb(), s.organizacaoId, id, Object.fromEntries(form), s.usuarioId);
  if (r.ok) { revalidatePath("/painel/anuncios"); revalidatePath(`/painel/imoveis/${id}`); }
  return r;
}
