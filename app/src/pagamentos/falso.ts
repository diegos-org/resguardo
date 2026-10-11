/**
 * Provedor de pagamento FALSO para testes e desenvolvimento: guarda as orders em memória e
 * nunca usa rede. Ids determinísticos (ORDTST0001, PAYTST0001, REFTST0001…), validação igual à
 * do cliente real, e simuladores para o que no Mercado Pago acontece "do lado de lá"
 * (aprovar, recusar, expirar, contestar, devolver pelo painel…). Cartão (M8.2b): desafio 3DS (o endereço só na
 * resposta da criação, como na API), análise, processamento, recusa sem order, juros do parcelamento pagos pelo
 * hóspede ou pela SCL, liberação em parcelas e atraso da busca pela referência. Devoluções (M8.2c): cada uma tem id (REFTST…;
 * as feitas no painel do provedor, REFPNL…) e aparece na leitura (`devolucoes`); respostas de recusa e de espera com o
 * código, devolução que falha depois de aceita, atraso da listagem, devolução a menos, order devolvida que a leitura não
 * reconhece (processed/refunded) e order que some da leitura (mais de 90 dias). Várias devoluções de parte do valor
 * (M8.2d): o que a documentação do Mercado Pago não garante vira chave (`idDaDevolucao`, `listaNaLeitura`, `detalheParcial`,
 * `pagoLiquidoDeDevolucoes`, `parcialRecusada`), para os testes rodarem com o caso otimista e com o pessimista.
 * Contestações (M8.2e): cada uma é um caso da Chargebacks API (número 7000000001…, CBKTST…) e, enquanto a order é lida, um
 * item de `transactions.chargebacks[]`; `contestar`, `resolverContestacao`, `documentacaoDoCaso`, `casoDeOutroPagamento`,
 * `mostrarNaLista` e `contestarTarde` (só pela Chargebacks API, com a order apagada) mudam o lado de lá;
 * `respostaChargebacks` (403, 404 ou falha, por método) e `situacaoAusente` simulam o que a documentação não garante.
 *
 * Falhas: `falhar` (todas as chamadas) e `falhas[metodo]` lançam antes de fazer qualquer coisa;
 * `falhasDepois[metodo]` faz a operação e lança em seguida (resposta perdida no caminho). Como
 * no cliente real, `cancelar`, `devolver`, `detalheFinanceiro` e `conferirContaDeTeste` nunca
 * lançam: a falha vira "erro", "incerta"/"recusada", tudo null ou null.
 */
import {
  chaveIdempotenciaValida, emailPlausivel, ErroProvedor, estadoLidoDaContestacao, idContestacaoValido, idNumericoValido, idProvedorValido, MAXIMO_CONTESTACOES_LIDAS,
  PIX_VALIDADE_MINIMA_MINUTOS, problemaNoCartao, problemaNoPedido, RECUSA_GENERICA, referenciaValida, SITUACOES_DOCUMENTACAO, validadePixMinutos,
} from "./provedor";
import type {
  CasoDeContestacao, Cobranca, CodigoDevolucao, ContestacaoLida, DadosCartao, DetalheFinanceiro, EstadoDevolucaoLida, ModoTresDS, OpcoesDevolucao, PedidoCartao, PedidoPix,
  ProvedorPagamento, ResultadoCancelamento, ResultadoCriacao, ResultadoDevolucao, SemAcessoContestacao, SituacaoCobranca, SituacaoDocumentacao, SituacaoDoPagamento, StatusTresDS,
} from "./provedor";

export type MetodoProvedor =
  | "criarPix" | "criarCartao" | "consultar" | "buscarPorReferencia" | "existePagamentoPorReferencia" | "detalheFinanceiro" | "cancelar" | "devolver" | "conferirContaDeTeste"
  | "consultarContestacao" | "buscarContestacoes" | "situacaoDoPagamento";
/** Os métodos da Chargebacks API (M8.2e), para `respostaChargebacks`. */
export type MetodoChargebacks = "consultarContestacao" | "buscarContestacoes";
/**
 * Resposta forçada da Chargebacks API: "403" = sem acesso; "404" = a consulta não acha o caso (null) e a busca não acha
 * a rota (lança, como o cliente real); "falha" = falha de transporte (lança `ErroProvedor` incerto).
 */
export type RespostaChargebacks = "403" | "404" | "falha";
/**
 * Como nasce uma contestação na versão falsa (M8.2e). Os ids seguem os formatos da documentação: o número do caso em
 * texto (só algarismos) e o id da order em CBK…. `idComo` "numero": o `case_id` da order e o `id` do caso chegam como
 * número; com mais de 15 algarismos ele já chega arredondado (como no exemplo oficial, de 18) e o cliente real não o lê:
 * na order fica sem o caso, e a Chargebacks API responde ilegível. `naLista` false: a order contestada sem o item em
 * `transactions.chargebacks[]` (a leitura vem sem identificação) até `mostrarNaLista`. `motivoCodigo` e `documentacao`
 * passam pelo mesmo filtro do cliente real (uma frase vira null; uma situação fora da lista, "desconhecida").
 */
export type OpcoesContestacao = {
  /** Centavos em disputa (padrão: o pago, ou o valor da order). */
  valor?: number;
  idCaso?: string;
  idCbk?: string;
  /** Status inicial (padrão in_process; um código estranho vira `desconhecido` na leitura). */
  estado?: string;
  documentacao?: string;
  /** Prazo dos documentos (padrão: daqui a 10 dias; null = sem prazo). */
  prazo?: Date | null;
  /** `coverage_applied` (padrão null). */
  cobertura?: boolean | null;
  /** `coverage_elegible` (padrão true). */
  elegivel?: boolean | null;
  motivoId?: string | null;
  motivoCodigo?: string | null;
  idComo?: "texto" | "numero";
  naLista?: boolean;
};
export type ChamadaFalsa = { metodo: MetodoProvedor; chave: string | null; id: string | null; referencia: string | null; valor: number | null; repetida?: boolean; conhecidas?: string[] };
export type OpcoesAprovacao = { taxa?: number | null; liquido?: number | null; liberacaoPrevista?: Date | null; liberado?: boolean | null };
/** O que chegou ao provedor no último cartão, sem o token (só se ele veio): para os testes conferirem o que passou por aqui. */
export type PedidoCartaoRecebido = Omit<PedidoCartao, "token"> & { comToken: boolean };

/**
 * Uma devolução da order. `valor`: o pedido enquanto está em andamento e o que de fato voltou depois de concluída;
 * `completaCom`: quanto ela devolve ao concluir (`devolverAMenos`); `ocultaLeituras`: quantas leituras ainda não a mostram.
 */
type DevolucaoFalsa = { id: string; estado: EstadoDevolucaoLida; valor: number; completaCom: number; ocultaLeituras: number };
/**
 * Uma contestação do lado do provedor (M8.2e): o caso da Chargebacks API e o item da order. `estado`: o status do item e o
 * detalhe da transação (ou da order) contestada. `order`: null num caso sem order conhecida (`contestarTarde`).
 */
type ContestacaoFalsa = {
  order: string | null;
  idCaso: string;
  idCbk: string;
  /** O `transaction_id` do item: de propósito, nunca o id do pagamento da order (como no exemplo oficial). */
  idTransacao: string;
  idComo: "texto" | "numero";
  estado: string;
  valor: number;
  documentacao: string;
  prazo: Date | null;
  cobertura: boolean | null;
  elegivel: boolean | null;
  motivoId: string | null;
  motivoCodigo: string | null;
  /** O `payments[]` do caso (`casoDeOutroPagamento` troca). */
  pagamentos: string[];
  naLista: boolean;
  criadaEm: Date;
  atualizadaEm: Date;
  aoVivo: boolean | null;
};
/**
 * `tresDS` = a verificação do banco pedida na criação (null no Pix); `esquecida` = a leitura não acha mais a order;
 * `contestada` = como a order mostra a contestação (M8.2e): a order inteira, só a transação ou só a lista, e se a
 * transação voltou a processed/accredited (`resolverContestacao`).
 */
type Registro = {
  cobranca: Cobranca;
  criadaEm: Date;
  financeiro: DetalheFinanceiro;
  devolucoes: DevolucaoFalsa[];
  tresDS: ModoTresDS | null;
  esquecida: boolean;
  contestada: { como: "order" | "transacao" | "lista"; voltouAprovada: boolean } | null;
};
type Lembrado =
  | { metodo: "criarPix" | "criarCartao"; id: string | null; resultado: ResultadoCriacao }
  | { metodo: "cancelar"; resultado: ResultadoCancelamento }
  | { metodo: "devolver"; resultado: ResultadoDevolucao };

const NADA: DetalheFinanceiro = { taxa: null, liquido: null, liberacaoPrevista: null, liberado: null, idPagamento: null, liberacaoEmParcelas: false, custoParcelasVendedor: null };
const MARGEM_BUSCA_MS = 5 * 60_000;
const INCERTO_CRIACAO = "Não deu para saber se o pagamento foi criado; conferir pela referência antes de tentar de novo.";

/** A parte "status/detalhe" da transação no detalhe da order ("… ; pagamento x/y"); sem ela, a transação é a própria order. */
const transacaoDoDetalhe = (detalhe: string): string => detalhe.split("; pagamento ")[1] ?? detalhe;
/**
 * O detalhe da contestação na transação (ou, sem ela, na order) `charged_back/<detalhe>`, como o cliente real; null se
 * nenhuma das duas está contestada.
 */
function detalheContestado(detalhe: string): string | null {
  const [order, transacao] = detalhe.split("; pagamento ");
  for (const parte of [transacao, order]) {
    const [status, d] = (parte ?? "").split("/");
    if (status === "charged_back") return d ?? null;
  }
  return null;
}
/** `transacaoAprovada` sai sempre do detalhe (como o cliente real lê a transação), nunca de um campo guardado. */
const copiar = (c: Cobranca): Cobranca => ({
  ...c,
  devolucoes: c.devolucoes.map((d) => ({ ...d })),
  pix: c.pix ? { ...c.pix, expiraEm: c.pix.expiraEm ? new Date(c.pix.expiraEm) : null } : null,
  cartao: c.cartao ? { ...c.cartao } : null,
  contestacoes: c.contestacoes.map((x) => ({ ...x })),
  transacaoAprovada: transacaoDoDetalhe(c.detalhe) === "processed/accredited",
});
const copiarFinanceiro = (f: DetalheFinanceiro): DetalheFinanceiro => ({ ...f, liberacaoPrevista: f.liberacaoPrevista ? new Date(f.liberacaoPrevista) : null });
const copiarCriacao = (r: ResultadoCriacao): ResultadoCriacao => (r.ok ? { ok: true, cobranca: copiar(r.cobranca) } : { ...r, cobranca: r.cobranca ? copiar(r.cobranca) : null });
const seq = (n: number) => String(n).padStart(4, "0");
/** O número do pagamento na Payments API de uma order falsa (o mesmo do financeiro da aprovação). */
const numeroDaOrder = (idOrder: string) => String(9_000_000_000 + Number(idOrder.replace(/\D/g, "") || 0));
const CODIGO = /^[a-z0-9_]{1,60}$/;
const MOTIVO_CODIGO = /^[a-z][a-z0-9_]{0,39}$/;
const FORMATO = "Resposta do Mercado Pago em formato inesperado.";
/** Como o cliente real lê um id que chegou como número: com mais de 15 algarismos já chega arredondado (null). */
const lidoComoNumero = (id: string): string | null => (Number.isSafeInteger(Number(id)) ? String(Number(id)) : null);

/**
 * O conjunto pessimista do que a documentação do Mercado Pago não garante nas devoluções de parte do valor (M8.2d): a
 * resposta aceita sem o id da devolução, a leitura sem a lista, a parcial lida como processed/refunded e o pago líquido do
 * devolvido. Os testes da alteração e do cancelamento depois dela rodam também com ele.
 */
export function pessimista(p: ProvedorFalso): ProvedorFalso {
  p.idDaDevolucao = "ausente";
  p.listaNaLeitura = false;
  p.detalheParcial = "processed/refunded";
  p.pagoLiquidoDeDevolucoes = true;
  return p;
}

export class ProvedorFalso implements ProvedorPagamento {
  readonly nome = "falso" as const;
  /** Lança em todas as chamadas, antes de fazer qualquer coisa. */
  falhar: ErroProvedor | null = null;
  /** Lança só no método indicado, antes de fazer qualquer coisa. */
  falhas: Partial<Record<MetodoProvedor, ErroProvedor | null>> = {};
  /** Faz a operação e lança em seguida (a resposta "se perdeu"). */
  falhasDepois: Partial<Record<"criarPix" | "criarCartao" | "cancelar" | "devolver", ErroProvedor | null>> = {};
  /**
   * Chave de idempotência repetida: "incerto" responde como a API real documenta (409
   * idempotency_key_already_used → incerto/erro/incerta); "mesma_resposta" devolve o resultado da
   * primeira chamada (com a order no estado atual).
   */
  chaveRepetida: "incerto" | "mesma_resposta" = "incerto";
  /**
   * Desfecho do próximo cartão: `desafio` = pendente com o desafio 3DS (o endereço só na resposta da criação);
   * `em_analise` = processing/in_review (análise); `processando` = processing/in_process; `recusado_sem_order` = o 402
   * sem `data` (recusado sem a order no corpo; nada fica registrado do lado de cá).
   */
  respostaCartao: "aprovado" | "recusado" | "recusado_sem_order" | "em_analise" | "processando" | "desafio" = "aprovado";
  /** status_detail da próxima recusa de cartão (vira `codigo` e o detalhe "failed/failed; pagamento failed/<motivo>"). */
  motivoRecusaCartao = "rejected_by_issuer";
  /** Centavos de juros do parcelamento somados ao pago quando um cartão com mais de uma parcela é aprovado. */
  jurosCartao = 0;
  /**
   * Quem paga os juros do parcelamento: o hóspede (pago = valor + juros) ou a SCL ("parcelamento sem acréscimo":
   * pago = valor e o financeiro traz `custoParcelasVendedor` > 0 — `jurosCartao`, ou 5% do valor sem ele —, já dentro da taxa).
   */
  jurosPor: "comprador" | "vendedor" = "comprador";
  /** O financeiro dos cartões vem com liberação parcela a parcela (money_release_schema; `liberado` fica null). */
  liberacaoEmParcelas = false;
  /** Resultado da verificação do banco nos cartões com 3DS (`on_fraud_risk`) que não ficam no desafio. */
  tresDSStatus: StatusTresDS | null = "AUTHENTICATED";
  /** Por quanto tempo depois da criação a busca pela referência (orders e pagamentos) ainda não acha nada. */
  atrasoBuscaMs = 0;
  /** Último cartão que chegou aqui (sem o token). */
  ultimoPedidoCartao: PedidoCartaoRecebido | null = null;
  /**
   * Resposta das próximas devoluções: "pedida" deixa a devolução esperando `confirmarDevolucoes`; "saldo_insuficiente" e
   * "prazo" recusam com esse código; "em_andamento" e "transitorio" respondem "aguarde" com esse código. As recusas e as
   * esperas não mexem na order, e a espera não guarda a chave (nada foi aceito: a mesma chave vale de novo depois).
   */
  respostaDevolucao: "confirmada" | "pedida" | "saldo_insuficiente" | "prazo" | "em_andamento" | "transitorio" = "confirmada";
  /** Como a order inteiramente devolvida aparece na leitura: "processed/refunded" (exemplo da documentação) vem `desconhecido`. */
  detalheDevolvido: "refunded/refunded" | "processed/refunded" = "refunded/refunded";
  // --- Devoluções de parte do valor (M8.2d): o que a documentação não garante. O padrão é o caso otimista.
  /** "ausente": a resposta aceita (201) não identifica a devolução (o caso real mais comum); ela continua com id na leitura. */
  idDaDevolucao: "informado" | "ausente" = "informado";
  /** false: o GET não traz `refunds[]` (para sempre): a leitura vem sem a lista, com `devolvido` 0 e nada em andamento. */
  listaNaLeitura = true;
  /** Como a order devolvida em parte aparece: "processed/refunded" (o exemplo da documentação para uma parcial) vem `desconhecido`. */
  detalheParcial: "processed/partially_refunded" | "processed/refunded" = "processed/partially_refunded";
  /** O `pago` (total_paid_amount) da leitura cai pelo que foi devolvido (o significado dele depois de uma devolução não é documentado). */
  pagoLiquidoDeDevolucoes = false;
  /** O Mercado Pago recusa mais uma devolução de parte do valor numa order que já tem uma (com este código): recusada/nao_permitido. */
  parcialRecusada: null | "unsupported_partially_refunds" | "max_refunds_exceeded" = null;
  /** Resposta de `conferirContaDeTeste`. */
  contaDeTeste: boolean | null = true;
  /** Imagem do QR devolvida no Pix (null simula o sandbox que manda ""). */
  imagemPix: string | null = "RkFMU08=";
  /** `live_mode` das orders novas (true simula pagamento real na conta de teste). */
  aoVivo: boolean | null = false;
  /** Resposta forçada da Chargebacks API, por método (M8.2e; ver `RespostaChargebacks`). */
  respostaChargebacks: Partial<Record<MetodoChargebacks, RespostaChargebacks | null>> = {};
  /** true: a Payments API pelo número não responde (404 → null), como pode acontecer com pagamentos antigos (item 72). */
  situacaoAusente = false;
  /** Tudo o que foi chamado, na ordem, com as chaves de idempotência. */
  readonly chamadas: ChamadaFalsa[] = [];

  private readonly registros = new Map<string, Registro>();
  private readonly chaves = new Map<string, Lembrado>();
  /** As contestações (M8.2e), na ordem em que nasceram. */
  private readonly casos: ContestacaoFalsa[] = [];
  private orders = 0;
  private contestacoes = 0;
  private devolucoes = 0;
  private devolucoesNoPainel = 0;
  private desafios = 0;
  /** Leituras que a próxima devolução aceita fica sem aparecer (`atrasarListagem`). */
  private atrasoListagem = 0;
  /** Quanto a próxima devolução aceita devolve de fato (`devolverAMenos`). */
  private proximaAMenos: number | null = null;

  constructor(private readonly agora: () => Date = () => new Date()) {}

  /** Cópia de todas as orders, na ordem de criação (com as devoluções que a leitura mostraria agora). */
  todas(): Cobranca[] {
    return [...this.registros.values()].map((r) => this.vista(r));
  }

  /**
   * A order como a leitura mostra: as devoluções visíveis (sem as atrasadas) e, delas, se há alguma em andamento.
   * `contar`: esta leitura conta para o atraso da listagem (só `consultar`).
   */
  private vista(r: Registro, contar = false): Cobranca {
    const visiveis = r.devolucoes.filter((d) => d.ocultaLeituras === 0);
    if (contar) for (const d of r.devolucoes) if (d.ocultaLeituras > 0) d.ocultaLeituras--;
    // `pagoLiquidoDeDevolucoes`: o total pago da leitura desconta o devolvido (o real continua guardado).
    const pago = this.pagoLiquidoDeDevolucoes && r.cobranca.pago !== null ? Math.max(0, r.cobranca.pago - r.cobranca.devolvido) : r.cobranca.pago;
    const contestacoes = this.contestacoesLidas(r);
    // Sem a lista na leitura, como o cliente real: nada devolvido nem em andamento à vista (a situação continua a da order).
    if (!this.listaNaLeitura) return copiar({ ...r.cobranca, pago, devolvido: 0, devolucoes: [], devolucaoEmAndamento: false, contestacoes });
    return copiar({ ...r.cobranca, pago, devolucoes: visiveis.map((d) => ({ id: d.id, estado: d.estado, valor: d.valor })), devolucaoEmAndamento: visiveis.some((d) => d.estado === "andamento"), contestacoes });
  }

  /**
   * As contestações que a leitura da order mostra, como o cliente real (`contestacoesDaOrder`): os itens da lista (até 20)
   * ou, sem item, uma sem identificação pela transação (ou order) `charged_back/<detalhe>`.
   */
  private contestacoesLidas(r: Registro): ContestacaoLida[] {
    const lidas = this.casos
      .filter((x) => x.order === r.cobranca.idProvedor && x.naLista)
      .slice(0, MAXIMO_CONTESTACOES_LIDAS)
      .map((x): ContestacaoLida => ({
        idContestacao: x.idCbk,
        idCaso: x.idComo === "numero" ? lidoComoNumero(x.idCaso) : x.idCaso,
        idTransacao: x.idTransacao,
        estadoLido: estadoLidoDaContestacao(x.estado),
        codigo: x.estado,
        valor: x.valor,
        daTransacao: false,
      }));
    if (lidas.length) return lidas;
    const detalhe = detalheContestado(r.cobranca.detalhe);
    if (detalhe === null) return [];
    const codigo = CODIGO.test(detalhe) ? detalhe : null;
    return [{ idContestacao: null, idCaso: null, idTransacao: null, estadoLido: estadoLidoDaContestacao(codigo), codigo, valor: null, daTransacao: true }];
  }

  private registrar(metodo: MetodoProvedor, o: Partial<Omit<ChamadaFalsa, "metodo">> = {}) {
    this.chamadas.push({
      metodo, chave: o.chave ?? null, id: o.id ?? null, referencia: o.referencia ?? null, valor: o.valor ?? null,
      ...(o.repetida !== undefined ? { repetida: o.repetida } : {}),
      ...(o.conhecidas !== undefined ? { conhecidas: o.conhecidas } : {}),
    });
  }

  /** A order ainda aceita devolução: aprovada ou devolvida em parte (também a parcial que a leitura mostra processed/refunded). */
  private devolvivel(r: Registro): boolean {
    const s = r.cobranca.situacao;
    const pago = r.cobranca.pago ?? r.cobranca.valor;
    return s === "aprovado" || s === "devolvido_parcial" || (s === "desconhecido" && r.cobranca.detalhe === "processed/refunded" && r.cobranca.devolvido > 0 && r.cobranca.devolvido < pago);
  }

  /** Falha injetada antes da operação, se houver. */
  private falhaAntes(metodo: MetodoProvedor): ErroProvedor | null {
    return this.falhar ?? this.falhas[metodo] ?? null;
  }

  private registro(id: string): Registro {
    const r = this.registros.get(id);
    if (!r) throw new Error(`Order falsa inexistente: ${id}`);
    return r;
  }

  /** Muda a situação; no cartão, desafio e análise seguem o detalhe (como a leitura do cliente real). */
  private mudar(id: string, situacao: SituacaoCobranca, detalhe: string) {
    const r = this.registro(id);
    const cartao = r.cobranca.cartao ? { ...r.cobranca.cartao, desafio: /pending_challenge/.test(detalhe), analise: /in_review|pending_review_manual/.test(detalhe) } : null;
    r.cobranca = { ...r.cobranca, situacao, detalhe, cartao };
    return r;
  }

  private novaOrder(
    base: Omit<Cobranca, "idProvedor" | "idTransacao" | "devolvido" | "devolucaoEmAndamento" | "devolucoes" | "aoVivo" | "valorTransacao" | "contestacoes" | "transacaoAprovada">,
    tresDS: ModoTresDS | null = null,
  ): Registro {
    const n = ++this.orders;
    const registro: Registro = {
      cobranca: {
        ...base, idProvedor: `ORDTST${seq(n)}`, idTransacao: `PAYTST${seq(n)}`, valorTransacao: base.valor, devolvido: 0, devolucaoEmAndamento: false, devolucoes: [], aoVivo: this.aoVivo,
        // `transacaoAprovada` é recalculada do detalhe em toda cópia (`copiar`).
        contestacoes: [], transacaoAprovada: false,
      },
      criadaEm: this.agora(),
      financeiro: { ...NADA },
      devolucoes: [],
      tresDS,
      esquecida: false,
      contestada: null,
    };
    this.registros.set(registro.cobranca.idProvedor, registro);
    return registro;
  }

  /** Chave repetida: resposta conforme `chaveRepetida`; null = chave nova. */
  private repetidaCriacao(chave: string): ResultadoCriacao | null {
    const l = this.chaves.get(chave);
    if (!l) return null;
    if (this.chaveRepetida === "incerto" || (l.metodo !== "criarPix" && l.metodo !== "criarCartao")) {
      return { ok: false, motivo: "incerto", mensagem: INCERTO_CRIACAO, cobranca: null, codigo: "idempotency_key_already_used" };
    }
    const atual = l.id ? this.registros.get(l.id)?.cobranca : undefined;
    if (!atual) return copiarCriacao(l.resultado);
    return l.resultado.ok ? { ok: true, cobranca: copiar(atual) } : { ...l.resultado, cobranca: copiar(atual) };
  }

  private concluirCriacao(metodo: "criarPix" | "criarCartao", chave: string, registro: Registro, resultado: ResultadoCriacao): ResultadoCriacao {
    this.chaves.set(chave, { metodo, id: registro.cobranca.idProvedor, resultado: copiarCriacao(resultado) });
    const depois = this.falhasDepois[metodo];
    if (depois) throw depois;
    return resultado;
  }

  async criarPix(p: PedidoPix): Promise<ResultadoCriacao> {
    this.registrar("criarPix", { chave: p.chaveIdempotencia, referencia: p.referencia, valor: p.valor });
    const antes = this.falhaAntes("criarPix");
    if (antes) throw antes;
    const invalido = (mensagem: string): ResultadoCriacao => ({ ok: false, motivo: "dados_invalidos", mensagem, cobranca: null, codigo: null });
    const problema = problemaNoPedido(p);
    if (problema) return invalido(problema);
    const validade = validadePixMinutos(p.validadeMinutos);
    if (validade === null) return invalido("Validade do Pix inválida.");
    if (!emailPlausivel(p.email?.trim())) return invalido("E-mail do pagador inválido.");
    const repetida = this.repetidaCriacao(p.chaveIdempotencia);
    if (repetida) return repetida;
    const n = this.orders + 1;
    const registro = this.novaOrder({
      referencia: p.referencia,
      situacao: "pendente",
      detalhe: "action_required/waiting_transfer",
      forma: "pix",
      valor: p.valor,
      pago: null,
      parcelas: null,
      pix: {
        copiaECola: `00020126580014br.gov.bcb.pix0136FALSO-ORDTST${seq(n)}5204000053039865802BR5905FALSO6009SAO PAULO6304ABCD`,
        imagemBase64: this.imagemPix,
        link: `https://pagamento.falso.invalid/pix/ORDTST${seq(n)}`,
        expiraEm: new Date(this.agora().getTime() + Math.max(validade, PIX_VALIDADE_MINIMA_MINUTOS) * 60_000),
      },
      cartao: null,
    });
    return this.concluirCriacao("criarPix", p.chaveIdempotencia, registro, { ok: true, cobranca: copiar(registro.cobranca) });
  }

  async criarCartao(p: PedidoCartao): Promise<ResultadoCriacao> {
    this.registrar("criarCartao", { chave: p.chaveIdempotencia, referencia: p.referencia, valor: p.valor });
    const antes = this.falhaAntes("criarCartao");
    if (antes) throw antes;
    // O que chegou, sem o token: os testes conferem que o resto (documento, aparelho, 3DS, parcelas) passou por aqui.
    const { token, ...semToken } = p;
    this.ultimoPedidoCartao = { ...semToken, documento: p.documento ? { ...p.documento } : null, comToken: typeof token === "string" && token.length > 0 };
    const problema = problemaNoCartao(p) ?? (emailPlausivel(p.email?.trim()) ? null : "E-mail do pagador inválido.");
    if (problema) return { ok: false, motivo: "dados_invalidos", mensagem: problema, cobranca: null, codigo: null };
    const repetida = this.repetidaCriacao(p.chaveIdempotencia);
    if (repetida) return repetida;
    const motivo = this.motivoRecusaCartao;
    if (this.respostaCartao === "recusado_sem_order") {
      // Como o 402 sem `data`: recusado, sem a order no corpo (a busca pela referência não acha nada).
      const resultado: ResultadoCriacao = { ok: false, motivo: "recusado", mensagem: RECUSA_GENERICA, cobranca: null, codigo: motivo };
      this.chaves.set(p.chaveIdempotencia, { metodo: "criarCartao", id: null, resultado: copiarCriacao(resultado) });
      if (this.falhasDepois.criarCartao) throw this.falhasDepois.criarCartao;
      return resultado;
    }
    const comTresDS = p.tresDS === "on_fraud_risk";
    const desfechos: Record<Exclude<ProvedorFalso["respostaCartao"], "recusado_sem_order">, { situacao: SituacaoCobranca; detalhe: string; desafio?: boolean; analise?: boolean }> = {
      aprovado: { situacao: "aprovado", detalhe: "processed/accredited" },
      recusado: { situacao: "recusado", detalhe: `failed/failed; pagamento failed/${motivo}` },
      em_analise: { situacao: "em_analise", detalhe: "processing/in_review", analise: true },
      processando: { situacao: "em_analise", detalhe: "processing/in_process" },
      desafio: { situacao: "pendente", detalhe: "action_required/pending_challenge", desafio: true },
    };
    const d = desfechos[this.respostaCartao];
    const cartao: DadosCartao = {
      desafioUrl: null,
      desafio: d.desafio === true,
      analise: d.analise === true,
      tresDSStatus: !comTresDS ? null : d.desafio ? "CHALLENGE" : this.tresDSStatus,
      bandeira: p.bandeira.toLowerCase(),
    };
    const registro = this.novaOrder({ referencia: p.referencia, situacao: d.situacao, detalhe: d.detalhe, forma: "cartao", valor: p.valor, pago: null, parcelas: p.parcelas, pix: null, cartao }, p.tresDS);
    if (d.situacao === "aprovado") this.aplicarAprovacao(registro);
    const resposta = copiar(registro.cobranca);
    // Só a resposta da criação traz o endereço do desafio (o GET não documenta): a order guardada fica sem ele.
    if (d.desafio && resposta.cartao) resposta.cartao.desafioUrl = `https://www.mercadopago.com.br/checkout/v1/3ds/FALSO${seq(++this.desafios)}`;
    const resultado: ResultadoCriacao = d.situacao === "recusado"
      ? { ok: false, motivo: "recusado", mensagem: RECUSA_GENERICA, cobranca: resposta, codigo: motivo }
      : { ok: true, cobranca: resposta };
    return this.concluirCriacao("criarCartao", p.chaveIdempotencia, registro, resultado);
  }

  async consultar(idProvedor: string): Promise<Cobranca | null> {
    this.registrar("consultar", { id: idProvedor });
    const antes = this.falhaAntes("consultar");
    if (antes) throw antes;
    if (!idProvedorValido(idProvedor)) return null;
    const r = this.registros.get(idProvedor);
    return r && !r.esquecida ? this.vista(r, true) : null;
  }

  async buscarPorReferencia(referencia: string, desde: Date): Promise<Cobranca | null> {
    this.registrar("buscarPorReferencia", { referencia });
    const antes = this.falhaAntes("buscarPorReferencia");
    if (antes) throw antes;
    if (!referenciaValida(referencia)) return null;
    const inicio = Math.min(desde.getTime(), this.agora().getTime()) - MARGEM_BUSCA_MS;
    for (const r of this.registros.values()) {
      if (!r.esquecida && r.cobranca.referencia === referencia && r.criadaEm.getTime() >= inicio && this.jaAparece(r)) return this.vista(r);
    }
    return null;
  }

  /** A Payments API pela referência (qualquer situação), com o mesmo atraso da busca. */
  async existePagamentoPorReferencia(referencia: string, _desde: Date): Promise<boolean> {
    void _desde; // Como o cliente real: a data não filtra.
    this.registrar("existePagamentoPorReferencia", { referencia });
    const antes = this.falhaAntes("existePagamentoPorReferencia");
    if (antes) throw antes;
    if (!referenciaValida(referencia)) return false;
    return [...this.registros.values()].some((r) => r.cobranca.referencia === referencia && this.jaAparece(r));
  }

  /** A busca só acha a order depois de `atrasoBuscaMs` (o atraso de indexação do provedor). */
  private jaAparece(r: Registro): boolean {
    return this.agora().getTime() - r.criadaEm.getTime() >= this.atrasoBuscaMs;
  }

  async detalheFinanceiro(c: Cobranca): Promise<DetalheFinanceiro> {
    this.registrar("detalheFinanceiro", { id: c.idProvedor, referencia: c.referencia });
    if (this.falhaAntes("detalheFinanceiro")) return { ...NADA };
    const r = this.registros.get(c.idProvedor);
    if (!r) return { ...NADA };
    const f = copiarFinanceiro(r.financeiro);
    // Liberação parcela a parcela (só cartão): como o cliente real, nada fica "liberado" de uma vez.
    return r.cobranca.forma === "cartao" && this.liberacaoEmParcelas ? { ...f, liberado: null, liberacaoEmParcelas: true } : f;
  }

  async cancelar(idProvedor: string, chaveIdempotencia: string): Promise<ResultadoCancelamento> {
    this.registrar("cancelar", { id: idProvedor, chave: chaveIdempotencia });
    if (this.falhaAntes("cancelar")) return "erro";
    if (!idProvedorValido(idProvedor) || !chaveIdempotenciaValida(chaveIdempotencia)) return "erro";
    const lembrado = this.chaves.get(chaveIdempotencia);
    if (lembrado) return this.chaveRepetida === "mesma_resposta" && lembrado.metodo === "cancelar" ? lembrado.resultado : "erro";
    const r = this.registros.get(idProvedor);
    let resultado: ResultadoCancelamento;
    if (!r) resultado = "erro";
    else if (r.cobranca.situacao === "cancelado") resultado = "cancelado";
    else if (r.cobranca.situacao === "pendente") {
      // Como a API: só created/action_required se cancelam (um cartão em análise ou processando não).
      this.mudar(idProvedor, "cancelado", "canceled/canceled_transaction");
      resultado = "cancelado";
    } else resultado = "nao_cancelavel";
    this.chaves.set(chaveIdempotencia, { metodo: "cancelar", resultado });
    return this.falhasDepois.cancelar ? "erro" : resultado;
  }

  /**
   * Como o cliente real: confirmada/pedida com o id da devolução nova (com `idDaDevolucao` "ausente", pedida sem id); o
   * 409 order_already_refunded vira confirmada sem id na integral, e na parte do valor incerta (chave repetida) ou
   * recusada/ja_devolvido; outra devolução em andamento (409 order_refund_already_in_process) vira "aguarde", integral ou
   * parcial; order que a leitura não acha mais, recusada/nao_encontrado. Toda resposta traz `codigo` (null nas aceitas e
   * nas validações locais). O limite (`valor_excede`) é o do provedor: o pago real menos o devolvido e o em andamento.
   */
  async devolver(c: Cobranca, chaveIdempotencia: string, valor: number | null, o: OpcoesDevolucao = { repetida: false, conhecidas: [] }): Promise<ResultadoDevolucao> {
    this.registrar("devolver", { id: c.idProvedor, chave: chaveIdempotencia, valor, repetida: o.repetida === true, conhecidas: [...o.conhecidas] });
    const recusada = (mensagem: string, codigo: CodigoDevolucao | null = null): ResultadoDevolucao => ({ situacao: "recusada", idDevolucao: null, mensagem, codigo });
    const incerta = (mensagem: string): ResultadoDevolucao => ({ situacao: "incerta", idDevolucao: null, mensagem, codigo: null });
    const antes = this.falhaAntes("devolver");
    if (antes) return antes.tipo === "credencial" ? recusada(antes.message) : incerta(antes.message);
    if (!idProvedorValido(c.idProvedor)) return recusada("Pagamento sem identificação válida no Mercado Pago.");
    if (!chaveIdempotenciaValida(chaveIdempotencia)) return recusada("Chave de idempotência inválida.");
    const lembrado = this.chaves.get(chaveIdempotencia);
    if (lembrado) {
      return this.chaveRepetida === "mesma_resposta" && lembrado.metodo === "devolver"
        ? { ...lembrado.resultado }
        : incerta("Chave já usada: conferir a devolução no Mercado Pago antes de tentar de novo.");
    }
    const r = this.registros.get(c.idProvedor);
    if (!r || r.esquecida) return recusada("O Mercado Pago não encontrou o pagamento ou a transação.", "nao_encontrado");
    const situacao = r.cobranca.situacao;
    const pago = r.cobranca.pago ?? r.cobranca.valor;
    const pendente = r.devolucoes.filter((d) => d.estado === "andamento").reduce((s, d) => s + d.valor, 0);
    const disponivel = pago - r.cobranca.devolvido - pendente;
    const quanto = valor ?? disponivel;
    const aguarde = (codigo: "em_andamento" | "transitorio"): ResultadoDevolucao => ({
      situacao: "aguarde",
      idDevolucao: null,
      mensagem: codigo === "em_andamento" ? "Já há uma devolução em andamento para este pagamento: aguardar o Mercado Pago concluir." : "O Mercado Pago pediu para esperar antes de devolver; tentar de novo mais tarde com a mesma chave.",
      codigo,
    });
    let resultado: ResultadoDevolucao;
    if (situacao === "devolvido" || (r.cobranca.devolvido >= pago && pago > 0)) {
      // Como o 409 order_already_refunded da API: integral, confirmada; parte do valor, a leitura decide (chave repetida) ou recusada.
      resultado =
        valor === null
          ? { situacao: "confirmada", idDevolucao: null, mensagem: "O Mercado Pago informa que o pagamento já foi devolvido.", codigo: null }
          : o.repetida
            ? incerta("O Mercado Pago informa que o pagamento já foi devolvido inteiro: conferir pela leitura se foi este pedido.")
            : recusada("O Mercado Pago informa que o pagamento já foi devolvido inteiro: conferir pela leitura antes de pedir de novo.", "ja_devolvido");
    } else if (!this.devolvivel(r)) {
      resultado = recusada("O Mercado Pago não permite devolver este pagamento agora.", "nao_permitido");
    } else if (valor !== null && (!Number.isSafeInteger(valor) || valor <= 0)) {
      resultado = recusada("Valor da devolução inválido.");
    } else if (valor !== null && !c.idTransacao) {
      resultado = recusada("Falta o id da transação para a devolução parcial.");
    } else if (pendente > 0) {
      // Como o 409 order_refund_already_in_process (integral ou parcial).
      resultado = aguarde("em_andamento");
    } else if (valor !== null && this.parcialRecusada && r.devolucoes.some((d) => d.estado !== "falhou")) {
      // Como o 400 unsupported_partially_refunds ou o 422 max_refunds_exceeded numa order que já tem devolução.
      resultado = recusada("O Mercado Pago não permite devolver este pagamento (ou mais uma parte dele) pelo sistema.", "nao_permitido");
    } else if (this.respostaDevolucao === "em_andamento" || this.respostaDevolucao === "transitorio") {
      // Espera pedida pelo provedor: a order não muda.
      resultado = aguarde(this.respostaDevolucao);
    } else if (this.respostaDevolucao === "saldo_insuficiente") {
      resultado = recusada("O Mercado Pago pediu saldo disponível na conta para fazer a devolução.", "saldo_insuficiente");
    } else if (this.respostaDevolucao === "prazo") {
      resultado = recusada("O prazo para devolver este pagamento pelo Mercado Pago acabou.", "prazo");
    } else if (quanto <= 0 || quanto > disponivel) {
      resultado = recusada("O valor passa do que ainda pode ser devolvido.", "valor_excede");
    } else {
      const id = `REFTST${seq(++this.devolucoes)}`;
      const completaCom = this.proximaAMenos !== null ? Math.min(this.proximaAMenos, quanto) : quanto;
      const nova: DevolucaoFalsa = { id, estado: "andamento", valor: quanto, completaCom, ocultaLeituras: this.atrasoListagem };
      this.proximaAMenos = null;
      this.atrasoListagem = 0;
      r.devolucoes.push(nova);
      if (this.respostaDevolucao !== "pedida") this.concluirDevolucao(r, nova);
      // Sem o id na resposta, o cliente real não sabe qual é a nossa: pedida, mesmo já concluída (a leitura confirma).
      const semId = this.idDaDevolucao === "ausente";
      resultado =
        this.respostaDevolucao === "pedida" || semId
          ? { situacao: "pedida", idDevolucao: semId ? null : id, mensagem: "Devolução pedida; aguardando confirmação do Mercado Pago.", codigo: null }
          : { situacao: "confirmada", idDevolucao: id, mensagem: "Devolução confirmada pelo Mercado Pago.", codigo: null };
    }
    // "Aguarde": nada foi aceito por esta chave, que não fica guardada (a mesma chave vale de novo depois).
    if (resultado.situacao !== "aguarde") this.chaves.set(chaveIdempotencia, { metodo: "devolver", resultado: { ...resultado } });
    if (this.falhasDepois.devolver) return incerta(this.falhasDepois.devolver.message);
    return resultado;
  }

  async conferirContaDeTeste(): Promise<boolean | null> {
    this.registrar("conferirContaDeTeste");
    if (this.falhaAntes("conferirContaDeTeste")) return null;
    return this.contaDeTeste;
  }

  /** O caso como a Chargebacks API mostra, pelo mesmo filtro do cliente real (`casoDaContestacao`). */
  private casoVisto(x: ContestacaoFalsa): CasoDeContestacao {
    return {
      idCaso: x.idCaso,
      pagamentos: [...x.pagamentos],
      valor: x.valor,
      motivoId: x.motivoId !== null && /^\d{1,6}$/.test(x.motivoId) ? x.motivoId : null,
      motivoCodigo: x.motivoCodigo !== null && MOTIVO_CODIGO.test(x.motivoCodigo) ? x.motivoCodigo : null,
      coberturaAplicada: x.cobertura,
      coberturaElegivel: x.elegivel,
      documentacao: (SITUACOES_DOCUMENTACAO as readonly string[]).includes(x.documentacao) ? (x.documentacao as SituacaoDocumentacao) : "desconhecida",
      prazoDocumentacao: x.prazo ? new Date(x.prazo) : null,
      criadoEm: new Date(x.criadaEm),
      atualizadoEm: new Date(x.atualizadaEm),
      aoVivo: x.aoVivo,
    };
  }

  /** O id do caso chega como número arredondado (`idComo` "numero" com mais de 15 algarismos): o cliente real não lê a resposta. */
  private casoLegivel(x: ContestacaoFalsa): boolean {
    return x.idComo === "texto" || lidoComoNumero(x.idCaso) === x.idCaso;
  }

  /** Como o cliente real: id que não pode existir = null; 403 = sem acesso; 404 = null; "falha" lança; caso ilegível lança. */
  async consultarContestacao(idCaso: string): Promise<CasoDeContestacao | null | SemAcessoContestacao> {
    this.registrar("consultarContestacao", { id: idCaso });
    const antes = this.falhaAntes("consultarContestacao");
    if (antes) throw antes;
    if (!idNumericoValido(idCaso)) return null;
    const resposta = this.respostaChargebacks.consultarContestacao;
    if (resposta === "falha") throw new ErroProvedor("incerto", "A conexão com o Mercado Pago caiu; o pedido pode ter sido recebido.");
    if (resposta === "403") return { semAcesso: true };
    if (resposta === "404") return null;
    const x = this.casos.find((c) => c.idCaso === idCaso);
    if (!x) return null;
    if (!this.casoLegivel(x)) throw new ErroProvedor("incerto", FORMATO);
    return this.casoVisto(x);
  }

  /**
   * Como o cliente real: os casos cujo `payments[]` traz o número (até 20); número que não pode existir = lista vazia; 403
   * = sem acesso; "404" (rota inexistente) e "falha" lançam; um caso ilegível lança (nunca "nenhuma" sem saber).
   */
  async buscarContestacoes(idPagamento: string): Promise<CasoDeContestacao[] | SemAcessoContestacao> {
    this.registrar("buscarContestacoes", { id: idPagamento });
    const antes = this.falhaAntes("buscarContestacoes");
    if (antes) throw antes;
    if (!idNumericoValido(idPagamento)) return [];
    const resposta = this.respostaChargebacks.buscarContestacoes;
    if (resposta === "403") return { semAcesso: true };
    if (resposta === "404") throw new ErroProvedor("incerto", "Não deu para ler as contestações no Mercado Pago.");
    if (resposta === "falha") throw new ErroProvedor("incerto", "A conexão com o Mercado Pago caiu; o pedido pode ter sido recebido.");
    const casos = this.casos.filter((c) => c.pagamentos.includes(idPagamento)).slice(0, MAXIMO_CONTESTACOES_LIDAS);
    if (!casos.every((c) => this.casoLegivel(c))) throw new ErroProvedor("incerto", FORMATO);
    return casos.map((c) => this.casoVisto(c));
  }

  /**
   * A Payments API pelo número, como a documentação descreve: com contestação, charged_back/<estado> (também com a order
   * apagada), ou approved/accredited se a transação voltou a aprovada; sem contestação, pela situação da order.
   * `money_release_status` pelo financeiro. Número desconhecido, que não pode existir, ou `situacaoAusente` = null.
   */
  async situacaoDoPagamento(idPagamento: string): Promise<SituacaoDoPagamento | null> {
    this.registrar("situacaoDoPagamento", { id: idPagamento });
    const antes = this.falhaAntes("situacaoDoPagamento");
    if (antes) throw antes;
    if (!idNumericoValido(idPagamento) || this.situacaoAusente) return null;
    const r = [...this.registros.values()].find((x) => this.numeroDoPagamento(x) === idPagamento) ?? null;
    const caso = this.casos.filter((c) => (r && c.order === r.cobranca.idProvedor) || c.pagamentos.includes(idPagamento)).at(-1);
    if (!r && !caso) return null;
    const liberado = r?.financeiro.liberado;
    const moneyReleaseStatus = liberado === true ? "released" : liberado === false ? "pending" : null;
    if (caso) {
      return r?.contestada?.voltouAprovada
        ? { status: "approved", statusDetail: "accredited", moneyReleaseStatus }
        : { status: "charged_back", statusDetail: CODIGO.test(caso.estado) ? caso.estado : null, moneyReleaseStatus };
    }
    const pares: Record<SituacaoCobranca, [string, string] | null> = {
      pendente: ["pending", "pending_waiting_payment"],
      em_analise: ["in_process", "pending_review_manual"],
      aprovado: ["approved", "accredited"],
      recusado: ["rejected", "cc_rejected_other_reason"],
      cancelado: ["cancelled", "by_collector"],
      expirado: ["cancelled", "expired"],
      devolvido: ["refunded", "refunded"],
      devolvido_parcial: ["approved", "partially_refunded"],
      contestado: ["charged_back", "in_process"],
      desconhecido: null,
    };
    const par = pares[r!.cobranca.situacao];
    return { status: par?.[0] ?? null, statusDetail: par?.[1] ?? null, moneyReleaseStatus };
  }

  /** O número do pagamento na Payments API (o do financeiro, ou o mesmo que a aprovação daria). */
  private numeroDoPagamento(r: Registro): string {
    return r.financeiro.idPagamento ?? numeroDaOrder(r.cobranca.idProvedor);
  }

  /**
   * Dinheiro devolvido na order: inteira = devolvida (ou processed/refunded, que a leitura não reconhece); senão, em parte
   * (ou processed/refunded com `detalheParcial`, como o exemplo da documentação).
   */
  private aplicarDevolucao(r: Registro, valor: number) {
    const pago = r.cobranca.pago ?? r.cobranca.valor;
    const devolvido = r.cobranca.devolvido + valor;
    if (devolvido < pago) {
      const comoDesconhecida = this.detalheParcial === "processed/refunded";
      r.cobranca = { ...r.cobranca, devolvido, situacao: comoDesconhecida ? "desconhecido" : "devolvido_parcial", detalhe: this.detalheParcial };
      return;
    }
    const naoReconhecida = this.detalheDevolvido === "processed/refunded";
    r.cobranca = { ...r.cobranca, devolvido, situacao: naoReconhecida ? "desconhecido" : "devolvido", detalhe: this.detalheDevolvido };
  }

  /** A devolução sai: confirmada, com o valor que de fato voltou (`devolverAMenos`). */
  private concluirDevolucao(r: Registro, d: DevolucaoFalsa) {
    d.estado = "confirmada";
    d.valor = d.completaCom;
    this.aplicarDevolucao(r, d.completaCom);
  }

  // ------------------------------------------------------------ simuladores ("do lado do provedor")

  /**
   * Pagamento aprovado. Taxa/líquido/liberação ficam desconhecidos (null) se não informados; liquido = valor − taxa
   * quando só a taxa vem. Cartão: juros e custo do parcelamento como em `jurosCartao`/`jurosPor`.
   */
  aprovar(id: string, o: OpcoesAprovacao = {}) {
    const r = this.mudar(id, "aprovado", "processed/accredited");
    this.aplicarAprovacao(r, o);
  }

  /** Dinheiro e financeiro da aprovação (o custo do "sem acréscimo" entra na taxa e sai do líquido, como na Payments API). */
  private aplicarAprovacao(r: Registro, o: OpcoesAprovacao = {}) {
    const valor = r.cobranca.valor;
    const parcelado = r.cobranca.forma === "cartao" && (r.cobranca.parcelas ?? 1) > 1;
    const custo = parcelado && this.jurosPor === "vendedor" ? (this.jurosCartao > 0 ? this.jurosCartao : Math.max(1, Math.round(valor / 20))) : 0;
    const juros = parcelado && this.jurosPor === "comprador" ? this.jurosCartao : 0;
    const cartao = r.cobranca.cartao ? { ...r.cobranca.cartao, tresDSStatus: r.tresDS === "on_fraud_risk" ? this.tresDSStatus : null } : null;
    r.cobranca = { ...r.cobranca, pago: valor + juros, cartao };
    const taxa = o.taxa === undefined || o.taxa === null ? null : o.taxa + custo;
    const liquido = o.liquido !== undefined ? (o.liquido === null ? null : o.liquido - custo) : taxa !== null ? valor - taxa : null;
    r.financeiro = {
      taxa,
      liquido,
      liberacaoPrevista: o.liberacaoPrevista ? new Date(o.liberacaoPrevista) : null,
      liberado: o.liberado ?? null,
      idPagamento: numeroDaOrder(r.cobranca.idProvedor),
      liberacaoEmParcelas: false,
      custoParcelasVendedor: r.cobranca.forma === "cartao" ? custo : null,
    };
  }

  /** Atualiza só o financeiro (ex.: o dinheiro foi liberado depois). */
  atualizarFinanceiro(id: string, f: Partial<DetalheFinanceiro>) {
    const r = this.registro(id);
    r.financeiro = copiarFinanceiro({ ...r.financeiro, ...f });
  }

  recusar(id: string) {
    this.mudar(id, "recusado", "failed/failed; pagamento failed/rejected_by_issuer");
  }

  /**
   * Fim do desafio 3DS: aprovado (verificação autenticada); recusado = failed/failed com NOT_AUTHENTICATED, como o
   * sandbox (ou `o.detalhe`, o status_detail da transação, ex.: cc_rejected_3ds_challenge); expirado = canceled/expired.
   */
  concluirDesafio(id: string, fim: "aprovado" | "recusado" | "expirado", o: { detalhe?: string } = {}) {
    const r = this.registro(id);
    if (fim === "aprovado") {
      this.mudar(id, "aprovado", "processed/accredited");
      this.aplicarAprovacao(r);
      if (r.cobranca.cartao) r.cobranca.cartao.tresDSStatus = "AUTHENTICATED";
      return;
    }
    const detalhe = fim === "expirado" ? "canceled/expired" : o.detalhe ? `failed/failed; pagamento failed/${o.detalhe}` : "failed/failed";
    this.mudar(id, fim === "expirado" ? "expirado" : "recusado", detalhe);
    if (fim === "recusado" && r.cobranca.cartao) r.cobranca.cartao.tresDSStatus = "NOT_AUTHENTICATED";
  }

  /** Fim da análise (ou do processamento): aprovado, ou recusado com `motivoRecusaCartao`. */
  concluirAnalise(id: string, fim: "aprovado" | "recusado") {
    const r = this.registro(id);
    if (fim === "aprovado") {
      this.mudar(id, "aprovado", "processed/accredited");
      this.aplicarAprovacao(r);
      return;
    }
    this.mudar(id, "recusado", `failed/failed; pagamento failed/${this.motivoRecusaCartao}`);
  }

  expirar(id: string) {
    this.mudar(id, "expirado", "expired/expired");
  }

  cancelarNoProvedor(id: string) {
    this.mudar(id, "cancelado", "canceled/canceled");
  }

  /**
   * Contestação: `order` = a order inteira em charged_back/<estado>; `transacao` = só a transação charged_back/<estado>
   * numa order processada; `lista` = só o item em transactions.chargebacks[], a order ainda processada. Em todas, o item
   * aparece na lista (salvo `o.naLista` false, que não vale com `lista`) e o caso, na Chargebacks API, com o número deste
   * pagamento em `payments[]`. Cada chamada é uma contestação nova (a segunda disputa no mesmo pagamento); a order mostra
   * o estado da mais nova. Devolve os ids (o número do caso e o CBK…).
   */
  contestar(id: string, como: "order" | "transacao" | "lista" = "order", o: OpcoesContestacao = {}): { idCaso: string; idCbk: string } {
    const r = this.registro(id);
    if (como === "lista" && o.naLista === false) throw new Error("Contestação só na lista precisa aparecer na lista.");
    const x = this.novaContestacao(id, [this.numeroDoPagamento(r)], r.cobranca.pago ?? r.cobranca.valor, o);
    r.contestada = { como, voltouAprovada: false };
    this.atualizarContestada(r);
    return { idCaso: x.idCaso, idCbk: x.idCbk };
  }

  /**
   * Contestação achada só pela Chargebacks API (M8.2e): a order deste número de pagamento (se houver) é apagada, como
   * depois dos 90 dias, e o caso nasce sem item na order. Sem order conhecida, o caso fica só com o número (`o.valor`
   * obrigatório).
   */
  contestarTarde(idPagamento: string, o: OpcoesContestacao = {}): { idCaso: string; idCbk: string } {
    if (!idNumericoValido(idPagamento)) throw new Error("Número de pagamento falso inválido.");
    const r = [...this.registros.values()].find((x) => this.numeroDoPagamento(x) === idPagamento) ?? null;
    const valor = o.valor ?? (r ? r.cobranca.pago ?? r.cobranca.valor : null);
    if (valor === null) throw new Error("Informe o valor da contestação tardia sem order.");
    if (r) r.esquecida = true;
    const x = this.novaContestacao(r?.cobranca.idProvedor ?? null, [idPagamento], valor, { ...o, naLista: false });
    return { idCaso: x.idCaso, idCbk: x.idCbk };
  }

  private novaContestacao(order: string | null, pagamentos: string[], valorPadrao: number, o: OpcoesContestacao): ContestacaoFalsa {
    const n = ++this.contestacoes;
    const agora = this.agora();
    const x: ContestacaoFalsa = {
      order,
      idCaso: o.idCaso ?? String(7_000_000_000 + n),
      idCbk: o.idCbk ?? `CBKTST${seq(n)}`,
      idTransacao: `PAYCBK${seq(n)}`,
      idComo: o.idComo ?? "texto",
      estado: o.estado ?? "in_process",
      valor: o.valor ?? valorPadrao,
      documentacao: o.documentacao ?? "pending",
      prazo: o.prazo === undefined ? new Date(agora.getTime() + 10 * 86_400_000) : o.prazo ? new Date(o.prazo) : null,
      cobertura: o.cobertura ?? null,
      elegivel: o.elegivel === undefined ? true : o.elegivel,
      motivoId: o.motivoId ?? null,
      motivoCodigo: o.motivoCodigo ?? null,
      pagamentos: [...pagamentos],
      naLista: o.naLista ?? true,
      criadaEm: agora,
      atualizadaEm: agora,
      aoVivo: this.aoVivo,
    };
    if (!idNumericoValido(x.idCaso) || !idContestacaoValido(x.idCbk) || !CODIGO.test(x.estado) || !Number.isSafeInteger(x.valor) || x.valor <= 0) {
      throw new Error("Contestação falsa inválida.");
    }
    if (this.casos.some((c) => c.idCaso === x.idCaso || c.idCbk === x.idCbk)) throw new Error("Contestação falsa repetida.");
    this.casos.push(x);
    return x;
  }

  /**
   * A contestação pelo id que o teste tiver: o CBK…, o número do caso, o id da order ou o número do pagamento (nos dois
   * últimos, a mais nova).
   */
  private caso(id: string): ContestacaoFalsa {
    const x =
      this.casos.find((c) => c.idCbk === id || c.idCaso === id) ??
      this.casos.filter((c) => c.order === id || c.pagamentos.includes(id) || (c.order !== null && numeroDaOrder(c.order) === id)).at(-1);
    if (!x) throw new Error(`Contestação falsa inexistente: ${id}`);
    return x;
  }

  /** A situação e o detalhe da order contestada, pelo modo e pelo estado da contestação mais nova dela. */
  private atualizarContestada(r: Registro) {
    const c = r.contestada;
    if (!c) return;
    const id = r.cobranca.idProvedor;
    const daOrder = this.casos.filter((x) => x.order === id);
    const estado = daOrder.at(-1)?.estado ?? "in_process";
    // Como `normalizarSituacao`: um item in_process ou settled na lista contesta, seja qual for a order.
    const pelaLista = daOrder.some((x) => x.naLista && (x.estado === "in_process" || x.estado === "settled"));
    if (c.voltouAprovada || c.como === "lista") this.mudar(id, pelaLista ? "contestado" : "aprovado", "processed/accredited");
    else if (c.como === "transacao") this.mudar(id, "contestado", `processed/accredited; pagamento charged_back/${estado}`);
    else this.mudar(id, "contestado", `charged_back/${estado}`);
  }

  /**
   * O Mercado Pago muda a contestação (M8.2e): `estado` (o status do item e o detalhe da transação: settled, reimbursed,
   * in_process de novo ou um código estranho), `cobertura` (`coverage_applied`: null → true/false) e
   * `transacaoAprovada` (a transação volta a processed/accredited, ou não). `id`: ver `caso`.
   */
  resolverContestacao(id: string, o: { estado?: string; cobertura?: boolean | null; transacaoAprovada?: boolean }) {
    const x = this.caso(id);
    if (o.estado !== undefined) {
      if (!CODIGO.test(o.estado)) throw new Error("Estado de contestação falsa inválido.");
      x.estado = o.estado;
    }
    if (o.cobertura !== undefined) x.cobertura = o.cobertura;
    x.atualizadaEm = this.agora();
    const r = x.order ? this.registros.get(x.order) : undefined;
    if (r?.contestada) {
      if (o.transacaoAprovada !== undefined) r.contestada.voltouAprovada = o.transacaoAprovada;
      this.atualizarContestada(r);
    }
  }

  /** A documentação do caso muda (`documentation_status` e, se vier, `date_documentation_deadline`; null = sem prazo). */
  documentacaoDoCaso(id: string, documentacao: string, prazo?: Date | null) {
    const x = this.caso(id);
    x.documentacao = documentacao;
    if (prazo !== undefined) x.prazo = prazo ? new Date(prazo) : null;
    x.atualizadaEm = this.agora();
  }

  /** O caso passa a mostrar outro pagamento em `payments[]` (o caso não é deste pagamento). */
  casoDeOutroPagamento(id: string, outroPagamento = "8999999999") {
    if (!idNumericoValido(outroPagamento)) throw new Error("Número de pagamento falso inválido.");
    this.caso(id).pagamentos = [outroPagamento];
  }

  /** A contestação nascida com `naLista` false passa a aparecer em `transactions.chargebacks[]` (a lista chega depois). */
  mostrarNaLista(id: string) {
    const x = this.caso(id);
    x.naLista = true;
    const r = x.order ? this.registros.get(x.order) : undefined;
    if (r) this.atualizarContestada(r);
  }

  /** Devolução feita fora do sistema (painel do Mercado Pago): aparece na leitura com id REFPNL…, já confirmada. */
  devolverNoProvedor(id: string, valor: number) {
    const r = this.registro(id);
    if (!Number.isSafeInteger(valor) || valor <= 0) throw new Error("Valor de devolução falsa inválido.");
    r.devolucoes.push({ id: `REFPNL${seq(++this.devolucoesNoPainel)}`, estado: "confirmada", valor, completaCom: valor, ocultaLeituras: 0 });
    this.aplicarDevolucao(r, valor);
  }

  /** Confirma as devoluções que ficaram "pedidas". */
  confirmarDevolucoes(id: string) {
    const r = this.registro(id);
    for (const d of r.devolucoes) if (d.estado === "andamento") this.concluirDevolucao(r, d);
  }

  /** A devolução aceita não saiu: passa a "falhou" na leitura (o devolvido e a situação da order não mudam). */
  falharDevolucao(idDevolucao: string) {
    const d = [...this.registros.values()].flatMap((r) => r.devolucoes).find((x) => x.id === idDevolucao);
    if (!d) throw new Error(`Devolução falsa inexistente: ${idDevolucao}`);
    d.estado = "falhou";
  }

  /** A próxima devolução aceita fica fora das próximas `leituras` leituras (`consultar`), como o atraso do GET do provedor. */
  atrasarListagem(leituras: number) {
    if (!Number.isInteger(leituras) || leituras < 0) throw new Error("Número de leituras inválido.");
    this.atrasoListagem = leituras;
  }

  /** A próxima devolução aceita devolve só `centavos` ao concluir (a order fica devolvida em parte). */
  devolverAMenos(centavos: number) {
    if (!Number.isSafeInteger(centavos) || centavos <= 0) throw new Error("Valor de devolução falsa inválido.");
    this.proximaAMenos = centavos;
  }

  /** A order sai da leitura (como depois de três meses no Mercado Pago): `consultar` dá null e `devolver`, nao_encontrado. */
  esquecerOrder(id: string) {
    this.registro(id).esquecida = true;
  }
}
