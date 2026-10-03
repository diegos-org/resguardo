// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CotacaoVista } from "@/site/cotacoes";
import { Cotacao } from "./Cotacao";
import { FormSegurar } from "./FormSegurar";
import { SegurarDatas } from "./SegurarDatas";

const base: CotacaoVista = {
  cotacao: {
    id: "c1", organizacaoId: "o1", imovelId: "i1", codigo: "COT-ABCDEFGH", estado: "aberta", checkin: "2026-10-12", checkout: "2026-10-15", hospedes: 4, noites: 3, situacao: "disponivel",
    diarias: 135000, limpeza: 25000, hospedeExtra: 30000, total: 190000, leituraEm: null, reservaId: null, holdAte: null, criadaEm: new Date(), atualizadaEm: new Date(),
    imovelCodigo: "403", imovelNome: "Studio Exemplo", fuso: "America/Sao_Paulo",
  },
  estado: "aberta",
  atual: null,
  mudou: false,
  reserva: null,
};
const vista = (over: Partial<CotacaoVista>, cot: Partial<CotacaoVista["cotacao"]> = {}): CotacaoVista => ({ ...base, ...over, cotacao: { ...base.cotacao, ...cot } });
afterEach(cleanup);

it("cotação aberta: resumo com valor por partes e o formulário de contato; sem pagamento", () => {
  render(<Cotacao vista={base} whatsapp="5521999990000" email="" formulario={<p>FORMULARIO</p>} />);
  expect(screen.getByRole("heading", { name: "Sua cotação" })).toBeTruthy();
  expect(screen.getByText("COT-ABCDEFGH")).toBeTruthy();
  expect(screen.getByText("R$ 1.350,00")).toBeTruthy();
  expect(screen.getByText("R$ 1.900,00")).toBeTruthy();
  expect(screen.getByText("FORMULARIO")).toBeTruthy();
  expect(screen.getByText(/Nenhum pagamento é feito no site/)).toBeTruthy();
});

it("cotação que mudou: aviso com o valor atual e nova consulta com os mesmos dados; sem formulário", () => {
  const atual = { situacao: "disponivel" as const, motivos: [], noites: 3, cotacao: { diarias: 150000, limpeza: 25000, hospedeExtra: 30000, total: 205000 }, leituraEm: null };
  render(<Cotacao vista={vista({ mudou: true, atual })} whatsapp={null} email="" formulario={<p>FORMULARIO</p>} />);
  expect(screen.getByRole("heading", { name: "Esta cotação mudou" })).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("O valor mudou desde esta cotação");
  expect(screen.getByRole("alert").textContent).toContain("Valor atual: R$ 2.050,00");
  expect(screen.queryByText("FORMULARIO")).toBeNull();
  expect(screen.getByRole("link", { name: "Fazer uma nova consulta" }).getAttribute("href")).toBe("/consulta?imovel=403&entrada=2026-10-12&saida=2026-10-15&hospedes=4");
  cleanup();
  // Só a situação mudou (mesmo valor): o aviso fala da disponibilidade, não do valor.
  render(<Cotacao vista={vista({ mudou: true, atual: { ...atual, situacao: "a_confirmar", cotacao: { ...atual.cotacao, diarias: 135000, total: 190000 }, motivos: ["Ainda não conferimos a agenda mais recente para essas datas: confirmamos na conversa."] } })} whatsapp={null} email="" />);
  expect(screen.getByRole("alert").textContent).toContain("precisa ser confirmada pela equipe");
  expect(screen.getByRole("alert").textContent).not.toContain("Valor atual");
});

it("datas seguradas: prazo no fuso do imóvel, pedido e botão do WhatsApp com a mensagem; expirada e convertida", () => {
  const holdAte = new Date("2026-10-01T15:30:00Z"); // 12:30 em São Paulo
  render(<Cotacao vista={vista({ estado: "segurada", reserva: { codigo: "SCL-TESTE1", estado: "pedido" } }, { estado: "segurada", holdAte })} whatsapp="5521999990000" email="" />);
  expect(screen.getByRole("heading", { name: "Datas seguradas" })).toBeTruthy();
  expect(screen.getByText(/pedido SCL-TESTE1/).textContent).toContain("12:30");
  const link = screen.getByRole("link", { name: "Falar com a equipe pelo WhatsApp" }).getAttribute("href") ?? "";
  expect(link.startsWith("https://wa.me/5521999990000?text=")).toBe(true);
  expect(decodeURIComponent(link)).toContain("COT-ABCDEFGH");
  expect(decodeURIComponent(link)).toContain("seguradas para mim até 01/10, 12:30");
  cleanup();
  render(<Cotacao vista={vista({ estado: "expirada" }, { estado: "expirada", holdAte })} whatsapp={null} email="contato@example.com" />);
  expect(screen.getByRole("heading", { name: "O tempo desta cotação acabou" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Fazer uma nova consulta" })).toBeTruthy();
  cleanup();
  render(<Cotacao vista={vista({ estado: "convertida", reserva: { codigo: "SCL-TESTE1", estado: "confirmada" } }, { estado: "segurada", holdAte })} whatsapp={null} email="" />);
  expect(screen.getByRole("heading", { name: "Reserva confirmada" })).toBeTruthy();
  expect(screen.getByText(/código SCL-TESTE1/)).toBeTruthy();
});

const acao = vi.fn();
beforeEach(() => vi.resetAllMocks());

it("formulário de contato envia código e dados; mostra o erro do servidor por campo e geral", async () => {
  acao.mockResolvedValue({ erro: "Confira seus dados.", erros: { email: "Informe um e-mail válido." }, valores: { nome: "Ana", email: "x", telefone: "21999990000" } });
  render(<FormSegurar codigo="COT-ABCDEFGH" minutos={30} acao={acao} />);
  expect(screen.getByText("Segurar as datas por 30 minutos")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });
  fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "x@example.com" } });
  fireEvent.change(screen.getByLabelText("WhatsApp (com DDD)"), { target: { value: "21999990000" } });
  fireEvent.click(screen.getByRole("button", { name: "Segurar as datas" }));
  await waitFor(() => expect(acao).toHaveBeenCalled());
  const form = acao.mock.calls[0][1] as FormData;
  expect(form.get("codigo")).toBe("COT-ABCDEFGH");
  expect(form.get("nome")).toBe("Ana");
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Confira seus dados."));
  expect(screen.getByText("Informe um e-mail válido.")).toBeTruthy();
});

it("chamada 'segurar estas datas' leva o pedido da consulta escondido e avisa quando é 'a confirmar'", () => {
  const pedido = { imovel: "403", entrada: "2026-10-12", saida: "2026-10-15", hospedes: "4" };
  const { container } = render(<SegurarDatas pedido={pedido} aConfirmar acao={acao} />);
  expect(screen.getByRole("button", { name: "Segurar estas datas" })).toBeTruthy();
  expect(screen.getByRole("note").textContent).toContain("não garante a reserva");
  const escondidos = Object.fromEntries([...container.querySelectorAll("input[type=hidden]")].map((i) => [(i as HTMLInputElement).name, (i as HTMLInputElement).value]));
  expect(escondidos).toEqual(pedido);
  cleanup();
  render(<SegurarDatas pedido={pedido} aConfirmar={false} acao={acao} />);
  expect(screen.queryByRole("note")).toBeNull();
});
