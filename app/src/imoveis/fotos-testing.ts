/**
 * Imagens fictícias para os testes das medidas das fotos (M7.19): só o começo de um JPG ou PNG, com as medidas onde o
 * arquivo de verdade as guarda, e um rabo de bytes para lembrar que o resto do arquivo não é lido. Nada de foto real.
 */

/** Um bloco de JPG: a marca, o tamanho (que conta os 2 bytes do próprio tamanho) e o conteúdo. */
export const blocoJpg = (marca: number, dados: readonly number[]) => [0xff, marca, ((dados.length + 2) >> 8) & 0xff, (dados.length + 2) & 0xff, ...dados];

/** Bloco Exif com a orientação da câmera (1 a 8), na ordem de bytes "MM" (padrão) ou "II" (`inverso`). */
export function blocoExif(orientacao: number, inverso = false) {
  const u16 = (v: number) => (inverso ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number) => (inverso ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24] : [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  // Cabeçalho TIFF, a primeira lista com uma entrada (orientação, tipo "short", 1 valor) e o fim da lista.
  const tiff = [...(inverso ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientacao), 0, 0, ...u32(0)];
  return blocoJpg(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]);
}

/**
 * Começo de um JPG com as medidas: início, JFIF, os blocos de `antes` (Exif, perfil de cor…), o quadro (`quadro`: C0 =
 * comum, C2 = progressivo) com altura e largura, o começo dos dados e `resto` bytes quaisquer.
 */
export function jpgComMedidas(largura: number, altura: number, { antes = [], quadro = 0xc0, resto = 32 }: { antes?: readonly (readonly number[])[]; quadro?: number; resto?: number } = {}) {
  const jfif = blocoJpg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = blocoJpg(quadro, [8, altura >> 8, altura & 0xff, largura >> 8, largura & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  const sos = blocoJpg(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]);
  return Uint8Array.from([0xff, 0xd8, ...jfif, ...antes.flat(), ...sof, ...sos, ...Array.from({ length: resto }, (_, i) => i & 0x7f)]);
}

/** Começo de um PNG com as medidas no primeiro bloco (IHDR). */
export function pngComMedidas(largura: number, altura: number) {
  const u32 = (v: number) => [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32(13), 0x49, 0x48, 0x44, 0x52, ...u32(largura), ...u32(altura), 8, 2, 0, 0, 0, 0, 0, 0, 0]);
}
