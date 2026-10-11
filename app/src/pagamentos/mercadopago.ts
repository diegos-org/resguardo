/**
 * Cliente HTTP do Mercado Pago (M8.2): Checkout Transparente pela Orders API
 * (https://api.mercadopago.com/v1/orders), conferido na documentação oficial em 8/10/2026 (cartão, 3DS,
 * contestações e liberação em parcelas: M8.2b, em 9/10/2026).
 * Taxa, líquido e liberação não existem na Orders: vêm da Payments API, procurando o pagamento
 * pela referência (`detalheFinanceiro`, ver o comentário lá).
 * Contestação (M8.2e, documentação relida em 11/10/2026): `transactions.chargebacks[]` da order (`contestacoesDaOrder`),
 * a Chargebacks API (`consultarContestacao`, `buscarContestacoes`, com o X-Caller-Id de GET /users/me) e a Payments
 * API pelo número (`situacaoDoPagamento`), tudo por lista branca: nunca `reason` em texto livre, `documentation` ou
 * `references`.
 *
 * Segurança: o access token só vai no cabeçalho Authorization; nenhuma mensagem de erro repete
 * o corpo da resposta, o token, e-mails ou documentos (lista fechada `MENSAGENS`). Toda escrita
 * (POST) leva X-Idempotency-Key e NUNCA é repetida aqui dentro com outra chave: em dúvida, o
 * resultado é "incerto" e quem chama procura pela referência antes de tentar de novo.
 */
import {
  chaveIdempotenciaValida, CODIGOS_TOKEN, emailPlausivel, ErroProvedor, estadoLidoDaContestacao, idContestacaoValido, idDevolucaoValido, idNumericoLido, idNumericoValido,
  idProvedorValido, liberadoPeloStatus, MAXIMO_CONTESTACOES_LIDAS, problemaNoCartao, problemaNoPedido, RECUSA_GENERICA, referenciaValida, SITUACOES_DOCUMENTACAO, STATUS_TRES_DS,
  TEMPO_LIMITE_CONTESTACAO_MS, urlDoDesafio, validadePixMinutos,
} from "./provedor";
import type {
  CasoDeContestacao, Cobranca, CodigoDevolucao, ContestacaoLida, DadosCartao, DetalheFinanceiro, DevolucaoLida, EstadoDevolucaoLida, FormaPagamento, OpcoesDevolucao, PedidoCartao,
  PedidoPix, ProvedorPagamento, ResultadoCancelamento, ResultadoCriacao, ResultadoDevolucao, SemAcessoContestacao, SituacaoCobranca, SituacaoDocumentacao, SituacaoDoPagamento,
  StatusTresDS,
} from "./provedor";

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
/**
 * Status de `transactions.chargebacks[]` que dão `contestado` em `normalizarSituacao` (M8.2b; o M8.2e não muda isso).
 * Pela página atual das Orders (11/10/2026), `reimbursed` é "o valor foi devolvido ao pagador depois da contestação" (a
 * SCL perdeu), e não "o dinheiro voltou à SCL", como dizia a página antiga em que este comentário se baseou; o sentido
 * está a conferir (item 61 do sandbox). Por isso a lista não decide nada sozinha: a situação que vale para o pagamento
 * sai de `contestacaoDaLeitura`, pelas contestações lidas (`Cobranca.contestacoes`) e confirmadas pela equipe.
 */
const CONTESTACAO_ABERTA = new Set(["in_process", "settled"]);

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
 *
 * Contestação (M8.2b; igual no M8.2e): é por transação. A transação charged_back/* ou uma contestação in_process/
 * settled em `transactions.chargebacks[]` (`contestacoes`, só os status) dão `contestado`, seja qual for a order. As
 * contestações em si (ids, estado, valor) vêm em `Cobranca.contestacoes` (`contestacoesDaOrder`).
 */
export function normalizarSituacao(order: ParSituacao, transacao?: ParSituacao | null, contestacoes: readonly string[] = []): SituacaoCobranca {
  if (transacao && codigo(transacao.status) === "charged_back") return "contestado";
  if (contestacoes.some((c) => CONTESTACAO_ABERTA.has(c))) return "contestado";
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

/**
 * Código do motivo de uma criação que falhou: o primeiro válido da lista (na ordem: detalhes do 402, status_detail da
 * transação e da order, códigos de erro), com os de token na frente — é o único que muda a resposta ao hóspede
 * ("preencha de novo"). A MENSAGEM de toda recusa é a mesma (`RECUSA_GENERICA`); o motivo só vai ao painel da equipe.
 */
export function primeiroCodigo(candidatos: Iterable<unknown>): string | null {
  const validos = [...candidatos].map((c) => codigo(c)).filter((c): c is string => c !== null);
  return validos.find((c) => (CODIGOS_TOKEN as readonly string[]).includes(c)) ?? validos[0] ?? null;
}

const STATUS_DEVOLUCAO_CONFIRMADA = new Set(["processed", "approved"]);
/** Devolução que comprovadamente não aconteceu (não conta como "em andamento"). */
const STATUS_DEVOLUCAO_FALHA = new Set(["failed", "rejected", "canceled", "cancelled"]);
/** Quantas devoluções da order a leitura guarda (em memória), no máximo. */
const MAXIMO_DEVOLUCOES_LIDAS = 20;

/** Status de uma devolução → estado, por lista branca (o que não é confirmado nem falha comprovada está em andamento). */
const estadoDaDevolucao = (status: unknown): EstadoDevolucaoLida => {
  const c = codigo(status) ?? "";
  return STATUS_DEVOLUCAO_CONFIRMADA.has(c) ? "confirmada" : STATUS_DEVOLUCAO_FALHA.has(c) ? "falhou" : "andamento";
};

/**
 * `transactions.refunds[]` → devoluções lidas: só os itens com id de devolução válido (REF…), no máximo 20; o valor em
 * centavos (ilegível = 0). Lê só id, status e amount: nunca e2e_id, reference_id ou qualquer outro campo.
 */
export function devolucoesDaLista(itens: unknown): DevolucaoLida[] {
  const lidas: DevolucaoLida[] = [];
  for (const r of lista(itens)) {
    if (lidas.length >= MAXIMO_DEVOLUCOES_LIDAS) break;
    if (!obj(r) || !idDevolucaoValido(r.id)) continue;
    lidas.push({ id: r.id, estado: estadoDaDevolucao(r.status), valor: valorApiParaCentavos(r.amount) ?? 0 });
  }
  return lidas;
}

/**
 * As contestações que a order mostra (M8.2e), por lista branca: de cada item de `transactions.chargebacks[]` (até 20,
 * só objetos), o id (CBK…), o `case_id` (texto com até 20 algarismos ou inteiro seguro; um número de 18 algarismos já
 * chegou arredondado e fica null), o `transaction_id` (só pista), o status e o `amount`. Nunca `references`, `reason`,
 * `documentation` ou qualquer texto livre. Sem item na lista, a transação (sem ela, a order) `charged_back/<detalhe>` dá
 * uma contestação sem identificação nem valor, com o estado pelo detalhe (`daTransacao`).
 */
export function contestacoesDaOrder(order: Obj, pagamento: Obj | null): ContestacaoLida[] {
  const transacoes = obj(order.transactions) ? order.transactions : {};
  const lidas: ContestacaoLida[] = [];
  for (const x of lista(transacoes.chargebacks).slice(0, MAXIMO_CONTESTACOES_LIDAS)) {
    if (!obj(x)) continue;
    const status = codigo(x.status);
    lidas.push({
      idContestacao: idContestacaoValido(x.id) ? x.id : null,
      idCaso: idNumericoLido(x.case_id),
      idTransacao: idProvedorValido(x.transaction_id) ? x.transaction_id : null,
      estadoLido: estadoLidoDaContestacao(status),
      codigo: status,
      valor: valorApiParaCentavos(x.amount),
      daTransacao: false,
    });
  }
  if (lidas.length) return lidas;
  const contestada = [pagamento, order].find((p): p is Obj => !!p && codigo(p.status) === "charged_back");
  if (!contestada) return [];
  const detalhe = codigo(contestada.status_detail);
  return [{ idContestacao: null, idCaso: null, idTransacao: null, estadoLido: estadoLidoDaContestacao(detalhe), codigo: detalhe, valor: null, daTransacao: true }];
}

const formaDe = (pm: Obj | null): FormaPagamento | null => {
  const tipo = codigo(pm?.type);
  if (tipo === "bank_transfer" || codigo(pm?.id) === "pix") return "pix";
  if (tipo === "credit_card" || tipo === "debit_card" || tipo === "prepaid_card") return "cartao";
  return texto(pm?.qr_code) ? "pix" : null;
};

/** Detalhes de transação em análise (manual ou automática); `in_review` também vem como status. */
const DETALHES_ANALISE = new Set(["in_review", "pending_review_manual"]);
const BANDEIRA = /^[a-z0-9_-]{1,40}$/;

/**
 * O que a order diz do cartão, por lista branca: desafio 3DS (e o endereço dele, só de domínio do Mercado Pago),
 * análise, resultado da verificação do banco (maiúsculo, lista fechada; a tabela de testes escreve minúsculo) e a
 * bandeira. Nunca lê first_six_digits, last_four_digits, cardholder, a identificação do pagador ou
 * `config.payment_method` (o installments_cost não é sinal confiável de "sem acréscimo").
 */
function dadosDoCartao(order: Obj, pagamento: Obj | null, pm: Obj | null): DadosCartao {
  const t = pagamento ?? order;
  const seguranca = pm && obj(pm.transaction_security) ? pm.transaction_security : null;
  const status = texto(seguranca?.status)?.toUpperCase() ?? null;
  const bandeira = texto(pm?.id)?.toLowerCase() ?? null;
  const emAnalise = (p: Obj | null) => !!p && (codigo(p.status) === "in_review" || DETALHES_ANALISE.has(codigo(p.status_detail) ?? ""));
  return {
    desafioUrl: urlDoDesafio(seguranca?.url),
    desafio: codigo(t.status) === "action_required" && codigo(t.status_detail) === "pending_challenge",
    analise: emAnalise(order) || emAnalise(pagamento),
    tresDSStatus: status && (STATUS_TRES_DS as readonly string[]).includes(status) ? (status as StatusTresDS) : null,
    bandeira: bandeira && BANDEIRA.test(bandeira) ? bandeira : null,
  };
}

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
 * documentado — ou approved, dos tipos do SDK). A referência do GET da Checkout Pro documenta
 * `transactions.refunds[]`; a da Checkout API não (conferir no sandbox, item 31). O exemplo de
 * resposta da devolução na Checkout API é uma order processed/refunded, que `normalizarSituacao`
 * lê de propósito como `desconhecido`: o domínio confirma uma devolução aceita pelo valor (M8.2c).
 * `devolucaoEmAndamento`: alguma devolução que não é confirmada nem comprovadamente falha
 * (in_process, pending ou situação desconhecida). `devolucoes`: os itens com id válido, por lista
 * branca de status (ver `devolucoesDaLista`). `valorTransacao` = amount do pagamento.
 * `formaPedida` completa a forma quando a resposta vem sem o meio (os exemplos da criação trazem null).
 * Contestações (M8.2e): `contestacoes` por lista branca (`contestacoesDaOrder`; antes, até o M8.2d, só o status era
 * lido) e `transacaoAprovada` (a transação, ou sem ela a order, processed/accredited: o fato "a transação voltou a
 * aprovada", nunca um resultado). `situacao` não muda: continua de `normalizarSituacao`.
 */
export function cobrancaDaOrder(dados: unknown, formaPedida: FormaPagamento | null = null): Cobranca | null {
  if (!obj(dados) || !idProvedorValido(dados.id)) return null;
  const valor = valorApiParaCentavos(dados.total_amount);
  if (valor === null) return null;
  const transacoes = obj(dados.transactions) ? dados.transactions : {};
  const pagamento = lista(transacoes.payments).find(obj) ?? null;
  const pm = pagamento && obj(pagamento.payment_method) ? pagamento.payment_method : null;
  const forma = formaDe(pm) ?? formaPedida;
  const contestacoes = lista(transacoes.chargebacks).slice(0, MAXIMO_CONTESTACOES_LIDAS).map((x) => (obj(x) ? codigo(x.status) : null)).filter((c): c is string => c !== null);
  const transacaoOuOrder = pagamento ?? dados;
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
    situacao: normalizarSituacao(dados, pagamento, contestacoes),
    detalhe: detalheDaOrder(dados, pagamento),
    forma,
    valor,
    valorTransacao: pagamento ? valorApiParaCentavos(pagamento.amount) : null,
    pago: valorApiParaCentavos(dados.total_paid_amount),
    devolvido,
    devolucaoEmAndamento,
    devolucoes: devolucoesDaLista(transacoes.refunds),
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
    cartao: forma === "cartao" ? dadosDoCartao(dados, pagamento, pm) : null,
    contestacoes: contestacoesDaOrder(dados, pagamento),
    transacaoAprovada: codigo(transacaoOuOrder.status) === "processed" && codigo(transacaoOuOrder.status_detail) === "accredited",
  };
}

// ---------------------------------------------------------------- financeiro (Payments API)

const NADA: DetalheFinanceiro = { taxa: null, liquido: null, liberacaoPrevista: null, liberado: null, idPagamento: null, liberacaoEmParcelas: false, custoParcelasVendedor: null };

/**
 * Custo do "parcelamento sem acréscimo" cobrado da SCL: soma das tarifas financing_fee com fee_payer diferente de
 * "payer". 0 = tarifas lidas e nenhuma assim; null = sem a lista ou com item ilegível (nunca palpite).
 */
function custoDoParcelamento(tarifas: unknown): number | null {
  if (!Array.isArray(tarifas)) return null;
  let soma = 0;
  for (const t of tarifas) {
    if (!obj(t)) return null;
    if (codigo(t.type) !== "financing_fee" || codigo(t.fee_payer) === "payer") continue;
    const v = valorApiParaCentavos(t.amount);
    if (v === null) return null;
    soma += v;
  }
  return soma;
}

/** money_release_schema com qualquer valor (ex.: "payment_in_flow"): o dinheiro sai parcela a parcela. Ausente, null ou vazio = de uma vez. */
function liberaEmParcelas(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  if (obj(v)) return Object.keys(v).length > 0;
  return true;
}

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
 * - liberação em parcelas (M8.2b): money_release_schema não vazio ⇒ `liberado` null e `liberacaoEmParcelas`;
 *   o recebimento nunca é lançado inteiro sozinho (a equipe registra à mão).
 * - custoParcelasVendedor: ver `custoDoParcelamento` (o custo já está dentro da `taxa`; quem decide é o domínio).
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
  const liberacaoEmParcelas = liberaEmParcelas(pg.money_release_schema);
  const liberado = liberacaoEmParcelas ? null : liberadoPeloStatus(situacaoLiberacao);
  return {
    taxa,
    liquido,
    liberacaoPrevista: data(pg.money_release_date),
    liberado,
    // O mesmo limite do caso (M8.2e: 20 algarismos, antes 30), num lugar só.
    idPagamento: idNumericoLido(pg.id),
    liberacaoEmParcelas,
    custoParcelasVendedor: custoDoParcelamento(pg.fee_details),
  };
}

// ---------------------------------------------------------------- contestação (Chargebacks API e Payments API pelo número, M8.2e)

const MOTIVO_ID = /^\d{1,6}$/;
/** O `reason` só passa como código: minúsculo, sem espaço, até 40. Uma frase (com nome ou não) nunca passa. */
const MOTIVO_CODIGO = /^[a-z][a-z0-9_]{0,39}$/;
const booleano = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/**
 * Um caso da Chargebacks API → `CasoDeContestacao`, por lista branca; null sem `id` legível (texto com até 20 algarismos
 * ou inteiro seguro: no exemplo oficial o id vem como texto de 18 algarismos, que como número já chegaria arredondado).
 * `payments[]` (até 20) só com números legíveis; `reason_id` só algarismos (até 6); `reason` só como código; as
 * coberturas só booleanas (a API escreve `coverage_elegible`); `documentation_status` da lista fechada (outro =
 * desconhecida). Nunca lê `documentation[]`, o `reason` em texto livre ou outro campo: nada da resposta é guardado inteiro.
 */
export function casoDaContestacao(dados: unknown): CasoDeContestacao | null {
  if (!obj(dados)) return null;
  const idCaso = idNumericoLido(dados.id);
  if (!idCaso) return null;
  const pagamentos = [...new Set(lista(dados.payments).slice(0, MAXIMO_CONTESTACOES_LIDAS).map(idNumericoLido).filter((x): x is string => x !== null))];
  const motivo = typeof dados.reason_id === "number" ? idNumericoLido(dados.reason_id) : dados.reason_id;
  const documentacao = codigo(dados.documentation_status);
  return {
    idCaso,
    pagamentos,
    valor: valorApiParaCentavos(dados.amount),
    motivoId: typeof motivo === "string" && MOTIVO_ID.test(motivo) ? motivo : null,
    motivoCodigo: typeof dados.reason === "string" && MOTIVO_CODIGO.test(dados.reason) ? dados.reason : null,
    coberturaAplicada: booleano(dados.coverage_applied),
    coberturaElegivel: booleano(dados.coverage_elegible) ?? booleano(dados.coverage_eligible),
    documentacao:
      dados.documentation_status === undefined || dados.documentation_status === null
        ? null
        : documentacao !== null && (SITUACOES_DOCUMENTACAO as readonly string[]).includes(documentacao)
          ? (documentacao as SituacaoDocumentacao)
          : "desconhecida",
    prazoDocumentacao: data(dados.date_documentation_deadline),
    criadoEm: data(dados.date_created),
    atualizadoEm: data(dados.date_last_updated),
    aoVivo: booleano(dados.live_mode),
  };
}

/** Payments API pelo número → só `status`, `status_detail` e `money_release_status`, como códigos curtos (ou null). */
export function situacaoDoPagamentoLida(pg: unknown): SituacaoDoPagamento {
  if (!obj(pg)) return { status: null, statusDetail: null, moneyReleaseStatus: null };
  return { status: codigo(pg.status), statusDetail: codigo(pg.status_detail), moneyReleaseStatus: codigo(pg.money_release_status) };
}

/**
 * O id da conta (o X-Caller-Id da Chargebacks API) no corpo de GET /users/me: só o `id`, só algarismos e inteiro seguro
 * (número, ou texto que vira um). Nada mais da resposta é lido (ela tem dados da conta).
 */
export function idDaContaDoUsuario(corpo: unknown): string | null {
  if (!obj(corpo)) return null;
  const id = idNumericoLido(corpo.id);
  return id && Number.isSafeInteger(Number(id)) && Number(id) > 0 ? id : null;
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
  semIdDaConta: "Não deu para ler o id da conta no Mercado Pago (para consultar as contestações).",
  contestacaoIndisponivel: "Não deu para ler as contestações no Mercado Pago.",
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
type Chamada = {
  params?: Record<string, string>;
  corpo?: unknown;
  chave?: string;
  sessao?: string | null;
  /** Cabeçalhos a mais, por lista branca (M8.2e): só o X-Caller-Id da Chargebacks API, só algarismos. */
  cabecalhos?: { "X-Caller-Id"?: string };
  /** Status que voltam ao método em vez de lançar (M8.2e, a Chargebacks API: 403 = sem acesso, 404). 401 é sempre credencial. */
  aceitar?: readonly (403 | 404)[];
  /** Tempo-limite desta chamada, em ms (nunca mais que o do cliente). */
  tempoMs?: number;
};

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
  /** O id da conta (X-Caller-Id), lido de GET /users/me uma vez e guardado só em memória. */
  private idConta: string | null = null;
  private idContaEmAndamento: Promise<string> | null = null;

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
    const chamador = c.cabecalhos?.["X-Caller-Id"];
    if (chamador !== undefined) {
      if (!idNumericoValido(chamador)) throw new ErroProvedor("incerto", MENSAGENS.semIdDaConta);
      headers["X-Caller-Id"] = chamador;
    }
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), Math.min(this.timeoutMs, c.tempoMs ?? this.timeoutMs));
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
      if (r.status === 401 || (r.status === 403 && !c.aceitar?.includes(403))) {
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

  /**
   * Resposta do POST /v1/orders → resultado. `forma` completa a resposta quando ela vem sem o meio (os exemplos trazem
   * null). Toda recusa leva a mesma mensagem (`RECUSA_GENERICA`); o motivo vai em `codigo` (ver `primeiroCodigo`).
   */
  private resultadoCriacao(r: Resposta, forma: FormaPagamento): ResultadoCriacao {
    const ler = (dados: unknown) => cobrancaDaOrder(dados, forma);
    const incerto = (codigo: string | null = null): ResultadoCriacao => ({ ok: false, motivo: "incerto", mensagem: MENSAGENS.incertoCriacao, cobranca: null, codigo });
    if (r.status === 200 || r.status === 201) {
      const c = ler(r.corpo);
      if (!c) return incerto();
      // Order criada mas já recusada: mesmo desfecho do 402.
      if (c.situacao === "recusado") return { ok: false, motivo: "recusado", mensagem: RECUSA_GENERICA, cobranca: c, codigo: primeiroCodigo(this.motivos(r.corpo)) };
      return { ok: true, cobranca: c };
    }
    const codigos = codigosDeErro(r.corpo);
    if (r.status === 402) {
      // Order criada e transação recusada; sem `data`, a recusa vem sem a order (nada foi cobrado, mas o banco viu o cartão).
      const dados = obj(r.corpo) ? r.corpo.data : null;
      return { ok: false, motivo: "recusado", mensagem: RECUSA_GENERICA, cobranca: ler(dados), codigo: primeiroCodigo([...motivosDosDetalhes(r.corpo), ...this.motivos(dados), ...codigos]) };
    }
    if (r.status === 409 || r.status === 423 || (r.status >= 500 && codigos.has("idempotency_validation_failed"))) return incerto(primeiroCodigo(codigos));
    if (r.status >= 500) throw new ErroProvedor("incerto", MENSAGENS.erroServidor);
    if (r.status >= 400) return { ok: false, motivo: "dados_invalidos", mensagem: mensagemDadosInvalidos(r.corpo), cobranca: null, codigo: primeiroCodigo(codigos) };
    // 1xx/3xx inesperados: não dá para saber.
    return incerto();
  }

  /** status_detail da transação e da order, para o código do motivo da recusa. */
  private motivos(dados: unknown): string[] {
    if (!obj(dados)) return [];
    const pagamento = lista(obj(dados.transactions) ? dados.transactions.payments : null).find(obj);
    return [pagamento?.status_detail, dados.status_detail].filter((v): v is string => typeof v === "string");
  }

  async criarPix(p: PedidoPix): Promise<ResultadoCriacao> {
    const invalido = (mensagem: string): ResultadoCriacao => ({ ok: false, motivo: "dados_invalidos", mensagem, cobranca: null, codigo: null });
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
   * exemplo da documentação. `capture_mode` vai explícito ("automatic": sem ele, o exemplo da
   * documentação voltou "automatic_async"); a verificação do banco (3DS) vai em
   * config.online.transaction_security — com "never", sem liability_shift (a documentação proíbe).
   * O token e o documento existem só nesta chamada: nada aqui guarda ou registra os dois.
   */
  async criarCartao(p: PedidoCartao): Promise<ResultadoCriacao> {
    const invalido = (mensagem: string): ResultadoCriacao => ({ ok: false, motivo: "dados_invalidos", mensagem, cobranca: null, codigo: null });
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
      capture_mode: "automatic",
      total_amount: valor,
      external_reference: p.referencia,
      ...(cortar(p.descricao, 255) ? { description: cortar(p.descricao, 255) } : {}),
      payer: { email: this.emailParaProvedor(p.email), ...(identificacao ? { identification: identificacao } : {}) },
      config: { online: { transaction_security: p.tresDS === "never" ? { validation: "never" } : { validation: "on_fraud_risk", liability_shift: "required" } } },
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

  /** GET /v1/payments/search pela external_reference, os mais recentes primeiro. */
  private buscarPagamentos(referencia: string): Promise<Resposta> {
    return this.chamar("GET", "/v1/payments/search", { params: { external_reference: referencia, sort: "date_created", criteria: "desc" } });
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
      const r = await this.buscarPagamentos(c.referencia);
      if (r.status !== 200 || !obj(r.corpo)) return NADA;
      const pg = lista(r.corpo.results).find((x) => obj(x) && x.external_reference === c.referencia);
      return pg ? financeiroDoPagamento(pg) : NADA;
    } catch {
      return NADA;
    }
  }

  /**
   * A mesma busca do `detalheFinanceiro`, mas aqui a falha LANÇA: só um 200 legível sem a referência idêntica diz
   * "não existe" (um cartão sem order conhecida pode já ter sido cobrado, D18). A data não entra na busca (a lista vem
   * dos mais recentes para os mais antigos). Referência inválida = false sem rede (nunca criamos uma assim).
   */
  async existePagamentoPorReferencia(referencia: string, _desde: Date): Promise<boolean> {
    void _desde; // A Payments API não filtra por data nesta busca (a referência é única por tentativa).
    if (!referenciaValida(referencia)) return false;
    const r = await this.buscarPagamentos(referencia);
    if (r.status >= 500) throw new ErroProvedor("incerto", MENSAGENS.erroServidor);
    if (r.status !== 200 || !obj(r.corpo) || !Array.isArray(r.corpo.results)) throw new ErroProvedor("incerto", MENSAGENS.buscaIndisponivel);
    return r.corpo.results.some((x) => obj(x) && x.external_reference === referencia);
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
   * Integral: corpo vazio. Parcial: { transactions: [{ id: PAY…, amount }] }. Nunca lança: falha de transporte vira
   * `incerta` (repetir com a mesma chave depois de reconsultar). Num valor explícito não há limite local (M8.2d): o domínio
   * confere o limite sob a trava, contra o pago congelado na aprovação, e o `refund_amount_exceeds` do Mercado Pago é a
   * última barreira (o `total_paid_amount` depois de uma devolução não é documentado). Respostas (documentação de
   * 9 e 10/10/2026; `codigo` só da lista fechada, nunca do texto do provedor):
   * - 200/201: a nossa devolução é a única listada que não estava na leitura de antes do pedido (`c.devolucoes`) nem entre as
   *   conhecidas do banco (`o.conhecidas`); nenhuma ou mais de uma = null (nunca "a última da lista"). Com a chave repetida
   *   (`o.repetida`) e nenhuma nova, a resposta é a repetição da do pedido anterior com esta chave: a única listada que o
   *   banco não conhece é a dele. `confirmada` só com a NOSSA devolução processada (as outras da order não contam); sem
   *   saber qual é a nossa, `pedida` (a leitura confirma).
   * - order_refund_already_in_process ou refund_in_progress (qualquer status): aguarde/em_andamento — há uma devolução em
   *   curso que não é deste pedido; movement_operations_pending, 425 e 423: aguarde/transitorio.
   * - 409 order_already_refunded: integral, confirmada; parte do valor com a chave repetida, incerta (o pedido anterior
   *   provavelmente completou a order: a leitura decide); parte do valor com chave nova, recusada/ja_devolvido.
   * - 409 cannot_refund_order ou operation_not_supported, 400 unsupported_partially_refunds, 422 payment_not_refundable ou
   *   max_refunds_exceeded: recusada/nao_permitido; 422 amount_not_refundable e 400 refund_amount_exceeds:
   *   recusada/valor_excede (o Mercado Pago aceita outro valor); refund_period_exceeded (400/409): recusada/prazo; 428 ou
   *   insufficient_money_for_refund: recusada/saldo_insuficiente; outro 400: recusada sem código; 404: recusada/nao_encontrado.
   * - 409 idempotency_key_already_used (ou outro 409), outro 422, 5xx, 429 e rede: incerta.
   */
  async devolver(c: Cobranca, chaveIdempotencia: string, valor: number | null, o: OpcoesDevolucao = { repetida: false, conhecidas: [] }): Promise<ResultadoDevolucao> {
    const recusada = (mensagem: string, codigo: CodigoDevolucao | null = null): ResultadoDevolucao => ({ situacao: "recusada", idDevolucao: null, mensagem, codigo });
    const incerta = (mensagem: string): ResultadoDevolucao => ({ situacao: "incerta", idDevolucao: null, mensagem, codigo: null });
    const aguarde = (codigo: "em_andamento" | "transitorio"): ResultadoDevolucao => ({
      situacao: "aguarde",
      idDevolucao: null,
      mensagem: codigo === "em_andamento" ? "Já há uma devolução em andamento para este pagamento: aguardar o Mercado Pago concluir." : "O Mercado Pago pediu para esperar antes de devolver; tentar de novo mais tarde com a mesma chave.",
      codigo,
    });
    if (!idProvedorValido(c.idProvedor)) return recusada("Pagamento sem identificação válida no Mercado Pago.");
    if (!chaveIdempotenciaValida(chaveIdempotencia)) return recusada("Chave de idempotência inválida.");
    if (valor !== null) {
      if (!Number.isSafeInteger(valor) || valor <= 0) return recusada("Valor da devolução inválido.");
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
      // A resposta pode listar todas as devoluções da order: a nossa é a que nem a leitura de antes nem o banco conheciam.
      const itens = daTransacao.length ? daTransacao : devolucoes;
      const doBanco = new Set(o.conhecidas);
      const conhecidas = new Set([...c.devolucoes.map((d) => d.id), ...o.conhecidas]);
      const listadas = [...new Set(itens.map((d) => d.id).filter(idDevolucaoValido))];
      const novas = listadas.filter((id) => !conhecidas.has(id));
      // Chave repetida sem nada novo: o Mercado Pago repetiu a resposta do pedido anterior (a única que o banco não conhece).
      const foraDoBanco = listadas.filter((id) => !doBanco.has(id));
      const idDevolucao = novas.length === 1 ? novas[0] : o.repetida && novas.length === 0 && foraDoBanco.length === 1 ? foraDoBanco[0] : null;
      const nossa = idDevolucao ? itens.find((d) => d.id === idDevolucao) : undefined;
      return nossa && STATUS_DEVOLUCAO_CONFIRMADA.has(codigo(nossa.status) ?? "")
        ? { situacao: "confirmada", idDevolucao, mensagem: "Devolução confirmada pelo Mercado Pago.", codigo: null }
        : { situacao: "pedida", idDevolucao, mensagem: "Devolução pedida; aguardando confirmação do Mercado Pago.", codigo: null };
    }
    const codigos = codigosDeErro(r.corpo);
    if (codigos.has("order_refund_already_in_process") || codigos.has("refund_in_progress")) return aguarde("em_andamento");
    if (codigos.has("movement_operations_pending") || r.status === 425 || r.status === 423) return aguarde("transitorio");
    if (r.status === 404) return recusada("O Mercado Pago não encontrou o pagamento ou a transação.", "nao_encontrado");
    if (r.status === 428 || codigos.has("insufficient_money_for_refund")) return recusada("O Mercado Pago pediu saldo disponível na conta para fazer a devolução.", "saldo_insuficiente");
    if ((r.status === 400 || r.status === 409) && codigos.has("refund_period_exceeded")) return recusada("O prazo para devolver este pagamento pelo Mercado Pago acabou.", "prazo");
    if ((r.status === 400 || r.status === 422) && (codigos.has("unsupported_partially_refunds") || codigos.has("payment_not_refundable") || codigos.has("max_refunds_exceeded"))) {
      return recusada("O Mercado Pago não permite devolver este pagamento (ou mais uma parte dele) pelo sistema.", "nao_permitido");
    }
    if ((r.status === 400 || r.status === 422) && (codigos.has("refund_amount_exceeds") || codigos.has("amount_not_refundable"))) return recusada("O valor passa do que ainda pode ser devolvido.", "valor_excede");
    if (r.status === 409) {
      if (codigos.has("order_already_refunded")) {
        if (valor === null) return { situacao: "confirmada", idDevolucao: null, mensagem: "O Mercado Pago informa que o pagamento já foi devolvido.", codigo: null };
        // Parte do valor: com a chave repetida, o pedido anterior provavelmente completou a order (a leitura decide).
        if (o.repetida) return incerta("O Mercado Pago informa que o pagamento já foi devolvido inteiro: conferir pela leitura se foi este pedido.");
        return recusada("O Mercado Pago informa que o pagamento já foi devolvido inteiro: conferir pela leitura antes de pedir de novo.", "ja_devolvido");
      }
      if (codigos.has("idempotency_key_already_used")) return incerta("Chave já usada: conferir a devolução no Mercado Pago antes de tentar de novo.");
      if (codigos.has("cannot_refund_order") || codigos.has("operation_not_supported")) return recusada("O Mercado Pago não permite devolver este pagamento agora.", "nao_permitido");
      return incerta("Resposta inesperada do Mercado Pago; conferir a devolução antes de tentar de novo.");
    }
    if (r.status === 400) return recusada("O Mercado Pago recusou o pedido de devolução.");
    if (r.status >= 500) return incerta(codigos.has("idempotency_validation_failed") ? "Não deu para confirmar a devolução; conferir no Mercado Pago antes de tentar de novo." : MENSAGENS.erroServidor);
    return incerta("Resposta inesperada do Mercado Pago; conferir a devolução antes de tentar de novo.");
  }

  /**
   * O X-Caller-Id: o id da conta em GET /users/me (`idDaContaDoUsuario`), lido uma vez (chamadas simultâneas esperam a
   * mesma leitura) e guardado só em memória, neste cliente. Sem ele, a Chargebacks API não é chamada: lança `ErroProvedor`.
   * O `user_id` do corpo de um aviso (não assinado) nunca serve. `tempoMs`: o que sobra do prazo de quem chama.
   */
  private idDaConta(tempoMs: number = TEMPO_LIMITE_CONTESTACAO_MS): Promise<string> {
    if (this.idConta) return Promise.resolve(this.idConta);
    this.idContaEmAndamento ??= (async () => {
      try {
        const r = await this.chamar("GET", "/users/me", { tempoMs });
        if (r.status >= 500) throw new ErroProvedor("incerto", MENSAGENS.erroServidor);
        const id = r.status === 200 ? idDaContaDoUsuario(r.corpo) : null;
        if (!id) throw new ErroProvedor("incerto", MENSAGENS.semIdDaConta);
        this.idConta = id;
        return id;
      } finally {
        this.idContaEmAndamento = null;
      }
    })();
    return this.idContaEmAndamento;
  }

  /**
   * GET na Chargebacks API: sempre com o X-Caller-Id, 403 e 404 voltam ao método. O tempo-limite de 8 s vale para o método
   * inteiro: num cliente novo, a leitura do id da conta (GET /users/me) sai do mesmo prazo, e o pedido à Chargebacks API fica
   * com o que sobrar. Assim cada chamada do provedor cabe nos 8 s que o orçamento da rotina conta.
   */
  private async chamarContestacoes(caminho: string, params?: Record<string, string>): Promise<Resposta> {
    const prazo = Date.now() + TEMPO_LIMITE_CONTESTACAO_MS;
    const conta = await this.idDaConta(TEMPO_LIMITE_CONTESTACAO_MS);
    const resta = prazo - Date.now();
    if (resta <= 0) throw new ErroProvedor("incerto", MENSAGENS.tempo);
    return this.chamar("GET", caminho, { params, cabecalhos: { "X-Caller-Id": conta }, aceitar: [403, 404], tempoMs: resta });
  }

  /**
   * GET /v1/chargebacks/{id} (M8.2e). 403 = `{ semAcesso: true }` (a equipe confere no painel do Mercado Pago); 404 =
   * null; o caso lido precisa ter o mesmo id pedido. Id que não pode existir = null, sem rede. 401, 5xx, outro status e
   * resposta ilegível lançam.
   */
  async consultarContestacao(idCaso: string): Promise<CasoDeContestacao | null | SemAcessoContestacao> {
    if (!idNumericoValido(idCaso)) return null;
    const r = await this.chamarContestacoes(`/v1/chargebacks/${idCaso}`);
    if (r.status === 403) return { semAcesso: true };
    if (r.status === 404) return null;
    if (r.status >= 500) throw new ErroProvedor("incerto", MENSAGENS.erroServidor);
    if (r.status !== 200) throw new ErroProvedor("incerto", MENSAGENS.contestacaoIndisponivel);
    const caso = casoDaContestacao(r.corpo);
    if (!caso || caso.idCaso !== idCaso) throw new ErroProvedor("incerto", MENSAGENS.formato);
    return caso;
  }

  /**
   * GET /v1/chargebacks/search?payment_id= (M8.2e). A lista vem em `results` (ou `data`, ou o corpo é a lista); até 20.
   * 403 = `{ semAcesso: true }`. 404 (rota inexistente), 5xx, outro status, corpo sem lista ou um item sem id legível
   * lançam: nunca "nenhuma" sem saber. Número que não pode existir = lista vazia, sem rede.
   */
  async buscarContestacoes(idPagamento: string): Promise<CasoDeContestacao[] | SemAcessoContestacao> {
    if (!idNumericoValido(idPagamento)) return [];
    const r = await this.chamarContestacoes("/v1/chargebacks/search", { payment_id: idPagamento });
    if (r.status === 403) return { semAcesso: true };
    if (r.status >= 500) throw new ErroProvedor("incerto", MENSAGENS.erroServidor);
    if (r.status !== 200) throw new ErroProvedor("incerto", MENSAGENS.contestacaoIndisponivel);
    const corpo = r.corpo;
    const itens = Array.isArray(corpo) ? corpo : obj(corpo) ? (Array.isArray(corpo.results) ? corpo.results : Array.isArray(corpo.data) ? corpo.data : null) : null;
    if (!itens) throw new ErroProvedor("incerto", MENSAGENS.formato);
    const casos: CasoDeContestacao[] = [];
    for (const x of itens.slice(0, MAXIMO_CONTESTACOES_LIDAS)) {
      const caso = casoDaContestacao(x);
      if (!caso) throw new ErroProvedor("incerto", MENSAGENS.formato);
      casos.push(caso);
    }
    return casos;
  }

  /**
   * GET /v1/payments/{id} (M8.2e): só `status`, `status_detail` e `money_release_status` (`situacaoDoPagamentoLida`),
   * com tempo-limite de 8 s. 404 = null (se a Payments API responde para pagamentos antigos é o item 72); número que não
   * pode existir = null, sem rede. A resposta precisa ser do mesmo número; 401/403, 5xx, outro status e ilegível lançam.
   */
  async situacaoDoPagamento(idPagamento: string): Promise<SituacaoDoPagamento | null> {
    if (!idNumericoValido(idPagamento)) return null;
    const r = await this.chamar("GET", `/v1/payments/${idPagamento}`, { aceitar: [404], tempoMs: TEMPO_LIMITE_CONTESTACAO_MS });
    if (r.status === 404) return null;
    if (r.status >= 500) throw new ErroProvedor("incerto", MENSAGENS.erroServidor);
    if (r.status !== 200 || !obj(r.corpo) || idNumericoLido(r.corpo.id) !== idPagamento) throw new ErroProvedor("incerto", MENSAGENS.formato);
    return situacaoDoPagamentoLida(r.corpo);
  }

  /**
   * GET /users/me e o sinal `tags` contém "test_user" (ver `contaDeTesteDoUsuario`). Nunca lança nem registra a resposta;
   * só o id da conta (o X-Caller-Id, `idDaContaDoUsuario`) fica em memória neste cliente.
   */
  async conferirContaDeTeste(): Promise<boolean | null> {
    try {
      const r = await this.chamar("GET", "/users/me");
      if (r.status !== 200) return null;
      this.idConta = idDaContaDoUsuario(r.corpo) ?? this.idConta;
      return contaDeTesteDoUsuario(r.corpo);
    } catch {
      return null;
    }
  }
}
