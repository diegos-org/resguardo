import { and, asc, eq } from "drizzle-orm";
import { imoveis } from "@/db/schema";
import type { Db } from "@/db/types";
import type { DadosImovel } from "./validacao";

export type Imovel = typeof imoveis.$inferSelect;

/** Todas as consultas são presas à organização da sessão. */
export async function listarImoveis(db: Db, organizacaoId: string, opcoes: { incluirInativos?: boolean } = {}): Promise<Imovel[]> {
  const filtro = opcoes.incluirInativos
    ? eq(imoveis.organizacaoId, organizacaoId)
    : and(eq(imoveis.organizacaoId, organizacaoId), eq(imoveis.ativo, true));
  return db.select().from(imoveis).where(filtro).orderBy(asc(imoveis.codigo));
}

export async function obterImovel(db: Db, organizacaoId: string, id: string): Promise<Imovel | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [linha] = await db
    .select()
    .from(imoveis)
    .where(and(eq(imoveis.id, id), eq(imoveis.organizacaoId, organizacaoId)));
  return linha ?? null;
}

export class CodigoDuplicado extends Error {
  constructor(codigo: string) {
    super(`Já existe um imóvel com o código ${codigo}.`);
    this.name = "CodigoDuplicado";
  }
}

async function codigoEmUso(db: Db, organizacaoId: string, codigo: string, excetoId?: string) {
  const [linha] = await db
    .select({ id: imoveis.id })
    .from(imoveis)
    .where(and(eq(imoveis.organizacaoId, organizacaoId), eq(imoveis.codigo, codigo)));
  return Boolean(linha && linha.id !== excetoId);
}

export async function criarImovel(db: Db, organizacaoId: string, dados: DadosImovel): Promise<Imovel> {
  if (await codigoEmUso(db, organizacaoId, dados.codigo)) throw new CodigoDuplicado(dados.codigo);
  const [novo] = await db
    .insert(imoveis)
    .values({ ...dados, organizacaoId })
    .returning();
  return novo;
}

export async function atualizarImovel(db: Db, organizacaoId: string, id: string, dados: DadosImovel): Promise<Imovel | null> {
  if (await codigoEmUso(db, organizacaoId, dados.codigo, id)) throw new CodigoDuplicado(dados.codigo);
  const [atualizado] = await db
    .update(imoveis)
    .set({ ...dados, atualizadoEm: new Date() })
    .where(and(eq(imoveis.id, id), eq(imoveis.organizacaoId, organizacaoId)))
    .returning();
  return atualizado ?? null;
}

/** Opções para o filtro global do painel (só imóveis ativos). */
export async function opcoesDeFiltro(db: Db, organizacaoId: string) {
  const lista = await listarImoveis(db, organizacaoId);
  return lista.map((i) => ({ codigo: i.codigo, nome: i.nome }));
}
