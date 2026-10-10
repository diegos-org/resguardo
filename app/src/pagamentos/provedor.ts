/**
 * Pagamento no site (M8.2) — contrato INTERNO com o provedor, já normalizado. O resto do
 * sistema só enxerga isto; o formato do Mercado Pago fica isolado em `mercadopago.ts`, e a
 * versão falsa (`falso.ts`) serve aos testes e ao desenvolvimento. Dinheiro em centavos.
 *
 * Regra geral: desfecho de negócio (recusado, dados inválidos, não cancelável…) é valor de
 * retorno; falha de transporte (rede, tempo-limite, credencial, limite de chamadas) é
 * `ErroProvedor`. As mensagens são de uma lista fechada em português: nunca repetem o corpo
 * da resposta do provedor, tokens, e-mails ou documentos.
 */

/** Situação normalizada da cobrança. `desconhecido` vira aviso, nunca palpite. */
export type SituacaoCobranca =
  | "pendente"
  | "em_analise"
  | "aprovado"
  | "recusado"
  | "cancelado"
  | "expirado"
  | "devolvido"
  | "devolvido_parcial"
  | "contestado"
  | "desconhecido";

export type FormaPagamento = "pix" | "cartao";

/**
 * Verificação do banco (3DS) pedida na criação do cartão (M8.2b): `on_fraud_risk` (o banco pede a verificação só nos
 * pagamentos arriscados) ou `never`. "Sempre" não existe na Orders API do Brasil.
 */
export const MODOS_TRES_DS = ["on_fraud_risk", "never"] as const;
export type ModoTresDS = (typeof MODOS_TRES_DS)[number];
/** Resultado da verificação do banco (transaction_security.status), lista fechada da documentação. */
export const STATUS_TRES_DS = ["AUTHENTICATED", "NOT_AUTHENTICATED", "CHALLENGE", "ATTEMPTED", "REJECTED", "ERROR"] as const;
export type StatusTresDS = (typeof STATUS_TRES_DS)[number];

/** O que a order diz do cartão (M8.2b). Nunca BIN, últimos dígitos, titular ou documento: a leitura nem olha esses campos. */
export type DadosCartao = {
  /** URL do desafio 3DS (só https de domínio do Mercado Pago, ver `urlDoDesafio`). Só a resposta da criação traz (o GET não documenta). */
  desafioUrl: string | null;
  /** A transação está em action_required/pending_challenge (o banco pediu a verificação ao hóspede). */
  desafio: boolean;
  /** A transação está em análise (in_review | pending_review_manual), não só processando. */
  analise: boolean;
  tresDSStatus: StatusTresDS | null;
  /** payment_method_id (visa, master, elo…), minúsculo. */
  bandeira: string | null;
};

export type DadosPix = {
  /** Texto do "copia e cola". */
  copiaECola: string;
  /** Imagem do QR em base64 (sem o prefixo data:); null quando o provedor não mandou (o sandbox às vezes manda ""). */
  imagemBase64: string | null;
  /** Página do provedor com o QR e as instruções (só https). */
  link: string | null;
  expiraEm: Date | null;
};

/**
 * Uma devolução lida na order (M8.2c), por lista branca de status: `confirmada` (processed/approved), `falhou`
 * (failed/rejected/canceled/cancelled) ou `andamento` (qualquer outro). Só em memória: o id só é gravado como
 * `devolucoes_pagamento.id_provedor` (a nossa), e nada mais da devolução (e2e_id, reference_id) é lido.
 */
export type EstadoDevolucaoLida = "confirmada" | "andamento" | "falhou";
export type DevolucaoLida = { id: string; estado: EstadoDevolucaoLida; valor: number };

export type Cobranca = {
  /** Id da order (ORD…). */
  idProvedor: string;
  /** `external_reference` (única por tentativa, ex.: scl-<id>). */
  referencia: string;
  situacao: SituacaoCobranca;
  /** "status/status_detail" da order como o provedor disse (curto, sem dado pessoal); ver `detalheDaOrder`. */
  detalhe: string;
  forma: FormaPagamento | null;
  /** Centavos (total_amount). */
  valor: number;
  /** Centavos do valor da transação de pagamento (payments[0].amount), se veio. */
  valorTransacao: number | null;
  /** Centavos (total_paid_amount), se veio. */
  pago: number | null;
  /** Centavos já devolvidos (soma das devoluções confirmadas conhecidas); 0 se nenhuma. */
  devolvido: number;
  /** Há devolução pedida e ainda não confirmada (ou numa situação que o sistema não conhece) na order. */
  devolucaoEmAndamento: boolean;
  /**
   * As devoluções da order que a leitura trouxe (até 20, com id válido; valor em centavos, 0 se ilegível). Vazia quando a
   * resposta não lista devoluções (o GET da Checkout API não documenta `transactions.refunds[]`): não quer dizer "nenhuma".
   */
  devolucoes: DevolucaoLida[];
  parcelas: number | null;
  /** Id do pagamento dentro da order (PAY…), usado na devolução parcial. */
  idTransacao: string | null;
  /** `live_mode` quando vier; null = não informado. */
  aoVivo: boolean | null;
  pix: DadosPix | null;
  /** null no Pix. */
  cartao: DadosCartao | null;
};

/** O que o hóspede pagou na order: o total pago quando vier, senão o valor da order. É o "integral" de uma devolução. */
export const valorPagoNaOrder = (c: Pick<Cobranca, "pago" | "valor">): number => c.pago ?? c.valor;

/** Taxa, líquido e liberação. Tudo null = desconhecido (o painel avisa; nunca palpite). */
/**
 * O Mercado Pago só consulta (GET /v1/orders/{id}) orders criadas há menos de três meses. Depois disso a order
 * "não existe" para a leitura: não é aviso, é o limite do provedor (a contestação tardia é do M8.2e, por outro caminho).
 */
export const RETENCAO_ORDERS_DIAS = 90;

export type DetalheFinanceiro = {
  /** Centavos que o provedor ficou (só as tarifas pagas pela SCL). */
  taxa: number | null;
  /** Centavos que caem na conta. */
  liquido: number | null;
  /** PREVISÃO de liberação informada pelo provedor. Não quer dizer que já foi liberado. */
  liberacaoPrevista: Date | null;
  /** true só quando o provedor diz explicitamente "liberado"; false quando diz "pendente"; null = não disse. */
  liberado: boolean | null;
  /** Id numérico do pagamento na Payments API, em texto. */
  idPagamento: string | null;
  /** money_release_schema não vazio (ex.: payment_in_flow): o provedor libera parcela a parcela (`liberado` fica null). */
  liberacaoEmParcelas: boolean;
  /**
   * Centavos: soma das tarifas financing_fee que NÃO são do comprador (o custo do "parcelamento sem acréscimo" cobrado
   * da SCL). 0 = tarifas lidas e nenhuma assim; null = tarifas não lidas.
   */
  custoParcelasVendedor: number | null;
};

export type MotivoFalhaCriacao = "recusado" | "dados_invalidos" | "incerto";

/**
 * - `recusado`: a order existe e a transação falhou (cartão recusado); `cobranca` traz a order quando veio.
 * - `dados_invalidos`: o provedor (ou a validação local) recusou o pedido; nada foi cobrado.
 * - `incerto`: não dá para saber se a order foi criada (chave já usada, chave travada…). Quem chama
 *   procura pela referência (`buscarPorReferencia`) antes de qualquer nova tentativa; o adaptador
 *   NUNCA repete com uma chave nova por conta própria.
 */
export type ResultadoCriacao =
  | { ok: true; cobranca: Cobranca }
  | {
      ok: false;
      motivo: MotivoFalhaCriacao;
      /** Texto de lista fechada para o painel e o desenvolvimento; nunca vai ao hóspede (as recusas de cartão são todas iguais). */
      mensagem: string;
      cobranca: Cobranca | null;
      /** Primeiro código conhecido do provedor (status_detail ou código de erro), `/^[a-z0-9_]{1,60}$/`; null = nenhum. */
      codigo: string | null;
    };

export type PedidoPix = {
  referencia: string;
  /** Gravada ANTES da chamada; 1 a 128 caracteres. */
  chaveIdempotencia: string;
  /** Centavos. */
  valor: number;
  email: string;
  nome: string;
  /** Ajustada para a faixa do provedor (30 minutos a 30 dias). */
  validadeMinutos: number;
  descricao: string;
  descricaoFatura: string | null;
};

export type PedidoCartao = {
  referencia: string;
  chaveIdempotencia: string;
  /** Centavos. */
  valor: number;
  /** Token do cartão gerado no navegador (o número do cartão nunca passa pelo servidor). */
  token: string;
  /** Bandeira (payment_method_id do formulário, ex.: "master"). */
  bandeira: string;
  /** O domínio só manda crédito (M8.2b); débito continua no contrato do adaptador. */
  tipo: "credit_card" | "debit_card";
  /** 1 a 36. */
  parcelas: number;
  /** Verificação do banco pedida (retrato do painel na criação da tentativa). */
  tresDS: ModoTresDS;
  /** issuer_id do formulário. A Orders API não documenta esse campo: não é enviado (ver mercadopago.ts). */
  emissor: string | null;
  email: string;
  /** Repassado ao provedor e não guardado. */
  documento: { tipo: string; numero: string } | null;
  /** Device ID do SDK do Mercado Pago (cabeçalho X-meli-session-id). */
  sessaoDispositivo: string | null;
  descricao: string;
  descricaoFatura: string | null;
};

/** Código do resultado de uma devolução (lista fechada; nunca tirado de texto livre do provedor). */
export const CODIGOS_DEVOLUCAO = ["saldo_insuficiente", "prazo", "valor_excede", "em_andamento", "transitorio", "nao_permitido", "nao_encontrado"] as const;
export type CodigoDevolucao = (typeof CODIGOS_DEVOLUCAO)[number];
/** Recusas que o Mercado Pago não reverte sozinho (abrem a devolução por fora no cartão). */
export const RECUSAS_DEFINITIVAS: readonly CodigoDevolucao[] = ["nao_permitido", "prazo", "nao_encontrado"];

/**
 * - `confirmada`: o provedor confirmou a devolução.
 * - `pedida`: aceita, aguardando confirmação (reconsultar depois).
 * - `recusada`: o provedor (ou a validação local) recusou.
 * - `incerta`: não dá para saber; repetir com a MESMA chave mais tarde.
 * - `aguarde`: há uma devolução em andamento na order ou o Mercado Pago pediu para esperar; nada foi aceito por esta
 *   chave (repetir com a MESMA chave mais tarde, sem contar como falha).
 *
 * `idDevolucao`: a devolução que ESTE pedido criou (a que não estava na leitura de antes do pedido), ou null quando não dá
 * para saber qual é. `codigo`: o motivo, de `CODIGOS_DEVOLUCAO`; null = nenhum (inclusive nas aceitas).
 */
export type ResultadoDevolucao = {
  situacao: "confirmada" | "pedida" | "recusada" | "incerta" | "aguarde";
  idDevolucao: string | null;
  mensagem: string;
  codigo: CodigoDevolucao | null;
};

export type ResultadoCancelamento = "cancelado" | "nao_cancelavel" | "erro";

export type TipoErroProvedor = "indisponivel" | "incerto" | "credencial" | "limite";

/**
 * Falha de transporte:
 * - `indisponivel`: o pedido não chegou ao provedor (endereço, conexão recusada) — nada aconteceu;
 * - `incerto`: o pedido pode ter chegado (tempo-limite, conexão cortada, 5xx, resposta ilegível);
 * - `credencial`: chave recusada (401/403) ou com formato inválido;
 * - `limite`: limite de chamadas (429); `esperarSegundos` vem do Retry-After quando informado.
 */
export class ErroProvedor extends Error {
  constructor(
    readonly tipo: TipoErroProvedor,
    mensagem: string,
    readonly esperarSegundos: number | null = null,
  ) {
    super(mensagem);
    this.name = "ErroProvedor";
  }
}

export interface ProvedorPagamento {
  readonly nome: "mercadopago" | "falso";
  criarPix(p: PedidoPix): Promise<ResultadoCriacao>;
  criarCartao(p: PedidoCartao): Promise<ResultadoCriacao>;
  /** null = não encontrada (404 ou id que não pode existir). */
  consultar(idProvedor: string): Promise<Cobranca | null>;
  /** null = a busca funcionou e não há order com essa referência desde `desde`. Busca que não funciona lança `ErroProvedor`. */
  buscarPorReferencia(referencia: string, desde: Date): Promise<Cobranca | null>;
  /**
   * Payments API pela external_reference: existe algum pagamento (de qualquer situação)? Só leitura. Falha de
   * transporte ou resposta ilegível lança `ErroProvedor` (nunca "não" sem saber: um cartão pode já ter sido cobrado).
   */
  existePagamentoPorReferencia(referencia: string, desde: Date): Promise<boolean>;
  /** Taxa, líquido e liberação. Qualquer falha ou ausência = campos null (nunca lança). */
  detalheFinanceiro(c: Cobranca): Promise<DetalheFinanceiro>;
  cancelar(idProvedor: string, chaveIdempotencia: string): Promise<ResultadoCancelamento>;
  /**
   * `valor` null = integral (o que falta devolver). Nunca lança: falhas viram `recusada`/`incerta`/`aguarde`. `c` é a
   * leitura de antes do pedido: as devoluções dela (`c.devolucoes`) separam a nova das que já existiam.
   */
  devolver(c: Cobranca, chaveIdempotencia: string, valor: number | null): Promise<ResultadoDevolucao>;
  /**
   * A conta por trás da chave é, comprovadamente, uma conta de TESTE do provedor? true só com
   * prova; false quando comprovadamente não é; null quando não deu para saber. Só true libera
   * cobrar no ambiente de teste (ver `contaDeTesteConfirmada` em ambiente.ts). Nunca lança.
   */
  conferirContaDeTeste(): Promise<boolean | null>;
}

// Limites do provedor, compartilhados pela versão real e pela falsa.
export const PIX_VALIDADE_MINIMA_MINUTOS = 30;
export const PIX_VALIDADE_MAXIMA_MINUTOS = 30 * 24 * 60;
export const PARCELAS_MAXIMAS = 36;
/** O hóspede tem 40 minutos, a partir da criação do endereço do desafio 3DS, para concluir a verificação do banco. */
export const DESAFIO_3DS_MINUTOS = 40;

/**
 * Mensagem de toda recusa de cartão (lista fechada, igual para todo motivo): quem testa cartões roubados usa
 * textos diferentes por motivo como oráculo. O motivo fica só no código (`codigo`) e no painel da equipe.
 */
export const RECUSA_GENERICA = "Pagamento recusado pelo Mercado Pago.";
/** Códigos do provedor de token do cartão vencido ou inválido (o formulário precisa ser preenchido de novo). */
export const CODIGOS_TOKEN = ["invalid_card_token", "card_token_not_found", "invalid_token"] as const;
/** Falha técnica do próprio provedor ao processar (não é recusa do banco nem da análise de risco). */
export const CODIGOS_FALHA_DO_PROVEDOR = ["processing_error"] as const;

/** Domínios do Mercado Pago aceitos para o desafio 3DS (o endereço, o iframe e a política de frames da página). */
export const DOMINIOS_DESAFIO = ["mercadopago.com", "mercadopago.com.br", "mercadolibre.com", "mercadolivre.com.br"] as const;

/**
 * Endereço do desafio 3DS, ou null: só https, até 2000 caracteres, sem usuário/senha nem porta, e o host igual a um
 * dos `DOMINIOS_DESAFIO` ou subdomínio dele. Qualquer outro endereço é descartado (nunca vai a um iframe).
 */
export function urlDoDesafio(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.length > 2000) return null;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  return DOMINIOS_DESAFIO.some((d) => host === d || host.endsWith(`.${d}`)) ? u.toString() : null;
}

/** external_reference: até 64 caracteres, só letras, números, hífen e sublinhado (regra do Mercado Pago). */
export const referenciaValida = (r: unknown): r is string => typeof r === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(r);

/** X-Idempotency-Key: 1 a 128 caracteres visíveis, sem espaço. */
export const chaveIdempotenciaValida = (c: unknown): c is string => typeof c === "string" && /^[\x21-\x7E]{1,128}$/.test(c);

/** Id de order/transação do provedor: letras, números, hífen e sublinhado (ex.: ORD01…, pay_01…). Impede injeção no caminho da URL. */
export const idProvedorValido = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);

/** Id de uma devolução do provedor: um id válido que começa com REF (ex.: REF01J49MMW3SSBK5PSV3DFR32959; maiúsculo ou não). */
export const idDevolucaoValido = (id: unknown): id is string => idProvedorValido(id) && /^ref/i.test(id);

/** E-mail com cara de e-mail (o provedor faz a conferência de verdade). */
export const emailPlausivel = (e: unknown): e is string => typeof e === "string" && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/** Validade do Pix na faixa do provedor (minutos inteiros, 30 min a 30 dias); null se não é um número. */
export function validadePixMinutos(v: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(PIX_VALIDADE_MAXIMA_MINUTOS, Math.max(PIX_VALIDADE_MINIMA_MINUTOS, Math.ceil(v)));
}

/**
 * Validação comum dos pedidos antes de falar com o provedor; devolve a mensagem do problema
 * (lista fechada) ou null. Não substitui a regra de negócio de quem chama.
 */
export function problemaNoPedido(p: { referencia: string; chaveIdempotencia: string; valor: number }): string | null {
  if (!referenciaValida(p.referencia)) return "Referência do pagamento inválida.";
  if (!chaveIdempotenciaValida(p.chaveIdempotencia)) return "Chave de idempotência inválida.";
  if (!Number.isSafeInteger(p.valor) || p.valor <= 0) return "Valor do pagamento inválido.";
  return null;
}

export function problemaNoCartao(p: PedidoCartao): string | null {
  const base = problemaNoPedido(p);
  if (base) return base;
  if (!Number.isInteger(p.parcelas) || p.parcelas < 1 || p.parcelas > PARCELAS_MAXIMAS) return "Número de parcelas inválido.";
  if (p.tipo !== "credit_card" && p.tipo !== "debit_card") return "Tipo de cartão inválido.";
  if (p.tipo === "debit_card" && p.parcelas !== 1) return "Cartão de débito não parcela.";
  if (!(MODOS_TRES_DS as readonly string[]).includes(p.tresDS)) return "Verificação do banco (3DS) inválida.";
  if (typeof p.token !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(p.token)) return "Os dados do cartão expiraram ou são inválidos; preencha de novo.";
  if (typeof p.bandeira !== "string" || !/^[a-z0-9_-]{1,40}$/i.test(p.bandeira)) return "Bandeira do cartão inválida.";
  return null;
}
