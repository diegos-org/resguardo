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

describe("simulador com só disponibilidade (M3.11b)", () => {
  it("confere só quando se pode reservar e entrar/sair: a estadia mínima e máxima do cadastro e dos períodos ficam no Beds24; sem valor do cadastro", () => {
    const comMinimo = regrasDeVenda({ ...DETALHES_VAZIOS, precoBase: 30000, estadiaMinima: 5, taxaLimpeza: 10000 });
    const periodos = [{ nome: "Especial", inicio: "2026-10-20", fim: "2026-10-22", precoNoite: null, estadiaMinima: 7 }];
    render(<Simulador regras={comMinimo} periodos={periodos} hoje="2026-10-10" fontePrecos="so_disponibilidade" />);
    preencher();
    const status = screen.getByRole("status").textContent ?? "";
    expect(status).toContain("Dentro das regras de venda");
    expect(status).not.toMatch(/\d,\d\d/);
    expect(screen.getByText(/estadia mínima e máxima são os lidos do Beds24/)).toBeTruthy();
    cleanup();
    // O mesmo cadastro com a fonte scl recusa as 2 noites pelo mínimo.
    render(<Simulador regras={comMinimo} periodos={periodos} hoje="2026-10-10" fontePrecos="scl" />);
    preencher();
    expect(screen.getByRole("status").textContent).toContain("Não pode ser vendida assim");
  });
});
