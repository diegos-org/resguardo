// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEXTOS_SITE_INICIAIS, type TextosSite } from "@/configuracoes/textos-site";
import { TEXTOS_BAIRRO_INICIAIS } from "@/site/bairro";
import type { ConteudoSite, ImovelPublico } from "@/site/site";
import Consulta from "../consulta/page";
import PaginaImovel from "../imoveis/[codigo]/page";
import Catalogo from "../imoveis/page";
import Inicio from "../page";

/**
 * M7.16 — os títulos, os olhos e as frases que estavam fixos no código das páginas do site passam a vir de Configurações
 * → Textos do site (e o olho do bairro, da configuração do bairro). Nunca salvos, o site mostra exatamente o que mostrava;
 * salvos, o texto salvo (com o itálico nos títulos); salvos vazios, o olho e a frase somem sem deixar parágrafo vazio e o
 * título volta ao texto inicial, sem mudar a ordem dos títulos.
 */
const m = vi.hoisted(() => ({ site: vi.fn(), imoveis: vi.fn(), imovel: vi.fn(), bairro: vi.fn(), portao: vi.fn(), pix: vi.fn() }));
vi.mock("@/site/pagina", () => ({ carregarSite: m.site, metadadosDoSite: vi.fn() }));
vi.mock("@/site/site", async (orig) => ({ ...(await orig<typeof import("@/site/site")>()), imoveisDoSite: m.imoveis, imovelDoSite: m.imovel }));
vi.mock("@/site/bairro", async (orig) => ({ ...(await orig<typeof import("@/site/bairro")>()), lugaresDoSite: m.bairro }));
vi.mock("@/site/disponibilidade", async (orig) => ({ ...(await orig<typeof import("@/site/disponibilidade")>()), consultarDisponibilidade: vi.fn(), lerConfigDaConsulta: vi.fn(async () => ({})) }));
vi.mock("@/site/pagamento", () => ({ portaoDoSite: m.portao, pixPossivel: m.pix }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NAO_ENCONTRADA");
  },
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...resto }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
}));

// Casa e lugar fictícios.
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
  camas: [],
  comodidades: [],
  regrasCasa: "",
  aceitaAnimais: false,
  permiteFumar: false,
  permiteFestas: false,
  checkinAPartirDe: "15:00",
  checkoutAte: "11:00",
  estadiaMinima: null,
  fotos: [],
};
// As seções Como reservar e Contato só aparecem com o texto delas preenchido.
const comSecoes: TextosSite = { ...TEXTOS_SITE_INICIAIS, comoReservar: "Passos fictícios.", contato: "Contato fictício." };
const conteudo = (textos: Partial<TextosSite> = {}): ConteudoSite => ({
  organizacaoId: "org",
  nomeEmpresa: "Sua Casa Exemplo",
  textos: { ...comSecoes, ...textos },
  whatsapp: "5521900000000",
  email: "",
  imagens: { capa: null, marca: "/marca.png" },
});
const lugar = { nome: "Praia Fictícia", distancia: "2 min", frase: "", foto: null };

beforeEach(() => {
  vi.clearAllMocks();
  m.site.mockResolvedValue({ db: {}, conteudo: conteudo() });
  m.imoveis.mockResolvedValue([imovel]);
  m.imovel.mockResolvedValue(imovel);
  m.bairro.mockResolvedValue({ ...TEXTOS_BAIRRO_INICIAIS, lugares: [lugar] });
  m.portao.mockResolvedValue({ ok: false });
  m.pix.mockResolvedValue(false);
});

const dom = (html: string) => {
  const raiz = document.createElement("div");
  raiz.innerHTML = html;
  return raiz;
};
const props = (params: Record<string, string>, searchParams: Record<string, string> = {}) => ({ params: Promise.resolve(params), searchParams: Promise.resolve(searchParams) }) as never;
const telas = async () => ({
  inicio: dom(renderToStaticMarkup(await Inicio())),
  catalogo: dom(renderToStaticMarkup(await Catalogo())),
  casa: dom(renderToStaticMarkup(await PaginaImovel(props({ codigo: "403" })))),
  consulta: dom(renderToStaticMarkup(await Consulta(props({})))),
});
/** Cada filho direto do bloco, como "tag: texto" (o formulário só pela tag). */
const filhos = (bloco: Element | null, ate = 4) =>
  [...(bloco?.children ?? [])].slice(0, ate).map((e) => (e.tagName === "FORM" ? "FORM" : `${e.tagName}: ${e.textContent}`));
const blocos = (t: Awaited<ReturnType<typeof telas>>) => ({
  como: t.inicio.querySelector('[aria-labelledby="titulo-como"] > div'),
  contato: t.inicio.querySelector('[aria-labelledby="titulo-contato"] > div'),
  catalogo: t.catalogo.querySelector("h1")!.parentElement,
  planejar: t.casa.querySelector("aside#planejar"),
  resumo: t.consulta.querySelector('aside[aria-labelledby="titulo-resumo"]'),
  bairro: t.casa.querySelector('section[aria-labelledby="titulo-bairro"]'),
});
const niveis = (raiz: Element) => [...raiz.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => h.tagName);

describe("títulos e frases do site editáveis (M7.16)", () => {
  it("nunca salvos: o site mostra exatamente o que mostrava antes", async () => {
    const b = blocos(await telas());
    expect(filhos(b.como, 3)).toEqual(["P: Passo a passo", "H2: Como reservar", "P: Passos fictícios."]);
    expect(filhos(b.contato, 3)).toEqual(["P: Fale com a gente", "H2: Contato", "P: Contato fictício."]);
    // O olho de Nossas casas continua montado com os bairros das casas (é dado, não texto do painel).
    expect(filhos(b.catalogo, 3)).toEqual(["P: Apartamentos · Leblon", "H1: Nossas casas", "P: Escolha um apartamento para ver o que ele oferece e consultar as datas."]);
    // O cartão da casa não tinha frase: do título vai direto ao formulário.
    expect(filhos(b.planejar, 3)).toEqual(["P: Planeje sua estadia", "H2: Consultar disponibilidade", "FORM"]);
    expect(filhos(b.bairro, 2)).toEqual(["P: O bairro à sua porta", `H2: ${TEXTOS_BAIRRO_INICIAIS.titulo}`]);
    expect(b.catalogo!.querySelector("h1 em")).toBeNull();
    // O Resumo da viagem com "Como reservar" vazio, como vem de fábrica: a frase de antes.
    m.site.mockResolvedValue({ db: {}, conteudo: conteudo({ comoReservar: "" }) });
    expect(filhos(blocos(await telas()).resumo, 3)).toEqual(["P: Sua estadia, sem surpresas", "H2: Resumo da viagem", "P: Escolha o apartamento, as datas e quantas pessoas."]);
  });

  it("salvos com outro texto: o site mostra o salvo, com a parte entre asteriscos dos títulos em itálico", async () => {
    m.site.mockResolvedValue({
      db: {},
      conteudo: conteudo({
        comoReservarOlho: "Olho fictício 1",
        comoReservarTitulo: "Reserve *fácil*",
        contatoOlho: "Olho fictício 2",
        contatoTitulo: "Fale *conosco*",
        catalogoTitulo: "Encontre sua casa *no Leblon.*",
        catalogoTexto: "Frase fictícia de Nossas casas.",
        planejarOlho: "Olho fictício 3",
        planejarTitulo: "Quais são seus *planos?*",
        planejarTexto: "Frase fictícia do cartão.",
        resumoOlho: "Olho fictício 4",
        resumoTitulo: "Sua *viagem*",
        resumoTexto: "Frase fictícia do resumo.",
        comoReservar: "",
      }),
    });
    m.bairro.mockResolvedValue({ ...TEXTOS_BAIRRO_INICIAIS, olho: "Olho fictício 5", lugares: [lugar] });
    const t = await telas();
    const b = blocos(t);
    // Sem o texto de Como reservar, a seção não aparece (como antes); o Resumo da viagem usa a frase própria.
    expect(b.como).toBeNull();
    expect(filhos(b.contato, 2)).toEqual(["P: Olho fictício 2", "H2: Fale conosco"]);
    expect(b.contato!.querySelector("h2 em")?.textContent).toBe("conosco");
    expect(filhos(b.catalogo, 3)).toEqual(["P: Apartamentos · Leblon", "H1: Encontre sua casa no Leblon.", "P: Frase fictícia de Nossas casas."]);
    expect(b.catalogo!.querySelector("h1 em")?.textContent).toBe("no Leblon.");
    expect(filhos(b.planejar, 4)).toEqual(["P: Olho fictício 3", "H2: Quais são seus planos?", "P: Frase fictícia do cartão.", "FORM"]);
    expect(b.planejar!.querySelector("h2 em")?.textContent).toBe("planos?");
    expect(filhos(b.resumo, 3)).toEqual(["P: Olho fictício 4", "H2: Sua viagem", "P: Frase fictícia do resumo."]);
    expect(filhos(b.bairro, 1)).toEqual(["P: Olho fictício 5"]);
    // Com o texto de Como reservar preenchido, o Resumo da viagem usa o dele (como desde o M7.1), e a seção volta.
    m.site.mockResolvedValue({ db: {}, conteudo: conteudo({ comoReservarOlho: "Olho fictício 1", comoReservarTitulo: "Reserve *fácil*", resumoTexto: "Frase fictícia do resumo." }) });
    const t2 = await telas();
    expect(filhos(blocos(t2).como, 3)).toEqual(["P: Olho fictício 1", "H2: Reserve fácil", "P: Passos fictícios."]);
    expect(filhos(blocos(t2).resumo, 3)).toEqual(["P: Sua estadia, sem surpresas", "H2: Resumo da viagem", "P: Passos fictícios."]);
  });

  it("salvos vazios: o olho e a frase somem sem parágrafo vazio e o título volta ao texto inicial; a ordem dos títulos não muda", async () => {
    const antes = await telas();
    const vazios = Object.fromEntries(
      (["comoReservarOlho", "comoReservarTitulo", "contatoOlho", "contatoTitulo", "catalogoTitulo", "catalogoTexto", "planejarOlho", "planejarTitulo", "planejarTexto", "resumoOlho", "resumoTitulo", "resumoTexto"] as const).map((k) => [k, ""]),
    );
    m.bairro.mockResolvedValue({ ...TEXTOS_BAIRRO_INICIAIS, olho: "", lugares: [lugar] });
    // As seções Como reservar e Contato preenchidas, com o olho e o título vazios.
    m.site.mockResolvedValue({ db: {}, conteudo: conteudo(vazios) });
    const depois = await telas();
    const b = blocos(depois);
    expect(filhos(b.como, 2)).toEqual(["H2: Como reservar", "P: Passos fictícios."]);
    expect(filhos(b.contato, 2)).toEqual(["H2: Contato", "P: Contato fictício."]);
    expect(filhos(b.catalogo, 3)).toEqual(["P: Apartamentos · Leblon", "H1: Nossas casas"]);
    expect(filhos(b.planejar, 2)).toEqual(["H2: Consultar disponibilidade", "FORM"]);
    expect(filhos(b.bairro, 1)).toEqual([`H2: ${TEXTOS_BAIRRO_INICIAIS.titulo}`]);
    for (const tela of Object.values(depois)) expect(tela.querySelectorAll("p:empty")).toHaveLength(0);
    // A ordem dos títulos de cada página é a mesma de antes (nenhum título some).
    for (const k of ["inicio", "catalogo", "casa", "consulta"] as const) expect(niveis(depois[k]), k).toEqual(niveis(antes[k]));
    // O Resumo da viagem com "Como reservar" e a frase própria vazios: do título direto aos valores a confirmar.
    m.site.mockResolvedValue({ db: {}, conteudo: conteudo({ ...vazios, comoReservar: "" }) });
    const semFrase = await telas();
    expect(filhos(blocos(semFrase).resumo, 2)).toEqual(["H2: Resumo da viagem", "DL: Estadiaa confirmarLimpeza e demais taxasa confirmarTotala confirmar"]);
    expect(semFrase.consulta.querySelectorAll("p:empty")).toHaveLength(0);
  });
});
