import { and, asc, eq } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { contratos, imoveis } from "@/db/schema";
import type { Db } from "@/db/types";
import { bpParaTexto, type ErrosContrato, NOMES_TIPO, sobrepoe, validarContrato } from "./regras";

export type Contrato = typeof contratos.$inferSelect;

const uuidOk = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

export async function listarContratos(db: Db, organizacaoId: string, imovelId: string): Promise<Contrato[]> {
  if (!uuidOk(imovelId)) return [];
  return db
    .select()
    .from(contratos)
    .where(and(eq(contratos.organizacaoId, organizacaoId), eq(contratos.imovelId, imovelId)))
    .orderBy(asc(contratos.inicio));
}

async function imovelDaOrganizacao(db: Db, organizacaoId: string, imovelId: string) {
  if (!uuidOk(imovelId)) return false;
  const [i] = await db
    .select({ id: imoveis.id })
    .from(imoveis)
    .where(and(eq(imoveis.id, imovelId), eq(imoveis.organizacaoId, organizacaoId)));
  return Boolean(i);
}

export async function criarContrato(
  db: Db,
  organizacaoId: string,
  imovelId: string,
  entrada: Record<string, FormDataEntryValue | undefined>,
  autorId: string | null,
): Promise<{ ok: true; contrato: Contrato } | { ok: false; erros: ErrosContrato }> {
  if (!(await imovelDaOrganizacao(db, organizacaoId, imovelId))) return { ok: false, erros: { geral: "Imóvel não encontrado." } };
  const r = validarContrato(entrada, await listarContratos(db, organizacaoId, imovelId));
  if (!r.ok) return r;
  const [novo] = await db
    .insert(contratos)
    .values({ ...r.dados, organizacaoId, imovelId })
    .returning();
  await registrarAuditoria(db, {
    organizacaoId,
    usuarioId: autorId,
    acao: "contrato.criar",
    entidade: "imovel",
    entidadeId: imovelId,
    mudancas: { contrato: [null, `${NOMES_TIPO[novo.tipo]} ${bpParaTexto(novo.comissaoBp)} desde ${novo.inicio}${novo.fim ? ` até ${novo.fim}` : ""}`] },
  });
  return { ok: true, contrato: novo };
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
  const [c] = await db
    .select()
    .from(contratos)
    .where(and(eq(contratos.id, contratoId), eq(contratos.organizacaoId, organizacaoId)));
  if (!c) return { ok: false, erro: "Contrato não encontrado." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fim) || fim < c.inicio) return { ok: false, erro: "A data de fim deve ser igual ou depois do início." };
  if (c.fim !== null && fim > c.fim) return { ok: false, erro: "Só é possível antecipar o fim, não estender." };
  const outros = (await listarContratos(db, organizacaoId, c.imovelId)).filter((o) => o.id !== c.id);
  if (outros.some((o) => sobrepoe(o, { ...c, fim }))) return { ok: false, erro: "Conflita com outro contrato." };

  await db.update(contratos).set({ fim }).where(eq(contratos.id, c.id));
  await registrarAuditoria(db, {
    organizacaoId,
    usuarioId: autorId,
    acao: "contrato.encerrar",
    entidade: "imovel",
    entidadeId: c.imovelId,
    mudancas: { contrato: [`${NOMES_TIPO[c.tipo]} até ${c.fim ?? "sem fim"}`, `até ${fim}`] },
  });
  return { ok: true };
}
