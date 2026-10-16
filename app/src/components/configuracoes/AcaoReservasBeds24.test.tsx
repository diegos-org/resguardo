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
import { avaliarEscoposBeds24, ESCOPOS_OBRIGATORIOS_BEDS24 } from "@/beds24/reservas-site-regras";
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

/** A resposta como o servidor monta: a avaliação vem da regra de verdade, nunca escrita à mão. */
const lido = (escopos: readonly string[], ilegiveis: string[] = []) => ({
  resultado: { lidos: true, avaliacao: avaliarEscoposBeds24({ escopos: [...escopos], ilegiveis }), escopos: [...escopos], ilegiveis, lidoEm: "2026-10-16T12:00:00Z" },
});

it.each([
  [{ resultado: { lidos: false, motivo: "fora_da_producao" } }, "os escopos só são lidos no deploy de produção"],
  [lido(ESCOPOS_OBRIGATORIOS_BEDS24), `Em ordem: tem exatamente os escopos do convite, nada a mais e nada a menos (sem apagar, sem "all" e sem escrever dados pessoais). Lidos: ${ESCOPOS_OBRIGATORIOS_BEDS24.join(", ")}.`],
  [lido(["write:bookings", "all:bookings"]), "Lidos: write:bookings, all:bookings · a mais: all:bookings · faltando: read:bookings, read:bookings-personal, read:bookings-financial, read:properties, read:inventory, write:inventory."],
  [lido(ESCOPOS_OBRIGATORIOS_BEDS24.filter((e) => e !== "write:inventory")), "Faltam escopos do convite: conta como fora de ordem. Gere um convite novo com todos os escopos acima. Lidos: read:bookings, write:bookings, read:bookings-personal, read:bookings-financial, read:properties, read:inventory · faltando: write:inventory."],
  [lido([], ["bookings:write"]), "Não deu para ler os escopos na resposta do Beds24: conta como fora de ordem. Lidos: nenhum · fora do formato: bookings:write."],
  [{ resultado: { lidos: false, motivo: "falhou", erro: "Beds24 respondeu HTTP 401." } }, "Não deu para ler no Beds24: Beds24 respondeu HTTP 401."],
  [{ mensagem: "Somente quem edita as configurações muda o envio das reservas do site ao Beds24." }, "Somente quem edita as configurações"],
])("prontidão: os escopos lidos ou por que não leu (%#)", async (resposta, texto) => {
  m.escopos.mockResolvedValue(resposta);
  render(<ConferirEscoposBeds24 />);
  confirmar.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Conferir os escopos" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain(texto));
});
