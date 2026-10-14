import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import { AVISO_SEM_CONTATO, type ConteudoSite, type ImovelPublico } from "@/site/site";
import CasaNaoEncontrada, { generateMetadata as metadadosDaCasa } from "../imoveis/[codigo]/not-found";
import PaginaImovel, { generateMetadata as metadadosDoImovel } from "../imoveis/[codigo]/page";
import Catalogo from "../imoveis/page";
import NaoEncontradaNoSite, { generateMetadata as metadadosDaPagina } from "../not-found";
import Inicio from "../page";

/**
 * M7.8: página não encontrada do site (endereço errado e casa que não existe) e o aviso do site sem nenhuma casa publicada
 * — o caso da produção hoje — na capa, em Nossas casas e na página não encontrada.
 */
const m = vi.hoisted(() => ({ site: vi.fn(), meta: vi.fn(), imoveis: vi.fn(), imovel: vi.fn(), tem: vi.fn() }));
vi.mock("@/site/pagina", () => ({ carregarSite: m.site, metadadosDoSite: m.meta }));
vi.mock("@/site/site", async (orig) => ({ ...(await orig<typeof import("@/site/site")>()), imoveisDoSite: m.imoveis, imovelDoSite: m.imovel, temCasaNoSite: m.tem }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NAO_ENCONTRADA");
  },
}));
vi.mock("next/link", () => ({ default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a> }));

const imovel: ImovelPublico = {
  codigo: "403",
  fuso: "America/Sao_Paulo",
  nome: "Studio Exemplo",
  bairro: "Leblon",
  cidade: "Rio de Janeiro",
  capacidade: 4,
  quartos: 0,
  banheiros: 1,
  descricao: "",
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
const conteudo: ConteudoSite = { organizacaoId: "org", nomeEmpresa: "Sua Casa Exemplo", textos: { ...TEXTOS_SITE_INICIAIS }, whatsapp: "5521900000000", email: "", imagens: { capa: null, marca: "/marca.png" } };
const comTextos = (t: Partial<ConteudoSite["textos"]>, resto: Partial<ConteudoSite> = {}) => ({ ...conteudo, ...resto, textos: { ...conteudo.textos, ...t } });

beforeEach(() => {
  vi.clearAllMocks();
  m.site.mockResolvedValue({ db: {}, conteudo });
  m.imoveis.mockResolvedValue([imovel]);
  m.imovel.mockResolvedValue(null);
  m.tem.mockResolvedValue(true);
});

describe("página não encontrada do site (M7.8)", () => {
  it("endereço errado: no visual do site, em português, com o nome da empresa, a frase e \"Conhecer as casas\"", async () => {
    const h = renderToStaticMarkup(await NaoEncontradaNoSite());
    expect(h).toContain('aria-label="Principal"'); // a moldura do site (cabeçalho com o menu)
    expect(h).toContain("<h1 id=\"titulo-nao-encontrada\">Página não encontrada</h1>");
    expect(h).toContain("Sua Casa Exemplo");
    expect(h).toContain("Você pode voltar ao catálogo para escolher sua casa.");
    expect(h).toMatch(/<a href="\/imoveis"[^>]*>Conhecer as casas/);
    expect(h).not.toContain("could not be found");
    expect(h).not.toContain(TEXTOS_SITE_INICIAIS.semCasasTexto);
    // Para o botão, só a conferência curta de que há casa no site: nada da lista nem das fotos.
    expect(m.tem).toHaveBeenCalledWith({}, "org");
    expect(m.imoveis).not.toHaveBeenCalled();
  });

  it("casa que não existe: \"Casa não encontrada\" com a frase do estudo", async () => {
    const h = renderToStaticMarkup(await CasaNaoEncontrada());
    expect(h).toContain("Casa não encontrada");
    expect(h).toContain("Conheça os imóveis disponíveis no catálogo.");
    expect(h).toContain("Conhecer as casas");
  });

  it("os textos vêm de Configurações → Site; título salvo vazio volta ao texto-base e frase salva vazia some", async () => {
    m.site.mockResolvedValue({ db: {}, conteudo: comTextos({ naoEncontradoTitulo: "Esse endereço não existe", naoEncontradoTexto: "Frase fictícia." }) });
    let h = renderToStaticMarkup(await NaoEncontradaNoSite());
    expect(h).toContain("Esse endereço não existe");
    expect(h).toContain("Frase fictícia.");
    m.site.mockResolvedValue({ db: {}, conteudo: comTextos({ naoEncontradoTitulo: "", naoEncontradoTexto: "" }) });
    h = renderToStaticMarkup(await NaoEncontradaNoSite());
    expect(h).toContain("Página não encontrada");
    expect(h).not.toContain("Você pode voltar ao catálogo");
    expect(h).toContain("Conhecer as casas");
  });

  it("sem nenhuma casa publicada: em vez de levar a um catálogo vazio, o aviso com o contato e a volta ao início", async () => {
    m.tem.mockResolvedValue(false);
    const h = renderToStaticMarkup(await NaoEncontradaNoSite());
    expect(h).toContain("Página não encontrada");
    expect(h).toContain(TEXTOS_SITE_INICIAIS.semCasasTexto);
    expect(h).toContain("Falar pelo WhatsApp");
    expect(h).toContain("https://wa.me/5521900000000?text=");
    expect(h).toMatch(/<a href="\/"[^>]*>Voltar ao início/);
    expect(h).not.toContain("Conhecer as casas");
    expect(h).not.toContain("Você pode voltar ao catálogo");
  });

  it("sem organização definida (site em configuração): o título-base e a volta ao início, sem consultar casas", async () => {
    m.site.mockResolvedValue({ db: {}, conteudo: null });
    const h = renderToStaticMarkup(await NaoEncontradaNoSite());
    expect(h).toContain("Página não encontrada");
    expect(h).toContain("Voltar ao início");
    expect(h).not.toContain("Conhecer as casas");
    expect(m.tem).not.toHaveBeenCalled();
    expect(m.imoveis).not.toHaveBeenCalled();
  });

  it("título da aba: o da página não encontrada com o nome da empresa (metadados do site)", async () => {
    await metadadosDaPagina();
    expect(m.meta).toHaveBeenLastCalledWith("Página não encontrada");
    await metadadosDaCasa();
    expect(m.meta).toHaveBeenLastCalledWith("Casa não encontrada");
    m.site.mockResolvedValue({ db: {}, conteudo: comTextos({ casaNaoEncontradaTitulo: "Essa casa saiu do site" }) });
    await metadadosDaCasa();
    expect(m.meta).toHaveBeenLastCalledWith("Essa casa saiu do site");
  });

  it("página do imóvel: código que não existe ou saiu do site cai na página \"Casa não encontrada\" (a aba vem dela)", async () => {
    const props = { params: Promise.resolve({ codigo: "NAOEXISTE" }), searchParams: Promise.resolve({}) };
    await expect(PaginaImovel(props)).rejects.toThrow("NAO_ENCONTRADA");
    expect(m.imovel).toHaveBeenCalledWith({}, "org", "NAOEXISTE");
    const app = join(dirname(fileURLToPath(import.meta.url)), "..");
    expect(existsSync(join(app, "imoveis", "[codigo]", "not-found.tsx"))).toBe(true);
    // O título da aba já sai "Casa não encontrada" pelos metadados da própria página, sem depender só da not-found.
    await metadadosDoImovel(props);
    expect(m.meta).toHaveBeenLastCalledWith("Casa não encontrada");
    m.site.mockResolvedValue({ db: {}, conteudo: comTextos({ casaNaoEncontradaTitulo: "Essa casa saiu do site" }) });
    await metadadosDoImovel(props);
    expect(m.meta).toHaveBeenLastCalledWith("Essa casa saiu do site");
  });

  it("página do imóvel: a casa que existe tem o nome dela na aba; site sem organização, o título-base", async () => {
    const props = { params: Promise.resolve({ codigo: "403" }), searchParams: Promise.resolve({}) };
    m.imovel.mockResolvedValue(imovel);
    await metadadosDoImovel(props);
    expect(m.meta).toHaveBeenLastCalledWith("Studio Exemplo");
    m.site.mockResolvedValue({ db: {}, conteudo: null });
    m.imovel.mockClear();
    await metadadosDoImovel(props);
    expect(m.meta).toHaveBeenLastCalledWith(undefined);
    expect(m.imovel).not.toHaveBeenCalled();
  });
});

describe("site sem nenhuma casa publicada (M7.8)", () => {
  beforeEach(() => m.imoveis.mockResolvedValue([]));

  it("página inicial: a vitrine avisa e oferece o contato, em vez de \"Em breve.\"; a busca não aparece", async () => {
    const h = renderToStaticMarkup(await Inicio());
    expect(h).toContain(TEXTOS_SITE_INICIAIS.semCasasTexto);
    expect(h).toContain("Falar pelo WhatsApp");
    expect(h).not.toContain("Em breve.");
    expect(h).not.toContain('action="/consulta"');
  });

  it("Nossas casas: o aviso no lugar da lista, sem a frase \"Escolha um apartamento\"", async () => {
    const h = renderToStaticMarkup(await Catalogo());
    expect(h).toContain(TEXTOS_SITE_INICIAIS.semCasasTexto);
    expect(h).not.toContain("Em breve.");
    expect(h).not.toContain("Escolha um apartamento");
  });

  it("o aviso é o texto editado em Configurações → Site; sem WhatsApp, o botão é o e-mail; sem os dois, o aviso de contato não configurado", async () => {
    m.site.mockResolvedValue({ db: {}, conteudo: comTextos({ semCasasTexto: "Aviso fictício." }, { whatsapp: null, email: "contato@exemplo.com" }) });
    let h = renderToStaticMarkup(await Catalogo());
    expect(h).toContain("Aviso fictício.");
    expect(h).toContain('href="mailto:contato@exemplo.com?subject=Contato%20pelo%20site"');
    expect(h).toContain("Enviar um e-mail");
    expect(h).not.toContain("Falar pelo WhatsApp");
    expect(h).not.toContain(AVISO_SEM_CONTATO);
    for (const vazio of ["", "   "]) {
      m.site.mockResolvedValue({ db: {}, conteudo: comTextos({ semCasasTexto: vazio }, { whatsapp: null, email: vazio }) });
      h = renderToStaticMarkup(await Catalogo());
      // Salvo vazio ou só com espaços (a tela não deixa, mas o dado pode vir assim): o texto-base, nunca um aviso em branco.
      expect(h).toContain(TEXTOS_SITE_INICIAIS.semCasasTexto);
      // Sem canal (um e-mail só de espaços também não é canal): a página diz que o contato não foi configurado.
      expect(h).toContain(AVISO_SEM_CONTATO);
      expect(h).not.toContain("mailto:");
      expect(h).not.toContain("wa.me");
    }
  });

  it("com casas, nada muda: a vitrine e a lista aparecem e o aviso não", async () => {
    m.imoveis.mockResolvedValue([imovel]);
    expect(renderToStaticMarkup(await Inicio())).not.toContain(TEXTOS_SITE_INICIAIS.semCasasTexto);
    const h = renderToStaticMarkup(await Catalogo());
    expect(h).toContain("Studio Exemplo");
    expect(h).not.toContain(TEXTOS_SITE_INICIAIS.semCasasTexto);
  });
});
