/**
 * Horários e regras de convivência da casa (M7.20), num lugar só: a página da casa (que junta a estadia mínima à parte) e a
 * página da cotação leem daqui, com os dados da ficha do imóvel (Imóveis → ficha → Detalhes). Sem dependência de servidor.
 */
import type { EstadoCotacao } from "@/db/schema";
import type { EstadoPagamentoHospede } from "@/pagamentos/consultas";

/**
 * Horários da casa sem horário na ficha (entrada às 15:00, saída às 11:00): o padrão único do sistema. O cadastro (ficha
 * vazia e campo de hora em branco), a política de cancelamento, a página da casa, a cotação, Minha reserva e as mensagens
 * ao hóspede leem daqui; o padrão da coluna no banco (migração) é conferido contra este por teste.
 */
export const HORARIOS_PADRAO = { entrada: "15:00", saida: "11:00" } as const;

/** Título fixo da parte das regras, como os outros títulos da ficha da casa ("O que você encontra", "Camas"). */
export const TITULO_REGRAS_DA_CASA = "Regras da casa";

/** O que a ficha do imóvel guarda sobre as regras; null = a casa não tem ficha (leitura com leftJoin). */
export type FichaDasRegras = {
  checkinAPartirDe: string | null;
  checkoutAte: string | null;
  aceitaAnimais: boolean | null;
  permiteFumar: boolean | null;
  permiteFestas: boolean | null;
  regrasCasa: string | null;
};

export type RegrasDaCasa = {
  /** "HH:MM" no fuso do imóvel. */
  entrada: string;
  saida: string;
  /** Animais, fumo e festas, na ordem da página da casa (fumar e festas liberados não aparecem). */
  convivencia: string[];
  /** O texto livre das regras da ficha; vazio = nada. */
  texto: string;
};

export function regrasDaCasa(f: FichaDasRegras): RegrasDaCasa {
  return {
    entrada: f.checkinAPartirDe ?? HORARIOS_PADRAO.entrada,
    saida: f.checkoutAte ?? HORARIOS_PADRAO.saida,
    convivencia: [f.aceitaAnimais ? "Aceita animais" : "Não aceita animais", f.permiteFumar ? null : "Proibido fumar", f.permiteFestas ? null : "Sem festas ou eventos"].filter((x): x is string => !!x),
    texto: f.regrasCasa ?? "",
  };
}

/**
 * As frases dos horários, as mesmas nas duas páginas: "Entrada a partir das …" e "Saída até as …". `hora` escreve a hora:
 * a página da casa usa como está ("15:00"); a cotação, como Minha reserva ("15h", `escreverHora`).
 */
export function frasesDosHorarios(r: Pick<RegrasDaCasa, "entrada" | "saida">, hora: (h: string) => string = (h) => h): [string, string] {
  return [`Entrada a partir das ${hora(r.entrada)}`, `Saída até as ${hora(r.saida)}`];
}

/**
 * Com um pagamento, se a estadia segue de pé (true: os horários e as regras aparecem): pagamento oferecido (datas
 * seguradas), em andamento (Pix aguardando, conferência, banco, análise) ou a reserva confirmada. Pagamento sem as datas,
 * devolução e reserva cancelada: não. Um mapa com todas as situações, para um estado novo do pagamento exigir a decisão
 * aqui (o typecheck reclama) em vez de esconder as regras sem aviso.
 */
export const MOSTRA_REGRAS_NO_PAGAMENTO: Record<Exclude<EstadoPagamentoHospede, "sem_pagamento">, boolean> = {
  pagar: true,
  pix_aguardando: true,
  pix_vencido: true,
  pix_esgotado: true,
  verificando: true,
  confirmando: true,
  cartao_desafio: true,
  cartao_em_analise: true,
  cartao_recusado: true,
  confirmada: true,
  aprovado_sem_datas: false,
  devolucao_pedida: false,
  devolvido: false,
  cancelada_devolucao_pedida: false,
  cancelada_devolvida: false,
  cancelada_com_a_equipe: false,
  cancelada_em_conferencia: false,
  cancelada_sem_devolucao: false,
};

/**
 * A página da cotação mostra os horários e as regras da casa? Na cotação aberta e válida, na segurada, com pagamento oferecido
 * ou em andamento, e na reserva feita; não na que expirou, foi cancelada ou mudou (a estadia cotada não vale mais), nem na
 * reserva feita que depois foi cancelada (a equipe confirmou sem pagamento no site e cancelou depois, ou veio cancelada da
 * sincronização: a cotação continua "convertida"). Com pagamento, a situação dele manda (como no resto da página).
 */
export function regrasNaCotacao(v: { estado: EstadoCotacao; mudou: boolean; reserva: { estado: string } | null }, pagamento: EstadoPagamentoHospede | null): boolean {
  if (pagamento && pagamento !== "sem_pagamento") return MOSTRA_REGRAS_NO_PAGAMENTO[pagamento];
  if (v.estado === "aberta") return !v.mudou;
  if (v.estado === "convertida") return v.reserva?.estado !== "cancelada";
  return v.estado === "segurada";
}
