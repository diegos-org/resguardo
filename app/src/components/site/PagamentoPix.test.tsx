// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PagamentoDoHospede } from "@/site/pagamento-vista";
import { ESPERA_DEPOIS_DO_LIMITE_MS, INTERVALO_ACOMPANHAMENTO_MS, PagamentoPix } from "./PagamentoPix";

const m = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));

const AGORA = new Date("2026-10-01T15:00:00Z"); // 12:00 em São Paulo
const base: PagamentoDoHospede = {
  estado: "pagar",
  ambienteTeste: true,
  dinheiroSemDesfecho: false,
  holdAte: "2026-10-01T15:30:00.000Z",
  pix: null,
  pixRestantes: 3,
  podeGerar: true,
  reservaCodigo: null,
  pagamentoEmDobro: false,
  devolucao: null,
};
const pix = { copiaECola: "00020126580014br.gov.bcb.pix0136FALSO-ORDTST0001", imagem: "data:image/png;base64,RkFMU08=", link: "https://pagamento.falso.invalid/pix/1", expiraEm: "2026-10-01T15:30:00.000Z" };
const textos = { convite: "CONVITE EDITAVEL", aguardando: "AGUARDANDO EDITAVEL", semDatas: "SEM DATAS EDITAVEL" };
const acoes = { gerarPix: vi.fn(), continuar: vi.fn() };

const mostrar = (over: Partial<PagamentoDoHospede> = {}, autorizado = true, contato: React.ReactNode = <a href="https://wa.me/55">Falar com a equipe pelo WhatsApp</a>) =>
  render(<PagamentoPix codigo="COT-ABCDEFGH" pagamento={{ ...base, ...over }} autorizado={autorizado} fuso="America/Sao_Paulo" total={182400} textos={textos} contato={contato} gerarPix={acoes.gerarPix} continuar={acoes.continuar} />);

let visibilidade: DocumentVisibilityState = "visible";
const fetchMock = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  visibilidade = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibilidade });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ estado: base.estado }), { status: 200 }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("o que o hóspede vê em cada situação do pagamento (M8.2a)", () => {
  it("datas seguradas com o Pix oferecido: convite editável, valor, prazo das datas, Gerar Pix e o WhatsApp como opção", async () => {
    acoes.gerarPix.mockResolvedValue({ erro: "Não deu para gerar o Pix agora." });
    mostrar();
    expect(screen.getByRole("heading", { name: "Pague com Pix" })).toBeTruthy();
    expect(screen.getByText("CONVITE EDITAVEL")).toBeTruthy();
    expect(screen.getByText("R$ 1.824,00")).toBeTruthy();
    expect(screen.getByText(/seguradas para você até/).textContent).toContain("12:30");
    expect(screen.getByText("Prefere combinar com a equipe?")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Falar com a equipe pelo WhatsApp" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Gerar Pix" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Não deu para gerar o Pix agora."));
    expect(acoes.gerarPix).toHaveBeenCalledTimes(1);
    // Sem situação de espera, a página não consulta a rota.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sem o cookie do pedido: só a situação e 'Continuar o pagamento' com o e-mail (que fica no navegador depois de um erro)", async () => {
    acoes.continuar.mockResolvedValue({ erro: "Não encontramos um pedido com esse e-mail nesta cotação." });
    mostrar({}, false);
    expect(screen.queryByRole("button", { name: "Gerar Pix" })).toBeNull();
    const email = screen.getByLabelText("E-mail") as HTMLInputElement;
    fireEvent.change(email, { target: { value: "eu@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar o pagamento" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Não encontramos"));
    const enviado = acoes.continuar.mock.calls[0][1] as FormData;
    expect(enviado.get("codigo")).toBe("COT-ABCDEFGH");
    expect(enviado.get("email")).toBe("eu@example.com");
    // O estado anterior não volta ao servidor.
    expect(acoes.continuar.mock.calls[0][0]).toEqual({});
    expect((screen.getByLabelText("E-mail") as HTMLInputElement).value).toBe("eu@example.com");
  });

  it("Pix aguardando com a autorização: copia e cola (antes do QR), botão de copiar, QR, prazo com contagem, 'pode fechar e voltar'", () => {
    vi.useFakeTimers({ now: AGORA, toFake: ["Date"] });
    const { container } = mostrar({ estado: "pix_aguardando", pix, dinheiroSemDesfecho: true });
    expect(screen.getByText("AGUARDANDO EDITAVEL")).toBeTruthy();
    const codigo = screen.getByText(pix.copiaECola);
    const qr = screen.getByRole("img", { name: "QR code do Pix" }) as HTMLImageElement;
    expect(qr.getAttribute("src")).toBe(pix.imagem);
    // Copia e cola primeiro na ordem da página (no celular, é o que vem antes).
    expect(codigo.compareDocumentPosition(qr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copiar o código do Pix" })).toBeTruthy();
    expect(container.textContent).toContain("Este Pix vale até 12:30 (faltam 30:00).");
    expect(screen.getByText(/Pode fechar e voltar por este link: a página confirma sozinha/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Abrir o Pix no Mercado Pago" })).toBeNull();
  });

  it("sem a imagem do QR: o link do Mercado Pago; sem a autorização, nada do Pix (só a situação)", () => {
    mostrar({ estado: "pix_aguardando", pix: { ...pix, imagem: null } });
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("link", { name: "Abrir o Pix no Mercado Pago" }).getAttribute("href")).toBe(pix.link);
    cleanup();
    mostrar({ estado: "pix_aguardando", pix: null }, false);
    expect(screen.queryByText(pix.copiaECola)).toBeNull();
    expect(screen.getByText(/Há um Pix desta cotação aguardando pagamento/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continuar o pagamento" })).toBeTruthy();
  });

  it("Pix vencido com as datas seguradas: gerar outro (quantos restam); esgotado: falar com a equipe", () => {
    mostrar({ estado: "pix_vencido", pixRestantes: 2 });
    expect(screen.getByText(/ainda dá para gerar 2/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Gerar outro Pix" })).toBeTruthy();
    cleanup();
    mostrar({ estado: "pix_vencido", pixRestantes: 2, podeGerar: false });
    expect(screen.queryByRole("button", { name: /Gerar/ })).toBeNull();
    expect(screen.getByText(/não está disponível agora/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Falar com a equipe pelo WhatsApp" })).toBeTruthy();
    cleanup();
    mostrar({ estado: "pix_esgotado", pixRestantes: 0 });
    expect(screen.queryByRole("button", { name: /Gerar/ })).toBeNull();
    expect(screen.getByText(/já gerou o máximo de Pix/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Falar com a equipe pelo WhatsApp" })).toBeTruthy();
  });

  it("conferindo, recebido, confirmado (com o código, Minha reserva e 'guarde este link'), sem as datas e devolução", () => {
    mostrar({ estado: "verificando", holdAte: null, dinheiroSemDesfecho: true });
    expect(screen.getByText(/Estamos conferindo o pagamento/)).toBeTruthy();
    cleanup();
    mostrar({ estado: "confirmando", holdAte: null, dinheiroSemDesfecho: true });
    expect(screen.getByText("Pagamento recebido, confirmando sua reserva.")).toBeTruthy();
    cleanup();
    mostrar({ estado: "confirmada", holdAte: null, reservaCodigo: "SCL-TESTE1" });
    expect(screen.getByText("Pagamento aprovado: reserva SCL-TESTE1 confirmada.")).toBeTruthy();
    expect(screen.getByText(/Guarde este link/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Minha reserva" }).getAttribute("href")).toBe("/hospede");
    expect(screen.queryByText(/mais de um pagamento/)).toBeNull();
    cleanup();
    mostrar({ estado: "confirmada", holdAte: null, reservaCodigo: "SCL-TESTE1", pagamentoEmDobro: true });
    expect(screen.getByText(/mais de um pagamento desta cotação/)).toBeTruthy();
    cleanup();
    mostrar({ estado: "aprovado_sem_datas", holdAte: null, dinheiroSemDesfecho: true });
    expect(screen.getByText("SEM DATAS EDITAVEL")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Falar com a equipe pelo WhatsApp" })).toBeTruthy();
    cleanup();
    mostrar({ estado: "devolucao_pedida", holdAte: null, devolucao: { situacao: "pedida", em: "2026-10-02T15:00:00.000Z" } });
    expect(screen.getByText(/Pedimos a devolução do valor integral ao Mercado Pago em 02\/10\/2026/)).toBeTruthy();
    cleanup();
    mostrar({ estado: "devolvido", holdAte: null, devolucao: { situacao: "feita", em: "2026-10-05T15:00:00.000Z" } });
    expect(screen.getByText("O valor do pagamento foi devolvido em 05/10/2026.")).toBeTruthy();
    cleanup();
    // Sem contato configurado, nada de "Prefere combinar com a equipe?" vazio.
    mostrar({}, true, null);
    expect(screen.queryByText("Prefere combinar com a equipe?")).toBeNull();
    cleanup();
    expect(mostrar({ estado: "sem_pagamento" }).container.textContent).toBe("");
  });
});

describe("a página acompanha sozinha enquanto espera (M8.2a)", () => {
  const resposta = (estado: string, status = 200) => new Response(JSON.stringify({ estado }), { status });

  it("consulta a rota logo ao abrir e a cada 5 s; mudou: recarrega a página uma vez e para na situação final", async () => {
    vi.useFakeTimers({ now: AGORA });
    fetchMock.mockResolvedValueOnce(resposta("pix_aguardando")).mockResolvedValueOnce(resposta("pix_aguardando")).mockResolvedValue(resposta("confirmada"));
    mostrar({ estado: "pix_aguardando", pix });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/reservar/COT-ABCDEFGH/pagamento");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ACOMPANHAMENTO_MS));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(m.refresh).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ACOMPANHAMENTO_MS));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(m.refresh).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ACOMPANHAMENTO_MS * 4));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("pausa com a aba escondida e volta quando ela aparece; 'muitas consultas' espera 1 minuto", async () => {
    vi.useFakeTimers({ now: AGORA });
    fetchMock.mockResolvedValue(resposta("confirmando"));
    mostrar({ estado: "confirmando", holdAte: null });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    visibilidade = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ACOMPANHAMENTO_MS * 3));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValue(resposta("", 429));
    visibilidade = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(ESPERA_DEPOIS_DO_LIMITE_MS - 1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("rede caída não para o acompanhamento; situação final não consulta", async () => {
    vi.useFakeTimers({ now: AGORA });
    fetchMock.mockRejectedValueOnce(new TypeError("rede")).mockResolvedValue(resposta("verificando"));
    mostrar({ estado: "verificando", holdAte: null });
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ACOMPANHAMENTO_MS));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    cleanup();
    fetchMock.mockClear();
    mostrar({ estado: "confirmada", holdAte: null, reservaCodigo: "SCL-TESTE1" });
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ACOMPANHAMENTO_MS * 2));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("o Pix venceu na contagem: a página recarrega uma vez", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-01T15:29:58Z") });
    fetchMock.mockResolvedValue(resposta("pix_aguardando"));
    const { container } = mostrar({ estado: "pix_aguardando", pix });
    expect(container.textContent).toContain("(faltam 0:02)");
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(container.textContent).toContain("venceu");
    expect(m.refresh).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });
});
