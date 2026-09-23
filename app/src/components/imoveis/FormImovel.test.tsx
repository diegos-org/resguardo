// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
});
