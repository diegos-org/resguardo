import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import Convite, { generateMetadata as metadadosConvite } from "../convite/[token]/page";
import Entrar, { generateMetadata as metadadosEntrar } from "../entrar/page";
import { generateMetadata as metadadosEquipe } from "../equipe/page";

const m = vi.hoisted(() => ({ site: vi.fn(), convite: vi.fn() }));
vi.mock("@/site/pagina", () => ({ carregarSite: m.site }));
vi.mock("@/acesso/auth", () => ({ loginConfigurado: true, loginCodigoConfigurado: true, loginGoogleConfigurado: false, loginSenhaConfigurado: false, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("@/acesso/entrar-acoes", () => ({ entrarComCodigo: vi.fn(), entrarComSenhaAcao: vi.fn(), pedirCodigoAcao: vi.fn() }));
vi.mock("@/acesso/sessao-atual", () => ({ obterSessao: vi.fn() }));
vi.mock("@/equipe/acoes", () => ({ marcarFeitaAcao: vi.fn(), trocarMinhaSenhaAcao: vi.fn() }));
vi.mock("@/convites/acoes", () => ({ seguirConvite: vi.fn() }));
vi.mock("@/convites/convites", () => ({ lerConvite: m.convite }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const conteudo = { organizacaoId: "org", nomeEmpresa: "Casa Exemplo", textos: TEXTOS_SITE_INICIAIS, whatsapp: null, email: "", imagens: { capa: null, marca: "/marca.png" } };
const comSite = () => m.site.mockResolvedValue({ db: {}, conteudo });
const semSite = () => m.site.mockResolvedValue({ db: {}, conteudo: null });

const entrar = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await Entrar({ params: Promise.resolve({}), searchParams: Promise.resolve(sp) } as PageProps<"/entrar">));
const convite = async () => renderToStaticMarkup(await Convite({ params: Promise.resolve({ token: "token-ficticio" }), searchParams: Promise.resolve({}) } as PageProps<"/convite/[token]">));

beforeEach(() => {
  vi.clearAllMocks();
  comSite();
});

describe("telas de acesso: título e descrição próprios, com o nome da empresa da configuração (M7.10)", () => {
  it("entrada, convite e equipe têm título e descrição da própria tela, sem a descrição do painel interno", async () => {
    const metas = [await metadadosEntrar(), await metadadosConvite(), await metadadosEquipe()];
    expect(metas).toEqual([
      { title: "Entrar — Casa Exemplo", description: "Área da equipe e dos proprietários. Entre para acessar o painel ou o seu portal." },
      { title: "Seu convite — Casa Exemplo", description: "Convite para acompanhar seus imóveis no portal do proprietário." },
      { title: "Minhas limpezas — Casa Exemplo", description: "Equipe de limpeza: as limpezas marcadas para você e a agenda da equipe." },
    ]);
    for (const meta of metas) expect(JSON.stringify(meta)).not.toMatch(/Sistema de gestão|Sua Casa Leblon/);
  });

  it("sem site configurado, o título fica só com o nome da tela (nada de nome suposto)", async () => {
    semSite();
    expect((await metadadosEntrar()).title).toBe("Entrar");
    expect((await metadadosConvite()).title).toBe("Seu convite");
    expect((await metadadosEquipe()).title).toBe("Minhas limpezas");
  });

  it("a entrada mostra o nome da empresa do site; sem site, a moldura não supõe um nome", async () => {
    const html = await entrar();
    expect(html).toContain("Casa Exemplo");
    expect(html).toContain("Área da equipe e dos proprietários");
    expect(html).toContain("Entre para acessar o painel ou o seu portal.");
    semSite();
    const semNome = await entrar();
    expect(semNome).not.toContain("Sua Casa Leblon");
    expect(semNome).toContain("Início");
  });

  it("convite cancelado ou vencido pede um novo à empresa do site; sem site, a quem mandou o convite", async () => {
    m.convite.mockResolvedValue({ ok: false, motivo: "revogado" });
    expect(await convite()).toContain("Este convite foi cancelado. Peça um novo à Casa Exemplo.");
    m.convite.mockResolvedValue({ ok: false, motivo: "vencido" });
    expect(await convite()).toContain("Este convite venceu (vale 7 dias). Peça um novo à Casa Exemplo.");
    m.convite.mockResolvedValue({ ok: false, motivo: "invalido" });
    expect(await convite()).toContain("Este link de convite não é válido.");
    semSite();
    m.convite.mockResolvedValue({ ok: false, motivo: "revogado" });
    const html = await convite();
    expect(html).toContain("Este convite foi cancelado. Peça um novo a quem mandou o convite.");
    expect(html).not.toContain("Sua Casa Leblon");
  });
});
