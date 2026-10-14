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

describe("\"Seu lugar\" opcional e troca de casa no envio do cartão lateral (M7.9)", () => {
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

  it("na página de uma casa, escolher outra casa e Continuar abre a página dela com as mesmas datas e pessoas", () => {
    render(<FormConsulta imoveis={casas} valores={{ imovel: "403", entrada: "2026-10-12", saida: "2026-10-15", hospedes: "3" }} hoje="2026-10-07" canal="whatsapp" variante="lateral" />);
    expect(lugar().value).toBe("403");
    // A dica fica ligada ao campo, para o leitor de tela anunciar antes da escolha.
    const dica = document.getElementById("dica-troca-casa")!;
    expect(dica.textContent).toContain("Com outra casa escolhida, Continuar abre a página dela com as mesmas datas.");
    expect(lugar().getAttribute("aria-describedby")).toBe("dica-troca-casa");
    // Mudar o campo não muda de página (nem pelo teclado: as setas num campo fechado mudam o valor a cada tecla).
    fireEvent.keyDown(lugar(), { key: "ArrowDown" });
    fireEvent.change(lugar(), { target: { value: "102" } });
    fireEvent.keyDown(lugar(), { key: "ArrowDown" });
    fireEvent.change(lugar(), { target: { value: "205" } });
    fireEvent.keyDown(lugar(), { key: "ArrowUp" });
    fireEvent.change(lugar(), { target: { value: "102" } });
    expect(m.push).not.toHaveBeenCalled();
    // O envio leva à página da casa escolhida, no lugar do envio normal para a consulta.
    const seguiuEnvioNormal = fireEvent.submit(document.querySelector("form")!);
    expect(seguiuEnvioNormal).toBe(false);
    expect(m.push).toHaveBeenCalledTimes(1);
    expect(m.push).toHaveBeenCalledWith("/imoveis/102?checkin=2026-10-12&checkout=2026-10-15&guests=3");
  });

  it("a outra casa tem noite ocupada nessas datas: Continuar abre a página dela com as mesmas datas (lá ela aparece indisponível)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({ ok: true, json: async () => ({ ocupadas: url.includes("imovel=102") ? ["2026-10-13"] : [] }) })),
    );
    render(<FormConsulta imoveis={casas} valores={{ imovel: "403", entrada: "2026-10-12", saida: "2026-10-15", hospedes: "2" }} hoje="2026-10-07" canal="whatsapp" variante="lateral" />);
    fireEvent.change(lugar(), { target: { value: "102" } });
    await new Promise((r) => setTimeout(r, 20));
    expect(fireEvent.submit(document.querySelector("form")!)).toBe(false);
    expect(m.push).toHaveBeenCalledWith("/imoveis/102?checkin=2026-10-12&checkout=2026-10-15&guests=2");
    // O calendário não abriu para pedir a saída de novo.
    expect(screen.queryByRole("dialog", { name: "Escolher as datas da estadia" })).toBeNull();
  });

  it("\"Todas as casas\" ou a mesma casa seguem o envio normal (a busca e a consulta)", () => {
    render(<FormConsulta imoveis={casas} valores={{ imovel: "403", entrada: "2026-10-12", saida: "2026-10-15", hospedes: "2" }} hoje="2026-10-07" canal="whatsapp" variante="lateral" />);
    const form = document.querySelector("form")!;
    fireEvent.change(lugar(), { target: { value: "" } });
    expect(fireEvent.submit(form)).toBe(true);
    fireEvent.change(lugar(), { target: { value: "403" } });
    expect(fireEvent.submit(form)).toBe(true);
    expect(m.push).not.toHaveBeenCalled();
  });

  it("sem as datas, Continuar abre o calendário e não troca de casa; com elas, abre a outra casa", () => {
    render(<FormConsulta imoveis={casas} valores={{ imovel: "403", hospedes: "2" }} hoje="2026-10-07" canal="whatsapp" variante="lateral" />);
    const form = document.querySelector("form")!;
    fireEvent.change(lugar(), { target: { value: "205" } });
    expect(fireEvent.submit(form)).toBe(false);
    expect(m.push).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("fora do cartão lateral (capa e consulta), trocar a casa não navega: vale o envio do formulário", () => {
    render(<FormConsulta imoveis={casas} valores={{ imovel: "403", entrada: "2026-10-12", saida: "2026-10-15", hospedes: "2" }} hoje="2026-10-07" canal="whatsapp" />);
    fireEvent.change(lugar(), { target: { value: "102" } });
    expect(fireEvent.submit(document.querySelector("form")!)).toBe(true);
    expect(m.push).not.toHaveBeenCalled();
    expect(document.getElementById("dica-troca-casa")).toBeNull();
    expect(lugar().hasAttribute("aria-describedby")).toBe(false);
    // Sem JavaScript também: o formulário continua sendo um GET para a consulta, com os mesmos campos.
    const form = document.querySelector("form")!;
    expect([form.getAttribute("action"), form.getAttribute("method")]).toEqual(["/consulta", "get"]);
    expect([...form.querySelectorAll("[name]")].map((e) => e.getAttribute("name"))).toEqual(["imovel", "entrada", "saida", "hospedes"]);
  });
});
