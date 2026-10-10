// @vitest-environment jsdom
/** M8.2c — "Mensagem enviada ao hóspede" não se desfaz: pede confirmação antes (BotaoConfirmar), como as OTAs. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CancelamentoDoPainel } from "@/pagamentos/cancelamento-painel";
import type { PagamentoDoPainel } from "@/pagamentos/consultas";
vi.mock("@/pagamentos/acoes-cancelamento", () => ({
  calcularCancelamentoAcao: vi.fn(),
  cancelarReservaPagaAcao: vi.fn(),
  registrarPedidoCancelamentoAcao: vi.fn(),
  descartarPedidoCancelamentoAcao: vi.fn(),
  marcarOtaLiberadaAcao: vi.fn(),
  marcarHospedeAvisadoAcao: vi.fn(),
}));
vi.mock("@/pagamentos/acoes-painel", () => ({}));
import { CancelamentoSite } from "./CancelamentoSite";

const pedido = {
  id: "c1",
  situacao: "pedido",
  pedidoRecebidoEm: new Date("2026-10-01T15:30:00Z"),
  pedidoRegistradoOriginalEm: null,
  motivoMomento: "",
  canal: "whatsapp",
  pedidoPor: "Equipe Fictícia",
  quemCancela: "hospede",
  motivoEmpresa: null,
  motivoExcecao: null,
  politicaVersao: null,
  integralAte: null,
  arrependimentoAte: null,
  arrependimentoAteEntrada: null,
  entradaEm: null,
  calculado: null,
  direito: null,
  base: null,
  motivoDecisao: "",
  nota: "",
  valorPago: null,
  valorADevolver: null,
  canceladaEm: null,
  canceladaPor: null,
  resultadoLancadoEm: null,
  espelhado: false,
  caixaLancadoEm: null,
  ota: null,
  descontos: [],
  avisados: { pedido: null, decisao: null, devolucao: null },
  descartados: [],
  mensagens: { recebido: { texto: "Olá! Recebemos o seu pedido.", falta: [], textoBase: true }, decidido: null, devolvida: null },
} as CancelamentoDoPainel;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("mensagem enviada ao hóspede (M8.2c)", () => {
  it("pede confirmação antes de marcar (não se desfaz); recusada, nada é enviado", () => {
    const confirmar = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmar);
    render(
      <CancelamentoSite
        reserva={{ id: "22222222-2222-4222-8222-222222222222", codigo: "SCL-TESTE1", estado: "confirmada", checkin: "2026-11-09" }}
        pagamento={{ id: "p1" } as PagamentoDoPainel}
        cancelamento={pedido}
        momentos={{ entradaEm: new Date("2026-11-09T18:00:00Z"), naoComparecimentoApos: new Date("2026-11-10T15:00:00Z"), fuso: "America/Sao_Paulo" }}
        editarReserva
        editarFinanceiro={false}
        verValores={false}
        agora={new Date("2026-10-01T15:00:00Z")}
      />,
    );
    const botao = screen.getByRole("button", { name: "Mensagem enviada ao hóspede" });
    fireEvent.click(botao);
    expect(confirmar).toHaveBeenCalledWith(expect.stringContaining("Confirmar que esta mensagem já foi enviada ao hóspede?"));
  });
});
