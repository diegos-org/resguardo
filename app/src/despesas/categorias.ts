import { and, asc, eq, sql } from "drizzle-orm";
import { calcularMudancas, registrarAuditoria } from "@/auditoria/auditoria";
import { violouUnicidade } from "@/db/erros";
import { appSettings, categoriasDespesa, lancamentos } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";

export type Categoria = typeof categoriasDespesa.$inferSelect;
export type ResultadoCategoria = { ok: true; categoria: Categoria } | { ok: false; erro: string };

/** Categorias sugeridas na primeira vez (Diego pode renomear ou arquivar). */
export const CATEGORIAS_INICIAIS = ["Equipe", "Limpeza e lavanderia", "Manutenção", "Mercado e consumo", "Contas (luz, água, internet)", "Outros"];

function validarNome(nome: string): string | null {
  const n = nome.trim();
  if (!n) return "Informe o nome da categoria.";
  if (n.length > 60) return "Nome com mais de 60 caracteres.";
  return null;
}

export async function listarCategorias(db: Db, organizacaoId: string, incluirArquivadas = false): Promise<Categoria[]> {
  return db
    .select()
    .from(categoriasDespesa)
    .where(and(eq(categoriasDespesa.organizacaoId, organizacaoId), incluirArquivadas ? undefined : eq(categoriasDespesa.ativa, true)))
    .orderBy(asc(sql`lower(${categoriasDespesa.nome})`));
}

export async function criarCategoria(db: Db, organizacaoId: string, nome: string, autorId: string | null): Promise<ResultadoCategoria> {
  const erro = validarNome(nome);
  if (erro) return { ok: false, erro };
  try {
    return await db.transaction(async (tx) => {
      const [categoria] = await tx.insert(categoriasDespesa).values({ organizacaoId, nome: nome.trim() }).returning();
      await registrarAuditoria(tx, {
        organizacaoId,
        usuarioId: autorId,
        acao: "categoria_despesa.criar",
        entidade: "categoria_despesa",
        entidadeId: categoria.id,
        mudancas: { nome: [null, categoria.nome] },
      });
      return { ok: true as const, categoria };
    });
  } catch (e) {
    if (violouUnicidade(e, "categorias_despesa_nome")) return { ok: false, erro: "Já existe uma categoria com esse nome." };
    throw e;
  }
}

/**
 * Cria as categorias iniciais uma única vez por organização (marca em app_settings). Se o
 * admin depois apagar todas, elas não voltam sozinhas.
 */
export async function garantirCategoriasIniciais(db: Db, organizacaoId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [marca] = await tx
      .insert(appSettings)
      .values({ key: `categorias-iniciais:${organizacaoId}`, value: { criadasEm: new Date().toISOString() } })
      .onConflictDoNothing()
      .returning();
    if (!marca) return; // já foi feito antes
    if ((await listarCategorias(tx, organizacaoId, true)).length) return;
    for (const nome of CATEGORIAS_INICIAIS) await criarCategoria(tx, organizacaoId, nome, null);
  });
}

/** Renomeia e/ou arquiva/reativa. */
export async function atualizarCategoria(
  db: Db,
  organizacaoId: string,
  id: string,
  dados: { nome?: string; ativa?: boolean },
  autorId: string | null,
): Promise<ResultadoCategoria> {
  if (!uuidValido(id)) return { ok: false, erro: "Categoria não encontrada." };
  if (dados.nome !== undefined) {
    const erro = validarNome(dados.nome);
    if (erro) return { ok: false, erro };
  }
  try {
    return await db.transaction(async (tx) => {
      const [antes] = await tx
        .select()
        .from(categoriasDespesa)
        .where(and(eq(categoriasDespesa.id, id), eq(categoriasDespesa.organizacaoId, organizacaoId)))
        .for("update");
      if (!antes) return { ok: false as const, erro: "Categoria não encontrada." };
      const novo = { ...antes, ...(dados.nome !== undefined ? { nome: dados.nome.trim() } : {}), ...(dados.ativa !== undefined ? { ativa: dados.ativa } : {}) };
      const mudancas = calcularMudancas(antes, novo);
      if (!Object.keys(mudancas).length) return { ok: true as const, categoria: antes };
      const [categoria] = await tx
        .update(categoriasDespesa)
        .set({ nome: novo.nome, ativa: novo.ativa })
        .where(eq(categoriasDespesa.id, id))
        .returning();
      await registrarAuditoria(tx, {
        organizacaoId,
        usuarioId: autorId,
        acao: "categoria_despesa.editar",
        entidade: "categoria_despesa",
        entidadeId: id,
        mudancas,
      });
      return { ok: true as const, categoria };
    });
  } catch (e) {
    if (violouUnicidade(e, "categorias_despesa_nome")) return { ok: false, erro: "Já existe uma categoria com esse nome." };
    throw e;
  }
}

/** Apaga só categoria nunca usada; usada → arquive. */
export async function excluirCategoria(db: Db, organizacaoId: string, id: string, autorId: string | null): Promise<{ ok: boolean; erro?: string }> {
  if (!uuidValido(id)) return { ok: false, erro: "Categoria não encontrada." };
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(categoriasDespesa)
      .where(and(eq(categoriasDespesa.id, id), eq(categoriasDespesa.organizacaoId, organizacaoId)))
      .for("update");
    if (!c) return { ok: false, erro: "Categoria não encontrada." };
    const [usada] = await tx.select({ id: lancamentos.id }).from(lancamentos).where(eq(lancamentos.categoriaId, id)).limit(1);
    if (usada) return { ok: false, erro: "Categoria já usada em lançamentos: arquive em vez de excluir." };
    await tx.delete(categoriasDespesa).where(eq(categoriasDespesa.id, id));
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "categoria_despesa.excluir",
      entidade: "categoria_despesa",
      entidadeId: id,
      mudancas: { nome: [c.nome, null] },
    });
    return { ok: true };
  });
}
