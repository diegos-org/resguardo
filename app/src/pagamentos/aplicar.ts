/**
 * Pagamento no site (M8.2a) — aplica uma leitura do provedor a uma tentativa, numa transação curta, com as travas
 * já tomadas (`travarCotacao`). Uma função só para todos os gatilhos (criação, aviso, página, rotina, painel):
 * transições (só por leitura do provedor; o desconhecido nunca sobrescreve), confirmação, taxa e motor, liberação,
 * devolução confirmada e avisos. Nada aqui chama o provedor; o que precisa de chamada (cancelar Pix que sobrou)
 * volta em `cancelar`, para quem chamou fazer depois da transação.
 *
 * Cartão (M8.2b), também só aqui: bandeira, parcelas e resultado da verificação do banco lidos; a etapa de um cartão
 * pendente (desafio do banco, análise, processando) e o endereço do desafio; o prazo das datas no desafio (até o fim
 * dele + 2 min) e a extensão única do cartão em análise; o "parcelamento sem acréscimo" e a liberação em parcelas (nada
 * entra sozinho no livro); o encerramento da tentativa e se ela conta no disjuntor de recusas (avaliado por último).
 */
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { lerRegrasCalendario } from "@/calendario/regras-config";
import { devolucoesPagamento, type EtapaCartao, pagamentos, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { reservaCalculadaPeloMotor } from "@/financeiro/motor";
import { hojeISO } from "@/lib/datas";
import { estenderHold } from "@/site/cotacoes";
import { acertarCaixa } from "./acerto-cancelamento";
import { FOLGA_PRAZO_PAGAMENTO_MS, inicioDoPrazoDeReleitura } from "./andamento";
import { decidirAprovacao } from "./confirmacao";
import { avaliarDisjuntor, contaNoDisjuntor } from "./disjuntor";
import { FUSO_PAGAMENTO, gravarTaxaNaReserva, liberarPeloProvedor, recebimentosDoPagamento } from "./liberacao";
import { type Cobranca, DESAFIO_3DS_MINUTOS, type DetalheFinanceiro, PARCELAS_MAXIMAS, RETENCAO_ORDERS_DIAS, STATUS_TRES_DS, urlDoDesafio } from "./provedor";
import { type CodigoAviso, comDinheiro, MAXIMO_FALHAS_DEVOLUCAO, motivoDoDetalhe, origemDeDevolucaoConhecida, type SituacaoPagamento, situacaoLocal, transicaoPermitida } from "./situacoes";
import { devolucaoDoPagamento, type Pagamento, type Travado } from "./travas";

export type Leitura = {
  /** A order lida; null = o provedor não achou; undefined = não houve leitura da order. */
  cobranca?: Cobranca | null;
  /** Taxa/líquido/liberação; null = não foi lido. */
  financeiro?: DetalheFinanceiro | null;
  /** Criação sem resposta (não se sabe se a order existe). */
  incerta?: boolean;
  /**
   * Criação recusada sem order no corpo: pelo provedor (o 402 sem `data`: a transação falhou no banco ou na análise de
   * risco) ou por dados inválidos (4xx). Nada foi cobrado.
   */
  recusadaSemOrder?: "recusado" | "dados_invalidos";
  /** Código do motivo que a criação devolveu (`ResultadoCriacao.codigo`), quando houve. */
  codigoRecusa?: string | null;
  /** Leitura que veio da resposta da criação (fase 3): só ela traz o endereço do desafio do banco. */
  daCriacao?: boolean;
  /** Procurada pela referência e não achada há tempo demais: a criação não aconteceu. */
  desistir?: boolean;
  /** Id da order com que a leitura foi feita (null = pela referência). Se mudou até a trava, a ausência lida é antiga. */
  idLido?: string | null;
};

export type Efeitos = {
  situacao: SituacaoPagamento;
  mudou: boolean;
  confirmou: boolean;
  /** A leitura da order bateu com a tentativa e foi aplicada (M8.2c: o cancelamento integral exige uma leitura aplicada). */
  aplicada: boolean;
  /** Orders a cancelar no provedor depois da transação (Pix que sobrou, real no ambiente de teste, desafio sem como seguir). */
  cancelar: { id: string; idProvedor: string }[];
};

const ENCERRADAS: readonly SituacaoPagamento[] = ["recusado", "cancelado", "expirado"];
const BANDEIRA = /^[a-z0-9_-]{1,40}$/;
const ID_PAGAMENTO = /^\d{1,30}$/;

export async function aplicarLeitura(tx: Db, organizacaoId: string, t: Travado, pagamentoId: string, leitura: Leitura, agora: Date): Promise<Efeitos> {
  const p = t.tentativas.find((x) => x.id === pagamentoId);
  if (!p) throw new Error("Tentativa fora da cotação travada.");
  const patch: Partial<Pagamento> = { consultadoEm: agora, atualizadoEm: agora };
  const avisos = new Set(p.avisos);
  // Avisos ligados por esta leitura: nenhum passo seguinte da mesma leitura os desliga.
  const ligados = new Set<CodigoAviso>();
  const ligar = (a: CodigoAviso) => {
    avisos.add(a);
    ligados.add(a);
  };
  const desligar = (a: CodigoAviso) => {
    if (!ligados.has(a)) avisos.delete(a);
  };
  const efeitos: Efeitos = { situacao: p.situacao, mudou: false, confirmou: false, aplicada: false, cancelar: [] };
  let situacao: SituacaoPagamento = p.situacao;
  // O financeiro (taxa, líquido, liberação) vem da order lida: só vale se a order for desta tentativa (mais abaixo).
  let f = leitura.financeiro ?? null;

  const semOrder = situacao === "criando" || situacao === "incerta";
  if (leitura.incerta && situacao === "criando") situacao = "incerta";
  if (leitura.recusadaSemOrder && semOrder) {
    situacao = "recusado";
    // "recusado/<código>" ou "dados_invalidos/<código>" (só o código: `motivoDoDetalhe` lê o motivo para o painel).
    const codigo = leitura.codigoRecusa && /^[a-z0-9_]{1,60}$/.test(leitura.codigoRecusa) ? leitura.codigoRecusa : "?";
    patch.detalheProvedor = `${leitura.recusadaSemOrder}/${codigo}`;
  }
  const c = leitura.cobranca;
  let cobrancaAplicada: Cobranca | null = null;
  if (c === null) {
    // Leitura feita antes de outra transação gravar o id da order (a criação terminou no meio): já não vale.
    if (leitura.idLido !== undefined && leitura.idLido !== p.idProvedor) {
      /* nada */
    } else if (p.idProvedor) {
      // Order mais velha que o prazo de consulta do provedor: "não encontrada" é o limite dele, não um problema.
      if (agora.getTime() - p.criadoEm.getTime() < RETENCAO_ORDERS_DIAS * 86_400_000) ligar("order_nao_encontrada");
    }
    else if (leitura.desistir && semOrder) {
      // Procurada pela referência por tempo bastante e nunca achada: a criação não chegou a acontecer.
      situacao = "cancelado";
      patch.detalheProvedor = "nao_criada";
    }
  } else if (c) {
    let confere = c.referencia === p.referencia && (!p.idProvedor || p.idProvedor === c.idProvedor);
    if (confere && !p.idProvedor) {
      const [outra] = await tx.select({ id: pagamentos.id }).from(pagamentos).where(and(eq(pagamentos.organizacaoId, organizacaoId), eq(pagamentos.idProvedor, c.idProvedor), ne(pagamentos.id, p.id))).limit(1);
      if (outra) confere = false;
      else patch.idProvedor = c.idProvedor;
    }
    if (!confere) {
      ligar("referencia_divergente");
      // Order de outra tentativa (ou outra referência): nada do financeiro dela entra aqui (taxa, líquido, liberação).
      f = null;
    } else {
      cobrancaAplicada = c;
      desligar("referencia_divergente");
      desligar("order_nao_encontrada");
      patch.detalheProvedor = c.detalhe.slice(0, 120);
      if (c.aoVivo !== null) patch.aoVivo = c.aoVivo;
      if (c.aoVivo === true) ligar("ao_vivo");
      if (c.pago !== null) patch.valorPago = c.pago;
      const nova = situacaoLocal(c.situacao);
      if (nova === null) ligar("situacao_desconhecida");
      else {
        desligar("situacao_desconhecida");
        // Contestado → devolvido só com um pedido de devolução aceito à espera: ele nunca para (nem com a contestação)
        // e a leitura que mostra o dinheiro devolvido é o que o confirma.
        const aceitaAEspera = devolucaoDoPagamento(t, p.id)?.situacao === "pedida" && devolucaoDoPagamento(t, p.id)?.chaveAceita === true;
        if (transicaoPermitida(situacao, nova) || (aceitaAEspera && situacao === "contestado" && nova === "devolvido")) situacao = nova;
      }
      if (situacao === "pendente" && c.pix) {
        // Uma leitura que não traz o prazo (ou a imagem, ou o link) não apaga o que já se sabia do mesmo Pix.
        patch.pixCopiaECola = c.pix.copiaECola || p.pixCopiaECola;
        patch.pixImagem = c.pix.imagemBase64 ?? p.pixImagem;
        patch.pixLink = c.pix.link ?? p.pixLink;
        patch.pixExpiraEm = c.pix.expiraEm ?? p.pixExpiraEm;
      }
    }
  }
  if (f) patch.financeiroConsultadoEm = agora;
  // M8.2c: o que a leitura aplicada mostrou das devoluções fica gravado (o cancelamento pela política lê daqui: devolvido
  // em parte ou devolução em andamento esperam se resolver). Só valores; a lista de devoluções nunca é gravada.
  if (cobrancaAplicada) {
    patch.devolvidoLido = Number.isSafeInteger(cobrancaAplicada.devolvido) && cobrancaAplicada.devolvido > 0 ? cobrancaAplicada.devolvido : 0;
    patch.devolucaoEmAndamentoLida = cobrancaAplicada.devolucaoEmAndamento === true;
    efeitos.aplicada = true;
  }
  // Pix pendente com o copia e cola, mas sem prazo conhecido: aviso (nunca um prazo suposto).
  if (situacao === "pendente" && (patch.pixCopiaECola ?? p.pixCopiaECola) && !(patch.pixExpiraEm ?? p.pixExpiraEm)) ligar("pix_sem_prazo");
  else desligar("pix_sem_prazo");
  // Saiu do andamento (uma leitura ainda chegou, pelo "Conferir agora"): o aviso de fora do prazo não vale mais.
  if (situacao !== "criando" && situacao !== "incerta" && situacao !== "pendente") desligar("andamento_fora_do_prazo");
  // Pix pago, vencido ou cancelado: o copia e cola e a imagem saem do banco (o prazo fica, para o histórico).
  if (situacao !== "pendente" && situacao !== "criando" && situacao !== "incerta" && (p.pixCopiaECola || p.pixImagem || p.pixLink)) {
    patch.pixCopiaECola = null;
    patch.pixImagem = null;
    patch.pixLink = null;
  }
  if (situacao === "aprovado" && !p.aprovadoEm) patch.aprovadoEm = agora;
  const aoVivo = patch.aoVivo ?? p.aoVivo;
  const idProvedor = patch.idProvedor ?? p.idProvedor;
  /** Manda cancelar esta tentativa no provedor depois da transação; `quem` só é gravado se ninguém pediu antes. */
  const cancelarEsta = (quem: "sistema") => {
    if (!idProvedor) return;
    if (!p.cancelamentoPor && !patch.cancelamentoPor) patch.cancelamentoPor = quem;
    if (!efeitos.cancelar.some((x) => x.id === p.id)) efeitos.cancelar.push({ id: p.id, idProvedor });
  };
  if (situacao === "pendente" && aoVivo === true && idProvedor) cancelarEsta("sistema");

  // Cartão (M8.2b): o que a order diz do cartão, a etapa de um cartão pendente e o prazo das datas.
  if (p.forma === "cartao") {
    const cc = cobrancaAplicada;
    // Só valores válidos; uma leitura sem eles (o GET pode vir sem parcelas) nunca apaga o que já se sabia.
    if (cc && Number.isInteger(cc.parcelas) && cc.parcelas! >= 1 && cc.parcelas! <= PARCELAS_MAXIMAS) patch.parcelas = cc.parcelas;
    if (cc?.cartao?.bandeira && BANDEIRA.test(cc.cartao.bandeira)) patch.bandeira = cc.cartao.bandeira;
    if (cc?.cartao?.tresDSStatus && (STATUS_TRES_DS as readonly string[]).includes(cc.cartao.tresDSStatus)) patch.tresDSStatus = cc.cartao.tresDSStatus;
    if (f?.idPagamento && ID_PAGAMENTO.test(f.idPagamento)) patch.idPagamentoProvedor = f.idPagamento;
    // Etapa só enquanto pendente; sem leitura aplicada da order, fica a que já se sabia.
    let etapa: EtapaCartao | null = null;
    if (situacao === "pendente") etapa = cc ? (cc.cartao?.desafio ? "desafio" : cc.situacao === "em_analise" ? (cc.cartao?.analise ? "analise" : "processando") : null) : p.etapaCartao;
    patch.etapaCartao = etapa;
    // O endereço do desafio só vem na resposta da criação (o GET não traz): a leitura seguinte mantém o guardado.
    patch.desafioUrl = etapa === "desafio" ? (urlDoDesafio(cc?.cartao?.desafioUrl) ?? p.desafioUrl) : null;
    const pedidoValido = t.reserva.estado === "pedido" && t.cotacao.estado === "segurada";
    if (etapa === "desafio") {
      if (patch.desafioUrl) desligar("desafio_sem_url");
      if (!patch.desafioUrl && (leitura.daCriacao || avisos.has("desafio_sem_url"))) {
        // O banco pediu a verificação, mas sem um endereço válido o hóspede não tem como fazê-la: cancela. Só a resposta
        // da criação decide isso (uma leitura da página ou o aviso podem chegar antes dela, sem o endereço); depois de
        // decidido (o aviso fica gravado), toda leitura manda cancelar de novo, até o Mercado Pago confirmar — um
        // cancelamento que falhou não deixa o desafio inútil segurando as datas até vencer.
        ligar("desafio_sem_url");
        cancelarEsta("sistema");
      } else if (!pedidoValido) {
        // O pedido não está mais segurado (prazo acabou, equipe cancelou): a order ainda é cancelável no desafio.
        cancelarEsta("sistema");
      } else {
        // As datas ficam seguradas até o fim do desafio (40 min desde a criação) + 2 min. Só estende; como o QR do Pix,
        // não é desfeito quando o desafio acaba sem dinheiro (no máximo 3 cartões por cotação).
        const ate = new Date(p.criadoEm.getTime() + DESAFIO_3DS_MINUTOS * 60_000 + FOLGA_PRAZO_PAGAMENTO_MS);
        if (await estenderHold(tx, organizacaoId, t.cotacao.id, ate, agora, p.id)) t.cotacao.holdAte = ate;
      }
    } else if ((etapa === "analise" || etapa === "processando") && pedidoValido && !t.tentativas.some((x) => x.prazoAnaliseAte)) {
      // Extensão única por cotação (a primeira leitura em análise ou processando): o tanto editável em Configurações →
      // Calendário; 0 = nenhuma. Depois vale a carência e a regra da aprovação tardia.
      const minutos = (await lerRegrasCalendario(tx, organizacaoId)).site.minutosAnaliseCartao;
      if (minutos > 0) {
        const holdAte = t.cotacao.holdAte?.getTime() ?? 0;
        const ate = new Date(Math.max(holdAte, agora.getTime() + minutos * 60_000));
        if (await estenderHold(tx, organizacaoId, t.cotacao.id, ate, agora, p.id)) t.cotacao.holdAte = ate;
        patch.prazoAnaliseAte = ate;
      }
    }
  }

  // Taxa e líquido: a partir do líquido informado nesta leitura (taxa = valor − líquido), só enquanto aprovado. O
  // registrado à mão nunca muda sozinho (diferente = aviso); o do provedor é atualizado enquanto nenhum recebimento
  // foi lançado (depois disso, diferente = aviso, sem mexer).
  let taxa = p.taxa;
  let liquido = p.liquido;
  /** Líquido informado pelo provedor nesta leitura, válido: é ele que vira o recebimento (nunca o guardado). */
  let liquidoInformado: number | null = null;
  if (f?.liberacaoPrevista) patch.liberacaoPrevistaEm = f.liberacaoPrevista;
  // "Parcelamento sem acréscimo" (M8.2b): o Mercado Pago cobrou da SCL o custo das parcelas e ele está dentro da taxa.
  // Lançado sozinho, o motor tiraria esse custo da parte do proprietário. A trava (nada de taxa, de taxa na reserva nem
  // de liberação automática) não é decidida por leitura: vale enquanto houver qualquer sinal — o custo lido agora ou
  // numa leitura anterior, o aviso já ligado (o parcelado aprovado sem juros também o liga) — e também num parcelado
  // com o custo ainda desconhecido (nunca supor zero; aviso próprio). A reserva confirma com a taxa desconhecida (como
  // um Pix sem o financeiro). Só a liberação registrada à mão pela equipe solta a trava e apaga os avisos.
  const custoLido = p.forma === "cartao" ? (f?.custoParcelasVendedor ?? null) : null;
  if (custoLido !== null && Number.isSafeInteger(custoLido) && custoLido >= 0) patch.custoParcelasVendedor = custoLido;
  let semTaxaAutomatica = false;
  if (p.forma === "cartao") {
    // Liberação registrada: à mão (a origem diz), ou um recebimento em vigor (o registrado à mão que o Mercado Pago
    // conciliou passa a ter origem "provedor"; um estorno tira o recebimento e a trava volta). Com o recebimento em
    // vigor, a taxa já não muda sozinha (diferente = aviso): a trava cumpriu o papel.
    const liberacaoRegistrada =
      !!p.liberacaoConfirmadaEm && (p.liberacaoOrigem === "manual" || (await recebimentosDoPagamento(tx, organizacaoId, p.id)).emVigor.length > 0);
    if (liberacaoRegistrada) {
      // A equipe já registrou a liberação à mão (com o líquido que decidiu): os avisos cumpriram o papel.
      desligar("parcelas_sem_juros");
      desligar("custo_parcelas_desconhecido");
      desligar("liberacao_em_parcelas");
    } else {
      const parcelas = patch.parcelas ?? p.parcelas ?? cobrancaAplicada?.parcelas ?? null;
      const parcelado = (parcelas ?? 1) > 1;
      // O custo lido nesta leitura ou, sem ele (fee_details ausente ou ilegível), o da última leitura que o trouxe.
      const custo = patch.custoParcelasVendedor ?? p.custoParcelasVendedor ?? null;
      // Juros das parcelas são do hóspede: parcelado com o custo cobrado da SCL, ou aprovado sem nenhum juro, é aviso.
      if (parcelado && ((custo ?? 0) > 0 || (situacao === "aprovado" && cobrancaAplicada?.pago === p.valor))) ligar("parcelas_sem_juros");
      // Parcelado com o líquido informado, mas sem dizer se cobrou da SCL o custo das parcelas: aviso, nada lançado.
      if (parcelado && custo === null && f && f.liquido !== null && situacao === "aprovado") ligar("custo_parcelas_desconhecido");
      else if (custo !== null) desligar("custo_parcelas_desconhecido");
      semTaxaAutomatica = (custo ?? 0) > 0 || avisos.has("parcelas_sem_juros") || (parcelado && custo === null);
      // Liberação parcela a parcela: `liberado` já vem null, nada é lançado; a equipe registra à mão.
      if (f?.liberacaoEmParcelas) ligar("liberacao_em_parcelas");
    }
  }
  if (f && f.liquido !== null && situacao === "aprovado" && !semTaxaAutomatica) {
    const lida = p.valor - f.liquido;
    if (lida < 0 || f.liquido > p.valor) ligar("taxa_invalida");
    else {
      desligar("taxa_invalida");
      liquidoInformado = f.liquido;
      if (taxa === lida) {
        // O líquido lido bate com o gravado (do provedor ou registrado à mão): nada diverge no valor. Se esta mesma
        // leitura trouxer a liberação com outra data, o passo da liberação, mais abaixo, liga o aviso de novo.
        desligar("taxa_divergente");
        desligar("liberacao_divergente");
      } else if (p.liberacaoOrigem === "manual") ligar("liberacao_divergente");
      else if (taxa !== null && (await recebimentosDoPagamento(tx, organizacaoId, p.id)).emVigor.length) ligar("taxa_divergente");
      else {
        taxa = lida;
        liquido = f.liquido;
        patch.taxa = taxa;
        patch.liquido = liquido;
        desligar("taxa_divergente");
      }
    }
  }

  let desfecho = p.desfecho;
  let motivoSemReserva = p.motivoSemReserva;
  if (situacao === "aprovado" && desfecho === null && motivoSemReserva === null) {
    const d = await decidirAprovacao(tx, organizacaoId, t, p, cobrancaAplicada, { taxa, liquido }, agora);
    desfecho = d.desfecho;
    motivoSemReserva = d.motivoSemReserva;
    efeitos.confirmou = d.confirmou;
    for (const a of d.avisosPagamento ?? []) ligar(a);
    if (d.desfecho) {
      patch.desfecho = d.desfecho;
      patch.desfechoMotivo = d.desfechoMotivo;
      patch.desfechoEm = agora;
      patch.desfechoPor = null;
    } else patch.motivoSemReserva = d.motivoSemReserva;
  } else if (comDinheiro(situacao) && situacao !== "aprovado" && desfecho === null && motivoSemReserva === null) {
    // O dinheiro chegou já devolvido (no todo ou em parte) ou contestado, sem uma leitura "aprovado" antes: nunca
    // confirma sozinho. Fica sem reserva, com aviso, para a equipe resolver.
    motivoSemReserva = "situacao_inesperada";
    patch.motivoSemReserva = motivoSemReserva;
    ligar("situacao_inesperada");
  } else if (
    desfecho === "reserva" &&
    reservaCalculadaPeloMotor(t.reserva) &&
    !semTaxaAutomatica &&
    taxa !== null &&
    liquido !== null &&
    p.liberacaoOrigem !== "manual" &&
    (patch.taxa !== undefined || t.reserva.taxaCanal !== taxa)
  ) {
    // Taxa conhecida (ou atualizada) depois da confirmação: entra na reserva e o motor roda (nessa ordem), antes de
    // qualquer recebimento desta leitura. Reserva cancelada com devolução integral (M8.2c) não recebe a taxa: não há o
    // que dividir, e gravar a taxa reabriria a conferência dela. A taxa e o líquido do próprio pagamento ficam gravados.
    await gravarTaxaNaReserva(tx, organizacaoId, t.reserva.id, taxa, liquido, null, p.id, agora);
  }

  // Dinheiro chegou nesta tentativa (confirmando a reserva ou não): as outras pendentes da cotação são canceladas no
  // provedor (depois da transação). Um Pix já copiado nunca fica pagável ao lado de um pago (cobrança em dobro).
  // Fora do prazo de releitura, o provedor nem mostra a order: fica o aviso de andamento fora do prazo.
  if (comDinheiro(situacao)) {
    const inicio = inicioDoPrazoDeReleitura(agora).getTime();
    const sobrando = t.tentativas.filter((x) => x.id !== p.id && x.situacao === "pendente" && x.idProvedor && x.criadoEm.getTime() >= inicio && !efeitos.cancelar.some((y) => y.id === x.id));
    for (const x of sobrando) efeitos.cancelar.push({ id: x.id, idProvedor: x.idProvedor! });
    // Quem pediu o cancelamento delas foi o sistema (nunca conta no disjuntor do cartão).
    const semQuem = sobrando.filter((x) => !x.cancelamentoPor).map((x) => x.id);
    if (semQuem.length) {
      await tx.update(pagamentos).set({ cancelamentoPor: "sistema" }).where(and(inArray(pagamentos.id, semQuem), isNull(pagamentos.cancelamentoPor)));
      for (const x of sobrando) x.cancelamentoPor ??= "sistema";
    }
  }

  // Devolução feita, contestação, ou devolução fora do sistema: só avisos (partes c e e cuidam da reserva).
  const dev = devolucaoDoPagamento(t, p.id);
  const devolvidoNoProvedor = situacao === "devolvido" || situacao === "devolvido_parcial";
  // M8.2c: a devolução do próprio cancelamento pela política não é "devolvido por fora" (a registrada por fora, sim: em dobro abaixo).
  const daPropriaDevolucao = !!dev && dev.origem === "cancelamento" && dev.situacao !== "por_fora";
  if (desfecho === "reserva" && devolvidoNoProvedor && !daPropriaDevolucao) ligar("devolvido_por_fora");
  // Devolvido (ou com devolução em andamento) no provedor e também registrado como devolvido por fora: em dobro.
  const porForaRegistrada = desfecho === "por_fora" || dev?.situacao === "por_fora";
  if (porForaRegistrada && (devolvidoNoProvedor || (cobrancaAplicada !== null && (cobrancaAplicada.devolvido > 0 || cobrancaAplicada.devolucaoEmAndamento)))) ligar("devolucao_em_dobro");
  if (situacao === "contestado") ligar("contestado");

  // A devolução pedida, uma regra para as duas origens (M8.2a sem reserva, M8.2c cancelamento). Origem que esta versão não
  // conhece (um banco de prévia compartilhado com uma versão mais nova) fica de fora.
  const conhecida = !!dev && origemDeDevolucaoConhecida(dev.origem);
  const doSemReserva = conhecida && dev!.origem === "sem_reserva" && desfecho === null;
  const doCancelamento = conhecida && dev!.origem === "cancelamento" && desfecho === "reserva" && t.cancelamento?.situacao === "cancelada" && t.cancelamento.direito === "integral";
  /** O integral pedido (o que o hóspede pagou pela leitura do pedido). */
  const devido = dev ? dev.valor : 0;
  const lidas = cobrancaAplicada?.devolucoes ?? [];
  const confirmadasLidas = lidas.filter((x) => x.estado === "confirmada").reduce((s, x) => s + x.valor, 0);
  const emAndamentoLido = lidas.some((x) => x.estado === "andamento") || !!cobrancaAplicada?.devolucaoEmAndamento;

  // Pedido aceito que o Mercado Pago mostra que falhou: só quando a devolução que falhou é a NOSSA (o id gravado), e nada
  // mais está confirmado ou em andamento nem devolvido. Sem o id (a resposta não trouxe uma devolução nova), nunca solta
  // sozinho: fica o aviso de sempre e a equipe resolve pelo painel do Mercado Pago.
  if (
    (doSemReserva || doCancelamento) &&
    dev!.situacao === "pedida" &&
    dev!.chaveAceita &&
    dev!.idProvedor !== null &&
    lidas.some((x) => x.id === dev!.idProvedor && x.estado === "falhou") &&
    !lidas.some((x) => x.estado === "confirmada" || x.estado === "andamento") &&
    cobrancaAplicada?.devolvido === 0 &&
    situacao === "aprovado"
  ) {
    await liberarPedidoQueFalhou(tx, organizacaoId, p, dev!, agora);
    ligar("devolucao_falhou");
    desligar("devolucao_sem_confirmacao");
  }

  // Confirmada pela situação ou, com o pedido aceito, pelo valor: a leitura "processed/refunded" é "desconhecido" de
  // propósito (nunca palpite), mas a soma das devoluções confirmadas que alcança o devido confirma.
  const peloValor = !!dev?.chaveAceita && devido > 0 && confirmadasLidas >= devido && !emAndamentoLido;
  if ((situacao === "devolvido" || peloValor) && (dev?.situacao === "pedida" || dev?.situacao === "recusada") && (doSemReserva || doCancelamento)) {
    const antes = dev.situacao;
    const confirmadaEm = agora;
    const valorConfirmado = confirmadasLidas > 0 ? confirmadasLidas : null;
    await tx
      .update(devolucoesPagamento)
      .set({ situacao: "confirmada", confirmadaEm, confirmadaPor: "leitura", valorConfirmado, proximaTentativaEm: null, chaveEmDuvida: false, chaveAceita: false, atualizadoEm: agora })
      .where(eq(devolucoesPagamento.id, dev.id));
    Object.assign(dev, { situacao: "confirmada" as const, confirmadaEm, confirmadaPor: "leitura" as const, valorConfirmado, proximaTentativaEm: null, chaveEmDuvida: false, chaveAceita: false });
    for (const a of ["devolucao_falhou", "devolucao_sem_confirmacao", "devolucao_parada", "devolucao_fora_do_prazo", "devolucao_a_menor"] as CodigoAviso[]) desligar(a);
    if (doSemReserva) {
      desfecho = "devolucao";
      patch.desfecho = "devolucao";
      patch.desfechoMotivo = dev.motivo;
      patch.desfechoEm = agora;
      patch.desfechoPor = dev.autorId;
    } else {
      // Cancelamento: os componentes de caixa (a saída do que tinha entrado), com o dia desta leitura, conciliados.
      const caixa = await acertarCaixa(tx, organizacaoId, t, p, dev, { data: hojeISO(FUSO_PAGAMENTO, agora), estado: "conciliado", origem: "sincronizacao" }, agora);
      for (const a of caixa.avisos) ligar(a);
    }
    await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "pagamento.devolucao_confirmada", entidade: "pagamento", entidadeId: p.id, mudancas: { devolucao: [antes, "confirmada"] } });
  } else if (devolvidoNoProvedor && desfecho === null && !dev) ligar("devolvido_por_fora");
  else if (
    (doSemReserva || doCancelamento) &&
    dev!.situacao === "pedida" &&
    dev!.chaveAceita &&
    !emAndamentoLido &&
    (situacao === "devolvido_parcial" || (confirmadasLidas > 0 && confirmadasLidas < devido)) &&
    !avisos.has("devolucao_a_menor")
  ) {
    // D14: o Mercado Pago devolveu menos que o integral pedido. Nada é acertado sozinho (a devolução de parte do valor é do
    // M8.2d): o aviso com os dois valores, a espera para (a rotina deixa de reler esta devolução) e a equipe resolve pelo
    // painel do Mercado Pago ("Confirmar devolução feita no painel do Mercado Pago", só o integral) ou com um ajuste.
    ligar("devolucao_a_menor");
    await tx.update(devolucoesPagamento).set({ proximaTentativaEm: null, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev!.id));
    dev!.proximaTentativaEm = null;
    const devolvido = confirmadasLidas > 0 ? confirmadasLidas : (cobrancaAplicada?.devolvido ?? 0);
    await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "pagamento.devolucao_a_menor", entidade: "pagamento", entidadeId: p.id, mudancas: { devolvido: [null, devolvido], devido: [null, devido] } });
  }
  // O dia em que o sistema viu "devolvido" pela primeira vez: só na leitura que leva a "devolvido". O pagamento que já estava
  // devolvido antes da coluna (M8.2c) fica sem ele, e o caixa do cancelamento usa o dia da auditoria dessa leitura.
  if (situacao === "devolvido" && p.situacao !== "devolvido" && !p.devolvidoVistoEm) patch.devolvidoVistoEm = agora;
  // Taxa que não voltou: o provedor não diz quanto da tarifa devolveu (a que ele informa é a da aprovação). Fica
  // pendente até a equipe informar no quadro do pagamento (nunca palpite).
  if (dev?.situacao === "confirmada" && dev.taxaPerdida === null) ligar("taxa_perdida_desconhecida");

  // Liberação: só o pagamento que confirmou a reserva, ainda aprovado, e só com o sinal explícito.
  if (f?.liberado === true) {
    if (desfecho === "reserva" && situacao === "aprovado") {
      const [r] = await tx.select().from(reservas).where(eq(reservas.id, t.reserva.id));
      if (r && reservaCalculadaPeloMotor(r)) {
        // Confirmada, ou cancelada com valor retido (M8.2c): o dinheiro ficou com a empresa e entra como recebimento.
        if (f.liquido === null) ligar("liberacao_sem_valor");
        else if (liquidoInformado !== null) {
          const res = await liberarPeloProvedor(tx, organizacaoId, p, r, liquidoInformado, f.liberacaoPrevista, agora);
          if (res.aviso) ligar(res.aviso);
          else for (const a of ["liberacao_divergente", "liberacao_futura", "liberacao_sem_valor"] as CodigoAviso[]) desligar(a);
          if (res.confirmada && p.liberacaoOrigem !== "provedor") {
            patch.liberacaoConfirmadaEm = agora;
            patch.liberacaoOrigem = "provedor";
          }
        }
      } else if (r?.estado === "cancelada" && !p.liberacaoConfirmadaEm) {
        // Cancelada com devolução integral (M8.2c): o dinheiro volta ao hóspede e nunca entra no livro; a liberação fica
        // registrada só aqui.
        patch.liberacaoConfirmadaEm = agora;
        patch.liberacaoOrigem = "provedor";
      }
    } else if (!p.liberacaoConfirmadaEm) {
      // Liberação de tentativa sem a reserva: fica registrada só aqui, nunca no livro.
      patch.liberacaoConfirmadaEm = agora;
      patch.liberacaoOrigem = "provedor";
    }
  }

  // Encerramento (qualquer forma): a primeira vez que sai do andamento para recusado, cancelado ou vencido. No cartão,
  // decide uma vez se conta no disjuntor, com a etapa e o endereço do desafio de antes desta leitura.
  if (ENCERRADAS.includes(situacao) && !ENCERRADAS.includes(p.situacao) && !p.encerradoEm) {
    patch.encerradoEm = agora;
    if (p.forma === "cartao") {
      const codigo = leitura.codigoRecusa ?? motivoDoDetalhe(patch.detalheProvedor ?? p.detalheProvedor);
      patch.contaNoDisjuntor = contaNoDisjuntor({ ...p, cancelamentoPor: p.cancelamentoPor ?? patch.cancelamentoPor ?? null }, situacao, {
        recusadaSemOrder: leitura.recusadaSemOrder,
        codigo,
        idProvedor,
        aoVivo,
      });
    }
  }

  if (situacao !== p.situacao) patch.situacao = situacao;
  patch.avisos = [...avisos];
  await tx.update(pagamentos).set(patch).where(eq(pagamentos.id, p.id));
  const mudou = situacao !== p.situacao || desfecho !== p.desfecho || motivoSemReserva !== p.motivoSemReserva;
  if (mudou) {
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: null,
      acao: "pagamento.situacao",
      entidade: "pagamento",
      entidadeId: p.id,
      mudancas: {
        ...(situacao !== p.situacao ? { situacao: [p.situacao, situacao] } : {}),
        ...(desfecho !== p.desfecho ? { desfecho: [p.desfecho, desfecho] } : {}),
        ...(motivoSemReserva !== p.motivoSemReserva ? { motivoSemReserva: [p.motivoSemReserva, motivoSemReserva] } : {}),
      },
    });
  }
  // A tentativa travada reflete o que foi gravado (a mesma transação pode aplicar mais de uma leitura).
  Object.assign(p, patch);
  // Por último, com todas as travas do pagamento já tomadas: a tentativa que conta pode desligar o cartão.
  if (patch.contaNoDisjuntor === true) await avaliarDisjuntor(tx, organizacaoId, agora);
  efeitos.situacao = situacao;
  efeitos.mudou = mudou;
  return efeitos;
}

/**
 * Pedido aceito pelo provedor cuja devolução (a nossa, pelo id) o Mercado Pago mostra que falhou: volta a "recusada",
 * sem chave em dúvida nem aceita e com as falhas no máximo — a equipe pede de novo (chave nova) ou, pelas regras de
 * sempre, registra por fora. Sob as travas de quem chama; o aviso fica com `aplicarLeitura`.
 */
async function liberarPedidoQueFalhou(tx: Db, organizacaoId: string, p: Pagamento, dev: Travado["devolucoes"][number], agora: Date): Promise<void> {
  const mudanca = { situacao: "recusada" as const, chaveAceita: false, chaveEmDuvida: false, falhas: MAXIMO_FALHAS_DEVOLUCAO, proximaTentativaEm: null, atualizadoEm: agora };
  await tx.update(devolucoesPagamento).set(mudanca).where(eq(devolucoesPagamento.id, dev.id));
  Object.assign(dev, mudanca);
  await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "pagamento.devolucao_recusada", entidade: "pagamento", entidadeId: p.id, mudancas: { devolucao: ["pedida", "recusada"], motivo: [null, "o Mercado Pago informou que a devolução pedida não saiu"] } });
}
