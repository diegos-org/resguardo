/**
 * Provedor de pagamento FALSO para testes e desenvolvimento: guarda as orders em memória e
 * nunca usa rede. Ids determinísticos (ORDTST0001, PAYTST0001, REFTST0001…), validação igual à
 * do cliente real, e simuladores para o que no Mercado Pago acontece "do lado de lá"
 * (aprovar, recusar, expirar, contestar, devolver pelo painel…).
 *
 * Falhas: `falhar` (todas as chamadas) e `falhas[metodo]` lançam antes de fazer qualquer coisa;
 * `falhasDepois[metodo]` faz a operação e lança em seguida (resposta perdida no caminho). Como
 * no cliente real, `cancelar`, `devolver`, `detalheFinanceiro` e `conferirContaDeTeste` nunca
 * lançam: a falha vira "erro", "incerta"/"recusada", tudo null ou null.
 */
import { chaveIdempotenciaValida, emailPlausivel, ErroProvedor, idProvedorValido, PIX_VALIDADE_MINIMA_MINUTOS, problemaNoCartao, problemaNoPedido, referenciaValida, validadePixMinutos } from "./provedor";
import type { Cobranca, DetalheFinanceiro, PedidoCartao, PedidoPix, ProvedorPagamento, ResultadoCancelamento, ResultadoCriacao, ResultadoDevolucao, SituacaoCobranca } from "./provedor";

export type MetodoProvedor = "criarPix" | "criarCartao" | "consultar" | "buscarPorReferencia" | "detalheFinanceiro" | "cancelar" | "devolver" | "conferirContaDeTeste";
export type ChamadaFalsa = { metodo: MetodoProvedor; chave: string | null; id: string | null; referencia: string | null; valor: number | null };
export type OpcoesAprovacao = { taxa?: number | null; liquido?: number | null; liberacaoPrevista?: Date | null; liberado?: boolean | null };

type Registro = { cobranca: Cobranca; criadaEm: Date; financeiro: DetalheFinanceiro; pendentes: { id: string; valor: number }[] };
type Lembrado =
  | { metodo: "criarPix" | "criarCartao"; id: string | null; resultado: ResultadoCriacao }
  | { metodo: "cancelar"; resultado: ResultadoCancelamento }
  | { metodo: "devolver"; resultado: ResultadoDevolucao };

const NADA: DetalheFinanceiro = { taxa: null, liquido: null, liberacaoPrevista: null, liberado: null, idPagamento: null };
const MARGEM_BUSCA_MS = 5 * 60_000;
const INCERTO_CRIACAO = "Não deu para saber se o pagamento foi criado; conferir pela referência antes de tentar de novo.";

const copiar = (c: Cobranca): Cobranca => ({ ...c, pix: c.pix ? { ...c.pix, expiraEm: c.pix.expiraEm ? new Date(c.pix.expiraEm) : null } : null });
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
  /** Desfecho do próximo cartão. */
  respostaCartao: "aprovado" | "recusado" | "em_analise" | "pendente" = "aprovado";
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

  private mudar(id: string, situacao: SituacaoCobranca, detalhe: string) {
    const r = this.registro(id);
    r.cobranca = { ...r.cobranca, situacao, detalhe };
    return r;
  }

  private novaOrder(base: Omit<Cobranca, "idProvedor" | "idTransacao" | "devolvido" | "devolucaoEmAndamento" | "aoVivo" | "valorTransacao">): Registro {
    const n = ++this.orders;
    const registro: Registro = {
      cobranca: { ...base, idProvedor: `ORDTST${seq(n)}`, idTransacao: `PAYTST${seq(n)}`, valorTransacao: base.valor, devolvido: 0, devolucaoEmAndamento: false, aoVivo: this.aoVivo },
      criadaEm: this.agora(),
      financeiro: { ...NADA },
      pendentes: [],
    };
    this.registros.set(registro.cobranca.idProvedor, registro);
    return registro;
  }

  /** Chave repetida: resposta conforme `chaveRepetida`; null = chave nova. */
  private repetidaCriacao(chave: string): ResultadoCriacao | null {
    const l = this.chaves.get(chave);
    if (!l) return null;
    if (this.chaveRepetida === "incerto" || (l.metodo !== "criarPix" && l.metodo !== "criarCartao")) {
      return { ok: false, motivo: "incerto", mensagem: INCERTO_CRIACAO, cobranca: null };
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
    const invalido = (mensagem: string): ResultadoCriacao => ({ ok: false, motivo: "dados_invalidos", mensagem, cobranca: null });
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
    });
    return this.concluirCriacao("criarPix", p.chaveIdempotencia, registro, { ok: true, cobranca: copiar(registro.cobranca) });
  }

  async criarCartao(p: PedidoCartao): Promise<ResultadoCriacao> {
    this.registrar("criarCartao", { chave: p.chaveIdempotencia, referencia: p.referencia, valor: p.valor });
    const antes = this.falhaAntes("criarCartao");
    if (antes) throw antes;
    const problema = problemaNoCartao(p) ?? (emailPlausivel(p.email?.trim()) ? null : "E-mail do pagador inválido.");
    if (problema) return { ok: false, motivo: "dados_invalidos", mensagem: problema, cobranca: null };
    const repetida = this.repetidaCriacao(p.chaveIdempotencia);
    if (repetida) return repetida;
    const desfechos: Record<ProvedorFalso["respostaCartao"], { situacao: SituacaoCobranca; detalhe: string }> = {
      aprovado: { situacao: "aprovado", detalhe: "processed/accredited" },
      recusado: { situacao: "recusado", detalhe: "failed/failed; pagamento failed/rejected_by_issuer" },
      em_analise: { situacao: "em_analise", detalhe: "processing/in_review" },
      pendente: { situacao: "pendente", detalhe: "action_required/pending_challenge" },
    };
    const d = desfechos[this.respostaCartao];
    const registro = this.novaOrder({
      referencia: p.referencia,
      ...d,
      forma: "cartao",
      valor: p.valor,
      pago: d.situacao === "aprovado" ? p.valor : null,
      parcelas: p.parcelas,
      pix: null,
    });
    const resultado: ResultadoCriacao = d.situacao === "recusado"
      ? { ok: false, motivo: "recusado", mensagem: "O banco emissor recusou o pagamento. Tente outro cartão ou o Pix.", cobranca: copiar(registro.cobranca) }
      : { ok: true, cobranca: copiar(registro.cobranca) };
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
      if (r.cobranca.referencia === referencia && r.criadaEm.getTime() >= inicio) return copiar(r.cobranca);
    }
    return null;
  }

  async detalheFinanceiro(c: Cobranca): Promise<DetalheFinanceiro> {
    this.registrar("detalheFinanceiro", { id: c.idProvedor, referencia: c.referencia });
    if (this.falhaAntes("detalheFinanceiro")) return { ...NADA };
    const r = this.registros.get(c.idProvedor);
    return r ? copiarFinanceiro(r.financeiro) : { ...NADA };
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
    else if (r.cobranca.situacao === "pendente" || r.cobranca.situacao === "em_analise") {
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

  /** Pagamento aprovado. Taxa/líquido/liberação ficam desconhecidos (null) se não informados; liquido = valor − taxa quando só a taxa vem. */
  aprovar(id: string, o: OpcoesAprovacao = {}) {
    const r = this.mudar(id, "aprovado", "processed/accredited");
    r.cobranca = { ...r.cobranca, pago: r.cobranca.valor };
    const taxa = o.taxa ?? null;
    r.financeiro = {
      taxa,
      liquido: o.liquido !== undefined ? o.liquido : taxa !== null ? r.cobranca.valor - taxa : null,
      liberacaoPrevista: o.liberacaoPrevista ? new Date(o.liberacaoPrevista) : null,
      liberado: o.liberado ?? null,
      idPagamento: String(9_000_000_000 + Number(id.replace(/\D/g, "") || 0)),
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

  expirar(id: string) {
    this.mudar(id, "expirado", "expired/expired");
  }

  cancelarNoProvedor(id: string) {
    this.mudar(id, "cancelado", "canceled/canceled");
  }

  contestar(id: string) {
    this.mudar(id, "contestado", "charged_back/in_process");
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
