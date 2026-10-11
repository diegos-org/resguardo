/**
 * Pagamento no site (M8.2a) — o que a página da cotação recebe sobre o pagamento, já pronto para o navegador:
 * datas em texto ISO, imagem do QR como endereço `data:` conferido e link do Pix só se for https. Puro (sem banco):
 * o servidor monta, o componente do navegador e a rota de acompanhamento usam. Nada pessoal: a vista do domínio
 * não tem nenhum dado do hóspede, e o QR só vem quando quem chama tem a autorização do pedido.
 *
 * Cartão (M8.2b): o formulário do cartão (chave pública, valor, parcelas) e o endereço do desafio do banco também só
 * com a autorização; a recusa é sempre o mesmo texto (o motivo nunca chega ao navegador).
 *
 * Cancelamento pela política (M8.2c): os fatos (código, datas, horas, versão da política, valores) e o texto que a
 * página e as mensagens ao hóspede mostram (`textoDoCancelamento`, o compositor único): as frases vêm de Textos do site.
 *
 * Alteração da reserva paga (M8.2d): a alteração segurada (com o pagamento da diferença no aumento), a aplicada (com a
 * devolução da diferença), a que não pôde valer e a que não vale mais, e o compositor único do texto dela
 * (`textoDaAlteracao`: a página, a variável `{alteracao}` das mensagens e o botão "Copiar a proposta" do painel).
 */
import { fimDoArrependimento, pagaSemPrazoIntegral, TEXTO_VALOR_PELA_EQUIPE } from "@/configuracoes/politica-cancelamento";
import type { TextosSite } from "@/configuracoes/textos-site";
import type { AlteracaoParaHospede, CancelamentoParaHospede, EstadoPagamentoHospede, VistaPagamentoHospede } from "@/pagamentos/consultas";
import { urlDoDesafio } from "@/pagamentos/provedor";
import { formatBRL } from "@/lib/money";

export type { EstadoPagamentoHospede };

/** O cancelamento como vai ao navegador (datas em texto ISO). */
export type CancelamentoDoHospede = Omit<CancelamentoParaHospede, "recebidoEm" | "devolucaoEm" | "entradaEm"> & { recebidoEm: string; devolucaoEm: string | null; entradaEm: string | null };

/** A alteração como vai ao navegador (datas em texto ISO; o pagamento da diferença no mesmo formato do da cotação). */
export type AlteracaoDoHospede = Omit<AlteracaoParaHospede, "holdAte" | "preparadaEm" | "aplicadaEm" | "devolucao" | "pagoSemAlteracao" | "pagamento"> & {
  holdAte: string | null;
  preparadaEm: string;
  aplicadaEm: string | null;
  devolucao: (Omit<NonNullable<AlteracaoParaHospede["devolucao"]>, "em"> & { em: string | null }) | null;
  pagoSemAlteracao: { valor: number; em: string } | null;
  pagamento: PagamentoDoHospede | null;
};

/** O que o formulário do cartão precisa no navegador (nada pessoal; a chave pública é pública). */
export type CartaoNaPagina = {
  chavePublica: string;
  /** Total da cotação em centavos: o que o servidor cobra (o formulário mostra os juros das parcelas por cima). */
  valor: number;
  /** null = o máximo de parcelas que o Mercado Pago oferecer. */
  parcelasMaximas: number | null;
  /** E-mail do pagador de teste (sandbox), que esconde o campo de e-mail do formulário; null fora do teste. */
  emailTeste: string | null;
};

export type PagamentoDoHospede = {
  estado: EstadoPagamentoHospede;
  ambienteTeste: boolean;
  dinheiroSemDesfecho: boolean;
  /** Prazo das datas, quando seguradas (ISO). */
  holdAte: string | null;
  /** Pix aguardando — só com a autorização do pedido. */
  pix: { copiaECola: string; imagem: string | null; link: string | null; expiraEm: string | null } | null;
  pixRestantes: number;
  /** "Gerar Pix"/"Gerar outro Pix" só quando o site ainda oferece o Pix nesta cotação (a oferta conferida agora). */
  podeGerar: boolean;
  reservaCodigo: string | null;
  pagamentoEmDobro: boolean;
  devolucao: { situacao: "pedida" | "feita"; em: string | null } | null;
  /** Alguma tentativa ainda pode virar dinheiro: a página acompanha mesmo fora das situações de espera. */
  acompanhar: boolean;
  // --- Cartão (M8.2b)
  /** O site oferece o cartão nesta cotação agora (a oferta conferida agora, com tentativas sobrando). */
  podePagarCartao: boolean;
  /** Formulário do cartão — só com a autorização do pedido e `podePagarCartao`. */
  cartao: CartaoNaPagina | null;
  cartaoRestantes: number;
  /** Endereço do desafio do banco (https de domínio do Mercado Pago), só com a autorização. */
  desafioUrl: string | null;
  /** Forma da tentativa que manda na página (para os textos e a mensagem à equipe). */
  forma: "pix" | "cartao" | null;
  /** Cartão encerrado sem dinheiro: recusado (sempre o mesmo texto) ou a verificação do banco não concluída. */
  recusa: "cartao" | "verificacao" | null;
  /** Fim do prazo das datas (ISO), mesmo já passado: só no cartão em análise. */
  prazoDasDatas: string | null;
  // --- Cancelamento pela política (M8.2c)
  cancelamento: CancelamentoDoHospede | null;
  /** Pedido de cancelamento recebido, ainda sem decisão (ISO). */
  pedidoCancelamentoEm: string | null;
  /** Esse pedido é de um pagamento sem a política aceita: o recibo não cita política nenhuma. */
  pedidoCancelamentoSemPolitica?: boolean;
  /** M8.2d: a alteração da reserva paga que a página mostra; null sem nenhuma. */
  alteracao?: AlteracaoDoHospede | null;
  /** M8.2d: a reserva já alterada, como está agora (o resumo da página é o da cotação original). */
  reservaAtual?: { checkin: string; checkout: string; hospedes: number | null; valor: number | null } | null;
};

/**
 * Situações em que a página pode oferecer um pagamento (Pix ou cartão): só nelas a oferta é conferida, e a caixa do
 * aceite das páginas legais aparece. Com o Pix aguardando, o hóspede pode trocar pelo cartão (o domínio cancela o Pix
 * no Mercado Pago e relê antes; pago no meio tempo = "já pago"); no desafio do banco, pode trocar pelo Pix ou por outro
 * cartão (o desafio é cancelado).
 */
export const ESTADOS_QUE_PAGAM: readonly EstadoPagamentoHospede[] = ["sem_pagamento", "pagar", "pix_aguardando", "pix_vencido", "pix_esgotado", "cartao_recusado", "cartao_desafio"];
export const estadoQuePaga = (e: EstadoPagamentoHospede) => ESTADOS_QUE_PAGAM.includes(e);

/** Situações em que a página acompanha sozinha (consulta a rota a cada poucos segundos). */
export const ESTADOS_EM_ESPERA: readonly EstadoPagamentoHospede[] = ["pix_aguardando", "pix_vencido", "verificando", "confirmando", "cartao_desafio", "cartao_em_analise"];
export const emEspera = (e: EstadoPagamentoHospede) => ESTADOS_EM_ESPERA.includes(e);
/**
 * A página continua acompanhando: situação de espera, ou tentativa que ainda pode virar dinheiro (ex.: Pix esgotado); M8.2d:
 * também quando o pagamento da diferença de uma alteração está numa delas.
 */
export const deveAcompanhar = (v: { estado: EstadoPagamentoHospede; acompanhar?: boolean; alteracao?: { pagamento: { estado: EstadoPagamentoHospede; acompanhar?: boolean } | null } | null }): boolean =>
  emEspera(v.estado) || v.acompanhar === true || (!!v.alteracao?.pagamento && (emEspera(v.alteracao.pagamento.estado) || v.alteracao.pagamento.acompanhar === true));
/**
 * Situações em que o dinheiro já chegou (ou voltou): a página recarrega na hora, mesmo com o formulário do cartão aberto
 * (o hóspede nunca digita um cartão para uma cotação já paga).
 */
export const ESTADOS_COM_DINHEIRO: readonly EstadoPagamentoHospede[] = [
  "confirmando",
  "confirmada",
  "aprovado_sem_datas",
  "devolucao_pedida",
  "devolvido",
  "cancelada_devolucao_pedida",
  "cancelada_devolvida",
  "cancelada_com_a_equipe",
  "cancelada_em_conferencia",
  "cancelada_sem_devolucao",
];
/** A reserva paga pelo site e cancelada pela política (M8.2c). */
export const ESTADOS_CANCELADA: readonly EstadoPagamentoHospede[] = ["cancelada_devolucao_pedida", "cancelada_devolvida", "cancelada_com_a_equipe", "cancelada_em_conferencia", "cancelada_sem_devolucao"];
export const estadoCancelada = (e: EstadoPagamentoHospede) => ESTADOS_CANCELADA.includes(e);

/** Título do quadro da cotação em cada situação do pagamento (sem_pagamento = o título de sempre). */
export const TITULO_PAGAMENTO: Record<Exclude<EstadoPagamentoHospede, "sem_pagamento">, string> = {
  pagar: "Datas seguradas",
  pix_aguardando: "Pix aguardando pagamento",
  pix_vencido: "Datas seguradas",
  pix_esgotado: "Datas seguradas",
  verificando: "Conferindo o pagamento",
  confirmando: "Pagamento recebido",
  confirmada: "Reserva confirmada",
  aprovado_sem_datas: "Pagamento recebido",
  devolucao_pedida: "Devolução pedida",
  devolvido: "Valor devolvido",
  cartao_desafio: "Verificação do seu banco",
  cartao_em_analise: "Pagamento em análise",
  cartao_recusado: "Datas seguradas",
  cancelada_devolucao_pedida: "Reserva cancelada",
  cancelada_devolvida: "Reserva cancelada",
  cancelada_com_a_equipe: "Reserva cancelada",
  cancelada_em_conferencia: "Reserva cancelada",
  cancelada_sem_devolucao: "Reserva cancelada",
};

/** Situações em que falar com a equipe é o caminho principal (não há pagamento a fazer na página). */
const CONTATO_PRINCIPAL: readonly EstadoPagamentoHospede[] = ["aprovado_sem_datas", "devolucao_pedida", "devolvido", "cartao_em_analise", ...ESTADOS_CANCELADA];
/**
 * O botão da equipe é o caminho principal? Nas situações acima, e no Pix esgotado ou no cartão recusado quando nenhuma
 * outra forma de pagar está disponível agora.
 */
export function contatoPrincipal(v: Pick<PagamentoDoHospede, "estado" | "podeGerar" | "podePagarCartao">): boolean {
  if (CONTATO_PRINCIPAL.includes(v.estado)) return true;
  return (v.estado === "pix_esgotado" || v.estado === "cartao_recusado") && !v.podeGerar && !v.podePagarCartao;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Imagem do QR → endereço `data:` de PNG; qualquer outra coisa = sem imagem (a página mostra o link). */
export function imagemDoQr(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.replace(/\s+/g, "");
  const corpo = s.startsWith("data:image/png;base64,") ? s.slice("data:image/png;base64,".length) : s;
  return corpo.length > 0 && corpo.length <= 200_000 && BASE64.test(corpo) ? `data:image/png;base64,${corpo}` : null;
}

/** Link do Pix no Mercado Pago: só https (nunca outro esquema vindo de fora). */
export function linkDoPix(v: string | null | undefined): string | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Vista do domínio → navegador. A oferta (`podeGerar`, `podePagarCartao`, `cartao`) quem decide é `vistaDoPagamento`. */
export function paraOHospede(v: VistaPagamentoHospede): PagamentoDoHospede {
  return {
    estado: v.estado,
    ambienteTeste: v.ambienteTeste,
    dinheiroSemDesfecho: v.dinheiroSemDesfecho,
    holdAte: iso(v.holdAte),
    pix: v.pix ? { copiaECola: v.pix.copiaECola, imagem: imagemDoQr(v.pix.imagemBase64), link: linkDoPix(v.pix.link), expiraEm: iso(v.pix.expiraEm) } : null,
    pixRestantes: v.pixRestantes,
    podeGerar: false,
    reservaCodigo: v.reservaCodigo,
    pagamentoEmDobro: v.pagamentoEmDobro,
    devolucao: v.devolucao ? { situacao: v.devolucao.situacao, em: iso(v.devolucao.em) } : null,
    acompanhar: v.acompanhar,
    podePagarCartao: false,
    cartao: null,
    cartaoRestantes: v.cartaoRestantes,
    // Conferido de novo aqui: nada que não seja https de domínio do Mercado Pago chega a um iframe.
    desafioUrl: urlDoDesafio(v.desafioUrl),
    forma: v.forma,
    recusa: v.recusa,
    prazoDasDatas: iso(v.prazoDasDatas),
    cancelamento: v.cancelamento ? { ...v.cancelamento, recebidoEm: v.cancelamento.recebidoEm.toISOString(), devolucaoEm: iso(v.cancelamento.devolucaoEm), entradaEm: iso(v.cancelamento.entradaEm) } : null,
    pedidoCancelamentoEm: iso(v.pedidoCancelamentoEm),
    ...(v.pedidoCancelamentoSemPolitica ? { pedidoCancelamentoSemPolitica: true } : {}),
    ...(v.alteracao ? { alteracao: alteracaoParaOHospede(v.alteracao) } : {}),
    ...(v.reservaAtual ? { reservaAtual: v.reservaAtual } : {}),
  };
}

/** A alteração do domínio → navegador. A oferta do pagamento da diferença (`podeGerar`, o cartão) quem decide é `vistaDoPagamento`. */
export function alteracaoParaOHospede(a: AlteracaoParaHospede): AlteracaoDoHospede {
  return {
    ...a,
    holdAte: iso(a.holdAte),
    preparadaEm: a.preparadaEm.toISOString(),
    aplicadaEm: iso(a.aplicadaEm),
    devolucao: a.devolucao ? { ...a.devolucao, em: iso(a.devolucao.em) } : null,
    pagoSemAlteracao: a.pagoSemAlteracao ? { valor: a.pagoSemAlteracao.valor, em: a.pagoSemAlteracao.em.toISOString() } : null,
    pagamento: a.pagamento ? paraOHospede(a.pagamento) : null,
  };
}

const horaNoFuso = (d: Date, fuso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, hour: "2-digit", minute: "2-digit" }).format(d);
const diaNoFuso = (d: Date, fuso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, day: "2-digit", month: "2-digit" }).format(d);
/** "13:30" no mesmo dia; "02/10, 13:30" noutro (no fuso do imóvel). */
const momento = (d: Date, agora: Date, fuso: string) => (diaNoFuso(d, fuso) === diaNoFuso(agora, fuso) ? horaNoFuso(d, fuso) : `${diaNoFuso(d, fuso)}, ${horaNoFuso(d, fuso)}`);

/**
 * A linha fixa do cartão em análise (não editável: leva a hora, calculada no servidor no fuso do imóvel). Enquanto as
 * datas estão seguradas, até quando; depois, o que acontece se a análise aprovar. null sem o prazo.
 */
export function linhaDaAnalise(prazo: string | null, agora: Date, fuso: string): string | null {
  if (!prazo) return null;
  const d = new Date(prazo);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() > agora.getTime()) return `As datas estão seguradas até ${momento(d, agora, fuso)}.`;
  const quando = momento(d, agora, fuso);
  return `O prazo das datas acabou ${quando.includes(",") ? "em" : "às"} ${quando}: se a análise aprovar e as datas ainda estiverem livres, confirmamos a reserva; senão, devolvemos o valor integral.`;
}

/**
 * Mensagem para a equipe (WhatsApp ou e-mail) numa situação do pagamento: as duas primeiras linhas da mensagem da
 * cotação (código, imóvel, datas e valor) e uma linha sobre o pagamento, pela forma ("por Pix" ou "com cartão"). Datas
 * seguradas: a mensagem de sempre.
 */
export function mensagemDoContato(textoDaCotacao: string, estado: EstadoPagamentoHospede, reservaCodigo: string | null, forma: "pix" | "cartao" | null = null): string {
  const cartao = forma === "cartao";
  const por = cartao ? "com cartão" : "por Pix";
  const pelo = cartao ? "com cartão" : "pelo Pix";
  const linha: Partial<Record<EstadoPagamentoHospede, string>> = {
    verificando: `Fiz o pagamento ${por} e a página ainda está conferindo.`,
    confirmando: `Fiz o pagamento ${por} e a página ainda está confirmando a reserva.`,
    confirmada: reservaCodigo ? `Paguei ${pelo} e minha reserva é a ${reservaCodigo}.` : `Paguei ${pelo} e a página diz que a reserva foi confirmada.`,
    aprovado_sem_datas: `Paguei ${pelo}, mas a página diz que não deu para garantir as datas.`,
    devolucao_pedida: `Quero saber da devolução do meu pagamento ${pelo}.`,
    devolvido: `Quero falar sobre a devolução do meu pagamento ${pelo}.`,
    cartao_em_analise: "Paguei com cartão e a página diz que o pagamento está em análise.",
  };
  for (const e of ESTADOS_CANCELADA) linha[e] = `Quero falar sobre o cancelamento da minha reserva${reservaCodigo ? ` ${reservaCodigo}` : ""}.`;
  const extra = linha[estado];
  return extra ? [...textoDaCotacao.split("\n").slice(0, 2), extra].join("\n") : textoDaCotacao;
}

/** M8.2d: a mensagem do botão da equipe no quadro da alteração (as duas primeiras linhas da cotação e a reserva). */
export function mensagemDoContatoDaAlteracao(textoDaCotacao: string, reservaCodigo: string): string {
  return [...textoDaCotacao.split("\n").slice(0, 2), `Quero falar sobre a alteração da minha reserva ${reservaCodigo}.`].join("\n");
}

// ---------------------------------------------------------------- cancelamento pela política (M8.2c)

/** As frases editáveis do cancelamento (Textos do site). */
export type TextosDoCancelamento = Pick<
  TextosSite,
  | "cancelamentoSemTaxas"
  | "cancelamentoDevolucaoPedida"
  | "cancelamentoEstornoNoCartao"
  | "cancelamentoVoltaPix"
  | "cancelamentoVoltaCartao"
  | "cancelamentoVoltaPorFora"
  | "cancelamentoComAEquipe"
  | "cancelamentoEmConferencia"
  | "cancelamentoSemDevolucaoPrazo"
  | "cancelamentoSemDevolucaoNaoComparecimento"
  | "cancelamentoSemDevolucaoEquipe"
  | "cancelamentoFecho"
  | "cancelamentoPedidoRecebido"
> &
  // M8.2d: a devolução de parte do valor que espera a liberação do pagamento (opcional para quem monta os textos à mão).
  Partial<Pick<TextosSite, "devolucaoAguardaLiberacao">>;

/** O texto do cancelamento em partes: as linhas da página e o que as mensagens usam (`{decisao}`, `{comovolta}`). */
export type TextoDoCancelamento = {
  /** Tudo o que a página mostra, na ordem (vazio quando não há cancelamento nem pedido). */
  linhas: string[];
  /** A decisão e a situação da devolução (`{decisao}` da mensagem "Cancelamento: decisão"). */
  decisao: string;
  /** Como o dinheiro volta (`{comovolta}`); null quando não há devolução. */
  comoVolta: string | null;
};

/** Os pedidos e a hora de Brasília (a política conta neste horário). */
const BRASILIA = "America/Sao_Paulo";
const diaMes = (d: Date, fuso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, day: "2-digit", month: "2-digit" }).format(d);
const diaHora = (d: Date, fuso: string) => `${diaMes(d, fuso)} às ${new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, hour: "2-digit", minute: "2-digit" }).format(d)}`;
const diaIso = (d: string) => d.slice(0, 10).split("-").reverse().slice(0, 2).join("/");
const quando = (d: Date | string | null): Date | null => {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  return Number.isNaN(x.getTime()) ? null : x;
};
const juntar = (...partes: (string | null | undefined)[]) => partes.filter((x): x is string => !!x && !!x.trim()).join(" ");
/** AAAA-MM-DD de um instante no fuso. */
const isoNoFuso = (d: Date, fuso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
/** "até dd/mm" ou, quando a política para o arrependimento na entrada e ela vem antes, "até a entrada, em dd/mm" (`fimDoArrependimento`). */
const ateOArrependimento = (ate: string, ateEntrada: boolean | null | undefined, entrada: string | null) => {
  const fim = fimDoArrependimento(ate, ateEntrada ?? null, entrada);
  return { fim, texto: fim.ateEntrada ? `até a entrada, em ${diaIso(fim.ate)}` : `até ${diaIso(fim.ate)}` };
};

/**
 * Como o dinheiro volta, pelas partes da devolução (a regra única do cancelamento e da alteração, `rotasDaDevolucao`):
 * todas por fora, a frase da transferência; pelo Mercado Pago, a do meio (as duas com Pix e cartão juntos); uma parte
 * por fora e outra pelo Mercado Pago, as frases de cada caminho. null sem frase.
 */
const comoVoltaODinheiro = (
  textos: Pick<TextosSite, "cancelamentoVoltaPix" | "cancelamentoVoltaCartao" | "cancelamentoVoltaPorFora">,
  r: { forma: "pix" | "cartao" | null; porFora: boolean; algumaPorFora: boolean },
): string | null => {
  if (r.porFora) return textos.cancelamentoVoltaPorFora || null;
  const peloMercadoPago = r.forma === "cartao" ? textos.cancelamentoVoltaCartao : r.forma === "pix" ? textos.cancelamentoVoltaPix : juntar(textos.cancelamentoVoltaPix, textos.cancelamentoVoltaCartao);
  return juntar(peloMercadoPago, r.algumaPorFora ? textos.cancelamentoVoltaPorFora : null) || null;
};

/**
 * O compositor único do texto do cancelamento (página da reserva e as variáveis `{decisao}` e `{comovolta}` das
 * mensagens). Puro: os fatos (código, datas, horas, versão da política, valores) são escritos aqui; as frases vêm de Textos
 * do site. Nunca cita o Beds24 nem dado pessoal. `fuso` = o do imóvel (o dia da devolução); os horários de pedido são de
 * Brasília, como a política conta.
 */
export function textoDoCancelamento(
  v: {
    estado: EstadoPagamentoHospede;
    reservaCodigo: string | null;
    cancelamento: CancelamentoParaHospede | CancelamentoDoHospede | null;
    pedidoCancelamentoEm?: Date | string | null;
    pedidoCancelamentoSemPolitica?: boolean;
  },
  textos: TextosDoCancelamento,
  fuso: string = BRASILIA,
): TextoDoCancelamento {
  const codigo = v.reservaCodigo ?? "";
  const c = v.cancelamento;
  if (!c || !estadoCancelada(v.estado)) {
    const pedido = quando(v.pedidoCancelamentoEm ?? null);
    if (!pedido) return { linhas: [], decisao: "", comoVolta: null };
    // Sem a política aceita, a frase editável (que cita a política) dá lugar à fixa: a equipe confirma o valor por escrito.
    const linha = juntar(`Pedido de cancelamento recebido em ${diaHora(pedido, BRASILIA)} (horário de Brasília).`, v.pedidoCancelamentoSemPolitica ? TEXTO_VALOR_PELA_EQUIPE : textos.cancelamentoPedidoRecebido);
    return { linhas: [linha], decisao: "", comoVolta: null };
  }
  const recebido = quando(c.recebidoEm)!;
  const entradaQuando = quando(c.entradaEm);
  const entradaDaEstadia = entradaQuando ? isoNoFuso(entradaQuando, BRASILIA) : null;
  const cabecalho =
    c.quemCancela === "empresa"
      ? `Nós cancelamos a sua reserva ${codigo}${c.motivoEmpresa === "imovel_sem_condicoes" ? ": o apartamento ficou sem condições de receber você" : c.motivoEmpresa === "forca_maior" ? " por motivo de força maior" : ""}.`
      : c.quemCancela === "nao_comparecimento"
        ? `A reserva ${codigo} foi cancelada por não comparecimento.`
        : `Reserva ${codigo} cancelada. Recebemos o seu pedido em ${diaHora(recebido, BRASILIA)} (horário de Brasília).`;
  const valor = c.valor ?? 0;
  const pelaPolitica = c.politicaVersao !== null && (c.base === "prazo" || c.base === "arrependimento" || c.base === "empresa");
  const decisoes: string[] = [];
  let comoVolta: string | null = null;
  // Cada parte volta pelo seu caminho (Pix, cartão ou por fora): as frases de todos os caminhos usados.
  const volta = comoVoltaODinheiro(textos, c);
  if (c.direito === "integral") {
    const quem = pelaPolitica ? `Pela Política de cancelamento que você aceitou (versão ${c.politicaVersao})` : "Por decisão da nossa equipe";
    decisoes.push(juntar(`${quem}, devolvemos o valor integral pago, ${formatBRL(valor)},`, textos.cancelamentoSemTaxas));
    const feitaEm = quando(c.devolucaoEm);
    if (v.estado === "cancelada_devolvida") {
      const dia = feitaEm ? ` em ${diaMes(feitaEm, fuso)}` : "";
      // Com alguma parte por fora, nunca "pelo Mercado Pago" para o total.
      if (c.porFora || c.algumaPorFora) decisoes.push(`Devolução de ${formatBRL(valor)} feita${dia}.`);
      else decisoes.push(c.confirmadaPor === "equipe" ? `Devolução de ${formatBRL(valor)} feita pelo Mercado Pago${dia}.` : `Devolução de ${formatBRL(c.valorConfirmado ?? valor)} confirmada pelo Mercado Pago${dia}.`);
      comoVolta = volta;
    } else if (v.estado === "cancelada_devolucao_pedida" && c.aguardandoLiberacao) {
      // M8.2d (D13): nada foi pedido ainda — a devolução sai quando o Mercado Pago liberar o pagamento (nunca "já pedimos").
      const prevista = c.aguardandoLiberacao.previstaEm ? ` (previsto para ${diaIso(c.aguardandoLiberacao.previstaEm)})` : "";
      decisoes.push(juntar(`Devolução de ${formatBRL(valor)}${prevista}.`, textos.devolucaoAguardaLiberacao ?? ""));
      comoVolta = volta;
    } else if (v.estado === "cancelada_devolucao_pedida") {
      decisoes.push(c.estornoPelaEquipe ? textos.cancelamentoEstornoNoCartao : textos.cancelamentoDevolucaoPedida);
      comoVolta = volta;
    } else if (v.estado === "cancelada_com_a_equipe") {
      decisoes.push(juntar(`A devolução de ${formatBRL(valor)} pelo Mercado Pago não foi possível.`, textos.cancelamentoComAEquipe));
    } else decisoes.push(textos.cancelamentoEmConferencia);
  } else if (c.base === "nao_comparecimento") decisoes.push(textos.cancelamentoSemDevolucaoNaoComparecimento);
  else if (c.base === "sem_politica" || !c.integralAte) decisoes.push(textos.cancelamentoSemDevolucaoEquipe);
  else if (pagaSemPrazoIntegral(c) && c.arrependimentoAte)
    // Paga já depois do prazo do reembolso integral: esse prazo nunca valeu para ela; só o arrependimento (que para na
    // entrada, quando a política aceita diz isso e a entrada vem antes).
    decisoes.push(
      juntar(`Esta reserva foi paga quando o prazo de reembolso integral já tinha passado. Arrependimento: ${ateOArrependimento(c.arrependimentoAte, c.arrependimentoAteEntrada, entradaDaEstadia).texto}.`, textos.cancelamentoSemDevolucaoPrazo),
    );
  else {
    const arr = c.arrependimentoAte ? ateOArrependimento(c.arrependimentoAte, c.arrependimentoAteEntrada, entradaDaEstadia) : null;
    const arrependimento = arr && arr.fim.ate > c.integralAte ? ` Arrependimento: ${arr.texto}.` : "";
    decisoes.push(juntar(`Prazo de reembolso integral: pedidos até ${diaIso(c.integralAte)}, às 23h59.${arrependimento}`, textos.cancelamentoSemDevolucaoPrazo));
  }
  const decisao = juntar(...decisoes);
  return { linhas: [cabecalho, ...decisoes, ...(comoVolta ? [comoVolta] : []), ...(textos.cancelamentoFecho ? [textos.cancelamentoFecho] : [])].filter((l) => l.trim()), decisao, comoVolta };
}

// ---------------------------------------------------------------- alteração da reserva paga (M8.2d)

/** As frases editáveis da alteração (Textos do site) e as do cancelamento que a devolução da diferença reusa. */
export type TextosDaAlteracao = Pick<
  TextosSite,
  | "alteracaoEmAndamento"
  | "alteracaoAguardaConfirmacao"
  | "alteracaoPolitica"
  | "alteracaoConfirmada"
  | "devolucaoAguardaLiberacao"
  | "alteracaoSemDevolucao"
  | "alteracaoNaoAplicada"
  | "alteracaoNaoVale"
  | "cancelamentoDevolucaoPedida"
  | "cancelamentoEstornoNoCartao"
  | "cancelamentoVoltaPix"
  | "cancelamentoVoltaCartao"
  | "cancelamentoVoltaPorFora"
  | "cancelamentoComAEquipe"
  | "cancelamentoEmConferencia"
>;

/** O texto da alteração em partes: as linhas da página, o que a variável `{alteracao}` leva e como o dinheiro volta. */
export type TextoDaAlteracao = { linhas: string[]; resumo: string; comoVolta: string | null };

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const noitesEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
/** "dd/mm–dd/mm (N noites, P pessoas)". */
const estadia = (e: { checkin: string; checkout: string; hospedes: number | null }) =>
  `${diaIso(e.checkin)}–${diaIso(e.checkout)} (${plural(noitesEntre(e.checkin, e.checkout), "noite", "noites")}${e.hospedes === null ? "" : `, ${plural(e.hospedes, "pessoa", "pessoas")}`})`;
const horaBrasilia = (d: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: BRASILIA, hour: "2-digit", minute: "2-digit" }).format(d);
/**
 * O prazo das datas seguradas: "HH:MM" quando acaba no dia em que a alteração foi preparada, senão "dd/mm às HH:MM" (o
 * prazo vai até 48 horas). Puro: o dia de referência é o da preparação, nunca o relógio de quem lê.
 */
const prazoBrasilia = (ate: Date, desde: Date | null) => (desde && diaMes(ate, BRASILIA) !== diaMes(desde, BRASILIA) ? `${diaMes(ate, BRASILIA)} às ${horaBrasilia(ate)}` : horaBrasilia(ate));

/** Por que a política devolve (ou não) a diferença, em palavras do hóspede (os fatos da decisão pela política). */
function porqueDaReducao(r: NonNullable<AlteracaoParaHospede["reducao"]> & { integralAte: string }, entradaDaPolitica: string): string {
  if (r.base === "arrependimento") {
    // A mesma regra da decisão: com a política parando na entrada, o direito acaba nela quando ela vem antes dos 7 dias.
    if (!r.arrependimentoAte) return "direito de arrependimento: até 7 dias depois do pagamento";
    const fim = fimDoArrependimento(r.arrependimentoAte, r.arrependimentoAteEntrada ?? null, r.entradaDaEstadia ?? null);
    return fim.ateEntrada ? `direito de arrependimento: até a entrada, em ${diaIso(fim.ate)}` : `direito de arrependimento: até ${diaIso(fim.ate)}, 7 dias depois do pagamento`;
  }
  return `o pedido chegou ${r.direito === "integral" ? "até" : "depois de"} ${diaIso(r.integralAte)}, 23h59, contando da entrada de ${diaIso(entradaDaPolitica)}`;
}

/**
 * A frase da decisão sobre a diferença: "Pela política" só quando foi a política que decidiu (o prazo, o arrependimento, o
 * pedido fora do prazo); a decisão da equipe (exceção, pagamento sem política aceita) e a alteração proposta por nós dizem
 * quem decidiu — o hóspede nunca lê que aceitou uma política que não aceitou.
 */
function fraseDaReducao(r: NonNullable<AlteracaoParaHospede["reducao"]>, entradaDaPolitica: string, diferenca: number): string {
  const resto = `a diferença de ${formatBRL(diferenca)} ${r.direito === "integral" ? "é devolvida" : "não é devolvida"}`;
  if (r.base === "empresa") return `Como a alteração é proposta por nós, ${resto}.`;
  if (r.base === "excecao" || r.base === "sem_politica" || !r.integralAte) return `Por decisão da nossa equipe, ${resto}.`;
  return `Pela política, ${resto} (${porqueDaReducao({ ...r, integralAte: r.integralAte }, entradaDaPolitica)}).`;
}

/**
 * O compositor único do texto da alteração (a página da reserva, a variável `{alteracao}` das mensagens e o botão "Copiar a
 * proposta" do painel). Puro: os fatos (código, datas, pessoas, valores, horas, versão da política) são escritos aqui; as
 * frases vêm de Textos do site. Nunca cita o Beds24 nem dado pessoal. `fuso` = o do imóvel (o dia da devolução); o prazo
 * das datas seguradas sai no horário de Brasília.
 */
export function textoDaAlteracao(a: AlteracaoParaHospede | AlteracaoDoHospede, textos: TextosDaAlteracao, codigo: string, fuso: string = BRASILIA): TextoDaAlteracao {
  const linhas: string[] = [];
  let comoVolta: string | null = null;
  // A linha da política vale sempre (§8.2): a versão aceita no pagamento da reserva e a entrada de que os prazos contam agora.
  // Sem política aceita no pagamento, nenhuma linha dela (a frase editável diz "a que você aceitou ao pagar").
  const politica =
    a.politicaVersao !== null ? juntar(`Versão ${a.politicaVersao} da Política de cancelamento, aceita no pagamento da reserva; prazos contados da entrada de ${diaIso(a.entradaDosPrazos)}.`, textos.alteracaoPolitica) : "";
  if (a.situacao === "segurada") {
    const ate = quando(a.holdAte);
    const diferenca = a.rumo === "aumento" ? ` — diferença de ${formatBRL(a.diferenca)}` : a.rumo === "reducao" ? ` — diferença de ${formatBRL(-a.diferenca)}` : "";
    linhas.push(
      juntar(
        `Alteração da reserva ${codigo}: de ${estadia(a.antes)} para ${estadia(a.depois)}.`,
        a.rumo === "igual" ? `Valor: o mesmo (${formatBRL(a.antes.valor)}).` : `Valor: de ${formatBRL(a.antes.valor)} para ${formatBRL(a.depois.valor)}${diferenca}.`,
        ate ? `Datas seguradas até ${prazoBrasilia(ate, quando(a.preparadaEm))} (horário de Brasília).` : null,
        a.rumo === "aumento" ? textos.alteracaoEmAndamento : textos.alteracaoAguardaConfirmacao,
      ),
    );
    if (a.rumo === "reducao" && a.reducao) linhas.push(fraseDaReducao(a.reducao, a.entradaDaPolitica, -a.diferenca));
  } else if (a.situacao === "aplicada") {
    const em = quando(a.aplicadaEm);
    linhas.push(juntar(`Alteração confirmada${em ? ` em ${diaMes(em, fuso)}` : ""}: ${diaIso(a.depois.checkin)}–${diaIso(a.depois.checkout)}, ${plural(a.depois.hospedes, "pessoa", "pessoas")}, ${formatBRL(a.valorNovo)}.`, textos.alteracaoConfirmada));
    const d = a.devolucao;
    if (a.rumo === "reducao" && a.reducao?.direito === "nenhum")
      linhas.push(juntar(fraseDaReducao(a.reducao, a.entradaDaPolitica, -a.diferenca), textos.alteracaoSemDevolucao));
    else if (d) {
      // A mesma regra do cancelamento: cada parte pelo seu caminho (Pix, cartão ou por fora).
      const volta = comoVoltaODinheiro(textos, d);
      if (d.estado === "aguardando_liberacao") {
        // Nada foi pedido ainda (D13): a devolução sai quando o Mercado Pago liberar o pagamento — nunca "já pedimos".
        linhas.push(juntar(`Devolução da diferença: ${formatBRL(d.valor)}${d.previstaEm ? ` (previsto para ${diaIso(d.previstaEm)})` : ""}.`, textos.devolucaoAguardaLiberacao));
        comoVolta = volta;
      } else if (d.estado === "feita") {
        const feitaEm = quando(d.em);
        linhas.push(`Devolução da diferença de ${formatBRL(d.valorConfirmado ?? d.valor)} feita${feitaEm ? ` em ${diaMes(feitaEm, fuso)}` : ""}.`);
        comoVolta = volta;
      } else if (d.estado === "pedida") {
        // O cartão com mais de 78 dias: a equipe faz o estorno no painel do Mercado Pago (o sistema nunca pediu) — nunca "já pedimos".
        linhas.push(juntar(`Devolução da diferença: ${formatBRL(d.valor)}.`, d.estornoPelaEquipe ? textos.cancelamentoEstornoNoCartao : textos.cancelamentoDevolucaoPedida));
        comoVolta = volta;
      } else if (d.estado === "com_a_equipe") linhas.push(juntar(`Devolução da diferença: ${formatBRL(d.valor)}. A devolução pelo Mercado Pago não foi possível.`, textos.cancelamentoComAEquipe));
      else linhas.push(juntar(`Devolução da diferença: ${formatBRL(d.valor)}.`, textos.cancelamentoEmConferencia));
      if (comoVolta) linhas.push(comoVolta);
    }
  } else if (a.situacao === "nao_aplicada") {
    const paga = a.pagoSemAlteracao;
    const em = quando(paga?.em ?? null);
    linhas.push(juntar(`Recebemos o pagamento da diferença (${formatBRL(paga?.valor ?? a.diferenca)})${em ? ` em ${diaMes(em, fuso)}` : ""}.`, textos.alteracaoNaoAplicada));
  } else {
    const em = quando(a.preparadaEm);
    linhas.push(juntar(`A alteração preparada${em ? ` em ${diaMes(em, fuso)}` : ""} não vale mais.`, textos.alteracaoNaoVale));
  }
  if (politica) linhas.push(politica);
  const limpas = linhas.filter((l) => l.trim());
  return { linhas: limpas, resumo: limpas.join(" "), comoVolta };
}
