/**
 * Números do portal do proprietário (M5.1), do ponto de vista dele e só com o que é dele. Os
 * valores vêm do mesmo livro do painel (nada é recalculado aqui); a contagem de reservas vem das
 * reservas confirmadas dos imóveis dele no período.
 */
import { and, eq, exists, gt, gte, inArray, isNotNull, isNull, lt, not, notInArray, or, sql, sum } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ajustes, lancamentos, proprietarios, proprietarioUsuarios, reservas, type TipoLancamento } from "@/db/schema";
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
  /** Movimento do acerto no período, só do que está definido. Positivo: a empresa passou a dever a ele. */
  acerto: number;
  /** Efeito no acerto do que ainda está em conferência (lançamento "pendente"): fora de `acerto`. */
  acertoPendente: number;
  /**
   * Há algo em conferência no período (lançamento pendente ou ajuste não esclarecido, mesmo sem
   * valor)? Vale mesmo se os valores se anularem: como no fechamento do mês, conta a existência.
   */
  emConferencia: boolean;
};

/** Lançamentos que a própria reserva gera (motor e seus estornos). */
const DA_RESERVA: TipoLancamento[] = ["receita_bruta", "taxa_canal", "comissao", "direito_proprietario"];

const ZERO: ResumoPortal = { reservas: 0, receitaBruta: 0, taxasCanais: 0, comissao: 0, suaParte: 0, despesas: 0, acerto: 0, acertoPendente: 0, emConferencia: false };

export async function resumoDoProprietario(
  db: Db,
  organizacaoId: string,
  o: { proprietarioIds: readonly string[]; imovelIds: readonly string[]; semImovel?: boolean; periodo: { inicio: string; fim: string } },
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
    // Lançamento do proprietário sem imóvel (ajuste/acerto geral) só entra com todos os imóveis dele.
    o.semImovel ? or(inArray(lancamentos.imovelId, imoveis), and(isNull(lancamentos.imovelId), inArray(lancamentos.proprietarioId, donos))) : inArray(lancamentos.imovelId, imoveis),
    // A restrição vale só para o que a reserva gera (bruto, taxa, comissão, parte do dono);
    // ajuste, despesa e repasse ligados a uma reserva continuam valendo mesmo se ela cair.
    or(notInArray(lancamentos.tipo, DA_RESERVA), isNull(lancamentos.reservaId), notInArray(lancamentos.reservaId, pendentes)),
  );
  // Linhas do próprio proprietário: parte dele, despesas, acerto.
  const dele = await db
    .select({ tipo: lancamentos.tipo, estado: lancamentos.estado, valor: sum(lancamentos.valor), montante: sum(lancamentos.montante), acerto: sum(lancamentos.efeitoSaldo) })
    .from(lancamentos)
    .where(and(base, inArray(lancamentos.proprietarioId, donos)))
    .groupBy(lancamentos.tipo, lancamentos.estado);
  // Ajuste com ele ainda não esclarecido no período (inclusive sem valor, que não tem lançamento).
  const [abertos] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ajustes)
    .where(
      and(
        eq(ajustes.organizacaoId, organizacaoId),
        eq(ajustes.afeta, "proprietario"),
        isNull(ajustes.esclarecidoEm),
        gte(ajustes.data, o.periodo.inicio),
        lt(ajustes.data, o.periodo.fim),
        or(inArray(ajustes.proprietarioId, donos), and(isNull(ajustes.proprietarioId), inArray(ajustes.imovelId, imoveis))),
        o.semImovel ? undefined : inArray(ajustes.imovelId, imoveis),
      ),
    );
  // A reserva é de quem tem a parte do proprietário *em vigor* (nem estorno, nem estornada):
  // se o imóvel foi A→B→A, a parte antiga de A, já estornada, não faz a reserva de B ser de A.
  const estorno = alias(lancamentos, "estorno");
  const ativo = and(isNull(lancamentos.estornoDe), not(exists(db.select({ um: sql`1` }).from(estorno).where(eq(estorno.estornoDe, lancamentos.id)))));
  // Em conferência: só o pendente em vigor (como no fechamento do mês). Um pendente já
  // estornado (ajuste complementado/esclarecido, reserva recalculada) não conta mais.
  const [pendente] = await db
    .select({ n: sql<number>`count(*)::int`, total: sum(lancamentos.efeitoSaldo) })
    .from(lancamentos)
    .where(and(base, inArray(lancamentos.proprietarioId, donos), eq(lancamentos.estado, "pendente"), ativo));
  // Valores das reservas: as que têm a parte do proprietário lançada para ele no período.
  const reservasDele = db
    .selectDistinct({ id: lancamentos.reservaId })
    .from(lancamentos)
    .where(and(base, eq(lancamentos.tipo, "direito_proprietario"), ativo, inArray(lancamentos.proprietarioId, donos), isNotNull(lancamentos.reservaId)));
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
          ativo,
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

  const v = (lista: { tipo: TipoLancamento; valor: string | null }[], t: TipoLancamento) => lista.filter((x) => x.tipo === t).reduce((s, x) => s + Number(x.valor ?? 0), 0);
  const neg = (x: number) => (x === 0 ? 0 : -x);
  return {
    reservas: contagem?.n ?? 0,
    receitaBruta: v(daReserva, "receita_bruta"),
    taxasCanais: neg(v(daReserva, "taxa_canal")),
    comissao: v(daReserva, "comissao"),
    suaParte: v(dele, "direito_proprietario"),
    despesas: dele.filter((x) => x.tipo === "despesa_proprietario").reduce((s, x) => s + Number(x.montante ?? 0), 0),
    // O que ainda está em conferência (ajuste a esclarecer, acerto pendente) fica à parte,
    // como no fechamento do mês: não aparece como definitivo.
    acerto: dele.filter((x) => x.estado !== "pendente").reduce((t, x) => t + Number(x.acerto ?? 0), 0),
    acertoPendente: Number(pendente?.total ?? 0),
    emConferencia: (pendente?.n ?? 0) > 0 || (abertos?.n ?? 0) > 0,
  };
}
