/**
 * Cópia datada da leitura do Beds24 (M3.11a, requisitos/product/FONTE-UNICA-PRECOS.md 3.1). Só inclusão: nenhuma função
 * daqui altera ou apaga uma cópia, e nenhum outro caminho do código o faz. A leitura de um imóvel é copiada antes de a
 * importação do Beds24 (M3.3) apagá-la, antes de a simulação ou o envio (M3.7) a regravarem, ao aprovar uma importação de
 * preços e pelo botão "Guardar uma cópia agora" — sempre na transação de quem regrava. Imóvel sem noites lidas não gera
 * cópia. A assinatura evita a cópia repetida: igual à última do imóvel naquele quarto, nada é gravado e vale a última.
 * Só preço, mínimo, máximo, unidades e bloqueio: nada de hóspede.
 */
import { createHash } from "node:crypto";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { beds24Calendario, beds24CalendarioCopias, type MotivoCopiaCalendario, type NoiteCopiada } from "@/db/schema";
import type { Db } from "@/db/types";

/** Uma linha da leitura (`beds24_calendario`) como noite da cópia. */
export const paraNoiteCopiada = (l: { data: string; preco: number | null; minimoNoites: number | null; maximoNoites: number | null; livres: number | null; bloqueio: string | null }): NoiteCopiada => ({
  data: l.data, preco: l.preco, minimo: l.minimoNoites, maximo: l.maximoNoites, livres: l.livres, bloqueio: l.bloqueio,
});

const emOrdemDeData = (noites: readonly NoiteCopiada[]) => [...noites].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));

/**
 * Assinatura de uma leitura: SHA-256 do quarto e das noites normalizadas (data, preço, mínimo, máximo, unidades livres e
 * bloqueio, nessa ordem, ausente = null), em ordem de data. A hora da leitura não entra: ler de novo sem mudança dá a mesma.
 * Uma regra, um lugar: a cópia e a proposta da importação (a leitura revisada) assinam por aqui.
 */
export function assinaturaDaLeitura(roomId: string | null, noites: readonly NoiteCopiada[]): string {
  const normalizadas = emOrdemDeData(noites).map((n) => [n.data, n.preco ?? null, n.minimo ?? null, n.maximo ?? null, n.livres ?? null, n.bloqueio ?? null]);
  return createHash("sha256").update(JSON.stringify([roomId ?? null, normalizadas])).digest("hex");
}

/** O que uma cópia guarda: as noites de um quarto e a hora da leitura mais nova entre elas. */
export type LeituraCopiada = { roomId: string | null; noites: readonly NoiteCopiada[]; lidoEm: Date };

/**
 * Guarda a cópia de uma leitura (as noites de um quarto). Igual à última cópia do imóvel naquele quarto (mesma
 * assinatura), nada é gravado e devolve a última; sem noites, nada é gravado (null). A aprovação da importação (M3.11a)
 * guarda por aqui a leitura que revisou, com a mesma assinatura da proposta.
 */
export async function guardarCopia(db: Db, org: string, imovelId: string, leitura: LeituraCopiada, motivo: MotivoCopiaCalendario, autorId: string | null): Promise<string | null> {
  if (!leitura.noites.length) return null;
  const noites = emOrdemDeData(leitura.noites);
  const assinatura = assinaturaDaLeitura(leitura.roomId, noites);
  const [ultima] = await db
    .select({ id: beds24CalendarioCopias.id, assinatura: beds24CalendarioCopias.assinatura })
    .from(beds24CalendarioCopias)
    .where(and(eq(beds24CalendarioCopias.organizacaoId, org), eq(beds24CalendarioCopias.imovelId, imovelId), leitura.roomId === null ? isNull(beds24CalendarioCopias.roomId) : eq(beds24CalendarioCopias.roomId, leitura.roomId)))
    .orderBy(desc(beds24CalendarioCopias.ordem))
    .limit(1);
  if (ultima?.assinatura === assinatura) return ultima.id;
  const [nova] = await db
    .insert(beds24CalendarioCopias)
    .values({ organizacaoId: org, imovelId, roomId: leitura.roomId, motivo, autorId, lidoEm: leitura.lidoEm, noites: noites.length, assinatura, dados: noites })
    .returning({ id: beds24CalendarioCopias.id });
  return nova.id;
}

/**
 * Copia a leitura atual do imóvel, todas as noites guardadas. Uma cópia por quarto: a leitura de antes de uma troca de
 * vínculo (ou sem quarto, de antes de a leitura guardá-lo) pode ter sobrado em algumas noites, e nada se perde. Devolve a
 * cópia (gravada ou a última igual) do quarto com a leitura mais nova; sem noites lidas, nada é gravado (null).
 */
export async function copiarLeitura(db: Db, org: string, imovelId: string, motivo: MotivoCopiaCalendario, o: { autorId?: string | null } = {}): Promise<string | null> {
  const linhas = await db.select().from(beds24Calendario).where(and(eq(beds24Calendario.organizacaoId, org), eq(beds24Calendario.imovelId, imovelId)));
  const porQuarto = new Map<string | null, { roomId: string | null; noites: NoiteCopiada[]; lidoEm: Date }>();
  for (const l of linhas) {
    const q = porQuarto.get(l.roomId) ?? { roomId: l.roomId, noites: [], lidoEm: l.observadoEm };
    q.noites.push(paraNoiteCopiada(l));
    if (l.observadoEm > q.lidoEm) q.lidoEm = l.observadoEm;
    porQuarto.set(l.roomId, q);
  }
  // Da leitura mais antiga para a mais nova: a última guardada é a que volta.
  let id: string | null = null;
  for (const leitura of [...porQuarto.values()].sort((a, b) => a.lidoEm.getTime() - b.lidoEm.getTime())) id = await guardarCopia(db, org, imovelId, leitura, motivo, o.autorId ?? null);
  return id;
}

export type CopiaResumida = Pick<typeof beds24CalendarioCopias.$inferSelect, "id" | "imovelId" | "roomId" | "motivo" | "autorId" | "criadoEm" | "lidoEm" | "noites" | "assinatura">;

/** A última cópia de cada imóvel da organização (ou só dos pedidos), sem as noites: a lista da importação lê daqui. */
export async function ultimasCopias(db: Db, org: string, imovelIds?: readonly string[]): Promise<Map<string, CopiaResumida>> {
  if (imovelIds && !imovelIds.length) return new Map();
  const c = beds24CalendarioCopias;
  const linhas = await db
    .selectDistinctOn([c.imovelId], { id: c.id, imovelId: c.imovelId, roomId: c.roomId, motivo: c.motivo, autorId: c.autorId, criadoEm: c.criadoEm, lidoEm: c.lidoEm, noites: c.noites, assinatura: c.assinatura })
    .from(c)
    .where(and(eq(c.organizacaoId, org), imovelIds ? inArray(c.imovelId, [...imovelIds]) : undefined))
    .orderBy(c.imovelId, desc(c.ordem));
  return new Map(linhas.map((l) => [l.imovelId, l]));
}

/** Quantas cópias a organização guarda (ou só as de um imóvel). */
export async function contarCopias(db: Db, org: string, imovelId?: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(beds24CalendarioCopias)
    .where(and(eq(beds24CalendarioCopias.organizacaoId, org), imovelId ? eq(beds24CalendarioCopias.imovelId, imovelId) : undefined));
  return n;
}
