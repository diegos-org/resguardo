// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ImovelAnuncios, NOTAS_PRECO_SITE, QuadroAnuncios } from "./QuadroAnuncios";

// A ação de salvar a referência é do servidor; a tela só a repassa ao formulário.
vi.mock("@/anuncios/acoes", () => ({ salvarAnuncioAcao: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

afterEach(cleanup);

const imovel = (resto: Partial<ImovelAnuncios> = {}): ImovelAnuncios => ({
  id: "im-1",
  codigo: "403",
  nome: "Studio Fictício",
  bairro: "Leblon",
  cidade: "Rio de Janeiro",
  descricao: "Descrição fictícia do studio.",
  frase: "",
  ativo: true,
  publico: true,
  precoBase: 25000,
  fontePrecos: "scl",
  anuncios: [],
  vinculos: [],
  ...resto,
});
const cartaoSite = () => within(document.querySelector('article[aria-label="Site"]') as HTMLElement);

describe("aba Anúncios, cartão Site (M7.17)", () => {
  it("mostra a frase de abertura entre os dados atuais do site, junto do título e da descrição", () => {
    render(<QuadroAnuncios imovel={imovel({ frase: "Frase fictícia de abertura." })} podeEditar siteDaOrg />);
    const site = cartaoSite();
    expect(site.getByText("Frase de abertura").nextElementSibling?.textContent).toBe("Frase fictícia de abertura.");
    expect(site.getByText("Descrição").nextElementSibling?.textContent).toBe("Descrição fictícia do studio.");
  });

  it("sem frase, diz que não foi cadastrada e mostra o que o cartão e a prévia do link usam no lugar, pela própria regra", () => {
    render(<QuadroAnuncios imovel={imovel({ descricao: "Primeira frase fictícia. Segunda frase." })} podeEditar={false} siteDaOrg />);
    expect(cartaoSite().getByText("Frase de abertura").nextElementSibling?.textContent).toBe("Não cadastrada. O cartão da casa e a prévia do link usam: “Primeira frase fictícia.”");
    cleanup();
    // Sem frase e sem descrição (o padrão do cadastro), o cartão usa bairro e cidade — nada de "primeira frase da descrição".
    render(<QuadroAnuncios imovel={imovel({ descricao: "" })} podeEditar={false} siteDaOrg />);
    const site = cartaoSite();
    expect(site.getByText("Frase de abertura").nextElementSibling?.textContent).toBe("Não cadastrada. O cartão da casa e a prévia do link usam: “Leblon, Rio de Janeiro”");
    expect(site.getByText("Descrição").nextElementSibling?.textContent).toBe("Não cadastrada");
    expect(document.body.textContent).not.toContain("primeira frase da descrição");
    cleanup();
    // Sem nada que o cartão use: diz que o cartão fica sem frase e a prévia usa a descrição do site.
    render(<QuadroAnuncios imovel={imovel({ descricao: "", bairro: "", cidade: "" })} podeEditar={false} siteDaOrg />);
    expect(cartaoSite().getByText("Frase de abertura").nextElementSibling?.textContent).toBe("Não cadastrada. O cartão da casa fica sem frase, e a prévia do link usa a descrição do site.");
  });

  it("a nota do preço base depende da fonte de preços: base da noite no site com SCL ou manual, só referência com Beds24", () => {
    for (const fontePrecos of ["scl", "manual"] as const) {
      render(<QuadroAnuncios imovel={imovel({ fontePrecos })} podeEditar siteDaOrg />);
      const site = cartaoSite();
      expect(site.getByText(NOTAS_PRECO_SITE[fontePrecos])).toBeTruthy();
      expect(NOTAS_PRECO_SITE[fontePrecos]).toMatch(/^É a base do valor da noite no site/);
      expect(document.body.textContent, fontePrecos).not.toContain("referência interna");
      cleanup();
    }
    render(<QuadroAnuncios imovel={imovel({ fontePrecos: "beds24" })} podeEditar siteDaOrg />);
    expect(cartaoSite().getByText(NOTAS_PRECO_SITE.beds24)).toBeTruthy();
    expect(NOTAS_PRECO_SITE.beds24).toContain("este preço não entra no site");
    // A frase vencida do M7.2 não volta em nenhuma fonte.
    for (const nota of Object.values(NOTAS_PRECO_SITE)) expect(nota).not.toContain("ainda não publica cotações");
    expect(document.body.textContent).not.toContain("ainda não publica cotações");
  });
});
