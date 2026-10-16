// @vitest-environment jsdom
/**
 * Os botões da seção "Reservas do site no Beds24" (M8.3a): toda mudança passa pelo `BotaoConfirmar` (cancelar a pergunta
 * não chama o servidor) e a resposta do servidor aparece; a prontidão mostra os escopos lidos, ou por que não leu.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ pausar: vi.fn(), retomar: vi.fn(), ligar: vi.fn(), desligar: vi.fn(), escopos: vi.fn() }));
vi.mock("@/beds24/acoes-reservas", () => ({
  pausarReservasBeds24Acao: m.pausar,
  retomarReservasBeds24Acao: m.retomar,
  ligarImovelReservasBeds24Acao: m.ligar,
  desligarImovelReservasBeds24Acao: m.desligar,
  conferirEscoposReservasBeds24Acao: m.escopos,
}));
import { AcaoReservasBeds24, ConferirEscoposBeds24 } from "./AcaoReservasBeds24";

let confirmar: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetAllMocks();
  confirmar = vi.spyOn(window, "confirm");
  m.pausar.mockResolvedValue({ ok: true, mensagem: "Pausado: nada é escrito no Beds24 até você retomar." });
  m.ligar.mockResolvedValue({ ok: false, mensagem: "Faça o ensaio com a credencial atual antes de ligar um imóvel." });
});
afterEach(() => {
  cleanup();
  confirmar.mockRestore();
});

it("pausar pede confirmação: sem o sim, nada vai ao servidor; com o sim, a resposta aparece", async () => {
  render(<AcaoReservasBeds24 acao="pausar" rotulo="Pausar tudo" pergunta="Pausar o envio?" />);
  confirmar.mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "Pausar tudo" }));
  expect(confirmar).toHaveBeenCalledWith("Pausar o envio?");
  expect(m.pausar).not.toHaveBeenCalled();
  confirmar.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Pausar tudo" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Pausado"));
  expect(m.pausar).toHaveBeenCalledTimes(1);
});

it("ligar manda o imóvel e mostra a recusa do servidor; desabilitado, nem pergunta", async () => {
  const { unmount } = render(<AcaoReservasBeds24 acao="ligar" imovelId="im-1" rotulo="Ligar" pergunta="Ligar o imóvel 103?" />);
  confirmar.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Ligar" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Faça o ensaio"));
  expect((m.ligar.mock.calls[0][1] as FormData).get("imovelId")).toBe("im-1");
  unmount();
  render(<AcaoReservasBeds24 acao="ligar" imovelId="im-1" rotulo="Ligar" pergunta="Ligar?" desabilitado />);
  expect((screen.getByRole("button", { name: "Ligar" }) as HTMLButtonElement).disabled).toBe(true);
});

it.each([
  [{ resultado: { lidos: false, motivo: "fora_da_producao" } }, "os escopos só são lidos no deploy de produção"],
  [{ resultado: { lidos: true, avaliacao: { situacao: "em_ordem", excessivos: [] }, escopos: ["write:bookings", "read:properties"], ilegiveis: [], lidoEm: "2026-10-16T12:00:00Z" } }, "Em ordem: escreve reservas"],
  [{ resultado: { lidos: true, avaliacao: { situacao: "escopo_excessivo", excessivos: ["all:bookings"] }, escopos: ["write:bookings", "all:bookings"], ilegiveis: [], lidoEm: "2026-10-16T12:00:00Z" } }, "a mais: all:bookings"],
  [{ resultado: { lidos: false, motivo: "falhou", erro: "Beds24 respondeu HTTP 401." } }, "Não deu para ler no Beds24: Beds24 respondeu HTTP 401."],
  [{ mensagem: "Somente quem edita as configurações muda o envio das reservas do site ao Beds24." }, "Somente quem edita as configurações"],
])("prontidão: os escopos lidos ou por que não leu (%#)", async (resposta, texto) => {
  m.escopos.mockResolvedValue(resposta);
  render(<ConferirEscoposBeds24 />);
  confirmar.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Conferir os escopos" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain(texto));
});
