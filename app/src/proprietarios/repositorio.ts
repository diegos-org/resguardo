import { and, asc, eq, inArray } from "drizzle-orm";
import { calcularMudancas, registrarAuditoria } from "@/auditoria/auditoria";
import { imoveis, proprietarioImoveis, proprietarios, representantes } from "@/db/schema";
import type { Db } from "@/db/types";
import type { DadosProprietario, DadosRepresentante } from "./validacao";

export type Proprietario = typeof proprietarios.$inferSelect;
export type Representante = typeof representantes.$inferSelect;
export type ProprietarioNaLista = Proprietario & { imoveis: { id: string; codigo: string }[] };

const uuidOk = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

export async function listarProprietarios(db: Db, organizacaoId: string): Promise<ProprietarioNaLista[]> {
  const donos = await db.select().from(proprietarios).where(eq(proprietarios.organizacaoId, organizacaoId)).orderBy(asc(proprietarios.nome));
  if (donos.length === 0) return [];
  const vinculos = await db
    .select({ proprietarioId: proprietarioImoveis.proprietarioId, id: imoveis.id, codigo: imoveis.codigo })
    .from(proprietarioImoveis)
    .innerJoin(imoveis, eq(imoveis.id, proprietarioImoveis.imovelId))
    .where(inArray(proprietarioImoveis.proprietarioId, donos.map((d) => d.id)))
    .orderBy(asc(imoveis.codigo));
  return donos.map((d) => ({
    ...d,
    imoveis: vinculos.filter((v) => v.proprietarioId === d.id).map(({ id, codigo }) => ({ id, codigo })),
  }));
}

export async function obterProprietario(db: Db, organizacaoId: string, id: string) {
  if (!uuidOk(id)) return null;
  const [dono] = await db
    .select()
    .from(proprietarios)
    .where(and(eq(proprietarios.id, id), eq(proprietarios.organizacaoId, organizacaoId)));
  if (!dono) return null;
  const [reps, vinculos] = await Promise.all([
    db.select().from(representantes).where(eq(representantes.proprietarioId, id)).orderBy(asc(representantes.criadoEm)),
    db.select({ imovelId: proprietarioImoveis.imovelId }).from(proprietarioImoveis).where(eq(proprietarioImoveis.proprietarioId, id)),
  ]);
  return { ...dono, representantes: reps, imovelIds: vinculos.map((v) => v.imovelId).sort() };
}

const auditar = (db: Db, organizacaoId: string, autorId: string | null, acao: string, id: string, mudancas: Record<string, [unknown, unknown]>) =>
  registrarAuditoria(db, { organizacaoId, usuarioId: autorId, acao, entidade: "proprietario", entidadeId: id, mudancas });

/** O documento e o Pix nunca são gravados por extenso na auditoria. */
function semSensiveis(m: Record<string, [unknown, unknown]>) {
  for (const campo of ["documento", "chavePix"]) if (m[campo]) m[campo] = ["(alterado)", "(alterado)"];
  return m;
}

export async function criarProprietario(db: Db, organizacaoId: string, dados: DadosProprietario, autorId: string | null) {
  const [novo] = await db.insert(proprietarios).values({ ...dados, organizacaoId }).returning();
  await auditar(db, organizacaoId, autorId, "proprietario.criar", novo.id, semSensiveis(calcularMudancas(null, novo)));
  return novo;
}

export async function atualizarProprietario(db: Db, organizacaoId: string, id: string, dados: DadosProprietario, autorId: string | null) {
  if (!uuidOk(id)) return null;
  const [antes] = await db
    .select()
    .from(proprietarios)
    .where(and(eq(proprietarios.id, id), eq(proprietarios.organizacaoId, organizacaoId)));
  if (!antes) return null;
  const [depois] = await db
    .update(proprietarios)
    .set({ ...dados, atualizadoEm: new Date() })
    .where(and(eq(proprietarios.id, id), eq(proprietarios.organizacaoId, organizacaoId)))
    .returning();
  const mudancas = calcularMudancas(antes, depois);
  if (Object.keys(mudancas).length) await auditar(db, organizacaoId, autorId, "proprietario.editar", id, semSensiveis(mudancas));
  return depois;
}

/** Substitui os imóveis do proprietário. Ignora imóveis de outra organização. */
export async function definirImoveis(db: Db, organizacaoId: string, id: string, imovelIds: string[], autorId: string | null) {
  const antes = await obterProprietario(db, organizacaoId, id);
  if (!antes) return false;
  const validos = imovelIds.filter(uuidOk);
  const permitidos = validos.length
    ? (
        await db
          .select({ id: imoveis.id })
          .from(imoveis)
          .where(and(eq(imoveis.organizacaoId, organizacaoId), inArray(imoveis.id, validos)))
      ).map((i) => i.id)
    : [];
  const novos = [...new Set(permitidos)].sort();
  if (JSON.stringify(novos) === JSON.stringify(antes.imovelIds)) return true;

  await db.delete(proprietarioImoveis).where(eq(proprietarioImoveis.proprietarioId, id));
  if (novos.length) await db.insert(proprietarioImoveis).values(novos.map((imovelId) => ({ proprietarioId: id, imovelId })));
  await auditar(db, organizacaoId, autorId, "proprietario.imoveis", id, { imoveis: [antes.imovelIds, novos] });
  return true;
}

export async function adicionarRepresentante(db: Db, organizacaoId: string, proprietarioId: string, dados: DadosRepresentante, autorId: string | null) {
  if (!(await obterProprietario(db, organizacaoId, proprietarioId))) return null;
  const [rep] = await db.insert(representantes).values({ ...dados, proprietarioId }).returning();
  await auditar(db, organizacaoId, autorId, "proprietario.representante.adicionar", proprietarioId, { representante: [null, rep.nome] });
  return rep;
}

export async function removerRepresentante(db: Db, organizacaoId: string, proprietarioId: string, representanteId: string, autorId: string | null) {
  if (!uuidOk(representanteId) || !(await obterProprietario(db, organizacaoId, proprietarioId))) return false;
  const [removido] = await db
    .delete(representantes)
    .where(and(eq(representantes.id, representanteId), eq(representantes.proprietarioId, proprietarioId)))
    .returning();
  if (!removido) return false;
  await auditar(db, organizacaoId, autorId, "proprietario.representante.remover", proprietarioId, { representante: [removido.nome, null] });
  return true;
}
