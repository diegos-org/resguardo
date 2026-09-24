/**
 * Manutenção (M6.2). Fluxo: pedida → orçada → aprovada (por Diego, que decide quem paga) →
 * realizada → custo lançado como despesa (M4.3, que cuida do livro e do adiantamento).
 *
 * Receber orçamento não autoriza executar: só uma manutenção aprovada pode ser registrada como
 * feita, e um orçamento novo depois da aprovação volta para "orçada" (precisa aprovar de novo).
 * Quem paga (empresa ou proprietário) é sempre escolha explícita na aprovação, nunca pelo valor.
 */
import { and, desc, eq, exists, gte, inArray, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { calcularMudancas, registrarAuditoria } from "@/auditoria/auditoria";
import type { ItemCalendario } from "@/calendario/grade";
import { type EstadoManutencao, imoveis, lancamentos, manutencoes, proprietarioImoveis } from "@/db/schema";
import type { Db } from "@/db/types";
import { registrarDespesa, type Responsavel, RESPONSAVEIS } from "@/despesas/despesas";
import { hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { formatBRL } from "@/lib/money";
import { dataValida } from "@/reservas/regras";

export type Manutencao = typeof manutencoes.$inferSelect;
export type Resultado = { ok: true; id?: string } | { ok: false; erro: string };

export const NOMES_ESTADO: Record<EstadoManutencao, string> = {
  pedida: "Pedida",
  orcada: "Orçada · aguardando aprovação",
  aprovada: "Aprovada",
  realizada: "Realizada",
  recusada: "Recusada",
  cancelada: "Cancelada",
};
export const ABERTAS: readonly EstadoManutencao[] = ["pedida", "orcada", "aprovada"];
/** Teto por orçamento/custo (R$ 1 milhão): acima disso é erro de digitação. */
export const VALOR_MAXIMO = 100_000_000;

const valorValido = (v: number) => Number.isSafeInteger(v) && v > 0 && v <= VALOR_MAXIMO;
const texto = (t: string, max: number) => t.trim().slice(0, max);

export async function criarManutencao(db: Db, organizacaoId: string, d: { imovelId: string; titulo: string; descricao: string }, autorId: string | null): Promise<Resultado> {
  if (!uuidValido(d.imovelId)) return { ok: false, erro: "Escolha o imóvel." };
  const titulo = d.titulo.trim();
  if (!titulo || titulo.length > 200) return { ok: false, erro: "Diga o que precisa ser feito (até 200 caracteres)." };
  if (d.descricao.length > 1000) return { ok: false, erro: "Descrição longa demais (até 1000 caracteres)." };
  // Pedido e histórico juntos: ou os dois ficam, ou nenhum.
  return db.transaction(async (tx) => {
    const [im] = await tx
      .select({ id: imoveis.id })
      .from(imoveis)
      .where(and(eq(imoveis.id, d.imovelId), eq(imoveis.organizacaoId, organizacaoId)));
    if (!im) return { ok: false as const, erro: "Imóvel não encontrado." };
    const [m] = await tx
      .insert(manutencoes)
      .values({ organizacaoId, imovelId: d.imovelId, titulo, descricao: d.descricao.trim(), criadoPor: autorId })
      .returning();
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "manutencao.criar", entidade: "manutencao", entidadeId: m.id, mudancas: { titulo: [null, titulo] } });
    return { ok: true as const, id: m.id };
  });
}

async function travar(tx: Db, organizacaoId: string, id: string): Promise<Manutencao | null> {
  if (!uuidValido(id)) return null;
  const [m] = await tx
    .select()
    .from(manutencoes)
    .where(and(eq(manutencoes.id, id), eq(manutencoes.organizacaoId, organizacaoId)))
    .for("update");
  return m ?? null;
}

/** Muda o estado com trava e histórico. `de` lista os estados de onde a mudança é permitida. */
function transicao(
  db: Db,
  organizacaoId: string,
  id: string,
  de: readonly EstadoManutencao[],
  mudar: (m: Manutencao, tx: Db) => Promise<Partial<Manutencao> | string>,
  acao: string,
  autorId: string | null,
): Promise<Resultado> {
  return db.transaction(async (tx) => {
    const m = await travar(tx, organizacaoId, id);
    if (!m) return { ok: false as const, erro: "Manutenção não encontrada." };
    if (!de.includes(m.estado)) return { ok: false as const, erro: `Não dá a partir de "${NOMES_ESTADO[m.estado]}".` };
    const novo = await mudar(m, tx);
    if (typeof novo === "string") return { ok: false as const, erro: novo };
    const [depois] = await tx
      .update(manutencoes)
      .set({ ...novo, atualizadoEm: new Date() })
      .where(eq(manutencoes.id, id))
      .returning();
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao, entidade: "manutencao", entidadeId: id, mudancas: calcularMudancas(m, depois) });
    return { ok: true as const, id };
  });
}

/** Registra (ou troca) o orçamento. Depois de aprovada, um orçamento novo exige aprovar de novo. */
export function registrarOrcamento(db: Db, organizacaoId: string, id: string, d: { fornecedor: string; valor: number }, autorId: string | null): Promise<Resultado> {
  if (!d.fornecedor.trim() || d.fornecedor.length > 200) return Promise.resolve({ ok: false, erro: "Diga quem vai fazer (até 200 caracteres)." });
  if (!valorValido(d.valor)) return Promise.resolve({ ok: false, erro: "Valor do orçamento inválido." });
  return transicao(
    db,
    organizacaoId,
    id,
    ["pedida", "orcada", "aprovada"],
    async () => ({ estado: "orcada", fornecedor: texto(d.fornecedor, 200), orcamento: d.valor, responsavel: null, proprietarioId: null, aprovadaPor: null, aprovadaEm: null }),
    "manutencao.orcamento",
    autorId,
  );
}

async function donoAtual(tx: Db, imovelId: string): Promise<string | null> {
  const [d] = await tx.select({ id: proprietarioImoveis.proprietarioId }).from(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, imovelId));
  return d?.id ?? null;
}

/** Aprovação de Diego: libera a execução e define quem paga. Só a partir de um orçamento. */
export function aprovarManutencao(db: Db, organizacaoId: string, id: string, responsavel: string, autorId: string | null): Promise<Resultado> {
  if (!RESPONSAVEIS.includes(responsavel as Responsavel)) return Promise.resolve({ ok: false, erro: "Escolha quem paga: empresa ou proprietário." });
  return transicao(
    db,
    organizacaoId,
    id,
    ["orcada"],
    async (m, tx) => {
      if (m.orcamento === null) return "Registre o orçamento antes de aprovar.";
      // Quem paga fica gravado na aprovação: se o imóvel mudar de dono depois, não passa para o novo.
      const dono = responsavel === "proprietario" ? await donoAtual(tx, m.imovelId) : null;
      if (responsavel === "proprietario" && !dono) return "O imóvel não tem proprietário vinculado: vincule antes de cobrar dele.";
      return { estado: "aprovada", responsavel: responsavel as Responsavel, proprietarioId: dono, aprovadaPor: autorId, aprovadaEm: new Date() };
    },
    "manutencao.aprovar",
    autorId,
  );
}

function comMotivo(prefixo: string, motivo: string, m: Manutencao) {
  return texto(`${m.observacao ? `${m.observacao} · ` : ""}${prefixo}: ${motivo.trim()}`, 1000);
}

export function recusarManutencao(db: Db, organizacaoId: string, id: string, motivo: string, autorId: string | null): Promise<Resultado> {
  if (!motivo.trim()) return Promise.resolve({ ok: false, erro: "Informe o motivo." });
  return transicao(db, organizacaoId, id, ["pedida", "orcada"], async (m) => ({ estado: "recusada", observacao: comMotivo("Recusada", motivo, m) }), "manutencao.recusar", autorId);
}

export function cancelarManutencao(db: Db, organizacaoId: string, id: string, motivo: string, autorId: string | null): Promise<Resultado> {
  if (!motivo.trim()) return Promise.resolve({ ok: false, erro: "Informe o motivo." });
  return transicao(db, organizacaoId, id, ABERTAS, async (m) => ({ estado: "cancelada", observacao: comMotivo("Cancelada", motivo, m) }), "manutencao.cancelar", autorId);
}

/** Registra que o serviço foi feito: só aprovada, e a data vai do dia da aprovação até hoje. */
export function realizarManutencao(db: Db, organizacaoId: string, id: string, data: string, hoje: string, autorId: string | null): Promise<Resultado> {
  if (!dataValida(data)) return Promise.resolve({ ok: false, erro: "Data inválida." });
  if (data > hoje) return Promise.resolve({ ok: false, erro: "A data do serviço não pode ser no futuro." });
  return transicao(
    db,
    organizacaoId,
    id,
    ["aprovada"],
    async (m) => {
      const aprovadaEm = m.aprovadaEm ? hojeISO(undefined, m.aprovadaEm) : null;
      if (!aprovadaEm) return "Manutenção sem aprovação registrada.";
      if (data < aprovadaEm) return `A data do serviço não pode ser antes da aprovação (${aprovadaEm.split("-").reverse().join("/")}).`;
      return { estado: "realizada", dataRealizada: data };
    },
    "manutencao.realizar",
    autorId,
  );
}

/** A despesa ligada já foi estornada (no livro)? */
async function despesaAtiva(tx: Db, despesaId: string | null): Promise<boolean> {
  if (!despesaId) return false;
  const [e] = await tx.select({ id: lancamentos.id }).from(lancamentos).where(eq(lancamentos.estornoDe, despesaId));
  return !e;
}

export type DadosCusto = { categoriaId: string; valor: number; paga: boolean; dataPagamento: string | null; pagoPor: Responsavel; comprovante: string };

/**
 * Lança o custo final como despesa (M4.3), com o imóvel, o fornecedor e quem paga definidos na
 * aprovação. Uma despesa ativa por manutenção; se ela for estornada em Despesas, dá para lançar de novo.
 */
export function lancarCusto(db: Db, organizacaoId: string, id: string, d: DadosCusto, autorId: string | null): Promise<Resultado> {
  if (!valorValido(d.valor)) return Promise.resolve({ ok: false, erro: "Custo inválido." });
  return transicao(
    db,
    organizacaoId,
    id,
    ["realizada"],
    async (m, tx) => {
      if (await despesaAtiva(tx, m.despesaId)) return "O custo já foi lançado. Para corrigir, estorne a despesa em Despesas e lance de novo.";
      if (!m.responsavel || !m.dataRealizada) return "Manutenção sem aprovação registrada: não dá para lançar o custo.";
      if (m.responsavel === "proprietario" && (!m.proprietarioId || (await donoAtual(tx, m.imovelId)) !== m.proprietarioId))
        return "O imóvel mudou de proprietário depois da aprovação: o custo não é lançado para o dono novo. Fale com o Diego para decidir como cobrar (ex.: ajuste com o dono da época).";
      const r = await registrarDespesa(
        tx,
        organizacaoId,
        {
          responsavel: m.responsavel,
          pagoPor: m.responsavel === "empresa" ? "empresa" : d.pagoPor,
          categoriaId: d.categoriaId,
          descricao: texto(`Manutenção: ${m.titulo}`, 300),
          valor: d.valor,
          data: m.dataRealizada,
          imovelId: m.imovelId,
          proprietarioId: m.responsavel === "proprietario" ? m.proprietarioId : null,
          fornecedor: m.fornecedor,
          comprovante: d.comprovante,
          paga: d.paga,
          dataPagamento: d.paga ? d.dataPagamento : null,
        },
        autorId,
      );
      if (!r.ok) return Object.values(r.erros)[0] ?? "Não foi possível lançar a despesa.";
      return { despesaId: r.lancamento.id };
    },
    "manutencao.custo",
    autorId,
  );
}

const diaSeguinte = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Manutenções feitas no período, para o calendário central (um dia: o do serviço). */
export async function itensDoCalendario(db: Db, organizacaoId: string, f: { inicio: string; fim: string; imovelIds: string[] }): Promise<ItemCalendario[]> {
  const ids = f.imovelIds.filter(uuidValido);
  if (!ids.length) return [];
  const linhas = await db
    .select({ id: manutencoes.id, imovelId: manutencoes.imovelId, titulo: manutencoes.titulo, data: manutencoes.dataRealizada })
    .from(manutencoes)
    .where(
      and(
        eq(manutencoes.organizacaoId, organizacaoId),
        eq(manutencoes.estado, "realizada"),
        inArray(manutencoes.imovelId, ids),
        gte(manutencoes.dataRealizada, f.inicio),
        lt(manutencoes.dataRealizada, f.fim),
      ),
    );
  return linhas.map((m) => ({
    id: m.id,
    imovelId: m.imovelId,
    inicio: m.data!,
    fim: diaSeguinte(m.data!),
    tipo: "manutencao" as const,
    rotulo: `Manutenção · ${m.titulo}`,
    href: "/painel/manutencao?estado=todas",
    categoria: "manutencao",
  }));
}

export type LinhaManutencao = Manutencao & {
  imovelCodigo: string;
  /** Custo lançado (despesa ativa); null = não lançado ou estornado. */
  custo: number | null;
  despesaEstornada: boolean;
  avisos: string[];
};

/**
 * Manutenções (as que pedem ação primeiro), com avisos para conferência. `emAberto`: as que
 * ainda pedem ação, inclusive a realizada sem custo lançado (ou com a despesa estornada).
 */
export async function listarManutencoes(db: Db, organizacaoId: string, f: { imovelIds?: string[]; emAberto?: boolean } = {}): Promise<LinhaManutencao[]> {
  const c = [eq(manutencoes.organizacaoId, organizacaoId)];
  if (f.imovelIds) {
    const ids = f.imovelIds.filter(uuidValido);
    if (!ids.length) return [];
    c.push(inArray(manutencoes.imovelId, ids));
  }
  if (f.emAberto) c.push(inArray(manutencoes.estado, [...ABERTAS, "realizada"]));
  const estorno = alias(lancamentos, "estorno");
  const linhas = await db
    .select({
      m: manutencoes,
      imovelCodigo: imoveis.codigo,
      donoAtual: proprietarioImoveis.proprietarioId,
      despesaValor: lancamentos.montante,
      estornada: exists(db.select({ id: estorno.id }).from(estorno).where(eq(estorno.estornoDe, manutencoes.despesaId))),
    })
    .from(manutencoes)
    .innerJoin(imoveis, eq(imoveis.id, manutencoes.imovelId))
    .leftJoin(proprietarioImoveis, eq(proprietarioImoveis.imovelId, manutencoes.imovelId))
    .leftJoin(lancamentos, eq(lancamentos.id, manutencoes.despesaId))
    .where(and(...c))
    .orderBy(desc(manutencoes.criadoEm));
  const ordem = (e: EstadoManutencao) => ["orcada", "pedida", "aprovada", "realizada", "recusada", "cancelada"].indexOf(e);
  return linhas
    .map((x) => {
      const m = x.m;
      const estornada = Boolean(m.despesaId && x.estornada);
      const custo = m.despesaId && !estornada ? (x.despesaValor ?? null) : null;
      const avisos: string[] = [];
      if ((m.estado === "aprovada" || (m.estado === "realizada" && custo === null)) && m.responsavel === "proprietario" && m.proprietarioId !== x.donoAtual)
        avisos.push("O imóvel mudou de proprietário depois da aprovação: o custo não vai para o dono novo. Decida com o Diego como cobrar.");
      if (m.estado === "orcada") avisos.push("Orçamento aguardando aprovação do Diego: não execute antes.");
      if (m.estado === "realizada" && estornada) avisos.push("A despesa desta manutenção foi estornada: lance o custo de novo, se for o caso.");
      else if (m.estado === "realizada" && custo === null) avisos.push("Custo ainda não lançado.");
      if (custo !== null && m.orcamento !== null && custo > m.orcamento) avisos.push(`Custo acima do orçamento aprovado (${formatBRL(m.orcamento)}): confira.`);
      return { ...m, imovelCodigo: x.imovelCodigo, custo, despesaEstornada: estornada, avisos };
    })
    .filter((m) => !f.emAberto || m.estado !== "realizada" || m.custo === null)
    .sort((a, b) => ordem(a.estado) - ordem(b.estado));
}
