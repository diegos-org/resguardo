/**
 * Provedor de pagamento FALSO para testes e desenvolvimento: guarda as orders em memória e
 * nunca usa rede. Ids determinísticos (ORDTST0001, PAYTST0001, REFTST0001…), validação igual à
 * do cliente real, e simuladores para o que no Mercado Pago acontece "do lado de lá"
 * (aprovar, recusar, expirar, contestar, devolver pelo painel…). Cartão (M8.2b): desafio 3DS (o endereço só na
 * resposta da criação, como na API), análise, processamento, recusa sem order, juros do parcelamento pagos pelo
 * hóspede ou pela SCL, liberação em parcelas e atraso da busca pela referência. Devoluções (M8.2c): cada uma tem id (REFTST…;
 * as feitas no painel do provedor, REFPNL…) e aparece na leitura (`devolucoes`); respostas de recusa e de espera com o
 * código, devolução que falha depois de aceita, atraso da listagem, devolução a menos, order devolvida que a leitura não
 * reconhece (processed/refunded) e order que some da leitura (mais de 90 dias).
 *
 * Falhas: `falhar` (todas as chamadas) e `falhas[metodo]` lançam antes de fazer qualquer coisa;
 * `falhasDepois[metodo]` faz a operação e lança em seguida (resposta perdida no caminho). Como
 * no cliente real, `cancelar`, `devolver`, `detalheFinanceiro` e `conferirContaDeTeste` nunca
 * lançam: a falha vira "erro", "incerta"/"recusada", tudo null ou null.
 */
import {
  chaveIdempotenciaValida, emailPlausivel, ErroProvedor, idProvedorValido, PIX_VALIDADE_MINIMA_MINUTOS, problemaNoCartao, problemaNoPedido, RECUSA_GENERICA, referenciaValida,
  validadePixMinutos,
} from "./provedor";
import type {
  Cobranca, CodigoDevolucao, DadosCartao, DetalheFinanceiro, EstadoDevolucaoLida, ModoTresDS, PedidoCartao, PedidoPix, ProvedorPagamento, ResultadoCancelamento, ResultadoCriacao,
  ResultadoDevolucao, SituacaoCobranca, StatusTresDS,
} from "./provedor";

export type MetodoProvedor =
  | "criarPix" | "criarCartao" | "consultar" | "buscarPorReferencia" | "existePagamentoPorReferencia" | "detalheFinanceiro" | "cancelar" | "devolver" | "conferirContaDeTeste";
export type ChamadaFalsa = { metodo: MetodoProvedor; chave: string | null; id: string | null; referencia: string | null; valor: number | null };
export type OpcoesAprovacao = { taxa?: number | null; liquido?: number | null; liberacaoPrevista?: Date | null; liberado?: boolean | null };
/** O que chegou ao provedor no último cartão, sem o token (só se ele veio): para os testes conferirem o que passou por aqui. */
export type PedidoCartaoRecebido = Omit<PedidoCartao, "token"> & { comToken: boolean };

/**
 * Uma devolução da order. `valor`: o pedido enquanto está em andamento e o que de fato voltou depois de concluída;
 * `completaCom`: quanto ela devolve ao concluir (`devolverAMenos`); `ocultaLeituras`: quantas leituras ainda não a mostram.
 */
type DevolucaoFalsa = { id: string; estado: EstadoDevolucaoLida; valor: number; completaCom: number; ocultaLeituras: number };
/** `tresDS` = a verificação do banco pedida na criação (null no Pix); `esquecida` = a leitura não acha mais a order. */
type Registro = { cobranca: Cobranca; criadaEm: Date; financeiro: DetalheFinanceiro; devolucoes: DevolucaoFalsa[]; tresDS: ModoTresDS | null; esquecida: boolean };
type Lembrado =
  | { metodo: "criarPix" | "criarCartao"; id: string | null; resultado: ResultadoCriacao }
  | { metodo: "cancelar"; resultado: ResultadoCancelamento }
  | { metodo: "devolver"; resultado: ResultadoDevolucao };

const NADA: DetalheFinanceiro = { taxa: null, liquido: null, liberacaoPrevista: null, liberado: null, idPagamento: null, liberacaoEmParcelas: false, custoParcelasVendedor: null };
const MARGEM_BUSCA_MS = 5 * 60_000;
const INCERTO_CRIACAO = "Não deu para saber se o pagamento foi criado; conferir pela referência antes de tentar de novo.";

const copiar = (c: Cobranca): Cobranca => ({
  ...c,
  devolucoes: c.devolucoes.map((d) => ({ ...d })),
  pix: c.pix ? { ...c.pix, expiraEm: c.pix.expiraEm ? new Date(c.pix.expiraEm) : null } : null,
  cartao: c.cartao ? { ...c.cartao } : null,
});
const copiarFinanceiro = (f: DetalheFinanceiro): DetalheFinanceiro => ({ ...f, liberacaoPrevista: f.liberacaoPrevista ? new Date(f.liberacaoPrevista) : null });
const copiarCriacao = (r: ResultadoCriacao): ResultadoCriacao => (r.ok ? { ok: true, cobranca: copiar(r.cobranca) } : { ...r, cobranca: r.cobranca ? copiar(r.cobranca) : null });
const seq = (n: number) => String(n).padStart(4, "0");

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
  /** Resposta de `conferirContaDeTeste`. */
  contaDeTeste: boolean | null = true;
  /** Imagem do QR devolvida no Pix (null simula o sandbox que manda ""). */
  imagemPix: string | null = "RkFMU08=";
  /** `live_mode` das orders novas (true simula pagamento real na conta de teste). */
  aoVivo: boolean | null = false;
  /** Tudo o que foi chamado, na ordem, com as chaves de idempotência. */
  readonly chamadas: ChamadaFalsa[] = [];

  private readonly registros = new Map<string, Registro>();
  private readonly chaves = new Map<string, Lembrado>();
  private orders = 0;
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
    return copiar({ ...r.cobranca, devolucoes: visiveis.map((d) => ({ id: d.id, estado: d.estado, valor: d.valor })), devolucaoEmAndamento: visiveis.some((d) => d.estado === "andamento") });
  }

  private registrar(metodo: MetodoProvedor, o: Partial<Omit<ChamadaFalsa, "metodo">> = {}) {
    this.chamadas.push({ metodo, chave: o.chave ?? null, id: o.id ?? null, referencia: o.referencia ?? null, valor: o.valor ?? null });
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

  private novaOrder(base: Omit<Cobranca, "idProvedor" | "idTransacao" | "devolvido" | "devolucaoEmAndamento" | "devolucoes" | "aoVivo" | "valorTransacao">, tresDS: ModoTresDS | null = null): Registro {
    const n = ++this.orders;
    const registro: Registro = {
      cobranca: { ...base, idProvedor: `ORDTST${seq(n)}`, idTransacao: `PAYTST${seq(n)}`, valorTransacao: base.valor, devolvido: 0, devolucaoEmAndamento: false, devolucoes: [], aoVivo: this.aoVivo },
      criadaEm: this.agora(),
      financeiro: { ...NADA },
      devolucoes: [],
      tresDS,
      esquecida: false,
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
   * Como o cliente real: confirmada/pedida com o id da devolução nova; o 409 order_already_refunded vira confirmada sem id;
   * outra devolução em andamento (409 order_refund_already_in_process) vira "aguarde"; order que a leitura não acha mais,
   * recusada/nao_encontrado. Toda resposta traz `codigo` (null nas aceitas e nas validações locais).
   */
  async devolver(c: Cobranca, chaveIdempotencia: string, valor: number | null): Promise<ResultadoDevolucao> {
    this.registrar("devolver", { id: c.idProvedor, chave: chaveIdempotencia, valor });
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
      // Como o 409 order_already_refunded da API.
      resultado = { situacao: "confirmada", idDevolucao: null, mensagem: "O Mercado Pago informa que o pagamento já foi devolvido.", codigo: null };
    } else if (situacao !== "aprovado" && situacao !== "devolvido_parcial") {
      resultado = recusada("O Mercado Pago não permite devolver este pagamento agora.", "nao_permitido");
    } else if (valor !== null && (!Number.isSafeInteger(valor) || valor <= 0)) {
      resultado = recusada("Valor da devolução inválido.");
    } else if (valor !== null && !c.idTransacao) {
      resultado = recusada("Falta o id da transação para a devolução parcial.");
    } else if (valor === null && pendente > 0) {
      // Como o 409 order_refund_already_in_process.
      resultado = aguarde("em_andamento");
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
      if (this.respostaDevolucao === "pedida") {
        resultado = { situacao: "pedida", idDevolucao: id, mensagem: "Devolução pedida; aguardando confirmação do Mercado Pago.", codigo: null };
      } else {
        this.concluirDevolucao(r, nova);
        resultado = { situacao: "confirmada", idDevolucao: id, mensagem: "Devolução confirmada pelo Mercado Pago.", codigo: null };
      }
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

  /** Dinheiro devolvido na order: inteira = devolvida (ou processed/refunded, que a leitura não reconhece); senão, em parte. */
  private aplicarDevolucao(r: Registro, valor: number) {
    const pago = r.cobranca.pago ?? r.cobranca.valor;
    const devolvido = r.cobranca.devolvido + valor;
    if (devolvido < pago) {
      r.cobranca = { ...r.cobranca, devolvido, situacao: "devolvido_parcial", detalhe: "processed/partially_refunded" };
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
      idPagamento: String(9_000_000_000 + Number(r.cobranca.idProvedor.replace(/\D/g, "") || 0)),
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
   * Contestação: `order` = a order inteira em charged_back/in_process; `transacao` = só a transação charged_back/in_process
   * numa order processada; `lista` = uma contestação in_process em transactions.chargebacks[], a order ainda processada.
   */
  contestar(id: string, como: "order" | "transacao" | "lista" = "order") {
    const detalhe = { order: "charged_back/in_process", transacao: "processed/accredited; pagamento charged_back/in_process", lista: "processed/accredited" }[como];
    this.mudar(id, "contestado", detalhe);
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
