/**
 * Adiantamentos e compensações (M4.4). Um adiantamento nasce quando a empresa paga uma
 * despesa que é do proprietário (M4.3): ele passa a dever esse valor. Aqui ele é quitado —
 * por reembolso (o proprietário devolve), por compensação no repasse (M4.9) ou porque a
 * empresa decide assumir o custo — sempre sem dupla cobrança:
 * - a soma das quitações ativas nunca passa do valor do adiantamento (trava por adiantamento);
 * - com contestação aberta, nada é quitado nem compensado até resolver;
 * - despesa com quitação ativa não pode ser estornada (desfaça a quitação antes).
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { contestacoesAdiantamento, type FormaQuitacao, imoveis, lancamentos, proprietarios, quitacoesAdiantamento } from "@/db/schema";
import type { Db } from "@/db/types";
import { estornar, lancar, type Lancamento } from "@/financeiro/ledger";
import { uuidValido } from "@/lib/ids";
import { dataValida } from "@/reservas/regras";

export type SituacaoAdiantamento = "a_cobrar" | "parcial" | "quitado" | "contestado";
export const NOMES_SITUACAO: Record<SituacaoAdiantamento, string> = {
  a_cobrar: "A cobrar",
  parcial: "Parcialmente quitado",
  quitado: "Quitado",
  contestado: "Contestado",
};
export const NOMES_FORMA: Record<FormaQuitacao, string> = { reembolso: "Reembolso do proprietário", compensacao: "Descontado no repasse", empresa_assume: "Empresa assumiu" };

export type Quitacao = typeof quitacoesAdiantamento.$inferSelect;
export type Contestacao = typeof contestacoesAdiantamento.$inferSelect;

export type Adiantamento = {
  id: string;
  descricao: string;
  valor: number;
  data: string;
  dataPagamento: string | null;
  imovelId: string | null;
  imovel: string | null;
  proprietarioId: string;
  proprietario: string;
  fornecedor: string;
  despesaId: string | null;
  quitado: number;
  aberto: number;
  situacao: SituacaoAdiantamento;
  contestacao: Contestacao | null;
  quitacoes: Quitacao[];
};

/** Situação a partir dos números (pura). */
export function situacaoDe(valor: number, quitado: number, contestado: boolean): SituacaoAdiantamento {
  if (quitado >= valor) return "quitado";
  if (contestado) return "contestado";
  return quitado > 0 ? "parcial" : "a_cobrar";
}

const idDespesa = (chave: string) => chave.match(/^despesa:([0-9a-f-]{36}):pagamento$/)?.[1] ?? null;

/** Adiantamentos ativos (não estornados), com o que já foi quitado e o que está em aberto. */
export async function listarAdiantamentos(
  db: Db,
  organizacaoId: string,
  f: { proprietarioId?: string; imovelIds?: string[]; id?: string; somenteAbertos?: boolean } = {},
): Promise<Adiantamento[]> {
  const c = [
    eq(lancamentos.organizacaoId, organizacaoId),
    eq(lancamentos.tipo, "adiantamento"),
    isNull(lancamentos.estornoDe),
    sql`not exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`,
  ];
  if (f.id) c.push(eq(lancamentos.id, f.id));
  if (f.proprietarioId) c.push(eq(lancamentos.proprietarioId, f.proprietarioId));
  if (f.imovelIds) c.push(inArray(lancamentos.imovelId, f.imovelIds.filter(uuidValido)));
  const linhas = await db
    .select({ l: lancamentos, imovel: imoveis.codigo, proprietario: proprietarios.nome })
    .from(lancamentos)
    .leftJoin(imoveis, eq(imoveis.id, lancamentos.imovelId))
    .innerJoin(proprietarios, eq(proprietarios.id, lancamentos.proprietarioId))
    .where(and(...c))
    .orderBy(desc(lancamentos.competencia), desc(lancamentos.criadoEm));
  if (!linhas.length) return [];
  const ids = linhas.map((x) => x.l.id);
  const [quits, conts] = await Promise.all([
    db
      .select()
      .from(quitacoesAdiantamento)
      .where(and(eq(quitacoesAdiantamento.organizacaoId, organizacaoId), inArray(quitacoesAdiantamento.adiantamentoId, ids)))
      .orderBy(asc(quitacoesAdiantamento.criadoEm)),
    db
      .select()
      .from(contestacoesAdiantamento)
      .where(and(eq(contestacoesAdiantamento.organizacaoId, organizacaoId), inArray(contestacoesAdiantamento.adiantamentoId, ids)))
      .orderBy(desc(contestacoesAdiantamento.abertaEm)),
  ]);
  const saida = linhas.map(({ l, imovel, proprietario }) => {
    const qs = quits.filter((q) => q.adiantamentoId === l.id);
    const quitado = qs.filter((q) => !q.desfeitaEm).reduce((s, q) => s + q.valor, 0);
    const valor = l.montante ?? -l.efeitoSaldo;
    const aberta = conts.find((x) => x.adiantamentoId === l.id && !x.resolvidaEm) ?? null;
    return {
      id: l.id,
      descricao: l.descricao,
      valor,
      data: l.competencia,
      dataPagamento: l.dataCaixa,
      imovelId: l.imovelId,
      imovel,
      proprietarioId: l.proprietarioId!,
      proprietario,
      fornecedor: l.fornecedor,
      despesaId: idDespesa(l.chaveOrigem),
      quitado,
      aberto: Math.max(0, valor - quitado),
      situacao: situacaoDe(valor, quitado, Boolean(aberta)),
      contestacao: aberta ?? conts.find((x) => x.adiantamentoId === l.id) ?? null,
      quitacoes: qs,
    };
  });
  return f.somenteAbertos ? saida.filter((a) => a.aberto > 0) : saida;
}

export async function obterAdiantamento(db: Db, organizacaoId: string, id: string): Promise<Adiantamento | null> {
  if (!uuidValido(id)) return null;
  return (await listarAdiantamentos(db, organizacaoId, { id }))[0] ?? null;
}

/** Trava o adiantamento (linha do livro) até o fim da transação e devolve o estado atual. */
async function travar(tx: Db, organizacaoId: string, id: string): Promise<Adiantamento | null> {
  if (!uuidValido(id)) return null;
  const [l] = await tx
    .select({ id: lancamentos.id })
    .from(lancamentos)
    .where(and(eq(lancamentos.id, id), eq(lancamentos.organizacaoId, organizacaoId), eq(lancamentos.tipo, "adiantamento")))
    .for("update");
  if (!l) return null;
  return obterAdiantamento(tx, organizacaoId, id);
}

export type Resultado = { ok: true } | { ok: false; erro: string };

/**
 * Registra uma quitação. `reembolso` gera o lançamento de reembolso (o proprietário deixa de
 * dever); `empresa_assume` gera um ajuste (custo da empresa, dívida zerada); `compensacao`
 * só registra (o repasse do M4.9 já paga o saldo líquido).
 */
export async function quitar(
  db: Db,
  organizacaoId: string,
  adiantamentoId: string,
  q: { forma: FormaQuitacao; valor: number; data: string; nota?: string },
  autorId: string | null,
): Promise<Resultado> {
  if (!["reembolso", "compensacao", "empresa_assume"].includes(q.forma)) return { ok: false, erro: "Forma de quitação inválida." };
  if (!Number.isSafeInteger(q.valor) || q.valor <= 0) return { ok: false, erro: "Informe um valor maior que zero." };
  if (!dataValida(q.data)) return { ok: false, erro: "Data inválida." };
  const nota = (q.nota ?? "").trim().slice(0, 300);
  return db.transaction(async (tx) => {
    const a = await travar(tx, organizacaoId, adiantamentoId);
    if (!a) return { ok: false as const, erro: "Adiantamento não encontrado." };
    // Nenhuma quitação com contestação aberta (nem "empresa assume"): resolverContestacao fecha a
    // contestação antes de quitar, então o estado nunca fica contraditório.
    if (a.situacao === "contestado") {
      return { ok: false as const, erro: "O proprietário contestou este adiantamento: resolva a contestação antes de cobrar." };
    }
    if (q.valor > a.aberto) return { ok: false as const, erro: `Valor acima do que está em aberto (${(a.aberto / 100).toFixed(2).replace(".", ",")}).` };

    let lancamentoId: string | null = null;
    if (q.forma !== "compensacao") {
      const [l] = await lancar(
        tx,
        organizacaoId,
        [
          q.forma === "reembolso"
            ? {
                tipo: "reembolso",
                descricao: `Reembolso: ${a.descricao}`.slice(0, 300),
                valor: 0,
                montante: q.valor,
                efeitoSaldo: q.valor,
                competencia: q.data,
                dataCaixa: q.data,
                estado: "realizado",
                imovelId: a.imovelId,
                proprietarioId: a.proprietarioId,
                origem: "adiantamento",
              }
            : {
                tipo: "ajuste",
                descricao: `Empresa assumiu: ${a.descricao}${nota ? ` (${nota})` : ""}`.slice(0, 300),
                valor: -q.valor,
                montante: q.valor,
                efeitoSaldo: q.valor,
                competencia: q.data,
                estado: "realizado",
                imovelId: a.imovelId,
                proprietarioId: a.proprietarioId,
                origem: "adiantamento",
              },
        ],
        autorId,
      );
      lancamentoId = l.id;
    }
    const [nova] = await tx
      .insert(quitacoesAdiantamento)
      .values({ organizacaoId, adiantamentoId, forma: q.forma, valor: q.valor, data: q.data, lancamentoId, nota, criadoPor: autorId })
      .returning();
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "adiantamento.quitar",
      entidade: "adiantamento",
      entidadeId: adiantamentoId,
      mudancas: { [NOMES_FORMA[q.forma]]: [null, `${q.valor} em ${q.data}`], emAberto: [a.aberto, a.aberto - q.valor] },
    });
    return nova ? { ok: true as const } : { ok: false as const, erro: "Não foi possível registrar." };
  });
}

/** Desfaz uma quitação (estorna o lançamento que ela gerou). O adiantamento volta a ficar em aberto. */
export async function desfazerQuitacao(db: Db, organizacaoId: string, quitacaoId: string, motivo: string, autorId: string | null): Promise<Resultado> {
  if (!uuidValido(quitacaoId)) return { ok: false, erro: "Quitação não encontrada." };
  if (!motivo.trim()) return { ok: false, erro: "Informe o motivo." };
  return db.transaction(async (tx) => {
    const [q] = await tx
      .select()
      .from(quitacoesAdiantamento)
      .where(and(eq(quitacoesAdiantamento.id, quitacaoId), eq(quitacoesAdiantamento.organizacaoId, organizacaoId)));
    if (!q || q.desfeitaEm) return { ok: false as const, erro: "Quitação não encontrada." };
    await travar(tx, organizacaoId, q.adiantamentoId);
    // Relê com a trava: outra requisição pode ter desfeito ao mesmo tempo.
    const [atual] = await tx.select().from(quitacoesAdiantamento).where(eq(quitacoesAdiantamento.id, quitacaoId)).for("update");
    if (atual.desfeitaEm) return { ok: false as const, erro: "Quitação já desfeita." };
    if (q.lancamentoId) await estornar(tx, organizacaoId, q.lancamentoId, motivo.trim(), autorId);
    await tx.update(quitacoesAdiantamento).set({ desfeitaEm: new Date() }).where(eq(quitacoesAdiantamento.id, quitacaoId));
    // "Empresa assume" que veio da resolução de uma contestação: desfazer reabre a contestação
    // (senão o valor voltaria a ser cobrado com a tela dizendo que a empresa assumiu).
    let reaberta = false;
    if (q.forma === "empresa_assume") {
      const [c] = await tx
        .select({ id: contestacoesAdiantamento.id })
        .from(contestacoesAdiantamento)
        .where(and(eq(contestacoesAdiantamento.adiantamentoId, q.adiantamentoId), eq(contestacoesAdiantamento.resolucao, "empresa_assume")))
        .orderBy(desc(contestacoesAdiantamento.resolvidaEm))
        .limit(1);
      if (c) {
        await tx.update(contestacoesAdiantamento).set({ resolvidaEm: null, resolucao: null, notaResolucao: "" }).where(eq(contestacoesAdiantamento.id, c.id));
        reaberta = true;
      }
    }
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "adiantamento.desfazer_quitacao",
      entidade: "adiantamento",
      entidadeId: q.adiantamentoId,
      mudancas: {
        [NOMES_FORMA[q.forma as FormaQuitacao]]: [`${q.valor} em ${q.data}`, `desfeito: ${motivo.trim()}`],
        ...(reaberta ? { contestacao: ["empresa assumiu", "reaberta"] } : {}),
      },
    });
    return { ok: true as const };
  });
}

export async function contestar(db: Db, organizacaoId: string, adiantamentoId: string, motivo: string, autorId: string | null): Promise<Resultado> {
  const m = motivo.trim();
  if (!m || m.length > 500) return { ok: false, erro: "Descreva a contestação (até 500 caracteres)." };
  return db.transaction(async (tx) => {
    const a = await travar(tx, organizacaoId, adiantamentoId);
    if (!a) return { ok: false as const, erro: "Adiantamento não encontrado." };
    if (a.situacao === "contestado") return { ok: false as const, erro: "Já existe uma contestação aberta." };
    if (a.aberto === 0) return { ok: false as const, erro: "Adiantamento já quitado." };
    await tx.insert(contestacoesAdiantamento).values({ organizacaoId, adiantamentoId, motivo: m });
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "adiantamento.contestar", entidade: "adiantamento", entidadeId: adiantamentoId, mudancas: { contestacao: [null, m] } });
    return { ok: true as const };
  });
}

/**
 * Resolve a contestação aberta: `mantida` (volta a ser cobrado) ou `empresa_assume` (a
 * empresa absorve o que estava em aberto — quitação + ajuste, na mesma transação).
 */
export async function resolverContestacao(
  db: Db,
  organizacaoId: string,
  adiantamentoId: string,
  r: { resolucao: "mantida" | "empresa_assume"; nota: string; data: string },
  autorId: string | null,
): Promise<Resultado> {
  if (!["mantida", "empresa_assume"].includes(r.resolucao)) return { ok: false, erro: "Escolha como resolver." };
  if (!dataValida(r.data)) return { ok: false, erro: "Data inválida." };
  return db.transaction(async (tx) => {
    const a = await travar(tx, organizacaoId, adiantamentoId);
    if (!a || a.situacao !== "contestado" || !a.contestacao) return { ok: false as const, erro: "Não há contestação aberta." };
    await tx
      .update(contestacoesAdiantamento)
      .set({ resolvidaEm: new Date(), resolucao: r.resolucao, notaResolucao: r.nota.trim().slice(0, 500) })
      .where(eq(contestacoesAdiantamento.id, a.contestacao.id));
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "adiantamento.resolver_contestacao",
      entidade: "adiantamento",
      entidadeId: adiantamentoId,
      mudancas: { contestacao: ["aberta", r.resolucao === "mantida" ? "mantida (volta a cobrar)" : "empresa assumiu"] },
    });
    if (r.resolucao === "empresa_assume" && a.aberto > 0) {
      const q = await quitar(tx, organizacaoId, adiantamentoId, { forma: "empresa_assume", valor: a.aberto, data: r.data, nota: r.nota }, autorId);
      if (!q.ok) throw new Error(q.erro);
    }
    return { ok: true as const };
  });
}

/** Tem quitação ativa? (bloqueia estornar a despesa que gerou o adiantamento) */
export async function temQuitacaoAtiva(db: Db, organizacaoId: string, adiantamento: Pick<Lancamento, "id">): Promise<boolean> {
  const [q] = await db
    .select({ id: quitacoesAdiantamento.id })
    .from(quitacoesAdiantamento)
    .where(and(eq(quitacoesAdiantamento.organizacaoId, organizacaoId), eq(quitacoesAdiantamento.adiantamentoId, adiantamento.id), isNull(quitacoesAdiantamento.desfeitaEm)))
    .limit(1);
  return Boolean(q);
}

/** Resumo por proprietário: quanto deve de adiantamentos em aberto (sem contestados). */
export function resumoPorProprietario(lista: readonly Adiantamento[]) {
  const m = new Map<string, { proprietario: string; aCobrar: number; contestado: number; quantidade: number }>();
  for (const a of lista) {
    if (a.aberto === 0) continue;
    const r = m.get(a.proprietarioId) ?? { proprietario: a.proprietario, aCobrar: 0, contestado: 0, quantidade: 0 };
    if (a.situacao === "contestado") r.contestado += a.aberto;
    else r.aCobrar += a.aberto;
    r.quantidade++;
    m.set(a.proprietarioId, r);
  }
  return [...m.entries()].map(([proprietarioId, r]) => ({ proprietarioId, ...r })).sort((x, y) => x.proprietario.localeCompare(y.proprietario));
}

/** Total ainda a cobrar dos proprietários: saldo em aberto dos adiantamentos, sem os contestados. */
export function totalACobrar(lista: readonly Adiantamento[]): number {
  return lista.filter((a) => a.situacao === "a_cobrar" || a.situacao === "parcial").reduce((s, a) => s + a.aberto, 0);
}
