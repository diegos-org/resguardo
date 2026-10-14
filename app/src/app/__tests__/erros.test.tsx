// @vitest-environment jsdom
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { molduraDoErro } from "@/components/portal/ErroNoPortal";
import ErroNaPagina from "../error";
import ErroNoPainel from "../painel/error";
import NaoEncontradaNoPainel from "../painel/not-found";
import PainelNaoEncontrado from "../painel/[secao]/[...resto]/page";
import ErroNoPortalDoProprietario from "../portal/error";
import NaoEncontradaNoPortal from "../portal/not-found";
import PortalNaoEncontrado from "../portal/[...resto]/page";

/**
 * M7.8: páginas de erro e de "não encontrada" fora do site — o painel e o portal com as suas, no visual deles —, e a
 * página de erro da raiz, que só usa a moldura do site nas páginas do site.
 */
const m = vi.hoisted(() => ({ caminho: "/", sessao: vi.fn(), site: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => m.caminho,
  notFound: () => {
    throw new Error("NAO_ENCONTRADA");
  },
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...resto }: { children: React.ReactNode; href: string; className?: string; "aria-label"?: string }) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
}));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/site/pagina", () => ({ carregarSite: m.site }));

beforeEach(() => {
  vi.clearAllMocks();
  m.caminho = "/";
});
afterEach(cleanup);

const erro = (digest?: string) => Object.assign(new Error("detalhe interno que não aparece"), digest ? { digest } : {});

describe("erro inesperado na raiz (M7.8)", () => {
  it("nas páginas do site: moldura do site, texto curto em português, \"Tentar de novo\" chama o retry e nada do erro aparece", () => {
    m.caminho = "/imoveis/403";
    const retry = vi.fn();
    render(<ErroNaPagina error={erro("abc123")} retry={retry} />);
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Algo não saiu como esperado");
    expect(screen.getByText("Não conseguimos abrir esta página agora. Tente de novo em instantes.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Voltar ao início" }).getAttribute("href")).toBe("/");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("detalhe interno");
    expect(document.body.textContent).not.toContain("abc123");
    // Sem o nome da empresa (viria do banco), nenhum nome de reserva: a marca com o link "Início" e o rodapé sem o ©.
    expect(screen.getByRole("link", { name: "Início" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("contentinfo").textContent).not.toContain("©");
    expect(screen.getByRole("contentinfo").textContent).not.toContain("Início");
  });

  it("nas áreas internas sem página de erro própria: a moldura dos portais, sem o menu do site, e o código do erro", () => {
    m.caminho = "/equipe";
    const retry = vi.fn();
    render(<ErroNaPagina error={erro("abc123")} retry={retry} />);
    expect(screen.queryByRole("navigation", { name: "Principal" })).toBeNull();
    expect(screen.getByText("Equipe de limpeza")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Voltar à agenda" }).getAttribute("href")).toBe("/equipe");
    expect(document.body.textContent).toContain("abc123");
    expect(document.body.textContent).not.toContain("detalhe interno");
    // Sem o nome da empresa: o topo mostra só a marca do estudo (sem a palavra "Início" escrita no lugar do nome), com o
    // link "Início" para leitor de tela, e o rodapé não tem "© 2026 Início".
    const marca = screen.getByRole("link", { name: "Início" });
    expect(marca.getAttribute("href")).toBe("/");
    expect(marca.textContent).toBe("");
    expect(marca.querySelector("img")?.getAttribute("src")).toContain("marca.png");
    expect(marca.closest("header")?.textContent).not.toContain("Início");
    expect(screen.getByRole("contentinfo").textContent).not.toContain("©");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("qual moldura cada endereço usa: só o começo do caminho decide", () => {
    for (const c of ["/", "/imoveis", "/imoveis/403", "/consulta?imovel=403", "/hospede", "/reservar/COT-ABCD", "/anunciar", "/painelx"]) expect(molduraDoErro(c), c).toBeNull();
    expect(molduraDoErro("/painel/reservas/1")).toEqual({ titulo: "Painel interno", volta: { href: "/painel", rotulo: "Ir para o início do painel" } });
    expect(molduraDoErro("/portal?mes=2026-10")).toEqual({ titulo: "Portal do proprietário", volta: { href: "/portal", rotulo: "Voltar ao portal" } });
    expect(molduraDoErro("/equipe")?.volta.href).toBe("/equipe");
    expect(molduraDoErro("/entrar")).toEqual({ volta: { href: "/", rotulo: "Ir para o site" } });
    expect(molduraDoErro("/convite/xyz")).toEqual({ volta: { href: "/", rotulo: "Ir para o site" } });
  });
});

describe("painel (M7.8): erro e não encontrada dentro da moldura do painel", () => {
  it("a página não encontrada fica na pasta do painel (o Next a mostra dentro da moldura dele) e não tem nada do site", () => {
    const app = join(dirname(fileURLToPath(import.meta.url)), "..");
    expect(existsSync(join(app, "painel", "not-found.tsx"))).toBe(true);
    expect(existsSync(join(app, "painel", "error.tsx"))).toBe(true);
    render(<NaoEncontradaNoPainel />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Página não encontrada");
    expect(screen.getByText(/não está disponível para o seu acesso/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Voltar ao início do painel" }).getAttribute("href")).toBe("/painel");
    expect(screen.queryByRole("navigation", { name: "Principal" })).toBeNull();
    expect(screen.queryByText("Conhecer as casas")).toBeNull();
  });

  it("erro numa tela do painel: texto curto, código do erro, \"Tentar de novo\" e a volta ao início do painel", () => {
    const retry = vi.fn();
    render(<ErroNoPainel error={erro("d1g3st")} retry={retry} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Algo não saiu como esperado");
    expect(document.body.textContent).toContain("d1g3st");
    expect(document.body.textContent).not.toContain("detalhe interno");
    expect(screen.getByRole("link", { name: "Voltar ao início do painel" }).getAttribute("href")).toBe("/painel");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(retry).toHaveBeenCalledTimes(1);
    cleanup();
    // Sem código (erro do próprio navegador), a linha do código não aparece.
    render(<ErroNoPainel error={erro()} retry={retry} />);
    expect(document.body.textContent).not.toContain("este código");
  });

  it("endereço que não existe dentro do painel: só para quem entrou, e então a não encontrada do painel", async () => {
    m.sessao.mockResolvedValue({ usuarioId: "u", organizacaoId: "org", papel: "admin" });
    await expect(PainelNaoEncontrado()).rejects.toThrow("NAO_ENCONTRADA");
    expect(m.sessao).toHaveBeenCalledTimes(1);
    // Sem sessão, a entrada (o redirecionamento) vem antes do 404.
    m.sessao.mockRejectedValue(new Error("REDIRECIONA_PARA_ENTRAR"));
    await expect(PainelNaoEncontrado()).rejects.toThrow("REDIRECIONA_PARA_ENTRAR");
  });
});

describe("portal do proprietário (M7.8): erro e não encontrada na moldura do portal", () => {
  it("não encontrada: moldura do portal com o nome da empresa e a volta ao portal, sem o menu do site", async () => {
    m.site.mockResolvedValue({ db: {}, conteudo: { nomeEmpresa: "Sua Casa Exemplo" } });
    render(await NaoEncontradaNoPortal());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Página não encontrada");
    expect(screen.getByRole("link", { name: "Sua Casa Exemplo" }).getAttribute("href")).toBe("/");
    expect(screen.getByText("Portal do proprietário")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Voltar ao portal" }).getAttribute("href")).toBe("/portal");
    expect(screen.queryByRole("navigation", { name: "Principal" })).toBeNull();
    // Com o nome conhecido, o © é o da empresa.
    expect(screen.getByRole("contentinfo").textContent).toContain(`© ${new Date().getFullYear()} Sua Casa Exemplo`);
  });

  it("qualquer outro endereço dentro do portal cai na não encontrada do portal", () => {
    expect(() => PortalNaoEncontrado()).toThrow("NAO_ENCONTRADA");
  });

  it("erro no portal: moldura do portal, \"Tentar de novo\" e a volta ao portal", () => {
    const retry = vi.fn();
    render(<ErroNoPortalDoProprietario error={erro("p0rt4l")} retry={retry} />);
    expect(screen.getByText("Portal do proprietário")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Algo não saiu como esperado");
    expect(screen.getByRole("link", { name: "Voltar ao portal" }).getAttribute("href")).toBe("/portal");
    expect(document.body.textContent).toContain("p0rt4l");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
