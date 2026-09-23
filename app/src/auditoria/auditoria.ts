import { and, desc, eq } from "drizzle-orm";
import { auditoria, usuarios } from "@/db/schema";
import type { Db } from "@/db/types";

export type Mudancas = Record<string, [unknown, unknown]>;

const IGNORAR = new Set(["id", "organizacaoId", "criadoEm", "atualizadoEm"]);

function normalizar(v: unknown): unknown {
  return v instanceof Date ? v.toISOString() : (v ?? null);
}

/** Compara dois registros e devolve só os campos que mudaram. `antes` null = criação. */
export function calcularMudancas(antes: Record<string, unknown> | null, depois: Record<string, unknown>): Mudancas {
  const mudancas: Mudancas = {};
  for (const campo of Object.keys(depois)) {
    if (IGNORAR.has(campo)) continue;
    const a = normalizar(antes?.[campo]);
    const d = normalizar(depois[campo]);
    if (antes === null || JSON.stringify(a) !== JSON.stringify(d)) mudancas[campo] = [antes === null ? null : a, d];
  }
  return mudancas;
}

export type RegistroAuditoria = {
  organizacaoId: string;
  usuarioId: string | null;
  acao: string;
  entidade: string;
  entidadeId: string;
  mudancas: Mudancas;
};

/** Registra uma alteração. O registro nunca é editado nem apagado pelo sistema. */
export async function registrarAuditoria(db: Db, r: RegistroAuditoria): Promise<void> {
  await db.insert(auditoria).values(r);
}

export type LinhaHistorico = {
  id: string;
  acao: string;
  mudancas: Mudancas;
  criadoEm: Date;
  autor: string | null;
};

export async function historicoDe(db: Db, organizacaoId: string, entidade: string, entidadeId: string, limite = 20): Promise<LinhaHistorico[]> {
  const linhas = await db
    .select({
      id: auditoria.id,
      acao: auditoria.acao,
      mudancas: auditoria.mudancas,
      criadoEm: auditoria.criadoEm,
      autor: usuarios.nome,
    })
    .from(auditoria)
    .leftJoin(usuarios, eq(usuarios.id, auditoria.usuarioId))
    .where(and(eq(auditoria.organizacaoId, organizacaoId), eq(auditoria.entidade, entidade), eq(auditoria.entidadeId, entidadeId)))
    .orderBy(desc(auditoria.criadoEm), desc(auditoria.id))
    .limit(limite);
  return linhas.map((l) => ({ ...l, mudancas: l.mudancas as Mudancas }));
}

/** Remove campos do histórico que o leitor não pode ver (ex.: valores para quem não tem financeiro). */
export function ocultarCampos(linhas: LinhaHistorico[], campos: readonly string[]): LinhaHistorico[] {
  const esconder = new Set(campos);
  return linhas
    .map((l) => ({ ...l, mudancas: Object.fromEntries(Object.entries(l.mudancas).filter(([c]) => !esconder.has(c))) }))
    .filter((l) => l.acao.endsWith(".criar") || l.acao.endsWith(".importar") || Object.keys(l.mudancas).length > 0);
}
