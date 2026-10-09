// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ conferir: vi.fn(), devolver: vi.fn(), porFora: vi.fn(), liberar: vi.fn(), estornar: vi.fn() }));
vi.mock("@/pagamentos/acoes-painel", () => ({ conferirAgoraAcao: m.conferir, devolverAcao: m.devolver, devolucaoPorForaAcao: m.porFora, registrarLiberacaoAcao: m.liberar, estornarLiberacaoAcao: m.estornar, registrarTaxaPerdidaAcao: vi.fn() }));
import type { PagamentoDoPainel } from "@/pagamentos/consultas";
import { PagamentoNoSite } from "@/components/reservas/PagamentoNoSite";
import { FormAcaoPagamento } from "./FormAcaoPagamento";

const ID = "11111111-1111-4111-8111-111111111111";
const semReserva = {
  id: ID,
  cotacaoId: "c",
  reservaId: "r",
  forma: "pix",
  situacao: "aprovado",
  ambiente: "teste",
  aoVivo: false,
  valor: 182400,
  valorPago: 182400,
  taxa: null,
  liquido: null,
  liberacaoPrevistaEm: null,
  liberacaoConfirmadaEm: null,
  liberacaoOrigem: null,
  pixExpiraEm: null,
  aprovadoEm: new Date("2026-10-01T15:05:00Z"),
  consultadoEm: null,
  criadoEm: new Date("2026-10-01T15:00:00Z"),
  desfecho: null,
  desfechoEm: null,
  motivoSemReserva: "conflito",
  motivoSemReservaTexto: "As noites ficaram ocupadas por outra reserva ou bloqueio.",
  avisos: [],
  devolucao: null,
  pedeAtencao: true,
  acoes: { conferir: true, devolver: true, devolucaoPorFora: true, registrarLiberacao: false, estornarLiberacao: false, registrarTaxaPerdida: false },
} satisfies PagamentoDoPainel;

let confirmar: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks();
  confirmar = vi.fn(() => false);
  window.confirm = confirmar as unknown as typeof window.confirm;
});
afterEach(cleanup);

it("devolver pelo Mercado Pago pergunta antes (com o valor); recusar a pergunta não chama o servidor", async () => {
  render(<PagamentoNoSite pagamentos={[semReserva]} verValores editar hoje="2026-10-09" />);
  fireEvent.click(screen.getByRole("button", { name: "Devolver pelo Mercado Pago" }));
  expect(confirmar).toHaveBeenCalledWith("Devolver ao hóspede o valor integral de R$ 1.824,00 pelo Mercado Pago? A devolução não pode ser desfeita.");
  expect(m.devolver).not.toHaveBeenCalled();
});

it("confirmada, a ação vai ao servidor com a tentativa e a recusa do domínio aparece como veio", async () => {
  confirmar.mockReturnValue(true);
  m.devolver.mockResolvedValue({ mensagem: "Já há uma devolução pedida ao Mercado Pago para este pagamento." });
  render(<PagamentoNoSite pagamentos={[semReserva]} verValores editar hoje="2026-10-09" />);
  fireEvent.click(screen.getByRole("button", { name: "Devolver pelo Mercado Pago" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Já há uma devolução pedida ao Mercado Pago para este pagamento."));
  const [, dados] = m.devolver.mock.calls[0] as [unknown, FormData];
  expect(dados.get("pagamentoId")).toBe(ID);
});

it("devolução por fora também pede confirmação; conferir agora não pede (só lê o Mercado Pago)", async () => {
  m.conferir.mockResolvedValue({ ok: true, mensagem: "Conferido com o Mercado Pago: nada mudou (aprovado)." });
  render(<PagamentoNoSite pagamentos={[semReserva]} verValores editar hoje="2026-10-09" />);
  fireEvent.click(screen.getByRole("button", { name: "Registrar devolução feita por fora" }));
  expect(confirmar.mock.calls[0][0]).toContain("Registrar que o dinheiro já voltou ao hóspede por fora do Mercado Pago?");
  expect(m.porFora).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Conferir agora" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Conferido com o Mercado Pago: nada mudou (aprovado)."));
  expect(confirmar).toHaveBeenCalledTimes(1);
});

it("sem tentativa, Conferir agora vai sem pagamentoId (todas as pendentes da empresa)", async () => {
  m.conferir.mockResolvedValue({ ok: true, mensagem: "Nada pendente para conferir com o Mercado Pago." });
  render(<FormAcaoPagamento acao={m.conferir} rotulo="Conferir agora" nome="Conferir todos" />);
  fireEvent.click(screen.getByRole("button", { name: "Conferir agora" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Nada pendente para conferir com o Mercado Pago."));
  const [, dados] = m.conferir.mock.calls[0] as [unknown, FormData];
  expect(dados.get("pagamentoId")).toBeNull();
});

it("numa recusa, o que foi digitado continua no campo (nada volta ao valor padrão)", async () => {
  m.liberar.mockResolvedValue({ mensagem: "A data da liberação não pode ser antes da criação do Pix (01/10/2026)." });
  render(
    <FormAcaoPagamento acao={m.liberar} rotulo="Registrar" nome="Registrar liberação" pagamentoId={ID}>
      <input name="liquido" aria-label="Líquido" defaultValue="1.805,94" />
    </FormAcaoPagamento>,
  );
  const campo = screen.getByLabelText("Líquido") as HTMLInputElement;
  fireEvent.change(campo, { target: { value: "1.700,00" } });
  fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("antes da criação do Pix"));
  expect((m.liberar.mock.calls[0][1] as FormData).get("liquido")).toBe("1.700,00");
  expect((m.liberar.mock.calls[0][1] as FormData).get("pagamentoId")).toBe(ID);
  expect(campo.value).toBe("1.700,00");
});

it("taxa que não voltou: a pergunta de confirmação mostra o valor digitado (1806 sem vírgula = R$ 1.806,00) e a taxa da aprovação", async () => {
  const confirmada = {
    ...semReserva,
    situacao: "devolvido",
    taxa: 1806,
    desfecho: "devolucao",
    devolucao: { situacao: "confirmada", valor: 182400, tentativas: 1, falhas: 0, confirmadaEm: new Date("2026-10-02T15:00:00Z"), porForaData: null, porForaValor: null, porForaNota: "", taxaPerdida: null },
    acoes: { conferir: true, devolver: false, devolucaoPorFora: false, registrarLiberacao: false, estornarLiberacao: false, registrarTaxaPerdida: true },
  } satisfies PagamentoDoPainel;
  render(<PagamentoNoSite pagamentos={[confirmada]} verValores editar hoje="2026-10-09" />);
  const form = screen.getByRole("form", { name: "Registrar taxa que não voltou" });
  fireEvent.change(form.querySelector('input[name="valor"]')!, { target: { value: "1806" } });
  fireEvent.click(screen.getByRole("button", { name: "Registrar taxa que não voltou" }));
  expect(confirmar).toHaveBeenCalledWith(
    "Registrar R$ 1.806,00 como a taxa que o Mercado Pago não devolveu (a taxa cobrada na aprovação foi R$ 18,06)? Ela entra como despesa da empresa (zero, se a taxa voltou toda) e só se registra uma vez.",
  );
  fireEvent.change(form.querySelector('input[name="valor"]')!, { target: { value: "18,06" } });
  fireEvent.click(screen.getByRole("button", { name: "Registrar taxa que não voltou" }));
  expect(confirmar.mock.calls[1][0]).toContain("Registrar R$ 18,06 como a taxa");
});
