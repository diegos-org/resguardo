"use server";

/** Ações de "O bairro à sua porta" (M7.6), em Configurações → Site. Só quem edita as configurações da organização. */
import { revalidatePath } from "next/cache";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { LIMITE_FOTO } from "@/imoveis/fotos-regras";
import { adicionarLugar, editarLugar, moverLugar, removerLugar, type ResultadoBairro, salvarTextosBairro, tirarFotoLugar, trocarFotoLugar } from "./bairro";

async function sessaoEditora() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "configuracao:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

const texto = (form: FormData, campo: string) => {
  const v = form.get(campo);
  return typeof v === "string" ? v : "";
};

const dadosDoLugar = (form: FormData) => ({ nome: texto(form, "nome"), distancia: texto(form, "distancia"), frase: texto(form, "frase"), bairro: texto(form, "bairro") });

const atualizar = () => revalidatePath("/painel/configuracoes/site");

export async function salvarTextosBairroAcao(form: FormData): Promise<ResultadoBairro> {
  const s = await sessaoEditora();
  const r = await salvarTextosBairro(getDb(), s.organizacaoId, { olho: texto(form, "olho"), titulo: texto(form, "titulo"), subtitulo: texto(form, "subtitulo") }, s.usuarioId);
  atualizar();
  return r;
}

export async function adicionarLugarAcao(form: FormData): Promise<ResultadoBairro> {
  const s = await sessaoEditora();
  const r = await adicionarLugar(getDb(), s.organizacaoId, dadosDoLugar(form), s.usuarioId);
  atualizar();
  return r;
}

export async function editarLugarAcao(form: FormData): Promise<ResultadoBairro> {
  const s = await sessaoEditora();
  const r = await editarLugar(getDb(), s.organizacaoId, texto(form, "id"), dadosDoLugar(form), s.usuarioId);
  atualizar();
  return r;
}

export async function moverLugarAcao(form: FormData): Promise<ResultadoBairro> {
  const s = await sessaoEditora();
  const r = await moverLugar(getDb(), s.organizacaoId, texto(form, "id"), texto(form, "passo") === "-1" ? -1 : 1, s.usuarioId);
  atualizar();
  return r;
}

export async function removerLugarAcao(form: FormData): Promise<ResultadoBairro> {
  const s = await sessaoEditora();
  const r = await removerLugar(getDb(), s.organizacaoId, texto(form, "id"), s.usuarioId);
  atualizar();
  return r;
}

/** Uma foto por pedido, já reduzida no navegador. O tamanho é conferido antes de ler os bytes; o tipo, pelos primeiros bytes. */
export async function fotoLugarAcao(form: FormData): Promise<ResultadoBairro> {
  const s = await sessaoEditora();
  const arquivo = form.get("arquivo");
  if (!arquivo || typeof arquivo === "string" || arquivo.size === 0) return { ok: false, erro: "Escolha a foto." };
  if (arquivo.size > LIMITE_FOTO) return { ok: false, erro: "A foto passa de 2 MB mesmo reduzida: use uma versão menor." };
  const conteudo = new Uint8Array(await arquivo.arrayBuffer());
  const r = await trocarFotoLugar(getDb(), s.organizacaoId, texto(form, "id"), { nome: arquivo.name, conteudo }, s.usuarioId);
  atualizar();
  return r;
}

export async function tirarFotoLugarAcao(form: FormData): Promise<ResultadoBairro> {
  const s = await sessaoEditora();
  const r = await tirarFotoLugar(getDb(), s.organizacaoId, texto(form, "id"), s.usuarioId);
  atualizar();
  return r;
}
