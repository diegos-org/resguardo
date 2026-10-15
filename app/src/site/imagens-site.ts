/**
 * Imagens do site que não são de um imóvel (M7.6): a foto de capa da página inicial, a marca (logotipo) e as fotos dos
 * lugares de "O bairro à sua porta". O arquivo fica em `arquivos` (como as fotos dos imóveis) e a configuração do site
 * guarda o id. Uma imagem só sai se a configuração do site a usa agora: para todos quando é a organização do site; para
 * a equipe que edita o site, como prévia no painel. Nenhum outro arquivo (comprovante, extrato) sai por aqui.
 */
import { and, eq, sql } from "drizzle-orm";
import { autorizar, type Sessao } from "@/acesso/politica";
import { gravarConfig, lerConfig, travarConfig } from "@/configuracoes/armazem";
import { arquivos } from "@/db/schema";
import type { Db } from "@/db/types";
import { LIMITE_FOTO, LIMITE_MINIATURA, tipoDaImagem } from "@/imoveis/fotos-regras";
import { CACHE_FOTO_PUBLICA } from "@/imoveis/fotos-entrega";
import { uuidValido } from "@/lib/ids";
import { idsDasFotosDoBairro } from "./bairro";
import { BYTES_LIDOS_DA_MARCA, conferirIconeDaMarca, type IconeDaMarca } from "./icone";
import { TAMANHO_SUGERIDO_DA_MARCA } from "./marca";

export const enderecoImagemSite = (id: string) => `/imagens-site/${id}`;

/** `capaPequena` (M7.13): a versão pequena da capa (800 px), para a prévia dos links; null = a capa enviada antes dela, ou nenhuma. */
export type ImagensSite = { capa: string | null; marca: string | null; capaPequena: string | null };

const idOuNulo = (v: unknown) => (typeof v === "string" && uuidValido(v) ? v : null);

/** Ids gravados da capa e da marca (vazio = o site usa o fundo e a marca padrão). */
export async function lerImagensSite(db: Db, organizacaoId: string): Promise<ImagensSite> {
  const c = (await lerConfig(db, organizacaoId, "site_imagens")) ?? {};
  return { capa: idOuNulo(c.capa), marca: idOuNulo(c.marca), capaPequena: idOuNulo(c.capaPequena) };
}

/**
 * Se a marca enviada serve de ícone da aba e do atalho do celular (M7.18; a regra em ./icone): lê só o começo do arquivo
 * (o tipo, as medidas e a transparência do PNG, até `BYTES_LIDOS_DA_MARCA`), não a imagem inteira, a cada página do site.
 * null = nenhuma marca enviada (vale a do estudo, sem nota).
 */
export async function iconeDaMarcaEnviada(db: Db, organizacaoId: string, marcaId: string | null): Promise<IconeDaMarca | null> {
  if (!marcaId) return null;
  const [a] = await db
    .select({ comeco: sql<Uint8Array>`substring(${arquivos.conteudo} from 1 for ${BYTES_LIDOS_DA_MARCA})` })
    .from(arquivos)
    .where(and(eq(arquivos.id, marcaId), eq(arquivos.organizacaoId, organizacaoId)));
  return conferirIconeDaMarca(a?.comeco ?? null);
}

/** Todos os ids de imagem que a configuração do site usa agora (capa e a versão pequena dela, marca e fotos dos lugares do bairro). */
export async function imagensEmUso(db: Db, organizacaoId: string): Promise<Set<string>> {
  const [imagens, bairro] = await Promise.all([lerImagensSite(db, organizacaoId), lerConfig(db, organizacaoId, "site_bairro")]);
  return new Set([imagens.capa, imagens.capaPequena, imagens.marca, ...idsDasFotosDoBairro(bairro)].filter((id): id is string => !!id));
}

/** Grava uma imagem do site em `arquivos`, na transação de quem chama. O tipo vem dos primeiros bytes; até 2 MB (ou `limite`). */
export async function guardarImagemSite(
  tx: Db,
  organizacaoId: string,
  a: { nome: string; conteudo: Uint8Array },
  autorId: string | null,
  limite: number = LIMITE_FOTO,
): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  const tipo = tipoDaImagem(a.conteudo);
  if (!tipo) return { ok: false, erro: "Use uma foto em JPG ou PNG." };
  if (a.conteudo.length > limite) return { ok: false, erro: "A foto passa de 2 MB mesmo reduzida: use uma versão menor." };
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

/** Erro da versão pequena da capa que não veio certa (a foto inteira é recusada, como nas fotos das casas). */
export const ERRO_CAPA_PEQUENA = "A versão pequena da foto não veio certa: tente subir de novo.";
class PequenaRecusada extends Error {}

/**
 * Troca a foto da capa ou a marca: grava a nova e apaga a anterior, tudo junto; o histórico registra a troca. A capa vem
 * com a versão pequena (M7.13: 800 px, reduzida no navegador junto com a grande), usada na prévia dos links; sem ela (a
 * capa enviada antes do M7.13), a prévia usa a grande e o painel pede para enviar a foto de novo. A versão pequena
 * anterior sai junto com a capa anterior.
 */
export async function definirImagemSite(
  db: Db,
  organizacaoId: string,
  qual: QualImagem,
  a: { nome: string; conteudo: Uint8Array },
  autorId: string | null,
  pequena?: { nome: string; conteudo: Uint8Array } | null,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (a.conteudo.length > LIMITE_IMAGEM[qual]) return { ok: false, erro: qual === "marca" ? `A marca passa de 512 KB: use um arquivo menor (um PNG quadrado ${TAMANHO_SUGERIDO_DA_MARCA} basta).` : "A foto passa de 2 MB mesmo reduzida: use uma versão menor." };
  const comPequena = qual === "capa" && pequena?.conteudo.length ? pequena : null;
  if (comPequena && (comPequena.conteudo.length > LIMITE_MINIATURA || !tipoDaImagem(comPequena.conteudo))) return { ok: false, erro: ERRO_CAPA_PEQUENA };
  try {
    return await db.transaction(async (tx) => {
      await travarConfig(tx, organizacaoId, "site_imagens");
      const atual = await lerImagensSite(tx, organizacaoId);
      const nova = await guardarImagemSite(tx, organizacaoId, a, autorId);
      if (!nova.ok) return nova;
      if (qual === "marca") {
        await gravarConfig(tx, organizacaoId, "site_imagens", { ...atual, marca: nova.id }, autorId);
        await apagarImagemSite(tx, organizacaoId, atual.marca);
        return { ok: true as const };
      }
      const novaPequena = comPequena ? await guardarImagemSite(tx, organizacaoId, comPequena, autorId, LIMITE_MINIATURA) : null;
      // Já conferida acima; se ainda assim não entrar, a grande também não fica (a transação desfaz tudo).
      if (novaPequena && !novaPequena.ok) throw new PequenaRecusada();
      await gravarConfig(tx, organizacaoId, "site_imagens", { ...atual, capa: nova.id, capaPequena: novaPequena?.id ?? null }, autorId);
      await apagarImagemSite(tx, organizacaoId, atual.capa);
      await apagarImagemSite(tx, organizacaoId, atual.capaPequena);
      return { ok: true as const };
    });
  } catch (e) {
    if (e instanceof PequenaRecusada) return { ok: false, erro: ERRO_CAPA_PEQUENA };
    throw e;
  }
}

/** Tira a foto da capa (volta o fundo verde, e a versão pequena sai junto) ou a marca enviada (volta a do estudo), apagando o arquivo. */
export async function tirarImagemSite(db: Db, organizacaoId: string, qual: QualImagem, autorId: string | null): Promise<{ ok: true } | { ok: false; erro: string }> {
  return db.transaction(async (tx) => {
    await travarConfig(tx, organizacaoId, "site_imagens");
    const atual = await lerImagensSite(tx, organizacaoId);
    if (!atual[qual]) return { ok: false as const, erro: qual === "capa" ? "O site já está sem foto na capa." : "O site já usa a marca padrão." };
    await gravarConfig(tx, organizacaoId, "site_imagens", qual === "capa" ? { ...atual, capa: null, capaPequena: null } : { ...atual, marca: null }, autorId);
    await apagarImagemSite(tx, organizacaoId, atual[qual]);
    if (qual === "capa") await apagarImagemSite(tx, organizacaoId, atual.capaPequena);
    return { ok: true as const };
  });
}
