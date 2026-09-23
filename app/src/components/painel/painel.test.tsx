// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SECOES, encontrarSecao } from "@/lib/navegacao";
import { FiltroGlobal } from "./FiltroGlobal";
import { Menu } from "./Menu";

vi.mock("next/navigation", () => ({ usePathname: () => "/painel/reservas" }));

afterEach(cleanup);

describe("Menu", () => {
  it("lista Início e todas as seções, marcando a atual", () => {
    render(<Menu />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(SECOES.length + 1);
    const atual = screen.getByRole("link", { current: "page" });
    expect(atual.textContent).toBe("Reservas");
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
