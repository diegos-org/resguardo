/**
 * Reserva paga do site no Beds24 (M8.3c): o estado da rotina por organização (`beds24_reservas_rotina`, migração 0073) e o
 * motivo de configuração que para a escrita (desenho 2.4 e 7), uma função para o trabalhador, o Início, Integrações e o
 * Sistema.
 * - O estado é operacional, não configuração editável: a última leitura dos escopos (só nomes de escopo e a impressão da
 *   credencial) e as marcas de tempo da conferência contínua (4.5). Fora do JSON `reservas_beds24` de propósito: ali o
 *   `mudar()` apagaria o que o parser não conhece, a rotina geraria auditoria diária sem autor e a trava da configuração
 *   entraria no caminho da fase 1.
 * - Os escopos são lidos no COMEÇO da volta, antes de qualquer escrita, sempre que a leitura guardada não for da credencial de
 *   agora ou tiver mais de 23 h; sem leitura válida (nunca lida, de outra credencial, com mais de 26 h, ou a leitura desta
 *   volta falhou), nada é escrito, como no escopo a mais: não se sabe se há escopo a mais.
 * - `ultimaRecusaDeReservas`: o último 403 ou 401 de reservas, também do ensaio (sem acompanhamento), para Integrações.
 * Nada aqui chama a rede: quem lê os escopos entrega o resultado.
 */
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { beds24ReservasOperacoes, beds24ReservasRotina, beds24ReservasSite, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { FUSO_PADRAO, hojeISO } from "@/lib/datas";
import { impressaoCredencialBeds24 } from "./http";
import { ensaioValeParaCredencial, lerConfigReservasBeds24 } from "./reservas-site-config";
import { avaliarEscoposBeds24, type EscoposLidosBeds24, escoposLidosBeds24, type MotivoAcompanhamentoBeds24, type TipoOperacaoBeds24 } from "./reservas-site-regras";
import type { CredencialBeds24 } from "./tipos";

/** A leitura guardada vale até 26 h; a rotina lê de novo depois de 23 h (a volta de 10 min nunca deixa passar das 26). */
export const VALIDADE_DOS_ESCOPOS_HORAS = 26;
export const RELER_ESCOPOS_HORAS = 23;

export type EstadoRotinaReservasBeds24 = {
  escopos: EscoposLidosBeds24 | null;
  /** `impressaoCredencialBeds24` da credencial que leu os escopos ("" = nunca lidos). */
  escoposCredencial: string;
  escoposLidosEm: Date | null;
  /** A última leitura por `modifiedFrom` que concluiu (4.5). */
  conferenciaEm: Date | null;
  /** A última releitura por id que concluiu (de hora em hora). */
  releituraEm: Date | null;
};

export const ESTADO_ROTINA_RESERVAS_PADRAO: EstadoRotinaReservasBeds24 = { escopos: null, escoposCredencial: "", escoposLidosEm: null, conferenciaEm: null, releituraEm: null };

/** O estado da rotina desta organização; sem linha, o padrão (nunca lidos, nunca conferidos). */
export async function lerEstadoRotina(db: Db, org: string): Promise<EstadoRotinaReservasBeds24> {
  const [l] = await db.select().from(beds24ReservasRotina).where(eq(beds24ReservasRotina.organizacaoId, org));
  if (!l) return { ...ESTADO_ROTINA_RESERVAS_PADRAO };
  return { escopos: escoposLidosBeds24(l.escopos), escoposCredencial: l.escoposCredencial, escoposLidosEm: l.escoposLidosEm, conferenciaEm: l.conferenciaEm, releituraEm: l.releituraEm };
}

/**
 * Grava a leitura dos escopos (a rotina, no começo da volta, e o botão de Integrações): a avaliação pela mesma regra da
 * prontidão (`avaliarEscoposBeds24`), os itens fora do formato e a impressão da credencial que leu. Devolve o que gravou.
 */
export async function gravarEscoposLidos(db: Db, org: string, credencial: string, c: Pick<CredencialBeds24, "escopos" | "ilegiveis">, em: Date): Promise<EscoposLidosBeds24> {
  const escopos: EscoposLidosBeds24 = { ...avaliarEscoposBeds24(c), ilegiveis: [...c.ilegiveis] };
  await db
    .insert(beds24ReservasRotina)
    .values({ organizacaoId: org, escopos, escoposCredencial: credencial, escoposLidosEm: em })
    .onConflictDoUpdate({ target: beds24ReservasRotina.organizacaoId, set: { escopos, escoposCredencial: credencial, escoposLidosEm: em, atualizadoEm: sql`now()` } });
  return escopos;
}

/** Avança uma marca de tempo da conferência contínua só para a frente (duas voltas ao mesmo tempo nunca a fazem voltar). */
async function avancar(db: Db, org: string, coluna: "conferenciaEm" | "releituraEm", em: Date) {
  const adiante = sql`greatest(${beds24ReservasRotina[coluna]}, ${em.toISOString()}::timestamptz)`;
  await db
    .insert(beds24ReservasRotina)
    .values(coluna === "conferenciaEm" ? { organizacaoId: org, conferenciaEm: em } : { organizacaoId: org, releituraEm: em })
    .onConflictDoUpdate({ target: beds24ReservasRotina.organizacaoId, set: coluna === "conferenciaEm" ? { conferenciaEm: adiante, atualizadoEm: sql`now()` } : { releituraEm: adiante, atualizadoEm: sql`now()` } });
}

/** A leitura por `modifiedFrom` concluiu em `em` (4.5): a próxima lê desde 15 min antes dela. Só quando conclui. */
export const avancarConferencia = (db: Db, org: string, em: Date) => avancar(db, org, "conferenciaEm", em);
/** A releitura por id de hora em hora concluiu em `em`. Só quando conclui. */
export const avancarReleitura = (db: Db, org: string, em: Date) => avancar(db, org, "releituraEm", em);

const horasDesde = (d: Date | null, agora: Date) => (d ? (agora.getTime() - d.getTime()) / 3_600_000 : Infinity);

/** A leitura guardada vale para a credencial de agora: a mesma impressão (não vazia), legível e com menos de 26 h. */
export const leituraDosEscoposValida = (e: Pick<EstadoRotinaReservasBeds24, "escopos" | "escoposCredencial" | "escoposLidosEm">, credencial: string, agora: Date): boolean =>
  Boolean(credencial) && e.escopos !== null && e.escoposCredencial === credencial && horasDesde(e.escoposLidosEm, agora) < VALIDADE_DOS_ESCOPOS_HORAS;

/** A rotina lê os escopos no começo desta volta: a leitura guardada é de outra credencial, nunca houve, ou tem 23 h ou mais. */
export const precisaLerEscopos = (e: Pick<EstadoRotinaReservasBeds24, "escopos" | "escoposCredencial" | "escoposLidosEm">, credencial: string, agora: Date): boolean =>
  !(e.escopos !== null && credencial && e.escoposCredencial === credencial && horasDesde(e.escoposLidosEm, agora) < RELER_ESCOPOS_HORAS);

// ---------------------------------------------------------------- o motivo de configuração (desenho 2.4 e 7)

export type MotivoDeConfiguracaoDasReservas = "sem_credencial" | "escopo_excessivo" | "escopo_fora_de_ordem" | "sem_ensaio" | "marca_ilegivel";

/**
 * O que para a escrita, para a empresa toda: `tudo` (nada é escrito, nem cancelar nem atualizar; a volta só resolve com
 * leitura) ou `criacoes` (a atualização e o cancelamento do que o M8.3 já criou seguem).
 */
export type ConfiguracaoQueParaAsReservas = { motivo: MotivoDeConfiguracaoDasReservas; para: "tudo" | "criacoes" };

/** O que a função lê; quem chama monta (`estadoDaConfiguracaoDasReservas`) ou, na volta, completa com a leitura de agora. */
export type EstadoDaConfiguracaoDasReservas = {
  /** Há refresh token (o único que escreve reservas; o token direto só lê). */
  refreshToken: boolean;
  /** `impressaoCredencialBeds24(env)`: a credencial de agora. */
  credencial: string;
  rotina: Pick<EstadoRotinaReservasBeds24, "escopos" | "escoposCredencial" | "escoposLidosEm">;
  /** A leitura dos escopos do começo desta volta falhou: nesta volta, nada é escrito. */
  leituraFalhou: boolean;
  agora: Date;
  /** `ensaioValeParaCredencial`: o último ensaio conferido foi com a credencial de agora. */
  ensaioValido: boolean;
  /** Existe `marca_ilegivel` que conta (`existeMarcaIlegivelQueConta`). */
  marcaIlegivel: boolean;
};

/**
 * O primeiro motivo de configuração que vale (desenho 2.4 e 7; uma regra, um lugar: o trabalhador, a linha do Início,
 * Integrações e o Sistema leem daqui), nesta ordem:
 * 1. `sem_credencial`: sem refresh token — para tudo;
 * 2. `escopo_excessivo`: a leitura válida tem escopo a mais — para tudo;
 * 3. `escopo_fora_de_ordem` sem leitura válida (nunca lida, de outra credencial, com mais de 26 h, ou a leitura desta volta
 *    falhou) — para tudo: não se sabe se há escopo a mais (depois de uma troca de token, a credencial nova pode ter
 *    `all:bookings`);
 * 4. `escopo_fora_de_ordem` lido: escopo faltando ou ilegível, com a credencial de agora — só as criações;
 * 5. `sem_ensaio`: o ensaio não vale para a credencial de agora — só as criações;
 * 6. `marca_ilegivel`: uma reserva nossa voltou sem a marca — só as criações (sem a marca, a busca não protege da duplicata).
 * null = nada para a escrita por configuração (o `sem_vinculo` é por imóvel e não entra aqui; a chave, o ambiente e a pausa
 * são de `escritaReservasBeds24Pronta` e da configuração).
 */
export function motivoDeConfiguracaoDasReservas(e: EstadoDaConfiguracaoDasReservas): ConfiguracaoQueParaAsReservas | null {
  if (!e.refreshToken || !e.credencial) return { motivo: "sem_credencial", para: "tudo" };
  const valida = !e.leituraFalhou && leituraDosEscoposValida(e.rotina, e.credencial, e.agora);
  if (valida && e.rotina.escopos!.situacao === "escopo_excessivo") return { motivo: "escopo_excessivo", para: "tudo" };
  if (!valida) return { motivo: "escopo_fora_de_ordem", para: "tudo" };
  if (e.rotina.escopos!.situacao !== "em_ordem") return { motivo: "escopo_fora_de_ordem", para: "criacoes" };
  if (!e.ensaioValido) return { motivo: "sem_ensaio", para: "criacoes" };
  if (e.marcaIlegivel) return { motivo: "marca_ilegivel", para: "criacoes" };
  return null;
}

/**
 * O motivo de configuração em linguagem simples, sem código nem valor (a linha "envio de reservas parado: <motivo>" do
 * Sistema e o resumo da rotina; desenho 2.4). Uma regra, um lugar: o Início e Integrações mostram o mesmo texto.
 */
export function textoDaConfiguracaoDasReservas(c: ConfiguracaoQueParaAsReservas): string {
  const motivo =
    c.motivo === "sem_credencial" ? "falta o refresh token de escrita (BEDS24_REFRESH_TOKEN)"
    : c.motivo === "escopo_excessivo" ? "a credencial tem permissões além das do convite"
    : c.motivo === "escopo_fora_de_ordem" ? (c.para === "tudo" ? "as permissões da credencial atual não foram lidas nas últimas 26 horas (ou a leitura falhou)" : "faltam permissões do convite na credencial, ou elas não deram para ler")
    : c.motivo === "sem_ensaio" ? "falta um ensaio conferido com a credencial atual"
    : "uma reserva voltou do Beds24 sem a marca do SCL";
  return `${motivo}; ${c.para === "tudo" ? "nada é escrito" : "as reservas novas não são criadas, e as mudanças e os cancelamentos das já criadas seguem"}`;
}

/**
 * Existe acompanhamento com o motivo `marca_ilegivel` que conta (desenho 4.4): fora de `manual` e `encerrada`, de reserva com
 * a saída a partir de hoje (São Paulo). O antigo, de estadia que já terminou, não para as criações para sempre (a volta o
 * encerra; desenho 9).
 */
export async function existeMarcaIlegivelQueConta(db: Db, org: string, agora: Date): Promise<boolean> {
  const hoje = hojeISO(FUSO_PADRAO, agora);
  const motivo: MotivoAcompanhamentoBeds24 = "marca_ilegivel";
  const [l] = await db
    .select({ id: beds24ReservasSite.id })
    .from(beds24ReservasSite)
    .innerJoin(reservas, and(eq(reservas.id, beds24ReservasSite.reservaId), eq(reservas.organizacaoId, org)))
    .where(and(eq(beds24ReservasSite.organizacaoId, org), eq(beds24ReservasSite.motivo, motivo), notInArray(beds24ReservasSite.situacao, ["manual", "encerrada"]), sql`${reservas.checkout} >= ${hoje}`))
    .limit(1);
  return Boolean(l);
}

/** O estado para `motivoDeConfiguracaoDasReservas`, lido do banco e do ambiente (`env` explícito; sem leitura do Beds24). */
export async function estadoDaConfiguracaoDasReservas(db: Db, org: string, env: NodeJS.ProcessEnv, agora: Date, o: { leituraFalhou?: boolean } = {}): Promise<EstadoDaConfiguracaoDasReservas> {
  const credencial = impressaoCredencialBeds24(env);
  const rotina = await lerEstadoRotina(db, org);
  const config = await lerConfigReservasBeds24(db, org);
  const marcaIlegivel = await existeMarcaIlegivelQueConta(db, org, agora);
  return { refreshToken: Boolean(env.BEDS24_REFRESH_TOKEN?.trim()), credencial, rotina, leituraFalhou: o.leituraFalhou ?? false, agora, ensaioValido: ensaioValeParaCredencial(config, credencial), marcaIlegivel };
}

// ---------------------------------------------------------------- o último 403 ou 401 (Integrações)

export type UltimaRecusaDeReservas = {
  resposta: "http_401" | "http_403";
  /** O instante da recusa: a resposta do POST, ou o fim, ou o começo da operação (o 401 do pedido do token não tem resposta). */
  em: Date;
  tipo: TipoOperacaoBeds24;
  /** A recusa foi com a credencial de agora (com outra, o token já foi trocado depois dela). */
  comCredencialAtual: boolean;
};

/**
 * O último 403 ou 401 do POST de reservas (inclusive o do ensaio), pela `resposta` gravada, na ordem do instante real da
 * operação (a resposta, o fim ou o começo): a recusa sem resposta de POST nunca vai para o fim da fila. null = nenhum.
 */
export async function ultimaRecusaDeReservas(db: Db, org: string, env: NodeJS.ProcessEnv): Promise<UltimaRecusaDeReservas | null> {
  const op = beds24ReservasOperacoes;
  const instante = sql<Date>`coalesce(${op.respondidoEm}, ${op.terminadoEm}, ${op.iniciadoEm})`.mapWith(op.iniciadoEm);
  const [l] = await db
    .select({ resposta: op.resposta, em: instante, tipo: op.tipo, credencial: op.credencial })
    .from(op)
    .where(and(eq(op.organizacaoId, org), inArray(op.resposta, ["http_401", "http_403"])))
    .orderBy(desc(instante), desc(op.iniciadoEm))
    .limit(1);
  if (!l || (l.resposta !== "http_401" && l.resposta !== "http_403")) return null;
  const atual = impressaoCredencialBeds24(env);
  return { resposta: l.resposta, em: l.em, tipo: l.tipo, comCredencialAtual: Boolean(atual) && l.credencial === atual };
}
