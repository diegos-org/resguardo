/**
 * Pagamento no site (M8.2a) — o que a página da cotação recebe sobre o pagamento, já pronto para o navegador:
 * datas em texto ISO, imagem do QR como endereço `data:` conferido e link do Pix só se for https. Puro (sem banco):
 * o servidor monta, o componente do navegador e a rota de acompanhamento usam. Nada pessoal: a vista do domínio
 * não tem nenhum dado do hóspede, e o QR só vem quando quem chama tem a autorização do pedido.
 *
 * Cartão (M8.2b): o formulário do cartão (chave pública, valor, parcelas) e o endereço do desafio do banco também só
 * com a autorização; a recusa é sempre o mesmo texto (o motivo nunca chega ao navegador).
 */
import type { EstadoPagamentoHospede, VistaPagamentoHospede } from "@/pagamentos/consultas";
import { urlDoDesafio } from "@/pagamentos/provedor";

export type { EstadoPagamentoHospede };

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
/** A página continua acompanhando: situação de espera, ou tentativa que ainda pode virar dinheiro (ex.: Pix esgotado). */
export const deveAcompanhar = (v: { estado: EstadoPagamentoHospede; acompanhar?: boolean }) => emEspera(v.estado) || v.acompanhar === true;
/**
 * Situações em que o dinheiro já chegou (ou voltou): a página recarrega na hora, mesmo com o formulário do cartão aberto
 * (o hóspede nunca digita um cartão para uma cotação já paga).
 */
export const ESTADOS_COM_DINHEIRO: readonly EstadoPagamentoHospede[] = ["confirmando", "confirmada", "aprovado_sem_datas", "devolucao_pedida", "devolvido"];

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
};

/** Situações em que falar com a equipe é o caminho principal (não há pagamento a fazer na página). */
const CONTATO_PRINCIPAL: readonly EstadoPagamentoHospede[] = ["aprovado_sem_datas", "devolucao_pedida", "devolvido", "cartao_em_analise"];
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
  const extra = linha[estado];
  return extra ? [...textoDaCotacao.split("\n").slice(0, 2), extra].join("\n") : textoDaCotacao;
}
