"use server";

/** Ações das imagens do site (M7.6) em Configurações → Site: foto da capa e marca. Só quem edita as configurações. */
import { revalidatePath } from "next/cache";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { LIMITE_MINIATURA } from "@/imoveis/fotos-regras";
import { definirImagemSite, ERRO_CAPA_PEQUENA, LIMITE_IMAGEM, type QualImagem, tirarImagemSite } from "./imagens-site";

export type ResultadoImagemSite = { ok: true } | { ok: false; erro: string };

async function sessaoEditora() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "configuracao:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

const qualDe = (form: FormData): QualImagem | null => {
  const q = form.get("qual");
  return q === "capa" || q === "marca" ? q : null;
};

export async function enviarImagemSiteAcao(form: FormData): Promise<ResultadoImagemSite> {
  const s = await sessaoEditora();
  const qual = qualDe(form);
  const arquivo = form.get("arquivo");
  if (!qual) return { ok: false, erro: "Pedido inválido." };
  if (!arquivo || typeof arquivo === "string" || arquivo.size === 0) return { ok: false, erro: "Escolha a imagem." };
  // O tamanho é conferido antes de ler o arquivo.
  if (arquivo.size > LIMITE_IMAGEM[qual]) return { ok: false, erro: qual === "marca" ? "A marca passa de 512 KB: use um arquivo menor." : "A foto passa de 2 MB mesmo reduzida: use uma versão menor." };
  // A capa vem também na versão pequena (M7.13), para a prévia dos links; o tamanho dela é conferido antes de ler.
  const p = qual === "capa" ? form.get("pequena") : null;
  const pequena = p && typeof p !== "string" && p.size > 0 ? p : null;
  if (pequena && pequena.size > LIMITE_MINIATURA) return { ok: false, erro: ERRO_CAPA_PEQUENA };
  const r = await definirImagemSite(
    getDb(),
    s.organizacaoId,
    qual,
    { nome: arquivo.name, conteudo: new Uint8Array(await arquivo.arrayBuffer()) },
    s.usuarioId,
    pequena && { nome: pequena.name, conteudo: new Uint8Array(await pequena.arrayBuffer()) },
  );
  if (r.ok) revalidatePath("/painel/configuracoes/site");
  return r;
}

export async function tirarImagemSiteAcao(form: FormData): Promise<ResultadoImagemSite> {
  const s = await sessaoEditora();
  const qual = qualDe(form);
  if (!qual) return { ok: false, erro: "Pedido inválido." };
  const r = await tirarImagemSite(getDb(), s.organizacaoId, qual, s.usuarioId);
  revalidatePath("/painel/configuracoes/site");
  return r;
}
