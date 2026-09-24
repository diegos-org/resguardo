import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { calcularMudancas, registrarAuditoria } from "@/auditoria/auditoria";
import { imoveis, proprietarioImoveis, proprietarios, representantes } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido as uuidOk } from "@/lib/ids";
import type { DadosProprietario, DadosRepresentante } from "./validacao";

export type Proprietario = typeof proprietarios.$inferSelect;
export type Representante = typeof representantes.$inferSelect;
export type ProprietarioNaLista = Proprietario & { imoveis: { id: string; codigo: string }[] };


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
  return db.transaction(async (tx) => {
    const [novo] = await tx.insert(proprietarios).values({ ...dados, organizacaoId }).returning();
    await auditar(tx, organizacaoId, autorId, "proprietario.criar", novo.id, semSensiveis(calcularMudancas(null, novo)));
    return novo;
  });
}

/** Trava o proprietário (FOR UPDATE) dentro da transação. */
async function travar(tx: Db, organizacaoId: string, id: string) {
  const [linha] = await tx
    .select()
    .from(proprietarios)
    .where(and(eq(proprietarios.id, id), eq(proprietarios.organizacaoId, organizacaoId)))
    .for("update");
  return linha ?? null;
}

export async function atualizarProprietario(db: Db, organizacaoId: string, id: string, dados: DadosProprietario, autorId: string | null) {
  if (!uuidOk(id)) return null;
  return db.transaction(async (tx) => {
    const antes = await travar(tx, organizacaoId, id);
    if (!antes) return null;
    const [depois] = await tx
      .update(proprietarios)
      .set({ ...dados, atualizadoEm: new Date() })
      .where(eq(proprietarios.id, id))
      .returning();
    const mudancas = calcularMudancas(antes, depois);
    if (Object.keys(mudancas).length) await auditar(tx, organizacaoId, autorId, "proprietario.editar", id, semSensiveis(mudancas));
    return depois;
  });
}

/** Substitui os imóveis do proprietário. Ignora imóveis de outra organização. */
/** Imóveis da lista que já pertencem a OUTRO proprietário (cada imóvel tem um dono só). */
export async function imoveisDeOutroDono(db: Db, organizacaoId: string, imovelIds: string[], proprietarioId?: string) {
  const validos = imovelIds.filter(uuidOk);
  if (!validos.length) return [];
  return db
    .select({ imovelId: proprietarioImoveis.imovelId, codigo: imoveis.codigo, dono: proprietarios.nome })
    .from(proprietarioImoveis)
    .innerJoin(imoveis, eq(imoveis.id, proprietarioImoveis.imovelId))
    .innerJoin(proprietarios, eq(proprietarios.id, proprietarioImoveis.proprietarioId))
    .where(
      and(
        eq(imoveis.organizacaoId, organizacaoId),
        inArray(proprietarioImoveis.imovelId, validos),
        proprietarioId && uuidOk(proprietarioId) ? ne(proprietarioImoveis.proprietarioId, proprietarioId) : undefined,
      ),
    );
}

/** Define os imóveis do proprietário. Retorna false (não achou) ou a mensagem de conflito. */
export async function definirImoveis(db: Db, organizacaoId: string, id: string, imovelIds: string[], autorId: string | null): Promise<true | false | string> {
  if (!uuidOk(id)) return false;
  const validos = imovelIds.filter(uuidOk);
  return db.transaction(async (tx) => {
    if (!(await travar(tx, organizacaoId, id))) return false;
    const atuais = (
      await tx.select({ imovelId: proprietarioImoveis.imovelId }).from(proprietarioImoveis).where(eq(proprietarioImoveis.proprietarioId, id))
    )
      .map((v) => v.imovelId)
      .sort();
    const permitidos = validos.length
      ? (
          await tx
            .select({ id: imoveis.id })
            .from(imoveis)
            .where(and(eq(imoveis.organizacaoId, organizacaoId), inArray(imoveis.id, validos)))
        ).map((i) => i.id)
      : [];
    const novos = [...new Set(permitidos)].sort();
    if (JSON.stringify(novos) === JSON.stringify(atuais)) return true;
    const conflitos = await imoveisDeOutroDono(tx, organizacaoId, novos, id);
    if (conflitos.length) return mensagemConflito(conflitos);

    await tx.delete(proprietarioImoveis).where(eq(proprietarioImoveis.proprietarioId, id));
    if (novos.length) await tx.insert(proprietarioImoveis).values(novos.map((imovelId) => ({ proprietarioId: id, imovelId })));
    await auditar(tx, organizacaoId, autorId, "proprietario.imoveis", id, { imoveis: [atuais, novos] });
    return true;
  });
}

export const mensagemConflito = (c: { codigo: string; dono: string }[]) =>
  `Cada imóvel tem um proprietário só: ${c.map((x) => `${x.codigo} já é de ${x.dono}`).join("; ")}. Tire de lá primeiro.`;

export async function adicionarRepresentante(db: Db, organizacaoId: string, proprietarioId: string, dados: DadosRepresentante, autorId: string | null) {
  if (!uuidOk(proprietarioId)) return null;
  return db.transaction(async (tx) => {
    if (!(await travar(tx, organizacaoId, proprietarioId))) return null;
    const [rep] = await tx.insert(representantes).values({ ...dados, proprietarioId }).returning();
    await auditar(tx, organizacaoId, autorId, "proprietario.representante.adicionar", proprietarioId, { representante: [null, rep.nome] });
    return rep;
  });
}

export async function removerRepresentante(db: Db, organizacaoId: string, proprietarioId: string, representanteId: string, autorId: string | null) {
  if (!uuidOk(representanteId) || !uuidOk(proprietarioId)) return false;
  return db.transaction(async (tx) => {
    if (!(await travar(tx, organizacaoId, proprietarioId))) return false;
    const [removido] = await tx
      .delete(representantes)
      .where(and(eq(representantes.id, representanteId), eq(representantes.proprietarioId, proprietarioId)))
      .returning();
    if (!removido) return false;
    await auditar(tx, organizacaoId, autorId, "proprietario.representante.remover", proprietarioId, { representante: [removido.nome, null] });
    return true;
  });
}
