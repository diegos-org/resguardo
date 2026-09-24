/**
 * Textos do site público (M1.7), editáveis no painel. O site (M7.1) lê daqui.
 */
import type { Db } from "@/db/types";
import { gravarConfig, lerConfig } from "./armazem";

export const CAMPOS_TEXTOS_SITE = [
  { chave: "titulo", rotulo: "Título da página inicial", limite: 120, linhas: 1 },
  { chave: "subtitulo", rotulo: "Subtítulo", limite: 240, linhas: 2 },
  { chave: "sobre", rotulo: "Sobre a Sua Casa Leblon", limite: 2000, linhas: 6 },
  { chave: "comoReservar", rotulo: "Como reservar", limite: 2000, linhas: 5 },
  { chave: "contato", rotulo: "Texto de contato", limite: 500, linhas: 3 },
  { chave: "rodape", rotulo: "Rodapé", limite: 240, linhas: 2 },
] as const;
export type ChaveTextoSite = (typeof CAMPOS_TEXTOS_SITE)[number]["chave"];
export type TextosSite = Record<ChaveTextoSite, string>;

export const TEXTOS_SITE_INICIAIS: TextosSite = {
  titulo: "Apartamentos para temporada no Leblon",
  subtitulo: "Estadias com cuidado de casa, a poucos passos da praia.",
  sobre: "",
  comoReservar: "",
  contato: "",
  rodape: "",
};

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
