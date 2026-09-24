/**
 * Números do portal do proprietário (M5.1), do ponto de vista dele e só com o que é dele. Os
 * valores vêm do mesmo livro do painel (nada é recalculado aqui); a contagem de reservas vem das
 * reservas confirmadas dos imóveis dele no período.
 */
import { and, eq, exists, gt, gte, inArray, isNotNull, isNull, lt, not, notInArray, or, sql, sum } from "drizzle-orm";
import { lancamentos, proprietarios, proprietarioUsuarios, reservas, type TipoLancamento } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";

/** Proprietários (ativos) que este usuário pode ver no portal: ele mesmo ou quem ele representa. */
export async function proprietariosDoUsuario(db: Db, organizacaoId: string, usuarioId: string): Promise<{ id: string; nome: string; chavePix: string }[]> {
  if (!uuidValido(usuarioId)) return [];
  return db
    .select({ id: proprietarios.id, nome: proprietarios.nome, chavePix: proprietarios.chavePix })
    .from(proprietarioUsuarios)
    .innerJoin(proprietarios, and(eq(proprietarios.id, proprietarioUsuarios.proprietarioId), eq(proprietarios.ativo, true), eq(proprietarios.organizacaoId, organizacaoId)))
    .where(eq(proprietarioUsuarios.usuarioId, usuarioId));
}

export type ResumoPortal = {
  reservas: number;
  receitaBruta: number;
  taxasCanais: number;
  comissao: number;
  /** Parte do proprietário nas reservas (com split ou recebida pela empresa). */
  suaParte: number;
  /** Despesas atribuídas a ele (valor da despesa). */
  despesas: number;
  /** Movimento do acerto no período. Positivo: a empresa passou a dever a ele. */
  acerto: number;
};

/** Lançamentos que a própria reserva gera (motor e seus estornos). */
const DA_RESERVA: TipoLancamento[] = ["receita_bruta", "taxa_canal", "comissao", "direito_proprietario"];

const ZERO: ResumoPortal = { reservas: 0, receitaBruta: 0, taxasCanais: 0, comissao: 0, suaParte: 0, despesas: 0, acerto: 0 };

export async function resumoDoProprietario(
  db: Db,
  organizacaoId: string,
  o: { proprietarioIds: readonly string[]; imovelIds: readonly string[]; periodo: { inicio: string; fim: string } },
): Promise<ResumoPortal> {
  const donos = o.proprietarioIds.filter(uuidValido);
  const imoveis = o.imovelIds.filter(uuidValido);
  // Sem proprietário ou sem imóvel: nada (nunca "todos").
  if (!donos.length || !imoveis.length) return ZERO;
  // Reserva ainda pendente não é receita para o proprietário. Cancelada fica como está no livro:
  // o cancelamento estorna os lançamentos (somam zero), e se já houve dinheiro movimentado eles
  // continuam valendo, como no painel.
  const pendentes = db.select({ id: reservas.id }).from(reservas).where(and(eq(reservas.organizacaoId, organizacaoId), eq(reservas.estado, "pendente")));
  const base = and(
    eq(lancamentos.organizacaoId, organizacaoId),
    gte(lancamentos.competencia, o.periodo.inicio),
    lt(lancamentos.competencia, o.periodo.fim),
    inArray(lancamentos.imovelId, imoveis),
    // A restrição vale só para o que a reserva gera (bruto, taxa, comissão, parte do dono);
    // ajuste, despesa e repasse ligados a uma reserva continuam valendo mesmo se ela cair.
    or(notInArray(lancamentos.tipo, DA_RESERVA), isNull(lancamentos.reservaId), notInArray(lancamentos.reservaId, pendentes)),
  );
  // Linhas do próprio proprietário: parte dele, despesas, acerto.
  const dele = await db
    .select({ tipo: lancamentos.tipo, valor: sum(lancamentos.valor), montante: sum(lancamentos.montante), acerto: sum(lancamentos.efeitoSaldo) })
    .from(lancamentos)
    .where(and(base, inArray(lancamentos.proprietarioId, donos)))
    .groupBy(lancamentos.tipo);
  // Valores das reservas: as que têm a parte do proprietário lançada para ele no período.
  const reservasDele = db
    .selectDistinct({ id: lancamentos.reservaId })
    .from(lancamentos)
    .where(and(base, eq(lancamentos.tipo, "direito_proprietario"), inArray(lancamentos.proprietarioId, donos), isNotNull(lancamentos.reservaId)));
  // Contagem: reservas confirmadas dos imóveis dele no período (como no Início). A que tem a
  // parte lançada para ele conta; a lançada só para outra pessoa, não. A ainda sem cálculo no
  // financeiro só conta se o imóvel nunca teve outro dono no livro: sem histórico de posse, não
  // dá para saber de quem era, e o portal nunca mostra o histórico de outra pessoa.
  const direito = (deles: boolean) =>
    db
      .select({ um: sql`1` })
      .from(lancamentos)
      .where(
        and(
          eq(lancamentos.reservaId, reservas.id),
          eq(lancamentos.tipo, "direito_proprietario"),
          deles ? inArray(lancamentos.proprietarioId, donos) : and(isNotNull(lancamentos.proprietarioId), notInArray(lancamentos.proprietarioId, donos)),
        ),
      );
  const [contagem] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reservas)
    .where(
      and(
        eq(reservas.organizacaoId, organizacaoId),
        eq(reservas.estado, "confirmada"),
        inArray(reservas.imovelId, imoveis),
        lt(reservas.checkin, o.periodo.fim),
        gt(reservas.checkout, o.periodo.inicio),
        or(
          exists(direito(true)),
          and(
            not(exists(direito(false))),
            not(
              exists(
                db
                  .select({ um: sql`1` })
                  .from(lancamentos)
                  .where(and(eq(lancamentos.imovelId, reservas.imovelId), isNotNull(lancamentos.proprietarioId), notInArray(lancamentos.proprietarioId, donos))),
              ),
            ),
          ),
        ),
      ),
    );
  const daReserva = await db
    .select({ tipo: lancamentos.tipo, valor: sum(lancamentos.valor) })
    .from(lancamentos)
    .where(and(base, inArray(lancamentos.tipo, ["receita_bruta", "taxa_canal", "comissao"]), sql`${lancamentos.reservaId} in (${reservasDele})`))
    .groupBy(lancamentos.tipo);

  const v = (lista: { tipo: TipoLancamento; valor: string | null }[], t: TipoLancamento) => Number(lista.find((x) => x.tipo === t)?.valor ?? 0);
  const neg = (x: number) => (x === 0 ? 0 : -x);
  return {
    reservas: contagem?.n ?? 0,
    receitaBruta: v(daReserva, "receita_bruta"),
    taxasCanais: neg(v(daReserva, "taxa_canal")),
    comissao: v(daReserva, "comissao"),
    suaParte: v(dele, "direito_proprietario"),
    despesas: Number(dele.find((x) => x.tipo === "despesa_proprietario")?.montante ?? 0),
    acerto: dele.reduce((t, x) => t + Number(x.acerto ?? 0), 0),
  };
}
