/**
 * Textos do site público (M1.7), editáveis no painel. O site (M7.1) lê daqui.
 */
import type { Db } from "@/db/types";
import { gravarConfig, lerConfig } from "./armazem";

export const CAMPOS_TEXTOS_SITE = [
  { chave: "olho", rotulo: "Olho da capa (linha pequena acima do título, ex.: RIO DE JANEIRO · BRASIL)", limite: 60, linhas: 1 },
  { chave: "titulo", rotulo: "Título da página inicial (a palavra entre *asteriscos* sai em itálico)", limite: 120, linhas: 1 },
  { chave: "subtitulo", rotulo: "Subtítulo", limite: 240, linhas: 2 },
  { chave: "legendaCapa", rotulo: "Legenda vertical da capa (texto pequeno no canto da foto, ex.: LEBLON, DO NOSSO JEITO.)", limite: 40, linhas: 1 },
  { chave: "vitrineOlho", rotulo: "Olho da vitrine de casas (linha pequena acima do título)", limite: 60, linhas: 1 },
  { chave: "vitrineTitulo", rotulo: "Título da vitrine de casas (a palavra entre *asteriscos* sai em itálico)", limite: 80, linhas: 1 },
  { chave: "vitrineTexto", rotulo: "Frase da vitrine de casas", limite: 160, linhas: 1 },
  { chave: "porqueOlho", rotulo: "Olho de \"Por que reservar direto\"", limite: 60, linhas: 1 },
  { chave: "porqueTitulo", rotulo: "Título de \"Por que reservar direto\" (a parte entre *asteriscos* sai em itálico)", limite: 120, linhas: 1 },
  { chave: "porque", rotulo: "Por que reservar direto (um benefício por bloco, separados por linha em branco; a primeira linha do bloco é o título). Vazio = a seção não aparece", limite: 2000, linhas: 8 },
  { chave: "comoReservar", rotulo: "Como reservar", limite: 2000, linhas: 5 },
  { chave: "consultaOlho", rotulo: "Página de consulta: olho (linha pequena acima do título)", limite: 60, linhas: 1 },
  { chave: "consultaTitulo", rotulo: "Página de consulta: título (a parte entre *asteriscos* sai em itálico)", limite: 120, linhas: 1 },
  { chave: "consultaTexto", rotulo: "Página de consulta: frase abaixo do título", limite: 240, linhas: 2 },
  { chave: "chamadaOlho", rotulo: "Olho da chamada final (linha pequena acima dela)", limite: 60, linhas: 1 },
  { chave: "chamada", rotulo: "Chamada final (título da faixa verde antes do rodapé)", limite: 120, linhas: 1 },
  { chave: "contato", rotulo: "Texto de contato", limite: 500, linhas: 3 },
  { chave: "rodape", rotulo: "Rodapé", limite: 240, linhas: 2 },
  // Página não encontrada e site sem casas (M7.8): o texto-base vem do estudo aprovado (prototipos/scl-publico).
  { chave: "naoEncontradoTitulo", rotulo: "Página não encontrada: título (endereço errado ou que saiu do site)", limite: 120, linhas: 1 },
  { chave: "naoEncontradoTexto", rotulo: "Página não encontrada: frase abaixo do título (vazio = só o título e o botão)", limite: 240, linhas: 2 },
  { chave: "casaNaoEncontradaTitulo", rotulo: "Casa não encontrada: título (link de uma casa que não existe ou saiu do site)", limite: 120, linhas: 1 },
  { chave: "casaNaoEncontradaTexto", rotulo: "Casa não encontrada: frase abaixo do título (vazio = só o título e o botão)", limite: 240, linhas: 2 },
  {
    chave: "semCasasTexto",
    rotulo: "Site sem nenhuma casa publicada: aviso na página inicial, em Nossas casas, na consulta e na página não encontrada (o botão do WhatsApp ou do e-mail vem logo abaixo)",
    limite: 240,
    linhas: 2,
  },
  { chave: "pagamentoConvite", rotulo: "Pagamento no site: convite para pagar (página da cotação, com as datas seguradas)", limite: 240, linhas: 2 },
  { chave: "pagamentoAguardando", rotulo: "Pagamento por Pix: instrução enquanto o Pix aguarda o pagamento", limite: 240, linhas: 2 },
  { chave: "pagamentoSemDatas", rotulo: "Pagamento no site: pagamento recebido sem conseguir garantir as datas", limite: 400, linhas: 3 },
  {
    chave: "pagamentoCartaoAnalise",
    rotulo: "Pagamento com cartão: explicação enquanto o Mercado Pago analisa o pagamento (sem horário: a página mostra o prazo das datas abaixo)",
    limite: 400,
    linhas: 3,
  },
  // Cancelamento de reserva paga pelo site (M8.2c): só as frases. As datas, horas, valores e a versão da política são
  // escritos pelo sistema na página da reserva, nas mensagens e em Minha reserva (nunca editáveis aqui).
  { chave: "cancelamentoSemTaxas", rotulo: "Cancelamento: fim da frase da devolução integral (depois de \"devolvemos o valor integral pago, R$ …,\")", limite: 120, linhas: 1 },
  { chave: "cancelamentoDevolucaoPedida", rotulo: "Cancelamento: devolução pedida ao Mercado Pago, ainda não confirmada", limite: 240, linhas: 2 },
  { chave: "cancelamentoEstornoNoCartao", rotulo: "Cancelamento: estorno no cartão feito pela equipe no painel do Mercado Pago (pagamento com mais de 78 dias)", limite: 240, linhas: 2 },
  { chave: "cancelamentoVoltaPix", rotulo: "Cancelamento: como o dinheiro volta no Pix", limite: 240, linhas: 2 },
  { chave: "cancelamentoVoltaCartao", rotulo: "Cancelamento: como o dinheiro volta no cartão", limite: 240, linhas: 2 },
  { chave: "cancelamentoVoltaPorFora", rotulo: "Cancelamento: devolução feita por fora (transferência da empresa)", limite: 240, linhas: 2 },
  { chave: "cancelamentoComAEquipe", rotulo: "Cancelamento: a devolução pelo Mercado Pago não foi possível (a equipe combina outra forma)", limite: 240, linhas: 2 },
  { chave: "cancelamentoEmConferencia", rotulo: "Cancelamento: devolução em conferência com o Mercado Pago", limite: 240, linhas: 2 },
  {
    chave: "cancelamentoDevolvidoPelaDisputa",
    rotulo: "Cancelamento da reserva contestada: o dinheiro voltou ao hóspede pelo banco ou pelo Mercado Pago (a disputa terminou a favor dele)",
    limite: 240,
    linhas: 2,
  },
  { chave: "cancelamentoSemDevolucaoPrazo", rotulo: "Cancelamento sem devolução: o pedido chegou depois dos prazos da política (a página mostra os prazos antes)", limite: 240, linhas: 2 },
  { chave: "cancelamentoSemDevolucaoNaoComparecimento", rotulo: "Cancelamento sem devolução: não comparecimento", limite: 240, linhas: 2 },
  { chave: "cancelamentoSemDevolucaoEquipe", rotulo: "Cancelamento sem devolução decidido pela equipe (pagamento sem a política aceita)", limite: 240, linhas: 2 },
  { chave: "cancelamentoFecho", rotulo: "Cancelamento: frase final da página da reserva cancelada", limite: 240, linhas: 2 },
  { chave: "cancelamentoPedidoRecebido", rotulo: "Cancelamento: pedido recebido, ainda sem decisão (página da reserva e Minha reserva, depois da data e hora do pedido)", limite: 240, linhas: 2 },
  { chave: "cancelamentoMinhaReservaIntro", rotulo: "Cancelamento: abertura do quadro \"Cancelar a reserva\" em Minha reserva (antes dos prazos da política)", limite: 240, linhas: 2 },
  // Alteração de reserva paga pelo site (M8.2d): só as frases. As datas, horas, valores, a diferença e a versão da política
  // são escritos pelo sistema na página da reserva e nas mensagens (nunca editáveis aqui).
  { chave: "alteracaoEmAndamento", rotulo: "Alteração com diferença a pagar: frase depois das novas datas, do valor e do horário até quando elas ficam seguradas (escritos pelo sistema)", limite: 240, linhas: 2 },
  { chave: "alteracaoAguardaConfirmacao", rotulo: "Alteração sem diferença a pagar (redução ou mesmo valor): como o hóspede confirma", limite: 240, linhas: 2 },
  { chave: "alteracaoPolitica", rotulo: "Alteração: a política que continua valendo (depois da versão e da data de que os prazos contam)", limite: 240, linhas: 2 },
  { chave: "alteracaoConfirmada", rotulo: "Alteração confirmada (depois das novas datas e do valor)", limite: 240, linhas: 2 },
  { chave: "devolucaoAguardaLiberacao", rotulo: "Devolução de parte do valor esperando o Mercado Pago liberar o pagamento (depois do valor e da data prevista)", limite: 240, linhas: 2 },
  { chave: "alteracaoSemDevolucao", rotulo: "Alteração em que a política não devolve a diferença", limite: 240, linhas: 2 },
  { chave: "alteracaoNaoAplicada", rotulo: "Alteração não aplicada: a diferença foi paga, mas as novas datas não puderam ser seguradas", limite: 400, linhas: 3 },
  { chave: "alteracaoNaoVale", rotulo: "Alteração preparada que não vale mais (o prazo passou ou a equipe desistiu)", limite: 240, linhas: 2 },
  // Disputa do pagamento (M8.2e): a linha da reserva confirmada com o pagamento em disputa, só para quem pagou (o cookie do
  // pagamento) e em Minha reserva. Nunca a palavra "contestação", nunca uma acusação. Vazia = a linha não aparece.
  { chave: "pagamentoEmConferencia", rotulo: "Pagamento em conferência: reserva confirmada com o pagamento em disputa (só quem pagou vê; vazio = a linha não aparece)", limite: 240, linhas: 2 },
] as const;
export type ChaveTextoSite = (typeof CAMPOS_TEXTOS_SITE)[number]["chave"];
export type TextosSite = Record<ChaveTextoSite, string>;
/**
 * Textos que não podem ficar vazios: o título, os títulos da página não encontrada e o aviso do site sem casas (M7.8:
 * a página nunca sai sem dizer o que aconteceu), os do pagamento e os do cancelamento e da alteração que o hóspede precisa
 * ler (o que acontece com o dinheiro e com a reserva dele). A frase final e a abertura do quadro em Minha reserva podem
 * ficar vazias, e as frases da alteração que só completam uma linha que o sistema já escreve também.
 */
export const TEXTOS_SITE_OBRIGATORIOS: readonly ChaveTextoSite[] = [
  "titulo",
  "naoEncontradoTitulo",
  "casaNaoEncontradaTitulo",
  "semCasasTexto",
  "pagamentoConvite",
  "pagamentoAguardando",
  "pagamentoSemDatas",
  "pagamentoCartaoAnalise",
  "cancelamentoSemTaxas",
  "cancelamentoDevolucaoPedida",
  "cancelamentoEstornoNoCartao",
  "cancelamentoVoltaPix",
  "cancelamentoVoltaCartao",
  "cancelamentoVoltaPorFora",
  "cancelamentoComAEquipe",
  "cancelamentoEmConferencia",
  "cancelamentoDevolvidoPelaDisputa",
  "cancelamentoSemDevolucaoPrazo",
  "cancelamentoSemDevolucaoNaoComparecimento",
  "cancelamentoSemDevolucaoEquipe",
  "cancelamentoPedidoRecebido",
  "alteracaoEmAndamento",
  "alteracaoAguardaConfirmacao",
  "alteracaoNaoAplicada",
  "alteracaoPolitica",
  "devolucaoAguardaLiberacao",
];

export const TEXTOS_SITE_INICIAIS: TextosSite = {
  olho: "Rio de Janeiro · Brasil",
  titulo: "Um pouco de Rio. Um lugar *seu*.",
  subtitulo: "Estadias com cuidado de casa, a poucos passos da praia.",
  legendaCapa: "Leblon, do nosso jeito.",
  vitrineOlho: "Poucas casas. Muito cuidado.",
  vitrineTitulo: "Seu endereço no *Leblon*.",
  vitrineTexto: "Seu jeito de se sentir em casa no Rio.",
  porqueOlho: "Reservar direto",
  porqueTitulo: "A leveza de chegar e *se sentir em casa*.",
  // Texto-base (M7.6) para Diego revisar perto da entrada no ar: só o que o site de fato oferece.
  porque: [
    "Conversa direta\nVocê fala com quem cuida da casa, da primeira mensagem à saída.",
    "Valor claro desde o início\nO total da estadia aparece antes de qualquer reserva, já com o desconto de quem reserva pelo site.",
    "Um bairro para viver\nEntre a praia, os cafés e os restaurantes, descubra seu próprio ritmo no Leblon.",
  ].join("\n\n"),
  comoReservar: "",
  consultaOlho: "Vamos combinar sua viagem",
  consultaTitulo: "Conte seus planos. *A gente encontra sua casa.*",
  consultaTexto: "Escolha a casa, as datas e quantas pessoas. A disponibilidade e o valor aparecem aqui, antes de qualquer reserva.",
  chamadaOlho: "Sua próxima viagem começa aqui",
  chamada: "O Rio está logo ali.",
  contato: "",
  rodape: "",
  // Página não encontrada (M7.8): os textos do estudo aprovado (prototipos/scl-publico/src/server.mjs).
  naoEncontradoTitulo: "Página não encontrada",
  naoEncontradoTexto: "Você pode voltar ao catálogo para escolher sua casa.",
  casaNaoEncontradaTitulo: "Casa não encontrada",
  casaNaoEncontradaTexto: "Conheça os imóveis disponíveis no catálogo.",
  // Sem nenhuma casa publicada (M7.8): neutro, sem prometer data nem novidade; o contato vem no botão abaixo.
  semCasasTexto: "No momento, nenhuma casa está aberta para reserva pelo site. Se quiser, fale com a gente.",
  // Pagamento no site (M8.2a): texto-base para Diego revisar. O convite não cita a forma (M8.2b: Pix ou cartão).
  pagamentoConvite: "Pague aqui mesmo: assim que o pagamento é aprovado, a reserva fica confirmada, sem precisar esperar a equipe.",
  pagamentoAguardando: "Abra o app do seu banco, escolha pagar com Pix e use o código copia e cola (ou leia o QR). O valor já vem preenchido.",
  pagamentoSemDatas: "Recebemos seu pagamento, mas não conseguimos garantir as datas. A equipe vai falar com você e devolver o valor integral.",
  // Cartão em análise (M8.2b): sem horário (a página põe a linha do prazo das datas, que não é editável).
  pagamentoCartaoAnalise:
    "Seu pagamento com cartão está em análise pelo Mercado Pago, que pode levar até 2 dias úteis. Enquanto a análise não termina, não dá para pagar de outro jeito nesta cotação: fale com a equipe pelo WhatsApp se precisar.",
  // Cancelamento (M8.2c): texto-base para Diego revisar. Nunca cita o Beds24 nem traz dado pessoal.
  cancelamentoSemTaxas: "sem desconto de taxas.",
  // Também vão para a mensagem ao hóspede ({decisao}): "a página da sua reserva", nunca "esta página".
  cancelamentoDevolucaoPedida: "Já pedimos a devolução ao Mercado Pago; a página da sua reserva mostra quando ela for confirmada.",
  cancelamentoEstornoNoCartao: "Estamos pedindo o estorno no seu cartão; a página da sua reserva mostra quando for feito.",
  cancelamentoVoltaPix: "O valor volta para a conta de onde saiu o pagamento.",
  cancelamentoVoltaCartao: "No cartão, o estorno aparece na fatura atual ou na seguinte, conforme o banco.",
  cancelamentoVoltaPorFora: "Devolvemos por transferência, como combinado com a nossa equipe.",
  cancelamentoComAEquipe: "A nossa equipe vai falar com você para combinar outra forma, sem custo para você.",
  cancelamentoEmConferencia: "Estamos conferindo a devolução com o Mercado Pago; a nossa equipe fala com você.",
  cancelamentoDevolvidoPelaDisputa: "O dinheiro desta reserva voltou a você pelo banco ou pelo Mercado Pago.",
  cancelamentoSemDevolucaoPrazo: "O pedido chegou depois desses prazos: pela política que você aceitou, não há devolução.",
  cancelamentoSemDevolucaoNaoComparecimento: "Pela política, o não comparecimento não tem devolução.",
  cancelamentoSemDevolucaoEquipe: "A nossa equipe registrou que não há devolução.",
  cancelamentoFecho: "Se tiver dúvida, fale com a equipe.",
  cancelamentoPedidoRecebido: "A equipe confirma com você, por escrito, o valor da devolução pela política que você aceitou.",
  cancelamentoMinhaReservaIntro: "Precisa cancelar? Faça o pedido aqui: a data e a hora em que ele chega ficam registradas na hora, e é esse momento que vale pela política.",
  // Alteração (M8.2d): texto-base para Diego revisar. Nunca cita o Beds24 nem traz dado pessoal; a devolução de parte do
  // valor espera a liberação do pagamento (nunca "já pedimos" antes disso).
  alteracaoEmAndamento: "Pague a diferença até esse horário para confirmar a alteração; até lá, a sua reserva continua como está.",
  alteracaoAguardaConfirmacao: "Para confirmar, responda à nossa mensagem aceitando a alteração; até lá, a sua reserva continua como está.",
  alteracaoPolitica: "A sua reserva continua seguindo a Política de cancelamento que você aceitou ao pagar.",
  alteracaoConfirmada: "As novas datas valem a partir de agora.",
  devolucaoAguardaLiberacao: "Ela será pedida ao Mercado Pago quando ele liberar o seu pagamento; a página da sua reserva mostra quando for feita.",
  alteracaoSemDevolucao: "O valor da reserva continua o mesmo.",
  alteracaoNaoAplicada: "As novas datas não puderam ser seguradas: a sua reserva continua como estava e vamos devolver esse valor. A nossa equipe fala com você.",
  alteracaoNaoVale: "A sua reserva continua como está. Fale com a equipe se ainda quiser mudar.",
  // Disputa do pagamento (M8.2e): texto-base do desenho. Pode ficar vazio (a linha some).
  pagamentoEmConferencia: "O pagamento desta reserva está em conferência com o Mercado Pago. Se tiver qualquer dúvida sobre a cobrança, fale com a nossa equipe.",
};

/**
 * Título com uma palavra de destaque entre asteriscos ("Um lugar *seu*") → partes para o itálico.
 * Sem asteriscos, o texto inteiro é uma parte normal.
 */
export function partesDoTitulo(titulo: string): { texto: string; destaque: boolean }[] {
  const partes: { texto: string; destaque: boolean }[] = [];
  const re = /\*([^*]+)\*/g;
  let i = 0;
  for (const m of titulo.matchAll(re)) {
    if (m.index! > i) partes.push({ texto: titulo.slice(i, m.index), destaque: false });
    partes.push({ texto: m[1], destaque: true });
    i = m.index! + m[0].length;
  }
  if (i < titulo.length) partes.push({ texto: titulo.slice(i), destaque: false });
  return partes.length ? partes : [{ texto: titulo, destaque: false }];
}

/** Título sem os asteriscos (para <title>, descrições e textos simples). */
export const tituloSimples = (titulo: string) => titulo.replace(/\*([^*]+)\*/g, "$1");

/**
 * Texto longo editável → blocos separados por linha em branco. Quando o bloco tem mais de uma linha,
 * a primeira é o título (seção "Por que reservar direto" da página inicial).
 */
export function blocosDoTexto(texto: string): { titulo: string | null; texto: string }[] {
  return texto
    .split(/\n\s*\n/)
    .map((b) => b.split("\n").map((l) => l.trim()).filter(Boolean))
    .filter((linhas) => linhas.length > 0)
    .map((linhas) => (linhas.length > 1 ? { titulo: linhas[0], texto: linhas.slice(1).join("\n") } : { titulo: null, texto: linhas[0] }));
}

export function validarTextosSite(bruto: Record<string, unknown>): { ok: true; textos: TextosSite } | { ok: false; erros: Partial<Record<ChaveTextoSite, string>> } {
  const textos = {} as TextosSite;
  const erros: Partial<Record<ChaveTextoSite, string>> = {};
  for (const c of CAMPOS_TEXTOS_SITE) {
    const v = typeof bruto[c.chave] === "string" ? (bruto[c.chave] as string).replace(/\r\n/g, "\n").trim() : "";
    if (v.length > c.limite) erros[c.chave] = `Máximo de ${c.limite} caracteres.`;
    textos[c.chave] = v;
  }
  for (const k of TEXTOS_SITE_OBRIGATORIOS) if (!textos[k] && !erros[k]) erros[k] = k === "titulo" ? "O título não pode ficar vazio." : "Este texto não pode ficar vazio.";
  return Object.keys(erros).length ? { ok: false, erros } : { ok: true, textos };
}

export async function lerTextosSite(db: Db, organizacaoId: string): Promise<TextosSite> {
  const c = (await lerConfig(db, organizacaoId, "textos_site")) ?? {};
  // "Por que reservar direto" se chamava "sobre" até o M7.6: o que foi escrito lá continua valendo; vazio dá o texto-base.
  if (typeof c.porque !== "string" && typeof c.sobre === "string" && c.sobre.trim()) c.porque = c.sobre;
  return Object.fromEntries(CAMPOS_TEXTOS_SITE.map((f) => [f.chave, typeof c[f.chave] === "string" ? c[f.chave] : TEXTOS_SITE_INICIAIS[f.chave]])) as TextosSite;
}

export async function salvarTextosSite(db: Db, organizacaoId: string, textos: TextosSite, autorId: string | null): Promise<boolean> {
  return db.transaction(async (tx) => Object.keys(await gravarConfig(tx, organizacaoId, "textos_site", { ...textos }, autorId)).length > 0);
}
