/**
 * Página para proprietários do site (`/anunciar`, M7.7): textos editáveis no painel (Configurações → Página para
 * proprietários), com texto-base para Diego revisar, e a faixa de mercado.
 *
 * Faixa de mercado: números de referência por tipo de imóvel (diária média, ocupação e, se houver, o líquido mensal
 * estimado). Só entram dados reais, conferidos e digitados por Diego, com o mês a que se referem; a página sempre
 * mostra que é estimativa, sem garantia. Sem linhas (ou sem o mês), a seção não aparece: nunca há número de exemplo.
 */
import type { Db } from "@/db/types";
import { reaisParaCentavos } from "@/lib/dinheiro-form";
import { percentualParaBp } from "@/lib/percentual";
import { gravarConfig, lerConfig } from "./armazem";

export const CAMPOS_TEXTOS_PROPRIETARIOS = [
  { chave: "olho", rotulo: "Capa: olho (linha pequena acima do título)", limite: 60, linhas: 1 },
  { chave: "titulo", rotulo: "Capa: título (a parte entre *asteriscos* sai em itálico)", limite: 120, linhas: 1 },
  { chave: "subtitulo", rotulo: "Capa: frase abaixo do título", limite: 240, linhas: 2 },
  { chave: "ofertasOlho", rotulo: "Formas de trabalhar: olho", limite: 60, linhas: 1 },
  { chave: "ofertasTitulo", rotulo: "Formas de trabalhar: título (a parte entre *asteriscos* sai em itálico)", limite: 120, linhas: 1 },
  { chave: "gestaoTitulo", rotulo: "Gestão completa: nome", limite: 60, linhas: 1 },
  { chave: "gestaoTexto", rotulo: "Gestão completa: o que é", limite: 600, linhas: 3 },
  { chave: "marketplaceTitulo", rotulo: "Marketplace: nome", limite: 60, linhas: 1 },
  { chave: "marketplaceTexto", rotulo: "Marketplace: o que é", limite: 600, linhas: 3 },
  { chave: "comoOlho", rotulo: "Como gerimos: olho", limite: 60, linhas: 1 },
  { chave: "comoTitulo", rotulo: "Como gerimos: título (a parte entre *asteriscos* sai em itálico)", limite: 120, linhas: 1 },
  {
    chave: "como",
    rotulo: "Como gerimos (um passo por bloco, separados por linha em branco; a primeira linha do bloco é o título). Vazio = a seção não aparece",
    limite: 2000,
    linhas: 8,
  },
  { chave: "vitrineTitulo", rotulo: "Vitrine dos imóveis: título (a parte entre *asteriscos* sai em itálico)", limite: 80, linhas: 1 },
  { chave: "portfolioOlho", rotulo: "Portfólio: olho", limite: 60, linhas: 1 },
  { chave: "portfolioTitulo", rotulo: "Portfólio: título (a parte entre *asteriscos* sai em itálico). Vazio = a seção não aparece", limite: 120, linhas: 1 },
  { chave: "portfolioTexto", rotulo: "Portfólio: texto", limite: 800, linhas: 3 },
  { chave: "mercadoOlho", rotulo: "Faixa de mercado: olho", limite: 60, linhas: 1 },
  { chave: "mercadoTitulo", rotulo: "Faixa de mercado: título (os números ficam no formulário abaixo)", limite: 120, linhas: 1 },
  { chave: "contatoOlho", rotulo: "Pedido de contato (gestão completa): olho", limite: 60, linhas: 1 },
  { chave: "contatoTitulo", rotulo: "Pedido de contato: título (a parte entre *asteriscos* sai em itálico)", limite: 120, linhas: 1 },
  { chave: "contatoTexto", rotulo: "Pedido de contato: frase acima do formulário", limite: 400, linhas: 2 },
  { chave: "cadastroOlho", rotulo: "Cadastro no marketplace: olho", limite: 60, linhas: 1 },
  { chave: "cadastroTitulo", rotulo: "Cadastro no marketplace: título (a parte entre *asteriscos* sai em itálico)", limite: 120, linhas: 1 },
  { chave: "cadastroTexto", rotulo: "Cadastro no marketplace: frase acima do formulário", limite: 400, linhas: 2 },
] as const;
export type ChaveTextoProprietarios = (typeof CAMPOS_TEXTOS_PROPRIETARIOS)[number]["chave"];
export type TextosProprietarios = Record<ChaveTextoProprietarios, string>;

/** Texto-base (M7.7) para Diego revisar perto da entrada no ar: só o que a empresa de fato faz (o mesmo do "Como funciona"). */
export const TEXTOS_PROPRIETARIOS_INICIAIS: TextosProprietarios = {
  olho: "Para proprietários",
  titulo: "Seu imóvel bem cuidado, *sem dor de cabeça*.",
  subtitulo: "Gestão de aluguel por temporada no Leblon, do anúncio ao repasse. Ou só a parte online, no marketplace. Você escolhe.",
  ofertasOlho: "Duas formas de trabalhar juntos",
  ofertasTitulo: "Do jeito que fizer *sentido para você*.",
  gestaoTitulo: "Gestão completa",
  gestaoTexto:
    "Cuidamos de tudo: anúncio nos canais, preços, atendimento ao hóspede, limpeza, manutenção, recebimento e repasse. Você acompanha as reservas, o extrato e os repasses pelo portal.",
  marketplaceTitulo: "Marketplace",
  marketplaceTexto:
    "Você continua no comando do imóvel: cuida da limpeza e das chaves e define os preços pelo portal. Nós vendemos pelo nosso site, recebemos o pagamento e repassamos a sua parte.",
  comoOlho: "Como gerimos",
  comoTitulo: "Do anúncio ao repasse, *cada detalhe*.",
  como: [
    "Anúncio e preço\nAnunciamos no Airbnb, no Booking e no nosso site, com o preço de cada data ajustado à procura.",
    "Atendimento ao hóspede\nRespondemos antes, durante e depois da estadia, e combinamos a chegada com cada hóspede.",
    "Limpeza e manutenção\nOrganizamos a limpeza a cada saída e cuidamos dos reparos, com o registro de tudo.",
    "Dinheiro e relatórios\nRecebemos, repassamos a sua parte e mandamos o relatório do mês. No portal, você vê cada reserva e cada repasse.",
  ].join("\n\n"),
  vitrineTitulo: "Imóveis que *cuidamos*.",
  portfolioOlho: "Portfólio pequeno, de propósito",
  portfolioTitulo: "Poucos imóveis, *muito cuidado*.",
  portfolioTexto:
    "Cuidamos de poucos imóveis, no Leblon e arredores, para conhecer cada um de perto. Por isso, analisamos cada pedido com calma antes de começar.",
  mercadoOlho: "Números de referência",
  mercadoTitulo: "O que o mercado tem mostrado.",
  contatoOlho: "Gestão completa",
  contatoTitulo: "Peça uma análise do *seu imóvel*.",
  contatoTexto: "Conte um pouco sobre o imóvel. A equipe analisa e responde pelo e-mail ou pelo WhatsApp, sem compromisso.",
  cadastroOlho: "Marketplace",
  cadastroTitulo: "Cadastre seu imóvel no *marketplace*.",
  cadastroTexto: "Mande os dados do seu imóvel. A nossa equipe analisa e responde por e-mail. Nada é publicado antes dessa análise.",
};

/** Títulos que não podem ficar vazios (o painel marca como obrigatórios). */
export const TEXTOS_PROPRIETARIOS_OBRIGATORIOS: readonly ChaveTextoProprietarios[] = ["titulo", "gestaoTitulo", "marketplaceTitulo", "contatoTitulo", "cadastroTitulo"];
const textoLimpo = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "");

export function validarTextosProprietarios(
  bruto: Record<string, unknown>,
): { ok: true; textos: TextosProprietarios } | { ok: false; erros: Partial<Record<ChaveTextoProprietarios, string>> } {
  const textos = {} as TextosProprietarios;
  const erros: Partial<Record<ChaveTextoProprietarios, string>> = {};
  for (const c of CAMPOS_TEXTOS_PROPRIETARIOS) {
    const v = textoLimpo(bruto[c.chave]);
    if (v.length > c.limite) erros[c.chave] = `Máximo de ${c.limite} caracteres.`;
    else if (!v && TEXTOS_PROPRIETARIOS_OBRIGATORIOS.includes(c.chave)) erros[c.chave] = "Este título não pode ficar vazio.";
    textos[c.chave] = v;
  }
  return Object.keys(erros).length ? { ok: false, erros } : { ok: true, textos };
}

/** O que foi salvo; campo nunca salvo fica com o texto-base. */
export async function lerTextosProprietarios(db: Db, organizacaoId: string): Promise<TextosProprietarios> {
  const c = (await lerConfig(db, organizacaoId, "textos_proprietarios")) ?? {};
  return Object.fromEntries(CAMPOS_TEXTOS_PROPRIETARIOS.map((f) => [f.chave, typeof c[f.chave] === "string" ? c[f.chave] : TEXTOS_PROPRIETARIOS_INICIAIS[f.chave]])) as TextosProprietarios;
}

export async function salvarTextosProprietarios(db: Db, organizacaoId: string, textos: TextosProprietarios, autorId: string | null): Promise<boolean> {
  return db.transaction(async (tx) => Object.keys(await gravarConfig(tx, organizacaoId, "textos_proprietarios", { ...textos }, autorId)).length > 0);
}

// --- Faixa de mercado -------------------------------------------------------------------

/** Linhas do formulário do painel (as vazias são ignoradas). */
export const LINHAS_MERCADO = 6;
export const LIMITES_MERCADO = { tipo: 40, fonte: 160, diariaMaxima: 10_000_000 } as const;

export type LinhaMercado = {
  /** Tipo de imóvel (ex.: "Studio", "2 quartos"). */
  tipo: string;
  /** Diária média, em centavos. */
  diaria: number;
  /** Ocupação média, em pontos-base (7000 = 70%). */
  ocupacao: number;
  /** Líquido mensal estimado para o proprietário, em centavos (null = não informado). */
  liquido: number | null;
};
export type MercadoProprietarios = {
  /** Mês a que os números se referem (AAAA-MM). */
  referencia: string;
  /** De onde vêm os números (ex.: "reservas dos imóveis que administramos"). */
  fonte: string;
  linhas: LinhaMercado[];
};
export const MERCADO_VAZIO: MercadoProprietarios = { referencia: "", fonte: "", linhas: [] };

export type ErrosMercado = Record<string, string>;
const MES = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Formulário do painel → faixa de mercado. Uma linha começada precisa de tipo, diária e ocupação. */
export function validarMercado(bruto: Record<string, unknown>): { ok: true; mercado: MercadoProprietarios } | { ok: false; erros: ErrosMercado } {
  const erros: ErrosMercado = {};
  const linhas: LinhaMercado[] = [];
  for (let i = 0; i < LINHAS_MERCADO; i++) {
    const [tipo, diariaT, ocupacaoT, liquidoT] = ["tipo", "diaria", "ocupacao", "liquido"].map((k) => textoLimpo(bruto[`${k}_${i}`]));
    if (!tipo && !diariaT && !ocupacaoT && !liquidoT) continue;
    if (!tipo) erros[`tipo_${i}`] = "Informe o tipo de imóvel (ex.: Studio, 2 quartos).";
    else if (tipo.length > LIMITES_MERCADO.tipo) erros[`tipo_${i}`] = `Máximo de ${LIMITES_MERCADO.tipo} caracteres.`;
    const diaria = reaisParaCentavos(diariaT);
    if (diaria === null) erros[`diaria_${i}`] = "Informe a diária média.";
    else if (diaria === undefined || diaria <= 0 || diaria > LIMITES_MERCADO.diariaMaxima) erros[`diaria_${i}`] = "Valor em reais, maior que zero (ex.: 650 ou 650,00).";
    const ocupacao = ocupacaoT ? percentualParaBp(ocupacaoT.replace(/%$/, "")) : null;
    if (!ocupacaoT) erros[`ocupacao_${i}`] = "Informe a ocupação média.";
    else if (ocupacao === null || ocupacao === 0) erros[`ocupacao_${i}`] = "Percentual de 1 a 100 (ex.: 72 ou 72,5).";
    const liquido = reaisParaCentavos(liquidoT);
    if (liquido === undefined || (liquido !== null && liquido > LIMITES_MERCADO.diariaMaxima * 31)) erros[`liquido_${i}`] = "Valor em reais (ex.: 6.800 ou 6800,00), ou deixe vazio.";
    if (tipo && typeof diaria === "number" && diaria > 0 && ocupacao) linhas.push({ tipo, diaria, ocupacao, liquido: liquido ?? null });
  }
  const referencia = textoLimpo(bruto.referencia);
  const fonte = textoLimpo(bruto.fonte);
  const comNumeros = linhas.length > 0 || Object.keys(erros).length > 0;
  if (referencia && !MES.test(referencia)) erros.referencia = "Escolha o mês (AAAA-MM).";
  else if (comNumeros && !referencia) erros.referencia = "Informe o mês a que os números se referem.";
  if (fonte.length > LIMITES_MERCADO.fonte) erros.fonte = `Máximo de ${LIMITES_MERCADO.fonte} caracteres.`;
  else if (comNumeros && !fonte) erros.fonte = "Diga de onde vêm os números (ex.: reservas dos imóveis que administramos).";
  return Object.keys(erros).length ? { ok: false, erros } : { ok: true, mercado: { referencia, fonte, linhas } };
}

/** Leitura tolerante: linha estranha (gravada à mão ou por versão antiga) fica de fora em vez de virar número errado. */
export function mercadoDeJson(v: Record<string, unknown> | null): MercadoProprietarios {
  if (!v) return MERCADO_VAZIO;
  const inteiro = (x: unknown, min: number, max: number) => (typeof x === "number" && Number.isSafeInteger(x) && x >= min && x <= max ? x : null);
  const linhas = (Array.isArray(v.linhas) ? v.linhas : []).flatMap((l): LinhaMercado[] => {
    if (!l || typeof l !== "object") return [];
    const o = l as Record<string, unknown>;
    const tipo = textoLimpo(o.tipo).slice(0, LIMITES_MERCADO.tipo);
    const diaria = inteiro(o.diaria, 1, LIMITES_MERCADO.diariaMaxima);
    const ocupacao = inteiro(o.ocupacao, 1, 10_000);
    if (!tipo || diaria === null || ocupacao === null) return [];
    return [{ tipo, diaria, ocupacao, liquido: inteiro(o.liquido, 0, LIMITES_MERCADO.diariaMaxima * 31) }];
  });
  const referencia = typeof v.referencia === "string" && MES.test(v.referencia) ? v.referencia : "";
  return { referencia, fonte: textoLimpo(v.fonte).slice(0, LIMITES_MERCADO.fonte), linhas: linhas.slice(0, LINHAS_MERCADO) };
}

export async function lerMercado(db: Db, organizacaoId: string): Promise<MercadoProprietarios> {
  return mercadoDeJson(await lerConfig(db, organizacaoId, "mercado_proprietarios"));
}

export async function salvarMercado(db: Db, organizacaoId: string, mercado: MercadoProprietarios, autorId: string | null): Promise<boolean> {
  return db.transaction(async (tx) => Object.keys(await gravarConfig(tx, organizacaoId, "mercado_proprietarios", { ...mercado, linhas: mercado.linhas.map((l) => ({ ...l })) }, autorId)).length > 0);
}

/** A seção da página só aparece com números reais e o mês a que se referem. */
export const mercadoParaMostrar = (m: MercadoProprietarios): MercadoProprietarios | null => (m.linhas.length > 0 && m.referencia && m.fonte ? m : null);

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
/** "2026-09" → "setembro de 2026". */
export const mesPorExtenso = (referencia: string): string => {
  const m = MES.exec(referencia);
  return m ? `${MESES[Number(m[2]) - 1]} de ${m[1]}` : "";
};

/** Linhas → campos do formulário do painel (as vazias completam as 6). */
export function camposDoMercado(m: MercadoProprietarios): Record<string, string> {
  const reais = (c: number) => `${Math.trunc(c / 100).toLocaleString("pt-BR")}${c % 100 ? `,${String(c % 100).padStart(2, "0")}` : ""}`;
  const campos: Record<string, string> = { referencia: m.referencia, fonte: m.fonte };
  for (let i = 0; i < LINHAS_MERCADO; i++) {
    const l = m.linhas[i];
    campos[`tipo_${i}`] = l?.tipo ?? "";
    campos[`diaria_${i}`] = l ? reais(l.diaria) : "";
    campos[`ocupacao_${i}`] = l ? (l.ocupacao / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "";
    campos[`liquido_${i}`] = l?.liquido != null ? reais(l.liquido) : "";
  }
  return campos;
}
