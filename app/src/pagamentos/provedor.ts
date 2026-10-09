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

export type DadosPix = {
  /** Texto do "copia e cola". */
  copiaECola: string;
  /** Imagem do QR em base64 (sem o prefixo data:); null quando o provedor não mandou (o sandbox às vezes manda ""). */
  imagemBase64: string | null;
  /** Página do provedor com o QR e as instruções (só https). */
  link: string | null;
  expiraEm: Date | null;
};

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
  parcelas: number | null;
  /** Id do pagamento dentro da order (PAY…), usado na devolução parcial. */
  idTransacao: string | null;
  /** `live_mode` quando vier; null = não informado. */
  aoVivo: boolean | null;
  pix: DadosPix | null;
};

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
  | { ok: false; motivo: MotivoFalhaCriacao; mensagem: string; cobranca: Cobranca | null };

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
  tipo: "credit_card" | "debit_card";
  /** 1 a 36. */
  parcelas: number;
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

/**
 * - `confirmada`: o provedor confirmou a devolução.
 * - `pedida`: aceita, aguardando confirmação (reconsultar depois).
 * - `recusada`: o provedor (ou a validação local) recusou.
 * - `incerta`: não dá para saber; repetir com a MESMA chave mais tarde.
 */
export type ResultadoDevolucao = { situacao: "confirmada" | "pedida" | "recusada" | "incerta"; idDevolucao: string | null; mensagem: string };

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
  /** Taxa, líquido e liberação. Qualquer falha ou ausência = campos null (nunca lança). */
  detalheFinanceiro(c: Cobranca): Promise<DetalheFinanceiro>;
  cancelar(idProvedor: string, chaveIdempotencia: string): Promise<ResultadoCancelamento>;
  /** `valor` null = integral (o que falta devolver). Nunca lança: falhas viram `recusada`/`incerta`. */
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

/** external_reference: até 64 caracteres, só letras, números, hífen e sublinhado (regra do Mercado Pago). */
export const referenciaValida = (r: unknown): r is string => typeof r === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(r);

/** X-Idempotency-Key: 1 a 128 caracteres visíveis, sem espaço. */
export const chaveIdempotenciaValida = (c: unknown): c is string => typeof c === "string" && /^[\x21-\x7E]{1,128}$/.test(c);

/** Id de order/transação do provedor: letras, números, hífen e sublinhado (ex.: ORD01…, pay_01…). Impede injeção no caminho da URL. */
export const idProvedorValido = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);

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
  if (typeof p.token !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(p.token)) return "Os dados do cartão expiraram ou são inválidos; preencha de novo.";
  if (typeof p.bandeira !== "string" || !/^[a-z0-9_-]{1,40}$/i.test(p.bandeira)) return "Bandeira do cartão inválida.";
  return null;
}
