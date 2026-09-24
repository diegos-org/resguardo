/** Limites e modelo da importação por CSV — sem dependências, usados também na tela. */
export const LIMITE_LINHAS = 2000;
/** Abaixo do limite de 1 MB das ações do servidor. */
export const LIMITE_BYTES = 900 * 1024;

export const MODELO_CSV = [
  "imovel;origem;codigo_canal;situacao;entrada;saida;hospedes;nome;email;telefone;valor_bruto;taxa_canal;observacoes",
  "403;airbnb;HMEXEMPLO1;confirmada;10/10/2026;14/10/2026;2;Hóspede Exemplo;exemplo@example.com;;2.400,00;360,00;",
  "102;booking;1234567890;confirmada;20/10/2026;23/10/2026;3;Outra Pessoa;;;1.800,00;270,00;chegada tarde",
].join("\n");
