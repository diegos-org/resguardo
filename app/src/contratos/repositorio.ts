import { and, asc, eq } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { contratos, imoveis } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido as uuidOk } from "@/lib/ids";
import { bpParaTexto, type ErrosContrato, NOMES_TIPO, sobrepoe, validarContrato } from "./regras";

export type Contrato = typeof contratos.$inferSelect;


export async function listarContratos(db: Db, organizacaoId: string, imovelId: string): Promise<Contrato[]> {
  if (!uuidOk(imovelId)) return [];
  return db
    .select()
    .from(contratos)
    .where(and(eq(contratos.organizacaoId, organizacaoId), eq(contratos.imovelId, imovelId)))
    .orderBy(asc(contratos.inicio));
}

/** Trava o imóvel (FOR UPDATE): dois contratos criados ao mesmo tempo não se sobrepõem. */
async function travarImovel(tx: Db, organizacaoId: string, imovelId: string) {
  const [i] = await tx
    .select({ id: imoveis.id })
    .from(imoveis)
    .where(and(eq(imoveis.id, imovelId), eq(imoveis.organizacaoId, organizacaoId)))
    .for("update");
  return Boolean(i);
}

export async function criarContrato(
  db: Db,
  organizacaoId: string,
  imovelId: string,
  entrada: Record<string, FormDataEntryValue | undefined>,
  autorId: string | null,
): Promise<{ ok: true; contrato: Contrato } | { ok: false; erros: ErrosContrato }> {
  if (!uuidOk(imovelId)) return { ok: false, erros: { geral: "Imóvel não encontrado." } };
  return db.transaction(async (tx) => {
    if (!(await travarImovel(tx, organizacaoId, imovelId))) return { ok: false as const, erros: { geral: "Imóvel não encontrado." } };
    const r = validarContrato(entrada, await listarContratos(tx, organizacaoId, imovelId));
    if (!r.ok) return r;
    const [novo] = await tx
      .insert(contratos)
      .values({ ...r.dados, organizacaoId, imovelId })
      .returning();
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "contrato.criar",
      entidade: "imovel",
      entidadeId: imovelId,
      mudancas: { contrato: [null, `${NOMES_TIPO[novo.tipo]} ${bpParaTexto(novo.comissaoBp)} desde ${novo.inicio}${novo.fim ? ` até ${novo.fim}` : ""}`] },
    });
    return { ok: true as const, contrato: novo };
  });
}

/** Encerra um contrato numa data (último dia de vigência). */
export async function encerrarContrato(
  db: Db,
  organizacaoId: string,
  contratoId: string,
  fim: string,
  autorId: string | null,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (!uuidOk(contratoId)) return { ok: false, erro: "Contrato não encontrado." };
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(contratos)
      .where(and(eq(contratos.id, contratoId), eq(contratos.organizacaoId, organizacaoId)));
    if (!c || !(await travarImovel(tx, organizacaoId, c.imovelId))) return { ok: false as const, erro: "Contrato não encontrado." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fim) || fim < c.inicio) return { ok: false as const, erro: "A data de fim deve ser igual ou depois do início." };
    if (c.fim !== null && fim > c.fim) return { ok: false as const, erro: "Só é possível antecipar o fim, não estender." };
    const outros = (await listarContratos(tx, organizacaoId, c.imovelId)).filter((o) => o.id !== c.id);
    if (outros.some((o) => sobrepoe(o, { ...c, fim }))) return { ok: false as const, erro: "Conflita com outro contrato." };

    await tx.update(contratos).set({ fim }).where(eq(contratos.id, c.id));
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "contrato.encerrar",
      entidade: "imovel",
      entidadeId: c.imovelId,
      mudancas: { contrato: [`${NOMES_TIPO[c.tipo]} até ${c.fim ?? "sem fim"}`, `até ${fim}`] },
    });
    return { ok: true as const };
  });
}
