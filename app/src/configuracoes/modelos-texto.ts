/**
 * Parte pura dos modelos de mensagem (usada também na tela, para a prévia): variáveis,
 * preenchimento e validação.
 */
export type DadosModelo = { nome: string; quando: string; texto: string };
export type ErrosModelo = Partial<Record<keyof DadosModelo, string>>;

export const VARIAVEIS = {
  hospede: "Nome do hóspede",
  imovel: "Nome do imóvel",
  endereco: "Endereço do imóvel",
  checkin: "Data de entrada",
  checkout: "Data de saída",
  noites: "Número de noites",
  codigo: "Código da reserva",
  empresa: "Nome da empresa",
} as const;
export type Variavel = keyof typeof VARIAVEIS;

export const EXEMPLO: Record<Variavel, string> = {
  hospede: "Ana",
  imovel: "Apartamento 403",
  endereco: "Rua Exemplo, 100",
  checkin: "10/10/2026",
  checkout: "14/10/2026",
  noites: "4",
  codigo: "SCL-AB12",
  empresa: "Sua Casa Leblon",
};

export function variaveisDoTexto(texto: string): string[] {
  return [...new Set([...texto.matchAll(/\{([^{}\s]*)\}/g)].map((m) => m[1]))];
}

export function preencherModelo(texto: string, dados: Partial<Record<Variavel, string>>): string {
  return texto.replace(/\{([a-z]+)\}/g, (inteiro, v: string) => (Object.hasOwn(dados, v) && dados[v as Variavel] !== undefined ? dados[v as Variavel]! : inteiro));
}

export function validarModelo(bruto: Record<string, unknown>): { ok: true; dados: DadosModelo } | { ok: false; erros: ErrosModelo } {
  const txt = (k: string) => (typeof bruto[k] === "string" ? (bruto[k] as string).replace(/\r\n/g, "\n").trim() : "");
  const dados = { nome: txt("nome"), quando: txt("quando"), texto: txt("texto") };
  const erros: ErrosModelo = {};
  if (!dados.nome) erros.nome = "Informe o nome do modelo.";
  else if (dados.nome.length > 80) erros.nome = "Máximo de 80 caracteres.";
  if (dados.quando.length > 120) erros.quando = "Máximo de 120 caracteres.";
  if (!dados.texto) erros.texto = "Escreva o texto da mensagem.";
  else if (dados.texto.length > 2000) erros.texto = "Máximo de 2000 caracteres.";
  else {
    const desconhecidas = variaveisDoTexto(dados.texto).filter((v) => !Object.hasOwn(VARIAVEIS, v));
    if (desconhecidas.length) erros.texto = `Variável desconhecida: ${desconhecidas.map((v) => `{${v}}`).join(", ")}. Use só as da lista.`;
  }
  return Object.keys(erros).length ? { ok: false, erros } : { ok: true, dados };
}

