/**
 * Pagamento no site (M8.2a) — consultas para o site e o painel. Nenhuma devolve dado pessoal (não há nenhum
 * guardado aqui); o QR do Pix só sai com a autorização do pedido (cookie).
 *
 * Na página do hóspede, um pagamento aprovado ou pendente sempre vence "expirada" e "cancelada"; enquanto houver
 * dinheiro sem desfecho, a página nunca convida a fazer uma nova consulta.
 *
 * Cartão (M8.2b): o hóspede vê o desafio do banco (o endereço só com a autorização), o cartão em análise e o cartão
 * recusado sempre com o mesmo texto (o motivo nunca: só a equipe com acesso ao financeiro vê no painel). O painel nunca
 * mostra BIN, últimos dígitos nem titular (nada disso é guardado).
 */
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { lerPaginaLegal } from "@/configuracoes/paginas-legais";
import { entradaQueConta } from "@/configuracoes/politica-cancelamento";
import type { VersoesLegais } from "@/configuracoes/paginas-legais-texto";
import {
  aceitesSite,
  alteracoesReserva,
  type BaseCancelamento,
  cancelamentosReserva,
  contestacoesPagamento,
  cotacoes,
  devolucoesPagamento,
  type DireitoCancelamento,
  type EstadoReserva,
  eventosPagamento,
  imoveis,
  lancamentos,
  type MotivoCancelamentoEmpresa,
  pagamentos,
  type QuemCancelaReserva,
  reservas,
  type SituacaoCancelamento,
  type SituacaoDevolucao,
} from "@/db/schema";
import type { Db } from "@/db/types";
import { reservaCalculadaPeloMotor } from "@/financeiro/motor";
import { hojeISO, instanteLocal } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { reservaCalculadaSql } from "@/portal/posse";
import { politicaDoPagamento, versaoDaPoliticaDoPagamento } from "@/site/aceites";
import { ALERTA_ANALISE_CARTAO_HORAS, CARENCIA_PAGAMENTO_MS, inicioDoPrazoDePedirDevolucao, inicioDoPrazoDeReleitura, MAXIMO_CARTAO_POR_COTACAO, MAXIMO_PIX_POR_COTACAO, paginaAindaLe } from "./andamento";
import { ambienteMercadoPago, estadoPagamentoDoAmbiente } from "./ambiente";
import { avisosDaDevolucao } from "./avisos-devolucao";
import { entradasDaReserva } from "./entradas";
import { recusaDoCartao } from "./cartao";
import { type AcoesDaDevolucao, acoesDaDevolucao, liberacaoAtrasada, podeRegistrarRecusaNoPainel, porForaPermitidoNoCartao, type RestanteSemReserva, restanteSemReserva } from "./devolucao";
import { ALERTA_RECUSAS_24H, ALERTA_TOKEN_INVALIDO_1H, disjuntorAberto, RECUSAS_PARA_DESLIGAR_24H, recusasNasUltimas24h, recusasPorTokenNaUltimaHora } from "./disjuntor";
import { liquidoQueAindaPodeEntrar } from "./liberacao";
import { type CodigoDevolucao, type ModoTresDS, type StatusTresDS, urlDoDesafio } from "./provedor";
import {
  AVISOS_PAGAMENTO,
  type CodigoAviso,
  codigoMotivo,
  textoDevolucaoAguardandoLiberacaoAtrasada,
  textoDevolucaoDevidaDepoisDaDisputa,
  textoDoAvisoContestado,
  comDinheiro,
  emAndamento,
  motivoDoDetalhe,
  origemDeDevolucaoConhecida,
  type SituacaoPagamento,
  TEXTO_CAIXA_COM_DEVOLVIDO_FORA,
  textoDevolucaoAMenor,
  textoDevolucaoAMenorSemId,
  textoMotivoRecusaCartao,
  textoMotivoSemReserva,
  textoRestanteRecusado,
} from "./situacoes";
import { situacaoEfetiva, valorNovo } from "./alteracao-regras";
import {
  disputaDoPagamento,
  type LinhaEmCurso,
  MOTIVO_CANCELAMENTO_CONTESTACAO,
  NOMES_SITUACAO_CONTESTACAO,
  NOMES_TIPO_CONTESTACAO,
  type TipoContestacao,
  tipoDaDisputaEmCurso,
} from "./contestacao-regras";
import {
  type Alteracao,
  carenciaNoTravado,
  comprometidoNoPagamento,
  type Contestacao,
  type ContextoDaDevolucao,
  type Devolucao,
  devolucaoInexplicada,
  devolucoesDoPagamento,
  devolvidoPelaDisputa,
  dinheiroDaReserva,
  esperaLiberacao,
  type Pagamento,
  possivelmenteNoProvedor,
} from "./travas";

export { pagamentoEmAndamentoOuAprovado } from "./andamento";

export type EstadoPagamentoHospede =
  | "sem_pagamento"
  | "pagar"
  | "pix_aguardando"
  | "pix_vencido"
  | "pix_esgotado"
  | "verificando"
  | "confirmando"
  | "confirmada"
  | "aprovado_sem_datas"
  | "devolucao_pedida"
  | "devolvido"
  | "cartao_desafio"
  | "cartao_em_analise"
  | "cartao_recusado"
  // Reserva paga pelo site e cancelada pela política (M8.2c).
  | "cancelada_devolucao_pedida"
  | "cancelada_devolvida"
  | "cancelada_com_a_equipe"
  | "cancelada_em_conferencia"
  | "cancelada_sem_devolucao";

/**
 * O cancelamento pela política, para a página da reserva e as mensagens ao hóspede (`textoDoCancelamento`): só fatos
 * (datas, valores, versão da política), nenhum dado pessoal e nunca a nota da equipe.
 */
export type CancelamentoParaHospede = {
  recebidoEm: Date;
  quemCancela: QuemCancelaReserva;
  direito: DireitoCancelamento;
  base: BaseCancelamento;
  motivoEmpresa: MotivoCancelamentoEmpresa | null;
  /** O que a decisão devolve (o pago, no integral); null sem valor gravado. */
  valor: number | null;
  /** A soma das devoluções confirmadas que a leitura mostrou; null quando ela não trouxe a lista. */
  valorConfirmado: number | null;
  /** Quando a devolução foi feita (confirmada ou por fora); null enquanto não foi. */
  devolucaoEm: Date | null;
  /** Todas as partes da devolução foram feitas por fora (ver `rotasDaDevolucao`). */
  porFora: boolean;
  /** Ao menos uma parte foi feita por fora (com outras pelo Mercado Pago, as duas frases de como volta). */
  algumaPorFora: boolean;
  /** Quem confirmou a devolução: a leitura do Mercado Pago ou a equipe (vista no painel dele). */
  confirmadaPor: "leitura" | "equipe" | "contestacao" | null;
  /**
   * M8.2d (D13): a devolução (ou uma parte dela, com vários pagamentos) espera o Mercado Pago liberar o pagamento — nada
   * foi pedido ainda, e a página nunca diz "já pedimos"; a data prevista quando há. null nas outras situações.
   */
  aguardandoLiberacao?: { previstaEm: string | null } | null;
  /** O meio das partes pelo Mercado Pago; null quando saem por meios diferentes (M8.2d: reserva no Pix, diferença no cartão). */
  forma: "pix" | "cartao" | null;
  /**
   * Cartão com mais de 78 dias: o sistema não pede a devolução; a equipe faz o estorno pelo painel do Mercado Pago. Só
   * enquanto a devolução por fora do cartão não abriu (recusa do painel registrada, 180 dias...): aberta, o estorno no
   * cartão não sai mais e a página diz que a equipe combina outra forma.
   */
  estornoPelaEquipe: boolean;
  integralAte: string | null;
  arrependimentoAte: string | null;
  /** A política aceita para o arrependimento na entrada (`fimDoArrependimento`); null sem a política gravada. */
  arrependimentoAteEntrada?: boolean | null;
  entradaEm: Date | null;
  politicaVersao: number | null;
};

/**
 * A alteração da reserva paga (M8.2d) como a página da reserva e as mensagens ao hóspede mostram (`textoDaAlteracao`): só
 * fatos (datas, pessoas, valores, prazos, a versão da política), nenhum dado pessoal e nunca a nota da equipe.
 * - `segurada`: as novas datas seguradas (em qualquer direção); no aumento, `pagamento` é a vista do pagamento da diferença.
 * - `aplicada`: a última aplicada, enquanto a devolução dela não terminou e por 30 dias depois de aplicada.
 * - `nao_aplicada`: a diferença foi paga, mas a alteração não pôde valer (o pagamento fica sem reserva, a devolver).
 * - `nao_vale`: a alteração preparada venceu ou a equipe desistiu, sem pagamento, por 7 dias.
 */
export type AlteracaoParaHospede = {
  id: string;
  situacao: "segurada" | "aplicada" | "nao_aplicada" | "nao_vale";
  rumo: "aumento" | "reducao" | "igual";
  antes: { checkin: string; checkout: string; hospedes: number | null; valor: number };
  depois: { checkin: string; checkout: string; hospedes: number; valor: number };
  diferenca: number;
  /** O que a reserva vale depois (no aumento, o de antes mais a diferença; na redução, pela política). */
  valorNovo: number;
  holdAte: Date | null;
  preparadaEm: Date;
  aplicadaEm: Date | null;
  /**
   * A redução pela política: a decisão, a base, o último dia do reembolso integral e o fim do arrependimento (o dia 7 depois
   * do pagamento, se a política para na entrada e a entrada da estadia alterada: a que vale daqui em diante, que o hóspede
   * lê) — null fora da redução.
   */
  reducao: {
    direito: DireitoCancelamento;
    base: BaseCancelamento | null;
    integralAte: string | null;
    arrependimentoAte?: string | null;
    arrependimentoAteEntrada?: boolean | null;
    entradaDaEstadia?: string | null;
  } | null;
  /** A devolução da diferença (as da alteração juntas); null sem redução integral aplicada. */
  devolucao: {
    estado: "aguardando_liberacao" | "pedida" | "feita" | "com_a_equipe" | "em_conferencia";
    valor: number;
    valorConfirmado: number | null;
    em: Date | null;
    previstaEm: string | null;
    /** Pela regra do cancelamento (`rotasDaDevolucao`): todas as partes por fora; alguma por fora; o meio das partes pelo Mercado Pago (null com Pix e cartão). */
    porFora: boolean;
    algumaPorFora: boolean;
    forma: "pix" | "cartao" | null;
    /**
     * A devolução sai pelo estorno que a equipe faz no painel do Mercado Pago (cartão com mais de 78 dias): nunca "já
     * pedimos". Sempre preenchido pelo domínio; opcional só para montar a alteração à mão nos testes.
     */
    estornoPelaEquipe?: boolean;
  } | null;
  /** A diferença paga que não valeu (nao_aplicada): o valor e quando. */
  pagoSemAlteracao: { valor: number; em: Date } | null;
  /** Só na segurada com aumento: o pagamento da diferença (o mesmo formato da página da cotação). */
  pagamento: VistaPagamentoHospede | null;
  politicaVersao: number | null;
  /** A entrada de que a política contou a decisão desta alteração (o retrato: a menor entre a original e a de então). */
  entradaDaPolitica: string;
  /**
   * A entrada de que os prazos da reserva contam agora (`entradaQueConta` da entrada original e da atual): a linha da
   * política, que vale sempre (§8.2). Na aplicada, já com as datas novas.
   */
  entradaDosPrazos: string;
};

export type VistaPagamentoHospede = {
  estado: EstadoPagamentoHospede;
  /** "Ambiente de teste: nenhuma cobrança real" (na parte a, todo pagamento é de teste). */
  ambienteTeste: boolean;
  /** Há pagamento em andamento ou dinheiro sem desfecho: nunca oferecer "faça uma nova consulta". */
  dinheiroSemDesfecho: boolean;
  /** Prazo das datas, quando seguradas. */
  holdAte: Date | null;
  /** Copia e cola, QR e link do Pix aguardando — só com a autorização do pedido. */
  pix: { copiaECola: string; imagemBase64: string | null; link: string | null; expiraEm: Date | null } | null;
  /** Quantos Pix ainda podem ser gerados nesta cotação. */
  pixRestantes: number;
  /** Quantas tentativas com cartão ainda cabem nesta cotação. */
  cartaoRestantes: number;
  /** Forma da tentativa que manda na página (a com dinheiro, senão a mais recente); null sem tentativa. */
  forma: "pix" | "cartao" | null;
  /** Endereço do desafio do banco (https de domínio do Mercado Pago) — só com a autorização do pedido. */
  desafioUrl: string | null;
  /** Cartão encerrado sem dinheiro: recusado (o mesmo texto para todo motivo) ou a verificação do banco não concluída. */
  recusa: "cartao" | "verificacao" | null;
  /**
   * Fim do prazo das datas, mesmo já passado — só no cartão em análise, para a linha fixa da página ("seguradas até…" ou
   * "o prazo acabou às…"); null nas outras situações.
   */
  prazoDasDatas: Date | null;
  /** Código SCL da reserva confirmada pelo pagamento. */
  reservaCodigo: string | null;
  /** Reserva confirmada e outro pagamento da mesma cotação será devolvido (pagamento em dobro). */
  pagamentoEmDobro: boolean;
  devolucao: { situacao: "pedida" | "feita"; em: Date | null } | null;
  /**
   * Algum pagamento desta cotação (Pix ou cartão) foi marcado como real (live_mode) no ambiente de teste: o site não
   * oferece outro nem mostra aquele (quem chama não oferece "Gerar outro Pix" nem o cartão). Não vai ao navegador.
   */
  aoVivo: boolean;
  /**
   * Alguma tentativa ainda pode virar dinheiro e a página ainda a lê (`paginaAindaLe`): a página continua
   * acompanhando mesmo numa situação que não é de espera (ex.: os 3 Pix gastos, o último recusado há pouco).
   */
  acompanhar: boolean;
  /** Reserva cancelada pela política (M8.2c): os fatos do cancelamento; null nas outras situações. */
  cancelamento: CancelamentoParaHospede | null;
  /** Pedido de cancelamento recebido e ainda sem decisão (a reserva continua confirmada): quando chegou. */
  pedidoCancelamentoEm: Date | null;
  /** Esse pedido é de um pagamento sem a política aceita (antes de 9/10): o recibo não cita política nenhuma. */
  pedidoCancelamentoSemPolitica?: boolean;
  /** M8.2d: a alteração da reserva paga que a página mostra (ver `AlteracaoParaHospede`); null sem nenhuma. */
  alteracao?: AlteracaoParaHospede | null;
  /**
   * M8.2d: a reserva confirmada que já teve uma alteração aplicada, como ela está agora (datas, pessoas e o valor da
   * reserva): o resumo da página é o da cotação original e a alteração aplicada só aparece por um tempo. null sem alteração aplicada.
   */
  reservaAtual?: { checkin: string; checkout: string; hospedes: number | null; valor: number | null } | null;
  /**
   * M8.2e: a reserva confirmada tem um pagamento com disputa em curso ("pagamento em conferência"): só com a autorização do
   * pedido (o cookie de quem pagou; quem só tem o código não vê nada a mais). Some com o resultado.
   */
  pagamentoEmConferencia?: boolean;
};

/**
 * O que a página da cotação mostra sobre o pagamento (design "O que o hóspede vê"). `oferecido` = o site oferece o
 * pagamento nesta cotação (`ofertaDePix` ou `ofertaDeCartao`; sem ele, cotação segurada sem tentativa fica
 * "sem_pagamento", o fluxo pela conversa).
 */
export async function vistaDaCotacaoParaHospede(
  db: Db,
  organizacaoId: string,
  cotacaoId: string,
  agora: Date,
  o: { comAutorizacao: boolean; oferecido?: boolean; oferecidoAlteracao?: boolean },
): Promise<VistaPagamentoHospede | null> {
  if (!uuidValido(cotacaoId)) return null;
  const [c] = await db
    .select({
      estado: cotacoes.estado,
      holdAte: cotacoes.holdAte,
      checkin: cotacoes.checkin,
      reservaId: cotacoes.reservaId,
      reservaEstado: reservas.estado,
      reservaCodigo: reservas.codigo,
      reservaCheckin: reservas.checkin,
      reservaCheckout: reservas.checkout,
      reservaHospedes: reservas.hospedes,
      reservaValor: reservas.valorBruto,
    })
    .from(cotacoes)
    .leftJoin(reservas, eq(reservas.id, cotacoes.reservaId))
    .where(and(eq(cotacoes.id, cotacaoId), eq(cotacoes.organizacaoId, organizacaoId)));
  if (!c) return null;
  const tentativas = await db.select().from(pagamentos).where(and(eq(pagamentos.cotacaoId, cotacaoId), eq(pagamentos.organizacaoId, organizacaoId))).orderBy(desc(pagamentos.criadoEm), desc(pagamentos.id));
  const devolucoes = tentativas.length ? await db.select().from(devolucoesPagamento).where(inArray(devolucoesPagamento.pagamentoId, tentativas.map((t) => t.id))) : [];
  // A devolução que manda na página para cada pagamento (M8.2d: várias por pagamento): a aberta, senão a mais nova.
  const devDe = (p: Pagamento) => devolucaoPrincipal(devolucoesDoPagamento({ devolucoes }, p.id));
  const segurada = c.estado === "segurada" && c.reservaEstado === "pedido" && !!c.holdAte && c.holdAte.getTime() > agora.getTime();
  // As tentativas da reserva (sem as da diferença de uma alteração, M8.2d, que têm a vista própria em `alteracao`).
  const daReservaTentativas = tentativas.filter((t) => !t.alteracaoId);
  const pixRestantes = Math.max(0, MAXIMO_PIX_POR_COTACAO - daReservaTentativas.filter((t) => t.forma === "pix").length);
  const cartaoRestantes = Math.max(0, MAXIMO_CARTAO_POR_COTACAO - daReservaTentativas.filter((t) => t.forma === "cartao").length);
  const dinheiroSemDesfecho = tentativas.some((t) => emAndamento(t.situacao) || (comDinheiro(t.situacao) && t.desfecho === null));
  const quemManda = tentativas.find((t) => t.desfecho === "reserva") ?? tentativas.find((t) => comDinheiro(t.situacao)) ?? tentativas[0];
  const base: VistaPagamentoHospede = {
    estado: "sem_pagamento",
    ambienteTeste: tentativas.some((t) => t.ambiente === "teste") || tentativas.length === 0,
    dinheiroSemDesfecho,
    holdAte: segurada ? c.holdAte : null,
    pix: null,
    pixRestantes,
    cartaoRestantes,
    forma: quemManda?.forma ?? null,
    desafioUrl: null,
    recusa: null,
    prazoDasDatas: null,
    reservaCodigo: null,
    pagamentoEmDobro: false,
    devolucao: null,
    aoVivo: tentativas.some((t) => t.aoVivo === true),
    acompanhar: tentativas.some((t) => paginaAindaLe(t, agora)),
    cancelamento: null,
    pedidoCancelamentoEm: null,
  };
  // Dinheiro que já voltou ao hóspede: desfecho de devolução (pelo provedor ou por fora) ou devolvido no provedor.
  const devolvida = (p: Pagamento) => {
    const dev = devDe(p);
    return p.desfecho === "devolucao" || p.desfecho === "por_fora" || dev?.situacao === "confirmada" || dev?.situacao === "por_fora" || p.situacao === "devolvido";
  };
  const comReserva = tentativas.find((t) => t.desfecho === "reserva");
  // M8.2c: o cancelamento ativo da reserva (pedido ou decidido) vem antes de "confirmada".
  const [canc] = comReserva && c.reservaId
    ? await db
        .select()
        .from(cancelamentosReserva)
        .where(and(eq(cancelamentosReserva.reservaId, c.reservaId), eq(cancelamentosReserva.organizacaoId, organizacaoId), inArray(cancelamentosReserva.situacao, ["pedido", "cancelada"])))
    : [];
  if (comReserva && canc?.situacao === "cancelada" && canc.direito) {
    // M8.2d: o cancelamento devolve por pagamento da reserva (o que a confirmou e as diferenças); a página junta as devoluções dele.
    const daReserva = tentativas.filter(dinheiroDaReserva);
    const doCancelamento = devolucoes.filter((d) => d.cancelamentoId === canc.id && d.situacao !== "substituida");
    // M8.2e: as linhas da disputa dos pagamentos da reserva ("Cancelar a reserva contestada" segue o resultado delas).
    const disputas = daReserva.length
      ? await db
          .select({ pagamentoId: contestacoesPagamento.pagamentoId, situacao: contestacoesPagamento.situacao, avisos: contestacoesPagamento.avisos, estadoLido: contestacoesPagamento.estadoLido })
          .from(contestacoesPagamento)
          .where(inArray(contestacoesPagamento.pagamentoId, daReserva.map((p) => p.id)))
      : [];
    return { ...base, ...estadoDoCancelamento(comReserva, daReserva, canc, doCancelamento, agora, devolucoes, disputas), reservaCodigo: c.reservaCodigo, forma: comReserva.forma };
  }
  if (comReserva) {
    // Pagamento em dobro: só enquanto o outro pagamento ainda não voltou ao hóspede (devolvido, o aviso sai). A diferença
    // de uma alteração (M8.2d) é dinheiro da reserva, nunca "em dobro".
    const emDobro = tentativas.some((t) => t.id !== comReserva.id && !dinheiroDaReserva(t) && !t.alteracaoId && comDinheiro(t.situacao) && !devolvida(t));
    const pedido = canc?.situacao === "pedido" ? canc : null;
    const alteracao = c.reservaId ? await alteracaoParaHospede(db, organizacaoId, c.reservaId, tentativas, devolucoes, base, agora, { ...o, entradas: { original: c.checkin, atual: c.reservaCheckin, anteriores: await entradasDaReserva(db, organizacaoId, c.reservaId) } }) : null;
    // A reserva já alterada (alguma alteração aplicada, em qualquer tempo): como ela está agora, para a página não mostrar só
    // as datas e o total da cotação original depois que a alteração sai do quadro.
    const [aplicada] = c.reservaId
      ? await db
          .select({ id: alteracoesReserva.id })
          .from(alteracoesReserva)
          .where(and(eq(alteracoesReserva.reservaId, c.reservaId), eq(alteracoesReserva.organizacaoId, organizacaoId), eq(alteracoesReserva.situacao, "aplicada")))
          .limit(1)
      : [];
    return {
      ...base,
      estado: "confirmada",
      reservaCodigo: c.reservaCodigo,
      pagamentoEmDobro: emDobro,
      pedidoCancelamentoEm: pedido?.pedidoRecebidoEm ?? null,
      ...(pedido ? { pedidoCancelamentoSemPolitica: !(await politicaDoPagamento(db, organizacaoId, comReserva.id)) } : {}),
      ...(alteracao ? { alteracao } : {}),
      ...(aplicada && c.reservaCheckin && c.reservaCheckout ? { reservaAtual: { checkin: c.reservaCheckin, checkout: c.reservaCheckout, hospedes: c.reservaHospedes, valor: c.reservaValor } } : {}),
      // M8.2e: só para quem pagou (o cookie do checkout): uma disputa em curso (aberta ou a confirmar) num pagamento com o
      // dinheiro da reserva; com o resultado, a linha some.
      ...(o.comAutorizacao && (await disputaEmCursoNaCotacao(db, organizacaoId, tentativas.filter(dinheiroDaReserva).map((t) => t.id))) ? { pagamentoEmConferencia: true } : {}),
    };
  }
  // Dinheiro sem a reserva: confirmando, aprovado sem as datas, devolução pedida ou feita. Com mais de um pagamento,
  // "devolvido" só quando todos foram devolvidos; antes disso vale o que ainda está em aberto, nesta ordem: ainda
  // sem decisão (confirmando), sem as datas (a equipe resolve), devolução pedida.
  const comDinheiroSemReserva = tentativas.filter((t) => comDinheiro(t.situacao));
  if (comDinheiroSemReserva.length) {
    const emAberto = comDinheiroSemReserva.filter((p) => !devolvida(p));
    if (!emAberto.length) {
      const p = comDinheiroSemReserva[0];
      const dev = devDe(p);
      return { ...base, estado: "devolvido", devolucao: { situacao: "feita", em: dev?.confirmadaEm ?? (dev?.porForaData ? new Date(`${dev.porForaData}T12:00:00-03:00`) : p.desfechoEm) } };
    }
    if (emAberto.some((p) => !p.motivoSemReserva && !devDe(p))) return { ...base, estado: "confirmando" };
    // Devolução que o Mercado Pago recusou ou não respondeu (parada, à espera da equipe) não é "pedida": a página
    // diz o mesmo que sem as datas (a equipe fala com o hóspede e devolve), nunca que a devolução está andando.
    const pedida = emAberto.find((p) => devDe(p)?.situacao === "pedida");
    if (pedida && emAberto.every((p) => devDe(p)?.situacao === "pedida")) return { ...base, estado: "devolucao_pedida", devolucao: { situacao: "pedida", em: devDe(pedida)!.criadoEm } };
    return { ...base, estado: "aprovado_sem_datas" };
  }
  return estadoPelasTentativas(base, tentativas, segurada, c.holdAte, agora, o);
}

/** M8.2e: algum dos pagamentos tem disputa em curso (aberta ou a confirmar), de qualquer origem (leitura ou equipe). */
async function disputaEmCursoNaCotacao(db: Db, organizacaoId: string, pagamentoIds: readonly string[]): Promise<boolean> {
  if (!pagamentoIds.length) return false;
  const [c] = await db
    .select({ id: contestacoesPagamento.id })
    .from(contestacoesPagamento)
    .where(and(eq(contestacoesPagamento.organizacaoId, organizacaoId), inArray(contestacoesPagamento.pagamentoId, [...pagamentoIds]), inArray(contestacoesPagamento.situacao, ["aberta", "a_confirmar"])))
    .limit(1);
  return !!c;
}

/**
 * A situação da página pelas tentativas de um alvo sem dinheiro ainda (a reserva segurada, ou a diferença de uma alteração
 * segurada, M8.2d): conferindo, desafio do banco, análise, cartão recusado, Pix aguardando, vencido ou esgotado, pagar. Uma
 * regra só para os dois alvos. `tentativas` da mais nova para a mais antiga.
 */
function estadoPelasTentativas(
  base: VistaPagamentoHospede,
  tentativas: readonly Pagamento[],
  segurada: boolean,
  holdAte: Date | null,
  agora: Date,
  o: { comAutorizacao: boolean; oferecido?: boolean },
): VistaPagamentoHospede {
  const pixRestantes = base.pixRestantes;
  const ultima = tentativas[0];
  // Pagamento marcado como real (live_mode) no teste: nunca o QR, o desafio nem "aguardando" (é cancelado na hora).
  // Enquanto o cancelamento não se confirma, "conferindo" (a página continua lendo, e cada leitura manda cancelar de
  // novo); depois, uma situação sem oferta (quem chama não oferece outro pagamento).
  if (ultima?.aoVivo === true) {
    if (emAndamento(ultima.situacao)) return { ...base, estado: "verificando" };
    if (!segurada) return base;
    if (ultima.forma === "cartao") return { ...base, estado: "cartao_recusado", recusa: "cartao" };
    return { ...base, estado: pixRestantes > 0 ? "pix_vencido" : "pix_esgotado" };
  }
  if (ultima && (ultima.situacao === "criando" || ultima.situacao === "incerta")) return { ...base, estado: "verificando" };
  if (ultima?.forma === "cartao") {
    if (ultima.situacao === "pendente") {
      // Desafio do banco: o endereço só com a autorização do pedido, conferido de novo (https de domínio do Mercado
      // Pago); sem ele, a página diz que não deu para abrir a verificação e oferece os outros caminhos.
      if (ultima.etapaCartao === "desafio") return { ...base, estado: "cartao_desafio", desafioUrl: o.comAutorizacao ? urlDoDesafio(ultima.desafioUrl) : null };
      // Em análise, mesmo depois do prazo das datas: o pagamento ainda pode ser aprovado.
      if (ultima.etapaCartao === "analise") return { ...base, estado: "cartao_em_analise", prazoDasDatas: holdAte };
      return { ...base, estado: "verificando" };
    }
    // Recusado, cancelado ou vencido: com as datas seguradas, o hóspede tenta de novo (o mesmo texto para toda recusa).
    if (!segurada) return base;
    return { ...base, estado: "cartao_recusado", recusa: recusaDoCartao(ultima) === "verificacao" ? "verificacao" : "cartao" };
  }
  if (ultima && ultima.situacao === "pendente") {
    // Prazo do Pix desconhecido (o provedor não informou; o painel tem o aviso): continua aguardando, nunca "vencido".
    const semPrazoConhecido = !ultima.pixExpiraEm && !!ultima.pixCopiaECola;
    if (semPrazoConhecido || (ultima.pixExpiraEm && ultima.pixExpiraEm.getTime() > agora.getTime())) {
      const pix = o.comAutorizacao && ultima.pixCopiaECola ? { copiaECola: ultima.pixCopiaECola, imagemBase64: ultima.pixImagem, link: ultima.pixLink, expiraEm: ultima.pixExpiraEm } : null;
      return { ...base, estado: "pix_aguardando", pix };
    }
    // QR vencido pelo relógio e o provedor ainda sem resposta, com o prazo das datas já passado (carência): conferindo.
    if (!segurada) return { ...base, estado: "verificando" };
  }
  if (!segurada) return base;
  if (ultima) return { ...base, estado: pixRestantes > 0 ? "pix_vencido" : "pix_esgotado" };
  return o.oferecido ? { ...base, estado: "pagar" } : base;
}

/** Por quantos dias a página mostra a alteração aplicada (depois de a devolução dela terminar) e a que não vale mais. */
export const DIAS_ALTERACAO_APLICADA_NA_PAGINA = 30;
export const DIAS_ALTERACAO_QUE_NAO_VALE_NA_PAGINA = 7;

/**
 * A alteração da reserva paga que a página mostra (M8.2d, `AlteracaoParaHospede`): a segurada pela situação que vale agora
 * (em qualquer direção; no aumento, com a vista do pagamento da diferença); senão a última aplicada (enquanto a devolução
 * dela não terminou, e por 30 dias); senão a diferença paga que não valeu (enquanto não volta ao hóspede, e por 7 dias
 * depois); senão a que venceu ou de que a equipe desistiu, sem pagamento, por 7 dias.
 */
async function alteracaoParaHospede(
  db: Db,
  organizacaoId: string,
  reservaId: string,
  tentativas: readonly Pagamento[],
  devolucoes: readonly Devolucao[],
  base: VistaPagamentoHospede,
  agora: Date,
  o: { comAutorizacao: boolean; oferecidoAlteracao?: boolean; entradas: EntradasDaReserva },
): Promise<AlteracaoParaHospede | null> {
  const x = await escolherAlteracaoParaHospede(db, organizacaoId, reservaId, tentativas, devolucoes, base, agora, o);
  return x ? comVersaoDaPolitica(db, organizacaoId, x, tentativas, o.entradas) : null;
}

/** A entrada da cotação (a original), a da reserva agora (null sem reserva) e as das alterações aplicadas (`entradasDaReserva`). */
type EntradasDaReserva = { original: string; atual: string | null; anteriores: readonly string[] };

/**
 * A linha da política vale sempre (§8.2): o retrato da alteração só guarda a versão na redução; nas outras, a versão é a
 * do aceite do pagamento que confirmou a reserva (a que continua valendo para ela). Os prazos contam da entrada que conta
 * agora (a menor entre a original e a atual: depois de aplicada, já a nova).
 */
async function comVersaoDaPolitica<T extends AlteracaoParaHospede>(db: Db, organizacaoId: string, x: T, tentativas: readonly Pick<Pagamento, "id" | "desfecho">[], entradas: EntradasDaReserva): Promise<T> {
  const comPrazos = entradas.atual ? { ...x, entradaDosPrazos: entradaQueConta(entradas.original, entradas.atual, entradas.anteriores) } : x;
  if (comPrazos.politicaVersao !== null) return comPrazos;
  const p0 = tentativas.find((t) => t.desfecho === "reserva");
  return p0 ? { ...comPrazos, politicaVersao: await versaoDaPoliticaDoPagamento(db, organizacaoId, p0.id) } : comPrazos;
}

async function escolherAlteracaoParaHospede(
  db: Db,
  organizacaoId: string,
  reservaId: string,
  tentativas: readonly Pagamento[],
  devolucoes: readonly Devolucao[],
  base: VistaPagamentoHospede,
  agora: Date,
  o: { comAutorizacao: boolean; oferecidoAlteracao?: boolean },
): Promise<AlteracaoParaHospede | null> {
  const alteracoes = await db
    .select()
    .from(alteracoesReserva)
    .where(and(eq(alteracoesReserva.reservaId, reservaId), eq(alteracoesReserva.organizacaoId, organizacaoId)))
    .orderBy(desc(alteracoesReserva.criadoEm), desc(alteracoesReserva.id));
  if (!alteracoes.length) return null;
  const carencia = carenciaNoTravado({ tentativas: [...tentativas] }, agora);
  const dias = (n: number) => n * 86_400_000;
  const daAlteracao = (a: Alteracao) => tentativas.filter((t) => t.alteracaoId === a.id);
  // 1. A segurada (pela situação que vale agora), em qualquer direção.
  const segurada = alteracoes.find((a) => situacaoEfetiva(a, agora, carencia(a)) === "segurada");
  if (segurada) {
    const x = comum(segurada, "segurada");
    if (segurada.diferenca > 0) {
      const doAlvo = daAlteracao(segurada);
      const prazoValendo = !!segurada.holdAte && segurada.holdAte.getTime() > agora.getTime();
      const vistaBase: VistaPagamentoHospede = {
        ...base,
        estado: "sem_pagamento",
        holdAte: prazoValendo ? segurada.holdAte : null,
        pix: null,
        pixRestantes: Math.max(0, MAXIMO_PIX_POR_COTACAO - doAlvo.filter((t) => t.forma === "pix").length),
        cartaoRestantes: Math.max(0, MAXIMO_CARTAO_POR_COTACAO - doAlvo.filter((t) => t.forma === "cartao").length),
        forma: doAlvo[0]?.forma ?? null,
        dinheiroSemDesfecho: doAlvo.some((t) => emAndamento(t.situacao) || (comDinheiro(t.situacao) && t.desfecho === null)),
        acompanhar: doAlvo.some((t) => paginaAindaLe(t, agora)),
        reservaCodigo: null,
        pagamentoEmDobro: false,
        devolucao: null,
        cancelamento: null,
        pedidoCancelamentoEm: null,
      };
      // Diferença já paga e ainda sem decisão (o aviso a caminho): "confirmando".
      x.pagamento = doAlvo.some((t) => comDinheiro(t.situacao) && t.desfecho === null && t.motivoSemReserva === null)
        ? { ...vistaBase, estado: "confirmando" }
        : estadoPelasTentativas(vistaBase, doAlvo, prazoValendo, segurada.holdAte, agora, { comAutorizacao: o.comAutorizacao, oferecido: o.oferecidoAlteracao });
    }
    return x;
  }
  // 2. A última aplicada: enquanto a devolução dela não terminou, e por 30 dias.
  const aplicada = alteracoes.find((a) => a.situacao === "aplicada");
  if (aplicada) {
    const x = comum(aplicada, "aplicada");
    x.devolucao = devolucaoDaAlteracao(aplicada, tentativas, devolucoes, agora);
    const aberta = !!x.devolucao && x.devolucao.estado !== "feita";
    const ultimoFato = Math.max(aplicada.aplicadaEm?.getTime() ?? 0, x.devolucao?.em?.getTime() ?? 0);
    if (aberta || agora.getTime() - ultimoFato <= dias(DIAS_ALTERACAO_APLICADA_NA_PAGINA)) {
      // Uma alteração mais nova que não vale (nem paga) vem antes só se for mais recente que a aplicada.
      const maisNova = alteracoes[0];
      if (maisNova.id === aplicada.id || aberta) return x;
    }
  }
  // 3. A diferença paga que não valeu (sem reserva, com o motivo da alteração).
  for (const a of alteracoes) {
    const paga = daAlteracao(a).find((t) => comDinheiro(t.situacao) && t.desfecho !== "alteracao" && codigoMotivo(t.motivoSemReserva)?.startsWith("alteracao_"));
    if (!paga) continue;
    const voltou = paga.desfecho === "devolucao" || paga.desfecho === "por_fora";
    const desde = paga.desfechoEm ?? paga.aprovadoEm ?? paga.criadoEm;
    if (voltou && agora.getTime() - desde.getTime() > dias(DIAS_ALTERACAO_QUE_NAO_VALE_NA_PAGINA)) continue;
    return { ...comum(a, "nao_aplicada"), pagoSemAlteracao: { valor: paga.valor, em: paga.aprovadoEm ?? paga.criadoEm } };
  }
  // 4. A que venceu ou de que a equipe desistiu, sem pagamento, por 7 dias.
  const naoVale = alteracoes[0];
  if (naoVale.situacao !== "aplicada") {
    const em = naoVale.desistidaEm ?? naoVale.expiradaEm ?? naoVale.holdAte ?? naoVale.criadoEm;
    if (!daAlteracao(naoVale).some((t) => comDinheiro(t.situacao)) && agora.getTime() - em.getTime() <= dias(DIAS_ALTERACAO_QUE_NAO_VALE_NA_PAGINA)) return comum(naoVale, "nao_vale");
  }
  if (aplicada) {
    const x = comum(aplicada, "aplicada");
    x.devolucao = devolucaoDaAlteracao(aplicada, tentativas, devolucoes, agora);
    const ultimoFato = Math.max(aplicada.aplicadaEm?.getTime() ?? 0, x.devolucao?.em?.getTime() ?? 0);
    if (agora.getTime() - ultimoFato <= dias(DIAS_ALTERACAO_APLICADA_NA_PAGINA)) return x;
  }
  return null;
}

/** Os fatos de uma alteração para a página e as mensagens, na situação dada (sem a devolução nem o pagamento). */
const comum = (a: Alteracao, situacao: AlteracaoParaHospede["situacao"]): AlteracaoParaHospede => ({
  id: a.id,
  situacao,
  rumo: a.diferenca > 0 ? "aumento" : a.diferenca < 0 ? "reducao" : "igual",
  antes: { checkin: a.checkinAntes, checkout: a.checkoutAntes, hospedes: a.hospedesAntes, valor: a.valorAntes },
  depois: { checkin: a.checkinDepois, checkout: a.checkoutDepois, hospedes: a.hospedesDepois, valor: a.valorDepois },
  diferenca: a.diferenca,
  valorNovo: valorNovo(a),
  holdAte: a.holdAte,
  preparadaEm: a.criadoEm,
  aplicadaEm: a.aplicadaEm,
  reducao:
    a.diferenca < 0 && a.direito
      ? { direito: a.direito, base: a.base, integralAte: a.integralAte, arrependimentoAte: a.arrependimentoAte, arrependimentoAteEntrada: a.arrependimentoAteEntrada, entradaDaEstadia: a.checkinDepois }
      : null,
  devolucao: null,
  pagoSemAlteracao: null,
  pagamento: null,
  politicaVersao: a.politicaVersao,
  entradaDaPolitica: a.entradaDaPolitica,
  entradaDosPrazos: a.entradaDaPolitica,
});

/**
 * Uma alteração (pelo id, desta organização) como as mensagens ao hóspede a contam (`{alteracao}`), na situação dela agora:
 * segurada (pela situação que vale agora), aplicada (com a devolução), não aplicada (a diferença paga sem valer) ou que não
 * vale mais. Sem o pagamento da diferença (a mensagem leva à página). null = não existe nesta organização.
 */
export async function alteracaoParaMensagem(db: Db, organizacaoId: string, alteracaoId: string, agora: Date): Promise<(AlteracaoParaHospede & { reservaId: string; cotacaoId: string }) | null> {
  if (!uuidValido(alteracaoId)) return null;
  const [a] = await db.select().from(alteracoesReserva).where(and(eq(alteracoesReserva.id, alteracaoId), eq(alteracoesReserva.organizacaoId, organizacaoId)));
  if (!a) return null;
  const tentativas = await db.select().from(pagamentos).where(and(eq(pagamentos.cotacaoId, a.cotacaoId), eq(pagamentos.organizacaoId, organizacaoId)));
  const devolucoes = tentativas.length ? await db.select().from(devolucoesPagamento).where(inArray(devolucoesPagamento.pagamentoId, tentativas.map((t) => t.id))) : [];
  const [entradas] = await db
    .select({ original: cotacoes.checkin, atual: reservas.checkin })
    .from(cotacoes)
    .innerJoin(reservas, eq(reservas.id, a.reservaId))
    .where(and(eq(cotacoes.id, a.cotacaoId), eq(cotacoes.organizacaoId, organizacaoId)));
  const extra = { reservaId: a.reservaId, cotacaoId: a.cotacaoId };
  const anteriores = await entradasDaReserva(db, organizacaoId, a.reservaId);
  const comPolitica = (x: AlteracaoParaHospede) => comVersaoDaPolitica(db, organizacaoId, { ...x, ...extra }, tentativas, entradas ? { ...entradas, anteriores } : { original: a.entradaDaPolitica, atual: null, anteriores });
  if (situacaoEfetiva(a, agora, carenciaNoTravado({ tentativas }, agora)(a)) === "segurada") return comPolitica(comum(a, "segurada"));
  if (a.situacao === "aplicada") return comPolitica({ ...comum(a, "aplicada"), devolucao: devolucaoDaAlteracao(a, tentativas, devolucoes, agora) });
  const paga = tentativas.find((t) => t.alteracaoId === a.id && comDinheiro(t.situacao) && t.desfecho !== "alteracao" && codigoMotivo(t.motivoSemReserva)?.startsWith("alteracao_"));
  if (paga) return comPolitica({ ...comum(a, "nao_aplicada"), pagoSemAlteracao: { valor: paga.valor, em: paga.aprovadoEm ?? paga.criadoEm } });
  return comPolitica(comum(a, "nao_vale"));
}

/**
 * Por onde voltam as partes de uma devolução (uma por pagamento, e o restante de cada uma) — a regra única do cancelamento
 * e da alteração: `porFora` só com todas as partes por fora; `algumaPorFora` com pelo menos uma; `forma`, o meio dos
 * pagamentos das partes pelo Mercado Pago (null com Pix e cartão juntos; sem nenhuma pelo Mercado Pago, o do pagamento).
 */
const rotasDaDevolucao = (devs: readonly Devolucao[], formaDe: (d: Devolucao) => Pagamento["forma"] | undefined, padrao: Pagamento["forma"]) => {
  const peloMercadoPago = devs.filter((d) => d.situacao !== "por_fora");
  const formas = new Set(peloMercadoPago.map(formaDe).filter((f) => f !== undefined));
  return {
    porFora: devs.length > 0 && peloMercadoPago.length === 0,
    algumaPorFora: peloMercadoPago.length < devs.length,
    forma: formas.size > 1 ? null : (formas.values().next().value ?? padrao),
  };
};

/**
 * A devolução da diferença de uma alteração aplicada, para a página (as devoluções dela juntas, pela regra única da página
 * da reserva cancelada, `estadoDaCancelada`): esperando a liberação do pagamento (nada pedido ainda: nunca "já pedimos"),
 * pedida, com a equipe, em conferência ou feita — a menos adiantada vale. null sem devolução (redução retida, aumento).
 */
function devolucaoDaAlteracao(a: Alteracao, tentativas: readonly Pagamento[], devolucoes: readonly Devolucao[], agora: Date): AlteracaoParaHospede["devolucao"] {
  const devs = devolucoes.filter((d) => d.alteracaoId === a.id && d.situacao !== "substituida");
  if (!devs.length) return null;
  const doPagamento = (d: Devolucao) => tentativas.find((t) => t.id === d.pagamentoId);
  const vivasDe = (p: Pagamento) => devolucoesDoPagamento({ devolucoes }, p.id);
  const espera = (d: Devolucao) => {
    const p = doPagamento(d);
    return !!p && esperaALiberacao(p, d, vivasDe(p));
  };
  const estados = devs.map((d) => {
    const p = doPagamento(d);
    if (!p) return "cancelada_em_conferencia" as EstadoPagamentoHospede;
    if (espera(d)) return "aguardando" as const;
    return estadoDaCancelada(p, "integral", d, estornaPelaEquipe(p, d, agora), agora, vivasDe(p));
  });
  const ordem = ["aguardando", "cancelada_devolucao_pedida", "cancelada_com_a_equipe", "cancelada_em_conferencia", "cancelada_devolvida"] as const;
  const pior = ordem.find((e) => (estados as string[]).includes(e)) ?? "cancelada_em_conferencia";
  const estado = ({ aguardando: "aguardando_liberacao", cancelada_devolucao_pedida: "pedida", cancelada_com_a_equipe: "com_a_equipe", cancelada_em_conferencia: "em_conferencia", cancelada_devolvida: "feita" } as const)[pior];
  const realizada = (d: Devolucao) => d.situacao === "confirmada" || d.situacao === "por_fora";
  const quando = (d: Devolucao) => (d.situacao === "confirmada" ? d.confirmadaEm : d.situacao === "por_fora" && d.porForaData ? instanteLocal(d.porForaData, "12:00", "America/Sao_Paulo") : null);
  const feitas = devs.every(realizada);
  const ultima = feitas ? [...devs].sort((x, y) => (quando(x)?.getTime() ?? 0) - (quando(y)?.getTime() ?? 0)).at(-1) : undefined;
  const esperando = devs.filter(espera);
  const prevista = esperando.length ? dataMaisTardia(esperando.map((d) => doPagamento(d)?.liberacaoPrevistaEm ?? null)) : null;
  const confirmados = devs.map((d) => (d.situacao === "confirmada" ? d.valorConfirmado : d.situacao === "por_fora" ? (d.porForaValor ?? d.valor) : null));
  const p0 = doPagamento(devs[0]);
  return {
    estado,
    // O restante de uma devolução feita a menos é parte dela: o valor devido é o das devoluções de origem.
    valor: devs.filter((d) => !d.origemDevolucaoId || !devs.some((o) => o.id === d.origemDevolucaoId)).reduce((s2, d) => s2 + d.valor, 0),
    valorConfirmado: feitas && confirmados.every((v) => v !== null) ? confirmados.reduce((s2, v) => s2 + v!, 0) : null,
    em: ultima ? quando(ultima) : null,
    previstaEm: prevista ? hojeISO("America/Sao_Paulo", prevista) : null,
    ...rotasDaDevolucao(devs, (d) => doPagamento(d)?.forma, p0?.forma ?? "pix"),
    estornoPelaEquipe: devs.some((d) => {
      const p = doPagamento(d);
      return !!p && estornaPelaEquipe(p, d, agora);
    }),
  };
}

/**
 * A devolução que manda (a aberta — pedida ou recusada —, senão a mais nova), pela criação (e o id, no empate): as vivas
 * vêm em ordem de id, e os ids são aleatórios (o restante pode ter id menor que o da devolução que ele completa).
 */
const devolucaoPrincipal = (devs: readonly Devolucao[]): Devolucao | undefined => {
  const pelaCriacao = [...devs].sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return [...pelaCriacao].reverse().find((d) => d.situacao === "pedida" || d.situacao === "recusada") ?? pelaCriacao.at(-1);
};

/**
 * D13 na página do hóspede, pela regra única (`esperaLiberacao`): a devolução pedida que espera o Mercado Pago liberar o
 * pagamento — nada dela foi ao Mercado Pago, também quando a fase 2 ainda não rodou (nunca "já pedimos").
 */
const esperaALiberacao = (p: Pagamento, d: Devolucao, devs: readonly Devolucao[]) => d.situacao === "pedida" && esperaLiberacao(p, d, devs);

/**
 * D13: a devolução espera a liberação do pagamento (nada dela está no Mercado Pago: nunca pedida, ou pedida de novo pela
 * equipe depois de uma recusa clara, com o pagamento sem liberação).
 */
const esperandoLiberacao = (d: Pick<Devolucao, "situacao" | "tentativas" | "ultimoCodigo" | "chaveEmDuvida" | "chaveAceita">) =>
  d.situacao === "pedida" && !possivelmenteNoProvedor(d) && d.ultimoCodigo === "aguardando_liberacao";

/**
 * A situação da página numa reserva cancelada pela política (M8.2c), pela devolução: sem devolução; devolvida; pedida
 * (inclusive a aceita ainda sem aparecer, o cartão com mais de 78 dias, que a equipe devolve pelo painel do Mercado
 * Pago enquanto a devolução por fora do cartão não abre, e o cartão recusado com a por fora ainda fechada, que se pede de
 * novo pelo Mercado Pago); em conferência (devolvida a menos, contestada, em parte, ou
 * parada por isso — nunca oferece outra forma de pagar); com a equipe (o Mercado Pago não devolveu: Pix fora do prazo,
 * recusa — inclusive a do painel dele, registrada —, cartão depois dos 180 dias, ou pedida parada depois do prazo).
 * M8.2d: uma devolução por pagamento da reserva; a página mostra a menos adiantada (esperando a liberação > pedida > com a
 * equipe > em conferência > feita), o valor somado e o dia da última.
 */
function estadoDoCancelamento(
  p0: Pagamento,
  pagamentosDaReserva: readonly Pagamento[],
  canc: typeof cancelamentosReserva.$inferSelect,
  devs: readonly Devolucao[],
  agora: Date,
  todas: readonly Devolucao[] = devs,
  disputas: readonly LinhaEmCurso[] = [],
): { estado: EstadoPagamentoHospede; cancelamento: CancelamentoParaHospede } {
  const doPagamento = (d: Devolucao) => pagamentosDaReserva.find((x) => x.id === d.pagamentoId) ?? p0;
  // Todas as devoluções vivas do pagamento (as de alteração também): o que o Mercado Pago mostra devolvido é explicado por elas.
  const vivasDe = (p: Pagamento) => devolucoesDoPagamento({ devolucoes: todas }, p.id);
  const realizada = (d: Devolucao) => d.situacao === "confirmada" || d.situacao === "por_fora";
  const quando = (d: Devolucao) => (d.situacao === "confirmada" ? d.confirmadaEm : d.situacao === "por_fora" && d.porForaData ? instanteLocal(d.porForaData, "12:00", "America/Sao_Paulo") : null);
  const feitas = devs.length > 0 && devs.every(realizada);
  const ultima = feitas ? [...devs].sort((a, b) => (quando(a)?.getTime() ?? 0) - (quando(b)?.getTime() ?? 0)).at(-1) : undefined;
  const principal = ultima ?? devolucaoPrincipal(devs);
  const estados = devs.map((d) => estadoDaCancelada(doPagamento(d), canc.direito!, d, estornaPelaEquipe(doPagamento(d), d, agora), agora, vivasDe(doPagamento(d))));
  const ordem: EstadoPagamentoHospede[] = ["cancelada_devolucao_pedida", "cancelada_com_a_equipe", "cancelada_em_conferencia", "cancelada_devolvida"];
  const esperando = devs.filter((d) => esperaALiberacao(doPagamento(d), d, vivasDe(doPagamento(d))));
  // M8.2e: "Cancelar a reserva contestada" (sem devolução pelo sistema), pelas linhas da disputa dos pagamentos da reserva: em
  // conferência enquanto alguma está em curso; perdida (o resultado confirmado), o dinheiro voltou ao hóspede por ela
  // ("devolvida", com a frase própria); ganha ou encerrada sem efeito, sem devolução. Sem linha nenhuma (lido antes do
  // M8.2e), a situação do pagamento.
  const pelaDisputa = canc.base === MOTIVO_CANCELAMENTO_CONTESTACAO ? situacaoDaDisputaDaReserva(pagamentosDaReserva, disputas) : null;
  const estado: EstadoPagamentoHospede =
    canc.direito === "nenhum"
      ? pelaDisputa === "em_curso"
        ? "cancelada_em_conferencia"
        : pelaDisputa === "perdida"
          ? "cancelada_devolvida"
          : "cancelada_sem_devolucao"
      : devs.length === 0
        ? estadoDaCancelada(p0, canc.direito!, undefined, false, agora, vivasDe(p0))
        : (ordem.find((e) => estados.includes(e)) ?? estados[0]);
  const confirmados = devs.map((d) => (d.situacao === "confirmada" ? d.valorConfirmado : d.situacao === "por_fora" ? (d.porForaValor ?? d.valor) : null));
  const cancelamento: CancelamentoParaHospede = {
    recebidoEm: canc.pedidoRecebidoEm,
    quemCancela: canc.quemCancela,
    direito: canc.direito!,
    base: canc.base ?? (canc.direito === "integral" ? "prazo" : "fora_do_prazo"),
    motivoEmpresa: canc.motivoEmpresa,
    valor: canc.valorADevolver,
    // Uma devolução: a soma das confirmadas que a leitura mostrou (como no M8.2c); várias: a soma, quando todas têm valor.
    valorConfirmado: devs.length === 1 ? (devs[0].valorConfirmado ?? null) : feitas && confirmados.every((v) => v !== null) ? confirmados.reduce((s, v) => s + v!, 0) : null,
    devolucaoEm: ultima ? quando(ultima) : null,
    ...rotasDaDevolucao(devs, (d) => doPagamento(d).forma, p0.forma),
    confirmadaPor: principal?.situacao === "confirmada" ? (principal.confirmadaPor ?? "leitura") : null,
    // A mesma regra do quadro do pagamento (`porForaPermitidoNoCartao`): aberta a devolução por fora, o cartão não é mais o caminho.
    estornoPelaEquipe: devs.some((d) => estornaPelaEquipe(doPagamento(d), d, agora)),
    integralAte: canc.integralAte,
    arrependimentoAte: canc.arrependimentoAte,
    arrependimentoAteEntrada: canc.arrependimentoAteEntrada,
    entradaEm: canc.entradaEm,
    politicaVersao: canc.politicaVersao,
    aguardandoLiberacao:
      esperando.length && estado === "cancelada_devolucao_pedida" ? { previstaEm: ((d) => (d ? hojeISO("America/Sao_Paulo", d) : null))(dataMaisTardia(esperando.map((d) => doPagamento(d).liberacaoPrevistaEm))) } : null,
  };
  return { estado, cancelamento };
}

/**
 * A disputa dos pagamentos de uma reserva para a página do hóspede (M8.2e): em curso se alguma está; senão perdida se
 * alguma foi; senão nada. Sem linha nenhuma (pagamento lido como contestado antes do M8.2e), em curso pela situação.
 */
function situacaoDaDisputaDaReserva(pagamentosDaReserva: readonly Pagamento[], disputas: readonly LinhaEmCurso[]): "em_curso" | "perdida" | null {
  const dela = disputas.filter((d) => pagamentosDaReserva.some((p) => p.id === d.pagamentoId));
  if (!dela.length) return pagamentosDaReserva.some(emDisputa) ? "em_curso" : null;
  const situacoes = pagamentosDaReserva.map((p) => disputaDoPagamento({ contestacoes: dela }, p.id));
  return situacoes.includes("em_curso") ? "em_curso" : situacoes.includes("perdida") ? "perdida" : null;
}

/** A mais tardia das datas (null se alguma falta). */
const dataMaisTardia = (ds: readonly (Date | null)[]): Date | null => (ds.some((d) => !d) ? null : new Date(Math.max(...ds.map((d) => d!.getTime()))));

/**
 * A situação da reserva cancelada pela política, pela devolução (a regra única da página do hóspede e do quadro do
 * painel): sem devolução; devolvida; em conferência; pedida (ou o estorno no cartão feito pela equipe, ou esperando a
 * liberação do pagamento); com a equipe. `vivas`: todas as devoluções vivas do pagamento (M8.2d: a de uma redução
 * confirmada antes explica o pagamento devolvido em parte; só a do cancelamento o deixaria "em conferência").
 */
function estadoDaCancelada(p: Pagamento, direito: DireitoCancelamento, dev: Devolucao | undefined, estornoPelaEquipe: boolean, agora: Date, vivas: readonly Devolucao[] = dev ? [dev] : []): EstadoPagamentoHospede {
  if (direito === "nenhum") return "cancelada_sem_devolucao";
  if (dev?.situacao === "confirmada" || dev?.situacao === "por_fora") return dev.avisos?.includes("devolucao_a_menor") ? "cancelada_em_conferencia" : "cancelada_devolvida";
  const avisos = dev?.avisos ?? p.avisos;
  const paradaPorProblema = avisos.includes("devolucao_parada") && !dev?.paradaEm;
  const emParteInexplicada = p.situacao === "devolvido_parcial" && devolucaoInexplicada(p, vivas) && !dev?.chaveAceita && !dev?.chaveEmDuvida;
  if (avisos.includes("devolucao_a_menor") || emDisputa(p) || emParteInexplicada || paradaPorProblema) return "cancelada_em_conferencia";
  if (dev?.situacao === "pedida") return "cancelada_devolucao_pedida";
  // Cartão com mais de 78 dias: nada foi pedido pelo sistema; a equipe devolve pelo painel do Mercado Pago.
  if (estornoPelaEquipe) return "cancelada_devolucao_pedida";
  // Recusada: "outra forma" só quando ela existe. No cartão com a por fora ainda fechada (saldo insuficiente, respostas
  // incertas), o caminho continua sendo o Mercado Pago (pedir de novo): para o hóspede, a devolução segue pedida.
  if (dev?.situacao === "recusada" && (p.situacao === "aprovado" || p.situacao === "devolvido_parcial"))
    return p.forma === "cartao" && !porForaPermitidoNoCartao(p, dev, agora) ? "cancelada_devolucao_pedida" : "cancelada_com_a_equipe";
  return "cancelada_em_conferencia";
}

/** Cartão com mais de 78 dias, devolução parada pelo prazo e a por fora do cartão ainda fechada: a equipe estorna pelo painel do Mercado Pago. */
const estornaPelaEquipe = (p: Pagamento, dev: Devolucao | undefined, agora: Date) =>
  !!dev && devolucaoParadaPeloPrazo(p, dev) && !dev.paradaEm && p.forma === "cartao" && !porForaPermitidoNoCartao(p, dev, agora);

/** A situação da reserva cancelada pela política no quadro do pagamento e na lista (M8.2c): as mesmas da página do hóspede. */
export type CanceladaNoPainel = { estado: EstadoPagamentoHospede; estornoPelaEquipe: boolean };

/** "Reserva cancelada: devolução pedida / devolvida / com a equipe / em conferência / sem devolução (valor retido)". */
export function canceladaEmPalavras(c: CanceladaNoPainel): string {
  const palavras: Partial<Record<EstadoPagamentoHospede, string>> = {
    cancelada_devolucao_pedida: c.estornoPelaEquipe ? "devolução pelo painel do Mercado Pago (pagamento com mais de 78 dias)" : "devolução pedida",
    cancelada_devolvida: "devolvida",
    cancelada_com_a_equipe: "com a equipe",
    cancelada_em_conferencia: "em conferência",
    cancelada_sem_devolucao: "sem devolução (valor retido)",
  };
  return `Reserva cancelada: ${palavras[c.estado] ?? "em conferência"}`;
}

/**
 * A devolução parou pelo prazo (M8.2c, D12), não por uma recusa do Mercado Pago: recusada com o aviso do pagamento com mais
 * de 78 dias (nada foi pedido; ou o pedido sem dúvida que passou dos 78 dias entre um envio e outro; ou a pedida parada
 * pela equipe depois dos 85) e sem o aviso de recusa (três recusas, a nossa devolução falha na leitura, a recusa do painel
 * dele registrada).
 */
const devolucaoParadaPeloPrazo = (p: Pick<Pagamento, "avisos">, dev: Pick<Devolucao, "situacao"> & { avisos?: readonly string[] }) =>
  dev.situacao === "recusada" && (dev.avisos ?? p.avisos).includes("devolucao_fora_do_prazo") && !(dev.avisos ?? p.avisos).includes("devolucao_falhou");

export type AcoesDoPagamento = {
  conferir: boolean;
  devolver: boolean;
  devolucaoPorFora: boolean;
  registrarLiberacao: boolean;
  estornarLiberacao: boolean;
  registrarTaxaPerdida: boolean;
  // M8.2c (a devolução do cancelamento e a do pagamento velho); opcionais só para montar tentativas à mão nos testes.
  confirmarDevolucaoVista?: boolean;
  registrarRecusaNoPainel?: boolean;
  pararDevolucaoPedida?: boolean;
  corrigirTaxaPerdida?: boolean;
};

/** Nome da bandeira para o painel (o código do Mercado Pago quando o sistema não conhece). */
export const NOMES_BANDEIRA: Record<string, string> = { master: "Mastercard", visa: "Visa", elo: "Elo", amex: "American Express", hipercard: "Hipercard" };
export const nomeDaBandeira = (b: string | null): string | null => (b ? (Object.hasOwn(NOMES_BANDEIRA, b) ? NOMES_BANDEIRA[b] : b) : null);

export type PagamentoDoPainel = {
  id: string;
  cotacaoId: string;
  reservaId: string;
  forma: "pix" | "cartao";
  situacao: SituacaoPagamento;
  ambiente: "teste" | "producao";
  aoVivo: boolean | null;
  valor: number;
  valorPago: number | null;
  taxa: number | null;
  liquido: number | null;
  liberacaoPrevistaEm: Date | null;
  liberacaoConfirmadaEm: Date | null;
  liberacaoOrigem: "provedor" | "manual" | null;
  pixExpiraEm: Date | null;
  aprovadoEm: Date | null;
  consultadoEm: Date | null;
  criadoEm: Date;
  desfecho: Pagamento["desfecho"];
  desfechoEm: Date | null;
  motivoSemReserva: string | null;
  motivoSemReservaTexto: string | null;
  /** Os avisos em palavras, com os valores (para quem lê o financeiro). */
  avisos: string[];
  /**
   * Os mesmos avisos sem nenhum R$ (D26): para quem lê a reserva sem ler o financeiro. Sempre preenchido pelo domínio;
   * opcional só para montar tentativas à mão nos testes (sem ele, o quadro tira os avisos com valor).
   */
  avisosSemValores?: string[];
  devolucao: {
    situacao: SituacaoDevolucao;
    valor: number;
    tentativas: number;
    falhas: number;
    confirmadaEm: Date | null;
    porForaData: string | null;
    porForaValor: number | null;
    porForaNota: string;
    taxaPerdida: number | null;
    // M8.2c; opcionais só para montar tentativas à mão nos testes.
    origem?: string;
    /** Último código da resposta do Mercado Pago (lista fechada): explica a espera ou a recusa no quadro. */
    ultimoCodigo?: CodigoDevolucao | null;
    confirmadaPor?: "leitura" | "equipe" | "contestacao" | null;
    confirmadaNota?: string;
    valorConfirmado?: number | null;
    recusaNoPainelEm?: Date | null;
    paradaEm?: Date | null;
    /** Parada pelo prazo (pagamento com mais de 78 dias, D12), pela regra do domínio (`devolucaoParadaPeloPrazo`), não por recusa. */
    paradaPeloPrazo?: boolean;
  } | null;
  /**
   * M8.2c: a reserva que este pagamento confirmou foi cancelada pela política — a situação pela devolução (a mesma da
   * página do hóspede); null nos outros casos. Opcional só para montar tentativas à mão nos testes.
   */
  cancelada?: CanceladaNoPainel | null;
  /**
   * M8.2d: todas as devoluções vivas do pagamento (a da alteração, a do cancelamento, o restante…), em ordem de id, cada
   * uma com as ações que o domínio aceita; a aberta (pedida ou recusada), quando há; o que a equipe reconheceu como
   * devolvido fora do sistema; e a alteração cuja diferença este pagamento cobra. `devolucao` (acima) continua sendo a
   * que manda (a aberta, senão a mais nova). Opcionais só para montar tentativas à mão nos testes.
   */
  devolucoes?: DevolucaoDoPainel[];
  aberta?: DevolucaoDoPainel | null;
  foraReconhecido?: number;
  alteracaoId?: string | null;
  /**
   * D17: o que o Mercado Pago mostra devolvido (a última leitura) e, no pagamento sem reserva, o que "Devolver o restante ao
   * hóspede" devolve agora (o pago menos as devoluções e o devolvido fora do sistema, pela regra do domínio,
   * `restanteSemReserva`); `semValor`: ele mostra parte devolvida fora do sistema sem dizer quanto (a equipe informa o valor
   * do painel dele e o restante sai desse valor). null fora do pagamento sem reserva.
   */
  devolvidoLido?: number;
  restante?: RestanteSemReserva | null;
  /** Pede atenção da equipe (lista "pede atenção" e Início). */
  pedeAtencao: boolean;
  /** O que a ficha pode oferecer (quem chama ainda confere a permissão financeiro:editar). */
  acoes: AcoesDoPagamento;
  /**
   * Páginas legais aceitas quando a tentativa foi criada (M7.4) e o prazo do reembolso integral dessa Política de
   * cancelamento; null = tentativa sem aceite (anterior ao M7.4). Opcional só para montar tentativas à mão nos testes.
   */
  aceite?: { versoes: VersoesLegais; aceitoEm: Date; diasReembolsoIntegral: number | null } | null;
  // M8.2b: sempre preenchidos pelo domínio; opcionais só para montar tentativas à mão nos testes (como `aceite`).
  /** Identificadores no Mercado Pago (não são dados pessoais): a order (ORD…), a referência (scl-…) e o pagamento. */
  idProvedor?: string | null;
  referencia?: string;
  idPagamentoProvedor?: string | null;
  // --- Cartão; null no Pix. Nunca BIN, últimos dígitos nem titular.
  parcelas?: number | null;
  /** Código da bandeira (`master`, `visa`…); o nome vem de `nomeDaBandeira`. */
  bandeira?: string | null;
  tresDS?: ModoTresDS | null;
  tresDSStatus?: StatusTresDS | null;
  etapaCartao?: Pagamento["etapaCartao"];
  /** Centavos de juros do parcelamento pagos pelo hóspede (pago − valor), quando > 0; ficam com o Mercado Pago. */
  juros?: number | null;
  /** Centavos do custo do "parcelamento sem acréscimo" cobrado da SCL, quando lido (> 0 = aviso `parcelas_sem_juros`). */
  custoParcelasVendedor?: number | null;
  /** Motivo de uma recusa de cartão — só para quem tem `financeiro:ler` ("não informe ao hóspede"). */
  motivoRecusa?: string | null;
};

/**
 * M8.2e: o pagamento está em disputa (contestado pela leitura, ou com disputa em curso registrada — o MED num Pix aprovado,
 * o caso tardio só da Chargebacks API). O aviso `contestado` é o retrato do "em curso" (`contestacaoEmCurso`), recalculado em
 * toda gravação da disputa sob a trava (`avisosComContestacoes`): estas leituras sem trava leem dele.
 */
const emDisputa = (p: Pick<Pagamento, "situacao" | "avisos">) => p.situacao === "contestado" || p.avisos.includes("contestado");

/** Liberação prevista vencida sem confirmação; com disputa em curso, não (a liberação lida não lança: espera o resultado). */
const liberacaoVencida = (p: Pagamento, agora: Date) =>
  dinheiroDaReserva(p) && p.situacao === "aprovado" && !emDisputa(p) && !p.liberacaoConfirmadaEm && !!p.liberacaoPrevistaEm && p.liberacaoPrevistaEm.getTime() < agora.getTime();

/** Tentativa `criando`/`incerta` sem resposta há mais que a carência: a criação do pagamento não se resolve sozinha. */
const criacaoPresa = (p: Pagamento, agora: Date) => (p.situacao === "criando" || p.situacao === "incerta") && p.criadoEm.getTime() + CARENCIA_PAGAMENTO_MS < agora.getTime();

/** Uma devolução no quadro do pagamento (M8.2d: várias por pagamento), com as ações que o domínio aceita para ela. */
export type DevolucaoDoPainel = {
  id: string;
  origem: string;
  /** A alteração cuja diferença esta devolução devolve (origem "alteracao"). */
  alteracaoId: string | null;
  /** O cancelamento que pediu esta devolução (origem "cancelamento"; o restante dela também). */
  cancelamentoId: string | null;
  valor: number;
  situacao: SituacaoDevolucao;
  valorConfirmado: number | null;
  ultimoCodigo: CodigoDevolucao | null;
  avisos: string[];
  /** A devolução que esta completa (o restante de uma devolvida a menos). */
  restanteDe: string | null;
  /** Esta já tem a devolução do restante. */
  temRestante: boolean;
  caixaLancadoEm: Date | null;
  taxaPerdida: number | null;
  criadoEm: Date;
  confirmadaEm: Date | null;
  porForaData: string | null;
  porForaValor: number | null;
  // Os detalhes da linha (os mesmos da linha "Devolução" do M8.2a/M8.2c): os pedidos ao Mercado Pago e as falhas, quem
  // confirmou e a nota (a nota e a da por fora são texto livre: só com financeiro:ler), a recusa do painel registrada, a
  // parada pela equipe e a parada pelo prazo (pela regra do domínio).
  tentativas: number;
  falhas: number;
  confirmadaPor: "leitura" | "equipe" | "contestacao" | null;
  confirmadaNota: string;
  porForaNota: string;
  recusaNoPainelEm: Date | null;
  paradaEm: Date | null;
  paradaPeloPrazo: boolean;
  /** D13: espera o Mercado Pago liberar o pagamento (nada pedido ainda). */
  aguardandoLiberacao: boolean;
  /**
   * D17: a do pagamento sem reserva, pedida de novo ou registrada por fora, devolve o restante do pagamento (não o valor
   * antigo dela): o que sai agora, ou `semValor` (o Mercado Pago não disse quanto já devolveu; a equipe informa). null nas outras.
   */
  restanteSemReserva: RestanteSemReserva | null;
  acoes: AcoesDaDevolucao;
};

/** O que o quadro do pagamento precisa saber da reserva, do cancelamento e das alterações dela (M8.2c, M8.2d). */
type ContextoDoPainel = {
  reserva: { estado: EstadoReserva; valorRetido: number | null } | null;
  cancelamento: { situacao: SituacaoCancelamento; direito: DireitoCancelamento | null } | null;
  alteracoes?: readonly (Pick<Alteracao, "id" | "situacao"> & Partial<Pick<Alteracao, "holdAte">>)[];
  /**
   * M8.2e: as disputas do pagamento (as ações das devoluções e a liberação à mão as leem; a perdida sem decisão pede atenção;
   * o aviso `contestado` diz o tipo da em curso mais antiga).
   */
  contestacoes?: readonly Pick<Contestacao, "pagamentoId" | "tipo" | "abertaEm" | "situacao" | "avisos" | "estadoLido" | "decisaoVersao" | "definitivoEm" | "liquidoNaoEntrou">[];
};

/** O aviso de devolução recusada, no quadro do pagamento, quando a recusa veio do painel do Mercado Pago (registrada) ou da leitura. */
export const TEXTO_RECUSA_NO_PAINEL =
  "A recusa da devolução no painel do Mercado Pago foi registrada: a devolução por fora fica liberada (no cartão também). Registre a devolução feita por fora quando ela sair.";
export const TEXTO_DEVOLUCAO_FALHOU_NA_LEITURA =
  "O Mercado Pago mostrou a devolução pedida como falha (ela não saiu): confira no painel do Mercado Pago antes de tentar de novo ou de registrar a devolução feita por fora.";

/**
 * Os avisos do pagamento em palavras, com os valores quando o texto precisa deles (os de devolução, pela devolução que os
 * tem). `comValores: false`: os mesmos avisos sem nenhum R$, para quem não lê o financeiro (D26). M8.2e: `contestado` diz o
 * tipo da disputa em curso (`tipoDaDisputa`; sem ele, o texto geral).
 */
function textosDoPagamento(
  p: Pagamento,
  dev: Devolucao | undefined,
  devs: readonly Devolucao[] = dev ? [dev] : [],
  agora: Date = new Date(),
  comValores = true,
  tipoDaDisputa: TipoContestacao | null = null,
): string[] {
  const comAviso = (c: CodigoAviso) => [...devs].reverse().find((d) => d.avisos.includes(c));
  const valor = (v: number) => (comValores ? v : null);
  return p.avisos
    .filter((c): c is CodigoAviso => c in AVISOS_PAGAMENTO)
    .map((c) => {
      if (c === "devolucao_a_menor") {
        const d = comAviso(c) ?? dev;
        // O restante que o Mercado Pago recusou (D15): confira no painel dele; a confirmação com o valor visto, ou a por fora.
        if (d?.situacao === "recusada" && d.origemDevolucaoId) return textoRestanteRecusado(valor(d.valor), porForaPermitidoNoCartao(p, d, agora));
        // Confirmada pelo que voltou (pelo id ou pela equipe): o que voltou já está no financeiro; falta o restante.
        if (d?.situacao === "confirmada" && d.valorConfirmado !== null) return textoDevolucaoAMenor(valor(d.valorConfirmado), valor(d.valor), porForaPermitidoNoCartao(p, undefined, agora));
        if (d?.situacao === "pedida") {
          // A menos sem o id dela: o que a leitura mostra além das outras confirmadas e do reconhecido devolvido fora (nunca o
          // total do pagamento); nada foi acertado, a equipe confirma o valor visto no painel do Mercado Pago.
          const novo = p.devolvidoLido - comprometidoNoPagamento(devs.filter((x) => x.id !== d.id && x.situacao === "confirmada")) - p.devolvidoForaReconhecido;
          if (novo > 0) return textoDevolucaoAMenorSemId(valor(novo), valor(d.valor));
        }
      }
      if (c === "devolucao_data_a_conferir") {
        // A que completou um pagamento com parte devolvida pelo painel do Mercado Pago (D17): o caixa ficou todo no dia dela.
        const d = comAviso(c);
        if (d && p.devolvidoForaReconhecido > 0 && d.saidaLancamentoId) return TEXTO_CAIXA_COM_DEVOLVIDO_FORA;
      }
      if (c === "devolucao_aguardando_liberacao_atrasada") {
        const d = comAviso(c);
        if (d) return textoDevolucaoAguardandoLiberacaoAtrasada(valor(d.valor));
      }
      if (c === "devolucao_devida_depois_da_disputa") {
        const d = comAviso(c);
        if (d) return textoDevolucaoDevidaDepoisDaDisputa(valor(d.valor));
      }
      // O aviso de devolução recusada (M8.2c) também vem da recusa do painel do Mercado Pago registrada pela equipe e da
      // leitura que mostrou a nossa devolução falha: o texto diz qual foi (nem sempre foram "três vezes").
      if (c === "devolucao_falhou" && dev?.situacao === "recusada" && dev.recusaNoPainelEm) return TEXTO_RECUSA_NO_PAINEL;
      if (c === "devolucao_falhou" && dev?.situacao === "recusada" && dev.idProvedor !== null && !dev.paradaEm) return TEXTO_DEVOLUCAO_FALHOU_NA_LEITURA;
      // Sem reserva (M8.2a), o devolvido fora do sistema não tem parte de proprietário em conferência.
      if (c === "devolvido_por_fora" && p.desfecho !== "reserva") return "Este pagamento foi devolvido (no todo ou em parte) fora do sistema: confira no painel do Mercado Pago.";
      if (c === "contestado") return textoDoAvisoContestado(tipoDaDisputa);
      return AVISOS_PAGAMENTO[c];
    });
}

function paraPainel(p: Pagamento, devs: readonly Devolucao[], temRecebimentoManual: boolean, agora: Date, ctx: ContextoDoPainel): Omit<PagamentoDoPainel, "aceite"> {
  // A devolução que manda no quadro (M8.2d: a aberta, senão a mais nova); as outras vão em `devolucoes`.
  const dev = devolucaoPrincipal(devs);
  const contexto: ContextoDaDevolucao = { cancelamento: ctx.cancelamento, alteracoes: ctx.alteracoes ?? [], contestacoes: ctx.contestacoes ?? [] };
  // M8.2e: o pagamento contestado com a disputa registrada (ela explica a situação) aceita a liberação à mão; a perdida sem
  // decisão de quem arca pede atenção (a reserva continua em conferência).
  const disputasP = (ctx.contestacoes ?? []).filter((c) => c.pagamentoId === p.id);
  const contestadoExplicado = p.situacao === "contestado" && disputasP.some((c) => c.situacao !== "sem_efeito");
  const perdidaSemDecisao = disputasP.some((c) => c.situacao === "perdida" && c.decisaoVersao === 0 && c.definitivoEm === null);
  const semDecisao = p.situacao === "aprovado" && p.desfecho === null;
  // Dinheiro que chegou já devolvido em parte ou contestado, sem decisão do sistema (situação inesperada).
  const inesperada = (p.situacao === "devolvido_parcial" || p.situacao === "contestado") && p.desfecho === null;
  const devolucaoAberta = dev?.situacao === "pedida" || dev?.situacao === "recusada";
  const semDevolucaoAberta = dev?.situacao !== "pedida" && (!dev || dev.situacao === "recusada");
  // D17: o pagamento sem reserva que chegou já devolvido em parte (painel do Mercado Pago) também tem o restante devolvido.
  const parcialSemReserva = p.situacao === "devolvido_parcial" && p.desfecho === null && p.motivoSemReserva !== null;
  const podeDecidir = (semDecisao || parcialSemReserva) && p.motivoSemReserva !== null && semDevolucaoAberta && (!dev || dev.origem === "sem_reserva");
  // Contestado sem desfecho: a situação local nunca volta a "aprovado", então a devolução feita por fora fica oferecida
  // (o domínio relê a order antes e só aceita quando o Mercado Pago mostra o pagamento aprovado de novo). Devolvido em
  // parte: "Devolver o restante ao hóspede" (D17), com o devolvido pelo painel do Mercado Pago reconhecido.
  const contestadoSemDesfecho = p.situacao === "contestado" && p.desfecho === null && p.motivoSemReserva !== null && semDevolucaoAberta;
  // Cartão: por fora só quando a devolução pelo Mercado Pago não deu de vez ou o pagamento passou de 180 dias (a mesma regra do domínio).
  const porForaNoCartao = porForaPermitidoNoCartao(p, dev, agora);
  const cartao = p.forma === "cartao";
  // M8.2c: a devolução do cancelamento (reserva cancelada com direito integral) e os registros da equipe.
  const conhecida = !!dev && origemDeDevolucaoConhecida(dev.origem);
  const doCancelamento = conhecida && dev!.origem === "cancelamento" && dinheiroDaReserva(p) && ctx.cancelamento?.situacao === "cancelada" && ctx.cancelamento.direito === "integral";
  const doSemReserva = conhecida && dev!.origem === "sem_reserva" && p.desfecho === null;
  const recusadaDoCancelamento = doCancelamento && dev!.situacao === "recusada" && (p.situacao === "aprovado" || (p.situacao === "devolvido_parcial" && !devolucaoInexplicada(p, devs)));
  const foraDaLeitura = p.criadoEm.getTime() < inicioDoPrazoDeReleitura(agora).getTime();
  const avisosDev = dev ? avisosDaDevolucao(p, dev, devs.every((d) => d.id === dev.id)) : p.avisos;
  const semConfirmacaoPelaLeitura = avisosDev.includes("devolucao_sem_confirmacao") || avisosDev.includes("devolucao_a_menor") || avisosDev.includes("devolucao_parada") || p.avisos.includes("situacao_desconhecida");
  const calculada = !!ctx.reserva && reservaCalculadaPeloMotor(ctx.reserva);
  const estorno = estornaPelaEquipe(p, dev, agora);
  const cancelada: CanceladaNoPainel | null =
    dinheiroDaReserva(p) && ctx.cancelamento?.situacao === "cancelada" && ctx.cancelamento.direito ? { estado: estadoDaCancelada(p, ctx.cancelamento.direito, dev, estorno, agora, devs), estornoPelaEquipe: estorno } : null;
  return {
    id: p.id,
    cotacaoId: p.cotacaoId,
    reservaId: p.reservaId,
    forma: p.forma,
    situacao: p.situacao,
    ambiente: p.ambiente,
    aoVivo: p.aoVivo,
    valor: p.valor,
    valorPago: p.valorPago,
    taxa: p.taxa,
    liquido: p.liquido,
    liberacaoPrevistaEm: p.liberacaoPrevistaEm,
    liberacaoConfirmadaEm: p.liberacaoConfirmadaEm,
    liberacaoOrigem: p.liberacaoOrigem,
    pixExpiraEm: p.pixExpiraEm,
    aprovadoEm: p.aprovadoEm,
    consultadoEm: p.consultadoEm,
    criadoEm: p.criadoEm,
    desfecho: p.desfecho,
    desfechoEm: p.desfechoEm,
    motivoSemReserva: p.motivoSemReserva,
    motivoSemReservaTexto: textoMotivoSemReserva(p.motivoSemReserva),
    avisos: textosDoPagamento(p, dev, devs, agora, true, tipoDaDisputaEmCurso(disputasP, p.id)),
    avisosSemValores: textosDoPagamento(p, dev, devs, agora, false, tipoDaDisputaEmCurso(disputasP, p.id)),
    devolucao: dev
      ? {
          situacao: dev.situacao,
          valor: dev.valor,
          tentativas: dev.tentativas,
          falhas: dev.falhas,
          confirmadaEm: dev.confirmadaEm,
          porForaData: dev.porForaData,
          porForaValor: dev.porForaValor,
          porForaNota: dev.porForaNota,
          taxaPerdida: dev.taxaPerdida,
          origem: dev.origem,
          ultimoCodigo: dev.ultimoCodigo,
          confirmadaPor: dev.confirmadaPor,
          confirmadaNota: dev.confirmadaNota,
          valorConfirmado: dev.valorConfirmado,
          recusaNoPainelEm: dev.recusaNoPainelEm,
          paradaEm: dev.paradaEm,
          paradaPeloPrazo: devolucaoParadaPeloPrazo(p, dev),
        }
      : null,
    devolucoes: devs.map((d) => devolucaoDoPainel(p, d, devs, contexto, agora)),
    aberta: (() => {
      const a = devs.find((d) => d.situacao === "pedida") ?? [...devs].reverse().find((d) => d.situacao === "recusada");
      return a ? devolucaoDoPainel(p, a, devs, contexto, agora) : null;
    })(),
    foraReconhecido: p.devolvidoForaReconhecido,
    alteracaoId: p.alteracaoId,
    devolvidoLido: p.devolvidoLido,
    restante: p.desfecho === null && p.motivoSemReserva !== null ? restanteSemReserva(p, devs) : null,
    idProvedor: p.idProvedor,
    referencia: p.referencia,
    idPagamentoProvedor: p.idPagamentoProvedor,
    parcelas: cartao ? p.parcelas : null,
    bandeira: cartao ? p.bandeira : null,
    tresDS: cartao ? p.tresDS : null,
    tresDSStatus: cartao ? p.tresDSStatus : null,
    etapaCartao: cartao && p.situacao === "pendente" ? p.etapaCartao : null,
    juros: cartao && p.valorPago !== null && p.valorPago > p.valor ? p.valorPago - p.valor : null,
    custoParcelasVendedor: cartao ? p.custoParcelasVendedor : null,
    motivoRecusa: cartao && p.situacao === "recusado" ? textoMotivoRecusaCartao(motivoDoDetalhe(p.detalheProvedor)) : null,
    cancelada,
    pedeAtencao:
      semDecisao ||
      inesperada ||
      devolucaoAberta ||
      p.avisos.length > 0 ||
      p.situacao === "incerta" ||
      criacaoPresa(p, agora) ||
      (calculada && liberacaoVencida(p, agora)) ||
      (p.desfecho === "reserva" && ctx.cancelamento?.situacao === "pedido") ||
      // M8.2d: uma alteração com as novas datas seguradas (esperando o pagamento da diferença ou a confirmação do hóspede).
      (p.desfecho === "reserva" && !!ctx.alteracoes?.some((a) => a.situacao === "segurada" && !!a.holdAte && a.holdAte.getTime() > agora.getTime())) ||
      // M8.2e: disputa em curso (o aviso `contestado` já conta) ou perdida sem a decisão de quem arca.
      disputasP.some((c) => c.situacao === "aberta" || c.situacao === "a_confirmar") ||
      perdidaSemDecisao,
    acoes: {
      conferir: p.idProvedor !== null || emAndamento(p.situacao) || !!dev,
      // Cancelamento: pedir de novo só a devolução recusada de um pagamento com até 78 dias (depois, nada se pede).
      devolver: podeDecidir || (recusadaDoCancelamento && p.criadoEm.getTime() >= inicioDoPrazoDePedirDevolucao(agora).getTime()),
      // A devolução por fora relê antes a order no Mercado Pago (devolvida, em andamento ou contestada = recusa).
      devolucaoPorFora: ((podeDecidir || contestadoSemDesfecho) && porForaNoCartao) || (recusadaDoCancelamento && !dev!.chaveAceita && porForaNoCartao),
      // Só a reserva que o motor calcula (confirmada, ou cancelada com valor retido) recebe a liberação no livro. Cancelada
      // com devolução integral (M8.2d, D13): a liberação só se registra quando uma devolução de parte do valor espera por
      // ela (nada entra no livro; a devolução sai depois dela).
      // M8.2e: a disputa perdida que já contou o líquido inteiro como "nunca entrou" não recebe a liberação por cima (o domínio
      // recusa; a correção é um ajuste).
      registrarLiberacao:
        dinheiroDaReserva(p) &&
        (p.situacao === "aprovado" || (p.situacao === "devolvido_parcial" && !devolucaoInexplicada(p, devs)) || contestadoExplicado) &&
        (liquidoQueAindaPodeEntrar({ contestacoes: disputasP }, p) ?? 1) > 0 &&
        ((!p.liberacaoConfirmadaEm && calculada) || (ctx.cancelamento?.situacao === "cancelada" && ctx.cancelamento.direito === "integral" && devs.some(esperandoLiberacao))),
      // Cancelada com devolução integral, a liberação não se registraria de novo: o estorno não é oferecido (o domínio recusa).
      estornarLiberacao:
        p.liberacaoOrigem === "manual" &&
        temRecebimentoManual &&
        calculada &&
        !devs.some((d) => d.saidaLancamentoId || (d.situacao === "pedida" && d.tentativas > 0 && d.corpoIntegral === false) || ((d.situacao === "confirmada" || d.situacao === "por_fora") && !d.caixaLancadoEm)),
      registrarTaxaPerdida: (dev?.situacao === "confirmada" || dev?.situacao === "por_fora") && dev.taxaPerdida === null,
      confirmarDevolucaoVista: (doSemReserva || doCancelamento) && (dev!.situacao === "pedida" || dev!.situacao === "recusada") && (foraDaLeitura || semConfirmacaoPelaLeitura),
      registrarRecusaNoPainel: podeRegistrarRecusaNoPainel(p, dev, agora, devs.filter((d) => d.id !== dev?.id)),
      pararDevolucaoPedida: conhecida && dev!.situacao === "pedida" && foraDaLeitura,
      corrigirTaxaPerdida: !!dev && dev.taxaPerdida !== null,
    },
  };
}

function devolucaoDoPainel(p: Pagamento, d: Devolucao, devs: readonly Devolucao[], contexto: ContextoDaDevolucao, agora: Date): DevolucaoDoPainel {
  return {
    id: d.id,
    origem: d.origem,
    alteracaoId: d.alteracaoId,
    cancelamentoId: d.cancelamentoId,
    valor: d.valor,
    situacao: d.situacao,
    valorConfirmado: d.valorConfirmado,
    ultimoCodigo: d.ultimoCodigo,
    avisos: d.avisos,
    restanteDe: d.origemDevolucaoId,
    temRestante: devs.some((x) => x.origemDevolucaoId === d.id),
    caixaLancadoEm: d.caixaLancadoEm,
    taxaPerdida: d.taxaPerdida,
    criadoEm: d.criadoEm,
    confirmadaEm: d.confirmadaEm,
    porForaData: d.porForaData,
    porForaValor: d.porForaValor,
    tentativas: d.tentativas,
    falhas: d.falhas,
    confirmadaPor: d.situacao === "confirmada" ? (d.confirmadaPor ?? "leitura") : null,
    confirmadaNota: d.confirmadaNota,
    porForaNota: d.porForaNota,
    recusaNoPainelEm: d.recusaNoPainelEm,
    paradaEm: d.paradaEm,
    paradaPeloPrazo: devolucaoParadaPeloPrazo(p, d),
    aguardandoLiberacao: esperandoLiberacao(d),
    restanteSemReserva: d.origem === "sem_reserva" ? restanteSemReserva(p, devs, d) : null,
    acoes: acoesDaDevolucao(p, d, devs, contexto, agora),
  };
}

async function montarPainel(db: Db, organizacaoId: string, lista: Pagamento[], agora: Date): Promise<PagamentoDoPainel[]> {
  if (!lista.length) return [];
  const ids = lista.map((p) => p.id);
  const devs = await db.select().from(devolucoesPagamento).where(and(eq(devolucoesPagamento.organizacaoId, organizacaoId), inArray(devolucoesPagamento.pagamentoId, ids)));
  // Liberação registrada à mão ainda em vigor (estornável pelo quadro do pagamento).
  const manuais = await db
    .select({ chave: lancamentos.chaveOrigem })
    .from(lancamentos)
    .where(
      and(
        eq(lancamentos.organizacaoId, organizacaoId),
        eq(lancamentos.tipo, "recebimento"),
        eq(lancamentos.estado, "realizado"),
        sql`${lancamentos.chaveOrigem} like 'mercadopago:%:recebimento%'`,
        isNull(lancamentos.estornoDe),
        sql`not exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`,
      ),
    );
  const comManual = new Set(manuais.map((m) => m.chave.split(":")[1]));
  // M8.2c: a reserva (calculada pelo motor?) e o cancelamento ativo dela, para as ações e o "pede atenção".
  const reservaIds = [...new Set(lista.map((p) => p.reservaId))];
  const rs = await db.select({ id: reservas.id, estado: reservas.estado, valorRetido: reservas.valorRetido }).from(reservas).where(inArray(reservas.id, reservaIds));
  const cs = await db
    .select({ reservaId: cancelamentosReserva.reservaId, situacao: cancelamentosReserva.situacao, direito: cancelamentosReserva.direito })
    .from(cancelamentosReserva)
    .where(and(eq(cancelamentosReserva.organizacaoId, organizacaoId), inArray(cancelamentosReserva.reservaId, reservaIds), inArray(cancelamentosReserva.situacao, ["pedido", "cancelada"])));
  // M8.2d: as alterações das reservas (a devolução da alteração só cabe com a alteração aplicada).
  const as = await db
    .select({ id: alteracoesReserva.id, reservaId: alteracoesReserva.reservaId, situacao: alteracoesReserva.situacao, holdAte: alteracoesReserva.holdAte })
    .from(alteracoesReserva)
    .where(and(eq(alteracoesReserva.organizacaoId, organizacaoId), inArray(alteracoesReserva.reservaId, reservaIds)));
  // M8.2e: as disputas dos pagamentos (as ações das devoluções, a liberação à mão e o "pede atenção").
  const cts = await db
    .select({
      pagamentoId: contestacoesPagamento.pagamentoId,
      tipo: contestacoesPagamento.tipo,
      abertaEm: contestacoesPagamento.abertaEm,
      situacao: contestacoesPagamento.situacao,
      avisos: contestacoesPagamento.avisos,
      estadoLido: contestacoesPagamento.estadoLido,
      decisaoVersao: contestacoesPagamento.decisaoVersao,
      liquidoNaoEntrou: contestacoesPagamento.liquidoNaoEntrou,
      definitivoEm: contestacoesPagamento.definitivoEm,
    })
    .from(contestacoesPagamento)
    .where(and(eq(contestacoesPagamento.organizacaoId, organizacaoId), inArray(contestacoesPagamento.pagamentoId, ids)));
  // M7.4: o aceite com que cada tentativa foi criada e o prazo da Política de cancelamento dessa versão.
  const aceiteIds = [...new Set(lista.map((p) => p.aceiteId).filter((x): x is string => x !== null))];
  const aceites = aceiteIds.length ? await db.select().from(aceitesSite).where(and(eq(aceitesSite.organizacaoId, organizacaoId), inArray(aceitesSite.id, aceiteIds))) : [];
  const politicas = aceites.length ? await lerPaginaLegal(db, organizacaoId, "cancelamento") : [];
  const aceiteDe = (p: Pagamento): PagamentoDoPainel["aceite"] => {
    const a = p.aceiteId ? aceites.find((x) => x.id === p.aceiteId) : undefined;
    if (!a) return null;
    const dias = politicas.find((v) => v.numero === a.versaoCancelamento)?.regras?.diasReembolsoIntegral ?? null;
    return { versoes: { termos: a.versaoTermos, privacidade: a.versaoPrivacidade, cancelamento: a.versaoCancelamento }, aceitoEm: a.aceitoEm, diasReembolsoIntegral: dias };
  };
  return lista.map((p) => ({
    ...paraPainel(p, devolucoesDoPagamento({ devolucoes: devs }, p.id), comManual.has(p.id), agora, {
      reserva: rs.find((r) => r.id === p.reservaId) ?? null,
      cancelamento: cs.find((c) => c.reservaId === p.reservaId) ?? null,
      alteracoes: as.filter((a) => a.reservaId === p.reservaId),
      contestacoes: cts.filter((c) => c.pagamentoId === p.id),
    }),
    aceite: aceiteDe(p),
  }));
}

/**
 * D21, gêmeo TS de `devolvidaNoProvedorSql` (`portal/posse.ts`): algum pagamento com o dinheiro da reserva (o que a
 * confirmou e as diferenças, M8.2d) mostra no Mercado Pago devolvido além do que as nossas devoluções e o reconhecido
 * explicam (`devolucaoInexplicada`), e a reserva não tem cancelamento pela política com devolução integral. A parte do
 * proprietário fica em conferência. M8.2e: `contestacoes`, as disputas dos pagamentos (o MED e a reclamação registrados
 * explicam a devolução lida, até o valor deles: `devolvidoPelaDisputa`).
 */
export function devolvidaNoProvedor(
  pagamentosDaReserva: readonly Pick<Pagamento, "id" | "desfecho" | "situacao" | "devolvidoLido" | "devolvidoForaReconhecido">[],
  devolucoes: readonly Devolucao[],
  cancelamento: { situacao: SituacaoCancelamento; direito: DireitoCancelamento | null } | null | undefined,
  contestacoes: readonly Pick<Contestacao, "pagamentoId" | "tipo" | "situacao" | "valor" | "duplicataPossivel">[] = [],
): boolean {
  if (cancelamento?.situacao === "cancelada" && cancelamento.direito === "integral") return false;
  return pagamentosDaReserva.some((p) => dinheiroDaReserva(p) && devolucaoInexplicada(p, devolucoesDoPagamento({ devolucoes }, p.id), devolvidoPelaDisputa({ contestacoes }, p.id)));
}

/** Pagamentos do site de uma reserva (ficha da reserva), do mais antigo ao mais novo. */
export async function pagamentosDaReserva(db: Db, organizacaoId: string, reservaId: string, agora: Date = new Date()): Promise<PagamentoDoPainel[]> {
  if (!uuidValido(reservaId)) return [];
  const lista = await db.select().from(pagamentos).where(and(eq(pagamentos.organizacaoId, organizacaoId), eq(pagamentos.reservaId, reservaId))).orderBy(asc(pagamentos.criadoEm), asc(pagamentos.id));
  return montarPainel(db, organizacaoId, lista, agora);
}

/**
 * O mesmo critério de `pedeAtencao` (paraPainel), em SQL, para o filtro "pede atenção" vir do banco antes do limite
 * de linhas: um pagamento antigo que pede atenção nunca some da lista. A lista ainda confere `pedeAtencao` depois.
 */
function podePedirAtencao(agora: Date) {
  const limiteCriacao = new Date(agora.getTime() - CARENCIA_PAGAMENTO_MS);
  return or(
    and(inArray(pagamentos.situacao, ["aprovado", "devolvido_parcial", "contestado"]), isNull(pagamentos.desfecho)),
    sql`jsonb_array_length(${pagamentos.avisos}) > 0`,
    eq(pagamentos.situacao, "incerta"),
    and(eq(pagamentos.situacao, "criando"), sql`${pagamentos.criadoEm} < ${limiteCriacao}`),
    // Liberação vencida: só da reserva que o motor calcula (a cancelada com devolução integral nunca lança recebimento).
    and(
      inArray(pagamentos.desfecho, ["reserva", "alteracao"]),
      eq(pagamentos.situacao, "aprovado"),
      isNull(pagamentos.liberacaoConfirmadaEm),
      sql`${pagamentos.liberacaoPrevistaEm} < ${agora}`,
      sql`exists (select 1 from ${reservas} where ${reservas.id} = ${pagamentos.reservaId} and ${reservaCalculadaSql()})`,
    ),
    sql`exists (select 1 from ${devolucoesPagamento} where ${devolucoesPagamento.pagamentoId} = ${pagamentos.id} and ${devolucoesPagamento.situacao} in ('pedida', 'recusada'))`,
    // M8.2c: pedido de cancelamento esperando a equipe.
    and(eq(pagamentos.desfecho, "reserva"), sql`exists (select 1 from ${cancelamentosReserva} where ${cancelamentosReserva.reservaId} = ${pagamentos.reservaId} and ${cancelamentosReserva.situacao} = 'pedido')`),
    // M8.2d: alteração com as novas datas seguradas.
    and(
      eq(pagamentos.desfecho, "reserva"),
      sql`exists (select 1 from ${alteracoesReserva} where ${alteracoesReserva.reservaId} = ${pagamentos.reservaId} and ${alteracoesReserva.situacao} = 'segurada' and ${alteracoesReserva.holdAte} > ${agora})`,
    ),
    // M8.2e: disputa em curso, ou perdida sem a decisão de quem arca.
    comDisputaSql(),
  );
}

/**
 * M8.2e: o pagamento tem disputa que pede a equipe — aberta, a confirmar ou perdida sem decisão de quem arca (o filtro "Com
 * disputa" de Pagamentos do site e o "pede atenção").
 */
const comDisputaSql = () =>
  sql`exists (select 1 from ${contestacoesPagamento} c where c.pagamento_id = ${pagamentos.id} and (c.situacao in ('aberta', 'a_confirmar') or (c.situacao = 'perdida' and c.decisao_versao = 0 and c.definitivo_em is null)))`;

/** `alteracaoEm` (M8.2d): quando foi preparada a alteração cuja diferença este pagamento cobra; null nos outros. */
export type LinhaPagamento = PagamentoDoPainel & {
  reservaCodigo: string;
  reservaEstado: string;
  imovelCodigo: string;
  checkin: string;
  checkout: string;
  cotacaoCodigo: string;
  alteracaoEm: Date | null;
  /** M8.2e: a coluna "Disputa" — a do pagamento em palavras (tipo e situação, a mais nova), ou null sem disputa. */
  disputa: string | null;
  /** M8.2e: alguma disputa em curso (aberta ou a confirmar): o desfecho diz "Reserva (pagamento em disputa)". */
  emDisputa: boolean;
};

/**
 * Financeiro → Pagamentos do site: por período (dia de criação, em São Paulo, `de` e `ate` inclusive), com o
 * filtro "pede atenção" (que ignora o período: o que pede atenção aparece sempre).
 */
export async function listarPagamentos(db: Db, organizacaoId: string, f: { de?: string; ate?: string; atencao?: boolean; disputa?: boolean } = {}, agora: Date = new Date()): Promise<LinhaPagamento[]> {
  const dia = sql`(${pagamentos.criadoEm} at time zone 'America/Sao_Paulo')::date`;
  const linhas = await db
    .select({
      p: pagamentos,
      reservaCodigo: reservas.codigo,
      reservaEstado: reservas.estado,
      imovelCodigo: imoveis.codigo,
      checkin: reservas.checkin,
      checkout: reservas.checkout,
      cotacaoCodigo: cotacoes.codigo,
      alteracaoEm: alteracoesReserva.criadoEm,
    })
    .from(pagamentos)
    .innerJoin(reservas, eq(reservas.id, pagamentos.reservaId))
    .innerJoin(imoveis, eq(imoveis.id, pagamentos.imovelId))
    .innerJoin(cotacoes, eq(cotacoes.id, pagamentos.cotacaoId))
    .leftJoin(alteracoesReserva, and(eq(alteracoesReserva.id, pagamentos.alteracaoId), eq(alteracoesReserva.organizacaoId, pagamentos.organizacaoId)))
    .where(
      and(
        eq(pagamentos.organizacaoId, organizacaoId),
        // "Pede atenção" e "Com disputa" ignoram o período: o que pede a equipe aparece sempre.
        !f.atencao && !f.disputa && f.de ? gte(dia, f.de) : undefined,
        !f.atencao && !f.disputa && f.ate ? sql`${dia} <= ${f.ate}` : undefined,
        f.atencao ? podePedirAtencao(agora) : undefined,
        f.disputa ? comDisputaSql() : undefined,
      ),
    )
    .orderBy(desc(pagamentos.criadoEm), desc(pagamentos.id))
    .limit(500);
  const painel = await montarPainel(db, organizacaoId, linhas.map((l) => l.p), agora);
  // M8.2e: a coluna "Disputa" — a mais nova de cada pagamento, por tipo e situação.
  const disputas = painel.length
    ? await db
        .select({ pagamentoId: contestacoesPagamento.pagamentoId, tipo: contestacoesPagamento.tipo, situacao: contestacoesPagamento.situacao, decisaoVersao: contestacoesPagamento.decisaoVersao, definitivoEm: contestacoesPagamento.definitivoEm })
        .from(contestacoesPagamento)
        .where(and(eq(contestacoesPagamento.organizacaoId, organizacaoId), inArray(contestacoesPagamento.pagamentoId, painel.map((p) => p.id))))
        .orderBy(desc(contestacoesPagamento.abertaEm), desc(contestacoesPagamento.rodada))
    : [];
  const disputaDe = (id: string) => {
    const ds = disputas.filter((d) => d.pagamentoId === id);
    if (!ds.length) return { disputa: null, emDisputa: false };
    const d = ds[0];
    const semDecisao = d.situacao === "perdida" && d.decisaoVersao === 0 && d.definitivoEm === null ? " (sem decisão de quem arca)" : "";
    return { disputa: `${NOMES_TIPO_CONTESTACAO[d.tipo]}: ${NOMES_SITUACAO_CONTESTACAO[d.situacao]}${semDecisao}${ds.length > 1 ? ` (+${ds.length - 1})` : ""}`, emDisputa: ds.some((x) => x.situacao === "aberta" || x.situacao === "a_confirmar") };
  };
  const r = painel.map((p, i) => ({
    ...p,
    reservaCodigo: linhas[i].reservaCodigo,
    reservaEstado: linhas[i].reservaEstado,
    imovelCodigo: linhas[i].imovelCodigo,
    checkin: linhas[i].checkin,
    checkout: linhas[i].checkout,
    cotacaoCodigo: linhas[i].cotacaoCodigo,
    alteracaoEm: linhas[i].alteracaoEm ?? null,
    ...disputaDe(p.id),
  }));
  return f.atencao ? r.filter((x) => x.pedeAtencao) : r;
}

export type AvisoPagamento = { nivel: "atencao" | "info"; texto: string; link?: string };
export type ContagensPagamento = {
  /** Aprovado sem reserva, a devolver ao hóspede (pelo Mercado Pago ou por fora). */
  aprovadoSemDesfecho: number;
  /** Chegou já devolvido em parte ou contestado, antes de o sistema decidir: a disputa se acompanha pelo quadro do pagamento (M8.2e). */
  situacaoInesperada: number;
  devolucaoPedida: number;
  /** Devoluções paradas porque o Mercado Pago recusou, não respondeu ou mostrou a devolução pedida como falha. */
  devolucaoRecusada: number;
  /**
   * Devoluções paradas de pagamentos com mais de 78 dias, que o sistema não pede mais ao Mercado Pago (M8.2c, D12): nada
   * foi recusado por ele; a equipe devolve pelo painel dele (cartão) ou por fora (Pix).
   */
  devolucaoForaDoPrazo: number;
  liberacaoVencida: number;
  comAviso: number;
  aoVivo: number;
  semCalculo: number;
  pagasAbertas: number;
  /** Criação do pagamento sem resposta do Mercado Pago há mais que a carência (busca pela referência falhando). */
  criacaoPresa: number;
  /** Cartões em análise no Mercado Pago há mais de um dia (M8.2b). */
  cartaoEmAnalise: number;
  /** Tentativas de cartão que contaram no disjuntor nas últimas 24 h (M8.2b). */
  recusasCartao24h: number;
  /** Cartões recusados por dados do cartão inválidos na última hora (M8.2b). */
  recusasPorToken: number;
  /** Devoluções do cancelamento que o Mercado Pago fez a menos do que o integral pedido (M8.2c). */
  devolucaoAMenor: number;
  /** Reservas pagas pelo site que o Mercado Pago mostra devolvidas fora do cancelamento pela política (D21, M8.2c). */
  reservaDevolvidaNoProvedor: number;
  /** Devoluções de parte do valor esperando o Mercado Pago liberar o pagamento (D13, M8.2d): nada pedido ainda. */
  aguardandoLiberacao: number;
  /** Dessas, as que esperam uma liberação que passou da data prevista (ou de 35 dias da aprovação, sem previsão). */
  aguardandoLiberacaoAtrasada: number;
  /** Pagamentos da diferença de uma alteração aprovados sem a alteração (M8.2d): a devolver ao hóspede. */
  diferencaSemAlteracao: number;
};

const LINK_PAGAMENTOS = "/painel/financeiro/pagamentos-site";
const LINK_CONFIG_PAGAMENTO = "/painel/configuracoes/pagamento-site";
/** Hora em São Paulo (dd/mm, hh:mm) para os alertas. */
const horaSP = (d: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);

/**
 * Avisos do pagamento no site para o Início (da empresa toda, sem depender do filtro de imóveis). `contaDeTeste`
 * vem de quem já conferiu a conta (Integrações); sem ela, esse aviso não aparece.
 */
export async function avisosDePagamento(
  db: Db,
  organizacaoId: string,
  agora: Date = new Date(),
  o: { env?: NodeJS.ProcessEnv; contaDeTeste?: boolean | null } = {},
): Promise<{ alertas: AvisoPagamento[]; contagens: ContagensPagamento }> {
  const env = o.env ?? process.env;
  const lista = await db
    .select()
    .from(pagamentos)
    .where(
      and(
        eq(pagamentos.organizacaoId, organizacaoId),
        or(
          and(inArray(pagamentos.situacao, ["aprovado", "devolvido_parcial", "contestado"]), isNull(pagamentos.desfecho)),
          inArray(pagamentos.desfecho, ["reserva", "alteracao"]),
          sql`jsonb_array_length(${pagamentos.avisos}) > 0`,
          inArray(pagamentos.situacao, ["criando", "incerta"]),
          // M8.2d: as devoluções pedidas (inclusive as que esperam a liberação, sem aviso no pagamento).
          sql`exists (select 1 from ${devolucoesPagamento} d where d.pagamento_id = ${pagamentos.id} and d.situacao in ('pedida', 'recusada'))`,
          and(eq(pagamentos.forma, "cartao"), eq(pagamentos.situacao, "pendente"), eq(pagamentos.etapaCartao, "analise")),
        ),
      ),
    );
  const devs = lista.length ? await db.select().from(devolucoesPagamento).where(inArray(devolucoesPagamento.pagamentoId, lista.map((p) => p.id))) : [];
  const devsDe = (id: string) => devolucoesDoPagamento({ devolucoes: devs }, id);
  // M8.2e: as disputas (o MED e a reclamação registrados explicam a devolução lida, no D21).
  const disputas = lista.length
    ? await db
        .select({ pagamentoId: contestacoesPagamento.pagamentoId, tipo: contestacoesPagamento.tipo, situacao: contestacoesPagamento.situacao, valor: contestacoesPagamento.valor, duplicataPossivel: contestacoesPagamento.duplicataPossivel })
        .from(contestacoesPagamento)
        .where(inArray(contestacoesPagamento.pagamentoId, lista.map((p) => p.id)))
    : [];
  const contagens: ContagensPagamento = {
    aprovadoSemDesfecho: 0,
    situacaoInesperada: 0,
    devolucaoPedida: 0,
    devolucaoRecusada: 0,
    devolucaoForaDoPrazo: 0,
    liberacaoVencida: 0,
    comAviso: 0,
    aoVivo: 0,
    semCalculo: 0,
    pagasAbertas: 0,
    criacaoPresa: 0,
    cartaoEmAnalise: 0,
    recusasCartao24h: 0,
    recusasPorToken: 0,
    devolucaoAMenor: 0,
    reservaDevolvidaNoProvedor: 0,
    aguardandoLiberacao: 0,
    aguardandoLiberacaoAtrasada: 0,
    diferencaSemAlteracao: 0,
  };
  // M8.2c: as reservas pagas (o motor ainda calcula?) e os cancelamentos ativos delas.
  const reservaIds = [...new Set(lista.filter(dinheiroDaReserva).map((p) => p.reservaId))];
  const rs = reservaIds.length ? await db.select({ id: reservas.id, estado: reservas.estado, valorRetido: reservas.valorRetido }).from(reservas).where(inArray(reservas.id, reservaIds)) : [];
  const cs = reservaIds.length
    ? await db
        .select({ reservaId: cancelamentosReserva.reservaId, situacao: cancelamentosReserva.situacao, direito: cancelamentosReserva.direito })
        .from(cancelamentosReserva)
        .where(and(eq(cancelamentosReserva.organizacaoId, organizacaoId), inArray(cancelamentosReserva.reservaId, reservaIds), inArray(cancelamentosReserva.situacao, ["pedido", "cancelada"])))
    : [];
  const calculada = (reservaId: string) => {
    const r = rs.find((x) => x.id === reservaId);
    return !!r && reservaCalculadaPeloMotor(r);
  };
  const analiseDesde = agora.getTime() - ALERTA_ANALISE_CARTAO_HORAS * 3_600_000;
  const contadasNoProvedor = new Set<string>();
  for (const p of lista) {
    // Devoluções pedidas, esperando a liberação, ou paradas, de qualquer origem que esta versão conhece (sem reserva,
    // cancelamento, alteração), uma por devolução (M8.2d: várias por pagamento).
    const devsP = devsDe(p.id).filter((d) => origemDeDevolucaoConhecida(d.origem));
    const contam = comDinheiro(p.situacao) && p.situacao !== "devolvido";
    let contada = false;
    for (const dev of devsP) {
      if (dev.avisos.includes("devolucao_a_menor")) contagens.devolucaoAMenor++;
      if (!contam) continue;
      if (dev.situacao === "pedida" && esperandoLiberacao(dev)) {
        contagens.aguardandoLiberacao++;
        if (dev.avisos.includes("devolucao_aguardando_liberacao_atrasada") || liberacaoAtrasada(p, agora)) contagens.aguardandoLiberacaoAtrasada++;
        contada = true;
      } else if (dev.situacao === "pedida") {
        contagens.devolucaoPedida++;
        contada = true;
      } else if (devolucaoParadaPeloPrazo(p, dev)) {
        contagens.devolucaoForaDoPrazo++;
        contada = true;
      } else if (dev.situacao === "recusada") {
        contagens.devolucaoRecusada++;
        contada = true;
      }
    }
    if (!contada && comDinheiro(p.situacao) && p.situacao !== "devolvido" && p.desfecho === null) {
      // A diferença de uma alteração que não pôde ser aplicada (M8.2d): devolver ao hóspede, com o aviso próprio.
      if (p.alteracaoId && codigoMotivo(p.motivoSemReserva)?.startsWith("alteracao_")) contagens.diferencaSemAlteracao++;
      // Não é "devolva ao hóspede": o Mercado Pago já devolveu parte ou há contestação (o restante se devolve pelo quadro).
      else if (codigoMotivo(p.motivoSemReserva) === "situacao_inesperada") contagens.situacaoInesperada++;
      else if (!devsP.some((d) => d.situacao === "pedida")) contagens.aprovadoSemDesfecho++;
    }
    // D21: uma vez por reserva (algum pagamento dela devolvido fora do que o sistema explica).
    if (dinheiroDaReserva(p) && !contadasNoProvedor.has(p.reservaId) && devolvidaNoProvedor([p], devs, cs.find((x) => x.reservaId === p.reservaId), disputas)) {
      contadasNoProvedor.add(p.reservaId);
      contagens.reservaDevolvidaNoProvedor++;
    }
    // A liberação só é esperada da reserva que o motor calcula (a cancelada com devolução integral nunca lança).
    if (liberacaoVencida(p, agora) && calculada(p.reservaId)) contagens.liberacaoVencida++;
    if (criacaoPresa(p, agora)) contagens.criacaoPresa++;
    if (p.forma === "cartao" && p.situacao === "pendente" && p.etapaCartao === "analise" && p.criadoEm.getTime() < analiseDesde) contagens.cartaoEmAnalise++;
    if (p.avisos.some((a) => a !== "ao_vivo" && a in AVISOS_PAGAMENTO)) contagens.comAviso++;
    if (p.aoVivo === true || p.avisos.includes("ao_vivo")) contagens.aoVivo++;
  }
  // Avisos com live_mode=true (não assinados: só alarme), da organização ou ainda sem organização.
  const [vivos] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(eventosPagamento)
    .where(and(eq(eventosPagamento.aoVivo, true), or(eq(eventosPagamento.organizacaoId, organizacaoId), isNull(eventosPagamento.organizacaoId)), gte(eventosPagamento.recebidoEm, new Date(agora.getTime() - 30 * 86_400_000))));
  contagens.aoVivo += vivos?.n ?? 0;
  // Reserva paga que um recálculo deixou sem lançamento do motor (contrato encerrado, troca para marketplace).
  const pagas = lista.filter((p) => p.desfecho === "reserva");
  if (pagas.length) {
    const ids = pagas.map((p) => p.reservaId);
    const comMotor = await db
      .selectDistinct({ reservaId: lancamentos.reservaId })
      .from(lancamentos)
      .where(and(eq(lancamentos.organizacaoId, organizacaoId), inArray(lancamentos.reservaId, ids), eq(lancamentos.origem, "motor"), isNull(lancamentos.estornoDe), sql`not exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`));
    const com = new Set(comMotor.map((l) => l.reservaId));
    // Só a reserva que o motor calcula (confirmada, ou cancelada com valor retido): a cancelada com devolução não tem cálculo.
    contagens.semCalculo = pagas.filter((p) => !com.has(p.reservaId) && p.situacao === "aprovado" && calculada(p.reservaId)).length;
    // Pagas pelo site com a estadia ainda por vir ou em curso: as OTAs não sabem delas até o M8.3 (o envio não fecha datas de reservas).
    const hoje = hojeISO("America/Sao_Paulo", agora);
    const [abertas] = await db
      .select({ n: sql<number>`count(distinct ${reservas.id})::int` })
      .from(reservas)
      .where(and(inArray(reservas.id, ids), eq(reservas.estado, "confirmada"), sql`${reservas.checkout} > ${hoje}`));
    contagens.pagasAbertas = abertas?.n ?? 0;
  }

  // Cartão (M8.2b): o disjuntor de recusas e os sinais de alguém testando cartões ou de chaves trocadas.
  const disjuntor = await disjuntorAberto(db, organizacaoId, agora);
  contagens.recusasCartao24h = await recusasNasUltimas24h(db, organizacaoId, agora);
  contagens.recusasPorToken = await recusasPorTokenNaUltimaHora(db, organizacaoId, agora);

  const alertas: AvisoPagamento[] = [];
  if (disjuntor) {
    const texto = disjuntor.ate
      ? `Pagamento com cartão desligado até ${horaSP(disjuntor.ate)}: ${disjuntor.recusas} recusas em 30 minutos (pode ser alguém testando cartões roubados). O Pix continua.`
      : `Pagamento com cartão desligado até alguém religar: ${disjuntor.recusas} recusas em ${disjuntor.janela === "24h" ? "24 horas" : "30 minutos, pela terceira vez no dia"} (pode ser alguém testando cartões roubados). O Pix continua.`;
    alertas.push({ nivel: "atencao", texto, link: LINK_CONFIG_PAGAMENTO });
  } else if (contagens.recusasCartao24h >= ALERTA_RECUSAS_24H) {
    alertas.push({
      nivel: "atencao",
      texto: `${contagens.recusasCartao24h} pagamentos com cartão recusados nas últimas 24 horas: se não reconhece esse movimento, pode ser alguém testando cartões. O cartão desliga sozinho com ${RECUSAS_PARA_DESLIGAR_24H}.`,
      link: LINK_CONFIG_PAGAMENTO,
    });
  }
  if (contagens.recusasPorToken >= ALERTA_TOKEN_INVALIDO_1H)
    alertas.push({
      nivel: "atencao",
      texto: `${contagens.recusasPorToken} pagamentos com cartão recusados por dados do cartão inválidos na última hora: confira se a chave pública e o token do Mercado Pago são da mesma conta (Integrações).`,
      link: "/painel/configuracoes/integracoes",
    });
  if (contagens.cartaoEmAnalise)
    alertas.push({
      nivel: "atencao",
      texto: `${contagens.cartaoEmAnalise} pagamento(s) com cartão em análise há mais de um dia: o Mercado Pago decide em até 2 dias úteis; se aprovar com as noites ocupadas, o pagamento fica para devolver.`,
      link: `${LINK_PAGAMENTOS}?atencao=1`,
    });
  const ambiente = estadoPagamentoDoAmbiente(env);
  if (ambiente.situacao === "desligado" && ambienteMercadoPago(env.MERCADOPAGO_AMBIENTE) === null) alertas.push({ nivel: "atencao", texto: "Configuração inválida do Mercado Pago: MERCADOPAGO_AMBIENTE só aceita teste ou producao. O pagamento no site está desligado.", link: "/painel/configuracoes/integracoes" });
  if (o.contaDeTeste === false) alertas.push({ nivel: "atencao", texto: "A conta das chaves do Mercado Pago não é de teste: nenhuma cobrança é feita até trocar as chaves.", link: "/painel/configuracoes/integracoes" });
  if (contagens.aoVivo) alertas.push({ nivel: "atencao", texto: `${contagens.aoVivo} aviso(s) do Mercado Pago marcado(s) como pagamento real (live_mode) no ambiente de teste: confira no painel do Mercado Pago.`, link: LINK_PAGAMENTOS });
  if (contagens.aprovadoSemDesfecho) alertas.push({ nivel: "atencao", texto: `${contagens.aprovadoSemDesfecho} pagamento(s) do site aprovado(s) sem reserva: devolva ao hóspede (pelo Mercado Pago ou por fora).`, link: `${LINK_PAGAMENTOS}?atencao=1` });
  if (contagens.situacaoInesperada)
    alertas.push({
      nivel: "atencao",
      texto: `${contagens.situacaoInesperada} pagamento(s) do site que o Mercado Pago mostrou já devolvido(s) em parte ou contestado(s) antes de o sistema decidir a reserva: devolva o restante pelo quadro do pagamento (acompanhe a disputa pelo quadro do pagamento).`,
      link: `${LINK_PAGAMENTOS}?atencao=1`,
    });
  if (contagens.devolucaoPedida) alertas.push({ nivel: "info", texto: `${contagens.devolucaoPedida} devolução(ões) pedida(s) ao Mercado Pago aguardando confirmação.`, link: `${LINK_PAGAMENTOS}?atencao=1` });
  // Recusada pelo Mercado Pago (três recusas ou respostas incertas, a nossa devolução falha na leitura, a recusa do painel
  // dele registrada); a do pagamento com mais de 78 dias, que nunca foi pedida, conta à parte.
  if (contagens.devolucaoRecusada) alertas.push({ nivel: "atencao", texto: `${contagens.devolucaoRecusada} devolução(ões) parada(s): o Mercado Pago recusou ou não respondeu três vezes. Confira no painel do Mercado Pago antes de tentar de novo ou de registrar a devolução feita por fora.`, link: `${LINK_PAGAMENTOS}?atencao=1` });
  if (contagens.devolucaoForaDoPrazo)
    alertas.push({
      nivel: "atencao",
      texto: `${contagens.devolucaoForaDoPrazo} devolução(ões) de pagamento(s) com mais de 78 dias, que o sistema não pede mais ao Mercado Pago: no cartão, devolva pelo painel do Mercado Pago; no Pix, faça a devolução por fora.`,
      link: `${LINK_PAGAMENTOS}?atencao=1`,
    });
  if (contagens.devolucaoAMenor)
    alertas.push({
      nivel: "atencao",
      texto: `${contagens.devolucaoAMenor} devolução(ões) que o Mercado Pago fez a menos do que o pedido: peça o restante ao Mercado Pago ou registre o restante devolvido por fora (quadro do pagamento).`,
      link: `${LINK_PAGAMENTOS}?atencao=1`,
    });
  if (contagens.aguardandoLiberacaoAtrasada)
    alertas.push({
      nivel: "atencao",
      texto: `${contagens.aguardandoLiberacaoAtrasada} devolução(ões) de parte do valor esperando uma liberação do Mercado Pago que passou da data prevista: confira no painel do Mercado Pago e registre a liberação à mão quando ela aparecer.`,
      link: `${LINK_PAGAMENTOS}?atencao=1`,
    });
  if (contagens.aguardandoLiberacao > contagens.aguardandoLiberacaoAtrasada)
    alertas.push({
      nivel: "info",
      texto: `${contagens.aguardandoLiberacao - contagens.aguardandoLiberacaoAtrasada} devolução(ões) de parte do valor esperando o Mercado Pago liberar o pagamento: o sistema pede assim que ele liberar (no teste, registre a liberação à mão no quadro do pagamento).`,
      link: `${LINK_PAGAMENTOS}?atencao=1`,
    });
  if (contagens.diferencaSemAlteracao)
    alertas.push({ nivel: "atencao", texto: `${contagens.diferencaSemAlteracao} pagamento(s) da diferença de uma alteração aprovado(s) sem a alteração: devolva ao hóspede (quadro do pagamento).`, link: `${LINK_PAGAMENTOS}?atencao=1` });
  if (contagens.reservaDevolvidaNoProvedor)
    alertas.push({
      nivel: "atencao",
      texto: `${contagens.reservaDevolvidaNoProvedor} reserva(s) paga(s) pelo site que o Mercado Pago mostra devolvida(s) fora do sistema: a parte do proprietário ficou em conferência. Cancele pela política ou registre um ajuste.`,
      link: `${LINK_PAGAMENTOS}?atencao=1`,
    });
  if (contagens.criacaoPresa) alertas.push({ nivel: "atencao", texto: `${contagens.criacaoPresa} pagamento(s) do site sem resposta do Mercado Pago sobre a criação há mais de ${CARENCIA_PAGAMENTO_MS / 60_000} minutos: confira no painel do Mercado Pago e use Conferir agora.`, link: `${LINK_PAGAMENTOS}?atencao=1` });
  if (contagens.liberacaoVencida) alertas.push({ nivel: "info", texto: `${contagens.liberacaoVencida} pagamento(s) do site com a liberação prevista vencida e sem confirmação do Mercado Pago: confira e, se o dinheiro caiu, registre a liberação na reserva.`, link: `${LINK_PAGAMENTOS}?atencao=1` });
  if (contagens.semCalculo) alertas.push({ nivel: "atencao", texto: `${contagens.semCalculo} reserva(s) paga(s) pelo site com dinheiro recebido sem cálculo no financeiro: confira o contrato na data da entrada.`, link: LINK_PAGAMENTOS });
  if (contagens.comAviso) alertas.push({ nivel: "atencao", texto: `${contagens.comAviso} pagamento(s) do site com aviso: confira na lista.`, link: `${LINK_PAGAMENTOS}?atencao=1` });
  // Sempre, mesmo com o envio ao Beds24 ligado: o envio fecha só os bloqueios do SCL, nunca as datas das reservas (até o M8.3).
  if (contagens.pagasAbertas) alertas.push({ nivel: "info", texto: `${contagens.pagasAbertas} reserva(s) do site paga(s): feche as datas nas OTAs (no Beds24, como bloqueio).`, link: "/painel/reservas" });
  return { alertas, contagens };
}

/** Códigos de aviso conhecidos, para quem precisar listar (painel). */
export const CODIGOS_AVISO = Object.keys(AVISOS_PAGAMENTO) as CodigoAviso[];

// ---------------------------------------------------------------- cancelamento pela política (M8.2c): Início da operação

/** Pedido esperando a equipe: "atenção" depois de 24 h, ou a 3 dias (ou menos) da entrada. */
export const ATENCAO_PEDIDO_CANCELAMENTO_HORAS = 24;
export const ATENCAO_PEDIDO_CANCELAMENTO_DIAS_ANTES = 3;
/** Mensagem ao hóspede pendente vira "atenção" depois de 24 h. */
export const ATENCAO_AVISAR_HOSPEDE_HORAS = 24;
const LINK_PEDIDOS_CANCELAMENTO = "/painel/reservas?cancelamento=pedido";
const diaHoraSP = (d: Date) => {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", ...o }).format(d);
  return `${f({ day: "2-digit", month: "2-digit" })} às ${f({ hour: "2-digit", minute: "2-digit" })}`;
};
const somarDiasISO = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Avisos do cancelamento pela política para o Início da operação (quem tem `reserva:editar`; da empresa toda, fora dos
 * avisos do financeiro, e sem valores):
 * - um por pedido de cancelamento esperando a equipe, com a idade e a entrada (o pedido nunca se perde pela demora);
 * - reservas do site canceladas com a estadia por vir e as datas ainda não reabertas nas OTAs (o envio ao Beds24 não
 *   reabre datas de reservas; o M8.3 grava a marca sozinho);
 * - cancelamentos com mensagem ao hóspede pendente (a decisão, ou a devolução feita).
 */
export async function avisosDeCancelamento(db: Db, organizacaoId: string, agora: Date = new Date(), o: { mensagensComValor?: boolean } = {}): Promise<AvisoPagamento[]> {
  const hoje = hojeISO("America/Sao_Paulo", agora);
  const alertas: AvisoPagamento[] = [];
  const pedidos = await db
    .select({ codigo: reservas.codigo, checkin: reservas.checkin, recebidoEm: cancelamentosReserva.pedidoRecebidoEm })
    .from(cancelamentosReserva)
    .innerJoin(reservas, eq(reservas.id, cancelamentosReserva.reservaId))
    .where(and(eq(cancelamentosReserva.organizacaoId, organizacaoId), eq(cancelamentosReserva.situacao, "pedido")))
    .orderBy(asc(cancelamentosReserva.pedidoRecebidoEm));
  for (const x of pedidos) {
    const dias = Math.max(0, Math.floor((agora.getTime() - x.recebidoEm.getTime()) / 86_400_000));
    const antigo = agora.getTime() - x.recebidoEm.getTime() >= ATENCAO_PEDIDO_CANCELAMENTO_HORAS * 3_600_000;
    const perto = x.checkin <= somarDiasISO(hoje, ATENCAO_PEDIDO_CANCELAMENTO_DIAS_ANTES);
    alertas.push({
      nivel: antigo || perto ? "atencao" : "info",
      texto: `Pedido de cancelamento da reserva ${x.codigo}: recebido em ${diaHoraSP(x.recebidoEm)}, entrada em ${x.checkin.slice(8, 10)}/${x.checkin.slice(5, 7)} (há ${dias} dia(s)).`,
      link: LINK_PEDIDOS_CANCELAMENTO,
    });
  }
  const canceladas = await db
    .select({ c: cancelamentosReserva, checkout: reservas.checkout, codigo: reservas.codigo })
    .from(cancelamentosReserva)
    .innerJoin(reservas, eq(reservas.id, cancelamentosReserva.reservaId))
    .where(and(eq(cancelamentosReserva.organizacaoId, organizacaoId), eq(cancelamentosReserva.situacao, "cancelada")))
    .orderBy(asc(reservas.codigo));
  const abertas = canceladas.filter((x) => x.checkout > hoje && !x.c.otaLiberadaEm);
  // Sempre, mesmo com o envio ao Beds24 ligado: o envio fecha só os bloqueios do SCL, nunca reabre as datas das reservas (até o M8.3).
  if (abertas.length)
    alertas.push({
      nivel: "info",
      texto: `${abertas.length} reserva(s) do site cancelada(s) (${codigosDasCanceladas(abertas)}): reabra as datas nas OTAs (no Beds24, apague o bloqueio).`,
      link: linkDasCanceladas(abertas),
    });
  // Mensagem ao hóspede pendente: a decisão (desde o cancelamento) ou a devolução feita (desde ela).
  const devs = canceladas.length
    ? await db
        .select({ cancelamentoId: devolucoesPagamento.cancelamentoId, situacao: devolucoesPagamento.situacao, confirmadaEm: devolucoesPagamento.confirmadaEm, porForaData: devolucoesPagamento.porForaData })
        .from(devolucoesPagamento)
        .where(inArray(devolucoesPagamento.cancelamentoId, canceladas.map((x) => x.c.id)))
    : [];
  // A mensagem da decisão e a da devolução feita levam o valor: só quem as pode copiar (quem lê o financeiro) recebe o aviso.
  if (o.mensagensComValor === false) return alertas;
  const pendentes: typeof canceladas = [];
  let atrasada = false;
  for (const x of canceladas) {
    const { c } = x;
    const desde: Date[] = [];
    // M8.2e: "Cancelar a reserva contestada" não tem a mensagem da decisão (a equipe fala com o hóspede caso a caso).
    if (!c.hospedeAvisadoDecisaoEm && c.canceladaEm && c.base !== MOTIVO_CANCELAMENTO_CONTESTACAO) desde.push(c.canceladaEm);
    // M8.2d: a devolução feita é a de todas as devoluções do cancelamento (o dia da última); a substituída não conta.
    const doCancelamento = devs.filter((x) => x.cancelamentoId === c.id && x.situacao !== "substituida");
    const dias = doCancelamento.map((d) => (d.situacao === "confirmada" ? d.confirmadaEm : d.situacao === "por_fora" && d.porForaData ? instanteLocal(d.porForaData, "12:00", "America/Sao_Paulo") : null));
    const feita = dias.length && dias.every((x) => x) ? new Date(Math.max(...dias.map((x) => x!.getTime()))) : null;
    if (feita && !c.hospedeAvisadoDevolucaoEm) desde.push(feita);
    if (!desde.length) continue;
    pendentes.push(x);
    if (desde.some((d) => agora.getTime() - d.getTime() >= ATENCAO_AVISAR_HOSPEDE_HORAS * 3_600_000)) atrasada = true;
  }
  if (pendentes.length)
    alertas.push({
      nivel: atrasada ? "atencao" : "info",
      texto: `${pendentes.length} cancelamento(s) com mensagem ao hóspede pendente (decisão ou devolução feita): avise o hóspede (${codigosDasCanceladas(pendentes)}).`,
      link: linkDasCanceladas(pendentes),
    });
  return alertas;
}

/** Os códigos das reservas do aviso (até 5; o resto em número): quem lê sabe qual abrir. */
const codigosDasCanceladas = (xs: readonly { codigo: string }[]) => (xs.length <= 5 ? xs.map((x) => x.codigo).join(", ") : `${xs.slice(0, 5).map((x) => x.codigo).join(", ")} e mais ${xs.length - 5}`);
/** Uma reserva: a ficha dela. Mais de uma: a lista das canceladas, de todo o histórico (a lista do mês esconde as canceladas). */
const linkDasCanceladas = (xs: readonly { c: { reservaId: string } }[]) => (xs.length === 1 ? `/painel/reservas/${xs[0].c.reservaId}` : "/painel/reservas?situacao=cancelada&escopo=historico");
