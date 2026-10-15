/**
 * Ícone da aba do navegador e do atalho na tela do celular (M7.18). Uma regra, um lugar: o layout raiz (painel, portal
 * do proprietário, telas de acesso e de erro) e Minha reserva, do portal do hóspede (`metadadosDeMinhaReserva`), usam a
 * marca do estudo (`ICONES_PADRAO`); as páginas do site (`metadadosDaPagina`, M7.13, inclusive a cotação) usam a marca
 * enviada em Configurações → Site quando ela serve de ícone e, quando não serve, a mesma do estudo. Nunca uma imagem
 * inventada. Pedidos diretos a `/favicon.ico` (o navegador pede sozinho em páginas sem ícone declarado, como um PDF)
 * recebem a marca do estudo, pela regra de `next.config.ts`.
 *
 * A marca enviada serve de ícone da aba só se for PNG (pelos primeiros bytes do arquivo, nunca pelo nome) e quadrada, com
 * as medidas lidas do cabeçalho do próprio PNG. JPG (sem transparência: o fundo vira um quadrado na aba), retângulo (o
 * navegador espreme) ou medidas que não se leem: vale a do estudo, e o painel avisa junto da marca (`notaDoIconeDaMarca`).
 * O atalho na tela do celular pede mais: no iPhone, o fundo transparente do atalho fica preto, então ele só usa a marca
 * enviada quando o arquivo, conferido antes da imagem, não tem transparência (`fundoDoPng`); se tem, ou se não deu para
 * conferir, o atalho fica com a do estudo e o painel avisa.
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

/**
 * Ícone vindo da marca enviada (o endereço dela e o lado, em pixels), pronto para os metadados; `atalho`: ela também
 * serve no atalho da tela do celular (sem transparência, `fundoDoPng`).
 */
export type IconeEnviado = { url: string; lado: number; atalho: boolean };

/**
 * Ícones das páginas do site: a marca enviada, quando serve de ícone (`imagens.icone` de `conteudoDoSite`), na aba e, se
 * não tem transparência, no atalho do celular (senão, o atalho fica com o do estudo); sem ela, os do estudo.
 */
export function iconesDoSite(icone: IconeEnviado | null | undefined): NonNullable<Metadata["icons"]> {
  if (!icone) return ICONES_PADRAO;
  return { icon: [png(icone.url, icone.lado)], apple: icone.atalho ? [png(icone.url, icone.lado)] : ICONES_PADRAO.apple };
}

/** Bytes do começo do arquivo que bastam para as medidas: a assinatura do PNG (8) e o bloco IHDR até a altura (16). */
export const BYTES_DO_CABECALHO = 24;
/**
 * Bytes do começo da marca enviada que o site e o painel leem (`iconeDaMarcaEnviada`): o cabeçalho e os blocos que vêm
 * antes da imagem, onde fica a transparência. 16 KB cobrem as informações extras que os programas costumam gravar ali;
 * se ainda assim a imagem não começar dentro deles, a transparência fica sem conferir (o atalho usa a do estudo, com
 * aviso). Bem menos que o arquivo inteiro (até 512 KB) a cada página do site.
 */
export const BYTES_LIDOS_DA_MARCA = 16 * 1024;

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

/**
 * Se o PNG tem transparência, pelo começo do arquivo: "transparente" quando o tipo de cor do IHDR traz o canal de
 * transparência (cinza ou cores com alfa, tipos 4 e 6) ou quando um bloco tRNS aparece antes da imagem (o primeiro
 * IDAT); "opaco" quando a imagem começa sem nada disso; null quando não deu para conferir (não é PNG, ou a imagem não
 * começa dentro dos bytes lidos). O canal de transparência conta mesmo que todos os pontos sejam opacos: só o cabeçalho
 * é lido, nunca a imagem.
 */
export function fundoDoPng(b: Uint8Array | null | undefined): "opaco" | "transparente" | null {
  if (!b || !medidasDoPng(b) || b.length < 26) return null;
  const tipoDeCor = b[25];
  if (tipoDeCor === 4 || tipoDeCor === 6) return "transparente";
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // Cada bloco: tamanho (4 bytes), nome (4), dados e o código de conferência (4). O primeiro, o IHDR, começa no byte 8.
  for (let i = 8; i + 8 <= b.length; i += 12 + v.getUint32(i)) {
    const nome = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    if (nome === "tRNS") return "transparente";
    if (nome === "IDAT") return "opaco";
  }
  return null;
}

/** Se a marca enviada serve de ícone e, se não serve, por quê; servindo, se ela tem fundo transparente (o atalho do celular). */
export type IconeDaMarca =
  | { serve: true; lado: number; fundo: "opaco" | "transparente" | "incerto" }
  | { serve: false; motivo: "formato" | "medidas" }
  | { serve: false; motivo: "quadrada"; largura: number; altura: number };

/** Confere o começo do arquivo da marca enviada (`BYTES_LIDOS_DA_MARCA` bytes): sem arquivo, as medidas não se conferem. */
export function conferirIconeDaMarca(comeco: Uint8Array | null | undefined): IconeDaMarca {
  if (!comeco?.length) return { serve: false, motivo: "medidas" };
  if (tipoDaImagem(comeco) !== "image/png") return { serve: false, motivo: "formato" };
  const m = medidasDoPng(comeco);
  if (!m) return { serve: false, motivo: "medidas" };
  if (m.largura !== m.altura) return { serve: false, motivo: "quadrada", largura: m.largura, altura: m.altura };
  return { serve: true, lado: m.largura, fundo: fundoDoPng(comeco) ?? "incerto" };
}

/**
 * Nota de Configurações → Site, junto da marca: só quando há marca enviada e ela não serve de ícone, ou serve na aba mas
 * não no atalho do celular. Diz o que a aba e o atalho mostram, por quê e o que fazer; nunca troca a marca sozinha.
 */
export function notaDoIconeDaMarca(icone: IconeDaMarca | null): string | null {
  if (!icone) return null;
  if (icone.serve) {
    if (icone.fundo === "opaco") return null;
    const porque = icone.fundo === "transparente" ? "esta foi salva com transparência" : "não foi possível conferir se esta foi salva com transparência";
    return `Nas páginas do site, a aba do navegador mostra esta marca, mas o atalho na tela do celular mostra a marca do estudo: no iPhone, o fundo transparente do atalho fica preto, e ${porque}. Para usar esta marca também no atalho, envie uma versão dela em PNG quadrado com fundo, sem transparência; esse fundo aparece também no topo e no rodapé do site.`;
  }
  const porque =
    icone.motivo === "formato" ? "esta não é PNG" : icone.motivo === "quadrada" ? `esta tem ${icone.largura} × ${icone.altura} px` : "não foi possível ler o tamanho desta";
  return `A aba do navegador e o atalho na tela do celular mostram a marca do estudo, e não esta: o ícone só usa a marca enviada quando ela é um PNG quadrado, e ${porque}. Para usar esta marca também no ícone, envie uma versão dela em PNG quadrado.`;
}
