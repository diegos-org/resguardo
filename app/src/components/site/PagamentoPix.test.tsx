// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AceiteNaPagina } from "@/site/aceites";
import type { PagamentoDoHospede } from "@/site/pagamento-vista";
import { ESPERA_DEPOIS_DO_LIMITE_MS, INTERVALO_ACOMPANHAMENTO_MS, PagamentoPix } from "./PagamentoPix";

const m = vi.hoisted(() => ({ refresh: vi.fn(), carregar: vi.fn(), criados: 0, desmontados: 0 }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
// O SDK do Mercado Pago nunca carrega nos testes: um formulário falso conta quantas vezes foi criado e desmontado.
vi.mock("./sdk-mercadopago", async (orig) => ({ ...(await orig<typeof import("./sdk-mercadopago")>()), carregarSdkMercadoPago: m.carregar }));
class MercadoPagoFalso {
  bricks() {
    return {
      create: async () => {
        m.criados++;
        return { unmount: () => void m.desmontados++ };
      },
    };
  }
}

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
  acompanhar: false,
  podePagarCartao: false,
  cartao: null,
  cartaoRestantes: 3,
  desafioUrl: null,
  forma: null,
  recusa: null,
  prazoDasDatas: null,
  cancelamento: null,
  pedidoCancelamentoEm: null,
};
const pix = { copiaECola: "00020126580014br.gov.bcb.pix0136FALSO-ORDTST0001", imagem: "data:image/png;base64,RkFMU08=", link: "https://pagamento.falso.invalid/pix/1", expiraEm: "2026-10-01T15:30:00.000Z" };
const textos = { convite: "CONVITE EDITAVEL", aguardando: "AGUARDANDO EDITAVEL", semDatas: "SEM DATAS EDITAVEL", cartaoAnalise: "ANALISE EDITAVEL" };
const acoes = { gerarPix: vi.fn(), continuar: vi.fn() };

const mostrar = (over: Partial<PagamentoDoHospede> = {}, autorizado = true, contato: React.ReactNode = <a href="https://wa.me/55">Falar com a equipe pelo WhatsApp</a>) =>
  render(<PagamentoPix codigo="COT-ABCDEFGH" pagamento={{ ...base, ...over }} autorizado={autorizado} fuso="America/Sao_Paulo" total={182400} textos={textos} contato={contato} gerarPix={acoes.gerarPix} continuar={acoes.continuar} />);

let visibilidade: DocumentVisibilityState = "visible";
const fetchMock = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  m.carregar.mockResolvedValue(MercadoPagoFalso);
  m.criados = 0;
  m.desmontados = 0;
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
    expect(screen.queryByRole("link", { name: /Abrir o Pix no Mercado Pago/ })).toBeNull();
  });

  it("sem a imagem do QR: o link do Mercado Pago; sem a autorização, nada do Pix (só a situação)", () => {
    mostrar({ estado: "pix_aguardando", pix: { ...pix, imagem: null } });
    expect(screen.queryByRole("img")).toBeNull();
    const mercadoPago = screen.getByRole("link", { name: /^Abrir o Pix no Mercado Pago/ });
    expect(mercadoPago.getAttribute("href")).toBe(pix.link);
    // Abre outra janela (M7.11): o fim do link, só para o leitor de tela, avisa.
    expect(mercadoPago.textContent).toBe("Abrir o Pix no Mercado Pago (abre em nova janela)");
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

  it("Pix esgotado (os 3 gastos) com tentativa que ainda pode virar dinheiro: continua acompanhando até a rota dizer que acabou; sem isso, não consulta", async () => {
    vi.useFakeTimers({ now: AGORA });
    const esgotado = (acompanhar: boolean) => new Response(JSON.stringify({ ...base, estado: "pix_esgotado", pixRestantes: 0, podeGerar: false, acompanhar }), { status: 200 });
    fetchMock.mockResolvedValueOnce(esgotado(true)).mockResolvedValueOnce(esgotado(true)).mockImplementation(async () => esgotado(false));
    mostrar({ estado: "pix_esgotado", pixRestantes: 0, podeGerar: false, acompanhar: true });
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ACOMPANHAMENTO_MS * 2));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // A terceira resposta diz que nada mais pode virar dinheiro: para, sem recarregar (a situação é a mesma).
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ACOMPANHAMENTO_MS * 3));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(m.refresh).not.toHaveBeenCalled();
    cleanup();
    fetchMock.mockClear();
    mostrar({ estado: "pix_esgotado", pixRestantes: 0, podeGerar: false, acompanhar: false });
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ACOMPANHAMENTO_MS * 2));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Pix vencido sem poder gerar outro (travas numa falha passageira): quando a rota volta a oferecer, recarrega uma vez (mesma situação, 'pode gerar' mudou)", async () => {
    vi.useFakeTimers({ now: AGORA });
    const vencido = (podeGerar: boolean) => new Response(JSON.stringify({ ...base, estado: "pix_vencido", pixRestantes: 2, podeGerar }), { status: 200 });
    fetchMock.mockResolvedValueOnce(vencido(false)).mockResolvedValueOnce(vencido(false)).mockImplementation(async () => vencido(true));
    const { container } = mostrar({ estado: "pix_vencido", pixRestantes: 2, podeGerar: false });
    expect(container.textContent).toContain("não está disponível agora");
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ACOMPANHAMENTO_MS));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(m.refresh).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ACOMPANHAMENTO_MS));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(m.refresh).toHaveBeenCalledTimes(1);
    // A mesma resposta de novo (a página ainda não recarregou): não recarrega outra vez.
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ACOMPANHAMENTO_MS * 2));
    expect(m.refresh).toHaveBeenCalledTimes(1);
    // Resposta sem o campo "pode gerar" conta como sem mudança nele.
    cleanup();
    m.refresh.mockClear();
    fetchMock.mockImplementation(async () => resposta("pix_vencido"));
    mostrar({ estado: "pix_vencido", pixRestantes: 2, podeGerar: false });
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ACOMPANHAMENTO_MS * 2));
    expect(m.refresh).not.toHaveBeenCalled();
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

describe("aceite das páginas legais antes do Pix (M7.4)", () => {
  // Versões diferentes entre si, para cada link apontar para a sua.
  const versoes = { termos: 2, privacidade: 1, cancelamento: 3 };
  const pendente: AceiteNaPagina = {
    versoes,
    aceito: null,
    resumo: [
      { tipo: "lista", ordenada: false, inicio: 1, itens: ["Cancelamento até 14 dias antes da data de entrada: devolvemos o valor integral."] },
      { tipo: "paragrafo", texto: "Os detalhes estão na Política de cancelamento." },
    ],
    prazo: { tipo: "integral_ate", data: "2026-09-28" },
  };
  const aceito: AceiteNaPagina = { ...pendente, aceito: { em: "2026-10-01T15:02:00.000Z", versoes } };
  const comAceite = (aceite: AceiteNaPagina | null, over: Partial<PagamentoDoHospede> = {}, autorizado = true) =>
    render(<PagamentoPix codigo="COT-ABCDEFGH" pagamento={{ ...base, ...over }} autorizado={autorizado} fuso="America/Sao_Paulo" total={182400} textos={textos} contato={null} gerarPix={acoes.gerarPix} continuar={acoes.continuar} aceite={aceite} />);
  // As páginas legais abrem em outra janela, com o aviso para o leitor de tela no fim do link (M7.11).
  const link = (nome: string) => {
    const achado = screen.getAllByRole("link").find((a) => a.textContent === `${nome} (abre em nova janela)`);
    if (!achado) throw new Error(`link "${nome}" com o aviso de nova janela não encontrado`);
    return achado;
  };

  it("pagar sem o aceite das versões em vigor: resumo da política, prazo desta reserva, caixa obrigatória com os links das versões e as versões escondidas; o formulário leva tudo", async () => {
    acoes.gerarPix.mockResolvedValue({ ok: true });
    const { container } = comAceite(pendente);
    expect(screen.getByRole("group", { name: "Antes de pagar" })).toBeTruthy();
    expect(screen.getByText("Cancelamento até 14 dias antes da data de entrada: devolvemos o valor integral.")).toBeTruthy();
    expect(container.textContent).toContain("Para esta reserva, o reembolso integral vale para pedidos de cancelamento até 23h59 de 28/09/2026 (horário de Brasília).");
    const caixa = screen.getByRole("checkbox") as HTMLInputElement;
    expect(caixa.required).toBe(true);
    expect(caixa.name).toBe("aceite");
    expect(caixa.value).toBe("sim");
    expect(caixa.closest("label")?.textContent).toBe(
      "Li e aceito os Termos de uso (abre em nova janela) e a Política de cancelamento (abre em nova janela), e li a Política de privacidade (abre em nova janela).",
    );
    for (const [nome, href] of [
      ["Termos de uso", "/termos?versao=2"],
      ["Política de cancelamento", "/cancelamento?versao=3"],
      ["Política de privacidade", "/privacidade?versao=1"],
    ]) {
      expect(link(nome).getAttribute("href")).toBe(href);
      expect(link(nome).getAttribute("target")).toBe("_blank");
    }
    const escondido = (n: string) => (container.querySelector(`input[type="hidden"][name="${n}"]`) as HTMLInputElement | null)?.value;
    expect([escondido("versaoTermos"), escondido("versaoPrivacidade"), escondido("versaoCancelamento")]).toEqual(["2", "1", "3"]);
    expect(screen.queryByText(/Você aceitou/)).toBeNull();
    fireEvent.click(caixa);
    fireEvent.click(screen.getByRole("button", { name: "Gerar Pix" }));
    await waitFor(() => expect(acoes.gerarPix).toHaveBeenCalledTimes(1));
    const enviado = acoes.gerarPix.mock.calls[0][1] as FormData;
    expect([enviado.get("aceite"), enviado.get("versaoTermos"), enviado.get("versaoPrivacidade"), enviado.get("versaoCancelamento")]).toEqual(["sim", "2", "1", "3"]);
  });

  it("reserva já a menos do prazo da entrada: diz que pela política não há devolução; Pix vencido que pode gerar outro também pede o aceite", () => {
    const { container } = comAceite({ ...pendente, prazo: { tipo: "sem_reembolso", dias: 14 } }, { estado: "pix_vencido", pixRestantes: 2 });
    expect(container.textContent).toContain("Esta reserva já está a menos de 14 dias da entrada: pela política, o cancelamento não tem devolução, salvo os casos descritos nela.");
    expect(screen.getByRole("checkbox")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Gerar outro Pix" })).toBeTruthy();
  });

  it("versões em vigor já aceitas: sem a caixa, a linha do aceite (versões com link e quando) e o botão; sem o cookie, nada do aceite", () => {
    const { container } = comAceite(aceito);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(container.querySelector('input[name="versaoTermos"]')).toBeNull();
    expect(container.textContent).toContain(
      "Você aceitou os Termos de uso (versão 2) (abre em nova janela), a Política de cancelamento (versão 3) (abre em nova janela) e leu a Política de privacidade (versão 1) (abre em nova janela) em 01/10 às 12:02.",
    );
    expect(link("Termos de uso (versão 2)").getAttribute("href")).toBe("/termos?versao=2");
    expect(screen.getByRole("button", { name: "Gerar Pix" })).toBeTruthy();
    cleanup();
    comAceite(pendente, {}, false);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Continuar o pagamento" })).toBeTruthy();
  });

  it("reserva confirmada: as versões aceitas no pagamento que confirmou e o prazo do reembolso; sem aceite (pagamento anterior às páginas), nada", () => {
    const { container } = comAceite(aceito, { estado: "confirmada", holdAte: null, reservaCodigo: "SCL-TESTE1" });
    expect(container.textContent).toContain("Você aceitou os Termos de uso (versão 2) (abre em nova janela), a Política de cancelamento (versão 3) (abre em nova janela)");
    expect(container.textContent).toContain("Para esta reserva, o reembolso integral vale para pedidos de cancelamento até 23h59 de 28/09/2026 (horário de Brasília).");
    expect(link("Política de cancelamento (versão 3)").getAttribute("href")).toBe("/cancelamento?versao=3");
    cleanup();
    const sem = comAceite(pendente, { estado: "confirmada", holdAte: null, reservaCodigo: "SCL-TESTE1" });
    expect(sem.container.textContent).not.toContain("Você aceitou");
    expect(sem.container.textContent).not.toContain("reembolso integral");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("Pix e cartão de crédito (M8.2b)", () => {
  const CARTAO = { chavePublica: "TEST-chave-publica-ficticia", valor: 182400, parcelasMaximas: null, emailTeste: "test@testuser.com" };
  const versoes = { termos: 1, privacidade: 1, cancelamento: 1 };
  const pendente: AceiteNaPagina = { versoes, aceito: null, resumo: [{ tipo: "paragrafo", texto: "RESUMO" }], prazo: { tipo: "integral_ate", data: "2026-09-28" } };
  const aceito: AceiteNaPagina = { ...pendente, aceito: { em: "2026-10-01T15:02:00.000Z", versoes } };
  const pagarComCartao = vi.fn();
  const comCartao = (over: Partial<PagamentoDoHospede> = {}, o: { autorizado?: boolean; aceite?: AceiteNaPagina | null; linhaAnalise?: string | null } = {}) =>
    render(
      <PagamentoPix
        codigo="COT-ABCDEFGH"
        pagamento={{ ...base, podePagarCartao: true, cartao: CARTAO, ...over }}
        autorizado={o.autorizado ?? true}
        fuso="America/Sao_Paulo"
        total={182400}
        textos={textos}
        contato={<a href="https://wa.me/55">Falar com a equipe pelo WhatsApp</a>}
        gerarPix={acoes.gerarPix}
        continuar={acoes.continuar}
        pagarComCartao={pagarComCartao}
        aceite={o.aceite === undefined ? aceito : o.aceite}
        linhaAnalise={o.linhaAnalise ?? null}
      />,
    );
  const radio = (nome: RegExp) => screen.getByRole("radio", { name: nome }) as HTMLInputElement;

  it("as duas formas: a escolha com o Pix marcado e em destaque, a nota dos juros junto do cartão; escolher o cartão troca o Gerar Pix pelo formulário", async () => {
    const { container } = comCartao();
    expect(screen.getByRole("heading", { name: "Pagamento" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Pagamento" })).toBeTruthy();
    expect(radio(/Pix \(recomendado\)/).checked).toBe(true);
    expect(radio(/Pix \(recomendado\)/).closest("label")?.className).toContain("formaRecomendada");
    expect(radio(/Cartão de crédito/).closest("label")?.textContent).toContain("No cartão parcelado há juros do Mercado Pago, pagos por você");
    expect(screen.getByRole("button", { name: "Gerar Pix" })).toBeTruthy();
    expect(container.textContent).not.toContain("Pagamento processado pelo Mercado Pago");
    fireEvent.click(radio(/Cartão de crédito/));
    expect(screen.queryByRole("button", { name: "Gerar Pix" })).toBeNull();
    await waitFor(() => expect(m.criados).toBe(1));
    expect(container.textContent).toContain("Pagamento processado pelo Mercado Pago");
    fireEvent.click(radio(/Pix \(recomendado\)/));
    await waitFor(() => expect(m.desmontados).toBe(1));
  });

  it("só uma forma: ela direto (o cartão com a nota dos juros); sem o cookie, 'Continuar o pagamento' e nada do formulário", async () => {
    comCartao({ podeGerar: false });
    expect(screen.getByRole("heading", { name: "Pague com cartão de crédito" })).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText(/No cartão parcelado há juros/)).toBeTruthy();
    await waitFor(() => expect(m.criados).toBe(1));
    cleanup();
    comCartao({ podePagarCartao: false, cartao: null });
    expect(screen.getByRole("heading", { name: "Pague com Pix" })).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    cleanup();
    comCartao({ cartao: null }, { autorizado: false });
    expect(screen.getByRole("button", { name: "Continuar o pagamento" })).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    await act(async () => {});
    expect(m.carregar).toHaveBeenCalledTimes(1);
  });

  it("textos pelas formas disponíveis: Pix esgotado com o cartão, Pix vencido só com o cartão ou com as duas", () => {
    const { container } = comCartao({ estado: "pix_esgotado", podeGerar: false, pixRestantes: 0 });
    expect(container.textContent).toContain("Esta cotação já gerou o máximo de Pix. Você ainda pode pagar com cartão de crédito.");
    expect(container.textContent).toContain("Prefere combinar com a equipe?");
    cleanup();
    comCartao({ estado: "pix_vencido", podeGerar: false, pixRestantes: 2 });
    expect(screen.getByText("O Pix venceu sem pagamento. Você pode pagar com cartão de crédito.")).toBeTruthy();
    cleanup();
    comCartao({ estado: "pix_vencido", pixRestantes: 2 });
    expect(screen.getByText(/Gere outro Pix \(ainda dá para gerar 2\) ou pague com cartão de crédito/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Gerar outro Pix" })).toBeTruthy();
  });

  it("Pix esgotado com páginas legais novas: a caixa do aceite vem no cartão, e o formulário só depois de marcada", async () => {
    comCartao({ estado: "pix_esgotado", podeGerar: false, pixRestantes: 0 }, { aceite: pendente });
    expect(screen.getByRole("group", { name: "Antes de pagar" })).toBeTruthy();
    await act(async () => {});
    expect(m.carregar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(m.criados).toBe(1));
  });

  it("Pix aguardando: 'Prefere pagar com cartão?' troca o QR pelo formulário (o Pix é cancelado ao pagar) e 'Voltar ao Pix' desfaz", async () => {
    comCartao({ estado: "pix_aguardando", pix, podeGerar: false, dinheiroSemDesfecho: true });
    expect(screen.getByRole("img", { name: "QR code do Pix" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Prefere pagar com cartão?" }));
    expect(screen.queryByRole("img", { name: "QR code do Pix" })).toBeNull();
    expect(screen.getByText(/Ao pagar com cartão, o Pix desta cotação é cancelado/)).toBeTruthy();
    await waitFor(() => expect(m.criados).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Voltar ao Pix" }));
    expect(screen.getByRole("img", { name: "QR code do Pix" })).toBeTruthy();
  });

  it("cartão em análise: o texto editável, a linha fixa do prazo e a equipe; nenhuma forma de pagar", () => {
    const { container } = comCartao({ estado: "cartao_em_analise", forma: "cartao", podeGerar: false, podePagarCartao: false, cartao: null }, { linhaAnalise: "As datas estão seguradas até 13:30." });
    expect(container.textContent).toContain("ANALISE EDITAVEL");
    expect(container.textContent).toContain("As datas estão seguradas até 13:30.");
    expect(screen.getByRole("link", { name: "Falar com a equipe pelo WhatsApp" })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("cartão recusado: o mesmo texto para toda recusa (ou o da verificação do banco) e as formas que sobram", () => {
    const { container } = comCartao({ estado: "cartao_recusado", forma: "cartao", recusa: "cartao" });
    expect(container.textContent).toContain("Não foi possível aprovar o pagamento com este cartão. Confira os dados, use outro cartão ou pague com Pix.");
    expect(radio(/Pix \(recomendado\)/).checked).toBe(true);
    cleanup();
    const v = comCartao({ estado: "cartao_recusado", forma: "cartao", recusa: "verificacao", podeGerar: false, podePagarCartao: false, cartao: null });
    expect(v.container.textContent).toContain("A verificação do seu banco não foi concluída. Tente de novo ou pague com Pix.");
    expect(v.container.textContent).toContain("O pagamento pelo site não está disponível agora.");
  });

  it("desafio do banco: o quadro, e 'Pagar com Pix' ou 'Usar outro cartão' trocam o quadro pelo formulário (o desafio é cancelado antes)", async () => {
    vi.stubGlobal("fetch", fetchMock);
    comCartao({ estado: "cartao_desafio", forma: "cartao", dinheiroSemDesfecho: true, desafioUrl: "https://www.mercadopago.com.br/checkout/v1/3ds/FALSO1" });
    expect(screen.getByTitle("Verificação do seu banco")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pagar com Pix" }));
    expect(screen.queryByTitle("Verificação do seu banco")).toBeNull();
    expect(screen.getByRole("button", { name: "Gerar Pix" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Voltar à verificação do banco" }));
    fireEvent.click(screen.getByRole("button", { name: "Usar outro cartão" }));
    await waitFor(() => expect(m.criados).toBe(1));
  });
});

describe("acompanhamento com o cartão (M8.2b)", () => {
  const CARTAO = { chavePublica: "TEST-chave-publica-ficticia", valor: 182400, parcelasMaximas: null, emailTeste: "test@testuser.com" };
  const aceito: AceiteNaPagina = { versoes: { termos: 1, privacidade: 1, cancelamento: 1 }, aceito: { em: "2026-10-01T15:02:00.000Z", versoes: { termos: 1, privacidade: 1, cancelamento: 1 } }, resumo: [], prazo: { tipo: "integral_ate", data: "2026-09-28" } };
  const resposta = (o: Record<string, unknown>) => new Response(JSON.stringify({ ...base, ...o }), { status: 200 });
  const aguardando = (over: Partial<PagamentoDoHospede> = {}) =>
    render(
      <PagamentoPix
        codigo="COT-ABCDEFGH"
        pagamento={{ ...base, estado: "pix_aguardando", pix, podeGerar: false, podePagarCartao: true, cartao: CARTAO, dinheiroSemDesfecho: true, ...over }}
        autorizado
        fuso="America/Sao_Paulo"
        total={182400}
        textos={textos}
        contato={null}
        gerarPix={acoes.gerarPix}
        continuar={acoes.continuar}
        pagarComCartao={vi.fn()}
        aceite={aceito}
      />,
    );

  it("mudou só o 'pode pagar com cartão': recarrega (o formulário fechado); resposta sem o campo conta como sem mudança", async () => {
    vi.useFakeTimers({ now: AGORA });
    const semCampo = new Response(JSON.stringify({ estado: "pix_aguardando", podeGerar: false }), { status: 200 });
    fetchMock.mockResolvedValueOnce(semCampo).mockResolvedValue(resposta({ estado: "pix_aguardando", podeGerar: false, podePagarCartao: false }));
    aguardando();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(m.refresh).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ACOMPANHAMENTO_MS));
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it("com o formulário do cartão aberto, a mudança fica para quando ele fechar; dinheiro recarrega na hora", async () => {
    vi.useFakeTimers({ now: AGORA });
    fetchMock.mockResolvedValue(resposta({ estado: "pix_aguardando", podeGerar: false, podePagarCartao: true }));
    aguardando();
    fireEvent.click(screen.getByRole("button", { name: "Prefere pagar com cartão?" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(m.criados).toBe(1);
    fetchMock.mockResolvedValue(resposta({ estado: "pix_vencido", podeGerar: true, podePagarCartao: true }));
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ACOMPANHAMENTO_MS));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(m.refresh).not.toHaveBeenCalled();
    // Fechou o formulário: a recarga guardada acontece.
    fireEvent.click(screen.getByRole("button", { name: "Voltar ao Pix" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(m.refresh).toHaveBeenCalledTimes(1);
    cleanup();
    m.refresh.mockClear();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(resposta({ estado: "pix_aguardando", podeGerar: false, podePagarCartao: true }));
    aguardando();
    fireEvent.click(screen.getByRole("button", { name: "Prefere pagar com cartão?" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    fetchMock.mockResolvedValue(resposta({ estado: "confirmada", reservaCodigo: "SCL-TESTE1" }));
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ACOMPANHAMENTO_MS));
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it("desafio do banco e cartão em análise: a página acompanha sozinha", async () => {
    vi.useFakeTimers({ now: AGORA });
    fetchMock.mockResolvedValue(resposta({ estado: "cartao_em_analise" }));
    aguardando({ estado: "cartao_em_analise", forma: "cartao", pix: null, podePagarCartao: false, cartao: null });
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ACOMPANHAMENTO_MS));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("reserva cancelada pela política e pedido de cancelamento (M8.2c)", () => {
  const frases = {
    cancelamentoSemTaxas: "SEM TAXAS.",
    cancelamentoDevolucaoPedida: "DEVOLUCAO PEDIDA EDITAVEL",
    cancelamentoEstornoNoCartao: "ESTORNO NO CARTAO EDITAVEL",
    cancelamentoVoltaPix: "VOLTA PIX EDITAVEL",
    cancelamentoVoltaCartao: "VOLTA CARTAO EDITAVEL",
    cancelamentoVoltaPorFora: "VOLTA POR FORA EDITAVEL",
    cancelamentoComAEquipe: "COM A EQUIPE EDITAVEL",
    cancelamentoEmConferencia: "EM CONFERENCIA EDITAVEL",
    cancelamentoDevolvidoPelaDisputa: "DEVOLVIDO PELA DISPUTA EDITAVEL",
    cancelamentoSemDevolucaoPrazo: "SEM DEVOLUCAO PRAZO EDITAVEL",
    cancelamentoSemDevolucaoNaoComparecimento: "NAO COMPARECIMENTO EDITAVEL",
    cancelamentoSemDevolucaoEquipe: "SEM DEVOLUCAO EQUIPE EDITAVEL",
    cancelamentoFecho: "FECHO EDITAVEL",
    cancelamentoPedidoRecebido: "PEDIDO RECEBIDO EDITAVEL",
  };
  const cancelamento: NonNullable<PagamentoDoHospede["cancelamento"]> = {
    recebidoEm: "2026-10-10T13:00:00.000Z",
    quemCancela: "hospede",
    direito: "integral",
    base: "prazo",
    motivoEmpresa: null,
    valor: 182400,
    valorConfirmado: null,
    devolucaoEm: null,
    porFora: false,
    algumaPorFora: false,
    confirmadaPor: null,
    forma: "pix",
    estornoPelaEquipe: false,
    integralAte: "2026-10-26",
    arrependimentoAte: "2026-10-08",
    entradaEm: "2026-11-09T18:00:00.000Z",
    politicaVersao: 1,
  };
  const ver = (over: Partial<PagamentoDoHospede>) =>
    render(
      <PagamentoPix
        codigo="COT-ABCDEFGH"
        pagamento={{ ...base, holdAte: null, podeGerar: false, reservaCodigo: "SCL-TESTE1", ...over }}
        autorizado
        fuso="America/Sao_Paulo"
        total={182400}
        textos={{ ...textos, cancelamento: frases }}
        contato={<a href="https://wa.me/55">Falar com a equipe pelo WhatsApp</a>}
        gerarPix={acoes.gerarPix}
        continuar={acoes.continuar}
      />,
    );

  it("devolução pedida: o cabeçalho com o horário do pedido, a decisão com o valor, as frases editáveis e a equipe; nunca uma forma de pagar", () => {
    const { container } = ver({ estado: "cancelada_devolucao_pedida", cancelamento });
    expect(screen.getByText("Reserva SCL-TESTE1 cancelada. Recebemos o seu pedido em 10/10 às 10:00 (horário de Brasília).")).toBeTruthy();
    expect(container.textContent).toContain("Pela Política de cancelamento que você aceitou (versão 1), devolvemos o valor integral pago, R$ 1.824,00, SEM TAXAS.");
    expect(container.textContent).toContain("DEVOLUCAO PEDIDA EDITAVEL");
    expect(container.textContent).toContain("VOLTA PIX EDITAVEL");
    expect(container.textContent).toContain("FECHO EDITAVEL");
    expect(screen.getByRole("link", { name: "Falar com a equipe pelo WhatsApp" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Gerar/ })).toBeNull();
    expect(container.textContent).not.toMatch(/Beds24/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("as outras quatro: devolvida (por fora, sem a linha do meio de pagamento), com a equipe, em conferência e sem devolução (os prazos)", () => {
    let r = ver({ estado: "cancelada_devolvida", cancelamento: { ...cancelamento, porFora: true, devolucaoEm: "2026-10-12T15:00:00.000Z" } });
    expect(r.container.textContent).toContain("Devolução de R$ 1.824,00 feita em 12/10.");
    expect(r.container.textContent).toContain("VOLTA POR FORA EDITAVEL");
    expect(r.container.textContent).not.toContain("VOLTA PIX EDITAVEL");
    cleanup();
    r = ver({ estado: "cancelada_com_a_equipe", cancelamento });
    expect(r.container.textContent).toContain("A devolução de R$ 1.824,00 pelo Mercado Pago não foi possível. COM A EQUIPE EDITAVEL");
    cleanup();
    r = ver({ estado: "cancelada_em_conferencia", cancelamento });
    expect(r.container.textContent).toContain("EM CONFERENCIA EDITAVEL");
    cleanup();
    r = ver({ estado: "cancelada_sem_devolucao", cancelamento: { ...cancelamento, direito: "nenhum", base: "fora_do_prazo", valor: 0 } });
    expect(r.container.textContent).toContain("Prazo de reembolso integral: pedidos até 26/10, às 23h59. SEM DEVOLUCAO PRAZO EDITAVEL");
    expect(r.container.textContent).not.toContain("R$");
    cleanup();
    r = ver({ estado: "cancelada_sem_devolucao", cancelamento: { ...cancelamento, quemCancela: "nao_comparecimento", direito: "nenhum", base: "nao_comparecimento", valor: 0 } });
    expect(r.container.textContent).toContain("A reserva SCL-TESTE1 foi cancelada por não comparecimento.");
    expect(r.container.textContent).toContain("NAO COMPARECIMENTO EDITAVEL");
  });

  it("pedido recebido, ainda sem decisão: a reserva continua confirmada, com a linha do pedido e o caminho para Minha reserva", () => {
    const { container } = ver({ estado: "confirmada", pedidoCancelamentoEm: "2026-10-10T13:00:00.000Z" });
    expect(screen.getByText("Pagamento aprovado: reserva SCL-TESTE1 confirmada.")).toBeTruthy();
    expect(container.textContent).toContain("Pedido de cancelamento recebido em 10/10 às 10:00 (horário de Brasília). PEDIDO RECEBIDO EDITAVEL");
    expect(container.textContent).toContain("Acompanhe ou peça pelo seu acesso: Minha reserva.");
    expect(screen.getAllByRole("link", { name: "Minha reserva" }).every((l) => l.getAttribute("href") === "/hospede")).toBe(true);
    cleanup();
    // Sem pedido, nada a mais na reserva confirmada.
    expect(ver({ estado: "confirmada" }).container.textContent).not.toContain("Pedido de cancelamento");
  });
});

describe("o pagamento em conferência na página da reserva (M8.2e)", () => {
  const confirmada = { estado: "confirmada" as const, holdAte: null, reservaCodigo: "SCL-TESTE1" };
  const comFrase = { ...textos, emConferencia: "EM CONFERENCIA EDITAVEL" };
  const ver = (over: Partial<PagamentoDoHospede>, t: typeof comFrase | typeof textos) =>
    render(<PagamentoPix codigo="COT-ABCDEFGH" pagamento={{ ...base, ...over }} autorizado fuso="America/Sao_Paulo" total={182400} textos={t} contato={null} gerarPix={acoes.gerarPix} continuar={acoes.continuar} />);

  it("a reserva confirmada com o pagamento em disputa: a frase de Textos do site, sem a palavra disputa", () => {
    const { container } = ver({ ...confirmada, pagamentoEmConferencia: true }, comFrase);
    expect(screen.getByText("Pagamento aprovado: reserva SCL-TESTE1 confirmada.")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toBe("EM CONFERENCIA EDITAVEL");
    expect(container.textContent).not.toMatch(/contesta|chargeback|disputa|Beds24/i);
  });

  it("sem disputa, ou com a frase vazia em Textos do site: a linha não aparece", () => {
    let r = ver({ ...confirmada, pagamentoEmConferencia: false }, comFrase);
    expect(r.container.textContent).not.toContain("EM CONFERENCIA EDITAVEL");
    cleanup();
    r = ver({ ...confirmada, pagamentoEmConferencia: true }, { ...textos, emConferencia: "" });
    expect(r.container.textContent).not.toContain("EM CONFERENCIA EDITAVEL");
    expect(screen.getByText("Pagamento aprovado: reserva SCL-TESTE1 confirmada.")).toBeTruthy();
    cleanup();
    r = ver({ ...confirmada, pagamentoEmConferencia: true }, textos);
    expect(screen.queryByRole("note")).toBeNull();
  });
});
