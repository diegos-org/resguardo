/**
 * Contadores do dia dos avisos do WhatsApp (M10.1a, desenho na seção "Idempotência e ordem" de
 * `requisitos/product/WHATSAPP.md`), como `pagamentos_avisos_dia` do Mercado Pago: uma linha por dia de São Paulo, sem
 * organização (a assinatura inválida chega antes de saber de quem é) e sem nenhum dado do aviso, só números e o "último
 * aviso válido". A limpeza de 90 dias (mesmo prazo dos eventos do Mercado Pago, `lib/retencao.ts`) apaga também os
 * eventos (`whatsapp_eventos`), guardando o último dia com aviso válido.
 */
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { whatsappAvisosDia, whatsappEventos } from "@/db/schema";
import type { Db } from "@/db/types";
import { FUSO_PADRAO, hojeISO } from "@/lib/datas";
import { GUARDAR_EVENTOS_DIAS } from "@/lib/retencao";
import { CONTADORES_DIA, type ContadorDia } from "./regras";

export type ContagemDoDia = Partial<Record<ContadorDia, number>>;

/** A coluna de cada contador, numa lista fechada: nenhuma coluna é montada por texto. */
const COLUNA = {
  assinaturas_recusadas: "assinaturasRecusadas",
  ilegiveis: "ilegiveis",
  outra_conta: "outraConta",
  desconhecidos: "desconhecidos",
  ignorados: "ignorados",
} as const satisfies Record<ContadorDia, keyof typeof whatsappAvisosDia.$inferSelect>;

/** Só soma inteiro positivo (o resto é ignorado: um contador nunca desce). */
const parcela = (n: unknown): number => (typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : 0);

/** Soma `origem` em `destino` (puro), contador a contador. */
export function somarContagens(destino: ContagemDoDia, origem: ContagemDoDia): ContagemDoDia {
  for (const k of CONTADORES_DIA) {
    const n = parcela(origem[k]);
    if (n) destino[k] = (destino[k] ?? 0) + n;
  }
  return destino;
}

/**
 * Um upsert por chamada, no dia de São Paulo de `agora`; atômico (`coluna + n`), sem ler antes. `valido` = o aviso
 * passou pela assinatura: grava `ultimo_valido_em` (só avança). Nada a somar e não válido: não toca o banco.
 */
export async function somarNoDia(db: Db, soma: ContagemDoDia, agora: Date, o: { valido?: boolean } = {}): Promise<void> {
  const parcelas = CONTADORES_DIA.map((k) => [k, parcela(soma[k])] as const).filter(([, n]) => n > 0);
  if (!parcelas.length && !o.valido) return;
  const valores: typeof whatsappAvisosDia.$inferInsert = { dia: hojeISO(FUSO_PADRAO, agora) };
  const set: Record<string, unknown> = {};
  for (const [k, n] of parcelas) {
    valores[COLUNA[k]] = n;
    set[COLUNA[k]] = sql`${whatsappAvisosDia[COLUNA[k]]} + ${n}`;
  }
  if (o.valido) {
    valores.ultimoValidoEm = agora;
    set.ultimoValidoEm = sql`greatest(${whatsappAvisosDia.ultimoValidoEm}, ${agora.toISOString()}::timestamptz)`;
  }
  await db.insert(whatsappAvisosDia).values(valores).onConflictDoUpdate({ target: whatsappAvisosDia.dia, set });
}

/** Para Integrações: os contadores de hoje (zero quando não há linha) e o último aviso válido, de qualquer dia. */
export async function situacaoDosAvisosWhatsapp(db: Db, agora: Date): Promise<{ hoje: Record<ContadorDia, number>; ultimoValidoEm: Date | null }> {
  const [linha] = await db.select().from(whatsappAvisosDia).where(eq(whatsappAvisosDia.dia, hojeISO(FUSO_PADRAO, agora)));
  const [ultimo] = await db
    .select({ em: whatsappAvisosDia.ultimoValidoEm })
    .from(whatsappAvisosDia)
    .where(sql`${whatsappAvisosDia.ultimoValidoEm} is not null`)
    .orderBy(desc(whatsappAvisosDia.ultimoValidoEm))
    .limit(1);
  const hoje = Object.fromEntries(CONTADORES_DIA.map((k) => [k, linha ? linha[COLUNA[k]] : 0])) as Record<ContadorDia, number>;
  return { hoje, ultimoValidoEm: ultimo?.em ?? null };
}

/**
 * Limpeza (rotina de hora em hora): eventos recebidos antes de `agora` − 90 dias e os dias anteriores ao dia do corte,
 * menos o dia mais recente com aviso válido (o "último aviso válido" continua aparecendo mesmo depois de meses parado).
 */
export async function apagarAvisosWhatsappAntigos(db: Db, agora: Date): Promise<{ eventos: number; dias: number }> {
  const corte = new Date(agora.getTime() - GUARDAR_EVENTOS_DIAS * 86_400_000);
  const eventos = await db.delete(whatsappEventos).where(lt(whatsappEventos.recebidoEm, corte)).returning({ id: whatsappEventos.id });
  const [ultimo] = await db
    .select({ dia: whatsappAvisosDia.dia })
    .from(whatsappAvisosDia)
    .where(sql`${whatsappAvisosDia.ultimoValidoEm} is not null`)
    .orderBy(desc(whatsappAvisosDia.dia))
    .limit(1);
  const dias = await db
    .delete(whatsappAvisosDia)
    .where(and(lt(whatsappAvisosDia.dia, hojeISO(FUSO_PADRAO, corte)), ultimo ? sql`${whatsappAvisosDia.dia} <> ${ultimo.dia}` : undefined))
    .returning({ dia: whatsappAvisosDia.dia });
  return { eventos: eventos.length, dias: dias.length };
}
