/**
 * Notas livres sem dado pessoal (M8.2c). As notas da equipe — onde está o pedido de cancelamento, o motivo de uma
 * exceção, de uma devolução por fora, de uma confirmação ou recusa no painel do Mercado Pago, de uma correção — ficam no
 * banco: CPF, e-mail, telefone, chave Pix e dados de cartão não podem entrar ali. A dica na tela não basta, então toda
 * ação que grava uma nota passa o texto por aqui antes (e recusa com `ERRO_DADOS_PESSOAIS`).
 *
 * Recusa: e-mail; CPF ou CNPJ com pontuação; 6 ou mais algarismos seguidos depois de tirar . - / ( ) e espaços
 * (telefone, CPF ou CNPJ sem pontuação, começo de cartão, ids de transação); "final 1234" e "terminado em 1234" (fim de
 * cartão); id no formato de chave Pix aleatória (UUID, ou 32 caracteres hexadecimais); e "chave" seguida de um e-mail,
 * telefone ou documento. Datas (10/10, 10/10/2026, 2026-10-10), horas (14h10, 14:10) e valores em reais (R$ 1.500,00)
 * passam: saem do texto antes da contagem de algarismos, para "pedido de 10/10 às 15:00" não juntar números que não são
 * dado pessoal. Nomes não têm como ser reconhecidos: a dica da tela continua pedindo para não escrever.
 */

export const ERRO_DADOS_PESSOAIS = "Tire dados pessoais da nota (CPF, e-mail, telefone, chave Pix, cartão).";

/** Formatos que, sozinhos, já são dado pessoal. */
const PROIBIDOS: readonly RegExp[] = [
  // E-mail (também sem o ".com": "fulano@gmail").
  /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*/u,
  // CPF e CNPJ com pontuação (sem ela, a contagem de algarismos pega).
  /(?<!\d)\d{3}\.\d{3}\.\d{3}-?\d{2}(?!\d)/,
  /(?<!\d)\d{2}\.\d{3}\.\d{3}\/\d{4}-?\d{2}(?!\d)/,
  // Fim de cartão.
  /\bfinal\s*(?:do\s+cart[ãa]o\s*)?:?\s*\d{4}(?!\d)/i,
  /\btermina(?:do|da)?\s+em\s*:?\s*\d{4}(?!\d)/i,
  // Chave Pix aleatória (UUID, com ou sem hífens).
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{32}\b/i,
  // "chave" (Pix) logo antes de um e-mail, telefone ou documento.
  /\bchave\b(?:\s+(?:pix|aleat[óo]ria|do\s+pix))*\s*[:=-]?\s*(?:[^\s@]+@|\+?\(?\d[\d\s().-]{6,})/i,
];

/** O que não é dado pessoal e tem algarismos: datas, horas e valores em reais (saem antes da contagem). */
const PERMITIDOS: readonly RegExp[] = [
  /(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/g,
  /(?<![\d/])\d{1,2}\/\d{1,2}(?:\/(?:\d{4}|\d{2}))?(?![\d/])/g,
  /(?<!\d)\d{1,2}(?::\d{2}(?::\d{2})?|h(?:\d{2})?)(?![\d:])/gi,
  // Valores: o ponto ou a vírgula do fim da frase não atrapalham ("R$ 150.000,00.").
  /R\$\s?\d{1,3}(?:\.\d{3})?(?:,\d{2})?(?!\d|[.,]\d)/g,
  /R\$\s?\d{1,6}(?:,\d{2})?(?!\d|[.,]\d)/g,
  /(?<![\d.,])\d{1,3}(?:\.\d{3})?,\d{2}(?!\d|[.,]\d)/g,
];

/** Algarismos seguidos que contam como dado pessoal, depois de tirar os separadores. */
const ALGARISMOS_SEGUIDOS = 6;

/** A nota traz algo com cara de dado pessoal? */
export function temDadosPessoais(texto: string): boolean {
  if (PROIBIDOS.some((r) => r.test(texto))) return true;
  // Datas, horas e valores viram uma letra: assim não grudam nos números vizinhos quando os separadores saem.
  let resto = texto;
  for (const r of PERMITIDOS) resto = resto.replace(r, " x ");
  return new RegExp(`\\d{${ALGARISMOS_SEGUIDOS},}`).test(resto.replace(/[\s.\-/()]/g, ""));
}

/**
 * A nota como veio, quando ela não traz dado pessoal; null quando traz (quem chama recusa com `ERRO_DADOS_PESSOAIS`).
 * Tamanho e obrigatoriedade são conferidos por quem chama.
 */
export function textoSemDadosPessoais(texto: string): string | null {
  return temDadosPessoais(texto) ? null : texto;
}
