/**
 * Cadastro completo do imóvel (M2.6): leitura, validação e gravação dos detalhes e dos
 * períodos de exceção. Tudo com histórico e preso à organização.
 */
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { calcularMudancas, registrarAuditoria } from "@/auditoria/auditoria";
import { imoveis, imoveisDetalhes, imoveisPeriodos } from "@/db/schema";
import type { Db } from "@/db/types";
import { lerHora } from "@/lib/datas";
import { centavosParaCampo, reaisParaCentavos } from "@/lib/dinheiro-form";
import { uuidValido } from "@/lib/ids";
import { dataValida } from "@/reservas/regras";
import { HORARIOS_PADRAO } from "@/site/regras-da-casa";
import { COMODIDADES, TIPOS_CAMA } from "./cadastro-opcoes";
import { esperarEnvioBeds24 } from "@/beds24/trava";
import { type FontePrecos, fontePrecosValida } from "./fonte-precos";
import type { Periodo, RegrasVenda } from "./regras-venda";

export { COMODIDADES, TIPOS_CAMA, type TipoCama } from "./cadastro-opcoes";

export type Detalhes = Omit<typeof imoveisDetalhes.$inferSelect, "imovelId" | "organizacaoId" | "atualizadoEm">;
export type ErrosDetalhes = Partial<Record<keyof Detalhes | "comodidadesOutras", string>>;

export const DETALHES_VAZIOS: Detalhes = {
  cep: "",
  complemento: "",
  estado: "",
  camas: {},
  comodidades: [],
  regrasCasa: "",
  aceitaAnimais: false,
  permiteFumar: false,
  permiteFestas: false,
  // Os horários padrão do sistema (M7.20: um lugar só, `HORARIOS_PADRAO`).
  checkinAPartirDe: HORARIOS_PADRAO.entrada,
  checkoutAte: HORARIOS_PADRAO.saida,
  taxaLimpeza: null,
  hospedeExtraValor: null,
  hospedeExtraAPartirDe: null,
  estadiaMinima: null,
  estadiaMaxima: null,
  antecedenciaMinima: null,
  janelaMaxima: null,
  diasChegada: [],
  diasSaida: [],
  precoBase: null,
  precoDinamico: false,
  precoMinimo: null,
  precoMaximo: null,
  fontePrecos: "scl",
  pisoUltimaHora1: null,
  pisoUltimaHora2: null,
};

export const regrasDeVenda = (d: Detalhes): RegrasVenda => ({
  estadiaMinima: d.estadiaMinima,
  estadiaMaxima: d.estadiaMaxima,
  antecedenciaMinima: d.antecedenciaMinima,
  janelaMaxima: d.janelaMaxima,
  diasChegada: d.diasChegada,
  diasSaida: d.diasSaida,
  precoBase: d.precoBase,
  precoDinamico: d.precoDinamico,
  precoMinimo: d.precoMinimo,
  precoMaximo: d.precoMaximo,
  taxaLimpeza: d.taxaLimpeza,
  hospedeExtraValor: d.hospedeExtraValor,
  hospedeExtraAPartirDe: d.hospedeExtraAPartirDe,
});

type Entrada = Record<string, unknown>;
/** R$ 1 milhão: bem abaixo do limite da coluna integer do Postgres (≈ R$ 21 milhões). */
const VALOR_MAXIMO = 100_000_000;
const txt = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const lista = (v: unknown): string[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x): x is string => typeof x === "string");
const marcado = (v: unknown) => v === "on" || v === "true" || v === true;

/**
 * Lê o formulário. Campos repetidos (comodidades, dias) chegam como lista. Números e
 * valores vazios = "não cadastrado" (null), nunca zero.
 */
export function validarDetalhes(e: Entrada): { ok: true; dados: Detalhes } | { ok: false; erros: ErrosDetalhes } {
  const erros: ErrosDetalhes = {};
  const inteiro = (campo: keyof Detalhes, min: number, max: number): number | null => {
    const v = txt(e[campo]);
    if (v === "") return null;
    if (!/^\d+$/.test(v) || Number(v) < min || Number(v) > max) {
      erros[campo] = `Número inteiro entre ${min} e ${max}.`;
      return null;
    }
    return Number(v);
  };
  const dinheiro = (campo: keyof Detalhes): number | null => {
    const c = reaisParaCentavos(txt(e[campo]));
    if (c === undefined) {
      erros[campo] = "Valor inválido (ex.: 250,00).";
      return null;
    }
    if (c !== null && c > VALOR_MAXIMO) erros[campo] = "Valor alto demais.";
    return c;
  };
  // Em branco = o horário padrão da casa; "9:00" e "15h" gravam "09:00" e "15:00" (M7.22).
  const hora = (campo: "checkinAPartirDe" | "checkoutAte", padrao: string) => {
    const v = txt(e[campo]);
    if (v === "") return padrao;
    const h = lerHora(v);
    if (!h) erros[campo] = "Use o formato 15:00 (24 horas).";
    return h ?? v;
  };
  const dias = (campo: "diasChegada" | "diasSaida") => {
    const v = lista(e[campo]);
    if (v.some((d) => !/^[0-6]$/.test(d))) erros[campo] = "Dia da semana inválido.";
    const ds = [...new Set(v.filter((d) => /^[0-6]$/.test(d)).map(Number))].sort();
    // Todos marcados = sem restrição.
    return ds.length === 7 ? [] : ds;
  };

  const camas: Record<string, number> = {};
  for (const tipo of Object.keys(TIPOS_CAMA)) {
    const v = txt(e[`cama_${tipo}`]);
    if (v === "" || v === "0") continue;
    if (!/^\d+$/.test(v) || Number(v) > 20) erros.camas = "Quantidade de camas: número de 0 a 20.";
    else camas[tipo] = Number(v);
  }
  const outras = txt(e.comodidadesOutras)
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (outras.some((o) => o.length > 60)) erros.comodidadesOutras = "Cada comodidade com até 60 caracteres.";
  const comodidades = [...new Set([...lista(e.comodidades).filter((c) => (COMODIDADES as readonly string[]).includes(c)), ...outras])];
  if (comodidades.length > 60) erros.comodidades = "Comodidades demais (máx. 60).";

  const estado = txt(e.estado).toUpperCase();
  if (estado && !/^[A-Z]{2}$/.test(estado)) erros.estado = "Use a sigla (ex.: RJ).";
  const cep = txt(e.cep);
  if (cep && !/^\d{5}-?\d{3}$/.test(cep)) erros.cep = "CEP com 8 números (ex.: 22440-000).";
  const complemento = txt(e.complemento);
  if (complemento.length > 120) erros.complemento = "Máximo de 120 caracteres.";
  const regrasCasa = txt(e.regrasCasa).replace(/\r\n/g, "\n");
  if (regrasCasa.length > 4000) erros.regrasCasa = "Máximo de 4000 caracteres.";
  // Fonte de preços (M3.9): campo ausente = padrão (SCL); valor desconhecido é erro, nunca palpite.
  const fonteTxt = txt(e.fontePrecos) || "scl";
  if (!fontePrecosValida(fonteTxt)) erros.fontePrecos = "Escolha uma das fontes de preço.";

  const dados: Detalhes = {
    cep: cep && cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep,
    complemento,
    estado,
    camas,
    comodidades,
    regrasCasa,
    aceitaAnimais: marcado(e.aceitaAnimais),
    permiteFumar: marcado(e.permiteFumar),
    permiteFestas: marcado(e.permiteFestas),
    checkinAPartirDe: hora("checkinAPartirDe", HORARIOS_PADRAO.entrada),
    checkoutAte: hora("checkoutAte", HORARIOS_PADRAO.saida),
    taxaLimpeza: dinheiro("taxaLimpeza"),
    hospedeExtraValor: dinheiro("hospedeExtraValor"),
    hospedeExtraAPartirDe: inteiro("hospedeExtraAPartirDe", 1, 50),
    estadiaMinima: inteiro("estadiaMinima", 1, 365),
    estadiaMaxima: inteiro("estadiaMaxima", 1, 365),
    antecedenciaMinima: inteiro("antecedenciaMinima", 0, 365),
    janelaMaxima: inteiro("janelaMaxima", 1, 1095),
    diasChegada: dias("diasChegada"),
    diasSaida: dias("diasSaida"),
    precoBase: dinheiro("precoBase"),
    precoDinamico: marcado(e.precoDinamico),
    precoMinimo: dinheiro("precoMinimo"),
    precoMaximo: dinheiro("precoMaximo"),
    fontePrecos: fontePrecosValida(fonteTxt) ? fonteTxt : "scl",
    pisoUltimaHora1: dinheiro("pisoUltimaHora1"),
    pisoUltimaHora2: dinheiro("pisoUltimaHora2"),
  };
  if (dados.estadiaMinima !== null && dados.estadiaMaxima !== null && dados.estadiaMaxima < dados.estadiaMinima) {
    erros.estadiaMaxima = "A máxima não pode ser menor que a mínima.";
  }
  if (dados.precoMinimo !== null && dados.precoMaximo !== null && dados.precoMaximo < dados.precoMinimo) {
    erros.precoMaximo = "O máximo não pode ser menor que o mínimo.";
  }
  if ((dados.hospedeExtraValor === null) !== (dados.hospedeExtraAPartirDe === null)) {
    erros.hospedeExtraAPartirDe = "Preencha o valor e a partir de quantos hóspedes (ou deixe os dois em branco).";
  }
  if (dados.pisoUltimaHora1 !== null && dados.pisoUltimaHora2 !== null && dados.pisoUltimaHora2 > dados.pisoUltimaHora1) {
    erros.pisoUltimaHora2 = "O piso da 2ª faixa (mais perto da data) não pode ser maior que o da 1ª.";
  }
  if (dados.precoDinamico && (dados.precoMinimo === null || dados.precoMaximo === null)) {
    erros.precoDinamico = "Com o preço dinâmico ligado, informe o preço mínimo e o máximo.";
  }
  return Object.keys(erros).length ? { ok: false, erros } : { ok: true, dados };
}

/**
 * O inverso de `validarDetalhes`: o cadastro como um formulário preenchido. Serve para editar só
 * alguns campos (portal do proprietário, M12.4) passando pela mesma validação do painel — uma
 * regra, um lugar. `validarDetalhes(entradaDeDetalhes(d))` devolve `d`.
 */
export function entradaDeDetalhes(d: Detalhes): Record<string, string | string[]> {
  const num = (n: number | null) => (n === null ? "" : String(n));
  const sim = (b: boolean) => (b ? "on" : "");
  return {
    cep: d.cep,
    complemento: d.complemento,
    estado: d.estado,
    ...Object.fromEntries(Object.entries(d.camas).map(([tipo, n]) => [`cama_${tipo}`, String(n)])),
    comodidades: d.comodidades.filter((c) => (COMODIDADES as readonly string[]).includes(c)),
    comodidadesOutras: d.comodidades.filter((c) => !(COMODIDADES as readonly string[]).includes(c)).join(", "),
    regrasCasa: d.regrasCasa,
    aceitaAnimais: sim(d.aceitaAnimais),
    permiteFumar: sim(d.permiteFumar),
    permiteFestas: sim(d.permiteFestas),
    checkinAPartirDe: d.checkinAPartirDe,
    checkoutAte: d.checkoutAte,
    taxaLimpeza: centavosParaCampo(d.taxaLimpeza),
    hospedeExtraValor: centavosParaCampo(d.hospedeExtraValor),
    hospedeExtraAPartirDe: num(d.hospedeExtraAPartirDe),
    estadiaMinima: num(d.estadiaMinima),
    estadiaMaxima: num(d.estadiaMaxima),
    antecedenciaMinima: num(d.antecedenciaMinima),
    janelaMaxima: num(d.janelaMaxima),
    diasChegada: d.diasChegada.map(String),
    diasSaida: d.diasSaida.map(String),
    precoBase: centavosParaCampo(d.precoBase),
    precoDinamico: sim(d.precoDinamico),
    precoMinimo: centavosParaCampo(d.precoMinimo),
    precoMaximo: centavosParaCampo(d.precoMaximo),
    fontePrecos: d.fontePrecos,
    pisoUltimaHora1: centavosParaCampo(d.pisoUltimaHora1),
    pisoUltimaHora2: centavosParaCampo(d.pisoUltimaHora2),
  };
}

async function imovelDaOrg(db: Db, organizacaoId: string, imovelId: string, travar = false) {
  if (!uuidValido(imovelId)) return false;
  const q = db
    .select({ id: imoveis.id })
    .from(imoveis)
    .where(and(eq(imoveis.id, imovelId), eq(imoveis.organizacaoId, organizacaoId)));
  const [im] = travar ? await q.for("update") : await q;
  return Boolean(im);
}

export async function lerDetalhes(db: Db, organizacaoId: string, imovelId: string): Promise<Detalhes> {
  if (!uuidValido(imovelId)) return DETALHES_VAZIOS;
  const [l] = await db
    .select()
    .from(imoveisDetalhes)
    .where(and(eq(imoveisDetalhes.imovelId, imovelId), eq(imoveisDetalhes.organizacaoId, organizacaoId)));
  if (!l) return DETALHES_VAZIOS;
  return Object.fromEntries(Object.keys(DETALHES_VAZIOS).map((k) => [k, l[k as keyof typeof l]])) as Detalhes;
}

/** Fonte de preços de cada imóvel (M3.9); imóvel sem detalhes gravados fica no padrão (SCL). */
export async function fontesDePrecosDosImoveis(db: Db, organizacaoId: string, imovelIds: readonly string[]): Promise<Map<string, FontePrecos>> {
  const mapa = new Map<string, FontePrecos>(imovelIds.map((id) => [id, "scl"]));
  const ids = imovelIds.filter(uuidValido);
  if (!ids.length) return mapa;
  const linhas = await db
    .select({ imovelId: imoveisDetalhes.imovelId, fontePrecos: imoveisDetalhes.fontePrecos })
    .from(imoveisDetalhes)
    .where(and(eq(imoveisDetalhes.organizacaoId, organizacaoId), inArray(imoveisDetalhes.imovelId, ids)));
  for (const l of linhas) mapa.set(l.imovelId, l.fontePrecos);
  return mapa;
}

/**
 * Grava os detalhes (cria na primeira vez). `false` = imóvel não é da organização; texto = recusa
 * (mudar a fonte de preços durante um envio ao Beds24: o envio planeja a partir dela, então a troca
 * espera a trava do Beds24, como o bloqueio manual e o vínculo — M3.9).
 */
export async function salvarDetalhes(db: Db, organizacaoId: string, imovelId: string, dados: Detalhes, autorId: string | null, agora = new Date()): Promise<true | false | string> {
  return db.transaction(async (tx) => {
    if (!(await imovelDaOrg(tx, organizacaoId, imovelId, true))) return false;
    const antes = await lerDetalhes(tx, organizacaoId, imovelId);
    return gravarDetalhes(tx, organizacaoId, imovelId, antes, dados, autorId, agora);
  });
}

/** Prepara os detalhes a gravar a partir dos atuais (lidos com o imóvel travado); ou recusa, com erros por campo. */
export type PrepararDetalhes = (atual: Detalhes) => Detalhes | { erro: string; erros?: ErrosDetalhes };

/**
 * Grava detalhes montados a partir do cadastro ATUAL, lido dentro da mesma transação e com o imóvel
 * travado: quem edita só alguns campos (o portal do proprietário marketplace, M12.4) não grava uma
 * foto velha do resto do cadastro por cima de uma mudança feita no painel no meio do caminho.
 */
export async function salvarDetalhesComLeitura(
  db: Db,
  organizacaoId: string,
  imovelId: string,
  preparar: PrepararDetalhes,
  autorId: string | null,
  agora = new Date(),
  o: { conferir?: (tx: Db) => Promise<string | null> } = {},
): Promise<{ ok: true } | { ok: false; erro: string; erros?: ErrosDetalhes }> {
  return db.transaction(async (tx) => {
    if (!(await imovelDaOrg(tx, organizacaoId, imovelId, true))) return { ok: false as const, erro: "Imóvel não encontrado." };
    // Regra de quem chama (ex.: o portal reconfere o contrato marketplace), já com o imóvel travado.
    const recusa = o.conferir ? await o.conferir(tx) : null;
    if (recusa) return { ok: false as const, erro: recusa };
    const atual = await lerDetalhes(tx, organizacaoId, imovelId);
    const prep = preparar(atual);
    if ("erro" in prep) return { ok: false as const, ...prep };
    const r = await gravarDetalhes(tx, organizacaoId, imovelId, atual, prep, autorId, agora);
    return r === true ? { ok: true as const } : { ok: false as const, erro: r };
  });
}

async function gravarDetalhes(tx: Db, organizacaoId: string, imovelId: string, antes: Detalhes, dados: Detalhes, autorId: string | null, agora: Date): Promise<true | string> {
  const mudancas = calcularMudancas(antes, dados);
  if (!Object.keys(mudancas).length) return true;
  if (antes.fontePrecos !== dados.fontePrecos) {
    const recusa = await esperarEnvioBeds24(tx, organizacaoId, agora);
    if (recusa) return `${recusa} A fonte de preços só muda com o envio parado, para o SCL nunca escrever preço num imóvel que passou a usar os preços do Beds24.`;
  }
  await tx
    .insert(imoveisDetalhes)
    .values({ ...dados, imovelId, organizacaoId })
    .onConflictDoUpdate({ target: imoveisDetalhes.imovelId, set: { ...dados, atualizadoEm: new Date() } });
  await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "imovel.detalhes", entidade: "imovel", entidadeId: imovelId, mudancas });
  return true;
}

// --- Períodos de exceção ----------------------------------------------------------------

export async function listarPeriodos(db: Db, organizacaoId: string, imovelId: string): Promise<(Periodo & { id: string })[]> {
  if (!uuidValido(imovelId)) return [];
  return db
    .select({ id: imoveisPeriodos.id, nome: imoveisPeriodos.nome, inicio: imoveisPeriodos.inicio, fim: imoveisPeriodos.fim, precoNoite: imoveisPeriodos.precoNoite, estadiaMinima: imoveisPeriodos.estadiaMinima })
    .from(imoveisPeriodos)
    .where(and(eq(imoveisPeriodos.imovelId, imovelId), eq(imoveisPeriodos.organizacaoId, organizacaoId)))
    .orderBy(asc(imoveisPeriodos.inicio));
}

export type ResultadoPeriodo = { ok: true } | { ok: false; erro: string };

export function validarPeriodo(e: Entrada): { ok: true; dados: Omit<Periodo, "id"> } | { ok: false; erro: string } {
  const nome = txt(e.nome);
  const inicio = txt(e.inicio);
  const fim = txt(e.fim);
  if (!nome || nome.length > 60) return { ok: false, erro: "Dê um nome ao período (até 60 caracteres), ex.: Réveillon." };
  if (!dataValida(inicio) || !dataValida(fim)) return { ok: false, erro: "Datas inválidas." };
  if (fim < inicio) return { ok: false, erro: "A última noite não pode ser antes da primeira." };
  const preco = reaisParaCentavos(txt(e.precoNoite));
  if (preco === undefined) return { ok: false, erro: "Preço inválido (ex.: 900,00)." };
  if (preco !== null && preco > VALOR_MAXIMO) return { ok: false, erro: "Preço alto demais." };
  const m = txt(e.estadiaMinima);
  if (m && (!/^\d+$/.test(m) || Number(m) < 1 || Number(m) > 365)) return { ok: false, erro: "Estadia mínima: número de 1 a 365." };
  const estadiaMinima = m ? Number(m) : null;
  if (preco === null && estadiaMinima === null) return { ok: false, erro: "Informe o preço da noite, a estadia mínima ou os dois." };
  return { ok: true, dados: { nome, inicio, fim, precoNoite: preco, estadiaMinima } };
}

/**
 * Cria um período de exceção. `conferir`: regra extra avaliada sobre o cadastro ATUAL, lido com o
 * imóvel já travado (ex.: o portal recusa preço no período quando os preços são do Beds24) — nunca
 * sobre uma leitura anterior, que o painel pode ter mudado no meio.
 */
export async function criarPeriodo(db: Db, organizacaoId: string, imovelId: string, e: Entrada, autorId: string | null, o: { conferir?: (atual: Detalhes, tx: Db) => Promise<string | null> | string | null } = {}): Promise<ResultadoPeriodo> {
  const v = validarPeriodo(e);
  if (!v.ok) return v;
  return db.transaction(async (tx) => {
    // Trava o imóvel: dois períodos sobrepostos não entram ao mesmo tempo.
    if (!(await imovelDaOrg(tx, organizacaoId, imovelId, true))) return { ok: false as const, erro: "Imóvel não encontrado." };
    if (o.conferir) {
      const recusa = await o.conferir(await lerDetalhes(tx, organizacaoId, imovelId), tx);
      if (recusa) return { ok: false as const, erro: recusa };
    }
    const [choque] = await tx
      .select({ nome: imoveisPeriodos.nome })
      .from(imoveisPeriodos)
      .where(and(eq(imoveisPeriodos.imovelId, imovelId), lte(imoveisPeriodos.inicio, v.dados.fim), gte(imoveisPeriodos.fim, v.dados.inicio)));
    if (choque) return { ok: false as const, erro: `Esse período cruza com "${choque.nome}". Ajuste as datas ou exclua o outro.` };
    const [p] = await tx.insert(imoveisPeriodos).values({ organizacaoId, imovelId, ...v.dados }).returning();
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "imovel.periodo.criar", entidade: "imovel", entidadeId: imovelId, mudancas: { [`período ${p.nome}`]: [null, `${p.inicio} a ${p.fim}`] } });
    return { ok: true as const };
  });
}

/**
 * Exclui um período. `false` = não encontrado; texto = recusa de `conferir` (regra de quem chama, avaliada
 * com o imóvel travado, ex.: o portal reconfere o contrato marketplace).
 */
export async function excluirPeriodo(db: Db, organizacaoId: string, periodoId: string, autorId: string | null, o: { conferir?: (tx: Db, imovelId: string) => Promise<string | null> } = {}): Promise<boolean | string> {
  if (!uuidValido(periodoId)) return false;
  return db.transaction(async (tx) => {
    const [alvo] = await tx.select({ imovelId: imoveisPeriodos.imovelId }).from(imoveisPeriodos).where(and(eq(imoveisPeriodos.id, periodoId), eq(imoveisPeriodos.organizacaoId, organizacaoId)));
    if (!alvo) return false;
    if (!(await imovelDaOrg(tx, organizacaoId, alvo.imovelId, true))) return false;
    const recusa = o.conferir ? await o.conferir(tx, alvo.imovelId) : null;
    if (recusa) return recusa;
    const [p] = await tx
      .delete(imoveisPeriodos)
      .where(and(eq(imoveisPeriodos.id, periodoId), eq(imoveisPeriodos.organizacaoId, organizacaoId)))
      .returning();
    if (!p) return false;
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "imovel.periodo.excluir", entidade: "imovel", entidadeId: p.imovelId, mudancas: { [`período ${p.nome}`]: [`${p.inicio} a ${p.fim}`, null] } });
    return true;
  });
}
