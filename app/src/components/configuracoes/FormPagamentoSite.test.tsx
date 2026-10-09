// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FormPagamentoSite } from "./FormPagamentoSite";

const props = {
  config: { oferecer: true, nomeFatura: null, categoriaTaxaId: null },
  categorias: [{ id: "33333333-3333-4333-8333-333333333333", nome: "Tarifas bancárias" }],
  nomeEmpresa: "Sua Casa Leblon",
  limiteNome: 22,
  visiveis: 10,
  categoriaPadrao: "Taxa do pagamento do site",
  editar: true,
};
afterEach(cleanup);

it("a prévia da fatura acompanha o que se digita (vazio = nome da empresa)", () => {
  render(<FormPagamentoSite {...props} salvar={vi.fn()} />);
  expect(screen.getByText("Sua Casa L")).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/Nome na fatura/), { target: { value: "SCL Temporada" } });
  expect(screen.getByText("SCL Tempor")).toBeTruthy();
});

it("salvar devolve os erros por campo e mantém o que foi digitado", async () => {
  const salvar = vi.fn().mockResolvedValue({ erros: { nomeFatura: "Use só letras, números, espaço, ponto e hífen." }, mensagem: "Confira os campos destacados.", valores: { nomeFatura: "SCL!", oferecer: "on" } });
  render(<FormPagamentoSite {...props} salvar={salvar} />);
  fireEvent.change(screen.getByLabelText(/Nome na fatura/), { target: { value: "SCL!" } });
  fireEvent.submit(screen.getByRole("form", { name: "Pagamento no site" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Confira os campos destacados."));
  expect(screen.getByText("Use só letras, números, espaço, ponto e hífen.")).toBeTruthy();
  const [, dados] = salvar.mock.calls[0] as [unknown, FormData];
  expect(dados.get("nomeFatura")).toBe("SCL!");
  expect(dados.get("oferecer")).toBe("on");
  expect(dados.get("categoriaTaxaId")).toBe("");
});

it("quem só lê o financeiro vê as regras sem poder salvar", () => {
  render(<FormPagamentoSite {...props} editar={false} salvar={vi.fn()} />);
  expect((screen.getByLabelText(/Oferecer pagamento no site/).closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Salvar" })).toBeNull();
  expect(screen.getByText("Só quem edita o financeiro muda estas regras.")).toBeTruthy();
});
