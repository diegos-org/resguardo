import { and, asc, eq, gte, inArray, isNotNull, lt, sql, sum } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import {
  categoriasDespesa,
  ESTADOS_LANCAMENTO,
  type EstadoLancamento,
  imoveis,
  lancamentos,
  proprietarios,
  reservas,
  TIPOS_LANCAMENTO,
  type TipoLancamento,
} from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { hojeISO } from "@/lib/datas";
import { dataValida } from "@/reservas/regras";

export type Lancamento = typeof lancamentos.$inferSelect;

export type NovoLancamento = {
  tipo: TipoLancamento;
  descricao: string;
  valor: number;
  efeitoSaldo?: number;
  competencia: string;
  dataCaixa?: string | null;
  estado?: EstadoLancamento;
  imovelId?: string | null;
  proprietarioId?: string | null;
  reservaId?: string | null;
  origem?: string;
  chaveOrigem?: string;
  categoriaId?: string | null;
  fornecedor?: string;
  comprovante?: string;
  montante?: number | null;
  pagoPor?: string | null;
};

export class LancamentoInvalido extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "LancamentoInvalido";
  }
}

const inteiro = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v);

export function validarLancamento(n: NovoLancamento): string | null {
  if (!TIPOS_LANCAMENTO.includes(n.tipo)) return "Tipo de lançamento inválido.";
  if (!n.descricao?.trim()) return "Descrição obrigatória.";
  if (n.descricao.length > 300) return "Descrição com mais de 300 caracteres.";
  if (!inteiro(n.valor)) return "Valor deve ser inteiro em centavos.";
  if (n.efeitoSaldo !== undefined && !inteiro(n.efeitoSaldo)) return "Efeito no saldo deve ser inteiro em centavos.";
  if (!dataValida(n.competencia)) return "Competência inválida.";
  if (n.dataCaixa && !dataValida(n.dataCaixa)) return "Data de caixa inválida.";
  if (n.estado && !ESTADOS_LANCAMENTO.includes(n.estado)) return "Estado inválido.";
  for (const id of [n.imovelId, n.proprietarioId, n.reservaId, n.categoriaId]) if (id && !uuidValido(id)) return "Referência inválida.";
  if (n.montante != null && !inteiro(n.montante)) return "Montante deve ser inteiro em centavos.";
  if ((n.fornecedor?.length ?? 0) > 200 || (n.comprovante?.length ?? 0) > 500) return "Fornecedor ou comprovante longo demais.";
  if (n.efeitoSaldo && !n.proprietarioId) return "Lançamento que mexe no acerto precisa de proprietário.";
  return null;
}

/** Confere que imóvel/proprietário/reserva citados são da mesma organização. */
async function referenciasDaOrganizacao(tx: Db, org: string, n: NovoLancamento): Promise<boolean> {
  const checar = async (tabela: typeof imoveis | typeof proprietarios | typeof reservas | typeof categoriasDespesa, id: string | null | undefined) => {
    if (!id) return true;
    const [l] = await tx
      .select({ id: tabela.id })
      .from(tabela)
      .where(and(eq(tabela.id, id), eq(tabela.organizacaoId, org)));
    return Boolean(l);
  };
  return (await checar(imoveis, n.imovelId)) && (await checar(proprietarios, n.proprietarioId)) && (await checar(reservas, n.reservaId)) && (await checar(categoriasDespesa, n.categoriaId));
}

/**
 * Grava lançamentos (tudo ou nada). Com `chaveOrigem`, é idempotente: se já existir
 * lançamento com a mesma chave, devolve o existente sem gravar outro.
 */
export async function lancar(db: Db, organizacaoId: string, novos: NovoLancamento[], autorId: string | null): Promise<Lancamento[]> {
  for (const n of novos) {
    const erro = validarLancamento(n);
    if (erro) throw new LancamentoInvalido(erro);
  }
  return db.transaction(async (tx) => {
    const gravados: Lancamento[] = [];
    for (const n of novos) {
      if (!(await referenciasDaOrganizacao(tx, organizacaoId, n))) throw new LancamentoInvalido("Imóvel, proprietário ou reserva de outra organização.");
      const chave = n.chaveOrigem ?? "";
      if (chave) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`lancamento:${organizacaoId}:${chave}`}))`);
        const [existente] = await tx
          .select()
          .from(lancamentos)
          .where(and(eq(lancamentos.organizacaoId, organizacaoId), eq(lancamentos.chaveOrigem, chave)));
        if (existente) {
          gravados.push(existente);
          continue;
        }
      }
      const [l] = await tx
        .insert(lancamentos)
        .values({
          organizacaoId,
          tipo: n.tipo,
          descricao: n.descricao.trim(),
          valor: n.valor,
          efeitoSaldo: n.efeitoSaldo ?? 0,
          competencia: n.competencia,
          dataCaixa: n.dataCaixa ?? null,
          estado: n.estado ?? "previsto",
          imovelId: n.imovelId ?? null,
          proprietarioId: n.proprietarioId ?? null,
          reservaId: n.reservaId ?? null,
          origem: n.origem ?? "manual",
          chaveOrigem: chave,
          categoriaId: n.categoriaId ?? null,
          fornecedor: n.fornecedor?.trim() ?? "",
          comprovante: n.comprovante?.trim() ?? "",
          montante: n.montante ?? null,
          pagoPor: n.pagoPor ?? null,
          criadoPor: autorId,
        })
        .returning();
      await registrarAuditoria(tx, {
        organizacaoId,
        usuarioId: autorId,
        acao: "lancamento.criar",
        entidade: "lancamento",
        entidadeId: l.id,
        mudancas: { lancamento: [null, `${l.tipo} ${l.valor} (${l.descricao})`] },
      });
      gravados.push(l);
    }
    return gravados;
  });
}

/**
 * Estorna (anula) um lançamento criando o espelho com valores invertidos. Não se estorna um
 * estorno nem duas vezes. Se o original já movimentou caixa, o estorno registra a data de
 * caixa em que foi desfeito (padrão: hoje) para entrar no período certo da conciliação.
 */
export async function estornar(
  db: Db,
  organizacaoId: string,
  id: string,
  motivo: string,
  autorId: string | null,
  dataCaixa?: string,
): Promise<Lancamento> {
  if (!uuidValido(id)) throw new LancamentoInvalido("Lançamento não encontrado.");
  if (!motivo.trim()) throw new LancamentoInvalido("Informe o motivo do estorno.");
  if (dataCaixa && !dataValida(dataCaixa)) throw new LancamentoInvalido("Data de caixa inválida.");
  return db.transaction(async (tx) => {
    const [original] = await tx
      .select()
      .from(lancamentos)
      .where(and(eq(lancamentos.id, id), eq(lancamentos.organizacaoId, organizacaoId)))
      .for("update");
    if (!original) throw new LancamentoInvalido("Lançamento não encontrado.");
    if (original.estornoDe) throw new LancamentoInvalido("Não é possível estornar um estorno.");
    const [jaEstornado] = await tx.select({ id: lancamentos.id }).from(lancamentos).where(eq(lancamentos.estornoDe, id));
    if (jaEstornado) throw new LancamentoInvalido("Este lançamento já foi estornado.");

    const [espelho] = await tx
      .insert(lancamentos)
      .values({
        organizacaoId,
        tipo: original.tipo,
        descricao: `Estorno: ${motivo.trim()}`.slice(0, 300),
        valor: -original.valor,
        efeitoSaldo: -original.efeitoSaldo,
        competencia: original.competencia,
        estado: original.estado,
        dataCaixa: original.dataCaixa ? (dataCaixa ?? hojeISO()) : null,
        imovelId: original.imovelId,
        proprietarioId: original.proprietarioId,
        reservaId: original.reservaId,
        categoriaId: original.categoriaId,
        fornecedor: original.fornecedor,
        montante: original.montante === null ? null : -original.montante,
        pagoPor: original.pagoPor,
        origem: "estorno",
        estornoDe: original.id,
        criadoPor: autorId,
      })
      .returning();
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "lancamento.estornar",
      entidade: "lancamento",
      entidadeId: original.id,
      mudancas: { estorno: [null, motivo.trim()] },
    });
    return espelho;
  });
}

/** Única alteração permitida: o estado (e a data de caixa quando realizado). */
export async function mudarEstado(
  db: Db,
  organizacaoId: string,
  id: string,
  estado: EstadoLancamento,
  autorId: string | null,
  dataCaixa?: string,
): Promise<Lancamento | null> {
  if (!uuidValido(id) || !ESTADOS_LANCAMENTO.includes(estado)) return null;
  if (dataCaixa && !dataValida(dataCaixa)) throw new LancamentoInvalido("Data de caixa inválida.");
  return db.transaction(async (tx) => {
    const [antes] = await tx
      .select()
      .from(lancamentos)
      .where(and(eq(lancamentos.id, id), eq(lancamentos.organizacaoId, organizacaoId)))
      .for("update");
    if (!antes) return null;
    if (antes.estado === estado && (!dataCaixa || dataCaixa === antes.dataCaixa)) return antes;
    // Lançamento já estornado não muda mais de situação (ex.: não se dá baixa num valor anulado).
    const [estorno] = await tx.select({ id: lancamentos.id }).from(lancamentos).where(eq(lancamentos.estornoDe, id));
    if (estorno) throw new LancamentoInvalido("Este lançamento foi estornado e não pode mudar de situação.");
    const [depois] = await tx
      .update(lancamentos)
      .set({ estado, dataCaixa: dataCaixa ?? antes.dataCaixa })
      .where(eq(lancamentos.id, id))
      .returning();
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "lancamento.estado",
      entidade: "lancamento",
      entidadeId: id,
      mudancas: { estado: [antes.estado, estado], ...(dataCaixa ? { dataCaixa: [antes.dataCaixa, dataCaixa] } : {}) },
    });
    return depois;
  });
}

export type FiltroLancamentos = {
  inicio?: string;
  fim?: string;
  imovelIds?: string[];
  proprietarioId?: string;
  reservaId?: string;
};

function condicoes(organizacaoId: string, f: FiltroLancamentos) {
  const c = [eq(lancamentos.organizacaoId, organizacaoId)];
  if (f.inicio) c.push(gte(lancamentos.competencia, f.inicio));
  if (f.fim) c.push(lt(lancamentos.competencia, f.fim));
  if (f.imovelIds?.length) c.push(inArray(lancamentos.imovelId, f.imovelIds.filter(uuidValido)));
  if (f.proprietarioId) c.push(eq(lancamentos.proprietarioId, f.proprietarioId));
  if (f.reservaId) c.push(eq(lancamentos.reservaId, f.reservaId));
  return and(...c);
}

export async function listarLancamentos(db: Db, organizacaoId: string, f: FiltroLancamentos = {}): Promise<Lancamento[]> {
  if (f.proprietarioId && !uuidValido(f.proprietarioId)) return [];
  if (f.reservaId && !uuidValido(f.reservaId)) return [];
  return db
    .select()
    .from(lancamentos)
    .where(condicoes(organizacaoId, f))
    .orderBy(asc(lancamentos.competencia), asc(lancamentos.criadoEm));
}

/**
 * Saldo do acerto empresa ↔ proprietário (soma de efeitoSaldo, estornos incluídos).
 * Positivo: a empresa deve ao proprietário. Negativo: o proprietário deve à empresa.
 */
export async function saldoAcerto(db: Db, organizacaoId: string, f: FiltroLancamentos): Promise<number> {
  const [r] = await db
    .select({ total: sum(lancamentos.efeitoSaldo) })
    .from(lancamentos)
    .where(and(condicoes(organizacaoId, f), isNotNull(lancamentos.proprietarioId)));
  return Number(r?.total ?? 0);
}

/** Totais por tipo no período (estornos já se anulam na soma). */
export async function totaisPorTipo(db: Db, organizacaoId: string, f: FiltroLancamentos): Promise<Partial<Record<TipoLancamento, number>>> {
  const linhas = await db
    .select({ tipo: lancamentos.tipo, total: sum(lancamentos.valor) })
    .from(lancamentos)
    .where(condicoes(organizacaoId, f))
    .groupBy(lancamentos.tipo);
  return Object.fromEntries(linhas.map((l) => [l.tipo, Number(l.total ?? 0)]));
}

export type TotaisDoImovel = {
  /** Soma de `valor` por tipo (o que mexe no resultado da empresa). */
  valor: Partial<Record<TipoLancamento, number>>;
  /** Soma de `montante` por tipo (valor de referência, ex.: despesa do proprietário). */
  montante: Partial<Record<TipoLancamento, number>>;
  /** Movimento do acerto com o proprietário no período (soma de efeitoSaldo). */
  acerto: number;
};

/**
 * Totais do período agrupados por imóvel (chave `null` = lançamentos sem imóvel), com o mesmo
 * filtro de `totaisPorTipo`: somando todas as chaves, os números batem com os dele.
 */
export async function totaisPorImovel(db: Db, organizacaoId: string, f: FiltroLancamentos): Promise<Map<string | null, TotaisDoImovel>> {
  const linhas = await db
    .select({
      imovelId: lancamentos.imovelId,
      tipo: lancamentos.tipo,
      valor: sum(lancamentos.valor),
      montante: sum(lancamentos.montante),
      acerto: sql<string>`sum(case when ${lancamentos.proprietarioId} is not null then ${lancamentos.efeitoSaldo} else 0 end)`,
    })
    .from(lancamentos)
    .where(condicoes(organizacaoId, f))
    .groupBy(lancamentos.imovelId, lancamentos.tipo);
  const saida = new Map<string | null, TotaisDoImovel>();
  for (const l of linhas) {
    const t = saida.get(l.imovelId) ?? { valor: {}, montante: {}, acerto: 0 };
    t.valor[l.tipo] = Number(l.valor ?? 0);
    t.montante[l.tipo] = Number(l.montante ?? 0);
    t.acerto += Number(l.acerto ?? 0);
    saida.set(l.imovelId, t);
  }
  return saida;
}

/**
 * Acerto (soma de efeitoSaldo) por imóvel e proprietário, no filtro dado (ex.: só `fim` para o
 * saldo acumulado). Separado por proprietário: um imóvel que trocou de dono não mistura as contas.
 */
export async function acertoPorImovelEDono(
  db: Db,
  organizacaoId: string,
  f: FiltroLancamentos & { imovelIds: string[] },
): Promise<{ imovelId: string; proprietarioId: string; total: number }[]> {
  const ids = f.imovelIds.filter(uuidValido);
  if (!ids.length) return [];
  const linhas = await db
    .select({ imovelId: lancamentos.imovelId, proprietarioId: lancamentos.proprietarioId, total: sum(lancamentos.efeitoSaldo) })
    .from(lancamentos)
    .where(and(condicoes(organizacaoId, { ...f, imovelIds: ids }), isNotNull(lancamentos.proprietarioId)))
    .groupBy(lancamentos.imovelId, lancamentos.proprietarioId);
  return linhas.map((l) => ({ imovelId: l.imovelId!, proprietarioId: l.proprietarioId!, total: Number(l.total ?? 0) }));
}
