// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import type { AceiteNaPagina } from "@/site/aceites";
import type { AlteracaoDoHospede, PagamentoDoHospede } from "@/site/pagamento-vista";
import { AlteracaoNaReserva, TEXTO_DIFERENCA_INDISPONIVEL } from "./AlteracaoNaReserva";
import { INTERVALO_ACOMPANHAMENTO_MS, PagamentoPix } from "./PagamentoPix";

const m = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));

const AGORA = new Date("2026-10-01T15:21:00Z"); // 12:21 em São Paulo
const ID = "44444444-4444-4444-8444-444444444444";
/** O pagamento da diferença de uma alteração segurada (o formato do da cotação). */
const pagamentoDaDiferenca = (over: Partial<PagamentoDoHospede> = {}): PagamentoDoHospede => ({
  estado: "pagar",
  ambienteTeste: true,
  dinheiroSemDesfecho: false,
  holdAte: "2026-10-01T16:20:00.000Z",
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
  ...over,
});
const segurada = (over: Partial<AlteracaoDoHospede> = {}): AlteracaoDoHospede => ({
  id: ID,
  situacao: "segurada",
  rumo: "aumento",
  antes: { checkin: "2026-10-12", checkout: "2026-10-15", hospedes: 4, valor: 182400 },
  depois: { checkin: "2026-10-12", checkout: "2026-10-16", hospedes: 4, valor: 235200 },
  diferenca: 52800,
  valorNovo: 235200,
  holdAte: "2026-10-01T16:20:00.000Z",
  preparadaEm: "2026-10-01T15:20:00.000Z",
  aplicadaEm: null,
  reducao: null,
  devolucao: null,
  pagoSemAlteracao: null,
  pagamento: pagamentoDaDiferenca(),
  politicaVersao: 1,
  entradaDaPolitica: "2026-10-12",
  entradaDosPrazos: "2026-10-12",
  ...over,
});
/** A política da reserva (versão 1, aceita em 01/10) com os Termos novos (versão 2) e a Privacidade (versão 1) em vigor. */
const aceiteD11 = (over: Partial<AceiteNaPagina> = {}): AceiteNaPagina => ({
  versoes: { termos: 2, privacidade: 1, cancelamento: 1 },
  aceito: null,
  resumo: [{ tipo: "paragrafo", texto: "RESUMO DA POLÍTICA 1" }],
  prazo: { tipo: "sem_reembolso", dias: 14 },
  daReserva: { versao: 1, em: "2026-10-01T15:00:00.000Z" },
  ...over,
});
const acoes = { gerarPix: vi.fn(), continuar: vi.fn(), pagarComCartao: vi.fn() };
const mostrar = (a: AlteracaoDoHospede, o: { autorizado?: boolean; aceite?: AceiteNaPagina | null } = {}) =>
  render(
    <AlteracaoNaReserva
      codigo="COT-ABCDEFGH"
      reservaCodigo="SCL-TESTE1"
      alteracao={a}
      textos={TEXTOS_SITE_INICIAIS}
      fuso="America/Sao_Paulo"
      autorizado={o.autorizado ?? true}
      aceite={o.aceite === undefined ? aceiteD11() : o.aceite}
      textosPagamento={{ aguardando: "AGUARDANDO EDITAVEL", semDatas: "SEM DATAS", cartaoAnalise: "ANALISE" }}
      contato={<a href="https://wa.me/55">Falar com a equipe pelo WhatsApp</a>}
      gerarPix={acoes.gerarPix}
      continuar={acoes.continuar}
      pagarComCartao={acoes.pagarComCartao}
    />,
  );

const fetchMock = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ estado: "confirmada" }), { status: 200 }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a alteração na página da reserva (M8.2d)", () => {
  it("segurada com a diferença a pagar: as datas, os valores, o prazo, a frase editável e a política; o Pix da diferença leva a alteração", async () => {
    acoes.gerarPix.mockResolvedValue({ ok: true });
    const { container } = mostrar(segurada());
    const texto = container.textContent ?? "";
    expect(screen.getByRole("region", { name: "Alteração da reserva" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Alteração da sua reserva" })).toBeTruthy();
    expect(texto).toContain("Alteração da reserva SCL-TESTE1: de 12/10–15/10 (3 noites, 4 pessoas) para 12/10–16/10 (4 noites, 4 pessoas).");
    expect(texto).toContain("Valor: de R$ 1.824,00 para R$ 2.352,00 — diferença de R$ 528,00.");
    expect(texto).toContain("Datas seguradas até 13:20 (horário de Brasília).");
    expect(texto).toContain(TEXTOS_SITE_INICIAIS.alteracaoEmAndamento);
    expect(texto).toContain("Versão 1 da Política de cancelamento, aceita no pagamento da reserva; prazos contados da entrada de 12/10.");
    // A caixa do pagamento é a da diferença: o título, o valor e as novas datas; sem o convite da cotação.
    expect(screen.getByRole("region", { name: "Pagamento da diferença" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Pague a diferença com Pix" })).toBeTruthy();
    expect(texto).toContain("Diferença a pagar: R$ 528,00");
    expect(texto).toContain("As novas datas estão seguradas para você até");
    expect(texto).not.toContain(TEXTOS_SITE_INICIAIS.pagamentoConvite);
    expect(texto).not.toMatch(/beds24/i);
    const escondido = container.querySelector('input[type="hidden"][name="alteracao"]') as HTMLInputElement;
    expect(escondido.value).toBe(ID);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Gerar Pix" }));
    await waitFor(() => expect(acoes.gerarPix).toHaveBeenCalledTimes(1));
    const enviado = acoes.gerarPix.mock.calls[0][1] as FormData;
    expect([enviado.get("alteracao"), enviado.get("aceite"), enviado.get("versaoTermos"), enviado.get("versaoPrivacidade"), enviado.get("versaoCancelamento")]).toEqual([ID, "sim", "2", "1", "1"]);
  });

  it("aceite na forma do D11: os Termos e a Privacidade em vigor e a política da reserva (versão e dia do aceite); já aceitos, só a linha do aceite feito", () => {
    const { container } = mostrar(segurada());
    const caixa = screen.getByRole("checkbox") as HTMLInputElement;
    expect(caixa.required).toBe(true);
    expect(caixa.closest("label")?.textContent).toBe("Li e aceito os Termos (versão 2) e li a Privacidade (versão 1). A sua reserva continua na Política de cancelamento versão 1, aceita em 01/10.");
    expect(screen.getByRole("link", { name: "Termos (versão 2)" }).getAttribute("href")).toBe("/termos?versao=2");
    expect(screen.getByRole("link", { name: "Privacidade (versão 1)" }).getAttribute("href")).toBe("/privacidade?versao=1");
    expect(screen.getByRole("link", { name: "Política de cancelamento versão 1" }).getAttribute("href")).toBe("/cancelamento?versao=1");
    expect(container.textContent).toContain("Resumo da Política de cancelamento da sua reserva:");
    expect(container.textContent).toContain("RESUMO DA POLÍTICA 1");
    cleanup();
    const feito = mostrar(segurada(), { aceite: aceiteD11({ aceito: { em: "2026-10-01T15:21:00.000Z", versoes: { termos: 2, privacidade: 1, cancelamento: 1 } } }) });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(feito.container.textContent).toContain("Você aceitou os Termos de uso (versão 2), a Política de cancelamento (versão 1) e leu a Política de privacidade (versão 1) em 01/10 às 12:21.");
  });

  it("o cartão da diferença: o título com as duas formas e, sem o cookie, só 'Continuar o pagamento'", () => {
    const comCartao = segurada({ pagamento: pagamentoDaDiferenca({ podePagarCartao: true, cartao: { chavePublica: "TEST-chave-publica-ficticia", valor: 52800, parcelasMaximas: null, emailTeste: null } }) });
    mostrar(comCartao);
    expect(screen.getByRole("heading", { name: "Pagar a diferença" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Pix \(recomendado\)/ })).toBeTruthy();
    cleanup();
    const { container } = mostrar(comCartao, { autorizado: false });
    expect(screen.getByRole("form", { name: "Continuar o pagamento" })).toBeTruthy();
    expect(container.querySelector('input[name="alteracao"]')).toBeNull();
  });

  it("Pix da diferença aguardando e o pagamento recebido: os textos da diferença; sem a oferta agora, a equipe confirma", () => {
    const pix = { copiaECola: "00020126580014br.gov.bcb.pix0136FALSO-ORDTST0002", imagem: null, link: null, expiraEm: "2026-10-01T15:51:00.000Z" };
    const aguardando = mostrar(segurada({ pagamento: pagamentoDaDiferenca({ estado: "pix_aguardando", pix, podeGerar: false }) }));
    expect(screen.getByRole("heading", { name: "Pix da diferença gerado" })).toBeTruthy();
    expect(aguardando.container.textContent).toContain("Diferença a pagar: R$ 528,00");
    cleanup();
    const recebido = mostrar(segurada({ pagamento: pagamentoDaDiferenca({ estado: "confirmando", podeGerar: false, holdAte: null }) }));
    expect(recebido.container.textContent).toContain("Pagamento da diferença recebido, confirmando a alteração.");
    cleanup();
    const sem = mostrar(segurada({ pagamento: pagamentoDaDiferenca({ estado: "sem_pagamento", podeGerar: false }) }));
    expect(sem.container.textContent).toContain(TEXTO_DIFERENCA_INDISPONIVEL);
    expect(screen.getByRole("link", { name: "Falar com a equipe pelo WhatsApp" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Gerar Pix" })).toBeNull();
  });

  it("segurada sem aumento (redução pela política): a confirmação pela mensagem e a devolução, sem caixa de pagamento", () => {
    const { container } = mostrar(
      segurada({
        rumo: "reducao",
        depois: { checkin: "2026-10-12", checkout: "2026-10-14", hospedes: 4, valor: 121600 },
        diferenca: -60800,
        valorNovo: 121600,
        pagamento: null,
        reducao: { direito: "integral", base: "prazo", integralAte: "2026-11-01" },
      }),
    );
    const texto = container.textContent ?? "";
    expect(texto).toContain("Valor: de R$ 1.824,00 para R$ 1.216,00 — diferença de R$ 608,00.");
    expect(texto).toContain(TEXTOS_SITE_INICIAIS.alteracaoAguardaConfirmacao);
    expect(texto).toContain("Pela política, a diferença de R$ 608,00 é devolvida");
    expect(screen.queryByRole("region", { name: "Pagamento da diferença" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("aplicada com a devolução esperando a liberação (nunca 'pedimos'), a que não pôde valer e a que não vale mais; a política sempre", () => {
    const aplicada = mostrar(
      segurada({
        situacao: "aplicada",
        rumo: "reducao",
        depois: { checkin: "2026-10-12", checkout: "2026-10-14", hospedes: 4, valor: 121600 },
        diferenca: -60800,
        valorNovo: 121600,
        aplicadaEm: "2026-10-01T15:25:00.000Z",
        pagamento: null,
        reducao: { direito: "integral", base: "prazo", integralAte: "2026-11-01" },
        devolucao: { estado: "aguardando_liberacao", valor: 60800, valorConfirmado: null, em: null, previstaEm: "2026-10-20", porFora: false, forma: "pix" },
      }),
    );
    const t = aplicada.container.textContent ?? "";
    expect(screen.getByRole("heading", { name: "Alteração confirmada" })).toBeTruthy();
    expect(t).toContain("Alteração confirmada em 01/10: 12/10–14/10, 4 pessoas, R$ 1.216,00.");
    expect(t).toContain(`Devolução da diferença: R$ 608,00 (previsto para 20/10). ${TEXTOS_SITE_INICIAIS.devolucaoAguardaLiberacao}`);
    expect(t).not.toMatch(/pedimos/i);
    expect(t).toContain("Versão 1 da Política de cancelamento");
    cleanup();
    const naoAplicada = mostrar(segurada({ situacao: "nao_aplicada", pagamento: null, pagoSemAlteracao: { valor: 52800, em: "2026-10-01T15:40:00.000Z" } }));
    expect(screen.getByRole("heading", { name: "A alteração não pôde ser feita" })).toBeTruthy();
    expect(naoAplicada.container.textContent).toContain(`Recebemos o pagamento da diferença (R$ 528,00) em 01/10. ${TEXTOS_SITE_INICIAIS.alteracaoNaoAplicada}`);
    cleanup();
    const naoVale = mostrar(segurada({ situacao: "nao_vale", pagamento: null }));
    expect(screen.getByRole("heading", { name: "Alteração que não vale mais" })).toBeTruthy();
    expect(naoVale.container.textContent).toContain(`A alteração preparada em 01/10 não vale mais. ${TEXTOS_SITE_INICIAIS.alteracaoNaoVale}`);
    expect(naoVale.container.textContent).not.toMatch(/beds24/i);
  });
});

describe("o acompanhamento do pagamento da diferença (M8.2d)", () => {
  const resposta = (alteracao: unknown, estado = "confirmada") => new Response(JSON.stringify({ estado, alteracao }), { status: 200 });
  const pix = { copiaECola: "00020126580014br.gov.bcb.pix0136FALSO-ORDTST0002", imagem: null, link: null, expiraEm: "2026-10-01T15:51:00.000Z" };
  const aguardando = segurada({ pagamento: pagamentoDaDiferenca({ estado: "pix_aguardando", pix, podeGerar: false }) });

  it("lê o pagamento da alteração na rota: igual, segue consultando; aplicada pelo pagamento, recarrega uma vez e para", async () => {
    vi.useFakeTimers({ now: AGORA });
    const igual = { id: ID, situacao: "segurada", pagamento: { estado: "pix_aguardando", podeGerar: false, podePagarCartao: false } };
    fetchMock.mockResolvedValueOnce(resposta(igual)).mockResolvedValueOnce(resposta(igual)).mockResolvedValue(resposta({ id: ID, situacao: "aplicada", pagamento: null }));
    mostrar(aguardando);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/reservar/COT-ABCDEFGH/pagamento");
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ACOMPANHAMENTO_MS));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(m.refresh).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ACOMPANHAMENTO_MS));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(m.refresh).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ACOMPANHAMENTO_MS * 4));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("o dinheiro da diferença chegou (confirmando): recarrega; a caixa da reserva confirmada não consulta por causa da diferença", async () => {
    vi.useFakeTimers({ now: AGORA });
    fetchMock.mockResolvedValue(resposta({ id: ID, situacao: "segurada", pagamento: { estado: "confirmando", podeGerar: false, podePagarCartao: false } }));
    mostrar(aguardando);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(m.refresh).toHaveBeenCalledTimes(1);
    cleanup();
    fetchMock.mockClear();
    // A caixa da cotação (reserva confirmada) com a vista que traz a diferença aguardando: só a caixa da alteração acompanha.
    const confirmada = { ...pagamentoDaDiferenca({ estado: "confirmada", holdAte: null, podeGerar: false, reservaCodigo: "SCL-TESTE1" }), alteracao: aguardando };
    render(<PagamentoPix codigo="COT-ABCDEFGH" pagamento={confirmada} autorizado fuso="America/Sao_Paulo" total={182400} textos={{ convite: "C", aguardando: "A", semDatas: "S", cartaoAnalise: "N" }} contato={null} gerarPix={acoes.gerarPix} continuar={acoes.continuar} />);
    await act(() => vi.advanceTimersByTimeAsync(INTERVALO_ACOMPANHAMENTO_MS * 2));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
