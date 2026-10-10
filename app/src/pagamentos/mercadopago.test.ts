import { afterEach, describe, expect, it, vi } from "vitest";
import {
  centavosParaValorApi, ClienteMercadoPagoHttp, cobrancaDaOrder, codigosDeErro, contaDeTesteDoUsuario, dataRfc3339, detalheDaOrder,
  EMAIL_PAGADOR_SANDBOX, falhaDeRede, financeiroDoPagamento, normalizarSituacao, primeiroCodigo, valorApiParaCentavos,
} from "./mercadopago";
import { type Cobranca, type DevolucaoLida, ErroProvedor, type PedidoCartao, type PedidoPix, RECUSA_GENERICA, urlDoDesafio } from "./provedor";

// Tudo fictício. O token tem cara de real para os testes de vazamento.
const TOKEN = "APP_USR-0000000000000000-000000-ficticio0000000000000000000000-000000000";
const EMAIL_HOSPEDE = "hospede.ficticio@example.com";
const AGORA = new Date("2026-10-08T15:00:00.000Z");

type Pedido = { url: URL; metodo: string; headers: Record<string, string>; corpo: unknown; temCorpo: boolean };
type Resposta = Response | Error | ((p: Pedido, init?: RequestInit) => Response | Promise<Response>);

function fetchFalso(...respostas: Resposta[]) {
  const pedidos: Pedido[] = [];
  const impl = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
    const p: Pedido = { url: new URL(String(entrada)), metodo: init?.method ?? "GET", headers, corpo: init?.body ? JSON.parse(String(init.body)) : undefined, temCorpo: init?.body !== undefined };
    pedidos.push(p);
    const r = respostas.shift();
    if (!r) throw new Error("chamada inesperada");
    if (r instanceof Error) throw r;
    return typeof r === "function" ? r(p, init) : r;
  }) as typeof fetch;
  return { impl, pedidos };
}

const json = (status: number, corpo: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json", ...headers } });

const cliente = (f: typeof fetch, o: Partial<ConstructorParameters<typeof ClienteMercadoPagoHttp>[0]> = {}) =>
  new ClienteMercadoPagoHttp({ accessToken: TOKEN, ambiente: "teste", fetchImpl: f, agora: () => AGORA, ...o });

/** Nenhuma mensagem pode carregar token, e-mail, documento ou texto vindo do provedor. */
const semSegredos = (msg: string) => {
  for (const proibido of [TOKEN, "APP_USR", EMAIL_HOSPEDE, "12345678909", "texto-do-provedor"]) expect(msg).not.toContain(proibido);
};

const orderPix = (over: Record<string, unknown> = {}) => ({
  id: "ORDTST01KB00C5QRFKWERZQW5D6THPYQ",
  type: "online",
  processing_mode: "automatic",
  external_reference: "scl-123",
  total_amount: "1234.56",
  status: "action_required",
  status_detail: "waiting_transfer",
  transactions: {
    payments: [{
      id: "PAY01KB00C5QRFKWERZQW5DX6XMMJ",
      amount: "1234.56",
      status: "action_required",
      status_detail: "waiting_transfer",
      payment_method: {
        id: "pix",
        type: "bank_transfer",
        ticket_url: "https://www.mercadopago.com.br/sandbox/payments/1/ticket?caller_id=1&hash=x",
        qr_code: "00020126580014br.gov.bcb.pix0136ficticio",
        qr_code_base64: "iVBORw0KGgoAAAANSUhEUg==",
      },
      date_of_expiration: "2026-10-08T12:45:00.000-03:00",
    }],
  },
  ...over,
});

const orderCartao = (over: Record<string, unknown> = {}, pagamento: Record<string, unknown> = {}) => ({
  id: "ORDTST01KB0JDVXYPD6HPP2HSJDKH8FG",
  external_reference: "scl-456",
  total_amount: "500.00",
  total_paid_amount: "500.00",
  status: "processed",
  status_detail: "accredited",
  transactions: {
    payments: [{
      id: "PAY01KB0JDVXYPD6HPP2HSMJS11QN",
      amount: "500.00",
      paid_amount: "500.00",
      status: "processed",
      status_detail: "accredited",
      payment_method: { id: "master", type: "credit_card", installments: 3 },
      ...pagamento,
    }],
  },
  ...over,
});

const pix = (over: Partial<PedidoPix> = {}): PedidoPix => ({
  referencia: "scl-123",
  chaveIdempotencia: "pix-scl-123-chave",
  valor: 123456,
  email: EMAIL_HOSPEDE,
  nome: "APRO",
  validadeMinutos: 45,
  descricao: "Reserva SCL",
  descricaoFatura: "SUACASALEBLON",
  ...over,
});

const cartao = (over: Partial<PedidoCartao> = {}): PedidoCartao => ({
  referencia: "scl-456",
  chaveIdempotencia: "cartao-scl-456-chave",
  valor: 50000,
  token: "1c87b6b301010101ddcd92f9bbbb3be2",
  bandeira: "master",
  tipo: "credit_card",
  parcelas: 3,
  emissor: "24",
  email: EMAIL_HOSPEDE,
  documento: { tipo: "cpf", numero: "123.456.789-09" },
  sessaoDispositivo: "armor.ficticio.0123456789",
  descricao: "Reserva SCL",
  descricaoFatura: null,
  tresDS: "on_fraud_risk",
  ...over,
});

const cobrancaAprovada = (over: Partial<Cobranca> = {}): Cobranca => ({
  idProvedor: "ORDTST01KB0JDVXYPD6HPP2HSJDKH8FG",
  referencia: "scl-456",
  situacao: "aprovado",
  detalhe: "processed/accredited",
  forma: "cartao",
  valor: 50000,
  valorTransacao: 50000,
  pago: 50000,
  devolvido: 0,
  devolucaoEmAndamento: false,
  devolucoes: [],
  parcelas: 3,
  idTransacao: "PAY01KB0JDVXYPD6HPP2HSMJS11QN",
  aoVivo: null,
  pix: null,
  cartao: { desafioUrl: null, desafio: false, analise: false, tresDSStatus: null, bandeira: "master" },
  ...over,
});

/** Endereço do desafio no formato da documentação (domínio do Mercado Pago Brasil; id e token fictícios). */
const URL_DESAFIO = "https://www.mercadopago.com.br/auth/card/validation/pages/remedies/00000000-0000-0000-0000-000000000000?display_mode=self_hosted&guest_token=ficticio";
const NADA_FINANCEIRO = { taxa: null, liquido: null, liberacaoPrevista: null, liberado: null, idPagamento: null, liberacaoEmParcelas: false, custoParcelasVendedor: null };

async function erroDe(p: Promise<unknown>): Promise<ErroProvedor> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ErroProvedor);
    semSegredos((e as Error).message);
    return e as ErroProvedor;
  }
  throw new Error("era para lançar");
}

afterEach(() => vi.restoreAllMocks());

describe("dinheiro: centavos ↔ texto da API", () => {
  it("centavos viram texto com duas casas, sem ponto flutuante", () => {
    expect(centavosParaValorApi(0)).toBe("0.00");
    expect(centavosParaValorApi(5)).toBe("0.05");
    expect(centavosParaValorApi(99)).toBe("0.99");
    expect(centavosParaValorApi(100)).toBe("1.00");
    expect(centavosParaValorApi(123456)).toBe("1234.56");
    expect(centavosParaValorApi(2450)).toBe("24.50");
    expect(centavosParaValorApi(Number.MAX_SAFE_INTEGER)).toBe("90071992547409.91");
    for (const ruim of [-1, 1.5, Number.NaN, Infinity, 2 ** 53]) expect(() => centavosParaValorApi(ruim)).toThrow(TypeError);
  });

  it("texto ou número da API vira centavos exatos", () => {
    expect(valorApiParaCentavos("50")).toBe(5000);
    expect(valorApiParaCentavos("50.0")).toBe(5000);
    expect(valorApiParaCentavos("50.00")).toBe(5000);
    expect(valorApiParaCentavos("50.000")).toBe(5000);
    expect(valorApiParaCentavos("50.5")).toBe(5050);
    expect(valorApiParaCentavos("0.07")).toBe(7);
    expect(valorApiParaCentavos(" 12.30 ")).toBe(1230);
    expect(valorApiParaCentavos(47.28)).toBe(4728);
    expect(valorApiParaCentavos(0.1 + 0.2)).toBeNull(); // 0.30000000000000004: não arredonda
    expect(valorApiParaCentavos(50)).toBe(5000);
    expect(valorApiParaCentavos("0")).toBe(0);
  });

  it("formatos que não são dinheiro exato → null (nunca palpite)", () => {
    for (const ruim of ["1.005", "-1", "-0.50", "1e3", 1e21, "1,50", "", "  ", null, undefined, Number.NaN, Infinity, "R$ 10", {}, [], true, "9".repeat(20)]) {
      expect(valorApiParaCentavos(ruim)).toBeNull();
    }
  });

  it("data RFC 3339 sem milissegundos", () => {
    expect(dataRfc3339(new Date("2026-10-08T15:00:00.123Z"))).toBe("2026-10-08T15:00:00Z");
  });
});

describe("situação normalizada", () => {
  const pag = (status: string, status_detail: string) => ({ status, status_detail });
  it.each([
    ["processed", "accredited", null, "aprovado"],
    ["processed", "accredited", pag("processed", "accredited"), "aprovado"],
    ["PROCESSED", " accredited ", pag("Processed", "ACCREDITED"), "aprovado"],
    ["processed", "accredited", pag("processing", "in_review"), "desconhecido"],
    ["processed", "accredited", pag("processed", "partially_refunded"), "desconhecido"],
    ["processed", "accredited", {}, "desconhecido"],
    ["processed", "partially_refunded", pag("processed", "partially_refunded"), "devolvido_parcial"],
    ["processed", "refunded", null, "desconhecido"],
    ["processed", "algo_novo", null, "desconhecido"],
    ["created", "created", null, "pendente"],
    ["action_required", "waiting_transfer", pag("action_required", "waiting_transfer"), "pendente"],
    ["action_required", "waiting_payment", null, "pendente"],
    ["action_required", "pending_challenge", pag("action_required", "pending_challenge"), "pendente"],
    ["action_required", "waiting_capture", null, "pendente"],
    ["action_required", "waiting_retry", null, "pendente"],
    ["action_required", "outra_coisa", null, "desconhecido"],
    ["processing", "in_process", null, "em_analise"],
    ["processing", "in_review", pag("processing", "pending_review_manual"), "em_analise"],
    ["in_review", "in_review", pag("in_review", "in_review"), "em_analise"],
    ["failed", "failed", pag("failed", "high_risk"), "recusado"],
    ["failed", "rejected_by_issuer", null, "recusado"],
    ["failed", "cc_rejected_3ds_challenge", null, "recusado"],
    ["failed", "3ds_challenge_expired", null, "recusado"],
    ["canceled", "canceled", null, "cancelado"],
    ["canceled", "canceled_transaction", pag("canceled", "canceled_transaction"), "cancelado"],
    ["canceled", "expired", null, "expirado"],
    ["expired", "expired", null, "expirado"],
    ["refunded", "refunded", null, "devolvido"],
    ["charged_back", "in_process", null, "contestado"],
    ["charged_back", "settled", null, "contestado"],
    ["charged_back", "reimbursed", null, "contestado"],
    // Contestação é por transação (M8.2b): a transação charged_back vence a order processada.
    ["processed", "accredited", pag("charged_back", "in_process"), "contestado"],
    ["processed", "accredited", pag("charged_back", "settled"), "contestado"],
    ["approved", "accredited", null, "desconhecido"],
    ["", "", null, "desconhecido"],
  ])("%s/%s (transação %j) → %s", (status, status_detail, transacao, esperado) => {
    expect(normalizarSituacao({ status, status_detail }, transacao)).toBe(esperado);
  });

  it("status que não são texto → desconhecido", () => {
    expect(normalizarSituacao({ status: 1, status_detail: null })).toBe("desconhecido");
    expect(normalizarSituacao({})).toBe("desconhecido");
  });

  it("detalhe curto, só com códigos", () => {
    expect(detalheDaOrder({ status: "failed", status_detail: "failed" }, { status: "failed", status_detail: "high_risk" })).toBe("failed/failed; pagamento failed/high_risk");
    expect(detalheDaOrder({ status: "processed", status_detail: "accredited" }, { status: "processed", status_detail: "accredited" })).toBe("processed/accredited");
    expect(detalheDaOrder({ status: "processed", status_detail: "<script>alert(1)</script>" })).toBe("processed/?");
  });

  it("contestações da lista (transactions.chargebacks[]): in_process e settled contestam; reimbursed (devolvida à SCL) não", () => {
    const aprovada = { status: "processed", status_detail: "accredited" };
    expect(normalizarSituacao(aprovada, aprovada, ["in_process"])).toBe("contestado");
    expect(normalizarSituacao(aprovada, aprovada, ["reimbursed", "settled"])).toBe("contestado");
    expect(normalizarSituacao(aprovada, aprovada, ["reimbursed"])).toBe("aprovado");
    expect(normalizarSituacao(aprovada, aprovada, [])).toBe("aprovado");
  });

  it("código do motivo: o primeiro válido, com os de token na frente; nada fora do formato", () => {
    expect(primeiroCodigo(["high_risk", "failed"])).toBe("high_risk");
    expect(primeiroCodigo([null, "texto-do-provedor com dados", " Rejected_By_Issuer "])).toBe("rejected_by_issuer");
    expect(primeiroCodigo(new Set(["bad_request", "invalid_card_token"]))).toBe("invalid_card_token");
    expect(primeiroCodigo(["failed", "card_token_not_found"])).toBe("card_token_not_found");
    expect(primeiroCodigo([])).toBeNull();
    expect(primeiroCodigo([`x${"y".repeat(60)}`, 7])).toBeNull();
  });
});

describe("order → Cobranca", () => {
  it("Pix pendente com QR, link, prazo e valor em centavos", () => {
    expect(cobrancaDaOrder(orderPix({ live_mode: false }))).toEqual({
      idProvedor: "ORDTST01KB00C5QRFKWERZQW5D6THPYQ",
      referencia: "scl-123",
      situacao: "pendente",
      detalhe: "action_required/waiting_transfer",
      forma: "pix",
      valor: 123456,
      valorTransacao: 123456,
      pago: null,
      devolvido: 0,
      devolucaoEmAndamento: false,
      devolucoes: [],
      parcelas: null,
      idTransacao: "PAY01KB00C5QRFKWERZQW5DX6XMMJ",
      aoVivo: false,
      pix: {
        copiaECola: "00020126580014br.gov.bcb.pix0136ficticio",
        imagemBase64: "iVBORw0KGgoAAAANSUhEUg==",
        link: "https://www.mercadopago.com.br/sandbox/payments/1/ticket?caller_id=1&hash=x",
        expiraEm: new Date("2026-10-08T15:45:00.000Z"),
      },
      cartao: null,
    });
  });

  it("imagem vazia (sandbox), link não https e meio de pagamento nulo", () => {
    const o = orderPix();
    const pm = (o.transactions.payments[0].payment_method as Record<string, unknown>);
    Object.assign(pm, { id: null, type: null, qr_code_base64: "", ticket_url: "javascript:alert(1)" });
    const c = cobrancaDaOrder(o)!;
    expect(c.forma).toBe("pix"); // deduzido do qr_code
    expect(c.pix).toMatchObject({ imagemBase64: null, link: null });
  });

  it("Pix ainda sem dados (criação assíncrona) → pix null", () => {
    const o = orderPix({ status: "processing", status_detail: "in_process" });
    Object.assign(o.transactions.payments[0].payment_method, { qr_code: null, qr_code_base64: null, ticket_url: null });
    const c = cobrancaDaOrder(o)!;
    expect(c.situacao).toBe("em_analise");
    expect(c.pix).toBeNull();
  });

  it("cartão aprovado com parcelas e valor pago", () => {
    expect(cobrancaDaOrder(orderCartao())).toMatchObject({ situacao: "aprovado", forma: "cartao", valor: 50000, valorTransacao: 50000, pago: 50000, parcelas: 3, pix: null, aoVivo: null, devolvido: 0, devolucaoEmAndamento: false });
    expect(cobrancaDaOrder(orderCartao())!.cartao).toEqual({ desafioUrl: null, desafio: false, analise: false, tresDSStatus: null, bandeira: "master" });
  });

  it("cartão parcelado com juros do hóspede: pago com os juros, valor e transação sem eles", () => {
    expect(cobrancaDaOrder(orderCartao({ total_paid_amount: "537.42" }, { paid_amount: "537.42" }))).toMatchObject({ valor: 50000, valorTransacao: 50000, pago: 53742, parcelas: 3 });
  });

  it("3DS: desafio com o endereço (só de domínio do Mercado Pago), resultado da verificação em maiúsculo e bandeira", () => {
    const comDesafio = (url: unknown, status: unknown = "challenge") => cobrancaDaOrder(orderCartao(
      { status: "action_required", status_detail: "pending_challenge", total_paid_amount: undefined },
      { status: "action_required", status_detail: "pending_challenge", payment_method: { id: "Master", type: "credit_card", installments: 1, transaction_security: { url, validation: "on_fraud_risk", liability_shift: "required", status } } },
    ))!;
    const c = comDesafio(URL_DESAFIO);
    expect(c.situacao).toBe("pendente");
    expect(c.cartao).toEqual({ desafioUrl: URL_DESAFIO, desafio: true, analise: false, tresDSStatus: "CHALLENGE", bandeira: "master" });
    // Endereço fora do Mercado Pago, sem https, com usuário, porta ou grande demais: descartado (nunca vai a um iframe).
    for (const ruim of [
      "http://www.mercadopago.com.br/auth/x", "https://mercadopago.com.br.evil.example/x", "https://evilmercadopago.com.br/x", "https://www.mercadopago.com.ar/auth/x",
      "https://user:senha@www.mercadopago.com.br/x", "https://www.mercadopago.com.br:8443/x", `https://www.mercadopago.com.br/${"a".repeat(2000)}`, "javascript:alert(1)", 42, null,
    ]) {
      expect(comDesafio(ruim).cartao).toMatchObject({ desafio: true, desafioUrl: null });
    }
    // A tabela de testes do 3DS escreve o resultado em minúsculo; fora da lista fechada = null.
    expect(comDesafio(null, "not_authenticated").cartao?.tresDSStatus).toBe("NOT_AUTHENTICATED");
    expect(comDesafio(null, "Attempted").cartao?.tresDSStatus).toBe("ATTEMPTED");
    expect(comDesafio(null, "algo_novo").cartao?.tresDSStatus).toBeNull();
    expect(comDesafio(null, 3).cartao?.tresDSStatus).toBeNull();
  });

  it("análise: in_review (status ou detalhe, da order ou da transação) e pending_review_manual; processing/in_process é só processando", () => {
    const cartao = (order: Record<string, unknown>, transacao: Record<string, unknown>) => cobrancaDaOrder(orderCartao({ total_paid_amount: undefined, ...order }, transacao))!;
    expect(cartao({ status: "processing", status_detail: "in_review" }, { status: "processing", status_detail: "in_review" })).toMatchObject({ situacao: "em_analise", cartao: { analise: true, desafio: false } });
    expect(cartao({ status: "processing", status_detail: "in_process" }, { status: "processing", status_detail: "pending_review_manual" }).cartao?.analise).toBe(true);
    expect(cartao({ status: "in_review", status_detail: "in_review" }, { status: "in_review", status_detail: "in_review" }).cartao?.analise).toBe(true);
    expect(cartao({ status: "processing", status_detail: "in_process" }, { status: "processing", status_detail: "in_process" })).toMatchObject({ situacao: "em_analise", cartao: { analise: false } });
  });

  it("contestação na order (por transação ou na lista): contestado, lendo só o status da lista", () => {
    const naTransacao = orderCartao({}, { status: "charged_back", status_detail: "in_process" });
    expect(cobrancaDaOrder(naTransacao)!.situacao).toBe("contestado");
    const naLista = orderCartao();
    (naLista.transactions as Record<string, unknown>).chargebacks = [{ id: "CBK01FICTICIO", transaction_id: "PAY01KB0JDVXYPD6HPP2HSMJS11QN", case_id: "9876543210", status: "in_process", references: [null] }, null, { status: 5 }];
    const c = cobrancaDaOrder(naLista)!;
    expect(c.situacao).toBe("contestado");
    expect(JSON.stringify(c)).not.toMatch(/9876543210|CBK01FICTICIO/);
    (naLista.transactions as Record<string, unknown>).chargebacks = [{ status: "reimbursed" }];
    expect(cobrancaDaOrder(naLista)!.situacao).toBe("aprovado");
  });

  it("nunca lê BIN, últimos dígitos, titular nem a identificação do pagador", () => {
    const o = orderCartao(
      { payer: { email: EMAIL_HOSPEDE, identification: { type: "CPF", number: "12345678909" } }, config: { payment_method: { installments_cost: "seller" } } },
      { payment_method: { id: "visa", type: "credit_card", installments: 2, first_six_digits: "423564", last_four_digits: "5682", cardholder: { name: "APRO", identification: { number: "12345678909" } } } },
    );
    const c = cobrancaDaOrder(o)!;
    expect(c.cartao?.bandeira).toBe("visa");
    for (const proibido of ["423564", "5682", "APRO", "12345678909", EMAIL_HOSPEDE, "seller"]) expect(JSON.stringify(c)).not.toContain(proibido);
  });

  it("devolvido soma só devoluções confirmadas e legíveis", () => {
    const o = orderCartao({ status: "processed", status_detail: "partially_refunded" });
    (o.transactions as Record<string, unknown>).refunds = [
      { id: "REF1", amount: "100.00", status: "processed" },
      { id: "REF2", amount: "50.50", status: "approved" },
      { id: "REF3", amount: "70.00", status: "in_process" },
      { id: "REF4", amount: "abc", status: "processed" },
      null,
    ];
    o.transactions.payments[0].status_detail = "partially_refunded";
    const c = cobrancaDaOrder(o)!;
    expect(c.situacao).toBe("devolvido_parcial");
    expect(c.devolvido).toBe(15050);
    // A REF3 (in_process) ainda está em andamento.
    expect(c.devolucaoEmAndamento).toBe(true);
    // Só confirmadas e falhas: nada em andamento; sem o valor da transação, null.
    (o.transactions as Record<string, unknown>).refunds = [{ id: "REF1", amount: "100.00", status: "processed" }, { id: "REF5", amount: "10.00", status: "failed" }];
    delete (o.transactions.payments[0] as Record<string, unknown>).amount;
    expect(cobrancaDaOrder(o)).toMatchObject({ devolucaoEmAndamento: false, devolvido: 10000, valorTransacao: null });
  });

  it("devoluções lidas (M8.2c): status por lista branca, ids inválidos fora, só id, estado e valor (nunca e2e_id ou reference_id)", () => {
    const o = orderCartao({ status: "processed", status_detail: "partially_refunded" });
    (o.transactions as Record<string, unknown>).refunds = [
      { id: "REF01A", amount: "100.00", status: "processed", e2e_id: "E00000000202610081500ficticio", reference_id: "ref-ficticia" },
      { id: "REF01B", amount: "50.50", status: "APPROVED" },
      { id: "REF01C", amount: "70.00", status: "in_process" },
      { id: "REF01D", amount: "10.00", status: "failed" },
      { id: "REF01E", amount: "10.00", status: "rejected" },
      { id: "REF01F", amount: "10.00", status: "canceled" },
      { id: "REF01G", amount: "10.00", status: "cancelled" },
      { id: "REF01H", amount: "abc", status: "status_novo" },
      { id: "../../x", amount: "1.00", status: "processed" },
      { id: "PAY01NAOEDEVOLUCAO", amount: "1.00", status: "processed" },
      { amount: "1.00", status: "processed" },
      null,
    ];
    const c = cobrancaDaOrder(o)!;
    expect(c.devolucoes).toEqual([
      { id: "REF01A", estado: "confirmada", valor: 10_000 },
      { id: "REF01B", estado: "confirmada", valor: 5_050 },
      { id: "REF01C", estado: "andamento", valor: 7_000 },
      { id: "REF01D", estado: "falhou", valor: 1_000 },
      { id: "REF01E", estado: "falhou", valor: 1_000 },
      { id: "REF01F", estado: "falhou", valor: 1_000 },
      { id: "REF01G", estado: "falhou", valor: 1_000 },
      { id: "REF01H", estado: "andamento", valor: 0 },
    ]);
    expect(JSON.stringify(c)).not.toMatch(/E00000000202610081500ficticio|ref-ficticia/);
    // No máximo 20; sem a lista, nenhuma (não quer dizer "nenhuma devolução").
    (o.transactions as Record<string, unknown>).refunds = Array.from({ length: 30 }, (_, i) => ({ id: `REF${i}`, amount: "1.00", status: "processed" }));
    expect(cobrancaDaOrder(o)!.devolucoes).toHaveLength(20);
    expect(cobrancaDaOrder(orderPix())!.devolucoes).toEqual([]);
    // processed/refunded (exemplo da resposta de devolução): situação desconhecida, com a devolução confirmada na lista.
    const refunded = orderCartao({ status: "processed", status_detail: "refunded" });
    (refunded.transactions as Record<string, unknown>).refunds = [{ id: "REF01J49MMW3SSBK5PSV3DFR32959", amount: "500.00", status: "processed" }];
    expect(cobrancaDaOrder(refunded)).toMatchObject({ situacao: "desconhecido", devolvido: 50_000, devolucoes: [{ id: "REF01J49MMW3SSBK5PSV3DFR32959", estado: "confirmada", valor: 50_000 }] });
  });

  it("ids com sublinhado (exemplos da documentação) e lista de pagamentos com null", () => {
    const c = cobrancaDaOrder({ id: "01JE797F7RX989RWQJHMY34WJ4", total_amount: "50.00", status: "failed", status_detail: "failed", transactions: { payments: [null, { id: "pay_01JE797F7RX989RWQJHP4VHF94", status: "failed", status_detail: "required_call_for_authorize" }] } })!;
    expect(c.idTransacao).toBe("pay_01JE797F7RX989RWQJHP4VHF94");
    expect(c.situacao).toBe("recusado");
    expect(c.referencia).toBe("");
  });

  it("sem o essencial → null", () => {
    expect(cobrancaDaOrder(null)).toBeNull();
    expect(cobrancaDaOrder([])).toBeNull();
    expect(cobrancaDaOrder(orderPix({ id: "../../v1/payments" }))).toBeNull();
    expect(cobrancaDaOrder(orderPix({ id: undefined }))).toBeNull();
    expect(cobrancaDaOrder(orderPix({ total_amount: "12,00" }))).toBeNull();
    expect(cobrancaDaOrder(orderPix({ total_amount: undefined }))).toBeNull();
  });
});

describe("financeiro da Payments API", () => {
  const pagamento = (over: Record<string, unknown> = {}) => ({
    id: 104669748043,
    external_reference: "scl-456",
    status: "approved",
    transaction_amount: 500,
    transaction_details: { net_received_amount: 480.1, total_paid_amount: 520 },
    fee_details: [
      { type: "mercadopago_fee", amount: 19.9, fee_payer: "collector" },
      { type: "financing_fee", amount: 20, fee_payer: "payer" },
    ],
    money_release_date: "2026-11-07T10:00:00.000-04:00",
    money_release_status: "pending",
    ...over,
  });

  it("taxa só das tarifas da SCL, líquido, previsão e liberação pendente", () => {
    expect(financeiroDoPagamento(pagamento())).toEqual({
      taxa: 1990,
      liquido: 48010,
      liberacaoPrevista: new Date("2026-11-07T14:00:00.000Z"),
      liberado: false,
      idPagamento: "104669748043",
      liberacaoEmParcelas: false,
      // Os juros (financing_fee do comprador) não são custo da SCL.
      custoParcelasVendedor: 0,
    });
  });

  it("parcelamento sem acréscimo: financing_fee da SCL vira custoParcelasVendedor (já dentro da taxa); sem a lista ou ilegível = null", () => {
    const semAcrescimo = pagamento({
      transaction_details: { net_received_amount: 460.1, total_paid_amount: 500 },
      fee_details: [{ type: "mercadopago_fee", amount: 19.9, fee_payer: "collector" }, { type: "financing_fee", amount: "20.00", fee_payer: "collector" }],
    });
    expect(financeiroDoPagamento(semAcrescimo)).toMatchObject({ taxa: 3990, liquido: 46010, custoParcelasVendedor: 2000 });
    // fee_payer ausente numa financing_fee: conta como da SCL (nunca supõe que foi o hóspede).
    expect(financeiroDoPagamento(pagamento({ fee_details: [{ type: "financing_fee", amount: 5 }] })).custoParcelasVendedor).toBe(500);
    expect(financeiroDoPagamento(pagamento({ fee_details: [] })).custoParcelasVendedor).toBe(0);
    expect(financeiroDoPagamento(pagamento({ fee_details: undefined })).custoParcelasVendedor).toBeNull();
    expect(financeiroDoPagamento(pagamento({ fee_details: "x" })).custoParcelasVendedor).toBeNull();
    expect(financeiroDoPagamento(pagamento({ fee_details: [null] })).custoParcelasVendedor).toBeNull();
    expect(financeiroDoPagamento(pagamento({ fee_details: [{ type: "financing_fee", amount: "x", fee_payer: "collector" }] })).custoParcelasVendedor).toBeNull();
  });

  it("liberação em parcelas (money_release_schema): nunca 'liberado', mesmo com released; sem esquema, libera de uma vez", () => {
    expect(financeiroDoPagamento(pagamento({ money_release_status: "released", money_release_schema: "payment_in_flow" }))).toMatchObject({ liberado: null, liberacaoEmParcelas: true, liberacaoPrevista: new Date("2026-11-07T14:00:00.000Z") });
    expect(financeiroDoPagamento(pagamento({ money_release_status: "pending", money_release_schema: { tipo: "x" } }))).toMatchObject({ liberado: null, liberacaoEmParcelas: true });
    for (const vazio of [null, undefined, "", "  ", [], {}]) {
      expect(financeiroDoPagamento(pagamento({ money_release_status: "released", money_release_schema: vazio }))).toMatchObject({ liberado: true, liberacaoEmParcelas: false });
    }
  });

  it("sem fee_details: taxa = valor − líquido", () => {
    expect(financeiroDoPagamento(pagamento({ fee_details: [] })).taxa).toBe(1990);
    expect(financeiroDoPagamento(pagamento({ fee_details: undefined })).taxa).toBe(1990);
    // Tarifa ilegível: cai no cálculo pelo líquido.
    expect(financeiroDoPagamento(pagamento({ fee_details: [{ amount: "x" }] })).taxa).toBe(1990);
    expect(financeiroDoPagamento(pagamento({ fee_details: [], transaction_details: {} }))).toMatchObject({ taxa: null, liquido: null });
  });

  it("liberado só com aviso explícito; data passada sozinha = desconhecido", () => {
    expect(financeiroDoPagamento(pagamento({ money_release_status: "released" })).liberado).toBe(true);
    expect(financeiroDoPagamento(pagamento({ money_release_status: "pending" })).liberado).toBe(false);
    const passado = financeiroDoPagamento(pagamento({ money_release_status: undefined, money_release_date: "2020-01-01T00:00:00.000Z" }));
    expect(passado.liberado).toBeNull();
    expect(passado.liberacaoPrevista).toEqual(new Date("2020-01-01T00:00:00.000Z"));
    expect(financeiroDoPagamento(pagamento({ money_release_status: "algo" })).liberado).toBeNull();
    // A referência diz que money_release_date pode vir "released"/"pending" em vez de data.
    const textual = financeiroDoPagamento(pagamento({ money_release_status: undefined, money_release_date: "released" }));
    expect(textual).toMatchObject({ liberado: true, liberacaoPrevista: null });
    expect(financeiroDoPagamento(pagamento({ money_release_status: undefined, money_release_date: "pending" }))).toMatchObject({ liberado: false, liberacaoPrevista: null });
  });

  it("id do pagamento só numérico", () => {
    expect(financeiroDoPagamento(pagamento({ id: "123" })).idPagamento).toBe("123");
    expect(financeiroDoPagamento(pagamento({ id: "PAY01" })).idPagamento).toBeNull();
    expect(financeiroDoPagamento(pagamento({ id: -1 })).idPagamento).toBeNull();
    expect(financeiroDoPagamento("lixo")).toEqual(NADA_FINANCEIRO);
  });
});

describe("conta de teste (GET /users/me)", () => {
  it("só a tag test_user comprova; apelido e e-mail sozinhos não bastam", () => {
    expect(contaDeTesteDoUsuario({ id: 1, nickname: "TESTUSER123", tags: ["normal", "test_user", "user_info_verified"] })).toBe(true);
    expect(contaDeTesteDoUsuario({ tags: ["normal", " TEST_USER "] })).toBe(true);
    expect(contaDeTesteDoUsuario({ nickname: "LOJA", tags: ["normal", "user_info_verified"] })).toBe(false);
    expect(contaDeTesteDoUsuario({ tags: [] })).toBe(false);
    expect(contaDeTesteDoUsuario({ nickname: "TESTUSER123", email: "test_user_1@testuser.com" })).toBeNull();
    expect(contaDeTesteDoUsuario({ tags: "test_user" })).toBeNull();
    expect(contaDeTesteDoUsuario({ tags: ["test_user", 1] })).toBeNull();
    expect(contaDeTesteDoUsuario(null)).toBeNull();
  });
});

describe("erros: lista fechada", () => {
  it("códigos de erro de vários formatos", () => {
    expect([...codigosDeErro({ errors: [{ code: "idempotency_key_already_used", message: "x" }] })]).toEqual(["idempotency_key_already_used"]);
    expect([...codigosDeErro({ error: "bad_request", cause: [{ code: "property_value" }] })].sort()).toEqual(["bad_request", "property_value"]);
    expect(codigosDeErro("texto").size).toBe(0);
  });

  it("falhas de rede viram mensagens fixas, sem repetir a causa", () => {
    const comToken = Object.assign(new TypeError(`fetch failed ${TOKEN}`), { cause: { code: "ECONNREFUSED", message: TOKEN } });
    const e1 = falhaDeRede(comToken, false);
    expect(e1.tipo).toBe("indisponivel");
    semSegredos(e1.message);
    expect(falhaDeRede(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }), false).tipo).toBe("indisponivel");
    expect(falhaDeRede(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }), false).tipo).toBe("incerto");
    expect(falhaDeRede(new TypeError("fetch failed", { cause: new Error("unexpected redirect") }), false).tipo).toBe("incerto");
    expect(falhaDeRede(new DOMException("x", "AbortError"), false).tipo).toBe("incerto");
    expect(falhaDeRede(new Error("qualquer"), true).message).toMatch(/não respondeu a tempo/);
    const desconhecida = falhaDeRede(new Error(`algo ${EMAIL_HOSPEDE}`), false);
    expect(desconhecida.tipo).toBe("incerto");
    semSegredos(desconhecida.message);
  });
});

describe("criarPix", () => {
  it("POST /v1/orders com cabeçalhos, chave, centavos em texto e e-mail do sandbox", async () => {
    const f = fetchFalso(json(201, orderPix()));
    const r = await cliente(f.impl).criarPix(pix());
    expect(r).toMatchObject({ ok: true, cobranca: { idProvedor: "ORDTST01KB00C5QRFKWERZQW5D6THPYQ", valor: 123456, situacao: "pendente", forma: "pix" } });
    expect(f.pedidos).toHaveLength(1);
    const [p] = f.pedidos;
    expect(p.url.toString()).toBe("https://api.mercadopago.com/v1/orders");
    expect(p.metodo).toBe("POST");
    expect(p.headers).toMatchObject({ authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "x-idempotency-key": "pix-scl-123-chave", accept: "application/json" });
    expect(p.headers["x-meli-session-id"]).toBeUndefined();
    expect(p.corpo).toEqual({
      type: "online",
      processing_mode: "automatic",
      total_amount: "1234.56",
      external_reference: "scl-123",
      description: "Reserva SCL",
      payer: { email: EMAIL_PAGADOR_SANDBOX, first_name: "APRO" },
      transactions: { payments: [{ amount: "1234.56", payment_method: { id: "pix", type: "bank_transfer", statement_descriptor: "SUACASALEBLON" }, expiration_time: "PT45M" }] },
    });
    expect(JSON.stringify(p.corpo)).not.toContain(EMAIL_HOSPEDE);
  });

  it("em produção vai o e-mail real (sem espaços)", async () => {
    const f = fetchFalso(json(201, orderPix()));
    await cliente(f.impl, { ambiente: "producao" }).criarPix(pix({ email: `  ${EMAIL_HOSPEDE} ` }));
    expect((f.pedidos[0].corpo as { payer: { email: string } }).payer.email).toBe(EMAIL_HOSPEDE);
  });

  it("validade ajustada para 30 min a 30 dias", async () => {
    for (const [pedida, enviada] of [[5, "PT30M"], [30, "PT30M"], [45.2, "PT46M"], [100_000, "PT43200M"], [43_200, "PT43200M"]] as const) {
      const f = fetchFalso(json(201, orderPix()));
      await cliente(f.impl).criarPix(pix({ validadeMinutos: pedida }));
      expect((f.pedidos[0].corpo as { transactions: { payments: { expiration_time: string }[] } }).transactions.payments[0].expiration_time).toBe(enviada);
    }
  });

  it("sem descrição na fatura e sem nome: campos ficam fora; descrição longa é cortada", async () => {
    const f = fetchFalso(json(201, orderPix()), json(201, orderPix()));
    await cliente(f.impl).criarPix(pix({ descricaoFatura: null, nome: "  ", descricao: "" }));
    const corpo = f.pedidos[0].corpo as Record<string, never>;
    expect(corpo).not.toHaveProperty("description");
    expect(corpo).toMatchObject({ payer: { email: EMAIL_PAGADOR_SANDBOX } });
    expect(JSON.stringify(corpo)).not.toContain("first_name");
    expect(JSON.stringify(corpo)).not.toContain("statement_descriptor");
    await cliente(f.impl).criarPix(pix({ descricaoFatura: "X".repeat(80) }));
    expect(JSON.stringify(f.pedidos[1].corpo)).toContain(`"statement_descriptor":"${"X".repeat(50)}"`);
  });

  it("pedido inválido não chega à rede", async () => {
    const f = fetchFalso();
    const c = cliente(f.impl);
    for (const ruim of [
      pix({ referencia: "scl 123" }), pix({ referencia: "x".repeat(65) }), pix({ referencia: "scl@1" }),
      pix({ chaveIdempotencia: "" }), pix({ chaveIdempotencia: "x".repeat(129) }), pix({ chaveIdempotencia: "com espaço" }),
      pix({ valor: 0 }), pix({ valor: -100 }), pix({ valor: 10.5 }), pix({ valor: Number.NaN }),
      pix({ validadeMinutos: Number.NaN }), pix({ email: "sem-arroba" }), pix({ email: "" }),
    ]) {
      const r = await c.criarPix(ruim);
      expect(r).toMatchObject({ ok: false, motivo: "dados_invalidos", cobranca: null });
      if (!r.ok) semSegredos(r.mensagem);
    }
    expect(f.pedidos).toHaveLength(0);
  });

  it("resposta sem o meio de pagamento: completa com a forma pedida", async () => {
    const o = orderPix();
    Object.assign(o.transactions.payments[0].payment_method, { id: null, type: null, qr_code: null, qr_code_base64: null, ticket_url: null });
    const r = await cliente(fetchFalso(json(201, o)).impl).criarPix(pix());
    expect(r).toMatchObject({ ok: true, cobranca: { forma: "pix", pix: null } });
  });

  it("201 ilegível → incerto (a order pode existir)", async () => {
    const r = await cliente(fetchFalso(new Response("<html>", { status: 201 })).impl).criarPix(pix());
    expect(r).toMatchObject({ ok: false, motivo: "incerto", cobranca: null });
  });

  it.each([
    [409, { errors: [{ code: "idempotency_key_already_used", message: "texto-do-provedor" }] }],
    [423, { errors: [{ code: "resource_locked" }] }],
    [500, { errors: [{ code: "idempotency_validation_failed" }] }],
    [409, { errors: [{ code: "algo_novo" }] }],
  ])("%i %j → incerto, sem nova tentativa com outra chave", async (status, corpo) => {
    const f = fetchFalso(json(status, corpo));
    const r = await cliente(f.impl).criarPix(pix());
    expect(r).toMatchObject({ ok: false, motivo: "incerto", cobranca: null });
    if (!r.ok) semSegredos(r.mensagem);
    expect(f.pedidos).toHaveLength(1);
  });

  it.each([
    [{ errors: [{ code: "invalid_email_for_sandbox", message: "texto-do-provedor" }] }, /@testuser\.com/],
    [{ errors: [{ code: "property_value", message: "The domain provided in payer.email is not allowed", details: ["texto-do-provedor"] }] }, /não aceitou este e-mail/],
    [{ errors: [{ code: "property_value", details: ["payer.email"] }] }, /não aceitou este e-mail/],
    [{ errors: [{ code: "property_value", message: "transactions.payments.amount" }] }, /recusou os dados/],
    [{ errors: [{ code: "invalid_installments" }] }, /parcelas/],
    [{ errors: [{ code: "invalid_card_token" }] }, /cartão/],
    [{ errors: [{ code: "invalid_total_amount" }] }, /Valor inválido/],
    [{ errors: [{ code: "unsupported_properties", message: `texto-do-provedor ${TOKEN}` }] }, /recusou os dados/],
    ["texto-do-provedor", /recusou os dados/],
  ])("400 %j → dados_invalidos com mensagem própria", async (corpo, mensagem) => {
    const r = await cliente(fetchFalso(json(400, corpo)).impl).criarPix(pix());
    expect(r).toMatchObject({ ok: false, motivo: "dados_invalidos", cobranca: null });
    if (r.ok) throw new Error("ok inesperado");
    expect(r.mensagem).toMatch(mensagem);
    semSegredos(r.mensagem);
  });

  it("401 e 403 → ErroProvedor credencial; 429 → limite com Retry-After", async () => {
    expect((await erroDe(cliente(fetchFalso(json(401, { message: TOKEN })).impl).criarPix(pix()))).tipo).toBe("credencial");
    expect((await erroDe(cliente(fetchFalso(json(403, { errors: [{ code: "PA_UNAUTHORIZED_RESULT_FROM_POLICIES" }] })).impl).criarPix(pix()))).tipo).toBe("credencial");
    const limite = await erroDe(cliente(fetchFalso(json(429, { errors: [{ code: "too_many_requests" }] }, { "retry-after": "7" })).impl).criarPix(pix()));
    expect(limite).toMatchObject({ tipo: "limite", esperarSegundos: 7 });
    const comData = await erroDe(cliente(fetchFalso(json(429, {}, { "retry-after": new Date(AGORA.getTime() + 30_000).toUTCString() })).impl).criarPix(pix()));
    expect(comData.esperarSegundos).toBe(30);
    expect((await erroDe(cliente(fetchFalso(json(429, {})).impl).criarPix(pix()))).esperarSegundos).toBeNull();
  });

  it("5xx sem ser de idempotência → ErroProvedor incerto", async () => {
    expect((await erroDe(cliente(fetchFalso(json(500, { errors: [{ code: "internal_error" }] })).impl).criarPix(pix()))).tipo).toBe("incerto");
    expect((await erroDe(cliente(fetchFalso(new Response("Bad Gateway texto-do-provedor", { status: 502 })).impl).criarPix(pix()))).tipo).toBe("incerto");
  });

  it("tempo-limite → incerto (cobre também a leitura do corpo)", async () => {
    const pendurado = fetchFalso((_p, init) => new Promise<Response>((_, rejeitar) => {
      init?.signal?.addEventListener("abort", () => rejeitar(new DOMException("aborted", "AbortError")));
    }));
    const e = await erroDe(cliente(pendurado.impl, { timeoutMs: 20 }).criarPix(pix()));
    expect(e.tipo).toBe("incerto");
    expect(e.message).toMatch(/não respondeu a tempo/);
    // Cabeçalho chegou, corpo nunca termina.
    const corpoLento = fetchFalso((_p, init) => {
      const corpo = new ReadableStream({ start(c) { init?.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError"))); } });
      return new Response(corpo, { status: 201 });
    });
    expect((await erroDe(cliente(corpoLento.impl, { timeoutMs: 20 }).criarPix(pix()))).tipo).toBe("incerto");
  });

  it("conexão recusada antes de enviar → indisponivel; conexão cortada → incerto", async () => {
    const recusada = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ECONNREFUSED ${TOKEN}`), { code: "ECONNREFUSED" }) });
    expect((await erroDe(cliente(fetchFalso(recusada).impl).criarPix(pix()))).tipo).toBe("indisponivel");
    const cortada = Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_SOCKET" } });
    expect((await erroDe(cliente(fetchFalso(cortada).impl).criarPix(pix()))).tipo).toBe("incerto");
  });

  it("token com quebra de linha ou vazio → credencial, sem chamar a rede nem repetir o token", async () => {
    for (const ruim of [`${TOKEN}\n`, "", "com espaço"]) {
      const f = fetchFalso();
      const e = await erroDe(cliente(f.impl, { accessToken: ruim }).criarPix(pix()));
      expect(e.tipo).toBe("credencial");
      expect(f.pedidos).toHaveLength(0);
    }
  });
});

describe("criarCartao", () => {
  it("corpo com token, bandeira, tipo, parcelas, documento só com dígitos e Device ID no cabeçalho", async () => {
    const f = fetchFalso(json(201, orderCartao()));
    const r = await cliente(f.impl).criarCartao(cartao());
    expect(r).toMatchObject({ ok: true, cobranca: { situacao: "aprovado", forma: "cartao", parcelas: 3, valor: 50000 } });
    const [p] = f.pedidos;
    expect(p.headers).toMatchObject({ "x-idempotency-key": "cartao-scl-456-chave", "x-meli-session-id": "armor.ficticio.0123456789", authorization: `Bearer ${TOKEN}` });
    expect(p.corpo).toEqual({
      type: "online",
      processing_mode: "automatic",
      capture_mode: "automatic",
      total_amount: "500.00",
      external_reference: "scl-456",
      description: "Reserva SCL",
      payer: { email: EMAIL_PAGADOR_SANDBOX, identification: { type: "CPF", number: "12345678909" } },
      config: { online: { transaction_security: { validation: "on_fraud_risk", liability_shift: "required" } } },
      transactions: { payments: [{ amount: "500.00", payment_method: { id: "master", type: "credit_card", token: "1c87b6b301010101ddcd92f9bbbb3be2", installments: 3 } }] },
    });
    // O emissor não é campo documentado da Orders: não vai.
    expect(JSON.stringify(p.corpo)).not.toMatch(/issuer|"24"/);
  });

  it("verificação do banco 'nunca': validation never, sem liability_shift (a documentação proíbe os dois juntos)", async () => {
    const f = fetchFalso(json(201, orderCartao()));
    await cliente(f.impl).criarCartao(cartao({ tresDS: "never" }));
    expect((f.pedidos[0].corpo as { config: unknown }).config).toEqual({ online: { transaction_security: { validation: "never" } } });
    expect(JSON.stringify(f.pedidos[0].corpo)).not.toContain("liability_shift");
  });

  it("produção manda o e-mail real; sem documento, sem identification; Device ID inválido fica fora", async () => {
    const f = fetchFalso(json(201, orderCartao()));
    await cliente(f.impl, { ambiente: "producao" }).criarCartao(cartao({ documento: null, sessaoDispositivo: "tem espaço", descricaoFatura: "SCL" }));
    const [p] = f.pedidos;
    expect(p.corpo).toMatchObject({ payer: { email: EMAIL_HOSPEDE } });
    expect(JSON.stringify(p.corpo)).not.toContain("identification");
    expect(p.headers["x-meli-session-id"]).toBeUndefined();
    expect(JSON.stringify(p.corpo)).toContain('"statement_descriptor":"SCL"');
  });

  it("débito vai sem parcelas", async () => {
    const f = fetchFalso(json(201, orderCartao({}, { payment_method: { id: "debelo", type: "debit_card" } })));
    const r = await cliente(f.impl).criarCartao(cartao({ tipo: "debit_card", bandeira: "debelo", parcelas: 1 }));
    expect(JSON.stringify(f.pedidos[0].corpo)).not.toContain("installments");
    expect(r).toMatchObject({ ok: true, cobranca: { parcelas: null } });
  });

  it("pedido inválido não chega à rede", async () => {
    const f = fetchFalso();
    const c = cliente(f.impl);
    for (const ruim of [
      cartao({ parcelas: 0 }), cartao({ parcelas: 37 }), cartao({ parcelas: 2.5 }), cartao({ tipo: "debit_card", parcelas: 2 }),
      cartao({ token: "" }), cartao({ token: "x y" }), cartao({ bandeira: "" }), cartao({ bandeira: "../x" }),
      cartao({ tipo: "prepaid_card" as never }), cartao({ documento: { tipo: "CPF", numero: "" } }), cartao({ documento: { tipo: "C", numero: "1" } }),
      cartao({ email: "x" }), cartao({ referencia: "" }), cartao({ valor: 0 }), cartao({ tresDS: "always" as never }), cartao({ tresDS: undefined as never }),
    ]) {
      const r = await c.criarCartao(ruim);
      expect(r).toMatchObject({ ok: false, motivo: "dados_invalidos", cobranca: null });
      if (!r.ok) semSegredos(r.mensagem);
    }
    expect(f.pedidos).toHaveLength(0);
  });

  it("402: order criada, transação recusada → recusado com a order, mensagem genérica e o motivo em `codigo`", async () => {
    const dados = orderCartao({ status: "failed", status_detail: "failed", total_paid_amount: undefined }, { status: "failed", status_detail: "required_call_for_authorize" });
    const f = fetchFalso(json(402, { errors: [{ code: "failed", message: "texto-do-provedor", details: ["PAY01KB0JDVXYPD6HPP2HSMJS11QN: required_call_for_authorize"] }], data: dados }));
    const r = await cliente(f.impl).criarCartao(cartao());
    expect(r).toMatchObject({ ok: false, motivo: "recusado", codigo: "required_call_for_authorize", cobranca: { situacao: "recusado", idProvedor: "ORDTST01KB0JDVXYPD6HPP2HSJDKH8FG", detalhe: "failed/failed; pagamento failed/required_call_for_authorize" } });
    if (r.ok) throw new Error("ok inesperado");
    expect(r.mensagem).toBe(RECUSA_GENERICA);
    semSegredos(r.mensagem);
  });

  it("402 sem data: continua recusado (sem order), com o código dos detalhes ou, sem eles, o do erro", async () => {
    const r = await cliente(fetchFalso(json(402, { errors: [{ code: "failed", details: ["pay_x: high_risk"] }] })).impl).criarCartao(cartao());
    expect(r).toEqual({ ok: false, motivo: "recusado", mensagem: RECUSA_GENERICA, cobranca: null, codigo: "high_risk" });
    const semDetalhe = await cliente(fetchFalso(json(402, { errors: [{ code: "failed", message: "texto-do-provedor" }] })).impl).criarCartao(cartao());
    expect(semDetalhe).toMatchObject({ ok: false, motivo: "recusado", cobranca: null, codigo: "failed" });
  });

  it.each([
    "bad_filled_card_data", "high_risk", "rejected_by_issuer", "required_call_for_authorize", "max_attempts_exceeded", "card_disabled", "insufficient_amount",
    "card_insufficient_amount", "amount_limit_exceeded", "invalid_installments", "processing_error", "3ds_challenge_expired", "cc_rejected_3ds_challenge", "codigo_desconhecido",
  ])("recusa %s: a mesma mensagem para todo motivo (o motivo só no código)", async (motivo) => {
    const order = orderCartao({ status: "failed", status_detail: "failed", total_paid_amount: undefined }, { status: "failed", status_detail: motivo });
    for (const resposta of [json(201, order), json(402, { errors: [{ code: "failed", details: [`pay_x: ${motivo}`] }], data: order })]) {
      const r = await cliente(fetchFalso(resposta).impl).criarCartao(cartao());
      expect(r).toMatchObject({ ok: false, motivo: "recusado", mensagem: RECUSA_GENERICA, codigo: motivo });
    }
  });

  it("201 com a order já recusada → recusado", async () => {
    const r = await cliente(fetchFalso(json(201, orderCartao({ status: "failed", status_detail: "high_risk" }, { status: "failed", status_detail: "high_risk" }))).impl).criarCartao(cartao());
    expect(r).toMatchObject({ ok: false, motivo: "recusado", codigo: "high_risk", cobranca: { situacao: "recusado" } });
  });

  it("dados inválidos e incerto também trazem o código (o de token na frente)", async () => {
    const token = await cliente(fetchFalso(json(400, { error: "bad_request", cause: [{ code: "invalid_card_token" }] })).impl).criarCartao(cartao());
    expect(token).toMatchObject({ ok: false, motivo: "dados_invalidos", codigo: "invalid_card_token", cobranca: null });
    const parcelas = await cliente(fetchFalso(json(400, { errors: [{ code: "invalid_installments", message: "texto-do-provedor" }] })).impl).criarCartao(cartao());
    expect(parcelas).toMatchObject({ ok: false, motivo: "dados_invalidos", codigo: "invalid_installments" });
    const repetida = await cliente(fetchFalso(json(409, { errors: [{ code: "idempotency_key_already_used" }] })).impl).criarCartao(cartao());
    expect(repetida).toMatchObject({ ok: false, motivo: "incerto", codigo: "idempotency_key_already_used" });
    const local = await cliente(fetchFalso().impl).criarCartao(cartao({ parcelas: 0 }));
    expect(local).toMatchObject({ ok: false, motivo: "dados_invalidos", codigo: null });
  });

  it("3DS: action_required/pending_challenge → ok, pendente, com o endereço do desafio na resposta da criação", async () => {
    const order = orderCartao(
      { status: "action_required", status_detail: "pending_challenge", total_paid_amount: undefined },
      { status: "action_required", status_detail: "pending_challenge", payment_method: { id: "master", type: "credit_card", installments: 3, transaction_security: { url: URL_DESAFIO, validation: "on_fraud_risk", liability_shift: "required" } } },
    );
    const r = await cliente(fetchFalso(json(201, order)).impl).criarCartao(cartao());
    expect(r).toMatchObject({ ok: true, cobranca: { situacao: "pendente", pago: null, cartao: { desafio: true, desafioUrl: URL_DESAFIO, tresDSStatus: null } } });
  });

  it("resposta sem o meio de pagamento: forma cartão completada, com os dados do cartão lidos", async () => {
    const o = orderCartao({}, { payment_method: null });
    const r = await cliente(fetchFalso(json(201, o)).impl).criarCartao(cartao());
    expect(r).toMatchObject({ ok: true, cobranca: { forma: "cartao", parcelas: null, pix: null, cartao: { desafio: false, bandeira: null } } });
  });
});

describe("consultar", () => {
  it("GET /v1/orders/{id} sem chave de idempotência nem corpo", async () => {
    const f = fetchFalso(json(200, orderCartao()));
    const c = await cliente(f.impl).consultar("ORDTST01KB0JDVXYPD6HPP2HSJDKH8FG");
    expect(c).toMatchObject({ situacao: "aprovado", valor: 50000 });
    const [p] = f.pedidos;
    expect(p.url.toString()).toBe("https://api.mercadopago.com/v1/orders/ORDTST01KB0JDVXYPD6HPP2HSJDKH8FG");
    expect(p.metodo).toBe("GET");
    expect(p.headers["x-idempotency-key"]).toBeUndefined();
    expect(p.temCorpo).toBe(false);
  });

  it("404 e invalid_path_param → null; id que não pode existir → null sem rede", async () => {
    expect(await cliente(fetchFalso(json(404, { errors: [{ code: "order_not_found" }] })).impl).consultar("ORD1")).toBeNull();
    expect(await cliente(fetchFalso(json(400, { errors: [{ code: "invalid_path_param" }] })).impl).consultar("ORD1")).toBeNull();
    const f = fetchFalso();
    for (const ruim of ["", "../payments", "ORD1/cancel", "ORD1?x=1", "x".repeat(65), "ORD 1"]) expect(await cliente(f.impl).consultar(ruim)).toBeNull();
    expect(f.pedidos).toHaveLength(0);
  });

  it("resposta ilegível, 5xx ou 400 genérico → lança incerto; 401 → credencial", async () => {
    expect((await erroDe(cliente(fetchFalso(json(200, { id: "ORD1" })).impl).consultar("ORD1"))).tipo).toBe("incerto");
    expect((await erroDe(cliente(fetchFalso(new Response("x", { status: 200 })).impl).consultar("ORD1"))).tipo).toBe("incerto");
    expect((await erroDe(cliente(fetchFalso(json(503, {})).impl).consultar("ORD1"))).tipo).toBe("incerto");
    expect((await erroDe(cliente(fetchFalso(json(400, { errors: [{ code: "outro" }] })).impl).consultar("ORD1"))).tipo).toBe("incerto");
    expect((await erroDe(cliente(fetchFalso(json(401, {})).impl).consultar("ORD1"))).tipo).toBe("credencial");
  });
});

describe("buscarPorReferencia", () => {
  const desde = new Date("2026-10-08T14:00:00.000Z");

  it("GET /v1/orders com referência e datas (com margem), relendo a order achada", async () => {
    const f = fetchFalso(
      json(200, { data: [{ id: "ORDOUTRA", external_reference: "scl-1234" }, { id: "ORDTST01KB00C5QRFKWERZQW5D6THPYQ", external_reference: "scl-123", transactions: { payments: [null] } }], paging: { total: "2" } }),
      json(200, orderPix()),
    );
    const c = await cliente(f.impl).buscarPorReferencia("scl-123", desde);
    expect(c).toMatchObject({ idProvedor: "ORDTST01KB00C5QRFKWERZQW5D6THPYQ", situacao: "pendente", pix: { copiaECola: "00020126580014br.gov.bcb.pix0136ficticio" } });
    const [busca, leitura] = f.pedidos;
    expect(busca.url.origin + busca.url.pathname).toBe("https://api.mercadopago.com/v1/orders");
    expect(Object.fromEntries(busca.url.searchParams)).toEqual({ external_reference: "scl-123", begin_date: "2026-10-08T13:55:00Z", end_date: "2026-10-08T15:05:00Z" });
    expect(busca.headers["x-idempotency-key"]).toBeUndefined();
    expect(leitura.url.pathname).toBe("/v1/orders/ORDTST01KB00C5QRFKWERZQW5D6THPYQ");
  });

  it("rota principal inexistente (404) → tenta /v1/orders/search", async () => {
    const f = fetchFalso(json(404, {}), json(200, { results: [{ id: "ORDTST01KB00C5QRFKWERZQW5D6THPYQ", external_reference: "scl-123" }] }), json(200, orderPix()));
    expect(await cliente(f.impl).buscarPorReferencia("scl-123", desde)).toMatchObject({ idProvedor: "ORDTST01KB00C5QRFKWERZQW5D6THPYQ" });
    expect(f.pedidos.map((p) => p.url.pathname)).toEqual(["/v1/orders", "/v1/orders/search", "/v1/orders/ORDTST01KB00C5QRFKWERZQW5D6THPYQ"]);
    expect(f.pedidos[1].url.searchParams.get("external_reference")).toBe("scl-123");
  });

  it("busca que respondeu sem a referência exata → null", async () => {
    const f = fetchFalso(json(200, { data: [{ id: "ORD9", external_reference: "SCL-123" }, { id: "ORD8", external_reference: "scl-1234" }] }));
    expect(await cliente(f.impl).buscarPorReferencia("scl-123", desde)).toBeNull();
    expect(await cliente(fetchFalso(json(200, { data: [] })).impl).buscarPorReferencia("scl-123", desde)).toBeNull();
  });

  it("busca que não funciona LANÇA (nunca 'não existe' sem saber)", async () => {
    expect((await erroDe(cliente(fetchFalso(json(404, {}), json(404, {})).impl).buscarPorReferencia("scl-123", desde))).tipo).toBe("incerto");
    expect((await erroDe(cliente(fetchFalso(json(400, { errors: [{ code: "invalid_search_params" }] })).impl).buscarPorReferencia("scl-123", desde))).tipo).toBe("incerto");
    expect((await erroDe(cliente(fetchFalso(json(200, { outra: 1 })).impl).buscarPorReferencia("scl-123", desde))).tipo).toBe("incerto");
    expect((await erroDe(cliente(fetchFalso(json(500, {})).impl).buscarPorReferencia("scl-123", desde))).tipo).toBe("incerto");
    expect((await erroDe(cliente(fetchFalso(json(401, {})).impl).buscarPorReferencia("scl-123", desde))).tipo).toBe("credencial");
  });

  it("achada na busca mas a releitura dá 404 → usa o resumo da lista", async () => {
    const f = fetchFalso(json(200, { data: [orderCartao()] }), json(404, {}));
    expect(await cliente(f.impl).buscarPorReferencia("scl-456", desde)).toMatchObject({ idProvedor: "ORDTST01KB0JDVXYPD6HPP2HSJDKH8FG", situacao: "aprovado" });
    const ilegivel = fetchFalso(json(200, { data: [{ id: "ORD7", external_reference: "scl-456" }] }), json(404, {}));
    expect((await erroDe(cliente(ilegivel.impl).buscarPorReferencia("scl-456", desde))).tipo).toBe("incerto");
  });

  it("referência inválida → null sem rede; 'desde' no futuro não inverte o intervalo", async () => {
    const f = fetchFalso(json(200, { data: [] }));
    expect(await cliente(f.impl).buscarPorReferencia("scl 1", desde)).toBeNull();
    expect(f.pedidos).toHaveLength(0);
    await cliente(f.impl).buscarPorReferencia("scl-1", new Date("2030-01-01T00:00:00Z"));
    expect(f.pedidos[0].url.searchParams.get("begin_date")).toBe("2026-10-08T14:55:00Z");
  });
});

describe("detalheFinanceiro", () => {
  const nada = NADA_FINANCEIRO;

  it("procura na Payments API pela referência e usa o pagamento com a referência idêntica", async () => {
    const f = fetchFalso(json(200, { results: [
      { id: 1, external_reference: "scl-4567", transaction_amount: 1 },
      { id: 104669748043, external_reference: "scl-456", transaction_amount: 500, transaction_details: { net_received_amount: 480.1 }, fee_details: [{ amount: 19.9, fee_payer: "collector" }], money_release_date: "2026-11-07T10:00:00.000-04:00", money_release_status: "released" },
    ] }));
    expect(await cliente(f.impl).detalheFinanceiro(cobrancaAprovada())).toEqual({ taxa: 1990, liquido: 48010, liberacaoPrevista: new Date("2026-11-07T14:00:00.000Z"), liberado: true, idPagamento: "104669748043", liberacaoEmParcelas: false, custoParcelasVendedor: 0 });
    const [p] = f.pedidos;
    expect(p.url.pathname).toBe("/v1/payments/search");
    expect(Object.fromEntries(p.url.searchParams)).toEqual({ external_reference: "scl-456", sort: "date_created", criteria: "desc" });
    expect(p.metodo).toBe("GET");
  });

  it("qualquer falha ou ausência → tudo null, sem lançar", async () => {
    const c = cobrancaAprovada();
    expect(await cliente(fetchFalso(json(200, { results: [] })).impl).detalheFinanceiro(c)).toEqual(nada);
    expect(await cliente(fetchFalso(json(200, { results: [{ id: 1, external_reference: "outra" }] })).impl).detalheFinanceiro(c)).toEqual(nada);
    expect(await cliente(fetchFalso(json(400, { message: "Token must be for test" })).impl).detalheFinanceiro(c)).toEqual(nada);
    expect(await cliente(fetchFalso(json(401, {})).impl).detalheFinanceiro(c)).toEqual(nada);
    expect(await cliente(fetchFalso(json(500, {})).impl).detalheFinanceiro(c)).toEqual(nada);
    expect(await cliente(fetchFalso(new TypeError("fetch failed")).impl).detalheFinanceiro(c)).toEqual(nada);
    const f = fetchFalso();
    expect(await cliente(f.impl).detalheFinanceiro(cobrancaAprovada({ referencia: "" }))).toEqual(nada);
    expect(f.pedidos).toHaveLength(0);
  });
});

describe("existePagamentoPorReferencia (D18)", () => {
  it("GET /v1/payments/search pela referência: true só com a referência idêntica; 200 sem ela = false", async () => {
    const f = fetchFalso(json(200, { results: [{ id: 1, external_reference: "scl-4567" }, { id: 104669748043, external_reference: "scl-456", status: "rejected" }] }));
    expect(await cliente(f.impl).existePagamentoPorReferencia("scl-456", AGORA)).toBe(true);
    const [p] = f.pedidos;
    expect(p.metodo).toBe("GET");
    expect(p.url.pathname).toBe("/v1/payments/search");
    expect(Object.fromEntries(p.url.searchParams)).toEqual({ external_reference: "scl-456", sort: "date_created", criteria: "desc" });
    expect(await cliente(fetchFalso(json(200, { results: [{ external_reference: "SCL-456" }, null] })).impl).existePagamentoPorReferencia("scl-456", AGORA)).toBe(false);
    expect(await cliente(fetchFalso(json(200, { results: [] })).impl).existePagamentoPorReferencia("scl-456", AGORA)).toBe(false);
  });

  it("busca que não funciona LANÇA (nunca 'não existe' sem saber); referência inválida = false sem rede", async () => {
    for (const r of [json(500, {}), json(400, { message: "texto-do-provedor" }), json(404, {}), json(200, { outra: 1 }), json(200, { results: "x" }), new Response("x", { status: 200 })]) {
      expect((await erroDe(cliente(fetchFalso(r).impl).existePagamentoPorReferencia("scl-456", AGORA))).tipo).toBe("incerto");
    }
    expect((await erroDe(cliente(fetchFalso(json(401, {})).impl).existePagamentoPorReferencia("scl-456", AGORA))).tipo).toBe("credencial");
    expect((await erroDe(cliente(fetchFalso(json(429, {})).impl).existePagamentoPorReferencia("scl-456", AGORA))).tipo).toBe("limite");
    expect((await erroDe(cliente(fetchFalso(new TypeError("fetch failed", { cause: { code: "ECONNRESET" } })).impl).existePagamentoPorReferencia("scl-456", AGORA))).tipo).toBe("incerto");
    const f = fetchFalso();
    expect(await cliente(f.impl).existePagamentoPorReferencia("scl 456", AGORA)).toBe(false);
    expect(f.pedidos).toHaveLength(0);
  });
});

describe("urlDoDesafio", () => {
  it("só https de domínio do Mercado Pago (ou subdomínio), sem usuário, senha ou porta", () => {
    expect(urlDoDesafio(URL_DESAFIO)).toBe(URL_DESAFIO);
    expect(urlDoDesafio(`  ${URL_DESAFIO}  `)).toBe(URL_DESAFIO);
    for (const ok of ["https://mercadopago.com/x", "https://a.b.mercadolibre.com/x", "https://www.mercadolivre.com.br/x", "https://WWW.MercadoPago.com.br/x"]) expect(urlDoDesafio(ok)).not.toBeNull();
    for (const ruim of ["https://mercadopago.com.br@evil.example/x", "https://evil.example/?u=mercadopago.com.br", "ftp://www.mercadopago.com.br/x", "https://www.mercadopago.com.br.evil.example/", "", "   ", undefined, {}]) {
      expect(urlDoDesafio(ruim)).toBeNull();
    }
  });
});

describe("cancelar", () => {
  it("POST /v1/orders/{id}/cancel com chave e sem corpo", async () => {
    const f = fetchFalso(json(200, { id: "ORD1", status: "canceled", status_detail: "canceled_transaction" }));
    expect(await cliente(f.impl).cancelar("ORD1", "cancelar-1")).toBe("cancelado");
    const [p] = f.pedidos;
    expect(p.url.toString()).toBe("https://api.mercadopago.com/v1/orders/ORD1/cancel");
    expect(p.metodo).toBe("POST");
    expect(p.headers["x-idempotency-key"]).toBe("cancelar-1");
    expect(p.temCorpo).toBe(false);
  });

  it.each([
    [json(201, {}), "cancelado"],
    [json(409, { errors: [{ code: "cannot_cancel_order" }] }), "nao_cancelavel"],
    [json(409, { errors: [{ code: "order_already_canceled" }] }), "cancelado"],
    [json(409, { errors: [{ code: "idempotency_key_already_used" }] }), "erro"],
    [json(404, {}), "erro"],
    [json(500, {}), "erro"],
    [json(401, {}), "erro"],
    [json(429, {}), "erro"],
    [new TypeError("fetch failed"), "erro"],
  ])("%#: resposta → %s, sem lançar", async (resposta, esperado) => {
    expect(await cliente(fetchFalso(resposta).impl).cancelar("ORD1", "cancelar-1")).toBe(esperado);
  });

  it("id ou chave inválidos → erro sem rede", async () => {
    const f = fetchFalso();
    expect(await cliente(f.impl).cancelar("../x", "c")).toBe("erro");
    expect(await cliente(f.impl).cancelar("ORD1", "")).toBe("erro");
    expect(f.pedidos).toHaveLength(0);
  });
});

describe("devolver", () => {
  const refund = (status: string, over: Record<string, unknown> = {}) => ({ id: "REF01J49MMW3SSBK5PSV3DFR32959", transaction_id: "PAY01KB0JDVXYPD6HPP2HSMJS11QN", amount: "500.00", status, ...over });

  it("integral: corpo vazio, chave no cabeçalho; devolução processed → confirmada", async () => {
    const f = fetchFalso(json(201, { id: "ORD1", status: "refunded", status_detail: "refunded", transactions: { refunds: [refund("processed")] } }));
    expect(await cliente(f.impl).devolver(cobrancaAprovada(), "devolver-1", null)).toEqual({ situacao: "confirmada", idDevolucao: "REF01J49MMW3SSBK5PSV3DFR32959", mensagem: "Devolução confirmada pelo Mercado Pago.", codigo: null });
    const [p] = f.pedidos;
    expect(p.url.toString()).toBe("https://api.mercadopago.com/v1/orders/ORDTST01KB0JDVXYPD6HPP2HSJDKH8FG/refund");
    expect(p.headers["x-idempotency-key"]).toBe("devolver-1");
    expect(p.corpo).toEqual({});
  });

  it("parcial: id da transação e valor em texto", async () => {
    const f = fetchFalso(json(201, { transactions: { refunds: [refund("processed", { id: "REF_ANTIGA", transaction_id: "OUTRA" }), refund("processed", { id: "REF_NOVA", amount: "24.50" })] } }));
    expect(await cliente(f.impl).devolver(cobrancaAprovada(), "devolver-2", 2450)).toMatchObject({ situacao: "confirmada", idDevolucao: "REF_NOVA" });
    expect(f.pedidos[0].corpo).toEqual({ transactions: [{ id: "PAY01KB0JDVXYPD6HPP2HSMJS11QN", amount: "24.50" }] });
  });

  it("devolução sem status confirmado, ou sem lista → pedida", async () => {
    // A REF_A já estava na leitura de antes do pedido: a nova (a nossa) é a REF_B.
    const antes = cobrancaAprovada({ devolucoes: [{ id: "REF_A", estado: "confirmada", valor: 50_000 }] });
    expect(await cliente(fetchFalso(json(201, { transactions: { refunds: [refund("processed", { id: "REF_A" }), refund("in_process", { id: "REF_B" })] } })).impl).devolver(antes, "d", null)).toMatchObject({ situacao: "pedida", idDevolucao: "REF_B" });
    expect(await cliente(fetchFalso(json(201, { status: "refunded" })).impl).devolver(cobrancaAprovada(), "d", null)).toMatchObject({ situacao: "pedida", idDevolucao: null });
    expect(await cliente(fetchFalso(json(200, { transactions: { refunds: [refund("approved")] } })).impl).devolver(cobrancaAprovada(), "d", null)).toMatchObject({ situacao: "confirmada" });
  });

  it("validação local: parcial sem transação, valor acima do disponível ou inválido → recusada sem rede", async () => {
    const f = fetchFalso();
    const c = cliente(f.impl);
    expect(await c.devolver(cobrancaAprovada({ idTransacao: null }), "d", 100)).toMatchObject({ situacao: "recusada", mensagem: "Falta o id da transação para a devolução parcial." });
    expect(await c.devolver(cobrancaAprovada({ devolvido: 49_000 }), "d", 1_001)).toMatchObject({ situacao: "recusada" });
    expect(await c.devolver(cobrancaAprovada(), "d", 0)).toMatchObject({ situacao: "recusada" });
    expect(await c.devolver(cobrancaAprovada(), "d", 1.5)).toMatchObject({ situacao: "recusada" });
    expect(await c.devolver(cobrancaAprovada({ idProvedor: "a/b" }), "d", null)).toMatchObject({ situacao: "recusada" });
    expect(await c.devolver(cobrancaAprovada(), "", null)).toMatchObject({ situacao: "recusada" });
    expect(f.pedidos).toHaveLength(0);
  });

  it.each([
    // M8.2c: devolução já em andamento = "aguarde" (nada aceito por esta chave), não "pedida".
    [json(409, { errors: [{ code: "order_refund_already_in_process" }] }), "aguarde"],
    [json(409, { errors: [{ code: "order_already_refunded" }] }), "confirmada"],
    [json(409, { errors: [{ code: "idempotency_key_already_used" }] }), "incerta"],
    [json(409, { errors: [{ code: "cannot_refund_order" }] }), "recusada"],
    [json(409, { errors: [{ code: "novo_codigo" }] }), "incerta"],
    [json(400, { errors: [{ code: "refund_amount_exceeds", message: "texto-do-provedor" }] }), "recusada"],
    [json(400, {}), "recusada"],
    [json(404, { errors: [{ code: "transaction_not_found" }] }), "recusada"],
    // M8.2c: travado no provedor = "aguarde" (transitório; não conta como falha).
    [json(423, { errors: [{ code: "resource_locked" }] }), "aguarde"],
    [json(500, { errors: [{ code: "idempotency_validation_failed" }] }), "incerta"],
    [json(502, {}), "incerta"],
    [json(401, {}), "recusada"],
    [json(429, {}), "incerta"],
    [new TypeError("fetch failed", { cause: { code: "ECONNRESET" } }), "incerta"],
  ])("%#: → %s, sem lançar e sem repetir o provedor", async (resposta, esperado) => {
    const r = await cliente(fetchFalso(resposta).impl).devolver(cobrancaAprovada(), "devolver-1", null);
    expect(r.situacao).toBe(esperado);
    semSegredos(r.mensagem);
  });

  it.each([
    // [resposta, situação, código]
    [json(400, { errors: [{ code: "order_refund_already_in_process" }] }), "aguarde", "em_andamento"],
    [json(409, { errors: [{ code: "order_refund_already_in_process" }] }), "aguarde", "em_andamento"],
    [json(409, { errors: [{ code: "refund_in_progress" }] }), "aguarde", "em_andamento"],
    [json(422, { errors: [{ code: "refund_in_progress" }] }), "aguarde", "em_andamento"],
    [json(400, { errors: [{ code: "movement_operations_pending" }] }), "aguarde", "transitorio"],
    [json(425, { errors: [{ code: "order_payment_not_yet_enabled_for_refund" }] }), "aguarde", "transitorio"],
    [json(423, {}), "aguarde", "transitorio"],
    [json(428, { errors: [{ code: "insufficient_money_for_refund" }] }), "recusada", "saldo_insuficiente"],
    [json(428, {}), "recusada", "saldo_insuficiente"],
    [json(400, { errors: [{ code: "insufficient_money_for_refund" }] }), "recusada", "saldo_insuficiente"],
    [json(409, { errors: [{ code: "refund_period_exceeded" }] }), "recusada", "prazo"],
    [json(400, { errors: [{ code: "refund_period_exceeded" }] }), "recusada", "prazo"],
    [json(404, {}), "recusada", "nao_encontrado"],
    [json(409, { errors: [{ code: "cannot_refund_order" }] }), "recusada", "nao_permitido"],
    [json(409, { errors: [{ code: "operation_not_supported" }] }), "recusada", "nao_permitido"],
    [json(400, { errors: [{ code: "refund_amount_exceeds" }] }), "recusada", "valor_excede"],
    [json(400, { errors: [{ code: "outro_codigo" }] }), "recusada", null],
    [json(409, { errors: [{ code: "order_already_refunded" }] }), "confirmada", null],
    [json(409, { errors: [{ code: "idempotency_key_already_used" }] }), "incerta", null],
    [json(500, {}), "incerta", null],
    [json(429, {}), "incerta", null],
  ])("%#: código do resultado (M8.2c) → %s / %s", async (resposta, situacao, codigo) => {
    const r = await cliente(fetchFalso(resposta).impl).devolver(cobrancaAprovada(), "devolver-1", null);
    expect([r.situacao, r.codigo, r.idDevolucao]).toEqual([situacao, codigo, null]);
    semSegredos(r.mensagem);
  });

  it("o código nunca vem do texto livre do provedor: só dos códigos de erro conhecidos", async () => {
    const r = await cliente(fetchFalso(json(400, { message: "insufficient_money_for_refund refund_period_exceeded", errors: [{ code: "bad_request", message: "order_refund_already_in_process" }] })).impl).devolver(cobrancaAprovada(), "d", null);
    expect(r).toMatchObject({ situacao: "recusada", codigo: null });
    // Validação local (antes da rede): sem código.
    expect(await cliente(fetchFalso().impl).devolver(cobrancaAprovada(), "", null)).toMatchObject({ situacao: "recusada", codigo: null });
  });

  it("201: a devolução deste pedido é a que não estava na leitura de antes; nenhuma nova ou mais de uma = sem id", async () => {
    const antiga = { id: "REF01ANTIGA0000000000000000", estado: "falhou" as const, valor: 50_000 };
    const corpo = (ids: string[]) => ({ transactions: { refunds: ids.map((id) => refund("in_process", { id })) } });
    const pedir = (ids: string[], devolucoes = [antiga]) => cliente(fetchFalso(json(201, corpo(ids))).impl).devolver(cobrancaAprovada({ devolucoes }), "d", null);
    // A antiga (que falhou) e a nova: a nova.
    expect(await pedir([antiga.id, "REF01NOVA00000000000000000"])).toMatchObject({ situacao: "pedida", idDevolucao: "REF01NOVA00000000000000000" });
    // Só a já conhecida: não dá para saber qual é a nossa.
    expect(await pedir([antiga.id])).toMatchObject({ situacao: "pedida", idDevolucao: null });
    // Duas desconhecidas (a leitura de antes não listava nada): também não — nunca "a última da lista".
    expect(await pedir(["REF01UMA000000000000000000", "REF01OUTRA0000000000000000"], [])).toMatchObject({ situacao: "pedida", idDevolucao: null });
    // Id inválido ou sem o prefixo de devolução não conta.
    expect(await pedir(["../x", "PAY01NAOEDEVOLUCAO00000000"], [])).toMatchObject({ situacao: "pedida", idDevolucao: null });
  });

  it("201 com a chave repetida (depois de uma resposta incerta): sem devolução nova, é a repetição do pedido anterior — uma devolução só na resposta é a nossa", async () => {
    const nossa = { id: "REF01NOSSA00000000000000000", estado: "falhou" as const, valor: 182_400 };
    const outra = { id: "REF01OUTRA00000000000000000", estado: "falhou" as const, valor: 50_000 };
    const corpo = (ids: string[]) => ({ transactions: { refunds: ids.map((id) => refund("in_process", { id })) } });
    const pedir = (ids: string[], devolucoes: DevolucaoLida[], repetida: boolean) => cliente(fetchFalso(json(201, corpo(ids))).impl).devolver(cobrancaAprovada({ devolucoes }), "devolucao-x-1", null, { repetida });
    // A leitura de antes já lista a nossa (o pedido anterior saiu e falhou): o Mercado Pago repete a resposta dele.
    expect(await pedir([nossa.id], [nossa], true)).toMatchObject({ situacao: "pedida", idDevolucao: nossa.id });
    // A mesma resposta com uma chave nova: não dá para saber (pode ser a lista de antes).
    expect(await pedir([nossa.id], [nossa], false)).toMatchObject({ situacao: "pedida", idDevolucao: null });
    // Repetida, mas a resposta lista mais de uma conhecida: não dá para saber qual era a nossa.
    expect(await pedir([outra.id, nossa.id], [outra, nossa], true)).toMatchObject({ situacao: "pedida", idDevolucao: null });
    // Repetida e com uma nova: a nova (o pedido anterior não tinha chegado).
    expect(await pedir([outra.id, "REF01NOVA00000000000000000"], [outra], true)).toMatchObject({ situacao: "pedida", idDevolucao: "REF01NOVA00000000000000000" });
  });

  it("tempo-limite → incerta", async () => {
    const pendurado = fetchFalso((_p, init) => new Promise<Response>((_, rejeitar) => {
      init?.signal?.addEventListener("abort", () => rejeitar(new DOMException("aborted", "AbortError")));
    }));
    expect(await cliente(pendurado.impl, { timeoutMs: 20 }).devolver(cobrancaAprovada(), "d", null)).toMatchObject({ situacao: "incerta" });
  });
});

describe("conferirContaDeTeste", () => {
  it("GET /users/me; tag test_user → true; sem a tag → false; sem tags → null; nada é registrado", async () => {
    const espioes = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const conta = { id: 1985141462, nickname: "TESTUSER2054", email: "test_user_1@testuser.com", identification: { type: "CPF", number: "12345678909" } };
    const f = fetchFalso(json(200, { ...conta, tags: ["normal", "test_user"] }));
    expect(await cliente(f.impl).conferirContaDeTeste()).toBe(true);
    expect(f.pedidos[0].url.toString()).toBe("https://api.mercadopago.com/users/me");
    expect(f.pedidos[0].metodo).toBe("GET");
    expect(f.pedidos[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(await cliente(fetchFalso(json(200, { ...conta, tags: ["normal"] })).impl).conferirContaDeTeste()).toBe(false);
    expect(await cliente(fetchFalso(json(200, conta)).impl).conferirContaDeTeste()).toBeNull();
    for (const e of espioes) expect(e).not.toHaveBeenCalled();
  });

  it("qualquer falha → null, sem lançar", async () => {
    for (const r of [json(500, {}), json(401, {}), json(403, {}), json(429, {}), json(404, {}), new Response("x", { status: 200 }), new TypeError("fetch failed")]) {
      expect(await cliente(fetchFalso(r).impl).conferirContaDeTeste()).toBeNull();
    }
    expect(await cliente(fetchFalso().impl, { accessToken: "" }).conferirContaDeTeste()).toBeNull();
  });
});
