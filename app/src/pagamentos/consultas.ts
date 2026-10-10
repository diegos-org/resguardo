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
import { lerRegrasCalendario } from "@/calendario/regras-config";
import { escritaBeds24Pronta } from "@/beds24/http";
import { lerPaginaLegal } from "@/configuracoes/paginas-legais";
import type { VersoesLegais } from "@/configuracoes/paginas-legais-texto";
import {
  aceitesSite,
  type BaseCancelamento,
  cancelamentosReserva,
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
import { ALERTA_ANALISE_CARTAO_HORAS, CARENCIA_PAGAMENTO_MS, inicioDoPrazoDePedirDevolucao, inicioDoPrazoDeReleitura, MAXIMO_CARTAO_POR_COTACAO, MAXIMO_PIX_POR_COTACAO, paginaAindaLe } from "./andamento";
import { ambienteMercadoPago, estadoPagamentoDoAmbiente } from "./ambiente";
import { recusaDoCartao } from "./cartao";
import { porForaPermitidoNoCartao } from "./devolucao";
import { ALERTA_RECUSAS_24H, ALERTA_TOKEN_INVALIDO_1H, disjuntorAberto, RECUSAS_PARA_DESLIGAR_24H, recusasNasUltimas24h, recusasPorTokenNaUltimaHora } from "./disjuntor";
import { type CodigoDevolucao, type ModoTresDS, type StatusTresDS, urlDoDesafio } from "./provedor";
import {
  AVISOS_PAGAMENTO,
  type CodigoAviso,
  codigoMotivo,
  comDinheiro,
  emAndamento,
  motivoDoDetalhe,
  origemDeDevolucaoConhecida,
  type SituacaoPagamento,
  textoDevolucaoAMenor,
  textoMotivoRecusaCartao,
  textoMotivoSemReserva,
} from "./situacoes";
import { type Devolucao, devolucaoDoPagamento, type Pagamento } from "./travas";

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
  porFora: boolean;
  /** Quem confirmou a devolução: a leitura do Mercado Pago ou a equipe (vista no painel dele). */
  confirmadaPor: "leitura" | "equipe" | null;
  forma: "pix" | "cartao";
  /** Cartão com mais de 78 dias: o sistema não pediu a devolução; a equipe faz o estorno pelo painel do Mercado Pago. */
  estornoPelaEquipe: boolean;
  integralAte: string | null;
  arrependimentoAte: string | null;
  entradaEm: Date | null;
  politicaVersao: number | null;
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
};

/**
 * O que a página da cotação mostra sobre o pagamento (design "O que o hóspede vê"). `oferecido` = o site oferece o
 * pagamento nesta cotação (`ofertaDePix` ou `ofertaDeCartao`; sem ele, cotação segurada sem tentativa fica
 * "sem_pagamento", o fluxo pela conversa).
 */
export async function vistaDaCotacaoParaHospede(db: Db, organizacaoId: string, cotacaoId: string, agora: Date, o: { comAutorizacao: boolean; oferecido?: boolean }): Promise<VistaPagamentoHospede | null> {
  if (!uuidValido(cotacaoId)) return null;
  const [c] = await db
    .select({ estado: cotacoes.estado, holdAte: cotacoes.holdAte, reservaId: cotacoes.reservaId, reservaEstado: reservas.estado, reservaCodigo: reservas.codigo })
    .from(cotacoes)
    .leftJoin(reservas, eq(reservas.id, cotacoes.reservaId))
    .where(and(eq(cotacoes.id, cotacaoId), eq(cotacoes.organizacaoId, organizacaoId)));
  if (!c) return null;
  const tentativas = await db.select().from(pagamentos).where(and(eq(pagamentos.cotacaoId, cotacaoId), eq(pagamentos.organizacaoId, organizacaoId))).orderBy(desc(pagamentos.criadoEm), desc(pagamentos.id));
  const devolucoes = tentativas.length ? await db.select().from(devolucoesPagamento).where(inArray(devolucoesPagamento.pagamentoId, tentativas.map((t) => t.id))) : [];
  const devDe = (p: Pagamento) => devolucaoDoPagamento({ devolucoes }, p.id);
  const segurada = c.estado === "segurada" && c.reservaEstado === "pedido" && !!c.holdAte && c.holdAte.getTime() > agora.getTime();
  const pixRestantes = Math.max(0, MAXIMO_PIX_POR_COTACAO - tentativas.filter((t) => t.forma === "pix").length);
  const cartaoRestantes = Math.max(0, MAXIMO_CARTAO_POR_COTACAO - tentativas.filter((t) => t.forma === "cartao").length);
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
    const dev = devDe(comReserva);
    return { ...base, ...estadoDoCancelamento(comReserva, canc, dev), reservaCodigo: c.reservaCodigo, forma: comReserva.forma };
  }
  if (comReserva) {
    // Pagamento em dobro: só enquanto o outro pagamento ainda não voltou ao hóspede (devolvido, o aviso sai).
    const emDobro = tentativas.some((t) => t.id !== comReserva.id && comDinheiro(t.situacao) && !devolvida(t));
    return { ...base, estado: "confirmada", reservaCodigo: c.reservaCodigo, pagamentoEmDobro: emDobro, pedidoCancelamentoEm: canc?.situacao === "pedido" ? canc.pedidoRecebidoEm : null };
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
      if (ultima.etapaCartao === "analise") return { ...base, estado: "cartao_em_analise", prazoDasDatas: c.holdAte };
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

/**
 * A situação da página numa reserva cancelada pela política (M8.2c), pela devolução: sem devolução; devolvida; pedida
 * (inclusive a aceita ainda sem aparecer, e o cartão com mais de 78 dias, que a equipe devolve pelo painel do Mercado
 * Pago); em conferência (devolvida a menos, contestada, em parte, ou parada por isso — nunca oferece outra forma de
 * pagar); com a equipe (o Mercado Pago não devolveu: Pix fora do prazo, recusa, ou pedida parada depois do prazo).
 */
function estadoDoCancelamento(p: Pagamento, canc: typeof cancelamentosReserva.$inferSelect, dev: Devolucao | undefined): { estado: EstadoPagamentoHospede; cancelamento: CancelamentoParaHospede } {
  const devolucaoEm = dev?.situacao === "confirmada" ? dev.confirmadaEm : dev?.situacao === "por_fora" && dev.porForaData ? instanteLocal(dev.porForaData, "12:00", "America/Sao_Paulo") : null;
  const cancelamento: CancelamentoParaHospede = {
    recebidoEm: canc.pedidoRecebidoEm,
    quemCancela: canc.quemCancela,
    direito: canc.direito!,
    base: canc.base ?? (canc.direito === "integral" ? "prazo" : "fora_do_prazo"),
    motivoEmpresa: canc.motivoEmpresa,
    valor: canc.valorADevolver,
    valorConfirmado: dev?.valorConfirmado ?? null,
    devolucaoEm,
    porFora: dev?.situacao === "por_fora",
    confirmadaPor: dev?.situacao === "confirmada" ? (dev.confirmadaPor ?? "leitura") : null,
    forma: p.forma,
    estornoPelaEquipe: dev?.situacao === "recusada" && dev.falhas === 0 && !dev.paradaEm && p.forma === "cartao" && p.avisos.includes("devolucao_fora_do_prazo"),
    integralAte: canc.integralAte,
    arrependimentoAte: canc.arrependimentoAte,
    entradaEm: canc.entradaEm,
    politicaVersao: canc.politicaVersao,
  };
  const em = (estado: EstadoPagamentoHospede) => ({ estado, cancelamento });
  if (canc.direito === "nenhum") return em("cancelada_sem_devolucao");
  if (dev?.situacao === "confirmada" || dev?.situacao === "por_fora") return em("cancelada_devolvida");
  const paradaPorProblema = p.avisos.includes("devolucao_parada") && !dev?.paradaEm;
  if (p.avisos.includes("devolucao_a_menor") || p.situacao === "contestado" || p.situacao === "devolvido_parcial" || paradaPorProblema) return em("cancelada_em_conferencia");
  if (dev?.situacao === "pedida") return em("cancelada_devolucao_pedida");
  // Cartão com mais de 78 dias: nada foi pedido pelo sistema; a equipe devolve pelo painel do Mercado Pago.
  if (cancelamento.estornoPelaEquipe) return em("cancelada_devolucao_pedida");
  if (dev?.situacao === "recusada" && p.situacao === "aprovado") return em("cancelada_com_a_equipe");
  return em("cancelada_em_conferencia");
}

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
  avisos: string[];
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
    confirmadaPor?: "leitura" | "equipe" | null;
    confirmadaNota?: string;
    valorConfirmado?: number | null;
    recusaNoPainelEm?: Date | null;
    paradaEm?: Date | null;
  } | null;
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

const liberacaoVencida = (p: Pagamento, agora: Date) => p.desfecho === "reserva" && p.situacao === "aprovado" && !p.liberacaoConfirmadaEm && !!p.liberacaoPrevistaEm && p.liberacaoPrevistaEm.getTime() < agora.getTime();

/** Tentativa `criando`/`incerta` sem resposta há mais que a carência: a criação do pagamento não se resolve sozinha. */
const criacaoPresa = (p: Pagamento, agora: Date) => (p.situacao === "criando" || p.situacao === "incerta") && p.criadoEm.getTime() + CARENCIA_PAGAMENTO_MS < agora.getTime();

/** O que o quadro do pagamento precisa saber da reserva e do cancelamento dela (M8.2c). */
type ContextoDoPainel = {
  reserva: { estado: EstadoReserva; valorRetido: number | null } | null;
  cancelamento: { situacao: SituacaoCancelamento; direito: DireitoCancelamento | null } | null;
};

/** Os avisos do pagamento em palavras, com os valores quando o texto precisa deles. */
function textosDoPagamento(p: Pagamento, dev: Devolucao | undefined): string[] {
  return p.avisos
    .filter((c): c is CodigoAviso => c in AVISOS_PAGAMENTO)
    .map((c) => {
      if (c === "devolucao_a_menor" && dev && p.devolvidoLido > 0) return textoDevolucaoAMenor(p.devolvidoLido, dev.valor);
      // Sem reserva (M8.2a), o devolvido fora do sistema não tem parte de proprietário em conferência.
      if (c === "devolvido_por_fora" && p.desfecho !== "reserva") return "Este pagamento foi devolvido (no todo ou em parte) fora do sistema: confira no painel do Mercado Pago.";
      return AVISOS_PAGAMENTO[c];
    });
}

function paraPainel(p: Pagamento, dev: Devolucao | undefined, temRecebimentoManual: boolean, agora: Date, ctx: ContextoDoPainel): Omit<PagamentoDoPainel, "aceite"> {
  const semDecisao = p.situacao === "aprovado" && p.desfecho === null;
  // Dinheiro que chegou já devolvido em parte ou contestado, sem decisão do sistema (situação inesperada).
  const inesperada = (p.situacao === "devolvido_parcial" || p.situacao === "contestado") && p.desfecho === null;
  const devolucaoAberta = dev?.situacao === "pedida" || dev?.situacao === "recusada";
  const semDevolucaoAberta = dev?.situacao !== "pedida" && (!dev || dev.situacao === "recusada");
  const podeDecidir = semDecisao && p.motivoSemReserva !== null && semDevolucaoAberta && (!dev || dev.origem === "sem_reserva");
  // Contestado sem desfecho: a situação local nunca volta a "aprovado", então a devolução feita por fora fica oferecida
  // (o domínio relê a order antes e só aceita quando o Mercado Pago mostra o pagamento aprovado de novo). Devolvido em
  // parte, não: o Mercado Pago sempre mostra a parte devolvida e o domínio recusaria; resolve-se por lá (M8.2d).
  const contestadoSemDesfecho = p.situacao === "contestado" && p.desfecho === null && p.motivoSemReserva !== null && semDevolucaoAberta;
  // Cartão: por fora só quando a devolução pelo Mercado Pago não deu de vez ou o pagamento passou de 180 dias (a mesma regra do domínio).
  const porForaNoCartao = porForaPermitidoNoCartao(p, dev, agora);
  const cartao = p.forma === "cartao";
  // M8.2c: a devolução do cancelamento (reserva cancelada com direito integral) e os registros da equipe.
  const conhecida = !!dev && origemDeDevolucaoConhecida(dev.origem);
  const doCancelamento = conhecida && dev!.origem === "cancelamento" && p.desfecho === "reserva" && ctx.cancelamento?.situacao === "cancelada" && ctx.cancelamento.direito === "integral";
  const doSemReserva = conhecida && dev!.origem === "sem_reserva" && p.desfecho === null;
  const recusadaDoCancelamento = doCancelamento && dev!.situacao === "recusada" && p.situacao === "aprovado";
  const foraDaLeitura = p.criadoEm.getTime() < inicioDoPrazoDeReleitura(agora).getTime();
  const semConfirmacaoPelaLeitura = p.avisos.includes("devolucao_sem_confirmacao") || p.avisos.includes("devolucao_a_menor") || p.avisos.includes("situacao_desconhecida");
  const calculada = !!ctx.reserva && reservaCalculadaPeloMotor(ctx.reserva);
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
    avisos: textosDoPagamento(p, dev),
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
        }
      : null,
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
    pedeAtencao:
      semDecisao ||
      inesperada ||
      devolucaoAberta ||
      p.avisos.length > 0 ||
      p.situacao === "incerta" ||
      criacaoPresa(p, agora) ||
      (calculada && liberacaoVencida(p, agora)) ||
      (p.desfecho === "reserva" && ctx.cancelamento?.situacao === "pedido"),
    acoes: {
      conferir: p.idProvedor !== null || emAndamento(p.situacao) || !!dev,
      // Cancelamento: pedir de novo só a devolução recusada de um pagamento com até 78 dias (depois, nada se pede).
      devolver: podeDecidir || (recusadaDoCancelamento && p.criadoEm.getTime() >= inicioDoPrazoDePedirDevolucao(agora).getTime()),
      // A devolução por fora relê antes a order no Mercado Pago (devolvida, em andamento ou contestada = recusa).
      devolucaoPorFora: ((podeDecidir || contestadoSemDesfecho) && porForaNoCartao) || (recusadaDoCancelamento && !dev!.chaveAceita && porForaNoCartao),
      // Só a reserva que o motor calcula (confirmada, ou cancelada com valor retido) recebe a liberação no livro.
      registrarLiberacao: p.desfecho === "reserva" && p.situacao === "aprovado" && !p.liberacaoConfirmadaEm && calculada,
      estornarLiberacao: p.liberacaoOrigem === "manual" && temRecebimentoManual && !dev?.saidaLancamentoId,
      registrarTaxaPerdida: (dev?.situacao === "confirmada" || dev?.situacao === "por_fora") && dev.taxaPerdida === null,
      confirmarDevolucaoVista: (doSemReserva || doCancelamento) && (dev!.situacao === "pedida" || dev!.situacao === "recusada") && (foraDaLeitura || semConfirmacaoPelaLeitura),
      registrarRecusaNoPainel: conhecida && !dev!.recusaNoPainelEm && (dev!.situacao === "recusada" || (dev!.situacao === "pedida" && foraDaLeitura && !dev!.chaveAceita)),
      pararDevolucaoPedida: conhecida && dev!.situacao === "pedida" && foraDaLeitura,
      corrigirTaxaPerdida: !!dev && dev.taxaPerdida !== null,
    },
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
    ...paraPainel(p, devolucaoDoPagamento({ devolucoes: devs }, p.id), comManual.has(p.id), agora, { reserva: rs.find((r) => r.id === p.reservaId) ?? null, cancelamento: cs.find((c) => c.reservaId === p.reservaId) ?? null }),
    aceite: aceiteDe(p),
  }));
}

/**
 * D21 (M8.2c), gêmeo TS de `devolvidaNoProvedorSql` (`portal/posse.ts`): o pagamento que confirmou a reserva (desfecho
 * "reserva") aparece devolvido no Mercado Pago — no todo, em parte, pela leitura ou pelo aviso de devolução por fora —
 * e a reserva não tem cancelamento pela política com devolução integral. A parte do proprietário fica em conferência.
 */
export function devolvidaNoProvedor(
  pagamentoQueConfirmou: Pick<Pagamento, "desfecho" | "situacao" | "devolvidoLido" | "avisos"> | null | undefined,
  cancelamento: { situacao: SituacaoCancelamento; direito: DireitoCancelamento | null } | null | undefined,
): boolean {
  const p = pagamentoQueConfirmou;
  if (!p || p.desfecho !== "reserva") return false;
  const devolvido = p.situacao === "devolvido" || p.situacao === "devolvido_parcial" || p.devolvidoLido > 0 || p.avisos.includes("devolvido_por_fora");
  return devolvido && !(cancelamento?.situacao === "cancelada" && cancelamento.direito === "integral");
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
      eq(pagamentos.desfecho, "reserva"),
      eq(pagamentos.situacao, "aprovado"),
      isNull(pagamentos.liberacaoConfirmadaEm),
      sql`${pagamentos.liberacaoPrevistaEm} < ${agora}`,
      sql`exists (select 1 from ${reservas} where ${reservas.id} = ${pagamentos.reservaId} and ${reservaCalculadaSql()})`,
    ),
    sql`exists (select 1 from ${devolucoesPagamento} where ${devolucoesPagamento.pagamentoId} = ${pagamentos.id} and ${devolucoesPagamento.situacao} in ('pedida', 'recusada'))`,
    // M8.2c: pedido de cancelamento esperando a equipe.
    and(eq(pagamentos.desfecho, "reserva"), sql`exists (select 1 from ${cancelamentosReserva} where ${cancelamentosReserva.reservaId} = ${pagamentos.reservaId} and ${cancelamentosReserva.situacao} = 'pedido')`),
  );
}

export type LinhaPagamento = PagamentoDoPainel & { reservaCodigo: string; reservaEstado: string; imovelCodigo: string; checkin: string; checkout: string; cotacaoCodigo: string };

/**
 * Financeiro → Pagamentos do site: por período (dia de criação, em São Paulo, `de` e `ate` inclusive), com o
 * filtro "pede atenção" (que ignora o período: o que pede atenção aparece sempre).
 */
export async function listarPagamentos(db: Db, organizacaoId: string, f: { de?: string; ate?: string; atencao?: boolean } = {}, agora: Date = new Date()): Promise<LinhaPagamento[]> {
  const dia = sql`(${pagamentos.criadoEm} at time zone 'America/Sao_Paulo')::date`;
  const linhas = await db
    .select({ p: pagamentos, reservaCodigo: reservas.codigo, reservaEstado: reservas.estado, imovelCodigo: imoveis.codigo, checkin: reservas.checkin, checkout: reservas.checkout, cotacaoCodigo: cotacoes.codigo })
    .from(pagamentos)
    .innerJoin(reservas, eq(reservas.id, pagamentos.reservaId))
    .innerJoin(imoveis, eq(imoveis.id, pagamentos.imovelId))
    .innerJoin(cotacoes, eq(cotacoes.id, pagamentos.cotacaoId))
    .where(and(eq(pagamentos.organizacaoId, organizacaoId), !f.atencao && f.de ? gte(dia, f.de) : undefined, !f.atencao && f.ate ? sql`${dia} <= ${f.ate}` : undefined, f.atencao ? podePedirAtencao(agora) : undefined))
    .orderBy(desc(pagamentos.criadoEm), desc(pagamentos.id))
    .limit(500);
  const painel = await montarPainel(db, organizacaoId, linhas.map((l) => l.p), agora);
  const r = painel.map((p, i) => ({ ...p, reservaCodigo: linhas[i].reservaCodigo, reservaEstado: linhas[i].reservaEstado, imovelCodigo: linhas[i].imovelCodigo, checkin: linhas[i].checkin, checkout: linhas[i].checkout, cotacaoCodigo: linhas[i].cotacaoCodigo }));
  return f.atencao ? r.filter((x) => x.pedeAtencao) : r;
}

export type AvisoPagamento = { nivel: "atencao" | "info"; texto: string; link?: string };
export type ContagensPagamento = {
  /** Aprovado sem reserva, a devolver ao hóspede (pelo Mercado Pago ou por fora). */
  aprovadoSemDesfecho: number;
  /** Chegou já devolvido em parte ou contestado, antes de o sistema decidir: resolve-se no painel do Mercado Pago. */
  situacaoInesperada: number;
  devolucaoPedida: number;
  devolucaoRecusada: number;
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
          eq(pagamentos.desfecho, "reserva"),
          sql`jsonb_array_length(${pagamentos.avisos}) > 0`,
          inArray(pagamentos.situacao, ["criando", "incerta"]),
          and(eq(pagamentos.forma, "cartao"), eq(pagamentos.situacao, "pendente"), eq(pagamentos.etapaCartao, "analise")),
        ),
      ),
    );
  const devs = lista.length ? await db.select().from(devolucoesPagamento).where(inArray(devolucoesPagamento.pagamentoId, lista.map((p) => p.id))) : [];
  const devDe = (id: string) => devs.find((d) => d.pagamentoId === id);
  const contagens: ContagensPagamento = {
    aprovadoSemDesfecho: 0,
    situacaoInesperada: 0,
    devolucaoPedida: 0,
    devolucaoRecusada: 0,
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
  };
  // M8.2c: as reservas pagas (o motor ainda calcula?) e os cancelamentos ativos delas.
  const reservaIds = [...new Set(lista.filter((p) => p.desfecho === "reserva").map((p) => p.reservaId))];
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
  for (const p of lista) {
    const dev = devDe(p.id);
    // Devoluções pedidas ou paradas, de qualquer origem que esta versão conhece (sem reserva e cancelamento, M8.2c).
    const devolucaoConta = !!dev && origemDeDevolucaoConhecida(dev.origem) && comDinheiro(p.situacao) && p.situacao !== "devolvido";
    if (devolucaoConta && dev.situacao === "pedida") contagens.devolucaoPedida++;
    else if (devolucaoConta && dev.situacao === "recusada") contagens.devolucaoRecusada++;
    else if (comDinheiro(p.situacao) && p.situacao !== "devolvido" && p.desfecho === null) {
      // Não é "devolva ao hóspede": o Mercado Pago já devolveu parte ou há contestação (o sistema não devolve isso).
      if (codigoMotivo(p.motivoSemReserva) === "situacao_inesperada") contagens.situacaoInesperada++;
      else if (!dev || dev.situacao !== "pedida") contagens.aprovadoSemDesfecho++;
    }
    if (p.avisos.includes("devolucao_a_menor")) contagens.devolucaoAMenor++;
    if (p.desfecho === "reserva" && devolvidaNoProvedor(p, cs.find((x) => x.reservaId === p.reservaId))) contagens.reservaDevolvidaNoProvedor++;
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
    // Pagas pelo site com a estadia ainda por vir ou em curso: as OTAs não sabem delas enquanto o envio não sai.
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
      texto: `${contagens.situacaoInesperada} pagamento(s) do site que o Mercado Pago mostrou já devolvido(s) em parte ou contestado(s) antes de o sistema decidir a reserva: resolva pelo painel do Mercado Pago (o sistema passa a cuidar disso no M8.2d).`,
      link: `${LINK_PAGAMENTOS}?atencao=1`,
    });
  if (contagens.devolucaoPedida) alertas.push({ nivel: "info", texto: `${contagens.devolucaoPedida} devolução(ões) pedida(s) ao Mercado Pago aguardando confirmação.`, link: `${LINK_PAGAMENTOS}?atencao=1` });
  if (contagens.devolucaoRecusada) alertas.push({ nivel: "atencao", texto: `${contagens.devolucaoRecusada} devolução(ões) parada(s): o Mercado Pago recusou ou não respondeu três vezes. Confira no painel do Mercado Pago antes de tentar de novo ou de registrar a devolução feita por fora.`, link: `${LINK_PAGAMENTOS}?atencao=1` });
  if (contagens.devolucaoAMenor)
    alertas.push({ nivel: "atencao", texto: `${contagens.devolucaoAMenor} devolução(ões) de cancelamento que o Mercado Pago fez a menos do que o pedido: confira no painel do Mercado Pago.`, link: `${LINK_PAGAMENTOS}?atencao=1` });
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
  if (contagens.pagasAbertas) {
    const envioLigado = escritaBeds24Pronta(env) && (await lerRegrasCalendario(db, organizacaoId)).envio.automatico;
    if (!envioLigado) alertas.push({ nivel: "info", texto: `${contagens.pagasAbertas} reserva(s) do site paga(s): feche as datas nas OTAs (no Beds24, como bloqueio) enquanto o envio ao Beds24 estiver desligado.`, link: "/painel/reservas" });
  }
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
 * - reservas do site canceladas com a estadia por vir e as datas ainda não reabertas nas OTAs, enquanto o envio ao Beds24
 *   estiver desligado (o M8.3 grava a marca sozinho);
 * - cancelamentos com mensagem ao hóspede pendente (a decisão, ou a devolução feita).
 */
export async function avisosDeCancelamento(db: Db, organizacaoId: string, agora: Date = new Date(), o: { env?: NodeJS.ProcessEnv } = {}): Promise<AvisoPagamento[]> {
  const env = o.env ?? process.env;
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
    .select({ c: cancelamentosReserva, checkout: reservas.checkout })
    .from(cancelamentosReserva)
    .innerJoin(reservas, eq(reservas.id, cancelamentosReserva.reservaId))
    .where(and(eq(cancelamentosReserva.organizacaoId, organizacaoId), eq(cancelamentosReserva.situacao, "cancelada")));
  const abertas = canceladas.filter((x) => x.checkout > hoje && !x.c.otaLiberadaEm).length;
  if (abertas) {
    const envioLigado = escritaBeds24Pronta(env) && (await lerRegrasCalendario(db, organizacaoId)).envio.automatico;
    if (!envioLigado)
      alertas.push({ nivel: "info", texto: `${abertas} reserva(s) do site cancelada(s): reabra as datas nas OTAs (no Beds24, apague o bloqueio) enquanto o envio ao Beds24 estiver desligado.`, link: "/painel/reservas" });
  }
  // Mensagem ao hóspede pendente: a decisão (desde o cancelamento) ou a devolução feita (desde ela).
  const devs = canceladas.length
    ? await db
        .select({ cancelamentoId: devolucoesPagamento.cancelamentoId, situacao: devolucoesPagamento.situacao, confirmadaEm: devolucoesPagamento.confirmadaEm, porForaData: devolucoesPagamento.porForaData })
        .from(devolucoesPagamento)
        .where(inArray(devolucoesPagamento.cancelamentoId, canceladas.map((x) => x.c.id)))
    : [];
  let pendentes = 0;
  let atrasada = false;
  for (const { c } of canceladas) {
    const desde: Date[] = [];
    if (!c.hospedeAvisadoDecisaoEm && c.canceladaEm) desde.push(c.canceladaEm);
    const d = devs.find((x) => x.cancelamentoId === c.id);
    const feita = d?.situacao === "confirmada" ? d.confirmadaEm : d?.situacao === "por_fora" && d.porForaData ? instanteLocal(d.porForaData, "12:00", "America/Sao_Paulo") : null;
    if (feita && !c.hospedeAvisadoDevolucaoEm) desde.push(feita);
    if (!desde.length) continue;
    pendentes++;
    if (desde.some((x) => agora.getTime() - x.getTime() >= ATENCAO_AVISAR_HOSPEDE_HORAS * 3_600_000)) atrasada = true;
  }
  if (pendentes)
    alertas.push({ nivel: atrasada ? "atencao" : "info", texto: `${pendentes} cancelamento(s) com mensagem ao hóspede pendente (decisão ou devolução feita): avise o hóspede.`, link: "/painel/reservas" });
  return alertas;
}
