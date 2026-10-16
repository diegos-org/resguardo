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

/** Medidas de uma imagem em pixels, como o navegador a mostra (com a orientação da câmera já aplicada). */
export type Medidas = { largura: number; altura: number };

/**
 * O que o site recebe de cada foto: só os endereços, a legenda e, na página da casa (M7.19), as medidas das duas versões,
 * lidas dos próprios arquivos (nada de id de imóvel ou de arquivo). Sem `medidas` (foto sem versão pequena, medidas que
 * não deu para ler, ou fora da página da casa), a galeria mostra só a grande, como antes.
 */
export type FotoPublica = { grande: string; pequena: string; legenda: string; medidas?: { grande: Medidas; pequena: Medidas } };

export type TipoFoto = "image/jpeg" | "image/png";
export const TIPOS_FOTO: readonly TipoFoto[] = ["image/jpeg", "image/png"];

/** O tipo da imagem pelos primeiros bytes do arquivo (nunca pelo nome nem pelo que o navegador diz); null = não é JPG nem PNG. */
export function tipoDaImagem(b: Uint8Array): TipoFoto | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  return null;
}

/**
 * Quantos bytes do começo do arquivo são lidos para achar as medidas (M7.19). A foto reduzida no navegador traz as
 * medidas nas primeiras centenas de bytes (alguns navegadores põem antes um perfil de cor de uns 3 KB); sem achar nesse
 * trecho, a foto fica sem medidas, e a galeria, só com a grande.
 */
export const BYTES_DAS_MEDIDAS = 8192;

const u16 = (b: Uint8Array, i: number, inverso = false) => (inverso ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
const u32 = (b: Uint8Array, i: number, inverso = false) =>
  (inverso ? b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24) : (b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const texto = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

/** PNG: as medidas estão no primeiro bloco ("IHDR"), logo depois da assinatura: largura e altura, 4 bytes cada. */
function medidasDoPng(b: Uint8Array): Medidas | null {
  if (b.length < 24 || texto(b, 12, 4) !== "IHDR") return null;
  const largura = u32(b, 16);
  const altura = u32(b, 20);
  return largura > 0 && altura > 0 ? { largura, altura } : null;
}

/**
 * Orientação da câmera guardada no Exif de um JPG (1 a 8; 1 = como está). De 5 a 8 o navegador gira a foto em 90° ao
 * mostrar, trocando largura e altura. A foto reduzida no navegador já sai na posição certa, sem Exif; isto vale para
 * uma foto que chegue sem passar pela redução.
 */
function orientacaoDoExif(b: Uint8Array, inicio: number, fim: number): number {
  if (fim - inicio < 14 || texto(b, inicio, 4) !== "Exif" || b[inicio + 4] !== 0 || b[inicio + 5] !== 0) return 1;
  const tiff = inicio + 6;
  const inverso = b[tiff] === 0x49 && b[tiff + 1] === 0x49;
  if (!inverso && !(b[tiff] === 0x4d && b[tiff + 1] === 0x4d)) return 1;
  const lista = tiff + u32(b, tiff + 4, inverso);
  if (lista + 2 > fim) return 1;
  const n = u16(b, lista, inverso);
  for (let k = 0; k < n; k++) {
    const e = lista + 2 + k * 12;
    if (e + 12 > fim) return 1;
    if (u16(b, e, inverso) === 0x0112) return u16(b, e + 8, inverso);
  }
  return 1;
}

/** JPG: as medidas estão no bloco do quadro (marcas C0 a CF, menos C4, C8 e CC), antes dos dados da imagem. */
function medidasDoJpg(b: Uint8Array): Medidas | null {
  let i = 2;
  let orientacao = 1;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marca = b[i + 1];
    if (marca === 0xff) {
      i += 1; // byte de preenchimento entre blocos
      continue;
    }
    if (marca === 0x01 || (marca >= 0xd0 && marca <= 0xd8)) {
      i += 2; // marca sem conteúdo
      continue;
    }
    if (marca === 0xd9 || marca === 0xda) return null; // fim da imagem ou começo dos dados, sem ter achado as medidas
    const tamanho = u16(b, i + 2);
    if (tamanho < 2) return null;
    const fim = i + 2 + tamanho;
    if (marca === 0xe1 && orientacao === 1) orientacao = orientacaoDoExif(b, i + 4, Math.min(fim, b.length));
    if (marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc) {
      if (tamanho < 8 || i + 9 > b.length) return null;
      const altura = u16(b, i + 5);
      const largura = u16(b, i + 7);
      if (!largura || !altura) return null;
      return orientacao >= 5 && orientacao <= 8 ? { largura: altura, altura: largura } : { largura, altura };
    }
    i = fim;
  }
  return null;
}

/**
 * Medidas de uma foto (M7.19) pelos primeiros bytes do arquivo (`BYTES_DAS_MEDIDAS` bastam), nunca pelo que o navegador
 * diz nem pelo limite de 2000/800 px: a foto em pé tem a versão pequena com 600 px de largura, não 800. null = não é
 * JPG nem PNG, ou as medidas não estão no trecho lido.
 */
export function medidasDaImagem(b: Uint8Array): Medidas | null {
  const tipo = tipoDaImagem(b);
  if (tipo === "image/png") return medidasDoPng(b);
  if (tipo === "image/jpeg") return medidasDoJpg(b);
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
