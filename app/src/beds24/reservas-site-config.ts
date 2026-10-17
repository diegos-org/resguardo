/**
 * Configuração das reservas do site no Beds24 (M8.3, desenho 2.3), no armazém de configurações (chave
 * `reservas_beds24`, sem migração). Só `lerConfigReservasBeds24` lê; nunca a lista `envio.imoveis` do calendário
 * (M3.7): cada escrita liga e desliga sem depender da outra.
 * - `pausado`: o freio geral, que vale na hora (tirar a variável da Vercel só vale depois de uma publicação nova), com
 *   quem pausou e quando. Pausado, nada é escrito; as operações em curso só são resolvidas com leitura.
 * - `retomado` (M8.3c, desenho 6.1): quem tirou a pausa e quando. A carência do aviso "feche à mão" conta também desde aí:
 *   logo depois de "Retomar", o sistema ainda vai enviar o que ficou parado.
 * - `imoveis`: os imóveis ligados (D6), com a data e quem ligou. Começa vazio. Desligado, só a criação para.
 * - `ensaio`: o último ensaio conferido (a impressão da credencial, a data e a operação), gravado depois de "Cancelar o
 *   ensaio" (M8.3c, `reservas-site-ensaio.ts`). Ligar um imóvel exige um ensaio conferido com a credencial ATUAL: trocar o
 *   token deixa as criações paradas até um ensaio novo.
 * Deny-by-default: um valor torto conta como o lado seguro (imóvel desligado, sem ensaio; a pausa torta conta como
 * pausada). Toda mudança exige `configuracao:editar` e fica na auditoria (`configuracao.reservas_beds24`). Aqui também o
 * "desligada" calculado de cada reserva (`motivosDesligada`: o ambiente e a configuração), que a ficha e as tarefas das
 * OTAs leem.
 */
import { and, eq } from "drizzle-orm";
import { exigir, type Sessao } from "@/acesso/politica";
import { gravarConfig, lerConfig, travarConfig } from "@/configuracoes/armazem";
import { beds24ReservasOperacoes, imoveis } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { ambienteDeEscritaDeReservas, escritaReservasBeds24Ligada, impressaoCredencialBeds24 } from "./http";

export type PausaReservasBeds24 = {
  /** null = a pausa foi gravada sem a data legível (conta como pausada do mesmo jeito). */
  em: string | null;
  por: string | null;
};
export type ImovelLigadoBeds24 = { imovelId: string; ligadoEm: string; ligadoPor: string | null };
export type EnsaioReservasBeds24 = {
  /** `impressaoCredencialBeds24` da credencial usada no ensaio (nunca a credencial). */
  credencial: string;
  em: string;
  operacaoId: string;
};
/** M8.3c (desenho 6.1): a última retomada depois de uma pausa, para a carência das tarefas das OTAs. */
export type RetomadaReservasBeds24 = { em: string; por: string | null };
export type ConfigReservasBeds24 = {
  pausado: PausaReservasBeds24 | null;
  retomado: RetomadaReservasBeds24 | null;
  imoveis: ImovelLigadoBeds24[];
  ensaio: EnsaioReservasBeds24 | null;
};

export const CONFIG_RESERVAS_BEDS24_PADRAO: ConfigReservasBeds24 = { pausado: null, retomado: null, imoveis: [], ensaio: null };

type Obj = Record<string, unknown>;
const ehObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
/** Instante ISO legível (devolvido como `toISOString`); senão null. */
const instante = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

/** Valor gravado → configuração, sem palpite: o que não dá para ler fica do lado seguro. */
export function configReservasBeds24(c: Obj | null): ConfigReservasBeds24 {
  if (!c) return { ...CONFIG_RESERVAS_BEDS24_PADRAO, imoveis: [] };
  // O freio: qualquer coisa gravada que não seja null conta como pausada (uma pausa torta nunca solta o freio).
  const pausado: PausaReservasBeds24 | null = c.pausado === null || c.pausado === undefined
    ? null
    : { em: ehObj(c.pausado) ? instante(c.pausado.em) : null, por: ehObj(c.pausado) && uuidValido(c.pausado.por) ? c.pausado.por : null };
  // A retomada sem a data legível não conta (a carência volta a contar só do fato e da ligação: o aviso aparece antes, nunca depois).
  const retomadoEm = ehObj(c.retomado) ? instante(c.retomado.em) : null;
  const retomado: RetomadaReservasBeds24 | null = ehObj(c.retomado) && retomadoEm ? { em: retomadoEm, por: uuidValido(c.retomado.por) ? c.retomado.por : null } : null;
  const lista: ImovelLigadoBeds24[] = [];
  for (const i of Array.isArray(c.imoveis) ? c.imoveis : []) {
    if (!ehObj(i) || !uuidValido(i.imovelId) || lista.some((x) => x.imovelId === i.imovelId)) continue;
    const ligadoEm = instante(i.ligadoEm);
    if (!ligadoEm) continue;
    lista.push({ imovelId: i.imovelId, ligadoEm, ligadoPor: uuidValido(i.ligadoPor) ? i.ligadoPor : null });
  }
  const e = c.ensaio;
  const em = ehObj(e) ? instante(e.em) : null;
  const ensaio = ehObj(e) && typeof e.credencial === "string" && e.credencial && em && uuidValido(e.operacaoId) ? { credencial: e.credencial, em, operacaoId: e.operacaoId } : null;
  return { pausado, retomado, imoveis: lista, ensaio };
}

/** A única leitura da configuração das reservas no Beds24. */
export async function lerConfigReservasBeds24(db: Db, organizacaoId: string): Promise<ConfigReservasBeds24> {
  return configReservasBeds24(await lerConfig(db, organizacaoId, "reservas_beds24"));
}

/** A ligação do imóvel (D6); null = desligado. */
export const ligacaoDoImovel = (c: ConfigReservasBeds24, imovelId: string): ImovelLigadoBeds24 | null => c.imoveis.find((i) => i.imovelId === imovelId) ?? null;

/**
 * Por que o envio automático está desligado para esta reserva (pode haver mais de um): fora do deploy de produção, a
 * chave `BEDS24_ESCRITA_RESERVAS`, o refresh token, a pausa geral, o imóvel não ligado (D6) ou nenhuma linha de
 * acompanhamento. Vazio = ligado.
 */
export type MotivoDesligadaBeds24 = "ambiente" | "chave" | "credencial" | "pausa" | "imovel" | "sem_acompanhamento";

/**
 * Os motivos do "desligada", na ordem em que a tela mostra: a trava de ambiente (`escritaReservasBeds24Pronta`, aberta nas
 * três primeiras) e depois as condições do painel. Uma regra, um lugar: a ficha (M8.3a) e as tarefas das OTAs (M8.3b) leem
 * daqui.
 */
export function motivosDesligada(env: NodeJS.ProcessEnv, o: { pausada: boolean; imovelLigado: boolean; comAcompanhamento: boolean }): MotivoDesligadaBeds24[] {
  const m: MotivoDesligadaBeds24[] = [];
  if (!ambienteDeEscritaDeReservas(env)) m.push("ambiente");
  if (!escritaReservasBeds24Ligada(env)) m.push("chave");
  if (!env.BEDS24_REFRESH_TOKEN?.trim()) m.push("credencial");
  if (o.pausada) m.push("pausa");
  if (!o.imovelLigado) m.push("imovel");
  if (!o.comAcompanhamento) m.push("sem_acompanhamento");
  return m;
}

/** O último ensaio conferido vale para a credencial de agora (impressão igual e não vazia). */
export const ensaioValeParaCredencial = (c: ConfigReservasBeds24, credencialAtual: string): boolean => Boolean(credencialAtual) && c.ensaio?.credencial === credencialAtual;

export type ResultadoConfigReservasBeds24 = { ok: true } | { ok: false; erro: string };

export const ERRO_LIGAR_SEM_CREDENCIAL = "Configure a credencial do Beds24 antes de ligar um imóvel.";
export const ERRO_LIGAR_IMOVEL_INATIVO = "Imóvel inativo: reative no cadastro antes de ligar.";
export const ERRO_LIGAR_SEM_ENSAIO = "Faça o ensaio com a credencial atual antes de ligar um imóvel: sem ensaio conferido, nenhuma reserva é criada no Beds24.";
const ERRO_IMOVEL = "Imóvel não encontrado.";
const ERRO_ENSAIO = "Ensaio não encontrado ou ainda não conferido.";

/** Lê, muda e grava sob a trava da chave (duas mudanças ao mesmo tempo nunca se atropelam). */
async function mudar(db: Db, sessao: Sessao, f: (atual: ConfigReservasBeds24, tx: Db) => Promise<ConfigReservasBeds24 | string>): Promise<ResultadoConfigReservasBeds24> {
  exigir(sessao, "configuracao:editar", { organizacaoId: sessao.organizacaoId });
  return db.transaction(async (tx) => {
    await travarConfig(tx, sessao.organizacaoId, "reservas_beds24");
    const novo = await f(await lerConfigReservasBeds24(tx, sessao.organizacaoId), tx);
    if (typeof novo === "string") return { ok: false as const, erro: novo };
    await gravarConfig(tx, sessao.organizacaoId, "reservas_beds24", { ...novo }, sessao.usuarioId);
    return { ok: true as const };
  });
}

/** Pausa geral: vale na hora, para tudo (inclusive o cancelamento). Já pausada, nada muda. */
export function pausarReservasBeds24(db: Db, sessao: Sessao, agora: Date = new Date()) {
  return mudar(db, sessao, async (c) => (c.pausado ? c : { ...c, pausado: { em: agora.toISOString(), por: sessao.usuarioId } }));
}

/**
 * Retoma depois da pausa e guarda quem retomou e quando (`retomado`, M8.3c: a carência de 6.1 conta também daí). Sem pausa,
 * nada muda: a hora da retomada só vale quando houve o que retomar.
 */
export function retomarReservasBeds24(db: Db, sessao: Sessao, agora: Date = new Date()) {
  return mudar(db, sessao, async (c) => (c.pausado ? { ...c, pausado: null, retomado: { em: agora.toISOString(), por: sessao.usuarioId } } : c));
}

/**
 * Liga o imóvel (D6): só um imóvel ativo, e só com um ensaio conferido com a credencial atual (`env` explícito, a
 * impressão de agora). Valem as reservas confirmadas a partir de `agora` (as de antes nascem `manual`). Já ligado, a data
 * de ligação não muda.
 */
export function ligarImovelReservasBeds24(db: Db, sessao: Sessao, imovelId: string, env: NodeJS.ProcessEnv, agora: Date = new Date()) {
  return mudar(db, sessao, async (c, tx) => {
    if (!uuidValido(imovelId)) return ERRO_IMOVEL;
    const [im] = await tx.select({ id: imoveis.id, ativo: imoveis.ativo }).from(imoveis).where(and(eq(imoveis.id, imovelId), eq(imoveis.organizacaoId, sessao.organizacaoId)));
    if (!im) return ERRO_IMOVEL;
    if (!im.ativo) return ERRO_LIGAR_IMOVEL_INATIVO;
    const credencial = impressaoCredencialBeds24(env);
    if (!credencial) return ERRO_LIGAR_SEM_CREDENCIAL;
    if (!ensaioValeParaCredencial(c, credencial)) return ERRO_LIGAR_SEM_ENSAIO;
    if (ligacaoDoImovel(c, imovelId)) return c;
    return { ...c, imoveis: [...c.imoveis, { imovelId, ligadoEm: agora.toISOString(), ligadoPor: sessao.usuarioId }] };
  });
}

/** Desliga o imóvel (ativo ou não): só a criação para; a atualização e o cancelamento do que o M8.3 já criou seguem. */
export function desligarImovelReservasBeds24(db: Db, sessao: Sessao, imovelId: string) {
  return mudar(db, sessao, async (c) => (uuidValido(imovelId) && ligacaoDoImovel(c, imovelId) ? { ...c, imoveis: c.imoveis.filter((i) => i.imovelId !== imovelId) } : ERRO_IMOVEL));
}

/**
 * Registra o último ensaio conferido (o ensaio em si, que cria, relê, procura, cancela e relê, é do M8.3c): só uma
 * operação `ensaio`, real, da organização e em `conferida`, com a impressão da credencial que ela gravou.
 */
export function registrarEnsaioReservasBeds24(db: Db, sessao: Sessao, operacaoId: string, agora: Date = new Date()) {
  return mudar(db, sessao, async (c, tx) => {
    if (!uuidValido(operacaoId)) return ERRO_ENSAIO;
    const [op] = await tx
      .select({ credencial: beds24ReservasOperacoes.credencial, terminadoEm: beds24ReservasOperacoes.terminadoEm })
      .from(beds24ReservasOperacoes)
      .where(and(eq(beds24ReservasOperacoes.id, operacaoId), eq(beds24ReservasOperacoes.organizacaoId, sessao.organizacaoId), eq(beds24ReservasOperacoes.tipo, "ensaio"), eq(beds24ReservasOperacoes.modo, "real"), eq(beds24ReservasOperacoes.situacao, "conferida")));
    if (!op || !op.credencial) return ERRO_ENSAIO;
    return { ...c, ensaio: { credencial: op.credencial, em: (op.terminadoEm ?? agora).toISOString(), operacaoId } };
  });
}
