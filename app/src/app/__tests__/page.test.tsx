// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CartaoImovel, seloDoImovel } from "@/components/site/CartaoImovel";
import { FormConsulta } from "@/components/site/FormConsulta";
import { GaleriaImovel } from "@/components/site/GaleriaImovel";
import { Moldura, SiteEmConfiguracao } from "@/components/site/Moldura";
import { PASSO_VITRINE_MS, VitrineCasas } from "@/components/site/VitrineCasas";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import { fraseDoImovel } from "@/site/frase-do-imovel";
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
  frase: "",
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
      <Moldura conteudo={{ organizacaoId: "x", nomeEmpresa: "Sua Casa Leblon", textos: { ...TEXTOS_SITE_INICIAIS, rodape: "Rodapé fictício" }, whatsapp: null, email: "", imagens: { capa: null, marca: "/marca.png" } }}>
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
      <Moldura conteudo={{ organizacaoId: "x", nomeEmpresa: "Casa", textos: TEXTOS_SITE_INICIAIS, whatsapp: "5521900000000", email: "", imagens: { capa: null, marca: "/marca.png" } }}>
        <h1>Oi</h1>
      </Moldura>,
    );
    // Nome com uma palavra só: nada em itálico.
    expect(screen.getByRole("link", { name: "Casa" }).querySelector("em")).toBeNull();
    // Abre outra janela (M7.11): o aviso vai no rótulo do botão, para quem usa leitor de tela.
    const whatsapp = screen.getByRole("link", { name: "Falar com Casa pelo WhatsApp (abre em nova janela)" });
    expect(whatsapp.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/5521900000000\?text=/);
    expect(whatsapp.getAttribute("target")).toBe("_blank");
  });

  it("rodapé (M7.4): as três páginas legais em todas as páginas e, com razão social ou CNPJ no cadastro, a identificação da empresa", () => {
    const conteudo = { organizacaoId: "x", nomeEmpresa: "Casa Exemplo", textos: TEXTOS_SITE_INICIAIS, whatsapp: null, email: "", imagens: { capa: null, marca: "/marca.png" } };
    render(
      <Moldura conteudo={conteudo}>
        <h1>Oi</h1>
      </Moldura>,
    );
    const rodape = within(screen.getByRole("contentinfo"));
    expect(rodape.getByRole("link", { name: "Termos de uso" }).getAttribute("href")).toBe("/termos");
    expect(rodape.getByRole("link", { name: "Privacidade" }).getAttribute("href")).toBe("/privacidade");
    expect(rodape.getByRole("link", { name: "Cancelamento" }).getAttribute("href")).toBe("/cancelamento");
    expect(screen.getByRole("contentinfo").textContent).not.toContain("CNPJ");
    cleanup();
    // Só o endereço, sem razão social nem CNPJ: a linha não aparece.
    render(
      <Moldura conteudo={{ ...conteudo, identidade: { razaoSocial: "", cnpj: "", endereco: "Rua Fictícia, 100" } }}>
        <h1>Oi</h1>
      </Moldura>,
    );
    expect(screen.getByRole("contentinfo").textContent).not.toContain("Rua Fictícia");
    cleanup();
    render(
      <Moldura conteudo={{ ...conteudo, identidade: { razaoSocial: "Casa Exemplo Temporada Ltda.", cnpj: "00.000.000/0001-00", endereco: "Rua Fictícia, 100" } }}>
        <h1>Oi</h1>
      </Moldura>,
    );
    expect(screen.getByText("Casa Exemplo Temporada Ltda. · CNPJ 00.000.000/0001-00 · Rua Fictícia, 100")).toBeTruthy();
    cleanup();
    // Sem organização (site em configuração), os links continuam.
    render(<SiteEmConfiguracao />);
    expect(within(screen.getByRole("contentinfo")).getByRole("link", { name: "Termos de uso" })).toBeTruthy();
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
    expect(link.textContent).toContain("Até 4 hóspedes");
    // "Olho" do cartão: bairro e código.
    expect(link.textContent).toContain("Leblon · 403");
    // Frase do cartão: primeira frase da descrição, limitada; sem descrição, bairro e cidade.
    expect(fraseDoImovel(imovel)).toBe("Leblon, Rio de Janeiro");
    expect(fraseDoImovel({ ...imovel, descricao: "Dias leves entre a praia e os restaurantes. Vista para o mar." })).toBe("Dias leves entre a praia e os restaurantes.");
    expect(fraseDoImovel({ ...imovel, descricao: "x".repeat(200) })).toHaveLength(120);
    cleanup();
    // Sem capacidade cadastrada, o resumo do cadastro (nada inventado).
    render(<CartaoImovel imovel={{ ...imovel, capacidade: null }} />);
    expect(screen.getByRole("link").textContent).toContain("studio · 1 banheiro");
  });

  it("cartão (M7.17): a frase de abertura da casa quando houver, inteira, no lugar da primeira frase da descrição", () => {
    const comDescricao = { ...imovel, descricao: "Primeira frase fictícia da descrição. Segunda frase." };
    // Sem frase de abertura (só espaços conta como vazia), vale a descrição, como antes.
    for (const frase of ["", "   "]) expect(fraseDoImovel({ ...comDescricao, frase })).toBe("Primeira frase fictícia da descrição.");
    // Com frase, ela vence a descrição e o bairro, inteira: nem cortada na primeira frase nem no tamanho (o cadastro já
    // limita a 120 caracteres).
    expect(fraseDoImovel({ ...comDescricao, frase: "Dias leves fictícios. Noites tranquilas." })).toBe("Dias leves fictícios. Noites tranquilas.");
    const longa = `Frase fictícia de abertura, ${"bem ".repeat(21)}longa.`;
    expect(longa).toHaveLength(118);
    expect(fraseDoImovel({ ...comDescricao, frase: longa })).toBe(longa);
    expect(fraseDoImovel({ ...imovel, frase: "Só a frase fictícia." })).toBe("Só a frase fictícia.");
    render(<CartaoImovel imovel={{ ...comDescricao, frase: "Só a frase fictícia." }} />);
    const cartao = screen.getByRole("link");
    expect(cartao.textContent).toContain("Só a frase fictícia.");
    expect(cartao.textContent).not.toContain("Primeira frase fictícia da descrição.");
  });

  it("cartão da vitrine (M7.6): selo com tipo e bairro sobre a foto e até quatro ícones de comodidades, na ordem do que mais pesa", () => {
    const comFoto = { ...imovel, fotos: [{ grande: "/fotos/f1", pequena: "/fotos/f1/pequena", legenda: "" }] };
    render(<CartaoImovel imovel={{ ...comFoto, comodidades: ["Elevador", "Wi-Fi", "Comodidade inventada", "Smart TV", "Ar-condicionado", "Cozinha equipada"] }} />);
    expect(screen.getByText("Studio · Leblon")).toBeTruthy();
    const icones = screen.getAllByRole("img").filter((i) => i.tagName.toLowerCase() === "svg").map((i) => i.getAttribute("aria-label"));
    expect(icones).toEqual(["Ar-condicionado", "Cozinha equipada", "Wi-Fi", "Smart TV"]);
    cleanup();
    expect(seloDoImovel({ quartos: 2, bairro: "", cidade: "Búzios" })).toBe("2 quartos · Búzios");
    expect(seloDoImovel({ quartos: null, bairro: "Leblon", cidade: "Rio de Janeiro" })).toBe("Leblon");
    // Sem foto, sem selo: o quadro "foto em breve" já diz o que falta.
    render(<CartaoImovel imovel={imovel} />);
    expect(screen.queryByText("Studio · Leblon")).toBeNull();
  });

  it("vitrine (M7.6): setas, botão de pausa e movimento automático que para ao pausar; um cartão só, sem setas", () => {
    vi.useFakeTimers();
    try {
      const scrollTo = vi.fn();
      Object.defineProperty(HTMLElement.prototype, "scrollTo", { value: scrollTo, configurable: true });
      render(
        <VitrineCasas rotulo="Seu endereço no Leblon" rodape={<span>Explore nossas casas</span>}>
          <article>Casa 1</article>
          <article>Casa 2</article>
        </VitrineCasas>,
      );
      expect(screen.getByRole("region", { name: "Seu endereço no Leblon" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Próxima casa" }));
      expect(scrollTo).toHaveBeenCalledTimes(1);
      act(() => vi.advanceTimersByTime(PASSO_VITRINE_MS));
      expect(scrollTo).toHaveBeenCalledTimes(2);
      const pausa = screen.getByRole("button", { name: "Pausar movimento" });
      fireEvent.click(pausa);
      expect(pausa.getAttribute("aria-pressed")).toBe("true");
      expect(pausa.textContent).toBe("Retomar movimento");
      act(() => vi.advanceTimersByTime(PASSO_VITRINE_MS * 3));
      expect(scrollTo).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Explore nossas casas")).toBeTruthy();
      cleanup();
      render(
        <VitrineCasas rotulo="Casas">
          <article>Casa 1</article>
        </VitrineCasas>,
      );
      expect(screen.queryByRole("button")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("vitrine (M7.6): mouse ou foco nos cartões e nas setas param o movimento; passar de um cartão para uma seta não solta", () => {
    vi.useFakeTimers();
    try {
      const scrollTo = vi.fn();
      Object.defineProperty(HTMLElement.prototype, "scrollTo", { value: scrollTo, configurable: true });
      render(
        <VitrineCasas rotulo="Seu endereço no Leblon">
          <article><button type="button">Casa 1</button></article>
          <article><button type="button">Casa 2</button></article>
        </VitrineCasas>,
      );
      const casa = screen.getByRole("button", { name: "Casa 1" });
      const seta = screen.getByRole("button", { name: "Próxima casa" });
      // Teclado: do cartão para a seta, o movimento continua parado.
      fireEvent.focus(casa);
      fireEvent.blur(casa, { relatedTarget: seta });
      fireEvent.focus(seta);
      act(() => vi.advanceTimersByTime(PASSO_VITRINE_MS * 2));
      expect(scrollTo).not.toHaveBeenCalled();
      // Foco sai da vitrine: volta a andar.
      fireEvent.blur(seta, { relatedTarget: null });
      act(() => vi.advanceTimersByTime(PASSO_VITRINE_MS));
      expect(scrollTo).toHaveBeenCalledTimes(1);
      // Mouse sobre a seta também para; ao sair da vitrine, volta.
      fireEvent.mouseEnter(seta);
      act(() => vi.advanceTimersByTime(PASSO_VITRINE_MS * 2));
      expect(scrollTo).toHaveBeenCalledTimes(1);
      fireEvent.mouseLeave(seta.parentElement!);
      act(() => vi.advanceTimersByTime(PASSO_VITRINE_MS));
      expect(scrollTo).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("variante de busca da capa: mesmos campos e destino, sem título e com o botão \"Consultar\"", () => {
    render(<FormConsulta imoveis={[imovel]} valores={{}} hoje="2026-09-25" canal="whatsapp" variante="busca" />);
    const form = document.querySelector("form")!;
    // A busca abre no resultado (M7.21): a lista das casas.
    expect(form.getAttribute("action")).toBe("/consulta#resultado");
    expect([...form.querySelectorAll("[name]")].map((e) => e.getAttribute("name"))).toEqual(["imovel", "entrada", "saida", "hospedes"]);
    expect(screen.getByRole("button", { name: /Consultar/ }).getAttribute("type")).toBe("submit");
    expect(form.querySelector("strong")).toBeNull();
  });

  it("formulário de consulta vai para /consulta por GET, com o imóvel escolhido e os erros", () => {
    render(<FormConsulta imoveis={[imovel]} valores={{ imovel: "403" }} erros={{ saida: "A saída precisa ser depois da entrada." }} hoje="2026-09-25" canal="email" />);
    const form = document.querySelector("form")!;
    // A consulta abre no resultado (M7.21): o "Resumo da viagem".
    expect(form.getAttribute("action")).toBe("/consulta#resultado");
    expect(form.getAttribute("method")).toBe("get");
    expect((screen.getByRole("combobox", { name: /Seu lugar/ }) as HTMLSelectElement).value).toBe("403");
    expect(screen.getByText("A saída precisa ser depois da entrada.")).toBeTruthy();
    // Nada pessoal no endereço: só apartamento, datas e pessoas; pessoas de 1 até a maior capacidade, 2 por padrão.
    expect([...form.querySelectorAll("[name]")].map((e) => e.getAttribute("name"))).toEqual(["imovel", "entrada", "saida", "hospedes"]);
    const pessoas = form.querySelector('select[name="hospedes"]') as HTMLSelectElement;
    expect([...pessoas.options].map((o) => o.textContent)).toEqual(["1 pessoa", "2 pessoas", "3 pessoas", "4 pessoas"]);
    expect(pessoas.value).toBe("2");
    // O texto fala do canal que existe no cadastro (aqui, só e-mail): nada de prometer WhatsApp.
    expect(form.textContent).toContain("por e-mail");
    expect(form.textContent).not.toContain("WhatsApp");
    // Sem marca fixa no texto (o site pode ser de outra empresa do cadastro).
    expect(form.textContent).not.toContain("Sua Casa Leblon");
  });

  it("sem capacidade informada em algum apartamento, o formulário oferece até 10 pessoas; um número já pedido acima continua escolhido", () => {
    render(<FormConsulta imoveis={[imovel, { ...imovel, codigo: "102", capacidade: null }]} valores={{}} hoje="2026-09-25" canal="whatsapp" />);
    expect([...(document.querySelector('select[name="hospedes"]') as HTMLSelectElement).options].map((o) => o.value).at(-1)).toBe("10");
    cleanup();
    render(<FormConsulta imoveis={[imovel]} valores={{ imovel: "403", hospedes: "6" }} erros={{ hospedes: "Este apartamento recebe até 4 pessoas." }} hoje="2026-09-25" canal="whatsapp" />);
    expect((document.querySelector('select[name="hospedes"]') as HTMLSelectElement).value).toBe("6");
  });
});
