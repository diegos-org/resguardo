// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { BairroAPorta } from "./BairroAPorta";

afterEach(cleanup);

// Lugares fictícios.
const lugares = [
  { nome: "Praia Fictícia", distancia: "5 min a pé", frase: "Mar aberto. Um convite a desacelerar.", foto: "/imagens-site/f1" },
  { nome: "Café Inventado", distancia: "", frase: "", foto: null },
];

it("seção com filete, olho, título, subtítulo e um cartão por lugar; foto só quando há, nunca imagem genérica", () => {
  render(<BairroAPorta olho="O bairro à sua porta" titulo="Seu próximo passeio começa por aqui." subtitulo="Subtítulo fictício." lugares={lugares} />);
  const secao = screen.getByRole("region", { name: "Seu próximo passeio começa por aqui." });
  expect(within(secao).getByText("O bairro à sua porta")).toBeTruthy();
  expect(within(secao).getByRole("heading", { level: 2 }).textContent).toBe("Seu próximo passeio começa por aqui.");
  expect(within(secao).getByText("Subtítulo fictício.")).toBeTruthy();
  const cartoes = within(secao).getAllByRole("listitem");
  expect(cartoes).toHaveLength(2);
  const [praia, cafe] = cartoes.map((c) => within(c));
  expect(praia.getByRole("heading", { level: 3, name: "Praia Fictícia" })).toBeTruthy();
  expect(praia.getByText("Mar aberto. Um convite a desacelerar.")).toBeTruthy();
  expect(praia.getByText("5 min a pé")).toBeTruthy();
  const foto = praia.getByRole("img", { name: "Foto de Praia Fictícia" });
  expect(foto.getAttribute("src")).toBe("/imagens-site/f1");
  expect(foto.getAttribute("loading")).toBe("lazy");
  // Sem foto, frase e distância: o cartão fica só com o nome.
  expect(cafe.getByRole("heading", { level: 3, name: "Café Inventado" })).toBeTruthy();
  expect(cafe.queryByRole("img")).toBeNull();
  expect(cartoes[1].querySelectorAll("p, small")).toHaveLength(0);
  expect(screen.getAllByRole("img")).toHaveLength(1);
});

it("subtítulo em branco não deixa parágrafo vazio; sem lugar, a seção não aparece", () => {
  render(<BairroAPorta olho="O bairro à sua porta" titulo="Título fictício" subtitulo="" lugares={lugares.slice(1)} />);
  const secao = screen.getByRole("region", { name: "Título fictício" });
  expect(secao.querySelectorAll(":scope > p")).toHaveLength(1);
  cleanup();
  const { container } = render(<BairroAPorta olho="O bairro à sua porta" titulo="Título fictício" subtitulo="Sub" lugares={[]} />);
  expect(container.innerHTML).toBe("");
});

it("o olho vem do painel (M7.16): o texto salvo aparece acima do título; em branco, não deixa parágrafo vazio e o título continua", () => {
  render(<BairroAPorta olho="Perto de casa" titulo="Título fictício" subtitulo="Sub fictício." lugares={lugares} />);
  let secao = screen.getByRole("region", { name: "Título fictício" });
  expect([...secao.querySelectorAll(":scope > p")].map((p) => p.textContent)).toEqual(["Perto de casa", "Sub fictício."]);
  expect(within(secao).queryByText("O bairro à sua porta")).toBeNull();
  cleanup();
  render(<BairroAPorta olho="" titulo="Título fictício" subtitulo="Sub fictício." lugares={lugares} />);
  secao = screen.getByRole("region", { name: "Título fictício" });
  expect([...secao.querySelectorAll(":scope > p")].map((p) => p.textContent)).toEqual(["Sub fictício."]);
  expect(secao.firstElementChild?.tagName).toBe("H2");
});
