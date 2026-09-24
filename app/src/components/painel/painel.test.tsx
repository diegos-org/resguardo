// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SECOES, encontrarSecao, secoesPara } from "@/lib/navegacao";
import { FiltroGlobal } from "./FiltroGlobal";
import { Menu } from "./Menu";

vi.mock("next/navigation", () => ({
  usePathname: () => "/painel/reservas",
  useSearchParams: () => new URLSearchParams("imovel=403&mes=todos&ano=2025"),
}));

afterEach(cleanup);

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
