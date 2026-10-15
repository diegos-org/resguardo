// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ImovelAnuncios, NOTA_PRECO_SITE, QuadroAnuncios } from "./QuadroAnuncios";

// A ação de salvar a referência é do servidor; a tela só a repassa ao formulário.
vi.mock("@/anuncios/acoes", () => ({ salvarAnuncioAcao: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

afterEach(cleanup);

const imovel = (resto: Partial<ImovelAnuncios> = {}): ImovelAnuncios => ({
  id: "im-1",
  codigo: "403",
  nome: "Studio Fictício",
  descricao: "Descrição fictícia do studio.",
  frase: "",
  ativo: true,
  publico: true,
  precoBase: 25000,
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

  it("sem frase, diz que não foi cadastrada e o que o cartão do site usa no lugar", () => {
    render(<QuadroAnuncios imovel={imovel()} podeEditar={false} siteDaOrg />);
    expect(cartaoSite().getByText("Frase de abertura").nextElementSibling?.textContent).toBe("Não cadastrada (o cartão usa a primeira frase da descrição)");
  });

  it("a nota do preço base diz o fato atual: o site mostra o valor calculado pela fonte de preços (a frase vencida saiu)", () => {
    render(<QuadroAnuncios imovel={imovel()} podeEditar siteDaOrg />);
    const site = cartaoSite();
    expect(site.getByText(NOTA_PRECO_SITE)).toBeTruthy();
    expect(NOTA_PRECO_SITE).toContain("fonte de preços");
    expect(document.body.textContent).not.toContain("ainda não publica cotações");
  });
});
