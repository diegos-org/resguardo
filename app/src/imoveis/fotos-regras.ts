/**
 * Regras das fotos dos imóveis (M7.3), sem banco: valem no navegador (redução antes de subir) e no servidor (conferência
 * do que chegou). Uma regra, um lugar: o relatório mensal confere a foto da capa com estas mesmas regras.
 */

/** Tamanho máximo de uma foto guardada (a grande). A redução no navegador deixa a foto bem abaixo disso. */
export const LIMITE_FOTO = 2 * 1024 * 1024;
/** Tamanho máximo da versão pequena. */
export const LIMITE_MINIATURA = 512 * 1024;
/** Maior lado da foto grande, em pixels (galeria da página do imóvel). */
export const LADO_FOTO = 2000;
/** Maior lado da versão pequena (cartões do site, miniaturas da galeria e capa do relatório). */
export const LADO_MINIATURA = 800;
/** Quantas fotos um imóvel pode ter. */
export const MAXIMO_FOTOS = 40;
export const LIMITE_LEGENDA = 160;

/** O que o site recebe de cada foto: só os endereços e a legenda (nada de id de imóvel ou de arquivo). */
export type FotoPublica = { grande: string; pequena: string; legenda: string };

export type TipoFoto = "image/jpeg" | "image/png";
export const TIPOS_FOTO: readonly TipoFoto[] = ["image/jpeg", "image/png"];

/** O tipo da imagem pelos primeiros bytes do arquivo (nunca pelo nome nem pelo que o navegador diz); null = não é JPG nem PNG. */
export function tipoDaImagem(b: Uint8Array): TipoFoto | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  return null;
}

/** Medidas da foto reduzida: o maior lado vira no máximo `lado`, mantendo a proporção; foto menor fica como está. */
export function medidasReduzidas(largura: number, altura: number, lado: number): { largura: number; altura: number } {
  if (!(largura > 0) || !(altura > 0)) return { largura: 0, altura: 0 };
  const escala = Math.min(1, lado / Math.max(largura, altura));
  return { largura: Math.max(1, Math.round(largura * escala)), altura: Math.max(1, Math.round(altura * escala)) };
}

/** Legenda limpa: uma linha só, sem espaços repetidos, no tamanho máximo. */
export const limparLegenda = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, LIMITE_LEGENDA);

/**
 * Endereço de uma foto: a grande em `/fotos/{id}`, a pequena em `/fotos/{id}/pequena` (sem "?": o Next exige configuração
 * para imagem local com parâmetros). A rota confere, a cada pedido, se a foto pode ser mostrada a quem pediu.
 */
export const enderecoDaFoto = (id: string, tamanho: "grande" | "pequena" = "grande") => (tamanho === "pequena" ? `/fotos/${id}/pequena` : `/fotos/${id}`);
