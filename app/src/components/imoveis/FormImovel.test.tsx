// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormImovel } from "./FormImovel";

vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

afterEach(cleanup);

describe("FormImovel", () => {
  it("novo imóvel: vem em operação, fora do site, sem id", () => {
    render(<FormImovel acao={async () => ({})} />);
    expect((screen.getByLabelText("Em operação") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Aparece no site público") as HTMLInputElement).checked).toBe(false);
    expect(document.querySelector('input[name="id"]')).toBeNull();
    expect((screen.getByLabelText("Fuso horário") as HTMLInputElement).value).toBe("America/Sao_Paulo");
  });

  it("edição: preenche os dados e envia o id", () => {
    render(<FormImovel acao={async () => ({})} id="abc" inicial={{ codigo: "403", nome: "Studio", publico: true, capacidade: 3 }} />);
    expect((screen.getByLabelText("Código") as HTMLInputElement).value).toBe("403");
    expect((screen.getByLabelText("Capacidade (hóspedes)") as HTMLInputElement).value).toBe("3");
    expect((screen.getByLabelText("Aparece no site público") as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector('input[name="id"]') as HTMLInputElement).value).toBe("abc");
  });

  it("frase de abertura (M7.17): ao lado da descrição, vazia no imóvel novo, até 120 caracteres e com a explicação", () => {
    render(<FormImovel acao={async () => ({})} />);
    const frase = document.querySelector('input[name="frase"]') as HTMLInputElement;
    expect(frase.value).toBe("");
    expect(frase.maxLength).toBe(120);
    // Campo de uma linha só (input, não textarea), logo antes da descrição.
    const campos = [...document.querySelectorAll("input, textarea")].map((c) => c.getAttribute("name"));
    expect(campos.indexOf("frase") + 1).toBe(campos.indexOf("descricao"));
    const rotulo = frase.closest("label")!;
    expect(rotulo.textContent).toContain("Frase de abertura (site)");
    expect(rotulo.textContent).toContain("acima da descrição");
    expect(rotulo.textContent).toContain("Em branco, nada aparece");
    // O que o cartão usa sem frase, inteiro (como `fraseDoImovel`): a descrição e, sem ela, bairro e cidade; e os lugares
    // onde o cartão aparece, inclusive a vitrine da página para proprietários.
    const dica = rotulo.textContent!.replace(/\s+/g, " ");
    expect(dica).toContain("a primeira frase da descrição (sem descrição, o bairro e a cidade)");
    expect(dica).toContain("nas vitrines do site e da página para proprietários");
  });

  it("frase de abertura: a edição mostra a gravada e o erro do servidor fica ligado ao campo", async () => {
    render(<FormImovel acao={async () => ({})} id="abc" inicial={{ codigo: "403", nome: "Studio", frase: "Frase fictícia da casa." }} />);
    expect((document.querySelector('input[name="frase"]') as HTMLInputElement).value).toBe("Frase fictícia da casa.");
    cleanup();
    const acao = vi.fn(async () => ({ erros: { frase: "Máximo de 120 caracteres." }, mensagem: "Confira os campos destacados." }));
    render(<FormImovel acao={acao} id="abc" inicial={{ codigo: "403", nome: "Studio" }} />);
    fireEvent.submit(document.querySelector("form")!);
    const erro = await screen.findByText("Máximo de 120 caracteres.");
    const campo = document.querySelector('input[name="frase"]') as HTMLInputElement;
    expect(campo.getAttribute("aria-invalid")).toBe("true");
    expect(campo.getAttribute("aria-describedby")).toBe(erro.id);
  });
});
