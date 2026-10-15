import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { buildCustomRoute } from "next/dist/lib/build-custom-route";
import { describe, expect, it } from "vitest";
import { TEMA } from "@/relatorios/tema";
import { ICONE_APPLE_PADRAO, ICONES_PADRAO } from "@/site/icone";
import { MARCA_PADRAO } from "@/site/marca";
import nextConfig from "../../../next.config";
import { metadata, viewport } from "../layout";

/**
 * M7.18: ícone da aba e do atalho do celular e cor da barra do navegador, no layout raiz (painel, portal do proprietário,
 * telas de acesso e de erro; as páginas do site trocam o ícone pela marca enviada, testado em site/compartilhamento). O
 * ícone padrão do esqueleto do Next saiu; nenhum arquivo de ícone por convenção do Next disputa com os metadados, e o
 * pedido direto a /favicon.ico recebe a marca do estudo.
 */
const APP = join(__dirname, "..");
const RAIZ = join(APP, "..", "..");

describe("ícones do layout raiz (M7.18)", () => {
  it("a marca do estudo na aba e a versão de 180 px no atalho, e os arquivos existem em public/", () => {
    expect(metadata.icons).toBe(ICONES_PADRAO);
    for (const url of [MARCA_PADRAO, ICONE_APPLE_PADRAO]) expect(existsSync(join(RAIZ, "public", url.replace(/^\//, ""))), url).toBe(true);
  });

  it("o favicon padrão do esqueleto do Next saiu, e não há outro arquivo de ícone por convenção em src/app", () => {
    expect(existsSync(join(APP, "favicon.ico"))).toBe(false);
    const icones: string[] = [];
    (function varrer(dir: string) {
      for (const nome of readdirSync(dir)) {
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) varrer(caminho);
        else if (/^(favicon|icon\d*|apple-icon\d*)\.[a-z]+$/.test(nome)) icones.push(relative(APP, caminho));
      }
    })(APP);
    expect(icones).toEqual([]);
  });

  it("pedido direto a /favicon.ico (página sem ícone declarado, como um PDF): o arquivo da marca do estudo, sem página nem banco", async () => {
    const regras = await nextConfig.rewrites!();
    expect(Array.isArray(regras)).toBe(true);
    const lista = regras as { source: string; destination: string }[];
    // Regra comum (depois dos arquivos de public/, que não têm favicon.ico), só para esse endereço.
    expect(lista).toEqual([{ source: "/favicon.ico", destination: MARCA_PADRAO }]);
    const regex = new RegExp(buildCustomRoute("rewrite", lista[0]).regex);
    expect(regex.test("/favicon.ico")).toBe(true);
    for (const outro of ["/", "/marca.png", "/favicon.ico/x", "/painel/favicon.ico", "/favicon.png"]) expect(regex.test(outro), outro).toBe(false);
    expect(existsSync(join(RAIZ, "public", "favicon.ico"))).toBe(false);
    expect(ICONES_PADRAO.icon[0].url).toBe(MARCA_PADRAO);
  });

  it("o script que gera a versão de 180 px parte da marca do estudo e grava o arquivo do atalho", () => {
    const script = readFileSync(join(RAIZ, "scripts", "gerar-icone-apple.mts"), "utf8");
    expect(script).toContain(`../public${MARCA_PADRAO}`);
    expect(script).toContain(`../public${ICONE_APPLE_PADRAO}`);
  });
});

describe("cor da barra do navegador no celular (M7.18)", () => {
  it("é o verde do site: o valor de --scl-floresta em globals.css, lido de TEMA (uma cor só)", () => {
    const css = readFileSync(join(APP, "globals.css"), "utf8");
    const floresta = /--scl-floresta:\s*(#[0-9a-f]{6})\s*;/i.exec(css)?.[1];
    expect(floresta).toBeTruthy();
    expect(TEMA.floresta.toLowerCase()).toBe(floresta!.toLowerCase());
    expect(viewport.themeColor).toBe(TEMA.floresta);
  });
});
