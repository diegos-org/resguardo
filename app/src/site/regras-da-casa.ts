/**
 * Horários e regras de convivência da casa (M7.20), num lugar só: a página da casa (que junta a estadia mínima à parte) e a
 * página da cotação leem daqui, com os dados da ficha do imóvel (Imóveis → ficha → Detalhes). Sem dependência de servidor.
 */
import type { EstadoCotacao } from "@/db/schema";
import type { EstadoPagamentoHospede } from "@/pagamentos/consultas";

/** Horários da casa sem ficha preenchida: os mesmos do cadastro (entrada às 15:00, saída às 11:00). */
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
 * Situações do pagamento em que a estadia segue de pé: pagamento oferecido (datas seguradas), em andamento (Pix aguardando,
 * conferência, banco, análise) ou a reserva confirmada. Fora delas (pagamento sem datas, devolução, reserva cancelada), os
 * horários e as regras não aparecem.
 */
const PAGAMENTO_COM_ESTADIA: readonly EstadoPagamentoHospede[] = [
  "pagar",
  "pix_aguardando",
  "pix_vencido",
  "pix_esgotado",
  "verificando",
  "confirmando",
  "cartao_desafio",
  "cartao_em_analise",
  "cartao_recusado",
  "confirmada",
];

/**
 * A página da cotação mostra os horários e as regras da casa? Na cotação aberta e válida, na segurada, com pagamento oferecido
 * ou em andamento, e na reserva feita; não na que expirou, foi cancelada ou mudou (a estadia cotada não vale mais). Com
 * pagamento, a situação dele manda (como no resto da página).
 */
export function regrasNaCotacao(v: { estado: EstadoCotacao; mudou: boolean }, pagamento: EstadoPagamentoHospede | null): boolean {
  if (pagamento && pagamento !== "sem_pagamento") return PAGAMENTO_COM_ESTADIA.includes(pagamento);
  if (v.estado === "aberta") return !v.mudou;
  return v.estado === "segurada" || v.estado === "convertida";
}
