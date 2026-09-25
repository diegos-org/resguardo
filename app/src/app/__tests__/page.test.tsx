// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CartaoImovel } from "@/components/site/CartaoImovel";
import { FormConsulta } from "@/components/site/FormConsulta";
import { Moldura, SiteEmConfiguracao } from "@/components/site/Moldura";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import type { ImovelPublico } from "@/site/site";

const imovel: ImovelPublico = {
  codigo: "403",
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
};

afterEach(cleanup);

describe("site público (M7.1)", () => {
  it("moldura com o nome da empresa, menu e o rodapé do painel", () => {
    render(
      <Moldura conteudo={{ organizacaoId: "x", nomeEmpresa: "Sua Casa Leblon", textos: { ...TEXTOS_SITE_INICIAIS, rodape: "Rodapé fictício" }, whatsapp: null, email: "" }}>
        <h1>Oi</h1>
      </Moldura>,
    );
    expect(screen.getByRole("link", { name: "Sua Casa Leblon" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "Apartamentos" }).getAttribute("href")).toBe("/imoveis");
    expect(screen.getByText("Rodapé fictício")).toBeTruthy();
  });

  it("sem organização definida, avisa que está em configuração", () => {
    render(<SiteEmConfiguracao />);
    expect(screen.getByRole("note").textContent).toContain("Site em configuração");
  });

  it("cartão leva à página do imóvel pelo código, com o resumo", () => {
    render(<CartaoImovel imovel={imovel} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/imoveis/403");
    expect(link.textContent).toContain("até 4 pessoas · studio · 1 banheiro");
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
  });

  it("sem capacidade informada em algum apartamento, o formulário não limita o número de pessoas", () => {
    render(<FormConsulta imoveis={[imovel, { ...imovel, codigo: "102", capacidade: null }]} valores={{}} hoje="2026-09-25" canal="whatsapp" />);
    expect(document.querySelector('[name="hospedes"]')!.hasAttribute("max")).toBe(false);
  });
});
