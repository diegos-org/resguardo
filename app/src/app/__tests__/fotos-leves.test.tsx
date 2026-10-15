// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GaleriaImovel, SIZES_GALERIA } from "@/components/site/GaleriaImovel";
import styles from "@/components/site/site.module.css";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import type { FotoPublica } from "@/imoveis/fotos-regras";
import type { ConteudoSite, ImovelPublico } from "@/site/site";
import PaginaImovel from "../imoveis/[codigo]/page";
import Inicio from "../page";

/**
 * M7.19 — fotos mais leves: a foto em destaque da galeria da casa deixa o navegador escolher entre a versão pequena e a
 * grande (srcset com a largura real de cada uma e o sizes do quadro), sem o otimizador da Vercel; a capa do site, os
 * cartões e as miniaturas ficam como estavam. Banco e leituras simulados, como nos testes de acessibilidade.
 */
const m = vi.hoisted(() => ({ site: vi.fn(), imoveis: vi.fn(), imovel: vi.fn(), bairro: vi.fn(), portao: vi.fn(), pix: vi.fn() }));
vi.mock("@/site/pagina", () => ({ carregarSite: m.site, metadadosDoSite: vi.fn() }));
vi.mock("@/site/site", async (orig) => ({ ...(await orig<typeof import("@/site/site")>()), imoveisDoSite: m.imoveis, imovelDoSite: m.imovel }));
vi.mock("@/site/bairro", async (orig) => ({ ...(await orig<typeof import("@/site/bairro")>()), lugaresDoSite: m.bairro }));
vi.mock("@/site/pagamento", () => ({ portaoDoSite: m.portao, pixPossivel: m.pix }));
vi.mock("@/db/client", async (orig) => ({ ...(await orig<typeof import("@/db/client")>()), getDb: vi.fn(() => ({})) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NAO_ENCONTRADA");
  },
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...resto }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
}));

const medidas = (gl: number, ga: number, pl: number, pa: number) => ({ grande: { largura: gl, altura: ga }, pequena: { largura: pl, altura: pa } });
/** Deitada 4:3 (a do celular), em pé 3:4, mais larga que o quadro (16:9) e uma sem medidas. */
const fotos: FotoPublica[] = [
  { grande: "/fotos/f1", pequena: "/fotos/f1/pequena", legenda: "Sala", medidas: medidas(2000, 1500, 800, 600) },
  { grande: "/fotos/f2", pequena: "/fotos/f2/pequena", legenda: "", medidas: medidas(1500, 2000, 600, 800) },
  { grande: "/fotos/f3", pequena: "/fotos/f3/pequena", legenda: "Varanda", medidas: medidas(2000, 1125, 800, 450) },
  { grande: "/fotos/f4", pequena: "/fotos/f4/pequena", legenda: "" },
];
const imovel: ImovelPublico = {
  codigo: "403",
  fuso: "America/Sao_Paulo",
  nome: "Studio Exemplo",
  bairro: "Leblon",
  cidade: "Rio de Janeiro",
  capacidade: 4,
  quartos: 0,
  banheiros: 1,
  descricao: "Frase fictícia do apartamento.",
  frase: "",
  camas: [],
  comodidades: [],
  regrasCasa: "",
  aceitaAnimais: false,
  permiteFumar: false,
  permiteFestas: false,
  checkinAPartirDe: "15:00",
  checkoutAte: "11:00",
  estadiaMinima: null,
  fotos,
};
const conteudo: ConteudoSite = {
  organizacaoId: "org",
  nomeEmpresa: "Sua Casa Exemplo",
  textos: TEXTOS_SITE_INICIAIS,
  whatsapp: "5521900000000",
  email: "",
  imagens: { capa: "/imagens-site/capa-grande", marca: "/marca.png", previa: "/imagens-site/capa-pequena" },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.site.mockResolvedValue({ db: {}, conteudo });
  m.imoveis.mockResolvedValue([imovel]);
  m.imovel.mockResolvedValue(imovel);
  m.bairro.mockResolvedValue({ olho: "", titulo: "O Leblon a pé", subtitulo: "", lugares: [{ nome: "Praia fictícia", distancia: "2 min", frase: "", foto: "/imagens-site/lugar" }] });
  m.portao.mockResolvedValue({ ok: false });
  m.pix.mockResolvedValue(false);
});
afterEach(() => cleanup());

const dom = (html: string) => {
  const raiz = document.createElement("div");
  raiz.innerHTML = html;
  return raiz;
};
const props = (params: Record<string, string>) => ({ params: Promise.resolve(params), searchParams: Promise.resolve({}) });
const paginaDaCasa = async () => renderToStaticMarkup(await PaginaImovel(props({ codigo: "403" }) as never));
const emDestaque = (raiz: HTMLElement) => raiz.querySelector<HTMLImageElement>(`.${styles.galeriaPrincipal} img`);

describe("fotos mais leves (M7.19)", () => {
  it("página da casa: a foto em destaque com as duas versões e o sizes do quadro; capa do site, cartões e miniaturas como antes; nada do otimizador", async () => {
    const html = await paginaDaCasa();
    const foto = emDestaque(dom(html));
    expect(foto?.getAttribute("srcset")).toBe("/fotos/f1/pequena 800w, /fotos/f1 2000w");
    expect(foto?.getAttribute("sizes")).toBe(SIZES_GALERIA.varias);
    // A mesma imagem de antes: a grande como `src`, o texto alternativo, o recorte e os estilos de "fill" do next/image.
    expect(foto?.getAttribute("src")).toBe("/fotos/f1");
    expect(foto?.getAttribute("alt")).toBe("Sala");
    expect(foto?.getAttribute("class")).toBe(styles.fotoReal);
    expect(foto?.getAttribute("loading")).toBe("eager");
    expect(foto?.getAttribute("decoding")).toBe("async");
    expect(foto?.getAttribute("style")).toBe("position:absolute;height:100%;width:100%;left:0;top:0;right:0;bottom:0;color:transparent");
    // A pré-carga que o React põe para a foto em destaque leva as duas versões e o sizes, sem o endereço da grande: o
    // navegador escolhe já ali, sem baixar a grande antes (antes, a pré-carga era da grande).
    const precarga = dom(html).querySelector('link[rel="preload"][as="image"][imagesrcset]');
    expect([precarga?.getAttribute("imagesrcset"), precarga?.getAttribute("imagesizes"), precarga?.getAttribute("href")]).toEqual([
      "/fotos/f1/pequena 800w, /fotos/f1 2000w",
      SIZES_GALERIA.varias,
      null,
    ]);
    expect(dom(html).querySelector('link[rel="preload"][href="/fotos/f1"]')).toBeNull();
    // As miniaturas continuam só com a pequena, que já é a menor versão.
    const miniaturas = [...dom(html).querySelectorAll<HTMLImageElement>(`.${styles.miniatura} img`)];
    expect(miniaturas.map((i) => [i.getAttribute("src"), i.getAttribute("srcset")])).toEqual(fotos.map((f) => [f.pequena, null]));
    // A foto do bairro tem uma versão só: sem srcset.
    expect(dom(html).querySelector('img[alt="Foto de Praia fictícia"]')?.getAttribute("srcset")).toBeNull();

    // Página inicial: a capa do site continua só com a grande, mesmo com a versão pequena guardada (no celular ela cobre
    // um quadro mais alto que largo e aparece mais larga que a tela; a pequena ficaria borrada). Sem a pequena, também.
    for (const previa of ["/imagens-site/capa-pequena", "/imagens-site/capa-grande"]) {
      m.site.mockResolvedValue({ db: {}, conteudo: { ...conteudo, imagens: { ...conteudo.imagens, previa } } });
      const inicio = dom(renderToStaticMarkup(await Inicio()));
      const capa = inicio.querySelector<HTMLImageElement>(`img.${styles.capaFoto}`);
      expect(capa?.getAttribute("src")).toBe("/imagens-site/capa-grande");
      expect(capa?.getAttribute("srcset")).toBeNull();
      expect(capa?.getAttribute("sizes")).toBeNull();
      // O cartão da casa continua com a pequena, sem srcset.
      const cartao = inicio.querySelector<HTMLImageElement>('img[alt="Sala"]');
      expect([cartao?.getAttribute("src"), cartao?.getAttribute("srcset")]).toEqual(["/fotos/f1/pequena", null]);
      expect(inicio.innerHTML).not.toContain("/_next/image");
    }
    expect(html).not.toContain("/_next/image");
  });

  it("a largura de cada versão é a que ela cobre no quadro: em pé, 600w; mais larga que o quadro, só a parte que aparece; sem medidas, só a grande", async () => {
    const versoes = async (lista: FotoPublica[]) => {
      m.imovel.mockResolvedValue({ ...imovel, fotos: lista });
      const foto = emDestaque(dom(await paginaDaCasa()));
      return [foto?.getAttribute("src"), foto?.getAttribute("srcset"), foto?.getAttribute("sizes")];
    };
    // Em pé (3:4): a pequena tem 600 de largura, não 800.
    expect(await versoes([fotos[1], fotos[0]])).toEqual(["/fotos/f2", "/fotos/f2/pequena 600w, /fotos/f2 1500w", SIZES_GALERIA.varias]);
    // 16:9 num quadro 3:2: o quadro corta as laterais, e só a altura × 3/2 aparece (450 × 1,5 = 675; 1125 × 1,5 ≈ 1688).
    expect(await versoes([fotos[2], fotos[0]])).toEqual(["/fotos/f3", "/fotos/f3/pequena 675w, /fotos/f3 1688w", SIZES_GALERIA.varias]);
    // Sem medidas (não deu para ler, ou foto de antes sem a versão pequena): só a grande, sem srcset nem sizes, como antes.
    expect(await versoes([fotos[3], fotos[0]])).toEqual(["/fotos/f4", null, null]);
    const semPequena = { grande: "/fotos/f5", pequena: "/fotos/f5", legenda: "", medidas: medidas(2000, 1500, 2000, 1500) };
    expect(await versoes([semPequena, fotos[0]])).toEqual(["/fotos/f5", null, null]);
    // Pequena que não é menor que a grande (foto original pequena): não há o que escolher.
    expect(await versoes([{ ...fotos[0], medidas: medidas(700, 500, 700, 500) }, fotos[1]])).toEqual(["/fotos/f1", null, null]);
    // Uma foto só: o quadro 16:9 da largura toda (4:3 cobre a largura inteira).
    expect(await versoes([fotos[0]])).toEqual(["/fotos/f1", "/fotos/f1/pequena 800w, /fotos/f1 2000w", SIZES_GALERIA.uma]);
  });

  it("trocar de foto troca as versões e o sizes da foto em destaque, e a foto sem medidas volta a ter só a grande", () => {
    render(<GaleriaImovel nome="Studio Exemplo" fotos={fotos} />);
    const galeria = within(screen.getByRole("region", { name: "Fotos de Studio Exemplo" }));
    expect(galeria.getByRole("img", { name: "Sala" }).getAttribute("srcset")).toBe("/fotos/f1/pequena 800w, /fotos/f1 2000w");
    fireEvent.click(galeria.getByRole("button", { name: "Ver a foto 2" }));
    const emPe = galeria.getByRole("img", { name: "Foto 2 de Studio Exemplo" });
    expect([emPe.getAttribute("src"), emPe.getAttribute("srcset"), emPe.getAttribute("sizes")]).toEqual(["/fotos/f2", "/fotos/f2/pequena 600w, /fotos/f2 1500w", SIZES_GALERIA.varias]);
    fireEvent.click(galeria.getByRole("button", { name: "Ver a foto 4" }));
    const semMedidas = galeria.getByRole("img", { name: "Foto 4 de Studio Exemplo" });
    expect([semMedidas.getAttribute("src"), semMedidas.getAttribute("srcset"), semMedidas.getAttribute("sizes")]).toEqual(["/fotos/f4", null, null]);
  });

  it("foto que não carrega mostra o texto alternativo, como no next/image; a próxima foto volta ao normal", () => {
    render(<GaleriaImovel nome="Studio Exemplo" fotos={fotos} />);
    const galeria = within(screen.getByRole("region", { name: "Fotos de Studio Exemplo" }));
    const sala = galeria.getByRole("img", { name: "Sala" });
    expect(sala.style.color).toBe("transparent");
    fireEvent.error(sala);
    expect(galeria.getByRole("img", { name: "Sala" }).style.color).toBe("");
    fireEvent.click(galeria.getByRole("button", { name: "Ver a foto 3: Varanda" }));
    expect(galeria.getByRole("img", { name: "Varanda" }).style.color).toBe("transparent");
  });
});
