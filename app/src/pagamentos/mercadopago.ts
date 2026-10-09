/**
 * Cliente HTTP do Mercado Pago (M8.2): Checkout Transparente pela Orders API
 * (https://api.mercadopago.com/v1/orders), conferido na documentação oficial em 8/10/2026.
 * Taxa, líquido e liberação não existem na Orders: vêm da Payments API, procurando o pagamento
 * pela referência (`detalheFinanceiro`, ver o comentário lá).
 *
 * Segurança: o access token só vai no cabeçalho Authorization; nenhuma mensagem de erro repete
 * o corpo da resposta, o token, e-mails ou documentos (lista fechada `MENSAGENS`). Toda escrita
 * (POST) leva X-Idempotency-Key e NUNCA é repetida aqui dentro com outra chave: em dúvida, o
 * resultado é "incerto" e quem chama procura pela referência antes de tentar de novo.
 */
import { chaveIdempotenciaValida, emailPlausivel, ErroProvedor, idProvedorValido, problemaNoCartao, problemaNoPedido, referenciaValida, validadePixMinutos, valorPagoNaOrder } from "./provedor";
import type { Cobranca, DetalheFinanceiro, FormaPagamento, PedidoCartao, PedidoPix, ProvedorPagamento, ResultadoCancelamento, ResultadoCriacao, ResultadoDevolucao, SituacaoCobranca } from "./provedor";

const BASE = "https://api.mercadopago.com";
/** O sandbox só aceita e-mail de pagador @testuser.com (erro invalid_email_for_sandbox). */
export const EMAIL_PAGADOR_SANDBOX = "test@testuser.com";

type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
/** Código do provedor (status, status_detail, erro): minúsculo e curto, ou null. */
const codigo = (v: unknown): string | null => {
  const t = texto(v)?.toLowerCase() ?? null;
  return t && /^[a-z0-9_]{1,60}$/.test(t) ? t : null;
};

// ---------------------------------------------------------------- dinheiro

/** Centavos → "123.45", como a API espera (sem aritmética de ponto flutuante). */
export function centavosParaValorApi(centavos: number): string {
  if (!Number.isSafeInteger(centavos) || centavos < 0) throw new TypeError("Valor em centavos inválido.");
  const s = String(centavos).padStart(3, "0");
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

/**
 * "50", "50.0", "50.00", "50.000" ou o número 50.5 → centavos. null quando ausente, negativo,
 * com centavos fracionados (ex.: "1.005"), notação científica ou qualquer outro formato: nunca arredonda.
 */
export function valorApiParaCentavos(v: unknown): number | null {
  const t = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : typeof v === "string" ? v.trim() : "";
  const m = /^(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m) return null;
  const [, inteiro, frac = ""] = m;
  if (/[1-9]/.test(frac.slice(2))) return null;
  const centavos = Number(inteiro) * 100 + Number(frac.slice(0, 2).padEnd(2, "0"));
  return Number.isSafeInteger(centavos) ? centavos : null;
}

/** RFC 3339 sem milissegundos (formato pedido pela busca de orders, ex.: 2023-01-01T00:00:00Z). */
export const dataRfc3339 = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

const data = (v: unknown): Date | null => {
  const t = texto(v);
  if (!t || !/^\d{4}-\d{2}-\d{2}/.test(t)) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
};

// ---------------------------------------------------------------- situação

const ACAO_PENDENTE = new Set(["waiting_transfer", "waiting_payment", "pending_waiting_payment", "pending_challenge", "waiting_capture", "waiting_retry"]);

type ParSituacao = { status?: unknown; status_detail?: unknown };

/**
 * Situação normalizada a partir do status/status_detail da order (e da transação de pagamento,
 * quando existe). Aprovado SÓ com order processed/accredited e, havendo transação, ela também
 * processed/accredited. Qualquer combinação fora das tabelas da documentação vira `desconhecido`
 * (aviso), inclusive processed/refunded — que aparece no exemplo de devolução parcial e não é
 * documentado como situação da order.
 *
 * Tabelas: order (created, processed/accredited|partially_refunded, processing, action_required/
 * waiting_*, canceled/canceled|canceled_transaction|expired (3DS vencido), charged_back/
 * in_process|settled|reimbursed, expired, failed, refunded) e transação (processing/
 * pending_review_manual|in_review, in_review, action_required/pending_challenge, failed/<motivo>).
 */
export function normalizarSituacao(order: ParSituacao, transacao?: ParSituacao | null): SituacaoCobranca {
  const s = codigo(order.status);
  const d = codigo(order.status_detail);
  switch (s) {
    case "processed":
      if (d === "accredited") {
        if (transacao && !(codigo(transacao.status) === "processed" && codigo(transacao.status_detail) === "accredited")) return "desconhecido";
        return "aprovado";
      }
      return d === "partially_refunded" ? "devolvido_parcial" : "desconhecido";
    case "created":
      return "pendente";
    case "action_required":
      return d && ACAO_PENDENTE.has(d) ? "pendente" : "desconhecido";
    case "processing":
    case "in_review":
      return "em_analise";
    case "failed":
      return "recusado";
    case "canceled":
      return d === "expired" ? "expirado" : "cancelado";
    case "expired":
      return "expirado";
    case "refunded":
      return "devolvido";
    case "charged_back":
      return "contestado";
    default:
      return "desconhecido";
  }
}

/** "status/status_detail" da order (e "; pagamento status/detalhe" quando a transação diz outra coisa). Só códigos curtos. */
export function detalheDaOrder(order: ParSituacao, transacao?: ParSituacao | null): string {
  const par = (p: ParSituacao) => `${codigo(p.status) ?? "?"}/${codigo(p.status_detail) ?? "?"}`;
  const daOrder = par(order);
  if (!transacao) return daOrder;
  const daTransacao = par(transacao);
  return daTransacao === daOrder ? daOrder : `${daOrder}; pagamento ${daTransacao}`;
}

const RECUSAS: Record<string, string> = {
  bad_filled_card_data: "Confira os dados do cartão e tente de novo.",
  invalid_card_token: "Os dados do cartão expiraram ou são inválidos; preencha de novo.",
  high_risk: "Pagamento recusado pela análise de segurança. Tente outro cartão ou o Pix.",
  rejected_by_issuer: "O banco emissor recusou o pagamento. Tente outro cartão ou o Pix.",
  required_call_for_authorize: "O banco emissor pede autorização: ligue para o banco ou use outro cartão.",
  max_attempts_exceeded: "Limite de tentativas atingido. Use outro cartão ou o Pix.",
  card_disabled: "Cartão desabilitado. Ligue para o banco ou use outro cartão.",
  insufficient_amount: "Saldo ou limite insuficiente. Tente outro cartão ou o Pix.",
  card_insufficient_amount: "Saldo ou limite insuficiente. Tente outro cartão ou o Pix.",
  amount_limit_exceeded: "O valor passa do limite deste cartão. Tente outro cartão ou o Pix.",
  processing_error: "Erro ao processar o pagamento. Tente de novo.",
  invalid_installments: "Número de parcelas não aceito para este cartão.",
  "3ds_challenge_expired": "A verificação do banco não foi concluída a tempo.",
  cc_rejected_3ds_challenge: "A verificação do banco não foi concluída.",
};
const RECUSA_GENERICA = "Pagamento recusado. Tente outro cartão ou o Pix.";

/** Mensagem (lista fechada) para o primeiro motivo de recusa conhecido. */
export function mensagemRecusa(motivos: (string | null | undefined)[]): string {
  for (const m of motivos) {
    const c = codigo(m);
    if (c && Object.hasOwn(RECUSAS, c)) return RECUSAS[c];
  }
  return RECUSA_GENERICA;
}

const STATUS_DEVOLUCAO_CONFIRMADA = new Set(["processed", "approved"]);
/** Devolução que comprovadamente não aconteceu (não conta como "em andamento"). */
const STATUS_DEVOLUCAO_FALHA = new Set(["failed", "rejected", "canceled", "cancelled"]);

const formaDe = (pm: Obj | null): FormaPagamento | null => {
  const tipo = codigo(pm?.type);
  if (tipo === "bank_transfer" || codigo(pm?.id) === "pix") return "pix";
  if (tipo === "credit_card" || tipo === "debit_card" || tipo === "prepaid_card") return "cartao";
  return texto(pm?.qr_code) ? "pix" : null;
};

const linkSeguro = (v: unknown): string | null => {
  const t = texto(v);
  if (!t || t.length > 2000) return null;
  try {
    return new URL(t).protocol === "https:" ? t : null;
  } catch {
    return null;
  }
};

/**
 * Order da API → `Cobranca`. null quando não dá para ler o essencial (id ou total_amount).
 * `devolvido` soma só devoluções conhecidas e confirmadas (status processed — o único
 * documentado — ou approved, dos tipos do SDK); o GET da order nem documenta refunds[].
 * `devolucaoEmAndamento`: alguma devolução que não é confirmada nem comprovadamente falha
 * (in_process, pending ou situação desconhecida). `valorTransacao` = amount do pagamento.
 */
export function cobrancaDaOrder(dados: unknown): Cobranca | null {
  if (!obj(dados) || !idProvedorValido(dados.id)) return null;
  const valor = valorApiParaCentavos(dados.total_amount);
  if (valor === null) return null;
  const transacoes = obj(dados.transactions) ? dados.transactions : {};
  const pagamento = lista(transacoes.payments).find(obj) ?? null;
  const pm = pagamento && obj(pagamento.payment_method) ? pagamento.payment_method : null;
  const forma = formaDe(pm);
  let devolvido = 0;
  let devolucaoEmAndamento = false;
  for (const r of lista(transacoes.refunds)) {
    if (!obj(r)) continue;
    const status = codigo(r.status) ?? "";
    // Devolução que não é confirmada nem comprovadamente falha (in_process, pending, status estranho): em andamento.
    if (!STATUS_DEVOLUCAO_CONFIRMADA.has(status)) {
      if (!STATUS_DEVOLUCAO_FALHA.has(status)) devolucaoEmAndamento = true;
      continue;
    }
    devolvido += valorApiParaCentavos(r.amount) ?? 0;
  }
  const parcelas = pm && Number.isInteger(pm.installments) && (pm.installments as number) >= 1 && (pm.installments as number) <= 36 ? (pm.installments as number) : null;
  const copiaECola = texto(pm?.qr_code);
  const imagem = texto(pm?.qr_code_base64);
  return {
    idProvedor: dados.id,
    referencia: typeof dados.external_reference === "string" ? dados.external_reference : "",
    situacao: normalizarSituacao(dados, pagamento),
    detalhe: detalheDaOrder(dados, pagamento),
    forma,
    valor,
    valorTransacao: pagamento ? valorApiParaCentavos(pagamento.amount) : null,
    pago: valorApiParaCentavos(dados.total_paid_amount),
    devolvido,
    devolucaoEmAndamento,
    parcelas: forma === "pix" ? null : parcelas,
    idTransacao: pagamento && idProvedorValido(pagamento.id) ? pagamento.id : null,
    aoVivo: typeof dados.live_mode === "boolean" ? dados.live_mode : null,
    pix: forma === "pix" && copiaECola && copiaECola.length <= 4000
      ? {
          copiaECola,
          imagemBase64: imagem && /^[A-Za-z0-9+/=\s]+$/.test(imagem) ? imagem : null,
          link: linkSeguro(pm?.ticket_url),
          expiraEm: data(pagamento?.date_of_expiration) ?? data(pm?.date_of_expiration),
        }
      : null,
  };
}

// ---------------------------------------------------------------- financeiro (Payments API)

const NADA: DetalheFinanceiro = { taxa: null, liquido: null, liberacaoPrevista: null, liberado: null, idPagamento: null };

/**
 * Pagamento da Payments API → taxa, líquido e liberação.
 * - taxa: soma de fee_details[].amount das tarifas que NÃO são pagas pelo comprador (fee_payer
 *   "payer" é juro de parcelamento cobrado do hóspede, não custo da SCL); sem fee_details,
 *   transaction_amount − net_received_amount.
 * - liberado: true SÓ com aviso explícito do provedor (money_release_status "released"; a
 *   referência do GET /v1/payments diz que o próprio money_release_date pode valer
 *   "pending"/"released"). money_release_date é PREVISÃO: o relatório de dinheiro em conta
 *   documenta MONEY_RELEASE_DATE como "data de previsão da liberação" e IS_RELEASED à parte
 *   (https://www.mercadopago.com.br/developers/pt/docs/reports/account-money/report-fields).
 *   Data passada sem aviso explícito = null (desconhecido), nunca true.
 */
export function financeiroDoPagamento(pg: unknown): DetalheFinanceiro {
  if (!obj(pg)) return NADA;
  const detalhes = obj(pg.transaction_details) ? pg.transaction_details : {};
  const liquido = valorApiParaCentavos(detalhes.net_received_amount);
  let taxa: number | null = null;
  const tarifas = lista(pg.fee_details);
  if (tarifas.length) {
    let soma = 0;
    for (const t of tarifas) {
      if (!obj(t)) { soma = -1; break; }
      if (codigo(t.fee_payer) === "payer") continue;
      const v = valorApiParaCentavos(t.amount);
      if (v === null) { soma = -1; break; }
      soma += v;
    }
    if (soma >= 0) taxa = soma;
  }
  if (taxa === null) {
    const bruto = valorApiParaCentavos(pg.transaction_amount);
    if (bruto !== null && liquido !== null && bruto >= liquido) taxa = bruto - liquido;
  }
  const situacaoLiberacao = codigo(pg.money_release_status) ?? codigo(pg.money_release_date);
  const liberado = situacaoLiberacao === "released" ? true : situacaoLiberacao === "pending" ? false : null;
  const id = pg.id;
  return {
    taxa,
    liquido,
    liberacaoPrevista: data(pg.money_release_date),
    liberado,
    idPagamento: (typeof id === "number" && Number.isSafeInteger(id) && id > 0) || (typeof id === "string" && /^\d{1,30}$/.test(id)) ? String(id) : null,
  };
}

/**
 * Conta de teste: os documentos de usuários da plataforma (Mercado Libre, a mesma base de contas
 * do Mercado Pago) mostram contas de teste em GET /users/me e /users/{id} com "test_user" na
 * lista `tags` (https://developers.mercadolibre.com.ar/en_us/usuarios-y-aplicaciones e
 * …/vehicles-manage-users); os tipos do SDK mercadopago 3.6.1 (UserResponse) trazem `tags` sem
 * listar valores. É o sinal mais explícito que existe; apelido "TESTUSER…" e e-mail
 * "@testuser.com" aparecem só em exemplos, então NÃO bastam. Certeza: média — conferir no
 * sandbox. Lista sem "test_user" = false; sem lista = null. Só lê `tags`: nada da resposta é
 * guardado ou registrado (ela tem dados da conta).
 */
export function contaDeTesteDoUsuario(corpo: unknown): boolean | null {
  if (!obj(corpo) || !Array.isArray(corpo.tags)) return null;
  if (!corpo.tags.every((t) => typeof t === "string")) return null;
  return (corpo.tags as string[]).some((t) => t.trim().toLowerCase() === "test_user");
}

// ---------------------------------------------------------------- erros

/** Lista fechada de mensagens. Nada vindo do provedor entra aqui. */
export const MENSAGENS = {
  credencialFormato: "A chave de acesso do Mercado Pago está vazia ou tem caracteres inválidos.",
  credencialRecusada: "O Mercado Pago recusou a chave de acesso (ou a conta não tem permissão).",
  limite: "Limite de chamadas ao Mercado Pago atingido; tente de novo em instantes.",
  tempo: "O Mercado Pago não respondeu a tempo; o pedido pode ter sido recebido.",
  indisponivel: "Não deu para falar com o Mercado Pago (endereço ou conexão); nada foi enviado.",
  rede: "A conexão com o Mercado Pago caiu; o pedido pode ter sido recebido.",
  redirecionamento: "O Mercado Pago tentou redirecionar a chamada; o envio foi bloqueado.",
  erroServidor: "O Mercado Pago teve um erro interno; o pedido pode ter sido recebido.",
  formato: "Resposta do Mercado Pago em formato inesperado.",
  incertoCriacao: "Não deu para saber se o pagamento foi criado; conferir pela referência antes de tentar de novo.",
  buscaIndisponivel: "Não deu para buscar o pagamento pela referência no Mercado Pago.",
  emailSandbox: "No ambiente de teste, o e-mail do pagador precisa ser de teste (@testuser.com).",
  emailRecusado: "O Mercado Pago não aceitou este e-mail. Use outro e-mail.",
  emailInvalido: "E-mail do pagador inválido.",
  documentoInvalido: "Documento do pagador inválido.",
  parcelas: "Número de parcelas não aceito para este cartão.",
  cartao: "Os dados do cartão expiraram ou são inválidos; preencha de novo.",
  valor: "Valor inválido para o Mercado Pago.",
  validadePix: "Validade do Pix inválida.",
  dadosGenerico: "O Mercado Pago recusou os dados do pagamento.",
} as const;

const ANTES_DE_ENVIAR = new Set([
  "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT",
  "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/** Falha do fetch → ErroProvedor com mensagem da lista fechada (até error.cause pode conter dados do pedido). */
export function falhaDeRede(erro: unknown, estourouTempo: boolean): ErroProvedor {
  if (estourouTempo) return new ErroProvedor("incerto", MENSAGENS.tempo);
  const fila: unknown[] = [erro];
  const vistos = new Set<unknown>();
  for (let i = 0; i < fila.length && i < 12; i++) {
    const e = fila[i];
    if (!e || typeof e !== "object" || vistos.has(e)) continue;
    vistos.add(e);
    const c = e as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown; errors?: unknown };
    if (c.name === "TimeoutError" || c.name === "AbortError") return new ErroProvedor("incerto", MENSAGENS.tempo);
    if (typeof c.code === "string" && ANTES_DE_ENVIAR.has(c.code)) return new ErroProvedor("indisponivel", MENSAGENS.indisponivel);
    if (c.message === "unexpected redirect") return new ErroProvedor("incerto", MENSAGENS.redirecionamento);
    if (c.cause) fila.push(c.cause);
    if (Array.isArray(c.errors)) fila.push(...c.errors.slice(0, 8));
  }
  return new ErroProvedor("incerto", MENSAGENS.rede);
}

/** Códigos de erro do corpo (errors[].code, code, error, cause[].code), minúsculos; nunca saem daqui. */
export function codigosDeErro(corpo: unknown): Set<string> {
  const s = new Set<string>();
  const add = (v: unknown) => { const c = codigo(v); if (c) s.add(c); };
  if (!obj(corpo)) return s;
  add(corpo.code);
  add(corpo.error);
  for (const e of lista(corpo.errors).slice(0, 20)) if (obj(e)) add(e.code);
  for (const e of lista(corpo.cause).slice(0, 20)) if (obj(e)) add(e.code);
  return s;
}

/** Motivos citados nos detalhes do 402 ("pay_…: required_call_for_authorize"). */
const motivosDosDetalhes = (corpo: unknown): string[] => {
  if (!obj(corpo)) return [];
  const motivos: string[] = [];
  for (const e of lista(corpo.errors).slice(0, 20)) {
    if (!obj(e)) continue;
    for (const d of lista(e.details).slice(0, 20)) {
      if (typeof d !== "string" || d.length > 300) continue;
      const m = /:\s*([a-z0-9_]+)\s*$/i.exec(d);
      if (m) motivos.push(m[1]);
    }
  }
  return motivos;
};

/** O erro fala do e-mail do pagador? (só procura, nunca repete o texto) */
const erroCitaEmail = (corpo: unknown): boolean => {
  if (!obj(corpo)) return false;
  return lista(corpo.errors).slice(0, 20).some((e) => obj(e) && [e.message, ...lista(e.details)].some((t) => typeof t === "string" && /e-?mail/i.test(t.slice(0, 500))));
};

function mensagemDadosInvalidos(corpo: unknown): string {
  const c = codigosDeErro(corpo);
  if (c.has("invalid_email_for_sandbox")) return MENSAGENS.emailSandbox;
  if (c.has("property_value") && erroCitaEmail(corpo)) return MENSAGENS.emailRecusado;
  if (c.has("invalid_installments")) return MENSAGENS.parcelas;
  if (c.has("invalid_card_token") || c.has("card_token_not_found") || c.has("invalid_token")) return MENSAGENS.cartao;
  if (c.has("invalid_total_amount")) return MENSAGENS.valor;
  return MENSAGENS.dadosGenerico;
}

const retryAfter = (r: Response, agora: Date): number | null => {
  const v = r.headers.get("retry-after")?.trim();
  if (!v) return null;
  if (/^\d{1,6}$/.test(v)) return Number(v);
  const d = Date.parse(v);
  return Number.isNaN(d) ? null : Math.max(0, Math.ceil((d - agora.getTime()) / 1000));
};

// ---------------------------------------------------------------- cliente

type Opcoes = {
  accessToken: string;
  ambiente: "teste" | "producao";
  fetchImpl?: typeof fetch;
  agora?: () => Date;
  timeoutMs?: number;
};

type Resposta = { status: number; corpo: unknown };
type Chamada = { params?: Record<string, string>; corpo?: unknown; chave?: string; sessao?: string | null };

const tokenValido = (t: unknown): t is string => typeof t === "string" && /^[\x21-\x7E]{1,512}$/.test(t);
const cortar = (v: string | null | undefined, n: number) => (v ?? "").trim().slice(0, n);

/** Margem nas datas da busca por referência, contra diferença de relógio entre nós e o provedor. */
const MARGEM_BUSCA_MS = 5 * 60_000;

export class ClienteMercadoPagoHttp implements ProvedorPagamento {
  readonly nome = "mercadopago" as const;
  private readonly fetchImpl: typeof fetch;
  private readonly agora: () => Date;
  private readonly timeoutMs: number;
  private readonly accessToken: string;
  private readonly ambiente: "teste" | "producao";

  constructor(o: Opcoes) {
    this.accessToken = o.accessToken;
    this.ambiente = o.ambiente;
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.agora = o.agora ?? (() => new Date());
    this.timeoutMs = o.timeoutMs ?? 15_000;
  }

  /** Uma chamada, com tempo-limite cobrindo também a leitura do corpo. Lança só falha de transporte. */
  private async chamar(metodo: "GET" | "POST", caminho: string, c: Chamada = {}): Promise<Resposta> {
    if (!tokenValido(this.accessToken)) throw new ErroProvedor("credencial", MENSAGENS.credencialFormato);
    const url = new URL(BASE + caminho);
    for (const [k, v] of Object.entries(c.params ?? {})) url.searchParams.set(k, v);
    const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${this.accessToken}` };
    if (metodo === "POST") headers["X-Idempotency-Key"] = c.chave ?? "";
    if (c.sessao) headers["X-meli-session-id"] = c.sessao;
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), this.timeoutMs);
    try {
      let r: Response;
      try {
        r = await this.fetchImpl(url, {
          method: metodo,
          headers,
          ...(c.corpo !== undefined ? { body: JSON.stringify(c.corpo) } : {}),
          signal: controle.signal,
          cache: "no-store",
          redirect: "error",
        });
      } catch (e) {
        throw falhaDeRede(e, controle.signal.aborted);
      }
      if (r.status === 401 || r.status === 403) {
        await r.body?.cancel().catch(() => {});
        throw new ErroProvedor("credencial", MENSAGENS.credencialRecusada);
      }
      if (r.status === 429) {
        await r.body?.cancel().catch(() => {});
        throw new ErroProvedor("limite", MENSAGENS.limite, retryAfter(r, this.agora()));
      }
      let bruto: string;
      try {
        bruto = await r.text();
      } catch (e) {
        throw falhaDeRede(e, controle.signal.aborted);
      }
      let corpo: unknown = null;
      if (bruto) {
        try { corpo = JSON.parse(bruto); } catch { corpo = null; }
      }
      return { status: r.status, corpo };
    } finally {
      clearTimeout(relogio);
    }
  }

  private emailParaProvedor(email: string): string {
    return this.ambiente === "teste" ? EMAIL_PAGADOR_SANDBOX : email.trim();
  }

  /** Resposta do POST /v1/orders → resultado. `forma` completa a resposta quando ela vem sem o meio (os exemplos trazem null). */
  private resultadoCriacao(r: Resposta, forma: FormaPagamento): ResultadoCriacao {
    const ler = (dados: unknown) => {
      const c = cobrancaDaOrder(dados);
      return c && !c.forma ? { ...c, forma, parcelas: forma === "pix" ? null : c.parcelas } : c;
    };
    if (r.status === 200 || r.status === 201) {
      const c = ler(r.corpo);
      if (!c) return { ok: false, motivo: "incerto", mensagem: MENSAGENS.incertoCriacao, cobranca: null };
      // Order criada mas já recusada: mesmo desfecho do 402.
      if (c.situacao === "recusado") return { ok: false, motivo: "recusado", mensagem: mensagemRecusa(this.motivos(r.corpo)), cobranca: c };
      return { ok: true, cobranca: c };
    }
    if (r.status === 402) {
      const dados = obj(r.corpo) ? r.corpo.data : null;
      return { ok: false, motivo: "recusado", mensagem: mensagemRecusa([...motivosDosDetalhes(r.corpo), ...this.motivos(dados)]), cobranca: ler(dados) };
    }
    const codigos = codigosDeErro(r.corpo);
    if (r.status === 409 || r.status === 423 || (r.status >= 500 && codigos.has("idempotency_validation_failed"))) {
      return { ok: false, motivo: "incerto", mensagem: MENSAGENS.incertoCriacao, cobranca: null };
    }
    if (r.status >= 500) throw new ErroProvedor("incerto", MENSAGENS.erroServidor);
    if (r.status >= 400) return { ok: false, motivo: "dados_invalidos", mensagem: mensagemDadosInvalidos(r.corpo), cobranca: null };
    // 1xx/3xx inesperados: não dá para saber.
    return { ok: false, motivo: "incerto", mensagem: MENSAGENS.incertoCriacao, cobranca: null };
  }

  /** status_detail da order e da transação, para escolher a mensagem de recusa. */
  private motivos(dados: unknown): string[] {
    if (!obj(dados)) return [];
    const pagamento = lista(obj(dados.transactions) ? dados.transactions.payments : null).find(obj);
    return [pagamento?.status_detail, dados.status_detail].filter((v): v is string => typeof v === "string");
  }

  async criarPix(p: PedidoPix): Promise<ResultadoCriacao> {
    const invalido = (mensagem: string): ResultadoCriacao => ({ ok: false, motivo: "dados_invalidos", mensagem, cobranca: null });
    const problema = problemaNoPedido(p);
    if (problema) return invalido(problema);
    const validade = validadePixMinutos(p.validadeMinutos);
    if (validade === null) return invalido(MENSAGENS.validadePix);
    if (!emailPlausivel(p.email?.trim())) return invalido(MENSAGENS.emailInvalido);
    const valor = centavosParaValorApi(p.valor);
    const nome = cortar(p.nome, 60);
    const fatura = cortar(p.descricaoFatura, 50);
    const corpo = {
      type: "online",
      processing_mode: "automatic",
      total_amount: valor,
      external_reference: p.referencia,
      ...(cortar(p.descricao, 255) ? { description: cortar(p.descricao, 255) } : {}),
      payer: { email: this.emailParaProvedor(p.email), ...(nome ? { first_name: nome } : {}) },
      transactions: {
        payments: [{
          amount: valor,
          payment_method: { id: "pix", type: "bank_transfer", ...(fatura ? { statement_descriptor: fatura } : {}) },
          expiration_time: `PT${validade}M`,
        }],
      },
    };
    const r = await this.chamar("POST", "/v1/orders", { corpo, chave: p.chaveIdempotencia });
    return this.resultadoCriacao(r, "pix");
  }

  /**
   * Cartão: a Orders API não documenta o emissor (issuer_id) no pedido, então `emissor` não é
   * enviado (campo desconhecido dá 400 unsupported_properties). Débito vai sem parcelas, como no
   * exemplo da documentação.
   */
  async criarCartao(p: PedidoCartao): Promise<ResultadoCriacao> {
    const invalido = (mensagem: string): ResultadoCriacao => ({ ok: false, motivo: "dados_invalidos", mensagem, cobranca: null });
    const problema = problemaNoCartao(p);
    if (problema) return invalido(problema);
    if (!emailPlausivel(p.email?.trim())) return invalido(MENSAGENS.emailInvalido);
    let identificacao: { type: string; number: string } | null = null;
    if (p.documento) {
      const tipo = p.documento.tipo?.trim().toUpperCase() ?? "";
      const numero = (p.documento.numero ?? "").replace(/[^0-9A-Za-z]/g, "");
      if (!/^[A-Z]{2,10}$/.test(tipo) || !/^[0-9A-Za-z]{1,30}$/.test(numero)) return invalido(MENSAGENS.documentoInvalido);
      identificacao = { type: tipo, number: numero };
    }
    const sessao = typeof p.sessaoDispositivo === "string" && /^[\x21-\x7E]{1,256}$/.test(p.sessaoDispositivo) ? p.sessaoDispositivo : null;
    const valor = centavosParaValorApi(p.valor);
    const fatura = cortar(p.descricaoFatura, 50);
    const corpo = {
      type: "online",
      processing_mode: "automatic",
      total_amount: valor,
      external_reference: p.referencia,
      ...(cortar(p.descricao, 255) ? { description: cortar(p.descricao, 255) } : {}),
      payer: { email: this.emailParaProvedor(p.email), ...(identificacao ? { identification: identificacao } : {}) },
      transactions: {
        payments: [{
          amount: valor,
          payment_method: {
            id: p.bandeira,
            type: p.tipo,
            token: p.token,
            ...(p.tipo === "credit_card" ? { installments: p.parcelas } : {}),
            ...(fatura ? { statement_descriptor: fatura } : {}),
          },
        }],
      },
    };
    const r = await this.chamar("POST", "/v1/orders", { corpo, chave: p.chaveIdempotencia, sessao });
    return this.resultadoCriacao(r, "cartao");
  }

  async consultar(idProvedor: string): Promise<Cobranca | null> {
    if (!idProvedorValido(idProvedor)) return null;
    const r = await this.chamar("GET", `/v1/orders/${idProvedor}`);
    if (r.status === 404 || (r.status === 400 && codigosDeErro(r.corpo).has("invalid_path_param"))) return null;
    if (r.status >= 500) throw new ErroProvedor("incerto", MENSAGENS.erroServidor);
    if (r.status !== 200) throw new ErroProvedor("incerto", MENSAGENS.formato);
    const c = cobrancaDaOrder(r.corpo);
    if (!c) throw new ErroProvedor("incerto", MENSAGENS.formato);
    return c;
  }

  /**
   * A documentação diverge no caminho da busca: a referência diz GET /v1/orders (begin_date e
   * end_date obrigatórios, RFC 3339) e a visão geral, /v1/orders/search. Tenta o primeiro e, se
   * a rota não existir (404/405), o segundo. null SÓ quando uma busca respondeu e não trouxe a
   * referência; busca que não funciona lança (dizer "não existe" sem saber levaria a cobrar duas
   * vezes). A order achada é relida pelo GET /v1/orders/{id}, que é a fonte da situação.
   */
  async buscarPorReferencia(referencia: string, desde: Date): Promise<Cobranca | null> {
    if (!referenciaValida(referencia)) return null;
    const agora = this.agora().getTime();
    const inicio = Math.min(desde.getTime(), agora) - MARGEM_BUSCA_MS;
    const params = { external_reference: referencia, begin_date: dataRfc3339(new Date(inicio)), end_date: dataRfc3339(new Date(agora + MARGEM_BUSCA_MS)) };
    let r = await this.chamar("GET", "/v1/orders", { params });
    if (r.status === 404 || r.status === 405) r = await this.chamar("GET", "/v1/orders/search", { params });
    if (r.status >= 500) throw new ErroProvedor("incerto", MENSAGENS.erroServidor);
    if (r.status !== 200 || !obj(r.corpo)) throw new ErroProvedor("incerto", MENSAGENS.buscaIndisponivel);
    const itens = Array.isArray(r.corpo.data) ? r.corpo.data : Array.isArray(r.corpo.results) ? r.corpo.results : null;
    if (!itens) throw new ErroProvedor("incerto", MENSAGENS.buscaIndisponivel);
    const achada = itens.find((o): o is Obj => obj(o) && o.external_reference === referencia && idProvedorValido(o.id));
    if (!achada) return null;
    const completa = await this.consultar(achada.id as string);
    if (completa) return completa;
    const resumo = cobrancaDaOrder(achada);
    if (!resumo) throw new ErroProvedor("incerto", MENSAGENS.buscaIndisponivel);
    return resumo;
  }

  /**
   * INCERTO por natureza: a Orders não informa taxa, líquido nem liberação, e a ligação entre a
   * order (ORD…/PAY…) e o pagamento numérico da Payments API não é documentada. Procuramos em
   * GET /v1/payments/search pela mesma external_reference (filtro documentado) e usamos o mais
   * recente com a referência idêntica. Qualquer falha ou ausência = tudo null (o painel avisa).
   */
  async detalheFinanceiro(c: Cobranca): Promise<DetalheFinanceiro> {
    if (!referenciaValida(c.referencia)) return NADA;
    try {
      const r = await this.chamar("GET", "/v1/payments/search", { params: { external_reference: c.referencia, sort: "date_created", criteria: "desc" } });
      if (r.status !== 200 || !obj(r.corpo)) return NADA;
      const pg = lista(r.corpo.results).find((x) => obj(x) && x.external_reference === c.referencia);
      return pg ? financeiroDoPagamento(pg) : NADA;
    } catch {
      return NADA;
    }
  }

  /** Só cancela o que não foi pago (created/action_required). Nunca lança. */
  async cancelar(idProvedor: string, chaveIdempotencia: string): Promise<ResultadoCancelamento> {
    if (!idProvedorValido(idProvedor) || !chaveIdempotenciaValida(chaveIdempotencia)) return "erro";
    let r: Resposta;
    try {
      r = await this.chamar("POST", `/v1/orders/${idProvedor}/cancel`, { chave: chaveIdempotencia });
    } catch {
      return "erro";
    }
    if (r.status === 200 || r.status === 201) return "cancelado";
    if (r.status === 409) {
      const codigos = codigosDeErro(r.corpo);
      if (codigos.has("order_already_canceled")) return "cancelado";
      // Chave já usada: não dá para saber o desfecho; reconsultar a order.
      if (codigos.has("idempotency_key_already_used")) return "erro";
      return "nao_cancelavel";
    }
    return "erro";
  }

  /**
   * Integral: corpo vazio. Parcial: { transactions: [{ id: PAY…, amount }] }. Nunca lança:
   * falha de transporte vira `incerta` (repetir com a mesma chave depois de reconsultar).
   */
  async devolver(c: Cobranca, chaveIdempotencia: string, valor: number | null): Promise<ResultadoDevolucao> {
    const recusada = (mensagem: string): ResultadoDevolucao => ({ situacao: "recusada", idDevolucao: null, mensagem });
    const incerta = (mensagem: string): ResultadoDevolucao => ({ situacao: "incerta", idDevolucao: null, mensagem });
    if (!idProvedorValido(c.idProvedor)) return recusada("Pagamento sem identificação válida no Mercado Pago.");
    if (!chaveIdempotenciaValida(chaveIdempotencia)) return recusada("Chave de idempotência inválida.");
    if (valor !== null) {
      if (!Number.isSafeInteger(valor) || valor <= 0) return recusada("Valor da devolução inválido.");
      if (valor > valorPagoNaOrder(c) - c.devolvido) return recusada("O valor passa do que ainda pode ser devolvido.");
      if (!c.idTransacao || !idProvedorValido(c.idTransacao)) return recusada("Falta o id da transação para a devolução parcial.");
    }
    const corpo = valor === null ? {} : { transactions: [{ id: c.idTransacao, amount: centavosParaValorApi(valor) }] };
    let r: Resposta;
    try {
      r = await this.chamar("POST", `/v1/orders/${c.idProvedor}/refund`, { corpo, chave: chaveIdempotencia });
    } catch (e) {
      if (e instanceof ErroProvedor && e.tipo === "credencial") return recusada(e.message);
      return incerta(e instanceof ErroProvedor ? e.message : MENSAGENS.rede);
    }
    if (r.status === 200 || r.status === 201) {
      const devolucoes = lista(obj(r.corpo) && obj(r.corpo.transactions) ? r.corpo.transactions.refunds : null).filter(obj);
      const daTransacao = devolucoes.filter((d) => !c.idTransacao || d.transaction_id === undefined || d.transaction_id === c.idTransacao);
      const ultima = [...(daTransacao.length ? daTransacao : devolucoes)].reverse().find((d) => idProvedorValido(d.id));
      const idDevolucao = ultima ? (ultima.id as string) : null;
      const confirmadas = devolucoes.length > 0 && devolucoes.every((d) => STATUS_DEVOLUCAO_CONFIRMADA.has(codigo(d.status) ?? ""));
      return confirmadas
        ? { situacao: "confirmada", idDevolucao, mensagem: "Devolução confirmada pelo Mercado Pago." }
        : { situacao: "pedida", idDevolucao, mensagem: "Devolução pedida; aguardando confirmação do Mercado Pago." };
    }
    const codigos = codigosDeErro(r.corpo);
    if (r.status === 409) {
      if (codigos.has("order_refund_already_in_process")) return { situacao: "pedida", idDevolucao: null, mensagem: "Já há uma devolução em andamento para este pagamento." };
      if (codigos.has("order_already_refunded")) return { situacao: "confirmada", idDevolucao: null, mensagem: "O Mercado Pago informa que o pagamento já foi devolvido." };
      if (codigos.has("idempotency_key_already_used")) return incerta("Chave já usada: conferir a devolução no Mercado Pago antes de tentar de novo.");
      if (codigos.has("cannot_refund_order") || codigos.has("operation_not_supported")) return recusada("O Mercado Pago não permite devolver este pagamento agora.");
      return incerta("Resposta inesperada do Mercado Pago; conferir a devolução antes de tentar de novo.");
    }
    if (r.status === 400) return recusada(codigos.has("refund_amount_exceeds") ? "O valor passa do que ainda pode ser devolvido." : "O Mercado Pago recusou o pedido de devolução.");
    if (r.status === 404) return recusada("O Mercado Pago não encontrou o pagamento ou a transação.");
    if (r.status === 423) return incerta("Pedido de devolução travado no Mercado Pago; tentar de novo mais tarde com a mesma chave.");
    if (r.status >= 500) return incerta(codigos.has("idempotency_validation_failed") ? "Não deu para confirmar a devolução; conferir no Mercado Pago antes de tentar de novo." : MENSAGENS.erroServidor);
    return incerta("Resposta inesperada do Mercado Pago; conferir a devolução antes de tentar de novo.");
  }

  /** GET /users/me e o sinal `tags` contém "test_user" (ver `contaDeTesteDoUsuario`). Nunca lança nem registra a resposta. */
  async conferirContaDeTeste(): Promise<boolean | null> {
    try {
      const r = await this.chamar("GET", "/users/me");
      return r.status === 200 ? contaDeTesteDoUsuario(r.corpo) : null;
    } catch {
      return null;
    }
  }
}
