/**
 * Documento versionado (M5.6, generalizado no M7.4): um texto editável no painel, dividido em seções, que vira uma
 * **versão numerada e datada** a cada publicação. As versões ficam numa chave de configuração (`{ versoes: [...] }`),
 * só por inclusão: nenhuma é reescrita depois de publicada (é o que alguém leu e aceitou). Cada documento declara as
 * suas seções e os seus campos próprios gravados na versão (ex.: o nome da empresa no "Como funciona"; os dados da
 * empresa e o prazo do reembolso nas páginas legais), e o motor cuida do resto: leitura tolerante, publicação sob a
 * trava da chave, recusa quando outra pessoa publicou no meio, versão nova só quando algo mudou e o histórico.
 *
 * Versão de origem (M7.15): um documento cujo texto já estava em uso, fixo no código, antes de ficar editável (o texto das
 * caixas de autorização dos proprietários, do M7.14) declara esse texto como `origem`. Ela vale enquanto nada foi
 * publicado, não é gravada (nem ganha data inventada) e conta na numeração: a primeira publicação é a seguinte a ela, e
 * publicar o mesmo texto dela não cria versão. Assim não existem duas "versão 1" diferentes.
 */
import { registrarAuditoria } from "@/auditoria/auditoria";
import type { Db } from "@/db/types";
import { dataValida } from "@/reservas/regras";
import { type ChaveConfig, gravarConfig, lerConfig, travarConfig } from "./armazem";

export type DefinicaoSecao<S extends string> = { chave: S; titulo: string; dica: string; limite: number };
/** `data`: AAAA-MM-DD da publicação; vazia só na versão de origem (`origem` da definição), que nunca foi publicada no banco. */
export type VersaoDocumento<S extends string, E extends object> = { numero: number; data: string; autorId: string | null; secoes: Record<S, string> } & E;
/** O texto que já estava em uso, fixo no código, antes de o documento ficar editável (ver o começo deste arquivo). */
export type VersaoDeOrigem<S extends string, E extends object> = { numero: number; secoes: Record<S, string> } & E;
export type DefinicaoDocumento<S extends string, E extends object> = {
  /** Chave da configuração que guarda `{ versoes: [...] }`: uma chave por documento (trava e numeração próprias). */
  chave: ChaveConfig;
  /** Ação registrada no histórico a cada versão nova (ex.: "configuracao.como_funciona"). */
  acaoAuditoria: string;
  secoes: readonly DefinicaoSecao<S>[];
  /** Leitura tolerante dos campos próprios do documento gravados numa versão (valor estranho → padrão). */
  lerExtra: (gravado: Record<string, unknown>) => E;
  /** O que mudou nesses campos, para o histórico; vazio = iguais (mesmo texto e mesmos campos = nenhuma versão nova). */
  mudancasDoExtra: (antes: E | null, depois: E) => Record<string, [unknown, unknown]>;
  /**
   * Versão que vale enquanto nada foi publicado (só para documento que já estava em uso antes de ficar editável). Fixa
   * para sempre: é o que já foi mostrado e registrado com esse número.
   */
  origem?: VersaoDeOrigem<S, E>;
};
/** Só as seções da definição (validação e comparação não precisam do resto). */
type ComSecoes<S extends string> = { secoes: readonly DefinicaoSecao<S>[] };

/** Texto de um campo: quebras de linha do Windows viram `\n` e as pontas sem espaço; o que não é texto vira vazio. */
export const textoLimpo = (v: unknown): string => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "");

/** Seções a partir de um valor qualquer (JSON gravado): o que faltar vira vazio. */
export function normalizarSecoes<S extends string>(def: ComSecoes<S>, v: unknown): Record<S, string> {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return Object.fromEntries(def.secoes.map((s) => [s.chave, textoLimpo(o[s.chave]).slice(0, s.limite)])) as Record<S, string>;
}

/** Versões gravadas, da mais antiga para a mais nova; entradas inválidas são ignoradas. */
export function versoesDe<S extends string, E extends object>(def: DefinicaoDocumento<S, E>, valor: Record<string, unknown> | null): VersaoDocumento<S, E>[] {
  const lista = Array.isArray(valor?.versoes) ? (valor!.versoes as unknown[]) : [];
  return lista
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
    .map(
      (x) =>
        ({
          numero: typeof x.numero === "number" && Number.isInteger(x.numero) && x.numero > 0 ? x.numero : 0,
          data: typeof x.data === "string" && dataValida(x.data) ? x.data : "",
          autorId: typeof x.autorId === "string" ? x.autorId : null,
          secoes: normalizarSecoes(def, x.secoes),
          ...def.lerExtra(x),
        }) as VersaoDocumento<S, E>,
    )
    .filter((x) => x.numero > 0 && x.data)
    .sort((a, b) => a.numero - b.numero);
}

export const versaoAtual = <V>(versoes: readonly V[]): V | null => versoes.at(-1) ?? null;

/** A versão de origem da definição como versão do documento: sem data (nunca publicada) e sem autor; null se não há. */
export function versaoDeOrigem<S extends string, E extends object>(def: DefinicaoDocumento<S, E>): VersaoDocumento<S, E> | null {
  return def.origem ? ({ ...def.origem, data: "", autorId: null } as VersaoDocumento<S, E>) : null;
}

/** A versão em vigor: a última publicada ou, sem nenhuma publicada, a de origem (null se o documento não tem origem). */
export const versaoEmVigor = <S extends string, E extends object>(def: DefinicaoDocumento<S, E>, versoes: readonly VersaoDocumento<S, E>[]): VersaoDocumento<S, E> | null =>
  versaoAtual(versoes) ?? versaoDeOrigem(def);

/** Todas as versões, da mais antiga para a mais nova, com a de origem (se houver) na frente das publicadas. */
export function versoesComOrigem<S extends string, E extends object>(def: DefinicaoDocumento<S, E>, versoes: readonly VersaoDocumento<S, E>[]): VersaoDocumento<S, E>[] {
  const origem = versaoDeOrigem(def);
  return origem ? [origem, ...versoes] : [...versoes];
}

export const secoesIguais = <S extends string>(def: ComSecoes<S>, a: Record<S, string>, b: Record<S, string>): boolean => def.secoes.every((s) => a[s.chave] === b[s.chave]);

/**
 * Lê o formulário do painel: cada seção dentro do limite e pelo menos uma escrita; com `exigirTodas`, todas escritas.
 */
export function validarSecoes<S extends string>(
  def: ComSecoes<S>,
  bruto: Record<string, unknown>,
  o: { exigirTodas?: boolean } = {},
): { ok: true; secoes: Record<S, string> } | { ok: false; erros: Partial<Record<S, string>>; mensagem: string } {
  const secoes = {} as Record<S, string>;
  const erros: Partial<Record<S, string>> = {};
  for (const s of def.secoes) {
    const v = textoLimpo(bruto[s.chave]);
    if (v.length > s.limite) erros[s.chave] = `Máximo de ${s.limite} caracteres.`;
    else if (o.exigirTodas && !v) erros[s.chave] = "Escreva esta parte antes de publicar.";
    secoes[s.chave] = v;
  }
  if (Object.keys(erros).length) return { ok: false, erros, mensagem: "Confira os campos destacados." };
  if (!def.secoes.some((s) => secoes[s.chave])) return { ok: false, erros, mensagem: "Escreva pelo menos uma seção antes de publicar." };
  return { ok: true, secoes };
}

export async function lerVersoes<S extends string, E extends object>(db: Db, def: DefinicaoDocumento<S, E>, organizacaoId: string): Promise<VersaoDocumento<S, E>[]> {
  return versoesDe(def, await lerConfig(db, organizacaoId, def.chave));
}

export type ResultadoPublicacao<V> = { ok: true; mudou: boolean; versao: V } | { ok: false; erro: string; atual: V | null; erros?: Record<string, string> };

/** Recusa quando outra pessoa publicou enquanto o formulário estava aberto. */
export function mensagemVersaoMudou(atual: { numero: number; data: string } | null): string {
  return `Enquanto você editava, a versão ${atual?.numero ?? 0} foi publicada por outra pessoa${atual?.data ? ` em ${atual.data.split("-").reverse().join("/")}` : ""}. Recarregue a página, confira o texto atual e publique de novo.`;
}

/**
 * Publica uma versão nova (número seguinte, datada de hoje) quando algum texto ou campo próprio mudou; tudo igual não
 * cria versão. Sem nada publicado, a base é a versão de origem, se a definição tiver uma (a primeira publicada é a
 * seguinte a ela; o mesmo texto dela não cria versão, e o resultado devolve a de origem, sem data).
 * `versaoBase`: a versão que o formulário mostrava (0 = nenhuma); se outra pessoa publicou no meio, a
 * publicação é recusada em vez de passar por cima do texto dela (quem edita recarrega, confere e publica de novo).
 * `extraAoPublicar` lê, dentro da transação e sob a trava, os campos próprios que a versão congela — ou recusa a
 * publicação (nada é gravado). As versões anteriores são regravadas como estão no banco, e não como a leitura tolerante
 * as mostra (que completa padrões e descarta o desconhecido): nenhuma é alterada, nem no JSON gravado.
 */
export async function publicarVersao<S extends string, E extends object>(
  db: Db,
  def: DefinicaoDocumento<S, E>,
  organizacaoId: string,
  secoes: Record<S, string>,
  autorId: string | null,
  hoje: string,
  versaoBase: number | undefined,
  extraAoPublicar: (tx: Db) => Promise<{ ok: true; extra: E } | { ok: false; erro: string; erros?: Record<string, string> }>,
): Promise<ResultadoPublicacao<VersaoDocumento<S, E>>> {
  if (!dataValida(hoje)) throw new Error("Data inválida.");
  return db.transaction(async (tx) => {
    await travarConfig(tx, organizacaoId, def.chave);
    const gravado = await lerConfig(tx, organizacaoId, def.chave);
    const versoes = versoesDe(def, gravado);
    const atual = versaoEmVigor(def, versoes);
    if (versaoBase !== undefined && (atual?.numero ?? 0) !== versaoBase) return { ok: false as const, erro: mensagemVersaoMudou(atual), atual };
    const e = await extraAoPublicar(tx);
    if (!e.ok) return { ok: false as const, erro: e.erro, atual, ...(e.erros ? { erros: e.erros } : {}) };
    const mudancasExtra = def.mudancasDoExtra(atual, e.extra);
    if (atual && secoesIguais(def, atual.secoes, secoes) && !Object.keys(mudancasExtra).length) return { ok: true as const, mudou: false, versao: atual };
    const texto = Object.fromEntries(def.secoes.map((s) => [s.chave, typeof secoes[s.chave] === "string" ? secoes[s.chave] : ""])) as Record<S, string>;
    const nova = { numero: (atual?.numero ?? 0) + 1, data: hoje, autorId, secoes: texto, ...e.extra } as VersaoDocumento<S, E>;
    // As publicadas voltam exatamente como estavam gravadas; só a nova entra.
    const gravadas = Array.isArray(gravado?.versoes) ? (gravado!.versoes as unknown[]) : [];
    await gravarConfig(tx, organizacaoId, def.chave, { versoes: [...gravadas, nova] }, autorId, false);
    const mudancas: Record<string, [unknown, unknown]> = { versao: [atual?.numero ?? null, nova.numero], ...mudancasExtra };
    for (const s of def.secoes) if ((atual?.secoes[s.chave] ?? "") !== texto[s.chave]) mudancas[`secao.${s.chave}`] = [atual?.secoes[s.chave] ?? null, texto[s.chave]];
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: def.acaoAuditoria, entidade: "configuracao", entidadeId: organizacaoId, mudancas });
    return { ok: true as const, mudou: true, versao: nova };
  });
}

/**
 * Versão que o formulário declara como base ao publicar: a que ele mostrava quando foi preenchido. Depois de uma recusa,
 * a ação devolve os valores enviados (com `versaoBase`), e é essa base — não a publicada agora — que o formulário mantém:
 * reenviar o texto velho sem recarregar a página é recusado de novo, em vez de passar por cima da versão nova.
 */
export function versaoBaseDoFormulario(valores: Record<string, string> | undefined, atual: { numero: number } | null): number {
  const enviada = valores?.versaoBase;
  if (enviada !== undefined && /^\d{1,6}$/.test(enviada)) return Number(enviada);
  return atual?.numero ?? 0;
}

/** Parágrafos de uma seção: blocos separados por linha em branco. */
export const paragrafos = (texto: string): string[] =>
  texto
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
