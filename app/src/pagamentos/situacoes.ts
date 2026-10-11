/**
 * Pagamento no site (M8.2a) — situações locais, transições e textos de lista fechada. Puro: nada de banco nem
 * de provedor. A situação de uma tentativa só muda por uma leitura do provedor (nunca pelo relógio), e só pelas
 * transições abaixo: dinheiro vence ausência de dinheiro, e o desconhecido nunca sobrescreve o conhecido.
 */
import type { DesfechoPagamento, SituacaoPagamento } from "@/db/schema";
import { formatBRL } from "@/lib/money";
import type { AvisoDeContestacao, TipoContestacao } from "./contestacao-regras";
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
  contestacao: "Voltou ao pagador pela disputa",
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

/**
 * Os avisos de uma disputa do pagamento (M8.2e; a lista fechada é `AVISOS_DE_CONTESTACAO`): cada linha de
 * `contestacoes_pagamento` tem os seus e o pagamento leva a união deles. Os que têm valores ou datas ganham o texto
 * completo no quadro da disputa (`textoContestacaoValorAcima`, `textoContestacaoValorMudou`, `textoContestacaoComDevolucao`).
 */
const TEXTOS_AVISOS_DE_CONTESTACAO = {
  contestacao_pix: "O Mercado Pago mostra uma contestação num pagamento por Pix: a disputa foi registrada por precaução. Confira no painel do Mercado Pago.",
  contestacao_situacao_desconhecida: "O Mercado Pago mostrou uma situação da disputa que o sistema não conhece: a disputa ficou como estava. Confira no painel do Mercado Pago.",
  contestacao_valor_desconhecido: "O Mercado Pago não informou o valor da disputa de um jeito legível: o valor em risco usa o valor pago. Confira no painel do Mercado Pago.",
  contestacao_valor_acima: "O valor contestado passa do valor da reserva: pode incluir os juros do parcelamento; confira no painel do Mercado Pago quanto saiu da conta.",
  contestacao_valor_mudou: 'O valor em disputa mudou depois da decisão: o valor segurado continua o mesmo. Use "Atualizar o valor segurado" se quiser.',
  contestacao_com_devolucao:
    "O hóspede pode receber duas vezes: este pagamento já teve devolução e agora tem uma disputa. Envie o comprovante da devolução ao Mercado Pago como defesa e confira quanto ele debitou.",
  contestacao_liberacao_lida: "O Mercado Pago mostra a liberação de um pagamento em disputa: registre a liberação à mão com o líquido do pagamento que caiu na conta.",
  contestacao_ganha_sem_recebimento: "A SCL ganhou a disputa, mas o pagamento ainda não tem recebimento no financeiro: registre a liberação à mão quando o dinheiro cair.",
  contestacao_resultado_mudou:
    'O Mercado Pago mudou o que mostra desta disputa (voltou a mostrá-la em andamento, ou com outro resultado): confira no painel do Mercado Pago. Numa disputa já encerrada aqui, use "Conferir o aviso".',
  contestacao_leitura_conflitante:
    "As leituras do Mercado Pago não batem sobre o fim desta disputa (uma parece a favor da SCL, outra contra): nada mudou aqui. Confira no painel do Mercado Pago e confirme o resultado.",
  contestacao_ambigua:
    "O Mercado Pago mostra uma disputa que o sistema não consegue ligar ao quadro com segurança (por exemplo, uma disputa já encerrada que o sistema não conhecia): nada foi criado. Confira no painel do Mercado Pago, registre-a pelo quadro do pagamento e confirme o resultado.",
  contestacao_busca_sem_acesso:
    'O Mercado Pago não deixa esta conta procurar as disputas deste pagamento (Chargebacks): uma disputa aberta depois dos 85 dias só aparece no painel do Mercado Pago. Confira por lá; o aviso sai quando a busca semanal (ou o "Conferir agora") voltar a responder.',
  contestacao_possivel_duplicata: 'Esta disputa pode ser a mesma de outra do quadro: ela não segura nada até a equipe usar "Confirmar que é outra disputa" (ou encerrá-la sem efeito).',
  contestacao_caso_de_outro_pagamento: "Este caso é de outro pagamento no Mercado Pago: nada dele foi usado.",
  contestacao_sem_leitura: "O Mercado Pago não deixa esta conta ler as disputas (Chargebacks): acompanhe esta disputa pelo painel do Mercado Pago.",
  contestacao_sem_fonte: "Esta disputa passou dos 85 dias e o sistema não tem mais de onde lê-la: confira o resultado no painel do Mercado Pago e confirme aqui.",
  contestacao_fora_do_prazo: "Esta disputa está aberta há mais de 240 dias e o sistema parou de lê-la: confira o resultado no painel do Mercado Pago e confirme aqui.",
  contestacao_prazo_desconhecido: "Prazo dos documentos desconhecido: confira no painel do Mercado Pago e informe aqui.",
} as const satisfies Record<AvisoDeContestacao, string>;

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
  situacao_inesperada:
    'O Mercado Pago mostrou este pagamento já devolvido (no todo ou em parte) ou contestado antes de o sistema decidir a reserva: nada foi confirmado. Devolvido em parte: use "Devolver o restante ao hóspede". Contestado: acompanhe a disputa pelo quadro do pagamento.',
  // M8.2e: só com disputa em curso (desligado quando ela termina). O quadro troca este texto pelo do tipo da disputa
  // (`textoDoAvisoContestado`).
  contestado: "Disputa do pagamento em curso: acompanhe no quadro da disputa.",
  ao_vivo: "O Mercado Pago marcou este pagamento como real (live_mode) no ambiente de teste.",
  pix_sem_prazo: "O Mercado Pago não informou até quando este Pix vale: confira no painel do Mercado Pago.",
  taxa_perdida_desconhecida: "Devolução confirmada: falta saber quanto da taxa o Mercado Pago não devolveu. Confira no Mercado Pago e use \"Registrar taxa que não voltou\" no quadro do pagamento (zero se voltou toda).",
  devolucao_falhou: "O Mercado Pago recusou ou não respondeu três vezes: confira no painel do Mercado Pago antes de tentar de novo ou de registrar a devolução feita por fora.",
  devolucao_parada:
    'O Mercado Pago mostra uma devolução que o sistema não pediu, uma contestação ou outra situação neste pagamento: a devolução pelo sistema parou (para não devolver a mais). Confira no painel do Mercado Pago; se a devolução saiu por lá, confirme com o valor visto; se parte já voltou, use "Devolver o restante ao hóspede".',
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
  // Uma devolução que o Mercado Pago fez a menos (M8.2c; M8.2d, D15). O quadro do pagamento troca este texto pelo com os
  // valores (`textoDevolucaoAMenor`).
  devolucao_a_menor: "O Mercado Pago devolveu menos do que foi pedido numa devolução deste pagamento: confira no painel do Mercado Pago e peça o restante ao Mercado Pago (ou registre o restante devolvido por fora).",
  devolucao_data_a_conferir: "A devolução foi feita pelo painel do Mercado Pago antes de o sistema ver: a data no financeiro é a de hoje. Confira a data real e ajuste se precisar.",
  // Devolução de parte do valor (M8.2d): só é pedida depois de o Mercado Pago liberar o pagamento. O quadro do pagamento
  // troca este texto pelo com o valor (`textoDevolucaoAguardandoLiberacaoAtrasada`).
  devolucao_aguardando_liberacao_atrasada:
    "A liberação deste pagamento passou da data prevista e a devolução de parte do valor continua esperando: confira no painel do Mercado Pago e registre a liberação à mão quando ela aparecer.",
  // M8.2e: a devolução que uma disputa do pagamento substituía, de volta a devida depois da disputa ganha (ou encerrada sem
  // efeito). O quadro troca este texto pelo com o valor (`textoDevolucaoDevidaDepoisDaDisputa`).
  devolucao_devida_depois_da_disputa:
    "A disputa do pagamento terminou sem o dinheiro voltar ao hóspede por ela: a devolução que a reserva deve a ele continua devida. Peça de novo pelo quadro do pagamento (até 78 dias; depois, pelo painel do Mercado Pago ou por fora).",
  ...TEXTOS_AVISOS_DE_CONTESTACAO,
} as const;
export type CodigoAviso = keyof typeof AVISOS_PAGAMENTO;

export const textosDosAvisos = (codigos: readonly string[]) => codigos.filter((c): c is CodigoAviso => c in AVISOS_PAGAMENTO).map((c) => AVISOS_PAGAMENTO[c]);

/**
 * O aviso `devolucao_a_menor` com os dois valores (o que o Mercado Pago devolveu e o pedido nesta devolução, D15). A
 * devolução por fora do restante entra só quando ela é permitida (no cartão, pela regra do cartão). Sem os valores (null:
 * quem não lê o financeiro), o mesmo aviso sem nenhum R$.
 */
export const textoDevolucaoAMenor = (devolvido: number | null, devido: number | null, restantePorFora = true) =>
  `O Mercado Pago devolveu ${devolvido === null || devido === null ? "menos do que foi pedido" : `${formatBRL(devolvido)} de ${formatBRL(devido)} pedidos`} nesta devolução: o que voltou já está no financeiro. Peça o restante ao Mercado Pago${restantePorFora ? " ou registre o restante devolvido por fora" : ""}.`;

/**
 * O aviso `devolucao_a_menor` de uma devolução que a leitura mostra a menos SEM o id dela (D15): `devolvido` é o que a
 * leitura mostra além das outras devoluções confirmadas e do reconhecido devolvido fora. Nada foi acertado no financeiro:
 * a equipe confirma o valor que o painel do Mercado Pago mostra.
 */
export const textoDevolucaoAMenorSemId = (devolvido: number | null, devido: number | null) =>
  `O Mercado Pago mostra ${devolvido === null || devido === null ? "menos devolvido do que foi pedido" : `${formatBRL(devolvido)} devolvidos de ${formatBRL(devido)} pedidos`} nesta devolução, sem dizer qual devolução é: nada foi acertado no financeiro. Confira no painel do Mercado Pago e use "Confirmar devolução feita no painel do Mercado Pago" com o valor que aparece lá (ou registre um ajuste).`;

/**
 * O aviso `devolucao_a_menor` do restante que o Mercado Pago recusou com "valor acima do que se pode devolver" ou "não
 * permitido" (D15): o restante pode já ter saído por lá, ou não sair mais pelo sistema. `porFora`: a devolução por fora
 * dele é permitida agora (no cartão, pela regra do cartão).
 */
export const textoRestanteRecusado = (devido: number | null, porFora: boolean) =>
  `O Mercado Pago recusou o pedido do restante${devido === null ? "" : ` (${formatBRL(devido)})`} desta devolução: confira no painel do Mercado Pago. Se o restante já voltou por lá, use "Confirmar devolução feita no painel do Mercado Pago" com o valor que aparece lá; se não, ${porFora ? "registre o restante devolvido por fora" : 'registre a recusa do painel do Mercado Pago (a devolução por fora do cartão fica liberada)'} ou um ajuste.`;

/**
 * O aviso `devolucao_data_a_conferir` da devolução que completou um pagamento com parte já devolvida pelo painel do
 * Mercado Pago, fora do sistema (D17): essa parte não tem saída de caixa própria, e o que tinha entrado sai todo nesta.
 */
export const TEXTO_CAIXA_COM_DEVOLVIDO_FORA = "Parte deste pagamento já tinha sido devolvida pelo painel do Mercado Pago: o caixa ficou todo no dia desta devolução; ajuste a data se precisar.";

/** A dica do quadro do pagamento para a devolução que espera a liberação (D13; só no painel). */
export const textoAguardandoLiberacao = (prevista: string | null) =>
  `A devolução de parte do valor é pedida ao Mercado Pago assim que ele liberar este pagamento${prevista ? ` (previsto para ${prevista})` : ""}: antes disso o sistema não pede. No teste, registre a liberação à mão.`;

/** O aviso `devolucao_aguardando_liberacao_atrasada` com o valor da devolução que espera (M8.2d); sem o valor (null), sem R$. */
export const textoDevolucaoAguardandoLiberacaoAtrasada = (valor: number | null) =>
  `A liberação deste pagamento passou da data prevista e a devolução de ${valor === null ? "parte do valor" : formatBRL(valor)} continua esperando: confira no painel do Mercado Pago e registre a liberação à mão quando ela aparecer.`;

// ---------------------------------------------------------------- disputa do pagamento (M8.2e)

/**
 * O aviso `devolucao_devida_depois_da_disputa` com o valor da devolução que voltou a ser devida (a ganha e o sem efeito
 * dizem o mesmo: o dinheiro não voltou ao hóspede pela disputa); sem o valor (null), sem R$.
 */
export const textoDevolucaoDevidaDepoisDaDisputa = (valor: number | null) =>
  `A disputa do pagamento terminou sem o dinheiro voltar ao hóspede por ela: a devolução de ${valor === null ? "que a reserva deve a ele" : `${formatBRL(valor)} que a reserva deve a ele`} continua devida. Peça de novo pelo quadro do pagamento (até 78 dias; depois, pelo painel do Mercado Pago ou por fora).`;

/** O aviso `contestado` do pagamento, por tipo da disputa em curso (sem o tipo, o texto geral). */
export const TEXTOS_AVISO_CONTESTADO: Record<TipoContestacao, string> = {
  chargeback: "Pagamento contestado no cartão: acompanhe no quadro da disputa.",
  med: "Devolução pedida pelo Pix (MED): acompanhe no quadro da disputa.",
  reclamacao: "Reclamação no Mercado Pago: acompanhe no quadro da disputa.",
};
export const textoDoAvisoContestado = (tipo: TipoContestacao | null): string => (tipo ? TEXTOS_AVISO_CONTESTADO[tipo] : AVISOS_PAGAMENTO.contestado);

/** O aviso `contestacao_valor_acima` com os valores (o contestado e o da reserva). */
export const textoContestacaoValorAcima = (contestado: number, daReserva: number) =>
  `O valor contestado (${formatBRL(contestado)}) passa do valor da reserva (${formatBRL(daReserva)}): pode incluir os juros do parcelamento; confira no painel do Mercado Pago quanto saiu da conta.`;

/** O aviso `contestacao_valor_mudou` com os valores; a ação pronta é "Atualizar o valor segurado". */
export const textoContestacaoValorMudou = (de: number, para: number, segurado: number) =>
  `O valor em disputa mudou de ${formatBRL(de)} para ${formatBRL(para)}: o valor segurado continua ${formatBRL(segurado)}.`;

/** O aviso `contestacao_com_devolucao` com os dois valores e o dia da devolução (dd/mm). */
export const textoContestacaoComDevolucao = (devolucao: number, dia: string, disputa: number) =>
  `O hóspede pode receber duas vezes: a devolução de ${formatBRL(devolucao)} (${dia}) e a disputa de ${formatBRL(disputa)}. Envie o comprovante da devolução ao Mercado Pago como defesa e confira quanto ele debitou.`;

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
  "devolucao_devida_depois_da_disputa",
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
