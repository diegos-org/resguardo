/**
 * Pagamento no site (M8.2a) — situações locais, transições e textos de lista fechada. Puro: nada de banco nem
 * de provedor. A situação de uma tentativa só muda por uma leitura do provedor (nunca pelo relógio), e só pelas
 * transições abaixo: dinheiro vence ausência de dinheiro, e o desconhecido nunca sobrescreve o conhecido.
 */
import type { DesfechoPagamento, SituacaoPagamento } from "@/db/schema";
import { formatBRL } from "@/lib/money";
import type { SituacaoCobranca } from "./provedor";

export type { DesfechoPagamento, SituacaoPagamento };
export { CODIGOS_FALHA_DO_PROVEDOR, CODIGOS_TOKEN } from "./provedor";

/** Recusas ou respostas incertas do provedor até a devolução ficar "recusada" (sempre depois de reler a order sem sinal de devolução). */
export const MAXIMO_FALHAS_DEVOLUCAO = 3;
/**
 * Origens de devolução que esta versão sabe tratar (M8.2c; o M8.2d acrescenta `alteracao`). Um banco de prévia
 * compartilhado pode ter linhas de uma versão mais nova: a rotina, o pedido ao provedor e a leitura ignoram essas linhas.
 */
export const ORIGENS_DEVOLUCAO_CONHECIDAS = ["sem_reserva", "cancelamento", "alteracao"] as const;
export const origemDeDevolucaoConhecida = (origem: string) => (ORIGENS_DEVOLUCAO_CONHECIDAS as readonly string[]).includes(origem);

/** Tentativas ainda sem resposta final do provedor: seguram as datas (com a carência) e travam ações da equipe. */
export const SITUACOES_EM_ANDAMENTO = ["criando", "incerta", "pendente"] as const satisfies readonly SituacaoPagamento[];
/** O dinheiro entrou (mesmo que depois volte em parte ou seja contestado). */
export const SITUACOES_COM_DINHEIRO = ["aprovado", "devolvido_parcial", "devolvido", "contestado"] as const satisfies readonly SituacaoPagamento[];

export const emAndamento = (s: SituacaoPagamento) => (SITUACOES_EM_ANDAMENTO as readonly string[]).includes(s);
export const comDinheiro = (s: SituacaoPagamento) => (SITUACOES_COM_DINHEIRO as readonly string[]).includes(s);

/**
 * Situação do provedor → situação local; null = desconhecida (vira aviso, nunca palpite). "Em análise" (Pix ou cartão)
 * segue pendente; no cartão, a etapa (desafio, análise ou processando) vai em `pagamentos.etapa_cartao` (M8.2b).
 */
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
  alteracao: "Diferença de uma alteração da reserva",
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
  recebimento_manual: "A reserva já tinha recebimento registrado à mão pela equipe: o pagamento do site não se liga a ela.",
  ao_vivo: "O Mercado Pago informou um pagamento real (live_mode) no ambiente de teste.",
  situacao_inesperada: "O Mercado Pago mostrou o pagamento já devolvido (no todo ou em parte) ou contestado antes de o sistema decidir a reserva.",
  // Pagamento da diferença de uma alteração (M8.2d) que não pôde aplicar a alteração: vai para "Devolver ao hóspede".
  alteracao_noites_ocupadas: "Diferença de uma alteração aprovada depois do prazo, com as novas noites já ocupadas: a reserva continua como estava.",
  alteracao_sem_leitura: "Diferença de uma alteração aprovada depois do prazo, sem leitura atual do Beds24 para conferir as novas noites: a reserva continua como estava.",
  alteracao_desistida: "A alteração foi desfeita pela equipe antes da aprovação da diferença: a reserva continua como estava.",
  alteracao_reserva_mudou: "A reserva mudou (cancelada, com pedido de cancelamento ou alterada de outro jeito) antes da aprovação da diferença.",
  alteracao_nao_aplicada: "A alteração não pôde ser aplicada na aprovação da diferença: a reserva continua como estava.",
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
  if (c === "alteracao_noites_ocupadas") return `Diferença de uma alteração aprovada depois do prazo, com as novas noites já ocupadas ${quem}: a reserva continua como estava.`;
  return MOTIVOS_SEM_RESERVA[c];
}

/** Avisos de uma tentativa (códigos gravados em `pagamentos.avisos`), em linguagem simples para o painel. */
export const AVISOS_PAGAMENTO = {
  situacao_desconhecida: "O Mercado Pago informou uma situação que o sistema não conhece: confira no painel do Mercado Pago.",
  order_nao_encontrada: "O Mercado Pago não encontrou mais este pagamento: confira no painel do Mercado Pago.",
  referencia_divergente: "A resposta do Mercado Pago não bate com este pagamento (referência ou identificação diferentes): nada foi aplicado.",
  taxa_invalida: "A taxa ou o líquido informados não fecham com o valor (taxa negativa ou líquido maior que o valor): nada foi gravado.",
  taxa_divergente: "O Mercado Pago informou um líquido diferente do que já entrou como recebimento: nada foi mudado. Confira no Mercado Pago.",
  liberacao_divergente: "O Mercado Pago confirmou a liberação com um valor diferente do recebimento registrado: nada foi mudado. Confira no Mercado Pago; se o registrado à mão estiver errado, estorne e registre de novo pelo quadro do pagamento.",
  liberacao_futura: "O Mercado Pago marcou o dinheiro como liberado, mas com data futura: nada foi lançado.",
  liberacao_sem_valor: "O Mercado Pago marcou o dinheiro como liberado sem informar o líquido: nada foi lançado. Confira no Mercado Pago e, se o dinheiro caiu, registre a liberação à mão.",
  devolvido_por_fora:
    "O Mercado Pago mostra este pagamento devolvido fora do sistema: a parte do proprietário desta reserva ficou em conferência (não é repassada). Cancele a reserva pela política (devolução integral) ou registre um ajuste e dê a conferência por resolvida.",
  devolucao_em_dobro: "O Mercado Pago mostra este pagamento como devolvido, e a devolução também foi registrada como feita por fora: o hóspede pode ter recebido duas vezes. Confira no Mercado Pago e fale com o hóspede.",
  situacao_inesperada: "O Mercado Pago mostrou este pagamento já devolvido (no todo ou em parte) ou contestado antes de o sistema decidir a reserva: nada foi confirmado. O que falta resolver se resolve pelo painel do Mercado Pago (a devolução de parte do valor pelo sistema chega no M8.2d).",
  contestado: "O pagamento foi contestado pelo pagador: confira a reserva.",
  ao_vivo: "O Mercado Pago marcou este pagamento como real (live_mode) no ambiente de teste.",
  pix_sem_prazo: "O Mercado Pago não informou até quando este Pix vale: confira no painel do Mercado Pago.",
  taxa_perdida_desconhecida: "Devolução confirmada: falta saber quanto da taxa o Mercado Pago não devolveu. Confira no Mercado Pago e use \"Registrar taxa que não voltou\" no quadro do pagamento (zero se voltou toda).",
  devolucao_falhou: "O Mercado Pago recusou ou não respondeu três vezes: confira no painel do Mercado Pago antes de tentar de novo ou de registrar a devolução feita por fora.",
  devolucao_parada: "O Mercado Pago não mostra este pagamento como aprovado e inteiro (devolvido em parte, contestado ou em outra situação): a devolução pelo sistema parou (devolver o valor inteiro agora poderia devolver a mais). Confira no painel do Mercado Pago; a devolução de parte do valor pelo sistema chega no M8.2d.",
  devolucao_sem_confirmacao:
    "O Mercado Pago aceitou a devolução, mas o pagamento ainda não aparece como devolvido: confira no painel do Mercado Pago. O sistema não pede de novo (poderia devolver duas vezes) e confirma sozinho quando a devolução aparecer. Se o painel do Mercado Pago mostrar a devolução concluída, use \"Confirmar devolução feita no painel do Mercado Pago\"; se mostrar recusada, use Conferir agora e, se a devolução continuar pedida aqui, \"Registrar que o Mercado Pago recusou a devolução no painel\".",
  andamento_fora_do_prazo: "Este pagamento ficou em andamento por mais de 85 dias e o Mercado Pago só deixa consultar pagamentos de até três meses: o sistema parou de conferir. Confira no painel do Mercado Pago: se o pagamento foi aprovado, fale com o hóspede e registre o que aconteceu com um ajuste.",
  devolucao_fora_do_prazo:
    "A devolução não é mais pedida pelo sistema: o pagamento tem mais de 78 dias e o Mercado Pago só deixa consultar pagamentos de até três meses. No cartão, devolva pelo painel do Mercado Pago: até os 85 dias, a leitura do sistema confirma (use Conferir agora); depois, use \"Confirmar devolução feita no painel do Mercado Pago\" (se o painel recusar, registre a recusa). No Pix, faça a devolução por fora. Uma devolução pedida que ficou sem resposta pode ser parada com \"Parar a devolução pedida\".",
  cancelamento_pendente: "Não deu para cancelar no Mercado Pago um pagamento que ficou sobrando: use Conferir agora para tentar de novo (no teste, nada é conferido sozinho).",
  parcelas_sem_juros:
    "O parcelamento saiu sem acréscimo para o hóspede: o Mercado Pago cobrou da SCL o custo das parcelas. A taxa não foi lançada sozinha: decida quem paga esse custo e registre a liberação à mão. Para não acontecer de novo, desligue o \"parcelamento sem acréscimo\" no Mercado Pago.",
  custo_parcelas_desconhecido:
    "Pagamento parcelado: o Mercado Pago informou o líquido, mas não se cobrou da SCL algum custo das parcelas. A taxa não foi lançada sozinha (o sistema nunca supõe que não houve custo) e o sistema confere de novo; se continuar assim, confira no Mercado Pago e registre a liberação à mão.",
  liberacao_em_parcelas:
    "O Mercado Pago libera este pagamento parcela a parcela: nada foi lançado sozinho. Registre a liberação à mão quando o valor inteiro cair (ou cada parte, conforme o extrato do Mercado Pago).",
  desafio_sem_url: "O Mercado Pago pediu a verificação do banco, mas não mandou um endereço válido para ela: o pagamento foi cancelado.",
  outra_reserva_mesmo_email:
    "Este pagamento confirmou a reserva depois que o mesmo e-mail já tinha outra reserva confirmada pelo site: o hóspede pode ter pago duas vezes. Confira com ele.",
  // Cancelamento pela política (M8.2c). O quadro do pagamento troca este texto pelo com os valores (`textoDevolucaoAMenor`).
  devolucao_a_menor:
    "O Mercado Pago devolveu menos do que foi pedido neste cancelamento: confira no painel do Mercado Pago. Se o restante sair por lá, confirme a devolução; senão, a devolução da diferença chega com o M8.2d (ou registre um ajuste).",
  devolucao_data_a_conferir: "A devolução foi feita pelo painel do Mercado Pago antes de o sistema ver: a data no financeiro é a de hoje. Confira a data real e ajuste se precisar.",
  // Devolução de parte do valor (M8.2d): só é pedida depois de o Mercado Pago liberar o pagamento. O quadro do pagamento
  // troca este texto pelo com o valor (`textoDevolucaoAguardandoLiberacaoAtrasada`).
  devolucao_aguardando_liberacao_atrasada:
    "A liberação deste pagamento passou da data prevista e a devolução de parte do valor continua esperando: confira no painel do Mercado Pago e registre a liberação à mão quando ela aparecer.",
} as const;
export type CodigoAviso = keyof typeof AVISOS_PAGAMENTO;

export const textosDosAvisos = (codigos: readonly string[]) => codigos.filter((c): c is CodigoAviso => c in AVISOS_PAGAMENTO).map((c) => AVISOS_PAGAMENTO[c]);

/** O aviso `devolucao_a_menor` com os dois valores (o que o Mercado Pago devolveu e o pedido no cancelamento). */
export const textoDevolucaoAMenor = (devolvido: number, devido: number) =>
  `O Mercado Pago devolveu ${formatBRL(devolvido)} de ${formatBRL(devido)} pedidos neste cancelamento: confira no painel do Mercado Pago. Se o restante sair por lá, confirme a devolução; senão, a devolução da diferença chega com o M8.2d (ou registre um ajuste).`;

/** O aviso `devolucao_aguardando_liberacao_atrasada` com o valor da devolução que espera (M8.2d). */
export const textoDevolucaoAguardandoLiberacaoAtrasada = (valor: number) =>
  `A liberação deste pagamento passou da data prevista e a devolução de ${formatBRL(valor)} continua esperando: confira no painel do Mercado Pago e registre a liberação à mão quando ela aparecer.`;

/**
 * Os avisos que são de uma devolução (M8.2d: cada devolução tem os seus em `devolucoes_pagamento.avisos`; o pagamento leva
 * a união deles). Os outros avisos são do pagamento.
 */
export const AVISOS_DE_DEVOLUCAO = [
  "devolucao_falhou",
  "devolucao_parada",
  "devolucao_sem_confirmacao",
  "devolucao_fora_do_prazo",
  "devolucao_a_menor",
  "taxa_perdida_desconhecida",
  "devolucao_data_a_conferir",
  "devolucao_aguardando_liberacao_atrasada",
] as const satisfies readonly CodigoAviso[];

// ---------------------------------------------------------------- cartão (M8.2b)

/**
 * Motivo de uma recusa de cartão, SÓ para a equipe com acesso ao financeiro (nunca para o hóspede, que vê sempre a
 * mesma mensagem: quem testa cartões roubados usa o motivo como oráculo). Chaves = status_detail documentados da
 * Orders API para `failed`, mais o do desafio 3DS; nomes no estilo da Payments API (bad_filled_security_code,
 * blacklist…) são desconhecidos aqui e caem no texto genérico.
 */
export const MOTIVOS_RECUSA_CARTAO: Record<string, string> = {
  bad_filled_card_data: "Dados do cartão preenchidos errado (número, validade ou código de segurança).",
  invalid_card_token: "Os dados do cartão expiraram ou são inválidos (formulário vencido, ou a chave pública e o token do Mercado Pago de contas diferentes).",
  card_token_not_found: "Os dados do cartão expiraram ou são inválidos (formulário vencido, ou a chave pública e o token do Mercado Pago de contas diferentes).",
  invalid_token: "Os dados do cartão expiraram ou são inválidos (formulário vencido, ou a chave pública e o token do Mercado Pago de contas diferentes).",
  high_risk: "Recusado pela análise de segurança do Mercado Pago.",
  rejected_by_issuer: "Recusado pelo banco emissor do cartão.",
  required_call_for_authorize: "O banco emissor pede que o titular ligue para autorizar o pagamento.",
  max_attempts_exceeded: "Limite de tentativas do cartão atingido.",
  card_disabled: "Cartão desabilitado no banco emissor.",
  insufficient_amount: "Saldo ou limite insuficiente.",
  card_insufficient_amount: "Saldo ou limite insuficiente.",
  amount_limit_exceeded: "O valor passa do limite do cartão.",
  processing_error: "Erro técnico do Mercado Pago ao processar o pagamento (não é recusa do banco).",
  invalid_installments: "Número de parcelas não aceito para este cartão.",
  "3ds_challenge_expired": "A verificação do banco (3DS) não foi concluída a tempo.",
  cc_rejected_3ds_challenge: "A verificação do banco (3DS) não foi concluída ou foi recusada.",
};
/** Recusa sem motivo conhecido (ou com um código que o sistema não conhece). */
export const MOTIVO_RECUSA_CARTAO_GENERICO = "Recusado pelo Mercado Pago sem um motivo que o sistema conheça: confira no painel do Mercado Pago.";

/** Texto do motivo de recusa para o painel (só `financeiro:ler`). */
export const textoMotivoRecusaCartao = (codigo: string | null): string => (codigo && Object.hasOwn(MOTIVOS_RECUSA_CARTAO, codigo) ? MOTIVOS_RECUSA_CARTAO[codigo] : MOTIVO_RECUSA_CARTAO_GENERICO);

/**
 * O código do motivo num `detalhe_provedor`: o último código de "status/detalhe; pagamento status/detalhe",
 * "recusado/<codigo>" ou "dados_invalidos/<codigo>". null quando não há ("?" ou texto fora do formato).
 */
export function motivoDoDetalhe(detalhe: string | null | undefined): string | null {
  if (typeof detalhe !== "string") return null;
  const ultimo = detalhe.split(";").pop()!.trim().replace(/^pagamento\s+/, "");
  const codigo = ultimo.split("/").pop()!.trim();
  return /^[a-z0-9_]{1,60}$/.test(codigo) ? codigo : null;
}
