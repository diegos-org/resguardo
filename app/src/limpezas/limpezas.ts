/**
 * Limpezas (M6.1). Toda reserva confirmada gera uma limpeza "pedida" no dia do checkout
 * (mesmo sem nova entrada, inclusive fim de semana). Confirmar (com a profissional) e realizar
 * são registros separados: agendar não comprova execução, e nada é marcado por suposição.
 *
 * `sincronizarLimpezas` é idempotente: cria as que faltam, acompanha mudança de data/imóvel e
 * cancela as de reserva cancelada — só enquanto a limpeza não foi realizada. Depois de
 * realizada, uma mudança na reserva vira aviso para conferência.
 */
import { and, asc, eq, exists, gte, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { calcularMudancas, registrarAuditoria } from "@/auditoria/auditoria";
import type { ItemCalendario } from "@/calendario/grade";
import { categoriasDespesa, type EstadoLimpeza, imoveis, lancamentos, limpezas, profissionaisLimpeza, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { listarContratos } from "@/contratos/repositorio";
import { contratoVigente } from "@/contratos/regras";
import { lerConfig, gravarConfig } from "@/configuracoes/armazem";
import { CATEGORIAS_INICIAIS, garantirCategoriasIniciais } from "@/despesas/categorias";
import { estornarDespesa, obterDespesa, registrarDespesa } from "@/despesas/despesas";
import { uuidValido } from "@/lib/ids";
import { dataValida } from "@/reservas/regras";

export type Limpeza = typeof limpezas.$inferSelect;
export type Profissional = typeof profissionaisLimpeza.$inferSelect;
export type Resultado = { ok: true } | { ok: false; erro: string };

export const NOMES_ESTADO: Record<EstadoLimpeza, string> = { pedida: "Pedida", confirmada: "Confirmada", realizada: "Realizada", cancelada: "Cancelada" };
/** Teto de custo por limpeza (R$ 100 mil): valor acima disso é erro de digitação. */
export const CUSTO_MAXIMO = 10_000_000;

type Periodo = { inicio: string; fim: string };

/** Cria/atualiza as limpezas das reservas com saída no período (ver o topo do arquivo). */
export async function sincronizarLimpezas(db: Db, organizacaoId: string, periodo: Periodo, autorId: string | null = null): Promise<{ criadas: number; atualizadas: number; canceladas: number }> {
  const r = { criadas: 0, atualizadas: 0, canceladas: 0 };
  if (!dataValida(periodo.inicio) || !dataValida(periodo.fim)) return r;
  // Reservas com saída no período, mais as que já têm limpeza no período (a saída pode ter mudado).
  const comLimpeza = db
    .select({ id: limpezas.reservaId })
    .from(limpezas)
    .where(and(eq(limpezas.organizacaoId, organizacaoId), gte(limpezas.data, periodo.inicio), lt(limpezas.data, periodo.fim), isNotNull(limpezas.reservaId)));
  const lista = await db
    .select({ id: reservas.id })
    .from(reservas)
    .where(
      and(
        eq(reservas.organizacaoId, organizacaoId),
        or(and(gte(reservas.checkout, periodo.inicio), lt(reservas.checkout, periodo.fim)), inArray(reservas.id, comLimpeza)),
      ),
    );
  if (!lista.length) return r;

  for (const { id } of lista) {
    // Cada mudança e seu histórico na mesma transação: ou os dois ficam, ou nenhum. A reserva e
    // a limpeza são relidas e travadas aqui dentro (reserva primeiro): uma importação ou uma
    // mudança de estado feita enquanto a sincronização roda não é sobrescrita com dado velho.
    await db.transaction(async (tx) => {
      const [res] = await tx
        .select({ id: reservas.id, imovelId: reservas.imovelId, checkout: reservas.checkout, estado: reservas.estado, codigo: reservas.codigo })
        .from(reservas)
        .where(eq(reservas.id, id))
        .for("update");
      if (!res) return;
      const [l] = await tx.select().from(limpezas).where(eq(limpezas.reservaId, id)).for("update");
      const aberta = l && (l.estado === "pedida" || l.estado === "confirmada");
      if (res.estado === "confirmada") {
        if (!l) {
          const [nova] = await tx
            .insert(limpezas)
            .values({ organizacaoId, imovelId: res.imovelId, reservaId: res.id, data: res.checkout })
            .onConflictDoNothing()
            .returning();
          if (nova) {
            r.criadas++;
            await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "limpeza.criar", entidade: "limpeza", entidadeId: nova.id, mudancas: { limpeza: [null, `saída da reserva ${res.codigo} em ${res.checkout}`] } });
          }
        } else if ((l.estado === "cancelada" && !l.canceladaManual) || (aberta && (l.data !== res.checkout || l.imovelId !== res.imovelId))) {
          // Reserva reativada ou com saída/imóvel mudados: volta a "pedida" (a confirmação era para outra data).
          // Cancelada à mão fica cancelada: só a cancelada pela reserva volta.
          const novo = { data: res.checkout, imovelId: res.imovelId, estado: "pedida" as const, confirmadaEm: null };
          const [depois] = await tx
            .update(limpezas)
            .set({ ...novo, atualizadoEm: new Date() })
            .where(and(eq(limpezas.id, l.id), inArray(limpezas.estado, ["pedida", "confirmada", "cancelada"]), eq(limpezas.canceladaManual, false)))
            .returning();
          if (depois) {
            r.atualizadas++;
            await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "limpeza.reserva_mudou", entidade: "limpeza", entidadeId: l.id, mudancas: calcularMudancas(l, depois) });
          }
        } else if (l.estado === "cancelada" && l.canceladaManual && (l.data !== res.checkout || l.imovelId !== res.imovelId)) {
          // Cancelada à mão continua cancelada, mas acompanha a nova saída/imóvel da reserva
          // (senão some do período da reserva e o aviso de conferência não aparece lá).
          const [depois] = await tx
            .update(limpezas)
            .set({ data: res.checkout, imovelId: res.imovelId, atualizadoEm: new Date() })
            .where(and(eq(limpezas.id, l.id), eq(limpezas.estado, "cancelada")))
            .returning();
          if (depois) {
            r.atualizadas++;
            await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "limpeza.reserva_mudou", entidade: "limpeza", entidadeId: l.id, mudancas: calcularMudancas(l, depois) });
          }
        }
      } else if (aberta) {
        // Reserva cancelada ou de volta a pendente: a limpeza aberta sai (e volta se ela confirmar de novo).
        const [depois] = await tx
          .update(limpezas)
          .set({ estado: "cancelada", atualizadoEm: new Date() })
          .where(and(eq(limpezas.id, l!.id), inArray(limpezas.estado, ["pedida", "confirmada"])))
          .returning();
        if (depois) {
          r.canceladas++;
          await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "limpeza.cancelar", entidade: "limpeza", entidadeId: l!.id, mudancas: { estado: [l!.estado, `cancelada (reserva ${res.estado})`] } });
        }
      }
    });
  }
  return r;
}

export type LinhaLimpeza = Limpeza & {
  /** Só está na lista porque a reserva mudou para este período/imóvel (a limpeza é de outro): fora dos totais. */
  movida: boolean;
  imovelCodigo: string;
  reservaCodigo: string | null;
  profissional: string | null;
  avisos: string[];
};

const dataBr = (d: string) => d.split("-").reverse().join("/");

/** Limpezas do período (por data), com avisos para conferência — nunca preenchidos por suposição. */
export async function listarLimpezas(db: Db, organizacaoId: string, f: Periodo & { imovelIds?: string[]; hoje: string }): Promise<LinhaLimpeza[]> {
  // Realizada cuja reserva mudou de mês/imóvel aparece também no período/imóvel novo da reserva,
  // com o aviso (a limpeza em si continua na data e no imóvel em que foi feita).
  // Duas alternativas completas (data e imóvel sempre do mesmo par): a limpeza em si, ou a
  // realizada pela saída/imóvel atuais da reserva.
  const ids = f.imovelIds?.filter(uuidValido);
  if (ids && !ids.length) return [];
  const daLimpeza = and(gte(limpezas.data, f.inicio), lt(limpezas.data, f.fim), ids ? inArray(limpezas.imovelId, ids) : undefined);
  const realizadaMovida = and(eq(limpezas.estado, "realizada"), gte(reservas.checkout, f.inicio), lt(reservas.checkout, f.fim), ids ? inArray(reservas.imovelId, ids) : undefined);
  const c = [eq(limpezas.organizacaoId, organizacaoId), or(daLimpeza, realizadaMovida)];
  const linhas = await db
    .select({
      l: limpezas,
      imovelCodigo: imoveis.codigo,
      reservaCodigo: reservas.codigo,
      reservaEstado: reservas.estado,
      reservaCheckout: reservas.checkout,
      reservaImovelId: reservas.imovelId,
      profissional: profissionaisLimpeza.nome,
      despesaEstornada: exists(db.select({ um: sql`1` }).from(lancamentos).where(eq(lancamentos.estornoDe, limpezas.despesaId))),
    })
    .from(limpezas)
    .innerJoin(imoveis, eq(imoveis.id, limpezas.imovelId))
    .leftJoin(reservas, eq(reservas.id, limpezas.reservaId))
    .leftJoin(profissionaisLimpeza, eq(profissionaisLimpeza.id, limpezas.profissionalId))
    .where(and(...c))
    .orderBy(asc(limpezas.data), asc(imoveis.codigo));
  return linhas.map((x) => {
    const avisos: string[] = [];
    const l = x.l;
    if (l.estado === "realizada" && x.reservaEstado === "cancelada") avisos.push("A reserva foi cancelada depois da limpeza realizada: confira.");
    if (l.estado === "realizada" && x.reservaEstado === "pendente") avisos.push("A reserva voltou a pendente depois da limpeza realizada: confira.");
    if (l.estado === "realizada" && x.reservaCheckout && x.reservaCheckout !== l.data) avisos.push(`A saída da reserva mudou para ${dataBr(x.reservaCheckout)} depois da limpeza: confira.`);
    if (l.estado === "realizada" && x.reservaImovelId && x.reservaImovelId !== l.imovelId) avisos.push("A reserva mudou de imóvel depois da limpeza realizada: confira.");
    if (l.estado === "cancelada" && l.canceladaManual && x.reservaEstado === "confirmada" && x.reservaCheckout && x.reservaCheckout >= f.hoje)
      avisos.push("Cancelada à mão, mas a reserva continua confirmada: confira se a saída não precisa de limpeza.");
    if ((l.estado === "pedida" || l.estado === "confirmada") && l.data < f.hoje) avisos.push("A data já passou e a limpeza não foi registrada como realizada.");
    if (l.estado === "realizada" && l.custo === null) avisos.push("Custo não informado.");
    if (l.estado === "realizada" && l.custo !== null && l.custo > 0 && !l.despesaId)
      avisos.push("Custo não lançado no livro: o imóvel não estava em gestão completa nessa data. Lance em Despesas indicando quem paga.");
    if (l.estado === "realizada" && l.despesaId && x.despesaEstornada) avisos.push("A despesa desta limpeza foi estornada em Despesas: informe o custo de novo para lançar.");
    const movida = l.data < f.inicio || l.data >= f.fim || Boolean(f.imovelIds && !f.imovelIds.includes(l.imovelId));
    return { ...l, movida, imovelCodigo: x.imovelCodigo, reservaCodigo: x.reservaCodigo, profissional: x.profissional, avisos };
  });
}

const diaSeguinte = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Limpezas no calendário central: um dia (o da limpeza); as canceladas não aparecem. */
export function itensDoCalendario(lista: readonly LinhaLimpeza[]): ItemCalendario[] {
  return lista
    .filter((l) => l.estado !== "cancelada")
    .map((l) => ({
      id: l.id,
      imovelId: l.imovelId,
      inicio: l.data,
      fim: diaSeguinte(l.data),
      tipo: "limpeza" as const,
      rotulo: `Limpeza · ${NOMES_ESTADO[l.estado].toLowerCase()}${l.profissional ? ` · ${l.profissional}` : ""}`,
      href: `/painel/limpezas?ano=${l.data.slice(0, 4)}&mes=${Number(l.data.slice(5, 7))}`,
      categoria: "limpeza",
      conflito: l.avisos.length > 0,
    }));
}

async function travar(tx: Db, organizacaoId: string, id: string): Promise<Limpeza | null> {
  if (!uuidValido(id)) return null;
  const [l] = await tx
    .select()
    .from(limpezas)
    .where(and(eq(limpezas.id, id), eq(limpezas.organizacaoId, organizacaoId)))
    .for("update");
  return l ?? null;
}

async function profissionalAtivo(tx: Db, organizacaoId: string, id: string): Promise<boolean> {
  if (!uuidValido(id)) return false;
  const [p] = await tx
    .select({ id: profissionaisLimpeza.id })
    .from(profissionaisLimpeza)
    .where(and(eq(profissionaisLimpeza.id, id), eq(profissionaisLimpeza.organizacaoId, organizacaoId), eq(profissionaisLimpeza.ativo, true)));
  return Boolean(p);
}

export type CategoriaLimpezas = { id: string; nome: string; ativa: boolean };

/** Categoria guardada pelo id (config "limpezas"). */
async function categoriaGuardada(db: Db, organizacaoId: string): Promise<CategoriaLimpezas | null> {
  const id = (await lerConfig(db, organizacaoId, "limpezas"))?.categoriaDespesaId;
  if (typeof id !== "string" || !uuidValido(id)) return null;
  const [c] = await db
    .select({ id: categoriasDespesa.id, nome: categoriasDespesa.nome, ativa: categoriasDespesa.ativa })
    .from(categoriasDespesa)
    .where(and(eq(categoriasDespesa.id, id), eq(categoriasDespesa.organizacaoId, organizacaoId)));
  return c ?? null;
}

/**
 * Categoria de despesa das limpezas, guardada pelo id: renomear a categoria em Despesas não muda
 * nada. Na primeira vez, fica a categoria inicial “Limpeza e lavanderia” (se existir, ativa, com
 * esse nome); fora isso, não se supõe: devolve null e a tela pede para escolher.
 */
export async function categoriaDasLimpezas(db: Db, organizacaoId: string, autorId: string | null = null): Promise<CategoriaLimpezas | null> {
  const guardada = await categoriaGuardada(db, organizacaoId);
  if (guardada) return guardada;
  await garantirCategoriasIniciais(db, organizacaoId);
  const inicial = CATEGORIAS_INICIAIS.find((n) => /limpeza/i.test(n)) ?? "";
  const [c] = await db
    .select({ id: categoriasDespesa.id, nome: categoriasDespesa.nome, ativa: categoriasDespesa.ativa })
    .from(categoriasDespesa)
    .where(and(eq(categoriasDespesa.organizacaoId, organizacaoId), eq(categoriasDespesa.ativa, true), sql`lower(${categoriasDespesa.nome}) = lower(${inicial})`));
  if (!c) return null;
  await gravarConfig(db, organizacaoId, "limpezas", { categoriaDespesaId: c.id }, autorId);
  return c;
}

/** Troca a categoria de despesa das limpezas (vale para as próximas despesas; as lançadas ficam). */
export async function escolherCategoriaDasLimpezas(db: Db, organizacaoId: string, categoriaId: string, autorId: string | null): Promise<Resultado> {
  if (!uuidValido(categoriaId)) return { ok: false, erro: "Escolha uma categoria." };
  const [c] = await db
    .select({ id: categoriasDespesa.id })
    .from(categoriasDespesa)
    .where(and(eq(categoriasDespesa.id, categoriaId), eq(categoriasDespesa.organizacaoId, organizacaoId), eq(categoriasDespesa.ativa, true)));
  if (!c) return { ok: false, erro: "Categoria não encontrada ou arquivada." };
  await db.transaction((tx) => gravarConfig(tx, organizacaoId, "limpezas", { categoriaDespesaId: c.id }, autorId));
  return { ok: true };
}

/** Muda o estado com trava e histórico. `de` lista os estados de onde a mudança é permitida. */
/**
 * Deixa a despesa da limpeza de acordo com o custo: realizada com custo, em imóvel de gestão
 * completa → uma despesa da empresa (categoria de limpeza, a pagar) com esse valor; sem custo,
 * reaberta ou outro contrato → nenhuma. Troca de valor
 * estorna a anterior e lança outra. Despesa já paga não é mexida automaticamente: vira aviso
 * para corrigir em Despesas. Devolve o id da despesa em vigor (ou null), ou o erro.
 */
async function acertarDespesa(tx: Db, organizacaoId: string, l: Limpeza, autorId: string | null): Promise<{ id: string | null } | { erro: string }> {
  const desejado = l.estado === "realizada" && l.custo !== null && l.custo > 0 ? l.custo : null;
  // Trava a despesa antes de olhar se está paga: um "marcar como paga" ao mesmo tempo termina
  // antes (e aparece aqui como paga) ou espera esta transação.
  if (l.despesaId) await tx.select({ id: lancamentos.id }).from(lancamentos).where(eq(lancamentos.id, l.despesaId)).for("update");
  const atual = l.despesaId ? await obterDespesa(tx, organizacaoId, l.despesaId) : null;
  const vigente = atual && !atual.estornada ? atual : null;
  // Só na gestão completa a limpeza é custo interno da empresa (DECISOES-OPERACIONAIS): em
  // contrato online, marketplace ou sem contrato na data, não se supõe quem paga — fica o aviso
  // na lista para lançar em Despesas. O contrato é conferido sempre (ele pode ter sido corrigido
  // depois), e tudo antes de estornar a despesa anterior.
  const contrato = desejado === null ? null : contratoVigente(await listarContratos(tx, organizacaoId, l.imovelId), l.data);
  const lancar = desejado !== null && contrato?.tipo === "gestao_completa";
  if (vigente && lancar && vigente.montante === desejado && vigente.imovelId === l.imovelId && vigente.competencia === l.data) return { id: vigente.id };
  if (vigente && vigente.estado !== "previsto") return { erro: "A despesa desta limpeza já foi paga: para mudar o custo, estorne-a em Despesas primeiro." };
  let categoria: { id: string } | undefined;
  if (lancar) {
    const c = await categoriaDasLimpezas(tx, organizacaoId, autorId);
    if (!c) return { erro: "Escolha a categoria de despesa das limpezas (no fim da página de Limpezas)." };
    if (!c.ativa) return { erro: `A categoria de despesa das limpezas (“${c.nome}”) está arquivada: escolha outra no fim da página de Limpezas.` };
    categoria = c;
  }
  if (vigente && (await estornarDespesa(tx, organizacaoId, vigente.id, "Custo da limpeza mudou", autorId)) !== true) return { erro: "Não foi possível estornar a despesa anterior desta limpeza." };
  if (!lancar || !categoria || desejado === null) return { id: null };
  const [p] = l.profissionalId ? await tx.select({ nome: profissionaisLimpeza.nome }).from(profissionaisLimpeza).where(eq(profissionaisLimpeza.id, l.profissionalId)) : [];
  const r = await registrarDespesa(
    tx,
    organizacaoId,
    {
      responsavel: "empresa",
      pagoPor: "empresa",
      categoriaId: categoria.id,
      descricao: `Limpeza de ${l.data.split("-").reverse().join("/")}`,
      valor: desejado,
      data: l.data,
      imovelId: l.imovelId,
      proprietarioId: null,
      fornecedor: p?.nome ?? "",
      comprovante: "",
      paga: false,
      dataPagamento: null,
    },
    autorId,
  );
  if (!r.ok) return { erro: Object.values(r.erros)[0] ?? "Não foi possível lançar a despesa da limpeza." };
  return { id: r.lancamento.id };
}

async function transicao(
  db: Db,
  organizacaoId: string,
  id: string,
  de: readonly EstadoLimpeza[],
  mudar: (l: Limpeza, tx: Db) => Promise<Partial<Limpeza> | string>,
  acao: string,
  autorId: string | null,
): Promise<Resultado> {
  try {
    return await transicaoNaTransacao(db, organizacaoId, id, de, mudar, acao, autorId);
  } catch (e) {
    if (e instanceof Desfazer) return { ok: false, erro: e.message };
    throw e;
  }
}

/** Erro que desfaz a transação inteira e vira mensagem para a tela. */
class Desfazer extends Error {}

function transicaoNaTransacao(
  db: Db,
  organizacaoId: string,
  id: string,
  de: readonly EstadoLimpeza[],
  mudar: (l: Limpeza, tx: Db) => Promise<Partial<Limpeza> | string>,
  acao: string,
  autorId: string | null,
): Promise<Resultado> {
  return db.transaction(async (tx) => {
    const l = await travar(tx, organizacaoId, id);
    if (!l) return { ok: false as const, erro: "Limpeza não encontrada." };
    if (!de.includes(l.estado)) return { ok: false as const, erro: `Não dá a partir de "${NOMES_ESTADO[l.estado]}".` };
    const novo = await mudar(l, tx);
    if (typeof novo === "string") return { ok: false as const, erro: novo };
    // O custo da limpeza realizada vive no livro como despesa da empresa (uma regra, um lugar).
    const despesa = await acertarDespesa(tx, organizacaoId, { ...l, ...novo }, autorId);
    // Erro depois de algo gravado no livro: desfaz a transação inteira (nada fica pela metade).
    if ("erro" in despesa) throw new Desfazer(despesa.erro);
    novo.despesaId = despesa.id;
    const [depois] = await tx
      .update(limpezas)
      .set({ ...novo, atualizadoEm: new Date() })
      .where(eq(limpezas.id, id))
      .returning();
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao, entidade: "limpeza", entidadeId: id, mudancas: calcularMudancas(l, depois) });
    return { ok: true as const };
  });
}

/** Confirma com a profissional (também serve para trocar a profissional de uma já confirmada). */
export function confirmarLimpeza(db: Db, organizacaoId: string, id: string, profissionalId: string, autorId: string | null): Promise<Resultado> {
  return transicao(
    db,
    organizacaoId,
    id,
    ["pedida", "confirmada"],
    async (_l, tx) => ((await profissionalAtivo(tx, organizacaoId, profissionalId)) ? { estado: "confirmada", profissionalId, confirmadaEm: new Date() } : "Escolha uma profissional ativa."),
    "limpeza.confirmar",
    autorId,
  );
}

/** Custo em centavos ou null (não informado). Recusa negativo e valor absurdo. */
export function validarCusto(custo: number | null): string | null {
  if (custo === null) return null;
  if (!Number.isSafeInteger(custo) || custo < 0 || custo > CUSTO_MAXIMO) return "Custo inválido.";
  return null;
}

/** Registra que a limpeza foi feita (quem fez é obrigatório; o custo pode ficar para depois). */
export function realizarLimpeza(
  db: Db,
  organizacaoId: string,
  id: string,
  d: { profissionalId: string; custo: number | null; observacao?: string },
  hoje: string,
  autorId: string | null,
): Promise<Resultado> {
  const erroCusto = validarCusto(d.custo);
  if (erroCusto) return Promise.resolve({ ok: false, erro: erroCusto });
  return transicao(
    db,
    organizacaoId,
    id,
    ["pedida", "confirmada"],
    async (l, tx) => {
      if (l.data > hoje) return "A limpeza ainda não chegou: só dá para registrar como realizada a partir do dia dela.";
      // A profissional já escolhida vale mesmo se foi arquivada depois (o trabalho é de antes).
      if (d.profissionalId !== l.profissionalId && !(await profissionalAtivo(tx, organizacaoId, d.profissionalId))) return "Diga quem fez a limpeza.";
      // Sem custo no formulário, mantém o que já estava (ex.: reaberta e realizada de novo).
      return { estado: "realizada", profissionalId: d.profissionalId, custo: d.custo ?? l.custo, observacao: (d.observacao ?? l.observacao).trim().slice(0, 500), realizadaEm: new Date() };
    },
    "limpeza.realizar",
    autorId,
  );
}

/** Corrige o custo de uma limpeza realizada. */
export function informarCusto(db: Db, organizacaoId: string, id: string, custo: number | null, autorId: string | null): Promise<Resultado> {
  const erroCusto = validarCusto(custo);
  if (erroCusto) return Promise.resolve({ ok: false, erro: erroCusto });
  return transicao(db, organizacaoId, id, ["realizada"], async () => ({ custo }), "limpeza.custo", autorId);
}

/** Desfaz um "realizada" marcado por engano: volta a confirmada (ou pedida, sem profissional). */
export function reabrirLimpeza(db: Db, organizacaoId: string, id: string, autorId: string | null): Promise<Resultado> {
  return transicao(db, organizacaoId, id, ["realizada"], async (l) => ({ estado: l.profissionalId ? "confirmada" : "pedida", realizadaEm: null }), "limpeza.reabrir", autorId);
}

/** Junta o motivo à observação sem cortá-lo: o que sobra do limite fica para a observação antiga. */
export function comMotivo(observacao: string, motivo: string, limite = 500): string {
  const m = motivo.slice(0, limite);
  if (!observacao) return m;
  const resto = limite - m.length - 3;
  return resto > 0 ? `${observacao.slice(0, resto)} · ${m}` : m;
}

export function cancelarLimpeza(db: Db, organizacaoId: string, id: string, motivo: string, autorId: string | null): Promise<Resultado> {
  const m = motivo.trim();
  if (!m) return Promise.resolve({ ok: false, erro: "Informe o motivo." });
  return transicao(db, organizacaoId, id, ["pedida", "confirmada"], async (l) => ({ estado: "cancelada", canceladaManual: true, observacao: comMotivo(l.observacao, `Cancelada: ${m}`) }), "limpeza.cancelar", autorId);
}

/** Limpeza fora de checkout (ex.: faxina extra, antes de uso do proprietário). */
export async function criarLimpezaAvulsa(db: Db, organizacaoId: string, d: { imovelId: string; data: string; observacao: string }, autorId: string | null): Promise<Resultado> {
  if (!uuidValido(d.imovelId)) return { ok: false, erro: "Escolha o imóvel." };
  if (!dataValida(d.data)) return { ok: false, erro: "Data inválida." };
  // Limpeza e histórico juntos: ou os dois ficam, ou nenhum.
  return db.transaction(async (tx) => {
    const [im] = await tx
      .select({ id: imoveis.id })
      .from(imoveis)
      .where(and(eq(imoveis.id, d.imovelId), eq(imoveis.organizacaoId, organizacaoId)));
    if (!im) return { ok: false as const, erro: "Imóvel não encontrado." };
    const [l] = await tx
      .insert(limpezas)
      .values({ organizacaoId, imovelId: d.imovelId, data: d.data, observacao: d.observacao.trim().slice(0, 500) })
      .returning();
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "limpeza.criar", entidade: "limpeza", entidadeId: l.id, mudancas: { limpeza: [null, `avulsa em ${d.data}`] } });
    return { ok: true as const };
  });
}

// ——— Profissionais ———

export async function listarProfissionais(db: Db, organizacaoId: string, f: { incluirArquivados?: boolean } = {}): Promise<Profissional[]> {
  const c = [eq(profissionaisLimpeza.organizacaoId, organizacaoId)];
  if (!f.incluirArquivados) c.push(eq(profissionaisLimpeza.ativo, true));
  return db
    .select()
    .from(profissionaisLimpeza)
    .where(and(...c))
    .orderBy(asc(profissionaisLimpeza.nome));
}

export type DadosProfissional = { nome: string; telefone: string; observacoes: string };

function validarProfissional(d: DadosProfissional): string | null {
  if (!d.nome.trim() || d.nome.trim().length > 120) return "Informe o nome (até 120 caracteres).";
  if (d.telefone.length > 40 || d.observacoes.length > 500) return "Telefone ou observações longos demais.";
  return null;
}

const nomeRepetido = (e: unknown) => e instanceof Error && /profissionais_limpeza_nome|duplicate key/.test(`${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}`);

export async function criarProfissional(db: Db, organizacaoId: string, d: DadosProfissional, autorId: string | null): Promise<Resultado> {
  const erro = validarProfissional(d);
  if (erro) return { ok: false, erro };
  try {
    return await db.transaction(async (tx) => {
      const [p] = await tx
        .insert(profissionaisLimpeza)
        .values({ organizacaoId, nome: d.nome.trim(), telefone: d.telefone.trim(), observacoes: d.observacoes.trim() })
        .returning();
      await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "profissional_limpeza.criar", entidade: "profissional_limpeza", entidadeId: p.id, mudancas: { nome: [null, p.nome] } });
      return { ok: true as const };
    });
  } catch (e) {
    if (nomeRepetido(e)) return { ok: false, erro: "Já existe uma profissional com esse nome." };
    throw e;
  }
}

export async function editarProfissional(db: Db, organizacaoId: string, id: string, d: DadosProfissional & { ativo: boolean }, autorId: string | null): Promise<Resultado> {
  const erro = validarProfissional(d);
  if (erro) return { ok: false, erro };
  if (!uuidValido(id)) return { ok: false, erro: "Profissional não encontrada." };
  try {
    return await db.transaction(async (tx) => {
      const [antes] = await tx
        .select()
        .from(profissionaisLimpeza)
        .where(and(eq(profissionaisLimpeza.id, id), eq(profissionaisLimpeza.organizacaoId, organizacaoId)))
        .for("update");
      if (!antes) return { ok: false as const, erro: "Profissional não encontrada." };
      const [depois] = await tx
        .update(profissionaisLimpeza)
        .set({ nome: d.nome.trim(), telefone: d.telefone.trim(), observacoes: d.observacoes.trim(), ativo: d.ativo })
        .where(eq(profissionaisLimpeza.id, id))
        .returning();
      const mudancas = calcularMudancas(antes, depois);
      if (Object.keys(mudancas).length)
        await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "profissional_limpeza.editar", entidade: "profissional_limpeza", entidadeId: id, mudancas });
      return { ok: true as const };
    });
  } catch (e) {
    if (nomeRepetido(e)) return { ok: false, erro: "Já existe uma profissional com esse nome." };
    throw e;
  }
}
