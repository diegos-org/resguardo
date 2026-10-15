import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BYTES_DO_CABECALHO,
  BYTES_LIDOS_DA_MARCA,
  conferirIconeDaMarca,
  fundoDoPng,
  ICONE_APPLE_PADRAO,
  ICONES_PADRAO,
  iconesDoSite,
  LADO_ICONE_APPLE,
  LADO_MARCA_PADRAO,
  medidasDoPng,
  notaDoIconeDaMarca,
} from "./icone";
import { cabecalhoPng, pngFicticio } from "./icone.testing";
import { MARCA_PADRAO } from "./marca";

const jpg = Uint8Array.from({ length: 32 }, (_, i) => [0xff, 0xd8, 0xff, 0xe0][i] ?? 0);
const PUBLICO = join(__dirname, "..", "..", "public");

describe("medidas do PNG pelo cabeçalho (M7.18)", () => {
  it("lê a largura e a altura do bloco IHDR, também do arquivo de verdade da marca do estudo", () => {
    expect(medidasDoPng(cabecalhoPng(400, 200))).toEqual({ largura: 400, altura: 200 });
    expect(medidasDoPng(cabecalhoPng(512, 512, BYTES_DO_CABECALHO))).toEqual({ largura: 512, altura: 512 });
    expect(medidasDoPng(readFileSync(join(PUBLICO, "marca.png")))).toEqual({ largura: LADO_MARCA_PADRAO, altura: LADO_MARCA_PADRAO });
  });

  it("não é PNG, cabeçalho incompleto, sem o IHDR no lugar ou medida zero: nenhuma medida (nunca um palpite)", () => {
    expect(medidasDoPng(jpg)).toBeNull();
    expect(medidasDoPng(null)).toBeNull();
    expect(medidasDoPng(new Uint8Array())).toBeNull();
    expect(medidasDoPng(cabecalhoPng(300, 300).slice(0, BYTES_DO_CABECALHO - 1))).toBeNull();
    const semIhdr = cabecalhoPng(300, 300);
    semIhdr.set([0x49, 0x44, 0x41, 0x54], 12); // "IDAT" no lugar do IHDR
    expect(medidasDoPng(semIhdr)).toBeNull();
    const tamanhoErrado = cabecalhoPng(300, 300);
    new DataView(tamanhoErrado.buffer).setUint32(8, 12);
    expect(medidasDoPng(tamanhoErrado)).toBeNull();
    expect(medidasDoPng(cabecalhoPng(0, 300))).toBeNull();
    expect(medidasDoPng(cabecalhoPng(300, 0))).toBeNull();
  });

  it("lê o cabeçalho também de um pedaço no meio de um buffer maior (o que o banco devolve)", () => {
    const maior = new Uint8Array(100);
    maior.set(cabecalhoPng(256, 256), 10);
    expect(medidasDoPng(maior.subarray(10, 10 + BYTES_DO_CABECALHO))).toEqual({ largura: 256, altura: 256 });
  });
});

describe("transparência do PNG pelo começo do arquivo (M7.18: o atalho do celular)", () => {
  it("os arquivos de verdade da marca do estudo (paleta e cores, sem transparência) são opacos", () => {
    for (const arquivo of ["marca.png", "marca-180.png"]) expect(fundoDoPng(readFileSync(join(PUBLICO, arquivo))), arquivo).toBe("opaco");
  });

  it("canal de transparência no tipo de cor (cinza ou cores com alfa) ou bloco tRNS antes da imagem: transparente", () => {
    expect(fundoDoPng(pngFicticio(300, 300, { tipoDeCor: 6 }))).toBe("transparente");
    expect(fundoDoPng(pngFicticio(300, 300, { tipoDeCor: 4 }))).toBe("transparente");
    // Paleta com transparência (como sai dos compressores de PNG), depois de outros blocos.
    expect(fundoDoPng(pngFicticio(300, 300, { tipoDeCor: 3, antes: [{ nome: "sRGB", tamanho: 1 }, { nome: "PLTE", tamanho: 48 }, { nome: "tRNS", tamanho: 16 }] }))).toBe("transparente");
    // Uma cor transparente também nas imagens sem paleta.
    expect(fundoDoPng(pngFicticio(300, 300, { tipoDeCor: 2, antes: [{ nome: "tRNS", tamanho: 6 }] }))).toBe("transparente");
    expect(fundoDoPng(pngFicticio(300, 300, { tipoDeCor: 0, antes: [{ nome: "tRNS", tamanho: 2 }] }))).toBe("transparente");
  });

  it("sem nada disso até a imagem começar: opaco, mesmo com outros blocos antes", () => {
    expect(fundoDoPng(pngFicticio(300, 300))).toBe("opaco");
    expect(fundoDoPng(pngFicticio(300, 300, { tipoDeCor: 0 }))).toBe("opaco");
    expect(fundoDoPng(pngFicticio(300, 300, { tipoDeCor: 3, antes: [{ nome: "iCCP", tamanho: 3000 }, { nome: "PLTE", tamanho: 48 }, { nome: "pHYs", tamanho: 9 }] }))).toBe("opaco");
  });

  it("a imagem não começa dentro dos bytes lidos, só o cabeçalho, ou não é PNG: não dá para conferir (nunca um palpite)", () => {
    const comMuitoAntes = pngFicticio(300, 300, { antes: [{ nome: "iTXt", tamanho: BYTES_LIDOS_DA_MARCA }] });
    expect(fundoDoPng(comMuitoAntes)).toBe("opaco");
    expect(fundoDoPng(comMuitoAntes.subarray(0, BYTES_LIDOS_DA_MARCA))).toBeNull();
    // A transparência que só aparece depois dos bytes lidos também fica sem conferir.
    expect(fundoDoPng(pngFicticio(300, 300, { tipoDeCor: 3, antes: [{ nome: "iTXt", tamanho: BYTES_LIDOS_DA_MARCA }, { nome: "tRNS", tamanho: 4 }] }).subarray(0, BYTES_LIDOS_DA_MARCA))).toBeNull();
    expect(fundoDoPng(cabecalhoPng(300, 300))).toBeNull();
    expect(fundoDoPng(cabecalhoPng(300, 300, BYTES_DO_CABECALHO))).toBeNull();
    expect(fundoDoPng(jpg)).toBeNull();
    expect(fundoDoPng(null)).toBeNull();
  });
});

describe("a marca enviada serve de ícone? (M7.18)", () => {
  it("só PNG quadrado; o lado é o do arquivo; e se tem transparência (o atalho do celular)", () => {
    expect(conferirIconeDaMarca(pngFicticio(300, 300))).toEqual({ serve: true, lado: 300, fundo: "opaco" });
    expect(conferirIconeDaMarca(pngFicticio(16, 16, { tipoDeCor: 6 }))).toEqual({ serve: true, lado: 16, fundo: "transparente" });
    expect(conferirIconeDaMarca(cabecalhoPng(300, 300))).toEqual({ serve: true, lado: 300, fundo: "incerto" });
  });

  it("JPG, retângulo, medidas que não se leem ou arquivo que não veio: não serve, com o motivo", () => {
    expect(conferirIconeDaMarca(jpg)).toEqual({ serve: false, motivo: "formato" });
    expect(conferirIconeDaMarca(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0, 0, 0, 0, 0]))).toEqual({ serve: false, motivo: "formato" });
    expect(conferirIconeDaMarca(cabecalhoPng(400, 200))).toEqual({ serve: false, motivo: "quadrada", largura: 400, altura: 200 });
    expect(conferirIconeDaMarca(cabecalhoPng(300, 300).slice(0, 12))).toEqual({ serve: false, motivo: "medidas" });
    expect(conferirIconeDaMarca(null)).toEqual({ serve: false, motivo: "medidas" });
    expect(conferirIconeDaMarca(new Uint8Array())).toEqual({ serve: false, motivo: "medidas" });
  });

  it("nota do painel: só quando há marca enviada que não serve; diz o que a aba mostra, por quê e o que fazer", () => {
    expect(notaDoIconeDaMarca(null)).toBeNull();
    expect(notaDoIconeDaMarca({ serve: true, lado: 300, fundo: "opaco" })).toBeNull();
    const formato = notaDoIconeDaMarca({ serve: false, motivo: "formato" });
    expect(formato).toContain("A aba do navegador e o atalho na tela do celular mostram a marca do estudo, e não esta");
    expect(formato).toContain("só usa a marca enviada quando ela é um PNG quadrado, e esta não é PNG.");
    expect(formato).toContain("envie uma versão dela em PNG quadrado");
    expect(notaDoIconeDaMarca({ serve: false, motivo: "quadrada", largura: 400, altura: 200 })).toContain("e esta tem 400 × 200 px.");
    expect(notaDoIconeDaMarca({ serve: false, motivo: "medidas" })).toContain("e não foi possível ler o tamanho desta.");
  });

  it("nota do painel: a marca serve na aba, mas com transparência (ou sem conferir) o atalho do celular fica com a do estudo", () => {
    const transparente = notaDoIconeDaMarca({ serve: true, lado: 300, fundo: "transparente" });
    expect(transparente).toContain("Nas páginas do site, a aba do navegador mostra esta marca, mas o atalho na tela do celular mostra a marca do estudo");
    expect(transparente).toContain("no iPhone, o fundo transparente do atalho fica preto, e esta foi salva com transparência.");
    expect(transparente).toContain("envie uma versão dela em PNG quadrado com fundo, sem transparência; esse fundo aparece também no topo e no rodapé do site.");
    expect(notaDoIconeDaMarca({ serve: true, lado: 300, fundo: "incerto" })).toContain("e não foi possível conferir se esta foi salva com transparência.");
  });
});

describe("ícones da aba e do atalho (M7.18)", () => {
  it("padrão: a marca do estudo na aba e a versão de 180 px no atalho do iPhone, com o tipo e o tamanho de cada arquivo", () => {
    expect(ICONES_PADRAO).toEqual({
      icon: [{ url: MARCA_PADRAO, type: "image/png", sizes: `${LADO_MARCA_PADRAO}x${LADO_MARCA_PADRAO}` }],
      apple: [{ url: ICONE_APPLE_PADRAO, type: "image/png", sizes: "180x180" }],
    });
    expect(LADO_ICONE_APPLE).toBe(180);
  });

  it("os arquivos dos ícones padrão existem em public/ e têm as medidas declaradas", () => {
    for (const { url, sizes } of [...ICONES_PADRAO.icon, ...ICONES_PADRAO.apple]) {
      const m = medidasDoPng(readFileSync(join(PUBLICO, url.replace(/^\//, ""))));
      expect(m && `${m.largura}x${m.altura}`, url).toBe(sizes);
    }
  });

  it("site: a marca enviada que serve de ícone vai na aba e, sem transparência, no atalho; sem ela, os da marca do estudo", () => {
    expect(iconesDoSite({ url: "/imagens-site/m1", lado: 300, atalho: true })).toEqual({
      icon: [{ url: "/imagens-site/m1", type: "image/png", sizes: "300x300" }],
      apple: [{ url: "/imagens-site/m1", type: "image/png", sizes: "300x300" }],
    });
    // Com transparência: a aba com a marca enviada, o atalho com a do estudo (no iPhone, o transparente fica preto).
    expect(iconesDoSite({ url: "/imagens-site/m1", lado: 300, atalho: false })).toEqual({
      icon: [{ url: "/imagens-site/m1", type: "image/png", sizes: "300x300" }],
      apple: ICONES_PADRAO.apple,
    });
    expect(iconesDoSite(null)).toBe(ICONES_PADRAO);
    expect(iconesDoSite(undefined)).toBe(ICONES_PADRAO);
  });
});
