// @vitest-environment jsdom
/**
 * Os botões da seção "Reservas do site no Beds24" (M8.3a): toda mudança passa pelo `BotaoConfirmar` (cancelar a pergunta
 * não chama o servidor) e a resposta do servidor aparece; a prontidão mostra os escopos lidos, ou por que não leu. M8.3c: o
 * ensaio (criar com o imóvel e as datas na pergunta, cancelar e conferir com o id da operação).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ pausar: vi.fn(), retomar: vi.fn(), ligar: vi.fn(), desligar: vi.fn(), escopos: vi.fn(), criarEnsaio: vi.fn(), cancelarEnsaio: vi.fn(), conferirEnsaio: vi.fn() }));
vi.mock("@/beds24/acoes-reservas", () => ({
  pausarReservasBeds24Acao: m.pausar,
  retomarReservasBeds24Acao: m.retomar,
  ligarImovelReservasBeds24Acao: m.ligar,
  desligarImovelReservasBeds24Acao: m.desligar,
  conferirEscoposReservasBeds24Acao: m.escopos,
  criarEnsaioReservasBeds24Acao: m.criarEnsaio,
  cancelarEnsaioReservasBeds24Acao: m.cancelarEnsaio,
  conferirEnsaioReservasBeds24Acao: m.conferirEnsaio,
}));
import { avaliarEscoposBeds24, ESCOPOS_OBRIGATORIOS_BEDS24 } from "@/beds24/reservas-site-regras";
import { AcaoReservasBeds24, ConferirEscoposBeds24, CriarEnsaioBeds24 } from "./AcaoReservasBeds24";

let confirmar: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetAllMocks();
  confirmar = vi.spyOn(window, "confirm");
  m.pausar.mockResolvedValue({ ok: true, mensagem: "Pausado: nenhuma reserva do site é escrita no Beds24 até você retomar. O calendário e os preços não param com esta pausa." });
  m.ligar.mockResolvedValue({ ok: false, mensagem: "Faça o ensaio com a credencial atual antes de ligar um imóvel." });
});
afterEach(() => {
  cleanup();
  confirmar.mockRestore();
});

it("pausar pede confirmação: sem o sim, nada vai ao servidor; com o sim, a resposta aparece", async () => {
  render(<AcaoReservasBeds24 acao="pausar" rotulo="Pausar as reservas do site" pergunta="Pausar o envio?" />);
  confirmar.mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "Pausar as reservas do site" }));
  expect(confirmar).toHaveBeenCalledWith("Pausar o envio?");
  expect(m.pausar).not.toHaveBeenCalled();
  confirmar.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Pausar as reservas do site" }));
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

it("M8.3c: Criar o ensaio pergunta com o imóvel e as datas escolhidos; sem o sim, nada vai ao servidor; desabilitado, nem pergunta", async () => {
  m.criarEnsaio.mockResolvedValue({ ok: false, mensagem: "Há um ensaio criado e não resolvido: cancele ou confira esse ensaio antes de criar outro." });
  const { container, unmount } = render(<CriarEnsaioBeds24 imoveis={[{ id: "im-1", codigo: "103" }, { id: "im-2", codigo: "204" }]} hoje="2026-10-17" />);
  fireEvent.change(screen.getByLabelText("Imóvel"), { target: { value: "im-1" } });
  fireEvent.change(container.querySelector('input[name="chegada"]')!, { target: { value: "2026-11-03" } });
  fireEvent.change(container.querySelector('input[name="saida"]')!, { target: { value: "2026-11-04" } });
  confirmar.mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "Criar o ensaio" }));
  expect(confirmar).toHaveBeenCalledWith(expect.stringContaining("Criar o ensaio no imóvel 103, de 03/11/2026 a 04/11/2026?"));
  expect(m.criarEnsaio).not.toHaveBeenCalled();
  confirmar.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Criar o ensaio" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Há um ensaio criado e não resolvido"));
  const enviado = m.criarEnsaio.mock.calls[0][1] as FormData;
  expect([enviado.get("imovelId"), enviado.get("chegada"), enviado.get("saida")]).toEqual(["im-1", "2026-11-03", "2026-11-04"]);
  unmount();
  confirmar.mockClear();
  render(<CriarEnsaioBeds24 imoveis={[{ id: "im-1", codigo: "103" }]} hoje="2026-10-17" desabilitado />);
  expect((screen.getByRole("button", { name: "Criar o ensaio" }) as HTMLButtonElement).disabled).toBe(true);
});

it("M8.3c: Cancelar e Conferir o ensaio mandam o id da operação e mostram a resposta", async () => {
  m.cancelarEnsaio.mockResolvedValue({ ok: true, mensagem: "Ensaio conferido e cancelado: agora dá para ligar um imóvel." });
  m.conferirEnsaio.mockResolvedValue({ ok: false, mensagem: "A reserva de teste está no Beds24 e não foi cancelada." });
  confirmar.mockReturnValue(true);
  const { unmount } = render(<AcaoReservasBeds24 acao="cancelar_ensaio" operacaoId="op-1" rotulo="Cancelar o ensaio" pergunta="Cancelar o ensaio?" />);
  fireEvent.click(screen.getByRole("button", { name: "Cancelar o ensaio" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("agora dá para ligar"));
  expect((m.cancelarEnsaio.mock.calls[0][1] as FormData).get("operacaoId")).toBe("op-1");
  unmount();
  render(<AcaoReservasBeds24 acao="conferir_ensaio" operacaoId="op-1" rotulo="Conferir o ensaio" pergunta="Conferir o ensaio?" />);
  fireEvent.click(screen.getByRole("button", { name: "Conferir o ensaio" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("não foi cancelada"));
  expect((m.conferirEnsaio.mock.calls[0][1] as FormData).get("operacaoId")).toBe("op-1");
});
