/**
 * Pagamento no site (M8.2a) — o que a página da cotação recebe sobre o pagamento, já pronto para o navegador:
 * datas em texto ISO, imagem do QR como endereço `data:` conferido e link do Pix só se for https. Puro (sem banco):
 * o servidor monta, o componente do navegador e a rota de acompanhamento usam. Nada pessoal: a vista do domínio
 * não tem nenhum dado do hóspede, e o QR só vem quando quem chama tem a autorização do pedido.
 */
import type { EstadoPagamentoHospede, VistaPagamentoHospede } from "@/pagamentos/consultas";

export type { EstadoPagamentoHospede };

export type PagamentoDoHospede = {
  estado: EstadoPagamentoHospede;
  ambienteTeste: boolean;
  dinheiroSemDesfecho: boolean;
  /** Prazo das datas, quando seguradas (ISO). */
  holdAte: string | null;
  /** Pix aguardando — só com a autorização do pedido. */
  pix: { copiaECola: string; imagem: string | null; link: string | null; expiraEm: string | null } | null;
  pixRestantes: number;
  /** "Gerar outro Pix" só quando o site ainda oferece o Pix nesta cotação (a oferta conferida agora). */
  podeGerar: boolean;
  reservaCodigo: string | null;
  pagamentoEmDobro: boolean;
  devolucao: { situacao: "pedida" | "feita"; em: string | null } | null;
  /** Alguma tentativa ainda pode virar dinheiro: a página acompanha mesmo fora das situações de espera. */
  acompanhar: boolean;
};

/** Situações em que a página acompanha sozinha (consulta a rota a cada poucos segundos). */
export const ESTADOS_EM_ESPERA: readonly EstadoPagamentoHospede[] = ["pix_aguardando", "pix_vencido", "verificando", "confirmando"];
export const emEspera = (e: EstadoPagamentoHospede) => ESTADOS_EM_ESPERA.includes(e);
/** A página continua acompanhando: situação de espera, ou tentativa que ainda pode virar dinheiro (ex.: Pix esgotado). */
export const deveAcompanhar = (v: { estado: EstadoPagamentoHospede; acompanhar?: boolean }) => emEspera(v.estado) || v.acompanhar === true;

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
};

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
  };
}

/**
 * Mensagem para a equipe (WhatsApp ou e-mail) numa situação do pagamento: as duas primeiras linhas da mensagem da
 * cotação (código, imóvel, datas e valor) e uma linha sobre o pagamento. Datas seguradas: a mensagem de sempre.
 */
export function mensagemDoContato(textoDaCotacao: string, estado: EstadoPagamentoHospede, reservaCodigo: string | null): string {
  const linha: Partial<Record<EstadoPagamentoHospede, string>> = {
    verificando: "Fiz o pagamento por Pix e a página ainda está conferindo.",
    confirmando: "Fiz o pagamento por Pix e a página ainda está confirmando a reserva.",
    confirmada: reservaCodigo ? `Paguei pelo Pix e minha reserva é a ${reservaCodigo}.` : "Paguei pelo Pix e a página diz que a reserva foi confirmada.",
    aprovado_sem_datas: "Paguei pelo Pix, mas a página diz que não deu para garantir as datas.",
    devolucao_pedida: "Quero saber da devolução do meu pagamento pelo Pix.",
    devolvido: "Quero falar sobre a devolução do meu pagamento pelo Pix.",
  };
  const extra = linha[estado];
  return extra ? [...textoDaCotacao.split("\n").slice(0, 2), extra].join("\n") : textoDaCotacao;
}
