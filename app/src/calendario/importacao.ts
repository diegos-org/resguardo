/**
 * Importação dos preços do Beds24 para o SCL (M3.11a, requisitos/product/FONTE-UNICA-PRECOS.md 3.3 e 3.4). A proposta é
 * pura: das noites lidas do quarto vinculado, de hoje ao fim da leitura, saem o preço base e a estadia máxima propostos,
 * as noites a importar (o preço e o mínimo do Beds24), os avisos, as sugestões de temporada (só texto: nada é criado
 * sozinho), o resumo por mês e a assinatura da leitura usada (a mesma da cópia, `assinaturaDaLeitura`). `montarRevisao`
 * lê o banco, monta a proposta, confere pelo motor de verdade (`planejarImovel` com a substituição, sem gravar nada) em
 * quantas noites o SCL calcularia igual ao Beds24 e diz o que impede a aprovação. Nada aqui grava no banco nem fala com o
 * Beds24; aprovar e desfazer (3.5 e 3.6) leem daqui as mesmas regras.
 */
import { and, asc, count, eq, gte, inArray, max, min, sql } from "drizzle-orm";
import { beds24Calendario, imoveis, type NoiteCopiada, precosImportados, usuarios } from "@/db/schema";
import type { Db } from "@/db/types";
import { type Detalhes, fontesDePrecosDosImoveis, lerDetalhes } from "@/imoveis/detalhes";
import type { FontePrecos } from "@/imoveis/fonte-precos";
import { somarDias } from "@/imoveis/regras-venda";
import { dataBr, hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { limiteDaLeitura } from "@/site/disponibilidade";
import { assinaturaDaLeitura, type CopiaResumida, paraNoiteCopiada, ultimasCopias } from "./copias";
import { planejarImovel, quartoVinculado } from "./envio";
import { aplicarMultiplicador, type PrecoImportado } from "./motor";
import { centesimosParaMultiplicador, lerRegrasCalendario, type RegrasCalendario } from "./regras-config";

/** Uma noite lida do Beds24 (`beds24_calendario`), com o quarto lido. */
export type NoiteLida = { data: string; roomId: string | null; preco: number | null; minimoNoites: number | null; maximoNoites: number | null; livres: number | null; bloqueio: string | null };

export type EntradaProposta = {
  noites: readonly NoiteLida[];
  /** O quarto vinculado agora: noite de outro quarto não entra. Sem vínculo (null), nenhuma noite entra. */
  roomId: string | null;
  hoje: string;
  cadastro: { precoBase: number | null; estadiaMinima: number | null; estadiaMaxima: number | null };
  regras: Pick<RegrasCalendario, "estadiaMaxima">;
};
export type NoiteImportada = { data: string; preco: number; minimo: number | null };
export type SugestaoTemporada = { inicio: string; fim: string; noites: number; preco: number; multiplicador: number; texto: string };
export type ResumoDoMes = { mes: string; noites: number; menorPreco: number | null; maiorPreco: number | null; minimos: number[] };
export type PropostaImportacao = {
  roomId: string | null;
  /** As noites lidas usadas (do quarto vinculado, de hoje em diante), como a cópia as guarda; a aprovação guarda estas. */
  leitura: NoiteCopiada[];
  inicio: string | null;
  fim: string | null;
  precoBase: number | null;
  estadiaMaxima: number | null;
  /** A estadia máxima que vale hoje: a do cadastro, senão a de Configurações → Calendário e preços. */
  estadiaMaximaAtual: number;
  importar: NoiteImportada[];
  avisos: string[];
  /** Noites que não entram como estão (sem preço, preço zero, mínimo fora do limite), com o aviso de cada uma. */
  avisosNoites: { data: string; aviso: string }[];
  sugestoes: SugestaoTemporada[];
  meses: ResumoDoMes[];
  assinatura: string;
};

/** Mínimo e estadia máxima aceitos (os do cadastro do imóvel e o CHECK da camada importada). */
const NOITES_VALIDAS = [1, 365] as const;
const noitesValidas = (n: number) => Number.isInteger(n) && n >= NOITES_VALIDAS[0] && n <= NOITES_VALIDAS[1];
/** Trecho mínimo para sugerir uma temporada. */
const NOITES_SUGESTAO = 14;
/** Multiplicadores de evento que o motor aceita acima da base (centésimos; o evento só sobe o preço). */
const MULTIPLICADORES = [101, 1000] as const;

/** O valor que mais aparece; empate, o menor. Lista vazia, null. */
function maisComum(valores: readonly number[]): number | null {
  const vezes = new Map<number, number>();
  for (const v of valores) vezes.set(v, (vezes.get(v) ?? 0) + 1);
  let escolhido: number | null = null;
  for (const [v, n] of vezes) {
    const atual = escolhido === null ? 0 : vezes.get(escolhido)!;
    if (n > atual || (n === atual && v < escolhido!)) escolhido = v;
  }
  return escolhido;
}

/** O multiplicador inteiro de centésimos que, pela fórmula do motor, leva a base exatamente ao preço; nenhum, null. */
function multiplicadorExato(base: number, preco: number): number | null {
  for (let m = MULTIPLICADORES[0]; m <= MULTIPLICADORES[1]; m++) if (aplicarMultiplicador(base, m) === preco) return m;
  return null;
}

const listaDeNoites = (xs: readonly number[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} e ${xs.at(-1)}` : String(xs[0]));

/** A proposta da importação (3.3). Pura: mesma entrada, mesma saída. */
export function proporImportacao(e: EntradaProposta): PropostaImportacao {
  const usadas = e.roomId === null ? [] : e.noites.filter((n) => n.roomId === e.roomId && n.data >= e.hoje).sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  const leitura = usadas.map(paraNoiteCopiada);
  const avisos: string[] = [];
  const avisosNoites: { data: string; aviso: string }[] = [];
  const comPreco = usadas.filter((n): n is NoiteLida & { preco: number } => n.preco !== null && n.preco > 0);

  // Preço base: o que mais aparece entre os 25% de noites mais baratas (empate, o menor). Vale onde não houver importado.
  const precos = comPreco.map((n) => n.preco).sort((a, b) => a - b);
  const precoBase = maisComum(precos.slice(0, Math.ceil(precos.length / 4)));

  // Estadia máxima: a mais comum; mais de uma vira aviso (o SCL tem uma só por imóvel).
  const maximos = usadas.map((n) => n.maximoNoites).filter((m): m is number => m !== null);
  const maximosValidos = maximos.filter(noitesValidas);
  const estadiaMaxima = maisComum(maximosValidos);
  const distintos = [...new Set(maximosValidos)].sort((a, b) => a - b);
  if (maximos.length > maximosValidos.length) avisos.push(`Estadia máxima fora de 1 a 365 noites em ${maximos.length - maximosValidos.length} noite(s) do Beds24: não entra na proposta.`);
  if (distintos.length > 1) avisos.push(`O Beds24 tem mais de uma estadia máxima (${listaDeNoites(distintos)} noites). O SCL tem uma só: a proposta usa a mais comum, ${estadiaMaxima}.`);
  if (usadas.length && estadiaMaxima === null) avisos.push("Sem estadia máxima no Beds24: fica a que vale hoje no SCL.");
  if (estadiaMaxima !== null && e.cadastro.estadiaMinima !== null && estadiaMaxima < e.cadastro.estadiaMinima) avisos.push(`A estadia máxima proposta (${estadiaMaxima}) é menor que a mínima do cadastro (${e.cadastro.estadiaMinima}): confira antes de aprovar.`);

  // As noites a importar: toda noite com preço, com o mínimo do Beds24. Sem preço (ou zero), a noite não entra.
  const importar: NoiteImportada[] = [];
  for (const n of usadas) {
    if (n.preco === null) { avisosNoites.push({ data: n.data, aviso: "Sem preço no Beds24: o SCL usaria o preço base." }); continue; }
    if (n.preco <= 0) { avisosNoites.push({ data: n.data, aviso: "Preço zero no Beds24: não entra; o SCL usaria o preço base." }); continue; }
    const minimoValido = n.minimoNoites !== null && noitesValidas(n.minimoNoites);
    if (n.minimoNoites !== null && !minimoValido) avisosNoites.push({ data: n.data, aviso: `Mínimo de ${n.minimoNoites} noite(s) no Beds24, fora de 1 a 365: a noite fica com o mínimo do SCL.` });
    importar.push({ data: n.data, preco: n.preco, minimo: minimoValido ? n.minimoNoites : null });
  }
  if (usadas.length && !importar.length) avisos.push("Nenhuma noite com preço no Beds24: nada a importar.");

  // Sugestões de temporada (só texto): noites seguidas com o mesmo preço acima da base, em que um multiplicador inteiro
  // de centésimos reproduz o preço exato pela fórmula do motor.
  const sugestoes: SugestaoTemporada[] = [];
  const trechos: NoiteImportada[][] = [];
  for (const n of importar) {
    const ultimo = trechos.at(-1);
    if (ultimo && ultimo[0].preco === n.preco && somarDias(ultimo.at(-1)!.data, 1) === n.data) ultimo.push(n);
    else trechos.push([n]);
  }
  for (const t of trechos) {
    if (precoBase === null || t.length < NOITES_SUGESTAO || t[0].preco <= precoBase) continue;
    const m = multiplicadorExato(precoBase, t[0].preco);
    if (m === null) continue;
    const [inicio, fim] = [t[0].data, t.at(-1)!.data];
    sugestoes.push({ inicio, fim, noites: t.length, preco: t[0].preco, multiplicador: m, texto: `De ${dataBr(inicio)} a ${dataBr(fim)}, o preço é ${centesimosParaMultiplicador(m)}× a base: dá para criar um evento depois, em Configurações → Calendário e preços.` });
  }

  // Resumo por mês: noites, menor e maior preço e os mínimos.
  const porMes = new Map<string, NoiteLida[]>();
  for (const n of usadas) {
    const doMes = porMes.get(n.data.slice(0, 7));
    if (doMes) doMes.push(n);
    else porMes.set(n.data.slice(0, 7), [n]);
  }
  const meses = [...porMes].map(([mes, ns]): ResumoDoMes => {
    const ps = ns.map((n) => n.preco).filter((p): p is number => p !== null && p > 0);
    return {
      mes, noites: ns.length, menorPreco: ps.length ? Math.min(...ps) : null, maiorPreco: ps.length ? Math.max(...ps) : null,
      minimos: [...new Set(ns.map((n) => n.minimoNoites).filter((m): m is number => m !== null))].sort((a, b) => a - b),
    };
  });

  return {
    roomId: e.roomId, leitura, inicio: usadas[0]?.data ?? null, fim: usadas.at(-1)?.data ?? null, precoBase, estadiaMaxima,
    estadiaMaximaAtual: e.cadastro.estadiaMaxima ?? e.regras.estadiaMaxima, importar, avisos, avisosNoites, sugestoes, meses,
    assinatura: assinaturaDaLeitura(e.roomId, leitura),
  };
}

/** Por que a aprovação está bloqueada: a fonte de preços, o vínculo com o Beds24 ou a leitura (ausente ou vencida). */
export type BloqueioImportacao = "fonte" | "vinculo" | "sem_leitura" | "leitura_vencida";

/** Os bloqueios da aprovação, em linguagem simples: a tela os mostra e a ação recusa por eles. Uma regra, um lugar. */
export function bloqueiosDaImportacao(s: { fontePrecos: FontePrecos; roomId: string | null; noites: number; vencida: boolean; validadeHoras: number }): { motivo: BloqueioImportacao; texto: string }[] {
  const b: { motivo: BloqueioImportacao; texto: string }[] = [];
  if (s.fontePrecos !== "scl") b.push({ motivo: "fonte", texto: "A importação vale para preços automáticos do SCL. Mude a fonte na ficha do imóvel." });
  if (s.roomId === null) b.push({ motivo: "vinculo", texto: "O imóvel não tem um vínculo ativo e único com um quarto do Beds24. Confira em Configurações → Integrações." });
  else if (!s.noites) b.push({ motivo: "sem_leitura", texto: "Não há leitura do Beds24 deste quarto de hoje em diante. Leia em Configurações → Integrações → Importar agora, e volte aqui." });
  else if (s.vencida) b.push({ motivo: "leitura_vencida", texto: `A leitura do Beds24 tem mais de ${s.validadeHoras} horas. Leia de novo em Configurações → Integrações → Importar agora, e volte aqui.` });
  return b;
}

/** As noites lidas do quarto vinculado, de hoje em diante, com a hora de cada leitura. A revisão e a aprovação leem por aqui. */
export function lerLeituraDoQuarto(db: Db, org: string, imovelId: string, roomId: string, hoje: string) {
  return db
    .select({ data: beds24Calendario.data, roomId: beds24Calendario.roomId, preco: beds24Calendario.preco, minimoNoites: beds24Calendario.minimoNoites, maximoNoites: beds24Calendario.maximoNoites, livres: beds24Calendario.livres, bloqueio: beds24Calendario.bloqueio, observadoEm: beds24Calendario.observadoEm })
    .from(beds24Calendario)
    .where(and(eq(beds24Calendario.organizacaoId, org), eq(beds24Calendario.imovelId, imovelId), eq(beds24Calendario.roomId, roomId), gte(beds24Calendario.data, hoje)))
    .orderBy(asc(beds24Calendario.data));
}

/**
 * A leitura usada está vencida quando alguma das noites foi lida antes da validade de Configurações → Calendário e preços
 * ("site", em horas; a mesma régua do site, `limiteDaLeitura`): a proposta nunca mistura uma noite velha.
 */
export const leituraVencida = (noites: readonly { observadoEm: Date }[], regras: Pick<RegrasCalendario, "site">, agora: Date) => {
  const limite = limiteDaLeitura(regras, agora);
  return noites.some((n) => n.observadoEm.getTime() < limite);
};

export type DiferencaConferida = "preco" | "minimo" | "maximo";
/** Uma noite da conferência: o que o Beds24 tem, o que o SCL mandaria depois de aprovar e, se diferem, o motivo do plano. */
export type NoiteConferida = {
  data: string;
  precoBeds24: number | null; precoScl: number | null;
  minimoBeds24: number | null; minimoScl: number | null;
  maximoBeds24: number | null; maximoScl: number;
  diferencas: DiferencaConferida[];
  /** O resumo da regra do plano (`LinhaPlano.regra`): piso de última hora, período ou evento por cima, mínimo de sobra. */
  motivo: string;
};
export type ConferenciaImportacao = { iguais: number; total: number; noites: NoiteConferida[] };

export type RevisaoImportacao = {
  imovel: { id: string; codigo: string; fuso: string };
  hoje: string;
  fontePrecos: FontePrecos;
  roomId: string | null;
  /** A hora da leitura mais nova entre as noites usadas; null = sem leitura. */
  lidaEm: Date | null;
  validadeHoras: number;
  vencida: boolean;
  cadastro: { precoBase: number | null; estadiaMinima: number | null; estadiaMaxima: number | null };
  /** O que a conferência pôs no cadastro: a caixa "Usar como preço base" (e a da estadia máxima), marcada se não houver um. */
  usar: { precoBase: boolean; estadiaMaxima: boolean };
  proposta: PropostaImportacao;
  /** Só com a fonte scl e alguma noite lida: com outra fonte, a camada não valeria. */
  conferencia: ConferenciaImportacao | null;
  bloqueios: { motivo: BloqueioImportacao; texto: string }[];
};

/** O que a revisão e a aprovação leem do banco, pela mesma régua (uma regra, um lugar: as duas nunca divergem). */
export type LeituraDaImportacao = {
  imovel: { id: string; codigo: string; fuso: string };
  hoje: string;
  detalhes: Detalhes;
  regras: RegrasCalendario;
  roomId: string | null;
  /** As noites lidas do quarto vinculado, de hoje em diante, com a hora de cada leitura. */
  lidas: (NoiteLida & { observadoEm: Date })[];
  cadastro: RevisaoImportacao["cadastro"];
  proposta: PropostaImportacao;
  lidaEm: Date | null;
  vencida: boolean;
  validadeHoras: number;
  bloqueios: { motivo: BloqueioImportacao; texto: string }[];
};

/**
 * Lê o que a importação de um imóvel usa: o cadastro, a fonte, as regras, o quarto vinculado, as noites lidas desse quarto
 * de hoje em diante (no fuso do imóvel), a hora da leitura mais nova, a validade, a proposta e os bloqueios. A revisão lê
 * por aqui sem trava; a aprovação, na transação dela, com o imóvel travado. Imóvel de outra organização (ou id inválido): null.
 */
export async function lerImportacao(db: Db, org: string, imovelId: string, agora: Date): Promise<LeituraDaImportacao | null> {
  if (!uuidValido(imovelId)) return null;
  const [imovel] = await db.select({ id: imoveis.id, codigo: imoveis.codigo, fuso: imoveis.fuso }).from(imoveis).where(and(eq(imoveis.id, imovelId), eq(imoveis.organizacaoId, org)));
  if (!imovel) return null;
  const hoje = hojeISO(imovel.fuso, agora);
  const [detalhes, regras, roomId] = await Promise.all([lerDetalhes(db, org, imovel.id), lerRegrasCalendario(db, org), quartoVinculado(db, org, imovel.id)]);
  const lidas = roomId === null ? [] : await lerLeituraDoQuarto(db, org, imovel.id, roomId, hoje);
  const cadastro = { precoBase: detalhes.precoBase, estadiaMinima: detalhes.estadiaMinima, estadiaMaxima: detalhes.estadiaMaxima };
  const proposta = proporImportacao({ noites: lidas, roomId, hoje, cadastro, regras });
  const lidaEm = lidas.reduce<Date | null>((m, l) => (!m || l.observadoEm > m ? l.observadoEm : m), null);
  const vencida = leituraVencida(lidas, regras, agora);
  const validadeHoras = regras.site.validadeLeituraHoras;
  const bloqueios = bloqueiosDaImportacao({ fontePrecos: detalhes.fontePrecos, roomId, noites: lidas.length, vencida, validadeHoras });
  return { imovel, hoje, detalhes, regras, roomId, lidas, cadastro, proposta, lidaEm, vencida, validadeHoras, bloqueios };
}

/**
 * As caixas "Usar como preço base" e "Usar como estadia máxima": só com um valor proposto; sem pedido, marcada quando o
 * cadastro não tem o valor. A conferência da tela e a aprovação decidem por aqui o que vai para o cadastro.
 */
export function escolherUsar(proposta: Pick<PropostaImportacao, "precoBase" | "estadiaMaxima">, cadastro: Pick<RevisaoImportacao["cadastro"], "precoBase" | "estadiaMaxima">, pedido: Partial<RevisaoImportacao["usar"]> = {}): RevisaoImportacao["usar"] {
  return {
    precoBase: proposta.precoBase !== null && (pedido.precoBase ?? cadastro.precoBase === null),
    estadiaMaxima: proposta.estadiaMaxima !== null && (pedido.estadiaMaxima ?? cadastro.estadiaMaxima === null),
  };
}

/**
 * A revisão da importação de um imóvel (3.4), sem gravar nada: o que `lerImportacao` lê, as caixas da tela, a conferência
 * pelo motor e os bloqueios da aprovação. `o.usar`: as caixas da tela (ausente, marcada se o cadastro não tiver o valor).
 * Imóvel de outra organização (ou id inválido): null.
 */
export async function montarRevisao(db: Db, org: string, imovelId: string, agora = new Date(), o: { usar?: Partial<RevisaoImportacao["usar"]> } = {}): Promise<RevisaoImportacao | null> {
  const l = await lerImportacao(db, org, imovelId, agora);
  if (!l) return null;
  const { imovel, hoje, detalhes, regras, roomId, lidas, cadastro, proposta } = l;
  const usar = escolherUsar(proposta, cadastro, o.usar);

  let conferencia: ConferenciaImportacao | null = null;
  if (detalhes.fontePrecos === "scl" && roomId !== null && proposta.fim !== null) {
    // O motor de verdade com o cadastro proposto e a camada nova (importada hoje), e as regras, pisos, reservas e
    // bloqueios de hoje; nada é gravado. Comparado com a leitura: o que o SCL mandaria ao Beds24 em cada noite.
    const importados = new Map<string, PrecoImportado>(proposta.importar.map((n) => [n.data, { preco: n.preco, minimo: n.minimo, em: hoje }]));
    const plano = await planejarImovel(db, org, regras, { id: imovel.id, fuso: imovel.fuso, roomId }, agora, { inicio: hoje, fim: proposta.fim }, {
      paraOBeds24: true,
      substituir: { ...(usar.precoBase ? { precoBase: proposta.precoBase } : {}), ...(usar.estadiaMaxima ? { estadiaMaxima: proposta.estadiaMaxima } : {}), importados },
    });
    const porData = new Map(lidas.map((n) => [n.data, n]));
    const noites = plano.linhas.flatMap((linha): NoiteConferida[] => {
      const b = porData.get(linha.data);
      if (!b) return [];
      const diferencas: DiferencaConferida[] = [];
      if (b.preco !== linha.precoEnviar) diferencas.push("preco");
      if (b.minimoNoites !== linha.minimoEnviar) diferencas.push("minimo");
      if (b.maximoNoites !== linha.maximoEnviar) diferencas.push("maximo");
      return [{ data: linha.data, precoBeds24: b.preco, precoScl: linha.precoEnviar, minimoBeds24: b.minimoNoites, minimoScl: linha.minimoEnviar, maximoBeds24: b.maximoNoites, maximoScl: linha.maximoEnviar, diferencas, motivo: diferencas.length ? linha.regra : "" }];
    });
    conferencia = { iguais: noites.filter((n) => !n.diferencas.length).length, total: noites.length, noites };
  }

  return { imovel, hoje, fontePrecos: detalhes.fontePrecos, roomId, lidaEm: l.lidaEm, validadeHoras: l.validadeHoras, vencida: l.vencida, cadastro, usar, proposta, conferencia, bloqueios: l.bloqueios };
}

/** O que já foi importado num imóvel, de `desde` em diante: noites, intervalo, quando foi a última importação e por quem. */
export type ResumoImportados = { noites: number; inicio: string; fim: string; em: Date; autorId: string | null };

/** O resumo dos preços importados por imóvel da organização (a lista da importação e a ficha do imóvel leem daqui). */
export async function resumoDosImportados(db: Db, org: string, desde: string, imovelIds?: readonly string[]): Promise<Map<string, ResumoImportados>> {
  if (imovelIds && !imovelIds.length) return new Map();
  const p = precosImportados;
  const linhas = await db
    .select({
      imovelId: p.imovelId, noites: count(), inicio: min(p.data), fim: max(p.data), em: max(p.criadoEm),
      autorId: sql<string | null>`(array_agg(${p.autorId} order by ${p.criadoEm} desc))[1]`,
    })
    .from(p)
    .where(and(eq(p.organizacaoId, org), gte(p.data, desde), imovelIds ? inArray(p.imovelId, [...imovelIds]) : undefined))
    .groupBy(p.imovelId);
  return new Map(linhas.map((l) => [l.imovelId, { noites: l.noites, inicio: l.inicio!, fim: l.fim!, em: l.em!, autorId: l.autorId }]));
}

/** A hora da leitura do Beds24 mais nova de cada imóvel da organização (de qualquer quarto, todas as noites guardadas). */
export async function ultimasLeituras(db: Db, org: string, imovelIds: readonly string[]): Promise<Map<string, Date>> {
  if (!imovelIds.length) return new Map();
  const linhas = await db
    .select({ imovelId: beds24Calendario.imovelId, lidaEm: max(beds24Calendario.observadoEm) })
    .from(beds24Calendario)
    .where(and(eq(beds24Calendario.organizacaoId, org), inArray(beds24Calendario.imovelId, [...imovelIds])))
    .groupBy(beds24Calendario.imovelId);
  return new Map(linhas.flatMap((l) => (l.lidaEm ? [[l.imovelId, l.lidaEm] as const] : [])));
}

/** Uma linha da lista da importação: o imóvel, a fonte, a última leitura, o que já foi importado de hoje em diante e a última cópia. */
export type ImovelNaImportacao = {
  id: string; codigo: string; nome: string; fuso: string; fontePrecos: FontePrecos;
  lidaEm: Date | null;
  importados: (ResumoImportados & { autor: string | null }) | null;
  ultimaCopia: CopiaResumida | null;
};

/**
 * A lista da importação (3.4): os imóveis ativos da organização, cada um com a fonte de preços, a hora da última leitura, o
 * resumo do que foi importado de hoje em diante (no fuso do imóvel), com o nome de quem importou, e a última cópia.
 */
export async function listarImportacoes(db: Db, org: string, agora = new Date()): Promise<ImovelNaImportacao[]> {
  const lista = await db.select({ id: imoveis.id, codigo: imoveis.codigo, nome: imoveis.nome, fuso: imoveis.fuso }).from(imoveis).where(and(eq(imoveis.organizacaoId, org), eq(imoveis.ativo, true))).orderBy(asc(imoveis.codigo));
  const ids = lista.map((i) => i.id);
  // "De hoje em diante" no fuso de cada imóvel: um resumo por dia de hoje (quase sempre um só).
  const porHoje = new Map<string, string[]>();
  for (const i of lista) {
    const hoje = hojeISO(i.fuso, agora);
    porHoje.set(hoje, [...(porHoje.get(hoje) ?? []), i.id]);
  }
  const [fontes, leituras, copias, ...resumos] = await Promise.all([
    fontesDePrecosDosImoveis(db, org, ids), ultimasLeituras(db, org, ids), ultimasCopias(db, org, ids),
    ...[...porHoje].map(([hoje, doDia]) => resumoDosImportados(db, org, hoje, doDia)),
  ]);
  const importados = new Map(resumos.flatMap((r) => [...r]));
  const autorIds = [...new Set([...importados.values()].map((r) => r.autorId).filter((a): a is string => a !== null))];
  const nomes = new Map(autorIds.length ? (await db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(and(eq(usuarios.organizacaoId, org), inArray(usuarios.id, autorIds)))).map((u) => [u.id, u.nome]) : []);
  return lista.map((i) => {
    const r = importados.get(i.id);
    return {
      id: i.id, codigo: i.codigo, nome: i.nome, fuso: i.fuso, fontePrecos: fontes.get(i.id) ?? "scl", lidaEm: leituras.get(i.id) ?? null,
      importados: r ? { ...r, autor: r.autorId ? (nomes.get(r.autorId) ?? null) : null } : null, ultimaCopia: copias.get(i.id) ?? null,
    };
  });
}
