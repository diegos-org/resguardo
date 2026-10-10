"use server";

/** Ações das fotos do imóvel (M7.3), na ficha do imóvel no painel. Só quem edita o cadastro do imóvel. */
import { revalidatePath } from "next/cache";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { uuidValido } from "@/lib/ids";
import { guardarFoto, legendarFoto, moverFoto, removerFoto, usarComoCapa } from "./fotos";
import { LIMITE_FOTO, LIMITE_MINIATURA } from "./fotos-regras";

export type ResultadoAcaoFoto = { ok: true } | { ok: false; erro: string };

async function sessaoEditora() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "imovel:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

const texto = (form: FormData, campo: string) => {
  const v = form.get(campo);
  return typeof v === "string" ? v : "";
};

async function bytesDe(v: FormDataEntryValue | null, limite: number): Promise<Uint8Array | null | "grande"> {
  if (!v || typeof v === "string" || v.size === 0) return null;
  if (v.size > limite) return "grande";
  return new Uint8Array(await v.arrayBuffer());
}

function atualizar(imovelId: string) {
  if (uuidValido(imovelId)) revalidatePath(`/painel/imoveis/${imovelId}`);
}

/** Uma foto por pedido (a grande e a pequena, já reduzidas no navegador): o pedido fica bem abaixo do limite da Vercel. */
export async function enviarFotoAcao(form: FormData): Promise<ResultadoAcaoFoto> {
  const s = await sessaoEditora();
  const imovelId = texto(form, "imovelId");
  const arquivo = form.get("arquivo");
  const grande = await bytesDe(arquivo, LIMITE_FOTO);
  if (grande === "grande") return { ok: false, erro: "A foto passa de 2 MB mesmo reduzida: use uma versão menor." };
  if (!grande) return { ok: false, erro: "Escolha a foto." };
  const miniatura = await bytesDe(form.get("miniatura"), LIMITE_MINIATURA);
  if (miniatura === "grande") return { ok: false, erro: "A versão pequena da foto não veio certa: tente subir de novo." };
  const nome = arquivo && typeof arquivo !== "string" ? arquivo.name : "";
  const r = await guardarFoto(getDb(), s.organizacaoId, { imovelId, legenda: texto(form, "legenda"), arquivo: { nome, conteudo: grande }, miniatura }, s.usuarioId);
  if (!r.ok) return r;
  atualizar(imovelId);
  return { ok: true };
}

export async function moverFotoAcao(form: FormData): Promise<ResultadoAcaoFoto> {
  const s = await sessaoEditora();
  const r = await moverFoto(getDb(), s.organizacaoId, texto(form, "id"), texto(form, "passo") === "-1" ? -1 : 1, s.usuarioId);
  atualizar(texto(form, "imovelId"));
  return r;
}

export async function capaFotoAcao(form: FormData): Promise<ResultadoAcaoFoto> {
  const s = await sessaoEditora();
  const r = await usarComoCapa(getDb(), s.organizacaoId, texto(form, "id"), s.usuarioId);
  atualizar(texto(form, "imovelId"));
  return r;
}

export async function legendaFotoAcao(form: FormData): Promise<ResultadoAcaoFoto> {
  const s = await sessaoEditora();
  const r = await legendarFoto(getDb(), s.organizacaoId, texto(form, "id"), texto(form, "legenda"), s.usuarioId);
  atualizar(texto(form, "imovelId"));
  return r;
}

export async function removerFotoAcao(form: FormData): Promise<ResultadoAcaoFoto> {
  const s = await sessaoEditora();
  const r = await removerFoto(getDb(), s.organizacaoId, texto(form, "id"), s.usuarioId);
  atualizar(texto(form, "imovelId"));
  return r;
}
