// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImovelPublico } from "@/site/site";
import { FormConsulta } from "./FormConsulta";

const m = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push }) }));

const casa = (codigo: string, capacidade: number | null): ImovelPublico => ({
  codigo,
  fuso: "America/Sao_Paulo",
  nome: `Casa ${codigo}`,
  bairro: "Leblon",
  cidade: "Rio de Janeiro",
  capacidade,
  quartos: 1,
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
});
const casas = [casa("403", 4), casa("102", 2), casa("205", null)];
const lugar = () => screen.getByRole("combobox", { name: /Seu lugar/ }) as HTMLSelectElement;

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ocupadas: [] }) }))));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  m.push.mockClear();
});

describe("\"Seu lugar\" opcional e troca de casa no cartão lateral (M7.9)", () => {
  it("\"Todas as casas\" é a primeira opção e o campo não é obrigatório (sem casa, o envio leva à busca)", () => {
    render(<FormConsulta imoveis={casas} valores={{}} hoje="2026-10-07" canal="whatsapp" variante="busca" />);
    expect(lugar().required).toBe(false);
    expect([...lugar().options].map((o) => [o.value, o.textContent, o.disabled])).toEqual([
      ["", "Todas as casas", false],
      ["403", "Casa 403", false],
      ["102", "Casa 102", false],
      ["205", "Casa 205", false],
    ]);
    expect(lugar().value).toBe("");
    expect(document.querySelector("form")!.textContent).toContain("Escolha as datas e, se quiser, uma casa.");
  });

  it("na página de uma casa, trocar a casa abre a página da outra com as mesmas datas e pessoas", () => {
    render(<FormConsulta imoveis={casas} valores={{ imovel: "403", entrada: "2026-10-12", saida: "2026-10-15", hospedes: "3" }} hoje="2026-10-07" canal="whatsapp" variante="lateral" />);
    expect(lugar().value).toBe("403");
    expect(document.querySelector("form")!.textContent).toContain("Trocar a casa abre a página dela com as mesmas datas.");
    fireEvent.change(lugar(), { target: { value: "102" } });
    expect(m.push).toHaveBeenCalledTimes(1);
    expect(m.push).toHaveBeenCalledWith("/imoveis/102?checkin=2026-10-12&checkout=2026-10-15&guests=3");
  });

  it("\"Todas as casas\" ou a mesma casa não abrem nada; sem datas, vão só as pessoas", () => {
    render(<FormConsulta imoveis={casas} valores={{ imovel: "403", hospedes: "2" }} hoje="2026-10-07" canal="whatsapp" variante="lateral" />);
    fireEvent.change(lugar(), { target: { value: "" } });
    fireEvent.change(lugar(), { target: { value: "403" } });
    expect(m.push).not.toHaveBeenCalled();
    fireEvent.change(lugar(), { target: { value: "205" } });
    expect(m.push).toHaveBeenCalledWith("/imoveis/205?guests=2");
  });

  it("fora do cartão lateral (capa e consulta), trocar a casa não navega: vale o envio do formulário", () => {
    render(<FormConsulta imoveis={casas} valores={{ imovel: "403", entrada: "2026-10-12", saida: "2026-10-15", hospedes: "2" }} hoje="2026-10-07" canal="whatsapp" />);
    fireEvent.change(lugar(), { target: { value: "102" } });
    expect(m.push).not.toHaveBeenCalled();
    // Sem JavaScript também: o formulário continua sendo um GET para a consulta, com os mesmos campos.
    const form = document.querySelector("form")!;
    expect([form.getAttribute("action"), form.getAttribute("method")]).toEqual(["/consulta", "get"]);
    expect([...form.querySelectorAll("[name]")].map((e) => e.getAttribute("name"))).toEqual(["imovel", "entrada", "saida", "hospedes"]);
  });
});
