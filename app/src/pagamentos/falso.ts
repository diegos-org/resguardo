/**
 * Provedor de pagamento FALSO para testes e desenvolvimento: guarda as orders em memória e
 * nunca usa rede. Ids determinísticos (ORDTST0001, PAYTST0001, REFTST0001…), validação igual à
 * do cliente real, e simuladores para o que no Mercado Pago acontece "do lado de lá"
 * (aprovar, recusar, expirar, contestar, devolver pelo painel…). Cartão (M8.2b): desafio 3DS (o endereço só na
 * resposta da criação, como na API), análise, processamento, recusa sem order, juros do parcelamento pagos pelo
 * hóspede ou pela SCL, liberação em parcelas e atraso da busca pela referência.
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
import type { Cobranca, DadosCartao, DetalheFinanceiro, ModoTresDS, PedidoCartao, PedidoPix, ProvedorPagamento, ResultadoCancelamento, ResultadoCriacao, ResultadoDevolucao, SituacaoCobranca, StatusTresDS } from "./provedor";

export type MetodoProvedor =
  | "criarPix" | "criarCartao" | "consultar" | "buscarPorReferencia" | "existePagamentoPorReferencia" | "detalheFinanceiro" | "cancelar" | "devolver" | "conferirContaDeTeste";
export type ChamadaFalsa = { metodo: MetodoProvedor; chave: string | null; id: string | null; referencia: string | null; valor: number | null };
export type OpcoesAprovacao = { taxa?: number | null; liquido?: number | null; liberacaoPrevista?: Date | null; liberado?: boolean | null };
/** O que chegou ao provedor no último cartão, sem o token (só se ele veio): para os testes conferirem o que passou por aqui. */
export type PedidoCartaoRecebido = Omit<PedidoCartao, "token"> & { comToken: boolean };

/** `tresDS` = a verificação do banco pedida na criação (null no Pix). */
type Registro = { cobranca: Cobranca; criadaEm: Date; financeiro: DetalheFinanceiro; pendentes: { id: string; valor: number }[]; tresDS: ModoTresDS | null };
type Lembrado =
  | { metodo: "criarPix" | "criarCartao"; id: string | null; resultado: ResultadoCriacao }
  | { metodo: "cancelar"; resultado: ResultadoCancelamento }
  | { metodo: "devolver"; resultado: ResultadoDevolucao };

const NADA: DetalheFinanceiro = { taxa: null, liquido: null, liberacaoPrevista: null, liberado: null, idPagamento: null, liberacaoEmParcelas: false, custoParcelasVendedor: null };
const MARGEM_BUSCA_MS = 5 * 60_000;
const INCERTO_CRIACAO = "Não deu para saber se o pagamento foi criado; conferir pela referência antes de tentar de novo.";

const copiar = (c: Cobranca): Cobranca => ({
  ...c,
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
  /** "pedida" deixa a devolução esperando `confirmarDevolucoes`. */
  respostaDevolucao: "confirmada" | "pedida" = "confirmada";
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
  private desafios = 0;

  constructor(private readonly agora: () => Date = () => new Date()) {}

  /** Cópia de todas as orders, na ordem de criação. */
  todas(): Cobranca[] {
    return [...this.registros.values()].map((r) => copiar(r.cobranca));
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

  private novaOrder(base: Omit<Cobranca, "idProvedor" | "idTransacao" | "devolvido" | "devolucaoEmAndamento" | "aoVivo" | "valorTransacao">, tresDS: ModoTresDS | null = null): Registro {
    const n = ++this.orders;
    const registro: Registro = {
      cobranca: { ...base, idProvedor: `ORDTST${seq(n)}`, idTransacao: `PAYTST${seq(n)}`, valorTransacao: base.valor, devolvido: 0, devolucaoEmAndamento: false, aoVivo: this.aoVivo },
      criadaEm: this.agora(),
      financeiro: { ...NADA },
      pendentes: [],
      tresDS,
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
    return r ? copiar(r.cobranca) : null;
  }

  async buscarPorReferencia(referencia: string, desde: Date): Promise<Cobranca | null> {
    this.registrar("buscarPorReferencia", { referencia });
    const antes = this.falhaAntes("buscarPorReferencia");
    if (antes) throw antes;
    if (!referenciaValida(referencia)) return null;
    const inicio = Math.min(desde.getTime(), this.agora().getTime()) - MARGEM_BUSCA_MS;
    for (const r of this.registros.values()) {
      if (r.cobranca.referencia === referencia && r.criadaEm.getTime() >= inicio && this.jaAparece(r)) return copiar(r.cobranca);
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

  async devolver(c: Cobranca, chaveIdempotencia: string, valor: number | null): Promise<ResultadoDevolucao> {
    this.registrar("devolver", { id: c.idProvedor, chave: chaveIdempotencia, valor });
    const recusada = (mensagem: string): ResultadoDevolucao => ({ situacao: "recusada", idDevolucao: null, mensagem });
    const antes = this.falhaAntes("devolver");
    if (antes) return antes.tipo === "credencial" ? recusada(antes.message) : { situacao: "incerta", idDevolucao: null, mensagem: antes.message };
    if (!idProvedorValido(c.idProvedor)) return recusada("Pagamento sem identificação válida no Mercado Pago.");
    if (!chaveIdempotenciaValida(chaveIdempotencia)) return recusada("Chave de idempotência inválida.");
    const lembrado = this.chaves.get(chaveIdempotencia);
    if (lembrado) {
      return this.chaveRepetida === "mesma_resposta" && lembrado.metodo === "devolver"
        ? { ...lembrado.resultado }
        : { situacao: "incerta", idDevolucao: null, mensagem: "Chave já usada: conferir a devolução no Mercado Pago antes de tentar de novo." };
    }
    const r = this.registros.get(c.idProvedor);
    if (!r) return recusada("O Mercado Pago não encontrou o pagamento ou a transação.");
    const situacao = r.cobranca.situacao;
    const pago = r.cobranca.pago ?? r.cobranca.valor;
    const pendente = r.pendentes.reduce((s, d) => s + d.valor, 0);
    const disponivel = pago - r.cobranca.devolvido - pendente;
    const quanto = valor ?? disponivel;
    let resultado: ResultadoDevolucao;
    if (situacao === "devolvido") {
      // Como o 409 order_already_refunded da API.
      resultado = { situacao: "confirmada", idDevolucao: null, mensagem: "O Mercado Pago informa que o pagamento já foi devolvido." };
    } else if (situacao !== "aprovado" && situacao !== "devolvido_parcial") {
      resultado = recusada("O Mercado Pago não permite devolver este pagamento agora.");
    } else if (valor !== null && (!Number.isSafeInteger(valor) || valor <= 0)) {
      resultado = recusada("Valor da devolução inválido.");
    } else if (valor !== null && !c.idTransacao) {
      resultado = recusada("Falta o id da transação para a devolução parcial.");
    } else if (valor === null && pendente > 0) {
      // Como o 409 order_refund_already_in_process.
      resultado = { situacao: "pedida", idDevolucao: null, mensagem: "Já há uma devolução em andamento para este pagamento." };
    } else if (quanto <= 0 || quanto > disponivel) {
      resultado = recusada("O valor passa do que ainda pode ser devolvido.");
    } else {
      const id = `REFTST${seq(++this.devolucoes)}`;
      if (this.respostaDevolucao === "pedida") {
        r.pendentes.push({ id, valor: quanto });
        r.cobranca = { ...r.cobranca, devolucaoEmAndamento: true };
        resultado = { situacao: "pedida", idDevolucao: id, mensagem: "Devolução pedida; aguardando confirmação do Mercado Pago." };
      } else {
        this.aplicarDevolucao(r, quanto);
        resultado = { situacao: "confirmada", idDevolucao: id, mensagem: "Devolução confirmada pelo Mercado Pago." };
      }
    }
    this.chaves.set(chaveIdempotencia, { metodo: "devolver", resultado: { ...resultado } });
    if (this.falhasDepois.devolver) return { situacao: "incerta", idDevolucao: null, mensagem: this.falhasDepois.devolver.message };
    return resultado;
  }

  async conferirContaDeTeste(): Promise<boolean | null> {
    this.registrar("conferirContaDeTeste");
    if (this.falhaAntes("conferirContaDeTeste")) return null;
    return this.contaDeTeste;
  }

  private aplicarDevolucao(r: Registro, valor: number) {
    const pago = r.cobranca.pago ?? r.cobranca.valor;
    const devolvido = r.cobranca.devolvido + valor;
    const total = devolvido >= pago;
    r.cobranca = { ...r.cobranca, devolvido, situacao: total ? "devolvido" : "devolvido_parcial", detalhe: total ? "refunded/refunded" : "processed/partially_refunded" };
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

  /** Devolução feita fora do sistema (painel do Mercado Pago). */
  devolverNoProvedor(id: string, valor: number) {
    const r = this.registro(id);
    if (!Number.isSafeInteger(valor) || valor <= 0) throw new Error("Valor de devolução falsa inválido.");
    this.aplicarDevolucao(r, valor);
  }

  /** Confirma as devoluções que ficaram "pedidas". */
  confirmarDevolucoes(id: string) {
    const r = this.registro(id);
    for (const d of r.pendentes.splice(0)) this.aplicarDevolucao(r, d.valor);
    r.cobranca = { ...r.cobranca, devolucaoEmAndamento: false };
  }
}
