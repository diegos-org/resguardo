import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BYTES_DO_CABECALHO, conferirIconeDaMarca, ICONE_APPLE_PADRAO, ICONES_PADRAO, iconesDoSite, LADO_ICONE_APPLE, LADO_MARCA_PADRAO, medidasDoPng, notaDoIconeDaMarca } from "./icone";
import { cabecalhoPng } from "./icone.testing";
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

describe("a marca enviada serve de ícone? (M7.18)", () => {
  it("só PNG quadrado; o lado é o do arquivo", () => {
    expect(conferirIconeDaMarca(cabecalhoPng(300, 300))).toEqual({ serve: true, lado: 300 });
    expect(conferirIconeDaMarca(cabecalhoPng(16, 16))).toEqual({ serve: true, lado: 16 });
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
    expect(notaDoIconeDaMarca({ serve: true, lado: 300 })).toBeNull();
    const formato = notaDoIconeDaMarca({ serve: false, motivo: "formato" });
    expect(formato).toContain("A aba do navegador e o atalho na tela do celular mostram a marca do estudo, e não esta");
    expect(formato).toContain("só usa a marca enviada quando ela é um PNG quadrado, e esta não é PNG.");
    expect(formato).toContain("envie uma versão dela em PNG quadrado");
    expect(notaDoIconeDaMarca({ serve: false, motivo: "quadrada", largura: 400, altura: 200 })).toContain("e esta tem 400 × 200 px.");
    expect(notaDoIconeDaMarca({ serve: false, motivo: "medidas" })).toContain("e não foi possível ler o tamanho desta.");
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

  it("site: a marca enviada que serve de ícone vai na aba e no atalho; sem ela, os da marca do estudo", () => {
    expect(iconesDoSite({ url: "/imagens-site/m1", lado: 300 })).toEqual({
      icon: [{ url: "/imagens-site/m1", type: "image/png", sizes: "300x300" }],
      apple: [{ url: "/imagens-site/m1", type: "image/png", sizes: "300x300" }],
    });
    expect(iconesDoSite(null)).toBe(ICONES_PADRAO);
    expect(iconesDoSite(undefined)).toBe(ICONES_PADRAO);
  });
});
