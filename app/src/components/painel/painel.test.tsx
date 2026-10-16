// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SECOES, encontrarSecao, secoesPara } from "@/lib/navegacao";
import { FiltroGlobal } from "./FiltroGlobal";
import { Menu, ROTULO_SECAO_ATUAL } from "./Menu";

const nav = vi.hoisted(() => ({ caminho: "/painel/reservas" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.caminho,
  useSearchParams: () => new URLSearchParams("imovel=403&mes=todos&ano=2025"),
}));

afterEach(() => {
  cleanup();
  nav.caminho = "/painel/reservas";
});

/** O que a tela mostra num elemento: sem o texto só do leitor de tela. */
function naTela(el: Element): string {
  const copia = el.cloneNode(true) as Element;
  copia.querySelectorAll(".scl-so-leitor").forEach((x) => x.remove());
  return copia.textContent ?? "";
}
/** O que o leitor de tela lê: sem o que está escondido dele (aria-hidden). */
function noLeitor(el: Element): string {
  const copia = el.cloneNode(true) as Element;
  copia.querySelectorAll('[aria-hidden="true"]').forEach((x) => x.remove());
  return copia.textContent ?? "";
}

describe("Menu", () => {
  it("lista Início e todas as seções, marcando a atual", () => {
    render(<Menu papel="admin" />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(SECOES.length + 1);
    const atual = screen.getByRole("link", { current: "page" });
    expect(atual.textContent).toBe("Reservas");
    expect(atual.getAttribute("href")).toBe("/painel/reservas?imovel=403&ano=2025&mes=todos");
    expect(screen.getByRole("link", { name: "Financeiro" }).getAttribute("href")).toBe("/painel/financeiro?imovel=403&ano=2025&mes=todos");
  });
});

describe("Menu no celular (M0.10)", () => {
  it('botão "Menu" com o nome da seção atual, fechado por padrão; a lista inteira logo depois dele, no mesmo <nav>', () => {
    const { container } = render(<Menu papel="admin" />);
    const menu = screen.getByRole("navigation", { name: "Menu do painel" });
    const gaveta = menu.querySelector("details")!;
    const botao = gaveta.querySelector("summary")!;
    expect(gaveta.open).toBe(false);
    // Na tela "Menu · Reservas"; o leitor de tela ouve "Menu, você está em Reservas" (o "·" fica de fora).
    expect(naTela(botao)).toBe("Menu · Reservas");
    expect(noLeitor(botao)).toBe(`Menu${ROTULO_SECAO_ATUAL}Reservas`);
    expect(noLeitor(botao)).toBe("Menu, você está em Reservas");
    // O <summary> só tem o botão; a lista vem logo depois do <details>, como o CSS espera (`.gaveta:not([open]) + .menu`).
    expect(gaveta.children).toHaveLength(1);
    const lista = gaveta.nextElementSibling!;
    expect(lista.tagName).toBe("UL");
    expect(botao.getAttribute("aria-controls")).toBe(lista.id);
    expect(lista.id).not.toBe("");
    // Todas as seções do papel na lista, a atual marcada, e nada fora dela.
    const nomes = within(lista as HTMLElement).getAllByRole("link").map((l) => l.textContent);
    expect(nomes).toEqual(["Início", ...secoesPara("admin").map((s) => s.titulo)]);
    expect(nomes).toContain("Configurações");
    expect(within(lista as HTMLElement).getByRole("link", { current: "page" }).textContent).toBe("Reservas");
    expect(container.querySelectorAll("a")).toHaveLength(nomes.length);
  });

  it("subpágina marca a seção de cima também no botão; fora das seções, só \"Menu\"", () => {
    nav.caminho = "/painel/configuracoes/regras";
    const { unmount } = render(<Menu papel="admin" />);
    expect(naTela(document.querySelector("summary")!)).toBe("Menu · Configurações");
    expect(screen.getByRole("link", { current: "page" }).textContent).toBe("Configurações");
    unmount();
    nav.caminho = "/painel";
    render(<Menu papel="operacao" />);
    expect(naTela(document.querySelector("summary")!)).toBe("Menu · Início");
    cleanup();
    nav.caminho = "/painel/nao-existe";
    render(<Menu papel="operacao" />);
    expect(naTela(document.querySelector("summary")!)).toBe("Menu");
    expect(noLeitor(document.querySelector("summary")!)).toBe("Menu");
    expect(screen.queryByRole("link", { current: "page" })).toBeNull();
  });

  it("fecha sozinho ao trocar de página e ao tocar numa seção (também a da própria página)", () => {
    const { rerender } = render(<Menu papel="admin" />);
    let gaveta = document.querySelector("details")!;
    gaveta.open = true;
    nav.caminho = "/painel/financeiro";
    rerender(<Menu papel="admin" />);
    gaveta = document.querySelector("details")!;
    expect(gaveta.open).toBe(false);
    expect(naTela(document.querySelector("summary")!)).toBe("Menu · Financeiro");
    // Tocar na seção atual não muda o caminho: o toque fecha.
    gaveta.open = true;
    const atual = screen.getByRole("link", { current: "page" });
    atual.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(atual);
    expect(gaveta.open).toBe(false);
  });
});

describe("Menu por papel", () => {
  it("equipe de operação não vê financeiro, proprietários, sistema nem configurações", () => {
    render(<Menu papel="operacao" />);
    const nomes = screen.getAllByRole("link").map((l) => l.textContent);
    for (const escondido of ["Financeiro", "Apartamentos", "Despesas", "Proprietários", "Sistema", "Configurações"]) expect(nomes).not.toContain(escondido);
    for (const visivel of ["Início", "Calendário", "Reservas", "Limpezas"]) expect(nomes).toContain(visivel);
  });

  it("admin vê tudo; hóspede não vê nada", () => {
    expect(secoesPara("admin")).toHaveLength(SECOES.length);
    expect(secoesPara("hospede")).toHaveLength(0);
    // Aba só da equipe interna: não aparece para proprietário.
    expect(secoesPara("proprietario").map((x) => x.slug)).not.toContain("apartamentos");
  });
});

describe("FiltroGlobal", () => {
  it("marca todos os imóveis quando nenhum foi escolhido", () => {
    render(<FiltroGlobal filtros={{ imoveis: [], ano: 2026, mes: 9 }} acao="/painel" />);
    const caixas = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(caixas.length).toBe(6);
    expect(caixas.every((c) => c.checked)).toBe(true);
  });

  it("reflete a seleção e envia por GET para a própria página", () => {
    render(<FiltroGlobal filtros={{ imoveis: ["403"], ano: 2026, mes: null }} acao="/painel/financeiro" />);
    const marcadas = (screen.getAllByRole("checkbox") as HTMLInputElement[]).filter((c) => c.checked).map((c) => c.value);
    expect(marcadas).toEqual(["403"]);
    const form = screen.getByRole("form", { name: "Filtro global" }) as HTMLFormElement;
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/painel/financeiro");
    expect((screen.getByLabelText("Mês") as HTMLSelectElement).value).toBe("todos");
  });
});

describe("navegação", () => {
  it("slugs são únicos e encontráveis", () => {
    const slugs = SECOES.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(encontrarSecao("financeiro")?.titulo).toBe("Financeiro");
    expect(encontrarSecao("nao-existe")).toBeUndefined();
  });
});
