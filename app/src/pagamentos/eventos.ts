/**
 * Pagamento no site (M8.2a) — registro dos avisos (webhooks) do provedor. Só entram avisos com assinatura válida
 * (a rota confere antes): tipo, ação, id, request-id, ts, quando e o resultado do processamento, sem nada do
 * corpo. A repetição (mesmo request-id, ts e id) não é processada de novo. Sem request-id e sem ts não há como
 * reconhecer a repetição: cada aviso é um evento e é processado (a leitura da order é idempotente; dois avisos
 * diferentes da mesma order nunca se fundem num só). Assinatura inválida só conta num número
 * agregado do dia, ao lado do "último aviso válido em". Os eventos são apagados depois de 90 dias.
 */
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { eventosPagamento, pagamentosAvisosDia, type ResultadoEventoPagamento } from "@/db/schema";
import type { Db } from "@/db/types";
import { hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";

export const GUARDAR_EVENTOS_DIAS = 90;
const FUSO = "America/Sao_Paulo";

const codigo = (v: unknown) => (typeof v === "string" && /^[a-z0-9_.]{1,60}$/i.test(v.trim()) ? v.trim().toLowerCase() : "");
const texto = (v: unknown, max: number) => (typeof v === "string" && /^[\x21-\x7E]+$/.test(v.trim()) && v.trim().length <= max ? v.trim() : "");

export type DadosEvento = { tipo?: unknown; acao?: unknown; dataId: string; requestId?: unknown; ts?: unknown; aoVivo?: unknown };

/**
 * Grava o aviso válido (e marca o "último aviso válido"). `novo` = false quando é repetição: quem chama responde
 * 200 e não processa de novo.
 */
export async function registrarEventoDeAviso(db: Db, e: DadosEvento, agora: Date = new Date()): Promise<{ id: string; novo: boolean } | null> {
  const dataId = texto(e.dataId, 64);
  if (!dataId) return null;
  const valores = { tipo: codigo(e.tipo), acao: codigo(e.acao), dataId, requestId: texto(e.requestId, 128), ts: /^\d{1,20}$/.test(String(e.ts ?? "")) ? String(e.ts) : "", aoVivo: typeof e.aoVivo === "boolean" ? e.aoVivo : null, recebidoEm: agora };
  const reconhecivel = valores.requestId !== "" || valores.ts !== "";
  // Evento e "último aviso válido" numa transação só: se uma das gravações falhar, nada fica (a rota responde 500 e o
  // provedor reenvia), e o reenvio é processado como novo, nunca dado por repetição de um evento que não foi adiante.
  return db.transaction(async (tx) => {
    const insercao = tx.insert(eventosPagamento).values(valores);
    const [novo] = reconhecivel
      ? await insercao
          .onConflictDoNothing({ target: [eventosPagamento.requestId, eventosPagamento.ts, eventosPagamento.dataId], where: sql`${eventosPagamento.requestId} <> '' or ${eventosPagamento.ts} <> ''` })
          .returning({ id: eventosPagamento.id })
      : await insercao.returning({ id: eventosPagamento.id });
    await tx
      .insert(pagamentosAvisosDia)
      .values({ dia: hojeISO(FUSO, agora), ultimoValidoEm: agora })
      .onConflictDoUpdate({ target: pagamentosAvisosDia.dia, set: { ultimoValidoEm: agora } });
    if (novo) return { id: novo.id, novo: true };
    if (!reconhecivel) return null;
    const [existente] = await tx
      .select({ id: eventosPagamento.id })
      .from(eventosPagamento)
      .where(and(eq(eventosPagamento.requestId, valores.requestId), eq(eventosPagamento.ts, valores.ts), eq(eventosPagamento.dataId, dataId)));
    return existente ? { id: existente.id, novo: false } : null;
  });
}

/** Resultado do processamento (depois da resposta), para a rotina saber o que falhou. */
export async function marcarResultadoDoEvento(db: Db, eventoId: string, resultado: ResultadoEventoPagamento, agora: Date = new Date(), organizacaoId: string | null = null): Promise<void> {
  if (!uuidValido(eventoId)) return;
  await db.update(eventosPagamento).set({ resultado, processadoEm: agora, ...(organizacaoId ? { organizacaoId } : {}) }).where(eq(eventosPagamento.id, eventoId));
}

/** Aviso com assinatura inválida (ou sem segredo configurado): só a conta do dia, nenhum dado do pedido. */
export async function registrarAssinaturaRecusada(db: Db, agora: Date = new Date()): Promise<void> {
  await db
    .insert(pagamentosAvisosDia)
    .values({ dia: hojeISO(FUSO, agora), assinaturasRecusadas: 1 })
    .onConflictDoUpdate({ target: pagamentosAvisosDia.dia, set: { assinaturasRecusadas: sql`${pagamentosAvisosDia.assinaturasRecusadas} + 1` } });
}

/** Para Integrações: assinaturas recusadas hoje e o último aviso válido. */
export async function situacaoDosAvisos(db: Db, agora: Date = new Date()): Promise<{ recusadasHoje: number; ultimoValidoEm: Date | null }> {
  const [hoje] = await db.select({ recusadas: pagamentosAvisosDia.assinaturasRecusadas }).from(pagamentosAvisosDia).where(eq(pagamentosAvisosDia.dia, hojeISO(FUSO, agora)));
  const [ultimo] = await db
    .select({ em: pagamentosAvisosDia.ultimoValidoEm })
    .from(pagamentosAvisosDia)
    .where(sql`${pagamentosAvisosDia.ultimoValidoEm} is not null`)
    .orderBy(desc(pagamentosAvisosDia.ultimoValidoEm))
    .limit(1);
  return { recusadasHoje: hoje?.recusadas ?? 0, ultimoValidoEm: ultimo?.em ?? null };
}

/** Limpeza: eventos com mais de 90 dias e contas diárias com mais de 90 dias (a mais recente com aviso válido fica). */
export async function apagarEventosAntigos(db: Db, agora: Date = new Date()): Promise<number> {
  const corte = new Date(agora.getTime() - GUARDAR_EVENTOS_DIAS * 86_400_000);
  const apagados = await db.delete(eventosPagamento).where(lt(eventosPagamento.recebidoEm, corte)).returning({ id: eventosPagamento.id });
  const [ultimo] = await db.select({ dia: pagamentosAvisosDia.dia }).from(pagamentosAvisosDia).where(sql`${pagamentosAvisosDia.ultimoValidoEm} is not null`).orderBy(desc(pagamentosAvisosDia.dia)).limit(1);
  await db.delete(pagamentosAvisosDia).where(and(lt(pagamentosAvisosDia.dia, hojeISO(FUSO, corte)), ultimo ? sql`${pagamentosAvisosDia.dia} <> ${ultimo.dia}` : undefined));
  return apagados.length;
}
