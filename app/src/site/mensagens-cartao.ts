/**
 * Textos do cartão que o navegador também precisa (M8.2b), num lugar só: o servidor monta a lista completa
 * (`MENSAGENS_CARTAO_HOSPEDE`, em `pagamento.ts`) a partir daqui, e os componentes do site leem daqui. Puro (sem banco):
 * pode ir para o navegador. Não são editáveis: a recusa precisa continuar a mesma para todo motivo.
 */

export const MENSAGEM_CARTAO_RECUSADO = "Não foi possível aprovar o pagamento com este cartão. Confira os dados, use outro cartão ou pague com Pix.";
export const MENSAGEM_VERIFICACAO_NAO_CONCLUIDA = "A verificação do seu banco não foi concluída. Tente de novo ou pague com Pix.";
export const MENSAGEM_SO_CREDITO = "Use um cartão de crédito (débito e pré-pago não são aceitos aqui) ou pague com Pix.";
export const MENSAGEM_ACEITE_PENDENTE_CARTAO = "Para pagar, marque que leu e aceita os Termos de uso e a Política de cancelamento.";
export const MENSAGEM_CARTAO_INCERTO = "Não deu para confirmar se o pagamento com cartão foi feito. Não pague de novo: a página atualiza sozinha assim que o Mercado Pago responder.";
export const MENSAGEM_PROVEDOR_CARTAO = "Não deu para falar com o Mercado Pago agora. Tente de novo em instantes ou pague com Pix.";
/** O formulário do Mercado Pago não carregou (rede, bloqueador, erro do próprio formulário). */
export const MENSAGEM_FORMULARIO_FALHOU = "Não deu para carregar o formulário do cartão. Recarregue a página ou pague com Pix.";
/** Juros das parcelas: do Mercado Pago, pagos pelo hóspede (a SCL nunca oferece "parcelamento sem acréscimo"). */
export const NOTA_JUROS_CARTAO = "No cartão parcelado há juros do Mercado Pago, pagos por você; o total aparece no formulário antes de confirmar.";
/** Marca de quem processa o cartão, fixa ao lado do formulário. */
export const LINHA_MERCADO_PAGO = "Pagamento processado pelo Mercado Pago";
