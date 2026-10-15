/**
 * Ícone da aba do navegador e do atalho na tela do celular (M7.18). Uma regra, um lugar: o layout raiz (painel, portal
 * do proprietário, telas de acesso e de erro) usa a marca do estudo (`ICONES_PADRAO`); as páginas do site
 * (`metadadosDaPagina`, M7.13, inclusive Minha reserva e a cotação) usam a marca enviada em Configurações → Site quando
 * ela serve de ícone e, quando não serve, a mesma do estudo. Nunca uma imagem inventada.
 *
 * A marca enviada serve de ícone só se for PNG (pelos primeiros bytes do arquivo, nunca pelo nome) e quadrada, com as
 * medidas lidas do cabeçalho do próprio PNG. JPG (sem transparência: o fundo vira um quadrado na aba), retângulo (o
 * navegador espreme) ou medidas que não se leem: vale a do estudo, e o painel avisa junto da marca (`notaDoIconeDaMarca`).
 */
import type { Metadata } from "next";
import { tipoDaImagem } from "@/imoveis/fotos-regras";
import { MARCA_PADRAO } from "./marca";

/** Lado da marca do estudo (`MARCA_PADRAO`, `public/marca.png`), em pixels; um teste confere com o arquivo. */
export const LADO_MARCA_PADRAO = 160;
/**
 * A marca do estudo para o atalho na tela do iPhone, que pede 180 × 180 px: a mesma imagem de `MARCA_PADRAO`, ampliada
 * por `scripts/gerar-icone-apple.mts` (refazer só se a marca do estudo mudar).
 */
export const ICONE_APPLE_PADRAO = "/marca-180.png";
export const LADO_ICONE_APPLE = 180;

const png = (url: string, lado: number) => ({ url, type: "image/png", sizes: `${lado}x${lado}` });

/** Ícones da marca do estudo: os do layout raiz e os do site sem marca enviada que sirva. */
export const ICONES_PADRAO = {
  icon: [png(MARCA_PADRAO, LADO_MARCA_PADRAO)],
  apple: [png(ICONE_APPLE_PADRAO, LADO_ICONE_APPLE)],
} satisfies Metadata["icons"];

/** Ícone vindo da marca enviada (o endereço dela e o lado, em pixels), pronto para os metadados. */
export type IconeEnviado = { url: string; lado: number };

/** Ícones das páginas do site: a marca enviada, quando serve de ícone (`imagens.icone` de `conteudoDoSite`); senão, os do estudo. */
export function iconesDoSite(icone: IconeEnviado | null | undefined): NonNullable<Metadata["icons"]> {
  return icone ? { icon: [png(icone.url, icone.lado)], apple: [png(icone.url, icone.lado)] } : ICONES_PADRAO;
}

/** Bytes do começo do arquivo que bastam para conferir o ícone: a assinatura do PNG (8) e o bloco IHDR até a altura (16). */
export const BYTES_DO_CABECALHO = 24;

/** Largura e altura de um PNG pelo cabeçalho; null quando não é PNG ou o cabeçalho não fecha (incompleto ou sem o IHDR no lugar). */
export function medidasDoPng(b: Uint8Array | null | undefined): { largura: number; altura: number } | null {
  if (!b || b.length < BYTES_DO_CABECALHO || tipoDaImagem(b) !== "image/png") return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // O primeiro bloco de todo PNG é o IHDR (13 bytes de dados): a largura e a altura vêm no começo, em 4 bytes cada.
  if (v.getUint32(8) !== 13 || String.fromCharCode(b[12], b[13], b[14], b[15]) !== "IHDR") return null;
  const largura = v.getUint32(16);
  const altura = v.getUint32(20);
  return largura > 0 && altura > 0 ? { largura, altura } : null;
}

/** Se a marca enviada serve de ícone e, se não serve, por quê. */
export type IconeDaMarca =
  | { serve: true; lado: number }
  | { serve: false; motivo: "formato" | "medidas" }
  | { serve: false; motivo: "quadrada"; largura: number; altura: number };

/** Confere o começo do arquivo da marca enviada (`BYTES_DO_CABECALHO` bytes): sem arquivo, as medidas não se conferem. */
export function conferirIconeDaMarca(cabecalho: Uint8Array | null | undefined): IconeDaMarca {
  if (!cabecalho?.length) return { serve: false, motivo: "medidas" };
  if (tipoDaImagem(cabecalho) !== "image/png") return { serve: false, motivo: "formato" };
  const m = medidasDoPng(cabecalho);
  if (!m) return { serve: false, motivo: "medidas" };
  if (m.largura !== m.altura) return { serve: false, motivo: "quadrada", largura: m.largura, altura: m.altura };
  return { serve: true, lado: m.largura };
}

/**
 * Nota de Configurações → Site, junto da marca: só quando há marca enviada e ela não serve de ícone. Diz o que a aba
 * mostra, por quê e o que fazer; nunca troca a marca sozinha.
 */
export function notaDoIconeDaMarca(icone: IconeDaMarca | null): string | null {
  if (!icone || icone.serve) return null;
  const porque =
    icone.motivo === "formato" ? "esta não é PNG" : icone.motivo === "quadrada" ? `esta tem ${icone.largura} × ${icone.altura} px` : "não foi possível ler o tamanho desta";
  return `A aba do navegador e o atalho na tela do celular mostram a marca do estudo, e não esta: o ícone só usa a marca enviada quando ela é um PNG quadrado, e ${porque}. Para usar esta marca também no ícone, envie uma versão dela em PNG quadrado.`;
}
