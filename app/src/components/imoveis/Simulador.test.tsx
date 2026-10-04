// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DETALHES_VAZIOS, regrasDeVenda } from "@/imoveis/detalhes";
import { Simulador } from "./Periodos";

const regras = regrasDeVenda({ ...DETALHES_VAZIOS, precoBase: 30000, precoDinamico: true, precoMinimo: 40000, precoMaximo: 60000, taxaLimpeza: 10000 });
const preencher = () => {
  fireEvent.change(screen.getByLabelText("Entrada"), { target: { value: "2026-10-20" } });
  fireEvent.change(screen.getByLabelText("Saída"), { target: { value: "2026-10-22" } });
};

afterEach(cleanup);

describe("simulador segue a fonte de preços do imóvel (M3.9)", () => {
  it("fonte SCL aplica o piso do preço dinâmico: 2 noites a R$ 400", () => {
    render(<Simulador regras={regras} periodos={[]} hoje="2026-10-10" fontePrecos="scl" />);
    preencher();
    expect(screen.getByRole("status").textContent).toMatch(/800,00/);
  });
  it("preços digitados ignoram o piso: 2 noites a R$ 300, com a explicação", () => {
    render(<Simulador regras={regras} periodos={[]} hoje="2026-10-10" fontePrecos="manual" />);
    preencher();
    expect(screen.getByRole("status").textContent).toMatch(/600,00/);
    expect(screen.getByText(/sem eventos, feriadões, última hora nem os limites/)).toBeTruthy();
  });
  it("preços do Beds24: confere só as regras e não mostra valor do cadastro", () => {
    render(<Simulador regras={regras} periodos={[]} hoje="2026-10-10" fontePrecos="beds24" />);
    preencher();
    const status = screen.getByRole("status").textContent ?? "";
    expect(status).toContain("Dentro das regras de venda");
    expect(status).not.toMatch(/\d,\d\d/);
    expect(screen.getByText(/o valor da noite é o lido do Beds24/)).toBeTruthy();
  });
});
