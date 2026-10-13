/**
 * Parte pura dos modelos de mensagem (usada também na tela, para a prévia): variáveis,
 * preenchimento e validação. Inclui as mensagens do cancelamento (M8.2c) e da alteração (M8.2d) de
 * reserva paga pelo site: os nomes, os textos-base e onde cada variável nova pode ser usada.
 */
import type { TipoMensagemHospede } from "@/db/schema";

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
  // Só nas mensagens do cancelamento (M8.2c; ver `ONDE_VALE`). Nomes sem sublinhado: o preenchimento lê só letras.
  recebido: "Data e hora em que recebemos o pedido",
  decisao: "Decisão do cancelamento, em frases prontas",
  valor: "Valor devolvido",
  data: "Dia da devolução",
  comovolta: "Como o dinheiro volta",
  link: "Página da reserva no site",
  // Só nas mensagens da alteração (M8.2d).
  alteracao: "Alteração da reserva, em frases prontas, com o prazo das datas seguradas",
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
  recebido: "10/10/2026 às 14:10",
  decisao: "Pela Política de cancelamento que você aceitou (versão 1), devolvemos o valor integral pago, R$ 1.500,00, sem desconto de taxas. Já pedimos a devolução ao Mercado Pago; a página da sua reserva mostra quando ela for confirmada.",
  valor: "R$ 1.500,00",
  data: "12/10/2026",
  comovolta: "O valor volta para a conta de onde saiu o pagamento.",
  link: "https://www.exemplo.com.br/reservar/SCL-AB12",
  alteracao:
    "Alteração da reserva SCL-AB12: de 10/10–14/10 (4 noites, 2 pessoas) para 10/10–15/10 (5 noites, 2 pessoas). Valor: de R$ 1.500,00 para R$ 1.900,00 — diferença de R$ 400,00. Datas seguradas até 15:30 (horário de Brasília). Pague a diferença até esse horário para confirmar a alteração; até lá, a sua reserva continua como está.",
};

/** Nome de cada mensagem automática ao hóspede (Configurações → Modelos de mensagem). */
export const NOMES_TIPO: Record<TipoMensagemHospede, string> = {
  confirmacao: "Confirmação da reserva",
  checkin: "Instruções de check-in (2 dias antes da entrada, 10h)",
  checkout: "Lembrete de check-out (1 dia antes da saída, 14h)",
  agradecimento: "Agradecimento (3 dias depois da saída, 10h)",
  cancelamento_recebido: "Cancelamento: pedido recebido",
  cancelamento_decidido: "Cancelamento: decisão",
  // Serve também à devolução da diferença de uma alteração (M8.2d).
  devolucao_concluida: "Devolução feita (cancelamento ou alteração)",
  alteracao_proposta: "Alteração: proposta (e pagamento da diferença, se houver)",
  alteracao_confirmada: "Alteração: confirmada",
};

/** As mensagens do cancelamento de reserva paga pelo site (M8.2c). */
export const TIPOS_MENSAGEM_CANCELAMENTO = ["cancelamento_recebido", "cancelamento_decidido", "devolucao_concluida"] as const satisfies readonly TipoMensagemHospede[];
export type TipoMensagemCancelamento = (typeof TIPOS_MENSAGEM_CANCELAMENTO)[number];
export const ehMensagemDeCancelamento = (t: TipoMensagemHospede): t is TipoMensagemCancelamento => (TIPOS_MENSAGEM_CANCELAMENTO as readonly string[]).includes(t);

/** As mensagens da alteração de reserva paga pelo site (M8.2d): a proposta (em qualquer direção) e a confirmação. */
export const TIPOS_MENSAGEM_ALTERACAO = ["alteracao_proposta", "alteracao_confirmada"] as const satisfies readonly TipoMensagemHospede[];
export type TipoMensagemAlteracao = (typeof TIPOS_MENSAGEM_ALTERACAO)[number];
export const ehMensagemDeAlteracao = (t: TipoMensagemHospede): t is TipoMensagemAlteracao => (TIPOS_MENSAGEM_ALTERACAO as readonly string[]).includes(t);

/**
 * Textos-base das mensagens do cancelamento: os botões "Copiar mensagem" do painel usam o texto do modelo escolhido para
 * a mensagem ou, sem modelo, este (marcado como texto-base). `{decisao}` e `{comovolta}` são frases prontas do caso.
 */
export const TEXTOS_BASE_CANCELAMENTO: Record<TipoMensagemCancelamento, string> = {
  cancelamento_recebido:
    "Olá, {hospede}! Recebemos o seu pedido de cancelamento da reserva {codigo} em {recebido} (horário de Brasília). Vamos conferir pela Política de cancelamento que você aceitou e confirmamos com você, por escrito, o valor da devolução. Acompanhe em {link}.",
  cancelamento_decidido: "Olá, {hospede}! A reserva {codigo} foi cancelada. {decisao} Acompanhe em {link}. Qualquer dúvida, é só responder esta mensagem.",
  devolucao_concluida: "Olá, {hospede}! A devolução de {valor} da reserva {codigo} foi feita em {data}. {comovolta}",
};
/**
 * Textos-base das mensagens da alteração (M8.2d), como os do cancelamento: os botões "Copiar" usam o modelo escolhido ou,
 * sem modelo, este. `{alteracao}` são as frases prontas do caso (datas, valor, diferença, prazo e o que o hóspede faz).
 */
export const TEXTOS_BASE_ALTERACAO: Record<TipoMensagemAlteracao, string> = {
  alteracao_proposta: "Olá, {hospede}! Preparamos a alteração da sua reserva {codigo}: {alteracao} Veja os detalhes em {link}. Até a confirmação, a reserva continua como está.",
  alteracao_confirmada: "Olá, {hospede}! A alteração da sua reserva {codigo} está confirmada: {alteracao} Acompanhe em {link}. Qualquer dúvida, é só responder esta mensagem.",
};
/** O texto-base do pedido recebido num pagamento sem a política aceita (antes de 9/10): não cita política nenhuma. */
export const TEXTO_BASE_RECEBIDO_SEM_POLITICA =
  "Olá, {hospede}! Recebemos o seu pedido de cancelamento da reserva {codigo} em {recebido} (horário de Brasília). Vamos conferir e confirmamos com você, por escrito, o valor da devolução. Acompanhe em {link}.";

/**
 * Onde cada variável do cancelamento pode ser usada (as outras valem em qualquer mensagem). `{valor}` nunca vai no pedido
 * recebido: essa mensagem é copiada pela operação, que não vê valores, e o valor só existe depois da decisão.
 */
export const ONDE_VALE: Partial<Record<Variavel, readonly TipoMensagemHospede[]>> = {
  recebido: TIPOS_MENSAGEM_CANCELAMENTO,
  decisao: ["cancelamento_decidido"],
  // O valor, o dia e como o dinheiro volta só existem com a devolução feita: na decisão (sem devolução, ou ainda pedida)
  // sairiam vazios e travariam a mensagem. Na decisão, `{decisao}` já traz o valor quando há devolução.
  valor: ["devolucao_concluida"],
  data: ["devolucao_concluida"],
  comovolta: ["devolucao_concluida"],
  link: [...TIPOS_MENSAGEM_CANCELAMENTO, ...TIPOS_MENSAGEM_ALTERACAO],
  // As frases da alteração só existem numa alteração (M8.2d).
  alteracao: TIPOS_MENSAGEM_ALTERACAO,
};

/**
 * As variáveis que vêm do cancelamento (não da reserva nem do cadastro): vazias, não há o que completar na reserva — o
 * dado ainda não existe neste cancelamento. O aviso diz isso (avisar em vez de mandar completar o que não existe).
 */
export const VARIAVEIS_DO_CANCELAMENTO: readonly Variavel[] = ["recebido", "decisao", "valor", "data", "comovolta"];
export const textoDaFaltaNoCancelamento = (vs: readonly string[]) =>
  `${lista(vs)} ainda não ${vs.length > 1 ? "existem" : "existe"} neste cancelamento: o modelo escolhido não serve para este caso (ajuste-o em Configurações → Modelos de mensagem)`;
/** Variáveis que a mensagem precisa usar. */
const OBRIGATORIAS: Partial<Record<TipoMensagemHospede, readonly Variavel[]>> = {
  cancelamento_recebido: ["codigo", "recebido"],
  devolucao_concluida: ["valor"],
  // A proposta leva o hóspede à página da reserva (onde paga a diferença ou vê o que muda).
  alteracao_proposta: ["alteracao", "link"],
  alteracao_confirmada: ["alteracao"],
};

const lista = (vs: readonly string[]) => {
  const t = vs.map((v) => `{${v}}`);
  return t.length > 1 ? `${t.slice(0, -1).join(", ")} e ${t.at(-1)}` : (t[0] ?? "");
};

/**
 * As mensagens em que a variável vale, pelos nomes (“A”, “B” e “C”): a mesma frase na escolha do modelo e no aviso do envio
 * automático, tirada de `ONDE_VALE` (uma regra, um lugar). Vazio = vale em qualquer mensagem.
 */
export const ondeVale = (v: Variavel) => {
  const onde = (ONDE_VALE[v] ?? []).map((t) => `“${NOMES_TIPO[t]}”`);
  return onde.length > 1 ? `${onde.slice(0, -1).join(", ")} e ${onde.at(-1)}` : (onde[0] ?? "");
};

/** Variáveis do texto usadas numa mensagem em que não valem (na ordem de `VARIAVEIS`). */
export function variaveisForaDoLugar(tipo: TipoMensagemHospede, texto: string): Variavel[] {
  const usadas = new Set(variaveisDoTexto(texto));
  return (Object.keys(VARIAVEIS) as Variavel[]).filter((v) => usadas.has(v) && ONDE_VALE[v] && !ONDE_VALE[v]!.includes(tipo));
}

/**
 * O que impede usar o modelo nesta mensagem (avisar ao escolher, em vez de mandar uma mensagem errada); null = pode.
 * Variável fora do lugar, endereço onde ele não vai (a confirmação sai antes da liberação do endereço; uma reserva
 * cancelada nunca recebe o endereço) e variável obrigatória que falta.
 */
export function problemaDoModeloNoTipo(tipo: TipoMensagemHospede, texto: string): string | null {
  const nome = `“${NOMES_TIPO[tipo]}”`;
  const fora = variaveisForaDoLugar(tipo, texto);
  if (tipo === "cancelamento_recebido" && fora.includes("valor"))
    return `${nome} não pode usar {valor}: essa mensagem é copiada pela operação, que não vê valores, e o valor só existe depois da decisão.`;
  if (fora.length) return `${nome} não pode usar {${fora[0]}}: essa variável só vale em ${ondeVale(fora[0])}.`;
  const usadas = variaveisDoTexto(texto);
  if (usadas.includes("endereco")) {
    if (tipo === "confirmacao") return "A confirmação não pode usar {endereco}: o endereço só é enviado 2 dias antes da entrada (use no modelo de check-in).";
    if (ehMensagemDeCancelamento(tipo)) return `${nome} não pode usar {endereco}: uma reserva cancelada não recebe o endereço.`;
    // A alteração é preparada antes da entrada, quase sempre antes da liberação do endereço (como a confirmação).
    if (ehMensagemDeAlteracao(tipo)) return `${nome} não pode usar {endereco}: o endereço só é enviado 2 dias antes da entrada (use no modelo de check-in).`;
  }
  const faltam = (OBRIGATORIAS[tipo] ?? []).filter((v) => !usadas.includes(v));
  if (faltam.length) return `${nome} precisa usar ${lista(faltam)}.`;
  return null;
}

/** Tudo o que está entre chaves, exatamente como escrito (inclusive com espaços). */
export function variaveisDoTexto(texto: string): string[] {
  return [...new Set([...texto.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]))];
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
    // Chave sozinha, sem par (ex.: "{hospede" ou "hospede}"), também sairia assim para o hóspede.
    const semPar = /[{}]/.test(dados.texto.replace(/\{[^{}]*\}/g, ""));
    if (desconhecidas.length) erros.texto = `Variável desconhecida: ${desconhecidas.map((v) => `{${v}}`).join(", ")}. Use só as da lista, sem espaços dentro das chaves.`;
    else if (semPar) erros.texto = "Há uma chave { ou } sem par. Variáveis são escritas assim: {hospede}.";
  }
  return Object.keys(erros).length ? { ok: false, erros } : { ok: true, dados };
}

