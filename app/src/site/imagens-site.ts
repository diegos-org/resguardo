/**
 * Imagens do site que não são de um imóvel (M7.6): a foto de capa da página inicial, a marca (logotipo) e as fotos dos
 * lugares de "O bairro à sua porta". O arquivo fica em `arquivos` (como as fotos dos imóveis) e a configuração do site
 * guarda o id. Uma imagem só sai se a configuração do site a usa agora: para todos quando é a organização do site; para
 * a equipe que edita o site, como prévia no painel. Nenhum outro arquivo (comprovante, extrato) sai por aqui.
 */
import { and, eq } from "drizzle-orm";
import { autorizar, type Sessao } from "@/acesso/politica";
import { gravarConfig, lerConfig, travarConfig } from "@/configuracoes/armazem";
import { arquivos } from "@/db/schema";
import type { Db } from "@/db/types";
import { LIMITE_FOTO, LIMITE_MINIATURA, tipoDaImagem } from "@/imoveis/fotos-regras";
import { CACHE_FOTO_PUBLICA } from "@/imoveis/fotos-entrega";
import { uuidValido } from "@/lib/ids";
import { idsDasFotosDoBairro } from "./bairro";

export const enderecoImagemSite = (id: string) => `/imagens-site/${id}`;

export type ImagensSite = { capa: string | null; marca: string | null };

const idOuNulo = (v: unknown) => (typeof v === "string" && uuidValido(v) ? v : null);

/** Ids gravados da capa e da marca (vazio = o site usa o fundo e a marca padrão). */
export async function lerImagensSite(db: Db, organizacaoId: string): Promise<ImagensSite> {
  const c = (await lerConfig(db, organizacaoId, "site_imagens")) ?? {};
  return { capa: idOuNulo(c.capa), marca: idOuNulo(c.marca) };
}

/** Todos os ids de imagem que a configuração do site usa agora (capa, marca e fotos dos lugares do bairro). */
export async function imagensEmUso(db: Db, organizacaoId: string): Promise<Set<string>> {
  const [imagens, bairro] = await Promise.all([lerImagensSite(db, organizacaoId), lerConfig(db, organizacaoId, "site_bairro")]);
  return new Set([imagens.capa, imagens.marca, ...idsDasFotosDoBairro(bairro)].filter((id): id is string => !!id));
}

/** Grava uma imagem do site em `arquivos`, na transação de quem chama. O tipo vem dos primeiros bytes; até 2 MB. */
export async function guardarImagemSite(
  tx: Db,
  organizacaoId: string,
  a: { nome: string; conteudo: Uint8Array },
  autorId: string | null,
): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  const tipo = tipoDaImagem(a.conteudo);
  if (!tipo) return { ok: false, erro: "Use uma foto em JPG ou PNG." };
  if (a.conteudo.length > LIMITE_FOTO) return { ok: false, erro: "A foto passa de 2 MB mesmo reduzida: use uma versão menor." };
  const nome = a.nome.replace(/[^\w.-]+/g, "-").slice(0, 120) || "imagem-do-site";
  const [r] = await tx
    .insert(arquivos)
    .values({ organizacaoId, nome, tipo, tamanho: a.conteudo.length, conteudo: Buffer.from(a.conteudo), criadoPor: autorId })
    .returning({ id: arquivos.id });
  return { ok: true, id: r.id };
}

/** Apaga o arquivo de uma imagem que o site deixou de usar (troca ou remoção), na transação de quem chama. */
export async function apagarImagemSite(tx: Db, organizacaoId: string, id: string | null): Promise<void> {
  if (id && uuidValido(id)) await tx.delete(arquivos).where(and(eq(arquivos.id, id), eq(arquivos.organizacaoId, organizacaoId)));
}

async function conteudo(db: Db, organizacaoId: string, id: string) {
  if (!(await imagensEmUso(db, organizacaoId)).has(id)) return null;
  const [a] = await db
    .select({ tipo: arquivos.tipo, conteudo: arquivos.conteudo })
    .from(arquivos)
    .where(and(eq(arquivos.id, id), eq(arquivos.organizacaoId, organizacaoId)));
  return a ?? null;
}

const resposta = (a: { tipo: string; conteudo: Uint8Array }, cache: string) =>
  new Response(new Uint8Array(a.conteudo), {
    headers: { "Content-Type": a.tipo, "Content-Disposition": "inline", "Cache-Control": cache, "X-Content-Type-Options": "nosniff" },
  });

/** Entrega uma imagem do site: pública (com cache) se o site a usa; prévia privada para quem edita o site; senão 404. */
export async function entregarImagemSite(db: Db, id: string, contexto: { organizacaoDoSite: string | null; sessao: () => Promise<Sessao | null> }): Promise<Response> {
  if (uuidValido(id)) {
    if (contexto.organizacaoDoSite) {
      const a = await conteudo(db, contexto.organizacaoDoSite, id);
      if (a) return resposta(a, CACHE_FOTO_PUBLICA);
    }
    const sessao = await contexto.sessao();
    if (sessao && autorizar(sessao, "configuracao:editar", { organizacaoId: sessao.organizacaoId }).permitido) {
      const a = await conteudo(db, sessao.organizacaoId, id);
      if (a) return resposta(a, "private, no-store");
    }
  }
  return new Response("Não encontrado.", { status: 404, headers: { "Cache-Control": "no-store" } });
}

export type QualImagem = "capa" | "marca";
/** A marca sobe como está (PNG com fundo transparente continua transparente): até 512 KB; a capa vem reduzida, até 2 MB. */
export const LIMITE_IMAGEM: Record<QualImagem, number> = { capa: LIMITE_FOTO, marca: LIMITE_MINIATURA };

/** Troca a foto da capa ou a marca: grava a nova e apaga a anterior, tudo junto; o histórico registra a troca. */
export async function definirImagemSite(
  db: Db,
  organizacaoId: string,
  qual: QualImagem,
  a: { nome: string; conteudo: Uint8Array },
  autorId: string | null,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (a.conteudo.length > LIMITE_IMAGEM[qual]) return { ok: false, erro: qual === "marca" ? "A marca passa de 512 KB: use um arquivo menor (um PNG quadrado de 200 a 400 px basta)." : "A foto passa de 2 MB mesmo reduzida: use uma versão menor." };
  return db.transaction(async (tx) => {
    await travarConfig(tx, organizacaoId, "site_imagens");
    const atual = await lerImagensSite(tx, organizacaoId);
    const nova = await guardarImagemSite(tx, organizacaoId, a, autorId);
    if (!nova.ok) return nova;
    await gravarConfig(tx, organizacaoId, "site_imagens", { ...atual, [qual]: nova.id }, autorId);
    await apagarImagemSite(tx, organizacaoId, atual[qual]);
    return { ok: true as const };
  });
}

/** Tira a foto da capa (volta o fundo verde) ou a marca enviada (volta a do estudo), apagando o arquivo. */
export async function tirarImagemSite(db: Db, organizacaoId: string, qual: QualImagem, autorId: string | null): Promise<{ ok: true } | { ok: false; erro: string }> {
  return db.transaction(async (tx) => {
    await travarConfig(tx, organizacaoId, "site_imagens");
    const atual = await lerImagensSite(tx, organizacaoId);
    if (!atual[qual]) return { ok: false as const, erro: qual === "capa" ? "O site já está sem foto na capa." : "O site já usa a marca padrão." };
    await gravarConfig(tx, organizacaoId, "site_imagens", { ...atual, [qual]: null }, autorId);
    await apagarImagemSite(tx, organizacaoId, atual[qual]);
    return { ok: true as const };
  });
}
