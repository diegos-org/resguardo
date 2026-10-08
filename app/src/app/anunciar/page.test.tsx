import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RASCUNHO_COMO_FUNCIONA } from "@/configuracoes/como-funciona";
import { MERCADO_VAZIO, TEXTOS_PROPRIETARIOS_INICIAIS } from "@/configuracoes/pagina-proprietarios";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import Page from "./page";

const m = vi.hoisted(() => ({ site: vi.fn(), imoveis: vi.fn(), textos: vi.fn(), mercado: vi.fn(), comoFunciona: vi.fn(), correio: vi.fn() }));
vi.mock("@/site/pagina", () => ({ carregarSite: m.site, metadadosDoSite: vi.fn() }));
vi.mock("@/site/site", async (orig) => ({ ...(await orig<typeof import("@/site/site")>()), imoveisDoSite: m.imoveis }));
vi.mock("@/configuracoes/pagina-proprietarios", async (orig) => ({ ...(await orig<typeof import("@/configuracoes/pagina-proprietarios")>()), lerTextosProprietarios: m.textos, lerMercado: m.mercado }));
vi.mock("@/configuracoes/como-funciona", async (orig) => ({ ...(await orig<typeof import("@/configuracoes/como-funciona")>()), lerComoFunciona: m.comoFunciona }));
vi.mock("@/email/correio", () => ({ correioDoAmbiente: m.correio }));
vi.mock("@/marketplace/acoes", () => ({ entrarCadastroAcao: vi.fn(), pedirCodigoCadastroAcao: vi.fn() }));
vi.mock("@/components/site/FormContatoProprietario", () => ({ FormContatoProprietario: ({ empresa }: { empresa: string }) => <form aria-label="Pedir contato para a gestão completa">{empresa}</form> }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const imovel = { codigo: "403", fuso: "America/Sao_Paulo", nome: "Studio Exemplo", bairro: "Leblon", cidade: "Rio de Janeiro", capacidade: 4, quartos: 0, banheiros: 1, descricao: "", camas: [], comodidades: [], regrasCasa: "", aceitaAnimais: false, permiteFumar: false, permiteFestas: false, checkinAPartirDe: "15:00", checkoutAte: "11:00", estadiaMinima: null, fotos: [] };
const conteudo = { organizacaoId: "org", nomeEmpresa: "Casa Exemplo", textos: TEXTOS_SITE_INICIAIS, whatsapp: null, email: "", imagens: { capa: null, marca: "/marca.png" } };
const segredo = process.env.AUTH_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = "segredo-de-teste";
  m.site.mockResolvedValue({ db: {}, conteudo });
  m.imoveis.mockResolvedValue([imovel]);
  m.textos.mockResolvedValue(TEXTOS_PROPRIETARIOS_INICIAIS);
  m.mercado.mockResolvedValue(MERCADO_VAZIO);
  m.comoFunciona.mockResolvedValue([]);
  m.correio.mockReturnValue({ nome: "memoria" });
});
afterEach(() => {
  if (segredo === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = segredo;
});
const html = async (params: Record<string, string> = {}) => renderToStaticMarkup(await Page({ params: Promise.resolve({}), searchParams: Promise.resolve(params) }));

it("página inteira: capa, as duas formas de trabalhar, como gerimos, vitrine, portfólio, pedido de contato e cadastro do marketplace", async () => {
  const h = await html();
  expect(m.textos).toHaveBeenCalledWith({}, "org");
  expect(h).toContain("Seu imóvel bem cuidado, <em>sem dor de cabeça</em>.");
  expect(h).toContain('href="#contato"');
  expect(h).toContain('href="#marketplace"');
  expect(h).toContain("Gestão completa");
  expect(h).toContain("Marketplace");
  // Como gerimos: quatro passos numerados, do texto-base.
  expect(h).toContain("04 /");
  expect(h).toContain("Atendimento ao hóspede");
  // Vitrine com os imóveis públicos do site.
  expect(h).toContain("/imoveis/403");
  expect(h).toContain("Poucos imóveis, <em>muito cuidado</em>.");
  // Pedido de contato (formulário próprio) com o nome da empresa, e o cadastro do marketplace (passo 1: e-mail).
  expect(h).toContain('id="contato"');
  expect(h).toContain('aria-label="Pedir contato para a gestão completa"');
  expect(h).toContain('id="marketplace"');
  expect(h).toContain('aria-label="Confirmar e-mail"');
  // Sem números de mercado e sem "Como funciona" publicado, essas seções não aparecem.
  expect(h).not.toContain("sem garantia");
  expect(h).not.toContain("Como funciona");
});

it("sem imóveis públicos, sem vitrine; \"Como gerimos\" e portfólio vazios somem", async () => {
  m.imoveis.mockResolvedValue([]);
  m.textos.mockResolvedValue({ ...TEXTOS_PROPRIETARIOS_INICIAIS, como: "", portfolioTitulo: "" });
  const h = await html();
  expect(h).not.toContain("/imoveis/403");
  expect(h).not.toContain("Atendimento ao hóspede");
  expect(h).not.toContain("muito cuidado");
});

it("faixa de mercado só com os números do painel, o mês, a fonte e o aviso de que não há garantia", async () => {
  m.mercado.mockResolvedValue({
    referencia: "2026-09",
    fonte: "reservas dos imóveis que administramos",
    linhas: [
      { tipo: "Studio", diaria: 45000, ocupacao: 7250, liquido: 680000 },
      { tipo: "2 quartos", diaria: 125050, ocupacao: 6500, liquido: null },
    ],
  });
  const h = await html();
  expect(h).toContain('aria-label="Studio"');
  expect(h).toContain("R$ 450,00");
  expect(h).toContain("72,5%");
  expect(h).toContain("R$ 6.800,00");
  expect(h).toContain("R$ 1.250,50");
  expect(h).toContain("Números de setembro de 2026 (reservas dos imóveis que administramos). São uma estimativa, sem garantia");
  // Linha sem líquido não mostra o rótulo vazio.
  expect(h.match(/Líquido por mês, estimado/g)).toHaveLength(1);
});

it("\"Como funciona\": a versão publicada, com o nome da empresa e o aviso de que os dados do contrato ficam no portal", async () => {
  m.comoFunciona.mockResolvedValue([{ numero: 2, data: "2026-10-07", autorId: null, secoes: { ...RASCUNHO_COMO_FUNCIONA, contestacoes: "" }, empresa: "Casa Exemplo" }]);
  const h = await html();
  expect(h).toContain("Como funciona");
  expect(h).toContain("(versão 2, de 07/10/2026)");
  expect(h).toContain("<summary>O que a empresa faz por você</summary>");
  expect(h).toContain("A Casa Exemplo cuida do seu imóvel");
  // Seção vazia não aparece.
  expect(h).not.toContain("Contestações de pagamento");
});

it("no meio do cadastro (código enviado ou erro), só o cadastro, com o caminho de volta", async () => {
  const h = await html({ etapa: "codigo", email: "maria@exemplo.com" });
  expect(h).toContain('aria-label="Digitar código"');
  expect(h).toContain("maria@exemplo.com");
  expect(h).toContain('href="/anunciar"');
  expect(h).not.toContain('id="contato"');
  expect(m.imoveis).not.toHaveBeenCalled();
  const e = await html({ erro: "codigo" });
  expect(e).toContain("Código incorreto ou vencido.");
  expect(e).not.toContain('id="contato"');
});

it("sem e-mail configurado no servidor, o cadastro avisa que ainda não está disponível; o resto da página continua", async () => {
  m.correio.mockReturnValue(null);
  const h = await html();
  expect(h).toContain("O cadastro pelo site ainda não está disponível.");
  expect(h).not.toContain('aria-label="Confirmar e-mail"');
  expect(h).toContain('id="contato"');
});
