/**
 * "O bairro à sua porta" (M7.6): lugares perto dos imóveis (praia, café, livraria), editáveis no painel (Configurações →
 * Site) e mostrados no fim da ficha de cada imóvel do site. Configuração "site_bairro":
 * `{ olho, titulo, subtitulo, lugares: [{ id, nome, distancia, frase, bairro, fotoId }] }`, na ordem do site. Lugar com
 * bairro em branco aparece em todos os imóveis; com bairro, só nos imóveis daquele bairro (sem diferença de maiúscula ou
 * acento). A foto é opcional e é sempre uma imagem subida pela equipe (`imagens-site.ts`): as fotos de lugares do estudo
 * visual não são usadas, porque os direitos delas não foram liberados. Sem lugar cadastrado, a seção não aparece —
 * nada vem preenchido de fábrica além dos textos da seção (o olho, o título e o subtítulo).
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, ne } from "drizzle-orm";
import { gravarConfig, lerConfig, travarConfig } from "@/configuracoes/armazem";
import { imoveis } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { apagarImagemSite, enderecoImagemSite, guardarImagemSite, imagensEmUso } from "./imagens-site";

export const LIMITES_BAIRRO = { olho: 60, titulo: 80, subtitulo: 200, nome: 60, distancia: 40, frase: 140, bairro: 60, lugares: 12 } as const;
export type LimitesBairro = typeof LIMITES_BAIRRO;

/**
 * Textos da seção até alguém mudar no painel (os do estudo visual). O olho (a linha pequena acima do título) era fixo no
 * código até o M7.16 e fica aqui, junto do título e do subtítulo da seção, com o mesmo texto de antes.
 */
export const TEXTOS_BAIRRO_INICIAIS = {
  olho: "O bairro à sua porta",
  titulo: "Seu próximo passeio começa por aqui.",
  subtitulo: "Entre um mergulho, um café e uma boa leitura, descubra o Leblon.",
} as const;

export type Lugar = { id: string; nome: string; distancia: string; frase: string; bairro: string; fotoId: string | null };
export type DadosLugar = Pick<Lugar, "nome" | "distancia" | "frase" | "bairro">;
export type TextosBairro = { olho: string; titulo: string; subtitulo: string };
export type ConfigBairro = TextosBairro & { lugares: Lugar[] };

/** O que o site recebe de cada lugar (sem ids internos): a foto é o endereço público, ou null. */
export type LugarPublico = { nome: string; distancia: string; frase: string; foto: string | null };
export type BairroPublico = TextosBairro & { lugares: LugarPublico[] };

export type ErrosLugar = Partial<Record<keyof DadosLugar, string>>;
export type ErrosTextosBairro = Partial<Record<keyof TextosBairro, string>>;
export type ResultadoBairro = { ok: true; mudou: boolean; id?: string } | { ok: false; erro: string; erros?: ErrosLugar | ErrosTextosBairro };

const L = LIMITES_BAIRRO;
const SEM_LUGAR = "Lugar não encontrado (talvez já tenha sido removido): recarregue a página.";
const CAMPOS_LUGAR = ["nome", "distancia", "frase", "bairro"] as const;

/** Texto de uma linha só: sem quebras nem espaços repetidos. */
const linha = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** Nome de bairro para comparar: sem acento, sem diferença de maiúscula e de espaços. */
const chaveBairro = (s: string) => linha(s.normalize("NFD").replace(/\p{M}/gu, "")).toLowerCase();

/** "Leblon" = "leblon"; "São Conrado" = "Sao Conrado". */
export const mesmoBairro = (a: string, b: string) => chaveBairro(a) === chaveBairro(b);

/**
 * Configuração gravada → formato certo, sem confiar no que está no banco: lugar sem id válido, repetido ou sem nome fica
 * de fora; texto longo é cortado; no máximo 12 lugares. Sem título gravado, vale o inicial; olho e subtítulo gravados em
 * branco continuam em branco (foram tirados no painel); nunca gravados (o olho, antes do M7.16), valem os iniciais.
 */
export function configDoBairro(valor: Record<string, unknown> | null): ConfigBairro {
  const c = valor ?? {};
  const lugares: Lugar[] = [];
  for (const bruto of Array.isArray(c.lugares) ? (c.lugares as unknown[]) : []) {
    if (lugares.length >= L.lugares) break;
    if (!bruto || typeof bruto !== "object") continue;
    const l = bruto as Record<string, unknown>;
    const nome = linha(l.nome).slice(0, L.nome);
    if (!uuidValido(l.id) || !nome || lugares.some((x) => x.id === l.id)) continue;
    lugares.push({
      id: l.id,
      nome,
      distancia: linha(l.distancia).slice(0, L.distancia),
      frase: linha(l.frase).slice(0, L.frase),
      bairro: linha(l.bairro).slice(0, L.bairro),
      fotoId: uuidValido(l.fotoId) ? l.fotoId : null,
    });
  }
  return {
    olho: typeof c.olho === "string" ? linha(c.olho).slice(0, L.olho) : TEXTOS_BAIRRO_INICIAIS.olho,
    titulo: linha(c.titulo).slice(0, L.titulo) || TEXTOS_BAIRRO_INICIAIS.titulo,
    subtitulo: typeof c.subtitulo === "string" ? linha(c.subtitulo).slice(0, L.subtitulo) : TEXTOS_BAIRRO_INICIAIS.subtitulo,
    lugares,
  };
}

/** Ids das fotos que a configuração do bairro usa (para a entrega pública das imagens do site). */
export function idsDasFotosDoBairro(valor: Record<string, unknown> | null): string[] {
  const lugares = Array.isArray(valor?.lugares) ? (valor.lugares as unknown[]) : [];
  return lugares.map((l) => (l && typeof l === "object" ? (l as Record<string, unknown>).fotoId : null)).filter((id): id is string => uuidValido(id));
}

export async function lerBairro(db: Db, organizacaoId: string): Promise<ConfigBairro> {
  return configDoBairro(await lerConfig(db, organizacaoId, "site_bairro"));
}

export function validarLugar(bruto: Record<string, unknown>): { ok: true; dados: DadosLugar } | { ok: false; erros: ErrosLugar } {
  const dados = Object.fromEntries(CAMPOS_LUGAR.map((c) => [c, linha(bruto[c])])) as DadosLugar;
  const erros: ErrosLugar = {};
  for (const c of CAMPOS_LUGAR) if (dados[c].length > L[c]) erros[c] = `Máximo de ${L[c]} caracteres.`;
  if (!dados.nome) erros.nome = "Escreva o nome do lugar (ex.: Praia do Leblon).";
  return Object.keys(erros).length ? { ok: false, erros } : { ok: true, dados };
}

export function validarTextosBairro(bruto: Record<string, unknown>): { ok: true; textos: TextosBairro } | { ok: false; erros: ErrosTextosBairro } {
  const textos = { olho: linha(bruto.olho), titulo: linha(bruto.titulo), subtitulo: linha(bruto.subtitulo) };
  const erros: ErrosTextosBairro = {};
  if (textos.olho.length > L.olho) erros.olho = `Máximo de ${L.olho} caracteres.`;
  if (!textos.titulo) erros.titulo = "Escreva o título da seção.";
  else if (textos.titulo.length > L.titulo) erros.titulo = `Máximo de ${L.titulo} caracteres.`;
  if (textos.subtitulo.length > L.subtitulo) erros.subtitulo = `Máximo de ${L.subtitulo} caracteres.`;
  return Object.keys(erros).length ? { ok: false, erros } : { ok: true, textos };
}

/**
 * Toda mudança passa por aqui, numa transação só: trava a chave, relê a configuração (duas abas editando juntas não
 * desfazem uma à outra), aplica a mudança, grava (com histórico) e apaga o arquivo das fotos que saíram da seção e que
 * nenhuma outra parte do site usa. `mudar` devolve a configuração nova ou a mensagem de erro (nada é gravado).
 */
async function alterar(
  db: Db,
  organizacaoId: string,
  autorId: string | null,
  mudar: (atual: ConfigBairro, tx: Db) => Promise<ConfigBairro | string> | ConfigBairro | string,
): Promise<ResultadoBairro> {
  return db.transaction(async (tx) => {
    await travarConfig(tx, organizacaoId, "site_bairro");
    const bruto = await lerConfig(tx, organizacaoId, "site_bairro");
    const novo = await mudar(configDoBairro(bruto), tx);
    if (typeof novo === "string") return { ok: false as const, erro: novo };
    const mudou = Object.keys(await gravarConfig(tx, organizacaoId, "site_bairro", novo, autorId)).length > 0;
    const emUso = await imagensEmUso(tx, organizacaoId);
    for (const id of idsDasFotosDoBairro(bruto)) if (!emUso.has(id)) await apagarImagemSite(tx, organizacaoId, id);
    return { ok: true as const, mudou };
  });
}

/** Troca o lugar `id` pelo que `mudar` devolver; lugar inexistente vira o erro de "não encontrado". */
const noLugar = (id: string, mudar: (l: Lugar) => Lugar) => (c: ConfigBairro) =>
  c.lugares.some((l) => l.id === id) ? { ...c, lugares: c.lugares.map((l) => (l.id === id ? mudar(l) : l)) } : SEM_LUGAR;

export async function salvarTextosBairro(db: Db, organizacaoId: string, entrada: Record<string, unknown>, autorId: string | null): Promise<ResultadoBairro> {
  const v = validarTextosBairro(entrada);
  if (!v.ok) return { ok: false, erro: "Confira os campos destacados.", erros: v.erros };
  // Campo que não veio no envio fica como estava, em vez de ser apagado: é a tela aberta antes de ele existir (o olho,
  // antes do M7.16), salva depois da publicação.
  const vieram = (Object.keys(v.textos) as (keyof TextosBairro)[]).filter((k) => typeof entrada[k] === "string");
  return alterar(db, organizacaoId, autorId, (c) => ({ ...c, ...Object.fromEntries(vieram.map((k) => [k, v.textos[k]])) }));
}

/** Lugar novo no fim da lista (sem foto; a foto sobe depois, um pedido por foto). */
export async function adicionarLugar(db: Db, organizacaoId: string, entrada: Record<string, unknown>, autorId: string | null): Promise<ResultadoBairro> {
  const v = validarLugar(entrada);
  if (!v.ok) return { ok: false, erro: "Confira os campos destacados.", erros: v.erros };
  const id = randomUUID();
  const r = await alterar(db, organizacaoId, autorId, (c) =>
    c.lugares.length >= L.lugares ? `No máximo ${L.lugares} lugares: remova algum antes de adicionar outro.` : { ...c, lugares: [...c.lugares, { id, ...v.dados, fotoId: null }] },
  );
  return r.ok ? { ...r, id } : r;
}

export async function editarLugar(db: Db, organizacaoId: string, id: string, entrada: Record<string, unknown>, autorId: string | null): Promise<ResultadoBairro> {
  const v = validarLugar(entrada);
  if (!v.ok) return { ok: false, erro: "Confira os campos destacados.", erros: v.erros };
  return alterar(db, organizacaoId, autorId, noLugar(id, (l) => ({ ...l, ...v.dados })));
}

/** Uma posição para cima (-1) ou para baixo (+1) na ordem do site; na ponta, nada muda. */
export async function moverLugar(db: Db, organizacaoId: string, id: string, passo: -1 | 1, autorId: string | null): Promise<ResultadoBairro> {
  return alterar(db, organizacaoId, autorId, (c) => {
    const de = c.lugares.findIndex((l) => l.id === id);
    if (de < 0) return SEM_LUGAR;
    const para = de + passo;
    if (para < 0 || para >= c.lugares.length) return c;
    const lugares = [...c.lugares];
    [lugares[de], lugares[para]] = [lugares[para], lugares[de]];
    return { ...c, lugares };
  });
}

/** Tira o lugar da seção; o arquivo da foto dele é apagado junto. */
export async function removerLugar(db: Db, organizacaoId: string, id: string, autorId: string | null): Promise<ResultadoBairro> {
  return alterar(db, organizacaoId, autorId, (c) => (c.lugares.some((l) => l.id === id) ? { ...c, lugares: c.lugares.filter((l) => l.id !== id) } : SEM_LUGAR));
}

/** Põe ou troca a foto do lugar (JPG ou PNG, conferido pelos primeiros bytes; até 2 MB). A foto anterior é apagada. */
export async function trocarFotoLugar(db: Db, organizacaoId: string, id: string, arquivo: { nome: string; conteudo: Uint8Array }, autorId: string | null): Promise<ResultadoBairro> {
  return alterar(db, organizacaoId, autorId, async (c, tx) => {
    if (!c.lugares.some((l) => l.id === id)) return SEM_LUGAR;
    const r = await guardarImagemSite(tx, organizacaoId, arquivo, autorId);
    if (!r.ok) return r.erro;
    return noLugar(id, (l) => ({ ...l, fotoId: r.id }))(c);
  });
}

/** Tira a foto do lugar (o arquivo é apagado); no site, o cartão fica só com o texto. */
export async function tirarFotoLugar(db: Db, organizacaoId: string, id: string, autorId: string | null): Promise<ResultadoBairro> {
  return alterar(db, organizacaoId, autorId, noLugar(id, (l) => ({ ...l, fotoId: null })));
}

/** Para a ficha de um imóvel: os lugares sem bairro e os do bairro do imóvel, na ordem do painel, com os textos da seção. */
export function bairroParaOSite(c: ConfigBairro, bairro: string): BairroPublico {
  return {
    olho: c.olho,
    titulo: c.titulo,
    subtitulo: c.subtitulo,
    lugares: c.lugares
      .filter((l) => !l.bairro || mesmoBairro(l.bairro, bairro))
      .map((l) => ({ nome: l.nome, distancia: l.distancia, frase: l.frase, foto: l.fotoId ? enderecoImagemSite(l.fotoId) : null })),
  };
}

/** Seção "O bairro à sua porta" da ficha de um imóvel do bairro informado (lista vazia = a seção não aparece). */
export async function lugaresDoSite(db: Db, organizacaoId: string, bairro: string): Promise<BairroPublico> {
  return bairroParaOSite(await lerBairro(db, organizacaoId), bairro);
}

/** Bairros dos imóveis que estão no site (público e ativo), para sugerir no painel e avisar de lugar que não aparece. */
export async function bairrosDoSite(db: Db, organizacaoId: string): Promise<string[]> {
  const linhas = await db
    .selectDistinct({ bairro: imoveis.bairro })
    .from(imoveis)
    .where(and(eq(imoveis.organizacaoId, organizacaoId), eq(imoveis.publico, true), eq(imoveis.ativo, true), ne(imoveis.bairro, "")))
    .orderBy(asc(imoveis.bairro));
  const bairros: string[] = [];
  for (const { bairro } of linhas) {
    const b = linha(bairro);
    if (b && !bairros.some((x) => mesmoBairro(x, b))) bairros.push(b);
  }
  return bairros;
}
