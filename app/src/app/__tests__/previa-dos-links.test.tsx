import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEXTOS_PROPRIETARIOS_INICIAIS } from "@/configuracoes/pagina-proprietarios";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import type { ConteudoSite, ImovelPublico } from "@/site/site";
import { generateMetadata as metadadosAnunciar } from "../anunciar/page";
import { generateMetadata as metadadosConsulta } from "../consulta/page";
import { generateMetadata as metadadosCasa } from "../imoveis/[codigo]/page";
import { generateMetadata as metadadosCatalogo } from "../imoveis/page";
import { generateMetadata as metadadosInicio } from "../page";

/**
 * M7.13: prévia dos links (WhatsApp e redes) e descrição de cada página, pelos metadados de verdade do site
 * (`metadadosDoSite`); só a leitura do banco é trocada por dados fictícios.
 */
const m = vi.hoisted(() => ({ conteudo: vi.fn(), imovel: vi.fn(), textos: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/site/site", async (orig) => ({ ...(await orig<typeof import("@/site/site")>()), conteudoDoSite: m.conteudo, imovelDoSite: m.imovel }));
vi.mock("@/configuracoes/pagina-proprietarios", async (orig) => ({ ...(await orig<typeof import("@/configuracoes/pagina-proprietarios")>()), lerTextosProprietarios: m.textos }));
vi.mock("@/email/correio", () => ({ correioDoAmbiente: () => null }));
vi.mock("@/marketplace/acoes", () => ({ entrarCadastroAcao: vi.fn(), pedirCodigoCadastroAcao: vi.fn() }));
vi.mock("@/components/site/FormContatoProprietario", () => ({ FormContatoProprietario: () => null }));

const conteudo = (resto: Partial<ConteudoSite> = {}): ConteudoSite => ({
  organizacaoId: "org",
  nomeEmpresa: "Casa Exemplo",
  textos: { ...TEXTOS_SITE_INICIAIS },
  whatsapp: null,
  email: "",
  imagens: { capa: "/imagens-site/c1", marca: "/marca.png", previa: "/imagens-site/c1-pequena" },
  site: "https://casa-exemplo.vercel.app",
  ...resto,
});
const imovel: ImovelPublico = {
  codigo: "403",
  fuso: "America/Sao_Paulo",
  nome: "Studio Exemplo",
  bairro: "Leblon",
  cidade: "Rio de Janeiro",
  capacidade: 2,
  quartos: 0,
  banheiros: 1,
  descricao: "Um refúgio para dois, com o Leblon à porta. Cama queen e cozinha equipada.",
  camas: [],
  comodidades: [],
  regrasCasa: "",
  aceitaAnimais: false,
  permiteFumar: false,
  permiteFestas: false,
  checkinAPartirDe: "15:00",
  checkoutAte: "11:00",
  estadiaMinima: null,
  fotos: [{ grande: "/fotos/f1", pequena: "/fotos/f1/pequena", legenda: "" }],
};
const semParametros = { params: Promise.resolve({}), searchParams: Promise.resolve({}) };
const casa = (sp: Record<string, string> = {}) => ({ params: Promise.resolve({ codigo: "403" }), searchParams: Promise.resolve(sp) });

beforeEach(() => {
  vi.clearAllMocks();
  m.conteudo.mockResolvedValue(conteudo());
  m.imovel.mockResolvedValue(imovel);
  m.textos.mockResolvedValue(TEXTOS_PROPRIETARIOS_INICIAIS);
});

describe("prévia dos links do site (M7.13)", () => {
  it("início: a foto de capa do site (versão pequena), o nome da empresa e o subtítulo da capa", async () => {
    const meta = await metadadosInicio();
    expect(meta).toMatchObject({ title: "Casa Exemplo", description: TEXTOS_SITE_INICIAIS.subtitulo, openGraph: { siteName: "Casa Exemplo", images: [{ url: "/imagens-site/c1-pequena" }] } });
    expect(String(meta.metadataBase)).toBe("https://casa-exemplo.vercel.app/");
    expect(meta.alternates).toBeUndefined();
  });

  it("início sem foto de capa: a prévia sai sem imagem", async () => {
    m.conteudo.mockResolvedValue(conteudo({ imagens: { capa: null, marca: "/marca.png", previa: null } }));
    const meta = await metadadosInicio();
    expect(meta.openGraph).not.toHaveProperty("images");
    expect(meta.twitter).toMatchObject({ card: "summary" });
  });

  it("Nossas casas: a frase da vitrine; sem ela, o subtítulo do site", async () => {
    expect(await metadadosCatalogo()).toMatchObject({ title: "Nossas casas — Casa Exemplo", description: TEXTOS_SITE_INICIAIS.vitrineTexto });
    m.conteudo.mockResolvedValue(conteudo({ textos: { ...TEXTOS_SITE_INICIAIS, vitrineTexto: "" } }));
    expect((await metadadosCatalogo()).description).toBe(TEXTOS_SITE_INICIAIS.subtitulo);
  });

  it("página para proprietários: a frase da capa dela (Configurações → Página para proprietários)", async () => {
    expect(await metadadosAnunciar()).toMatchObject({ title: "Anuncie seu imóvel — Casa Exemplo", description: TEXTOS_PROPRIETARIOS_INICIAIS.subtitulo });
    expect(m.textos).toHaveBeenCalledWith({}, "org");
  });

  it("casa: a foto pequena da capa da casa, o nome e a frase dela; o endereço principal sem as datas do link", async () => {
    const meta = await metadadosCasa(casa({ checkin: "2099-10-12", checkout: "2099-10-15", guests: "2" }));
    expect(meta).toMatchObject({
      title: "Studio Exemplo — Casa Exemplo",
      description: "Um refúgio para dois, com o Leblon à porta.",
      alternates: { canonical: "/imoveis/403" },
      openGraph: { url: "/imoveis/403", images: [{ url: "/fotos/f1/pequena", alt: "Foto de Studio Exemplo" }] },
      twitter: { card: "summary_large_image" },
    });
  });

  it("casa sem foto: sem imagem, nem a capa do site no lugar", async () => {
    m.imovel.mockResolvedValue({ ...imovel, fotos: [] });
    const meta = await metadadosCasa(casa());
    expect(meta.openGraph).not.toHaveProperty("images");
    expect(JSON.stringify(meta)).not.toContain("/imagens-site/");
  });

  it("casa não encontrada: os metadados dela (M7.8), sem endereço principal", async () => {
    m.imovel.mockResolvedValue(null);
    const meta = await metadadosCasa(casa());
    expect(meta).toMatchObject({ title: "Casa não encontrada — Casa Exemplo", description: TEXTOS_SITE_INICIAIS.casaNaoEncontradaTexto });
    expect(meta.alternates).toBeUndefined();
  });

  it("consulta: a frase abaixo do título; busca em todas as casas: o aviso acima das casas; as duas no endereço principal /consulta", async () => {
    for (const sp of [{}, { imovel: "403", entrada: "2099-10-12" }]) {
      const meta = await metadadosConsulta({ ...semParametros, searchParams: Promise.resolve(sp) });
      expect(meta).toMatchObject({ title: "Consulta — Casa Exemplo", description: TEXTOS_SITE_INICIAIS.consultaTexto, alternates: { canonical: "/consulta" }, openGraph: { url: "/consulta" } });
    }
    const busca = { ...semParametros, searchParams: Promise.resolve({ checkin: "2099-10-12", checkout: "2099-10-15", guests: "2" }) };
    expect(await metadadosConsulta(busca)).toMatchObject({ title: "Sua busca — Casa Exemplo", description: TEXTOS_SITE_INICIAIS.buscaAviso, alternates: { canonical: "/consulta" }, openGraph: { url: "/consulta" } });
    // Aviso da busca apagado no painel: a descrição do site, nunca um texto inventado.
    m.conteudo.mockResolvedValue(conteudo({ textos: { ...TEXTOS_SITE_INICIAIS, buscaAviso: "" } }));
    expect((await metadadosConsulta({ ...busca, searchParams: Promise.resolve({ checkin: "2099-10-12" }) })).description).toBe(TEXTOS_SITE_INICIAIS.subtitulo);
  });

  it("campo Site com http ou vazio: sem base e sem endereço principal; a foto da casa continua", async () => {
    for (const site of ["http://casa-exemplo.vercel.app", ""]) {
      m.conteudo.mockResolvedValue(conteudo({ site }));
      const meta = await metadadosCasa(casa());
      expect(meta.metadataBase).toBeUndefined();
      expect(meta.alternates).toBeUndefined();
      expect(meta.openGraph).not.toHaveProperty("url");
      expect(meta.openGraph).toMatchObject({ images: [{ url: "/fotos/f1/pequena" }] });
    }
  });
});
