/**
 * Configuração "quem recebe o pagamento" por imóvel e canal (M2.7). Ao mudar, as reservas
 * do imóvel são recalculadas (uma regra, um lugar, e tudo acompanha).
 */
import { and, eq } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { imoveis, ORIGENS_RESERVA, type OrigemReserva, RECEBIMENTOS_RESERVA, type RecebimentoReserva, recebimentoPorCanal } from "@/db/schema";
import type { Db } from "@/db/types";
import { recalcularReservas } from "@/financeiro/aplicar";
import { uuidValido } from "@/lib/ids";

export type ConfigRecebimento = Partial<Record<OrigemReserva, RecebimentoReserva>>;

export async function lerRecebimento(db: Db, organizacaoId: string, imovelId: string): Promise<ConfigRecebimento> {
  if (!uuidValido(imovelId)) return {};
  const linhas = await db
    .select({ origem: recebimentoPorCanal.origem, recebimento: recebimentoPorCanal.recebimento })
    .from(recebimentoPorCanal)
    .where(and(eq(recebimentoPorCanal.organizacaoId, organizacaoId), eq(recebimentoPorCanal.imovelId, imovelId)));
  return Object.fromEntries(linhas.map((l) => [l.origem, l.recebimento]));
}

/**
 * Grava a configuração inteira do imóvel (origem → split/empresa; ausente = padrão do
 * sistema) e recalcula as reservas dele, tudo-ou-nada. Retorna false se o imóvel não é da organização.
 */
export async function salvarRecebimento(db: Db, organizacaoId: string, imovelId: string, nova: ConfigRecebimento, autorId: string | null): Promise<boolean> {
  if (!uuidValido(imovelId)) return false;
  for (const [o, r] of Object.entries(nova)) {
    if (!ORIGENS_RESERVA.includes(o as OrigemReserva) || !RECEBIMENTOS_RESERVA.includes(r)) return false;
  }
  const mudou = await db.transaction(async (tx) => {
    const [im] = await tx
      .select({ id: imoveis.id })
      .from(imoveis)
      .where(and(eq(imoveis.id, imovelId), eq(imoveis.organizacaoId, organizacaoId)))
      .for("update");
    if (!im) return null;
    const antes = await lerRecebimento(tx, organizacaoId, imovelId);
    const mudancas: Record<string, [unknown, unknown]> = {};
    for (const o of ORIGENS_RESERVA) if ((antes[o] ?? null) !== (nova[o] ?? null)) mudancas[o] = [antes[o] ?? "padrão", nova[o] ?? "padrão"];
    if (!Object.keys(mudancas).length) return false;
    await tx.delete(recebimentoPorCanal).where(eq(recebimentoPorCanal.imovelId, imovelId));
    const linhas = Object.entries(nova).map(([origem, recebimento]) => ({ organizacaoId, imovelId, origem: origem as OrigemReserva, recebimento: recebimento! }));
    if (linhas.length) await tx.insert(recebimentoPorCanal).values(linhas);
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "imovel.recebimento", entidade: "imovel", entidadeId: imovelId, mudancas });
    // Na MESMA transação: se o recálculo falhar, a configuração também não é gravada
    // (nada fica meio recalculado e salvar de novo refaz tudo).
    await recalcularReservas(tx, organizacaoId, { imovelId }, autorId); // de hoje em diante
    return true;
  });
  return mudou !== null;
}
