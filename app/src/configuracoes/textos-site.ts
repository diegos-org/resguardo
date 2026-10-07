/**
 * Textos do site público (M1.7), editáveis no painel. O site (M7.1) lê daqui.
 */
import type { Db } from "@/db/types";
import { gravarConfig, lerConfig } from "./armazem";

export const CAMPOS_TEXTOS_SITE = [
  { chave: "olho", rotulo: "Olho da capa (linha pequena acima do título, ex.: RIO DE JANEIRO · BRASIL)", limite: 60, linhas: 1 },
  { chave: "titulo", rotulo: "Título da página inicial (a palavra entre *asteriscos* sai em itálico)", limite: 120, linhas: 1 },
  { chave: "subtitulo", rotulo: "Subtítulo", limite: 240, linhas: 2 },
  { chave: "legendaCapa", rotulo: "Legenda vertical da capa (texto pequeno no canto da foto, ex.: LEBLON, DO NOSSO JEITO.)", limite: 40, linhas: 1 },
  { chave: "vitrineOlho", rotulo: "Olho da vitrine de casas (linha pequena acima do título)", limite: 60, linhas: 1 },
  { chave: "vitrineTitulo", rotulo: "Título da vitrine de casas (a palavra entre *asteriscos* sai em itálico)", limite: 80, linhas: 1 },
  { chave: "vitrineTexto", rotulo: "Frase da vitrine de casas", limite: 160, linhas: 1 },
  { chave: "porqueOlho", rotulo: "Olho de \"Por que reservar direto\"", limite: 60, linhas: 1 },
  { chave: "porqueTitulo", rotulo: "Título de \"Por que reservar direto\" (a parte entre *asteriscos* sai em itálico)", limite: 120, linhas: 1 },
  { chave: "porque", rotulo: "Por que reservar direto (um benefício por bloco, separados por linha em branco; a primeira linha do bloco é o título). Vazio = a seção não aparece", limite: 2000, linhas: 8 },
  { chave: "comoReservar", rotulo: "Como reservar", limite: 2000, linhas: 5 },
  { chave: "consultaOlho", rotulo: "Página de consulta: olho (linha pequena acima do título)", limite: 60, linhas: 1 },
  { chave: "consultaTitulo", rotulo: "Página de consulta: título (a parte entre *asteriscos* sai em itálico)", limite: 120, linhas: 1 },
  { chave: "consultaTexto", rotulo: "Página de consulta: frase abaixo do título", limite: 240, linhas: 2 },
  { chave: "chamadaOlho", rotulo: "Olho da chamada final (linha pequena acima dela)", limite: 60, linhas: 1 },
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
  legendaCapa: "Leblon, do nosso jeito.",
  vitrineOlho: "Poucas casas. Muito cuidado.",
  vitrineTitulo: "Seu endereço no *Leblon*.",
  vitrineTexto: "Seu jeito de se sentir em casa no Rio.",
  porqueOlho: "Reservar direto",
  porqueTitulo: "A leveza de chegar e *se sentir em casa*.",
  // Texto-base (M7.6) para Diego revisar perto da entrada no ar: só o que o site de fato oferece.
  porque: [
    "Conversa direta\nVocê fala com quem cuida da casa, da primeira mensagem à saída.",
    "Valor claro desde o início\nO total da estadia aparece antes de qualquer reserva, já com o desconto de quem reserva pelo site.",
    "Um bairro para viver\nEntre a praia, os cafés e os restaurantes, descubra seu próprio ritmo no Leblon.",
  ].join("\n\n"),
  comoReservar: "",
  consultaOlho: "Vamos combinar sua viagem",
  consultaTitulo: "Conte seus planos. *A gente encontra sua casa.*",
  consultaTexto: "Escolha a casa, as datas e quantas pessoas. A disponibilidade e o valor aparecem aqui, antes de qualquer reserva.",
  chamadaOlho: "Sua próxima viagem começa aqui",
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
  // "Por que reservar direto" se chamava "sobre" até o M7.6: o que foi escrito lá continua valendo; vazio dá o texto-base.
  if (typeof c.porque !== "string" && typeof c.sobre === "string" && c.sobre.trim()) c.porque = c.sobre;
  return Object.fromEntries(CAMPOS_TEXTOS_SITE.map((f) => [f.chave, typeof c[f.chave] === "string" ? c[f.chave] : TEXTOS_SITE_INICIAIS[f.chave]])) as TextosSite;
}

export async function salvarTextosSite(db: Db, organizacaoId: string, textos: TextosSite, autorId: string | null): Promise<boolean> {
  return db.transaction(async (tx) => Object.keys(await gravarConfig(tx, organizacaoId, "textos_site", { ...textos }, autorId)).length > 0);
}
