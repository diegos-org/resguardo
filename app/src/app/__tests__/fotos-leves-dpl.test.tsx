// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GaleriaImovel } from "@/components/site/GaleriaImovel";
import type { FotoPublica } from "@/imoveis/fotos-regras";

/**
 * M7.19 — publicação com identificador de versão: o Next põe `?dpl=<versão>` no endereço das imagens do site (o `src`
 * das miniaturas e da foto em destaque). As duas versões do `srcset` têm de levar o mesmo `?dpl=`: a pequena da foto em
 * destaque é a mesma foto da miniatura, e com endereços diferentes o navegador a baixaria duas vezes. O Next lê o
 * identificador uma vez só, ao carregar (no navegador, da página); por isso este arquivo à parte, com ele definido antes.
 */
vi.hoisted(() => {
  document.documentElement.dataset.dplId = "versao-ficticia";
});
afterEach(() => cleanup());

const medidas = { grande: { largura: 2000, altura: 1500 }, pequena: { largura: 800, altura: 600 } };
const fotos: FotoPublica[] = [
  { grande: "/fotos/f1", pequena: "/fotos/f1/pequena", legenda: "Sala", medidas },
  { grande: "/fotos/f2", pequena: "/fotos/f2/pequena", legenda: "Quarto", medidas },
];

describe("fotos mais leves com a versão da publicação no endereço (M7.19)", () => {
  it("o srcset leva o mesmo ?dpl= do src e das miniaturas: a pequena tem o mesmo endereço da miniatura", () => {
    render(<GaleriaImovel nome="Studio Exemplo" fotos={fotos} />);
    const galeria = within(screen.getByRole("region", { name: "Fotos de Studio Exemplo" }));
    const sala = galeria.getByRole("img", { name: "Sala" });
    expect(sala.getAttribute("src")).toBe("/fotos/f1?dpl=versao-ficticia");
    expect(sala.getAttribute("srcset")).toBe("/fotos/f1/pequena?dpl=versao-ficticia 800w, /fotos/f1?dpl=versao-ficticia 2000w");
    const miniatura = galeria.getByRole("button", { name: "Ver a foto 1: Sala" }).querySelector("img");
    expect(miniatura?.getAttribute("src")).toBe("/fotos/f1/pequena?dpl=versao-ficticia");
    expect(sala.getAttribute("srcset")?.split(", ")[0]).toBe(`${miniatura?.getAttribute("src")} 800w`);
  });
});
