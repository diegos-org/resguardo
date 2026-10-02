import { and, asc, count, desc, eq, getTableColumns, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { beds24ExecucaoReservas, beds24Execucoes, ESTADOS_RESERVA, reservas, type EstadoReserva } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { ESTADOS_OCUPANTES } from "./regras";

export const TAMANHO_PAGINA = 25;
export type ParamsLista = Record<string, string | string[] | undefined>;
export type FiltrosLista = {
  busca: string; situacao: EstadoReserva | "todas"; escopo: "periodo" | "historico";
  ordem: "checkin" | "origem"; recentes: 0 | 7 | 30; pagina: number;
  execucao: string; mudanca: "todas" | "adicionada" | "alterada" | "cancelada";
};
const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
export function lerFiltrosLista(p: ParamsLista): FiltrosLista {
  const estado = primeiro(p.situacao) as EstadoReserva;
  const pag = Number(primeiro(p.pagina));
  const mudanca = primeiro(p.mudanca);
  return {
    busca: primeiro(p.busca).trim().slice(0, 100),
    situacao: ESTADOS_RESERVA.includes(estado) ? estado : "todas",
    escopo: primeiro(p.escopo) === "historico" ? "historico" : "periodo",
    ordem: primeiro(p.ordem) === "origem" ? "origem" : "checkin",
    recentes: primeiro(p.recentes) === "7" ? 7 : primeiro(p.recentes) === "30" ? 30 : 0,
    pagina: Number.isSafeInteger(pag) && pag > 0 ? Math.min(pag, 1_000_000) : 1,
    // Preserva seleção inválida como filtro vazio de resultados (não abre toda a lista).
    execucao: primeiro(p.execucao).slice(0, 100),
    mudanca: ["adicionada", "alterada", "cancelada"].includes(mudanca) ? mudanca as FiltrosLista["mudanca"] : "todas",
  };
}

const CHAVES = ["imovel", "mes", "ano", "busca", "situacao", "escopo", "ordem", "recentes", "execucao", "mudanca", "canceladas"];
export function linkLista(p: ParamsLista, alteracoes: Record<string, string | null> = {}) {
  const q = new URLSearchParams();
  for (const k of CHAVES) for (const v of [p[k] ?? []].flat()) q.append(k, v);
  for (const [k, v] of Object.entries(alteracoes)) { q.delete(k); if (v !== null) q.set(k, v); }
  return `/painel/reservas?${q}`;
}

/** Consulta paginada exclusiva da lista. Calendário/indicadores continuam usando o período completo. */
export async function listarReservasPaginadas(db: Db, org: string, f: FiltrosLista, o: {
  imovelIds: string[]; periodo: { inicio: string; fim: string }; incluirCanceladas?: boolean; agora?: Date;
}) {
  const condicoes = [eq(reservas.organizacaoId, org), o.imovelIds.length ? inArray(reservas.imovelId, o.imovelIds) : sql`false`];
  if (f.escopo === "periodo") condicoes.push(lt(reservas.checkin, o.periodo.fim), sql`${reservas.checkout} > ${o.periodo.inicio}`);
  if (f.situacao !== "todas") condicoes.push(eq(reservas.estado, f.situacao));
  else if (!o.incluirCanceladas && !f.execucao) condicoes.push(sql`${reservas.estado} <> 'cancelada'`);
  if (f.busca) {
    const termo = `%${f.busca.replace(/[\\%_]/g, "\\$&")}%`;
    condicoes.push(or(ilike(reservas.codigo, termo), ilike(reservas.codigoCanal, termo), ilike(reservas.hospedeNome, termo))!);
  }
  if (f.recentes) {
    const agora = o.agora ?? new Date();
    condicoes.push(gte(reservas.reservadaEm, new Date(agora.getTime() - f.recentes * 86_400_000)), sql`${reservas.reservadaEm} <= ${agora}`);
  }
  if (f.execucao) {
    condicoes.push(uuidValido(f.execucao) ? sql`exists (select 1 from ${beds24ExecucaoReservas} e where e.organizacao_id = ${org} and e.execucao_id = ${f.execucao} and e.reserva_id = reservas.id ${f.mudanca === "todas" ? sql`` : sql`and e.tipo = ${f.mudanca}`})` : sql`false`);
  }
  const onde = and(...condicoes);
  const [{ total }] = await db.select({ total: count() }).from(reservas).where(onde);
  const paginas = Math.max(1, Math.ceil(total / TAMANHO_PAGINA));
  const pagina = Math.min(f.pagina, paginas);
  // Consulta não conflita; a outra reserva é procurada no conjunto inteiro, mesmo fora da página/busca.
  const conflito = sql<boolean>`${inArray(reservas.estado, [...ESTADOS_OCUPANTES])} and exists (
    select 1 from reservas outra where outra.organizacao_id = ${org} and outra.imovel_id = reservas.imovel_id
    and outra.id <> reservas.id and outra.estado in (${sql.join(ESTADOS_OCUPANTES.map(e => sql`${e}`), sql`, `)})
    and outra.checkin < reservas.checkout and outra.checkout > reservas.checkin)`;
  const itens = await db.select({ ...getTableColumns(reservas), conflito }).from(reservas).where(onde)
    .orderBy(...(f.ordem === "origem" ? [sql`${reservas.reservadaEm} desc nulls last`, asc(reservas.id)] : [asc(reservas.checkin), asc(reservas.codigo), asc(reservas.id)]))
    .limit(TAMANHO_PAGINA).offset((pagina - 1) * TAMANHO_PAGINA);
  return { itens, total, pagina, paginas };
}

export async function resumoImportacao(db: Db, org: string, id?: string) {
  if (id && !uuidValido(id)) return null;
  const [execucao] = await db.select().from(beds24Execucoes).where(and(eq(beds24Execucoes.organizacaoId, org), id ? eq(beds24Execucoes.id, id) : inArray(beds24Execucoes.situacao, ["ok", "parcial"])))
    .orderBy(desc(beds24Execucoes.iniciadoEm), desc(beds24Execucoes.id)).limit(1);
  if (!execucao) return null;
  const totais = await db.select({ tipo: beds24ExecucaoReservas.tipo, total: count() }).from(beds24ExecucaoReservas)
    .where(and(eq(beds24ExecucaoReservas.organizacaoId, org), eq(beds24ExecucaoReservas.execucaoId, execucao.id))).groupBy(beds24ExecucaoReservas.tipo);
  return { execucao, totais };
}
