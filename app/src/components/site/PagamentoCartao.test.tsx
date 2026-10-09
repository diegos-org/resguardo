// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AceiteNaPagina } from "@/site/aceites";
import { MENSAGEM_ACEITE_PENDENTE_CARTAO, MENSAGEM_CARTAO_INCERTO, MENSAGEM_FORMULARIO_FALHOU, MENSAGEM_SO_CREDITO } from "@/site/mensagens-cartao";
import { DesafioCartao, origemDoDesafio } from "./DesafioCartao";
import { formularioDoCartao, PagamentoCartao } from "./PagamentoCartao";
import type { ConfiguracaoCartao } from "./sdk-mercadopago";

const m = vi.hoisted(() => ({ refresh: vi.fn(), carregar: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
// O SDK de verdade nunca carrega nos testes: um construtor falso guarda o que o formulário receberia.
vi.mock("./sdk-mercadopago", async (orig) => ({ ...(await orig<typeof import("./sdk-mercadopago")>()), carregarSdkMercadoPago: m.carregar }));

type Criado = { tipo: string; container: string; config: ConfiguracaoCartao; controle: { unmount: ReturnType<typeof vi.fn> } };
let criados: Criado[] = [];
let instancias: { chave: string; opcoes: { locale: string } }[] = [];
class MercadoPagoFalso {
  constructor(chave: string, opcoes: { locale: string }) {
    instancias.push({ chave, opcoes });
  }
  bricks() {
    return {
      create: async (tipo: string, container: string, config: ConfiguracaoCartao) => {
        const controle = { unmount: vi.fn() };
        criados.push({ tipo, container, config, controle });
        return controle;
      },
    };
  }
}

const versoes = { termos: 2, privacidade: 1, cancelamento: 3 };
const pendente: AceiteNaPagina = { versoes, aceito: null, resumo: [{ tipo: "paragrafo", texto: "RESUMO" }], prazo: { tipo: "integral_ate", data: "2026-09-28" } };
const aceito: AceiteNaPagina = { ...pendente, aceito: { em: "2026-10-01T15:02:00.000Z", versoes } };
const acao = vi.fn();
const bloqueio = { travar: vi.fn(), destravar: vi.fn() };
const props = { codigo: "COT-ABCDEFGH", chavePublica: "TEST-chave-publica-ficticia", valor: 182400, parcelasMaximas: null as number | null, emailTeste: "test@testuser.com", fuso: "America/Sao_Paulo", acao, bloqueio };
const mostrar = (over: Partial<Parameters<typeof PagamentoCartao>[0]> = {}) => render(<PagamentoCartao {...props} aceite={aceito} {...over} />);
const esperarFormulario = (n = 1) => waitFor(() => expect(criados).toHaveLength(n));
const ultimo = () => criados[criados.length - 1];
const DADOS = { token: "tokFicticio0123456789abcdef0123456", payment_method_id: "master", installments: 3, issuer_id: "24", transaction_amount: 1824, payer: { email: "test@testuser.com", identification: { type: "CPF", number: "12345678909" } } };
const ADICIONAIS = { paymentTypeId: "credit_card", bin: "548083", lastFourDigits: "3311", cardholderName: "APRO" };

beforeEach(() => {
  vi.resetAllMocks();
  criados = [];
  instancias = [];
  m.carregar.mockResolvedValue(MercadoPagoFalso);
  (window as unknown as { MP_DEVICE_SESSION_ID?: string }).MP_DEVICE_SESSION_ID = "dispositivo-ficticio-0001";
});
afterEach(() => {
  cleanup();
  delete (window as unknown as { MP_DEVICE_SESSION_ID?: string }).MP_DEVICE_SESSION_ID;
});

describe("formulário do cartão (M8.2b)", () => {
  it("com o aceite pendente, só a caixa; o SDK do Mercado Pago só carrega depois de marcada", async () => {
    const { container } = mostrar({ aceite: pendente });
    expect(screen.getByRole("group", { name: "Antes de pagar" })).toBeTruthy();
    expect(container.textContent).toContain("Marque a caixa acima para abrir o formulário do cartão.");
    await act(async () => {});
    expect(m.carregar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    await esperarFormulario();
    expect(m.carregar).toHaveBeenCalledTimes(1);
    // Desmarcar não apaga o que foi digitado: o formulário fica (o envio é que recusa).
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => {});
    expect(criados).toHaveLength(1);
    expect(ultimo().controle.unmount).not.toHaveBeenCalled();
  });

  it("configuração: valor da cotação em reais, e-mail de teste, só crédito, parcelas do painel só quando há limite, a marca do Mercado Pago visível", async () => {
    const { container } = mostrar();
    await esperarFormulario();
    expect(instancias).toEqual([{ chave: "TEST-chave-publica-ficticia", opcoes: { locale: "pt-BR" } }]);
    const c = ultimo();
    expect(c.tipo).toBe("cardPayment");
    expect(c.container).toBe("cartao-COT-ABCDEFGH");
    expect(container.querySelector("#cartao-COT-ABCDEFGH")).toBeTruthy();
    expect(c.config.initialization).toEqual({ amount: 1824, payer: { email: "test@testuser.com" } });
    expect(c.config.customization).toEqual({ paymentMethods: { minInstallments: 1, types: { excluded: ["debit_card", "prepaid_card"] } } });
    // Nada esconde o título e as bandeiras do formulário do Mercado Pago.
    expect(JSON.stringify(c.config)).not.toContain("hideFormTitle");
    expect(container.textContent).toContain("Pagamento processado pelo Mercado Pago");
    expect(screen.getByText(/Você aceitou os/)).toBeTruthy();
    cleanup();
    criados = [];
    mostrar({ parcelasMaximas: 6, emailTeste: null });
    await esperarFormulario();
    expect(ultimo().config.customization.paymentMethods).toEqual({ minInstallments: 1, maxInstallments: 6, types: { excluded: ["debit_card", "prepaid_card"] } });
    expect(ultimo().config.initialization).toEqual({ amount: 1824 });
  });

  it("envio: só token, bandeira, tipo, parcelas, documento, aparelho e o aceite com as versões da página — nunca BIN, últimos dígitos, titular, e-mail ou valor", async () => {
    acao.mockResolvedValue({ ok: true, situacao: "aprovado" });
    mostrar({ aceite: pendente });
    fireEvent.click(screen.getByRole("checkbox"));
    await esperarFormulario();
    await act(() => ultimo().config.callbacks.onSubmit(DADOS, ADICIONAIS));
    expect(acao).toHaveBeenCalledTimes(1);
    const f = acao.mock.calls[0][0] as FormData;
    expect(Object.fromEntries(f.entries())).toEqual({
      token: DADOS.token,
      bandeira: "master",
      tipo: "credit_card",
      parcelas: "3",
      documentoTipo: "CPF",
      documentoNumero: "12345678909",
      dispositivo: "dispositivo-ficticio-0001",
      aceite: "sim",
      versaoTermos: "2",
      versaoPrivacidade: "1",
      versaoCancelamento: "3",
    });
    expect(m.refresh).toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("caixa desmarcada no envio: recusa sem chamar o servidor e pede o aceite", async () => {
    mostrar({ aceite: pendente });
    fireEvent.click(screen.getByRole("checkbox"));
    await esperarFormulario();
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => {
      await expect(ultimo().config.callbacks.onSubmit(DADOS, ADICIONAIS)).rejects.toThrow();
    });
    expect(acao).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(MENSAGEM_ACEITE_PENDENTE_CARTAO);
  });

  it("as versões mudaram durante o pagamento (o servidor recusa e a página volta com as novas): a caixa recomeça desmarcada e o formulário fecha; o aceite das novas só vai depois de marcar de novo", async () => {
    const MUDOU = "Os termos ou as políticas do site mudaram enquanto a página estava aberta. Leia a versão atual e marque de novo.";
    acao.mockResolvedValue({ erro: MUDOU });
    const { container, rerender } = mostrar({ aceite: pendente });
    fireEvent.click(screen.getByRole("checkbox"));
    await esperarFormulario();
    await act(async () => {
      await expect(ultimo().config.callbacks.onSubmit(DADOS, ADICIONAIS)).rejects.toThrow();
    });
    const novas = { ...versoes, privacidade: 2 };
    rerender(<PagamentoCartao {...props} aceite={{ ...pendente, versoes: novas }} />);
    await act(async () => {});
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(container.querySelector('a[href="/privacidade?versao=2"]')).toBeTruthy();
    expect(container.textContent).toContain("Marque a caixa acima para abrir o formulário do cartão.");
    expect(criados.every((x) => x.controle.unmount.mock.calls.length > 0)).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe(MUDOU);
    // Um envio que ainda chegue do formulário antigo não leva aceite nenhum: pede para marcar.
    await act(async () => {
      await expect(ultimo().config.callbacks.onSubmit(DADOS, ADICIONAIS)).rejects.toThrow();
    });
    expect(acao).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toBe(MENSAGEM_ACEITE_PENDENTE_CARTAO);
    // Marcada de novo: formulário novo, e o envio leva o aceite das versões novas.
    acao.mockResolvedValue({ ok: true, situacao: "aprovado" });
    const n = criados.length;
    fireEvent.click(screen.getByRole("checkbox"));
    await esperarFormulario(n + 1);
    await act(() => ultimo().config.callbacks.onSubmit(DADOS, ADICIONAIS));
    expect(Object.fromEntries((acao.mock.calls[1][0] as FormData).entries())).toMatchObject({ aceite: "sim", versaoTermos: "2", versaoPrivacidade: "2", versaoCancelamento: "3" });
  });

  it("aceite gravado numa recusa e depois uma versão nova publicada: a caixa nova vem desmarcada, o formulário fecha e o envio não leva aceite sem marcar", async () => {
    acao.mockResolvedValue({ erro: "MENSAGEM GENERICA" });
    const { container, rerender } = mostrar({ aceite: pendente });
    fireEvent.click(screen.getByRole("checkbox"));
    await esperarFormulario();
    await act(async () => {
      await expect(ultimo().config.callbacks.onSubmit(DADOS, ADICIONAIS)).rejects.toThrow();
    });
    // O aceite da versão 1 ficou gravado (a fase 1 grava antes do Mercado Pago): a página mostra o aceite feito.
    rerender(<PagamentoCartao {...props} aceite={aceito} />);
    await act(async () => {});
    expect(screen.getByText(/Você aceitou os/)).toBeTruthy();
    // O Diego publica a versão 2 da Política de privacidade: o aceite volta a ficar pendente.
    rerender(<PagamentoCartao {...props} aceite={{ ...pendente, versoes: { ...versoes, privacidade: 2 } }} />);
    await act(async () => {});
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(container.textContent).toContain("Marque a caixa acima para abrir o formulário do cartão.");
    expect(criados.every((x) => x.controle.unmount.mock.calls.length > 0)).toBe(true);
    await act(async () => {
      await expect(ultimo().config.callbacks.onSubmit(DADOS, ADICIONAIS)).rejects.toThrow();
    });
    expect(acao).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toBe(MENSAGEM_ACEITE_PENDENTE_CARTAO);
  });

  it("recusa: a mensagem do servidor e um formulário novo (o token não serve de novo); quando o servidor pede, a página recarrega antes", async () => {
    acao.mockResolvedValue({ erro: "MENSAGEM GENERICA" });
    mostrar();
    await esperarFormulario();
    const primeiro = ultimo();
    await act(async () => {
      await expect(primeiro.config.callbacks.onSubmit(DADOS, ADICIONAIS)).rejects.toThrow();
    });
    expect(screen.getByRole("alert").textContent).toBe("MENSAGEM GENERICA");
    await esperarFormulario(2);
    expect(primeiro.controle.unmount).toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
    acao.mockResolvedValue({ erro: "PARCELAS", recarregar: true });
    await act(async () => {
      await expect(ultimo().config.callbacks.onSubmit(DADOS, ADICIONAIS)).rejects.toThrow();
    });
    expect(m.refresh).toHaveBeenCalledTimes(1);
    await esperarFormulario(3);
    // Sem resposta do servidor: nunca "tente de novo" (pode ter cobrado); a página confere.
    acao.mockRejectedValue(new TypeError("rede"));
    await act(async () => {
      await expect(ultimo().config.callbacks.onSubmit(DADOS, ADICIONAIS)).rejects.toThrow();
    });
    expect(screen.getByRole("alert").textContent).toBe(MENSAGEM_CARTAO_INCERTO);
    expect(m.refresh).toHaveBeenCalledTimes(2);
  });

  it("erros do formulário: crítico desmonta e oferece o Pix; débito ou pré-pago = só crédito; campos incompletos = nada (o próprio formulário mostra); o registro leva só a causa", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const irParaPix = vi.fn();
    mostrar({ oferecerPix: irParaPix });
    await esperarFormulario();
    act(() => ultimo().config.callbacks.onError({ type: "non_critical", cause: "incomplete_fields", message: "MENSAGEM DO SDK 5480 8328" }));
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => ultimo().config.callbacks.onError({ type: "non_critical", cause: "payment_method_not_in_allowed_types", message: "MENSAGEM DO SDK" }));
    expect(screen.getByRole("alert").textContent).toBe(MENSAGEM_SO_CREDITO);
    const controle = ultimo().controle;
    act(() => ultimo().config.callbacks.onError({ type: "critical", cause: "fields_setup_failed", message: "MENSAGEM DO SDK" }));
    await waitFor(() => expect(controle.unmount).toHaveBeenCalled());
    expect(screen.getAllByRole("alert")[0].textContent).toContain(MENSAGEM_FORMULARIO_FALHOU);
    fireEvent.click(screen.getByRole("button", { name: "Pagar com Pix" }));
    expect(irParaPix).toHaveBeenCalled();
    expect(aviso.mock.calls.map((c) => c[1])).toEqual(["incomplete_fields", "payment_method_not_in_allowed_types", "fields_setup_failed"]);
    expect(JSON.stringify(aviso.mock.calls)).not.toContain("MENSAGEM DO SDK");
    act(() => {});
    aviso.mockRestore();
  });

  it("SDK que não carrega (rede, bloqueador): a mesma mensagem de falha", async () => {
    m.carregar.mockRejectedValue(new Error("sdk_indisponivel"));
    mostrar();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(MENSAGEM_FORMULARIO_FALHOU));
    expect(criados).toEqual([]);
  });

  it("a página renderiza de novo com os mesmos valores (outro objeto de aceite, outra ação): o formulário não é recriado; trava a recarga ao abrir e destrava ao fechar", async () => {
    const { rerender, unmount } = mostrar();
    await esperarFormulario();
    expect(bloqueio.travar).toHaveBeenCalledTimes(1);
    rerender(<PagamentoCartao {...props} aceite={{ ...aceito, aceito: { ...aceito.aceito! } }} acao={vi.fn()} bloqueio={{ travar: vi.fn(), destravar: vi.fn() }} />);
    await act(async () => {});
    expect(criados).toHaveLength(1);
    expect(ultimo().controle.unmount).not.toHaveBeenCalled();
    // Valor diferente (a cotação mudou): formulário novo.
    rerender(<PagamentoCartao {...props} valor={190000} aceite={aceito} />);
    await esperarFormulario(2);
    expect(ultimo().config.initialization.amount).toBe(1900);
    unmount();
    expect(bloqueio.destravar).toHaveBeenCalled();
    expect(ultimo().controle.unmount).toHaveBeenCalled();
  });

  it("formularioDoCartao: campos estranhos ou ausentes viram vazio (o servidor recusa); sem aceite pendente, nada do aceite", () => {
    const f = formularioDoCartao({ token: 123, payment_method_id: null, installments: 1.5, payer: { identification: { type: "CPF" } } }, undefined, { dispositivo: 42, aceite: null });
    expect(Object.fromEntries(f.entries())).toEqual({ token: "", bandeira: "", tipo: "", parcelas: "" });
  });
});

describe("desafio do banco (M8.2b)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => vi.stubGlobal("fetch", fetchMock));
  afterEach(() => vi.unstubAllGlobals());
  const mensagem = (origin: string, data: unknown) => act(() => window.dispatchEvent(new MessageEvent("message", { origin, data })));

  it("só aceita aviso de página do Mercado Pago (https e domínio da lista)", () => {
    expect(origemDoDesafio("https://www.mercadopago.com.br")).toBe(true);
    expect(origemDoDesafio("https://mercadolivre.com.br")).toBe(true);
    for (const ruim of ["http://www.mercadopago.com.br", "https://mercadopago.com.br.golpe.example", "https://golpe-mercadopago.com.br", "null", ""]) expect(origemDoDesafio(ruim)).toBe(false);
  });

  it("quadro do banco com o endereço conferido; o aviso de outra origem é ignorado; o do Mercado Pago faz a página conferir na hora pela rota", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ estado: "confirmada" }), { status: 200 }));
    const pix = vi.fn();
    const cartao = vi.fn();
    render(<DesafioCartao codigo="COT-ABCDEFGH" desafioUrl="https://www.mercadopago.com.br/checkout/v1/3ds/FALSO1" aoPagarComPix={pix} aoUsarOutroCartao={cartao} />);
    const quadro = screen.getByTitle("Verificação do seu banco") as HTMLIFrameElement;
    expect(quadro.getAttribute("src")).toBe("https://www.mercadopago.com.br/checkout/v1/3ds/FALSO1");
    expect(quadro.getAttribute("referrerpolicy")).toBe("no-referrer");
    await mensagem("https://golpe.example", { status: "COMPLETE" });
    await mensagem("https://www.mercadopago.com.br", { status: "OUTRO" });
    expect(fetchMock).not.toHaveBeenCalled();
    await mensagem("https://www.mercadopago.com.br", { status: "COMPLETE" });
    await waitFor(() => expect(m.refresh).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/reservar/COT-ABCDEFGH/pagamento");
    fireEvent.click(screen.getByRole("button", { name: "Pagar com Pix" }));
    fireEvent.click(screen.getByRole("button", { name: "Usar outro cartão" }));
    expect([pix.mock.calls.length, cartao.mock.calls.length]).toEqual([1, 1]);
  });

  it("a rota ainda diz desafio: não recarrega; sem endereço válido, o aviso e nenhum quadro", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ estado: "cartao_desafio" }), { status: 200 }));
    render(<DesafioCartao codigo="COT-ABCDEFGH" desafioUrl="https://www.mercadopago.com.br/checkout/v1/3ds/FALSO1" />);
    await mensagem("https://www.mercadopago.com.br", { status: "COMPLETE" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(m.refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    render(<DesafioCartao codigo="COT-ABCDEFGH" desafioUrl={null} aoPagarComPix={vi.fn()} />);
    expect(screen.getByText(/Não deu para abrir a verificação do banco/)).toBeTruthy();
    expect(screen.queryByTitle("Verificação do seu banco")).toBeNull();
    expect(screen.getByRole("button", { name: "Pagar com Pix" })).toBeTruthy();
  });
});
