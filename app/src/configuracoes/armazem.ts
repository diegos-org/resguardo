/**
 * Armazém das configurações da organização (M1.7): uma linha por chave, com auditoria.
 * Cada tema (empresa, regras financeiras, textos do site) valida o seu formato e lê daqui.
 */
import { and, eq, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { configuracoes } from "@/db/schema";
import type { Db } from "@/db/types";

/** JSON com chaves em ordem (o jsonb do Postgres reordena as chaves ao gravar). */
function estavel(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(estavel).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${estavel((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

export type ChaveConfig = "empresa" | "regras_financeiras" | "textos_site" | "limpezas" | "agenda" | "portaria" | "fechamento_email";

export async function lerConfig(db: Db, organizacaoId: string, chave: ChaveConfig): Promise<Record<string, unknown> | null> {
  const [l] = await db
    .select({ valor: configuracoes.valor })
    .from(configuracoes)
    .where(and(eq(configuracoes.organizacaoId, organizacaoId), eq(configuracoes.chave, chave)));
  return l && typeof l.valor === "object" && l.valor !== null ? (l.valor as Record<string, unknown>) : null;
}

/** Trava a linha da chave (ou o lugar dela, se ainda não existe) até o fim da transação. */
export async function travarConfig(db: Db, organizacaoId: string, chave: ChaveConfig): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`config:${organizacaoId}:${chave}`}))`);
}

/**
 * Grava o valor inteiro da chave (quem chama já validou). Trava a linha para que duas
 * gravações simultâneas não se atropelem. Devolve o que mudou (vazio = nada mudou).
 */
export async function gravarConfig(
  db: Db,
  organizacaoId: string,
  chave: ChaveConfig,
  valor: Record<string, unknown>,
  autorId: string | null,
  /** false quando quem chama registra o histórico do seu jeito (ex.: versões das regras). */
  auditar = true,
): Promise<Record<string, [unknown, unknown]>> {
  await travarConfig(db, organizacaoId, chave);
  const [atual] = await db
    .select({ valor: configuracoes.valor })
    .from(configuracoes)
    .where(and(eq(configuracoes.organizacaoId, organizacaoId), eq(configuracoes.chave, chave)))
    .for("update");
  const antes = (atual?.valor as Record<string, unknown> | undefined) ?? null;
  const mudancas: Record<string, [unknown, unknown]> = {};
  for (const k of new Set([...Object.keys(antes ?? {}), ...Object.keys(valor)])) {
    if (estavel(antes?.[k]) !== estavel(valor[k])) mudancas[k] = [antes?.[k] ?? null, valor[k] ?? null];
  }
  if (!Object.keys(mudancas).length) return {};
  await db
    .insert(configuracoes)
    .values({ organizacaoId, chave, valor, atualizadoPor: autorId })
    .onConflictDoUpdate({ target: [configuracoes.organizacaoId, configuracoes.chave], set: { valor, atualizadoEm: new Date(), atualizadoPor: autorId } });
  if (auditar) await registrarAuditoria(db, { organizacaoId, usuarioId: autorId, acao: `configuracao.${chave}`, entidade: "configuracao", entidadeId: organizacaoId, mudancas });
  return mudancas;
}
