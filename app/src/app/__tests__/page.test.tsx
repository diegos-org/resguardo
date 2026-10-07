// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CartaoImovel, fraseDoImovel } from "@/components/site/CartaoImovel";
import { FormConsulta } from "@/components/site/FormConsulta";
import { GaleriaImovel } from "@/components/site/GaleriaImovel";
import { Moldura, SiteEmConfiguracao } from "@/components/site/Moldura";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import type { ImovelPublico } from "@/site/site";

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

afterEach(cleanup);

describe("site público (M7.1)", () => {
  it("moldura com o nome da empresa (última palavra em destaque), menu, rodapé e o botão do WhatsApp só com telefone no cadastro", () => {
    render(
      <Moldura conteudo={{ organizacaoId: "x", nomeEmpresa: "Sua Casa Leblon", textos: { ...TEXTOS_SITE_INICIAIS, rodape: "Rodapé fictício" }, whatsapp: null, email: "" }}>
        <h1>Oi</h1>
      </Moldura>,
    );
    const marca = screen.getByRole("link", { name: "Sua Casa Leblon" });
    expect(marca.getAttribute("href")).toBe("/");
    expect(marca.querySelector("em")?.textContent).toBe("Leblon");
    const menu = within(screen.getByRole("navigation", { name: "Principal" }));
    expect(menu.getByRole("link", { name: "Nossas casas" }).getAttribute("href")).toBe("/imoveis");
    expect(menu.getByRole("link", { name: /Planeje sua estadia/ }).getAttribute("href")).toBe("/consulta");
    expect(screen.getByText("Rodapé fictício")).toBeTruthy();
    expect(screen.getByRole("contentinfo").textContent).toContain(`© ${new Date().getFullYear()} Sua Casa Leblon`);
    expect(screen.queryByRole("link", { name: /WhatsApp/ })).toBeNull();
    cleanup();
    render(
      <Moldura conteudo={{ organizacaoId: "x", nomeEmpresa: "Casa", textos: TEXTOS_SITE_INICIAIS, whatsapp: "5521900000000", email: "" }}>
        <h1>Oi</h1>
      </Moldura>,
    );
    // Nome com uma palavra só: nada em itálico.
    expect(screen.getByRole("link", { name: "Casa" }).querySelector("em")).toBeNull();
    expect(screen.getByRole("link", { name: "Falar com Casa pelo WhatsApp" }).getAttribute("href")).toMatch(/^https:\/\/wa\.me\/5521900000000\?text=/);
  });

  it("sem organização definida, avisa que está em configuração", () => {
    render(<SiteEmConfiguracao />);
    expect(screen.getByRole("note").textContent).toContain("Site em configuração");
  });

  it("cartão com foto real (M7.3): a capa na versão pequena, com a legenda como texto alternativo; sem foto, \"foto em breve\"", () => {
    render(<CartaoImovel imovel={{ ...imovel, fotos: [{ grande: "/fotos/f1", pequena: "/fotos/f1/pequena", legenda: "Sala com vista" }] }} />);
    expect(screen.getByRole("img", { name: "Sala com vista" }).getAttribute("src")).toBe("/fotos/f1/pequena");
    expect(screen.queryByText("Foto em breve")).toBeNull();
    cleanup();
    render(<CartaoImovel imovel={{ ...imovel, fotos: [{ grande: "/fotos/f1", pequena: "/fotos/f1", legenda: "" }] }} />);
    expect(screen.getByRole("img", { name: "Foto de Studio Exemplo" })).toBeTruthy();
    cleanup();
    render(<CartaoImovel imovel={imovel} />);
    expect(screen.getByText("Foto em breve")).toBeTruthy();
  });

  it("galeria da página do imóvel: a foto escolhida em destaque, com contador e legenda; uma foto só, sem miniaturas", () => {
    const fotos = [
      { grande: "/fotos/f1", pequena: "/fotos/f1/pequena", legenda: "Sala" },
      { grande: "/fotos/f2", pequena: "/fotos/f2/pequena", legenda: "" },
      { grande: "/fotos/f3", pequena: "/fotos/f3/pequena", legenda: "Varanda" },
    ];
    render(<GaleriaImovel nome="Studio Exemplo" fotos={fotos} />);
    const galeria = within(screen.getByRole("region", { name: "Fotos de Studio Exemplo" }));
    expect(galeria.getByRole("img", { name: "Sala" }).getAttribute("src")).toBe("/fotos/f1");
    expect(galeria.getByText("1 / 3")).toBeTruthy();
    fireEvent.click(galeria.getByRole("button", { name: "Ver a foto 3: Varanda" }));
    expect(galeria.getByRole("img", { name: "Varanda" }).getAttribute("src")).toBe("/fotos/f3");
    expect(galeria.getByText("3 / 3")).toBeTruthy();
    expect(galeria.getByRole("button", { name: "Ver a foto 3: Varanda" }).getAttribute("aria-current")).toBe("true");
    fireEvent.click(galeria.getByRole("button", { name: "Ver a foto 2" }));
    expect(galeria.getByRole("img", { name: "Foto 2 de Studio Exemplo" }).getAttribute("src")).toBe("/fotos/f2");
    cleanup();
    render(<GaleriaImovel nome="Studio Exemplo" fotos={fotos.slice(0, 1)} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByText("1 / 1")).toBeNull();
  });

  it("cartão leva à página do imóvel pelo código, com o resumo", () => {
    render(<CartaoImovel imovel={imovel} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/imoveis/403");
    expect(link.textContent).toContain("até 4 pessoas · studio · 1 banheiro");
    // "Olho" do cartão: bairro e código.
    expect(link.textContent).toContain("Leblon · 403");
    // Frase do cartão: primeira frase da descrição, limitada; sem descrição, bairro e cidade.
    expect(fraseDoImovel(imovel)).toBe("Leblon, Rio de Janeiro");
    expect(fraseDoImovel({ ...imovel, descricao: "Dias leves entre a praia e os restaurantes. Vista para o mar." })).toBe("Dias leves entre a praia e os restaurantes.");
    expect(fraseDoImovel({ ...imovel, descricao: "x".repeat(200) })).toHaveLength(120);
  });

  it("variante de busca da capa: mesmos campos e destino, sem título e com o botão \"Consultar\"", () => {
    render(<FormConsulta imoveis={[imovel]} valores={{}} hoje="2026-09-25" canal="whatsapp" variante="busca" />);
    const form = document.querySelector("form")!;
    expect(form.getAttribute("action")).toBe("/consulta");
    expect([...form.querySelectorAll("[name]")].map((e) => e.getAttribute("name"))).toEqual(["imovel", "entrada", "saida", "hospedes"]);
    expect(screen.getByRole("button").textContent).toContain("Consultar");
    expect(form.querySelector("strong")).toBeNull();
  });

  it("formulário de consulta vai para /consulta por GET, com o imóvel escolhido e os erros", () => {
    render(<FormConsulta imoveis={[imovel]} valores={{ imovel: "403" }} erros={{ saida: "A saída precisa ser depois da entrada." }} hoje="2026-09-25" canal="email" />);
    const form = document.querySelector("form")!;
    expect(form.getAttribute("action")).toBe("/consulta");
    expect(form.getAttribute("method")).toBe("get");
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("403");
    expect(screen.getByText("A saída precisa ser depois da entrada.")).toBeTruthy();
    // Nada pessoal no endereço: só apartamento, datas e pessoas; limite de pessoas pela maior capacidade.
    expect([...form.querySelectorAll("[name]")].map((e) => e.getAttribute("name"))).toEqual(["imovel", "entrada", "saida", "hospedes"]);
    expect(form.querySelector('[name="hospedes"]')!.getAttribute("max")).toBe("4");
    // O texto fala do canal que existe no cadastro (aqui, só e-mail): nada de prometer WhatsApp.
    expect(form.textContent).toContain("por e-mail");
    expect(form.textContent).not.toContain("WhatsApp");
    // Sem marca fixa no texto (o site pode ser de outra empresa do cadastro).
    expect(form.textContent).not.toContain("Sua Casa Leblon");
  });

  it("sem capacidade informada em algum apartamento, o formulário não limita o número de pessoas", () => {
    render(<FormConsulta imoveis={[imovel, { ...imovel, codigo: "102", capacidade: null }]} valores={{}} hoje="2026-09-25" canal="whatsapp" />);
    expect(document.querySelector('[name="hospedes"]')!.hasAttribute("max")).toBe(false);
  });
});
