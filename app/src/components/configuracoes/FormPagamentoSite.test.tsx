// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FormPagamentoSite } from "./FormPagamentoSite";

const props = {
  config: { oferecer: true, nomeFatura: null, categoriaTaxaId: null, cartao: false, parcelasMaximas: null, tresDS: "on_fraud_risk" as const, pedidoCancelamentoNoPortal: true, naoComparecimentoHoras: 21 },
  categorias: [{ id: "33333333-3333-4333-8333-333333333333", nome: "Tarifas bancárias" }],
  nomeEmpresa: "Sua Casa Leblon",
  limiteNome: 22,
  visiveis: 10,
  categoriaPadrao: "Taxa do pagamento do site",
  parcelasLimite: 36,
  horasLimite: 72,
  opcoesTresDS: [
    { valor: "on_fraud_risk", texto: "Quando houver risco (recomendado): texto do servidor" },
    { valor: "never", texto: "Nunca: texto do servidor" },
  ],
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

it("cartão de crédito (M8.2b): ligar, máximo de parcelas (vazio = o do Mercado Pago) e a verificação do banco com os textos do servidor; juros do hóspede", async () => {
  const salvar = vi.fn().mockResolvedValue({ ok: true, aviso: "Salvo." });
  const { container } = render(<FormPagamentoSite {...props} salvar={salvar} />);
  const cartao = screen.getByLabelText(/Oferecer cartão de crédito/) as HTMLInputElement;
  expect(cartao.checked).toBe(false);
  const parcelas = screen.getByLabelText(/Número máximo de parcelas/) as HTMLInputElement;
  expect(parcelas.value).toBe("");
  expect(parcelas.placeholder).toBe("máximo do Mercado Pago");
  expect(parcelas.max).toBe("36");
  const tresDS = screen.getByLabelText(/Verificação do banco/) as HTMLSelectElement;
  expect(tresDS.value).toBe("on_fraud_risk");
  expect([...tresDS.options].map((o) => o.textContent)).toEqual(["Quando houver risco (recomendado): texto do servidor", "Nunca: texto do servidor"]);
  expect(container.textContent).toContain("pagos pelo hóspede");
  expect(container.textContent).toContain("nunca oferece “parcelamento sem acréscimo”");
  fireEvent.click(cartao);
  fireEvent.change(parcelas, { target: { value: "6" } });
  fireEvent.change(tresDS, { target: { value: "never" } });
  fireEvent.submit(screen.getByRole("form", { name: "Pagamento no site" }));
  await waitFor(() => expect(salvar).toHaveBeenCalledTimes(1));
  const [, dados] = salvar.mock.calls[0] as [unknown, FormData];
  expect([dados.get("cartao"), dados.get("parcelasMaximas"), dados.get("tresDS")]).toEqual(["on", "6", "never"]);
});

it("cartão: o que estava salvo aparece; um erro devolve o que foi digitado com a mensagem no campo", async () => {
  const salvar = vi.fn().mockResolvedValue({ erros: { parcelasMaximas: "Use um número de 1 a 36 (vazio = o máximo que o Mercado Pago permitir)." }, mensagem: "Confira os campos destacados.", valores: { cartao: "on", parcelasMaximas: "40", tresDS: "never" } });
  render(<FormPagamentoSite {...props} config={{ ...props.config, cartao: true, parcelasMaximas: 3, tresDS: "never" }} salvar={salvar} />);
  expect((screen.getByLabelText(/Oferecer cartão de crédito/) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText(/Número máximo de parcelas/) as HTMLInputElement).value).toBe("3");
  expect((screen.getByLabelText(/Verificação do banco/) as HTMLSelectElement).value).toBe("never");
  fireEvent.submit(screen.getByRole("form", { name: "Pagamento no site" }));
  await waitFor(() => expect(screen.getByText("Use um número de 1 a 36 (vazio = o máximo que o Mercado Pago permitir).")).toBeTruthy());
  expect((screen.getByLabelText(/Número máximo de parcelas/) as HTMLInputElement).getAttribute("aria-invalid")).toBe("true");
});

it("cancelamento (M8.2c): a caixa do pedido em Minha reserva e as horas do não comparecimento, com o que está salvo; um erro fica no campo", async () => {
  const salvar = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, aviso: "Salvo." })
    .mockResolvedValueOnce({ erros: { naoComparecimentoHoras: "Use um número inteiro de horas de 0 a 72 (vazio = 21)." }, mensagem: "Confira os campos destacados.", valores: { naoComparecimentoHoras: "80" } });
  render(<FormPagamentoSite {...props} salvar={salvar} />);
  const caixa = screen.getByLabelText(/Hóspede pode pedir o cancelamento em Minha reserva/) as HTMLInputElement;
  expect(caixa.checked).toBe(true);
  const horas = screen.getByLabelText(/Não comparecimento: horas depois do horário de entrada/) as HTMLInputElement;
  expect([horas.value, horas.min, horas.max]).toEqual(["21", "0", "72"]);
  expect(screen.getByText(/21 horas = 12:00 do dia seguinte/)).toBeTruthy();
  fireEvent.click(caixa);
  fireEvent.change(horas, { target: { value: "30" } });
  fireEvent.submit(screen.getByRole("form", { name: "Pagamento no site" }));
  await waitFor(() => expect(salvar).toHaveBeenCalledTimes(1));
  const [, dados] = salvar.mock.calls[0] as [unknown, FormData];
  expect([dados.has("pedidoCancelamentoNoPortal"), dados.get("naoComparecimentoHoras")]).toEqual([false, "30"]);
  fireEvent.submit(screen.getByRole("form", { name: "Pagamento no site" }));
  await waitFor(() => expect(screen.getByText("Use um número inteiro de horas de 0 a 72 (vazio = 21).")).toBeTruthy());
  expect((screen.getByLabelText(/Não comparecimento/) as HTMLInputElement).getAttribute("aria-invalid")).toBe("true");
});
