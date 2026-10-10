/**
 * Os nomes de campo do formulário do cancelamento que a tela (cliente) e a ação (servidor) compartilham. Um arquivo sem
 * dependências, para a tela não carregar o domínio.
 */

/** D17: o valor devolvido pelo painel do Mercado Pago de cada pagamento (`valorFora:<id do pagamento>`, em reais). */
export const CAMPO_VALOR_FORA = "valorFora:";
/** O rótulo do pagamento desse campo (forma, dia e valor), que volta com o formulário para o campo continuar na tela. */
export const CAMPO_ROTULO_FORA = "valorForaRotulo:";
