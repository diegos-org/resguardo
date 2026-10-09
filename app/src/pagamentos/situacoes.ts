/**
 * Pagamento no site (M8.2a) — situações locais, transições e textos de lista fechada. Puro: nada de banco nem
 * de provedor. A situação de uma tentativa só muda por uma leitura do provedor (nunca pelo relógio), e só pelas
 * transições abaixo: dinheiro vence ausência de dinheiro, e o desconhecido nunca sobrescreve o conhecido.
 */
import type { DesfechoPagamento, SituacaoPagamento } from "@/db/schema";
import type { SituacaoCobranca } from "./provedor";

export type { DesfechoPagamento, SituacaoPagamento };

/** Tentativas ainda sem resposta final do provedor: seguram as datas (com a carência) e travam ações da equipe. */
export const SITUACOES_EM_ANDAMENTO = ["criando", "incerta", "pendente"] as const satisfies readonly SituacaoPagamento[];
/** O dinheiro entrou (mesmo que depois volte em parte ou seja contestado). */
export const SITUACOES_COM_DINHEIRO = ["aprovado", "devolvido_parcial", "devolvido", "contestado"] as const satisfies readonly SituacaoPagamento[];

export const emAndamento = (s: SituacaoPagamento) => (SITUACOES_EM_ANDAMENTO as readonly string[]).includes(s);
export const comDinheiro = (s: SituacaoPagamento) => (SITUACOES_COM_DINHEIRO as readonly string[]).includes(s);

/** Situação do provedor → situação local; null = desconhecida (vira aviso, nunca palpite). Pix "em análise" segue pendente. */
export function situacaoLocal(s: SituacaoCobranca): SituacaoPagamento | null {
  switch (s) {
    case "pendente":
    case "em_analise":
      return "pendente";
    case "aprovado":
    case "recusado":
    case "cancelado":
    case "expirado":
    case "devolvido":
    case "devolvido_parcial":
    case "contestado":
      return s;
    default:
      return null;
  }
}

const DEPOIS_DO_DINHEIRO: readonly SituacaoPagamento[] = ["aprovado", "devolvido_parcial", "devolvido", "contestado"];

/**
 * A leitura do provedor pode levar a tentativa de `de` para `para`? `criando`/`incerta` → qualquer;
 * `pendente` → qualquer outra; recusado, cancelado e expirado → só aprovado ou depois; aprovado →
 * devolvido_parcial, devolvido ou contestado; devolvido_parcial → devolvido ou contestado. Leitura "anterior"
 * (ex.: aprovado → pendente) é ignorada.
 */
export function transicaoPermitida(de: SituacaoPagamento, para: SituacaoPagamento): boolean {
  if (de === para || para === "criando" || para === "incerta") return false;
  switch (de) {
    case "criando":
    case "incerta":
    case "pendente":
      return true;
    case "recusado":
    case "cancelado":
    case "expirado":
      return DEPOIS_DO_DINHEIRO.includes(para);
    case "aprovado":
      return para === "devolvido_parcial" || para === "devolvido" || para === "contestado";
    case "devolvido_parcial":
      return para === "devolvido" || para === "contestado";
    default:
      return false;
  }
}

export const NOMES_SITUACAO_PAGAMENTO: Record<SituacaoPagamento, string> = {
  criando: "Criando",
  incerta: "Conferindo no Mercado Pago",
  pendente: "Aguardando pagamento",
  aprovado: "Aprovado",
  recusado: "Recusado",
  cancelado: "Cancelado",
  expirado: "Vencido",
  devolvido: "Devolvido",
  devolvido_parcial: "Devolvido em parte",
  contestado: "Contestado",
};

export const NOMES_DESFECHO: Record<DesfechoPagamento, string> = {
  reserva: "Confirmou a reserva",
  devolucao: "Devolvido pelo Mercado Pago",
  por_fora: "Devolvido por fora",
};

/** Por que um pagamento aprovado ficou sem reserva (código gravado; "conflito:SCL-…" leva o código da outra reserva). */
export const MOTIVOS_SEM_RESERVA = {
  conflito: "As noites ficaram ocupadas por outra reserva ou bloqueio.",
  noites_ocupadas: "Aprovado depois do prazo, com as noites já ocupadas.",
  sem_leitura: "Aprovado depois do prazo, sem leitura atual do Beds24 para conferir as noites.",
  cancelada_pela_equipe: "O pedido foi cancelado pela equipe antes da aprovação.",
  valor_divergente: "O valor aprovado é diferente do total da cotação.",
  outra_tentativa: "Outro pagamento desta cotação já confirmou a reserva (pagamento em dobro).",
  recebimento_manual: "A reserva já tinha sido confirmada pela equipe, com recebimento registrado à mão.",
  ao_vivo: "O Mercado Pago informou um pagamento real (live_mode) no ambiente de teste.",
  outro: "A reserva não estava numa situação que permitisse confirmar pelo pagamento.",
} as const;
export type MotivoSemReserva = keyof typeof MOTIVOS_SEM_RESERVA;

export const codigoMotivo = (m: string | null): MotivoSemReserva | null => {
  if (!m) return null;
  const c = m.split(":")[0];
  return c in MOTIVOS_SEM_RESERVA ? (c as MotivoSemReserva) : "outro";
};

/** Texto do motivo para o painel (nunca para o hóspede). */
export function textoMotivoSemReserva(m: string | null): string | null {
  const c = codigoMotivo(m);
  if (!c) return null;
  const outra = m!.includes(":") ? m!.slice(m!.indexOf(":") + 1) : "";
  const quem = outra === "bloqueio" ? "por um bloqueio" : outra === "agenda_externa" ? "pela agenda lida do Beds24" : outra ? `pela reserva ${outra}` : "";
  if (!quem) return MOTIVOS_SEM_RESERVA[c];
  if (c === "conflito") return `As noites ficaram ocupadas ${quem}.`;
  if (c === "noites_ocupadas") return `Aprovado depois do prazo, com as noites já ocupadas ${quem}.`;
  return MOTIVOS_SEM_RESERVA[c];
}

/** Avisos de uma tentativa (códigos gravados em `pagamentos.avisos`), em linguagem simples para o painel. */
export const AVISOS_PAGAMENTO = {
  situacao_desconhecida: "O Mercado Pago informou uma situação que o sistema não conhece: confira no painel do Mercado Pago.",
  order_nao_encontrada: "O Mercado Pago não encontrou mais este pagamento: confira no painel do Mercado Pago.",
  referencia_divergente: "A resposta do Mercado Pago não bate com este pagamento (referência ou identificação diferentes): nada foi aplicado.",
  taxa_invalida: "A taxa ou o líquido informados não fecham com o valor (taxa negativa ou líquido maior que o valor): nada foi gravado.",
  taxa_divergente: "O Mercado Pago informou uma taxa diferente da já registrada: confira.",
  liberacao_divergente: "O Mercado Pago confirmou a liberação com data ou valor diferentes do registrado à mão: confira e corrija pelo quadro do pagamento.",
  liberacao_futura: "O Mercado Pago marcou o dinheiro como liberado, mas com data futura: nada foi lançado.",
  devolvido_por_fora: "Este pagamento foi devolvido (no todo ou em parte) fora do sistema: confira a reserva.",
  contestado: "O pagamento foi contestado pelo pagador: confira a reserva.",
  ao_vivo: "O Mercado Pago marcou este pagamento como real (live_mode) no ambiente de teste.",
  taxa_perdida_desconhecida: "Devolução confirmada, mas o Mercado Pago não informou quanto da taxa ficou com ele: a despesa não foi lançada.",
  devolucao_falhou: "A devolução pelo Mercado Pago falhou três vezes: tente de novo ou registre a devolução feita por fora.",
  cancelamento_pendente: "Não deu para cancelar no Mercado Pago um Pix que ficou sobrando: a rotina tenta de novo.",
} as const;
export type CodigoAviso = keyof typeof AVISOS_PAGAMENTO;

export const textosDosAvisos = (codigos: readonly string[]) => codigos.filter((c): c is CodigoAviso => c in AVISOS_PAGAMENTO).map((c) => AVISOS_PAGAMENTO[c]);
