/**
 * Textos do site público (M1.7), editáveis no painel. O site (M7.1) lê daqui.
 */
import type { Db } from "@/db/types";
import { gravarConfig, lerConfig } from "./armazem";

export const CAMPOS_TEXTOS_SITE = [
  { chave: "olho", rotulo: "Olho da capa (linha pequena acima do título, ex.: RIO DE JANEIRO · BRASIL)", limite: 60, linhas: 1 },
  { chave: "titulo", rotulo: "Título da página inicial (a palavra entre *asteriscos* sai em itálico)", limite: 120, linhas: 1 },
  { chave: "subtitulo", rotulo: "Subtítulo", limite: 240, linhas: 2 },
  { chave: "sobre", rotulo: "Por que reservar direto (um benefício por bloco, separados por linha em branco; a primeira linha do bloco é o título)", limite: 2000, linhas: 8 },
  { chave: "comoReservar", rotulo: "Como reservar", limite: 2000, linhas: 5 },
  { chave: "chamada", rotulo: "Chamada final (título da faixa verde antes do rodapé)", limite: 120, linhas: 1 },
  { chave: "contato", rotulo: "Texto de contato", limite: 500, linhas: 3 },
  { chave: "rodape", rotulo: "Rodapé", limite: 240, linhas: 2 },
] as const;
export type ChaveTextoSite = (typeof CAMPOS_TEXTOS_SITE)[number]["chave"];
export type TextosSite = Record<ChaveTextoSite, string>;

export const TEXTOS_SITE_INICIAIS: TextosSite = {
  olho: "Rio de Janeiro · Brasil",
  titulo: "Um pouco de Rio. Um lugar *seu*.",
  subtitulo: "Estadias com cuidado de casa, a poucos passos da praia.",
  sobre: "",
  comoReservar: "",
  chamada: "O Rio está logo ali.",
  contato: "",
  rodape: "",
};

/**
 * Título com uma palavra de destaque entre asteriscos ("Um lugar *seu*") → partes para o itálico.
 * Sem asteriscos, o texto inteiro é uma parte normal.
 */
export function partesDoTitulo(titulo: string): { texto: string; destaque: boolean }[] {
  const partes: { texto: string; destaque: boolean }[] = [];
  const re = /\*([^*]+)\*/g;
  let i = 0;
  for (const m of titulo.matchAll(re)) {
    if (m.index! > i) partes.push({ texto: titulo.slice(i, m.index), destaque: false });
    partes.push({ texto: m[1], destaque: true });
    i = m.index! + m[0].length;
  }
  if (i < titulo.length) partes.push({ texto: titulo.slice(i), destaque: false });
  return partes.length ? partes : [{ texto: titulo, destaque: false }];
}

/** Título sem os asteriscos (para <title>, descrições e textos simples). */
export const tituloSimples = (titulo: string) => titulo.replace(/\*([^*]+)\*/g, "$1");

/**
 * Texto longo editável → blocos separados por linha em branco. Quando o bloco tem mais de uma linha,
 * a primeira é o título (seção "Por que reservar direto" da página inicial).
 */
export function blocosDoTexto(texto: string): { titulo: string | null; texto: string }[] {
  return texto
    .split(/\n\s*\n/)
    .map((b) => b.split("\n").map((l) => l.trim()).filter(Boolean))
    .filter((linhas) => linhas.length > 0)
    .map((linhas) => (linhas.length > 1 ? { titulo: linhas[0], texto: linhas.slice(1).join("\n") } : { titulo: null, texto: linhas[0] }));
}

export function validarTextosSite(bruto: Record<string, unknown>): { ok: true; textos: TextosSite } | { ok: false; erros: Partial<Record<ChaveTextoSite, string>> } {
  const textos = {} as TextosSite;
  const erros: Partial<Record<ChaveTextoSite, string>> = {};
  for (const c of CAMPOS_TEXTOS_SITE) {
    const v = typeof bruto[c.chave] === "string" ? (bruto[c.chave] as string).replace(/\r\n/g, "\n").trim() : "";
    if (v.length > c.limite) erros[c.chave] = `Máximo de ${c.limite} caracteres.`;
    textos[c.chave] = v;
  }
  if (!textos.titulo) erros.titulo = "O título não pode ficar vazio.";
  return Object.keys(erros).length ? { ok: false, erros } : { ok: true, textos };
}

export async function lerTextosSite(db: Db, organizacaoId: string): Promise<TextosSite> {
  const c = (await lerConfig(db, organizacaoId, "textos_site")) ?? {};
  return Object.fromEntries(CAMPOS_TEXTOS_SITE.map((f) => [f.chave, typeof c[f.chave] === "string" ? c[f.chave] : TEXTOS_SITE_INICIAIS[f.chave]])) as TextosSite;
}

export async function salvarTextosSite(db: Db, organizacaoId: string, textos: TextosSite, autorId: string | null): Promise<boolean> {
  return db.transaction(async (tx) => Object.keys(await gravarConfig(tx, organizacaoId, "textos_site", { ...textos }, autorId)).length > 0);
}
