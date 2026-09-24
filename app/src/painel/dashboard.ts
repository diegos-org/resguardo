/**
 * Dados do painel inicial (M4.6), já filtrados pelo filtro global (imóveis + período). Cada
 * bloco vem da mesma função que alimenta a tela específica (reservas, despesas, ajustes…).
 */
import { and, eq, gte, inArray, isNull, lt, ne, sql, sum } from "drizzle-orm";
import { listarAdiantamentos, totalACobrar } from "@/adiantamentos/adiantamentos";
import { listarAjustes } from "@/ajustes/ajustes";
import { lancamentos, type TipoLancamento } from "@/db/schema";
import type { Db } from "@/db/types";
import { listarDespesas, totaisDespesas } from "@/despesas/despesas";
import { totaisPorTipo } from "@/financeiro/ledger";
import type { Imovel } from "@/imoveis/repositorio";
import { conflitos } from "@/reservas/regras";
import { listarBloqueios, listarReservas, type Reserva } from "@/reservas/repositorio";
import { regrasEmVigor } from "@/sistema/regras";
import { calcularOcupacao, type Financeiro, mesesDoAno, type OcupacaoImovel, ocupacaoTotal, resumoFinanceiro } from "./indicadores";

export type Alerta = { nivel: "atencao" | "info"; texto: string; link?: string };

export type Dashboard = {
  ocupacao: (OcupacaoImovel & { codigo: string; nome: string })[];
  ocupacaoTotal: { vendidas: number; disponiveis: number; taxa: number | null };
  reservasNoPeriodo: number;
  proximasEntradas: Reserva[];
  proximasSaidas: Reserva[];
  financeiro: Financeiro | null;
  porMes: { mes: number; receitaBruta: number; comissoes: number }[] | null;
  alertas: Alerta[];
};

const somaDias = (d: string, n: number) => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)) + n)).toISOString().slice(0, 10);

export async function carregarDashboard(
  db: Db,
  organizacaoId: string,
  o: {
    imoveis: readonly Imovel[];
    /** Todos os imóveis selecionados: então despesas e ajustes sem imóvel também contam. */
    todos: boolean;
    periodo: { inicio: string; fim: string };
    ano: number;
    hoje: string;
    verFinanceiro: boolean;
  },
): Promise<Dashboard> {
  const ids = o.imoveis.map((i) => i.id);
  const vazio = ids.length === 0;
  const [reservas, bloqueios, proximas] = vazio
    ? [[], [], []]
    : await Promise.all([
        listarReservas(db, organizacaoId, { ...o.periodo, imovelIds: ids }),
        listarBloqueios(db, organizacaoId, { ...o.periodo, imovelIds: ids }),
        // Desde ontem: quem sai hoje também aparece.
        listarReservas(db, organizacaoId, { inicio: somaDias(o.hoje, -1), fim: somaDias(o.hoje, 8), imovelIds: ids }),
      ]);
  const semana = somaDias(o.hoje, 7);
  const porId = new Map(o.imoveis.map((i) => [i.id, i]));
  const ocupacao = calcularOcupacao(
    ids,
    reservas.map((r) => ({ imovelId: r.imovelId, inicio: r.checkin, fim: r.checkout })),
    bloqueios.map((b) => ({ imovelId: b.imovelId, inicio: b.inicio, fim: b.fim })),
    o.periodo,
  ).map((x) => ({ ...x, codigo: porId.get(x.imovelId)!.codigo, nome: porId.get(x.imovelId)!.nome }));

  const alertas: Alerta[] = [];
  const sobrepostas = new Set(conflitos(reservas).flat()).size;
  if (sobrepostas) alertas.push({ nivel: "atencao", texto: `${sobrepostas} reserva(s) sobreposta(s) no mesmo imóvel (possível overbooking).`, link: "/painel/reservas" });

  let financeiro: Financeiro | null = null;
  let porMes: Dashboard["porMes"] = null;
  // "Todos" roda mesmo sem imóvel ativo: despesas gerais e imóveis arquivados continuam contando.
  if (o.verFinanceiro && (!vazio || o.todos)) {
    // "Todos os imóveis" inclui o que não é de imóvel nenhum (custos gerais da empresa).
    const f = o.todos ? o.periodo : { ...o.periodo, imovelIds: ids };
    const inicioAno = `${o.ano}-01-01`;
    const fimAno = `${o.ano + 1}-01-01`;
    const comValor = reservas.filter((r) => r.valorBruto !== null);
    const [totais, mensal, regras, despesas, ajustesPendentes, adiantamentos, pendentes, calculadas] = await Promise.all([
      totaisPorTipo(db, organizacaoId, f),
      db
        .select({ mes: sql<string>`to_char(${lancamentos.competencia}, 'YYYY-MM')`, tipo: lancamentos.tipo, total: sum(lancamentos.valor) })
        .from(lancamentos)
        .where(
          and(
            eq(lancamentos.organizacaoId, organizacaoId),
            gte(lancamentos.competencia, inicioAno),
            lt(lancamentos.competencia, fimAno),
            // Mesmo recorte dos cartões: em "todos", entram também imóveis inativos.
            o.todos ? undefined : inArray(lancamentos.imovelId, ids),
            inArray(lancamentos.tipo, ["receita_bruta", "comissao"]),
          ),
        )
        .groupBy(sql`to_char(${lancamentos.competencia}, 'YYYY-MM')`, lancamentos.tipo),
      regrasEmVigor(db, organizacaoId, o.hoje),
      listarDespesas(db, organizacaoId, o.todos ? {} : { imovelIds: ids }),
      listarAjustes(db, organizacaoId, { pendentes: true }),
      listarAdiantamentos(db, organizacaoId, o.todos ? { somenteAbertos: true } : { imovelIds: ids, somenteAbertos: true }),
      db
        .select({ imovelId: lancamentos.imovelId, n: sql<number>`count(*)::int` })
        .from(lancamentos)
        .where(
          and(
            eq(lancamentos.organizacaoId, organizacaoId),
            eq(lancamentos.estado, "pendente"),
            // Ajuste pendente já tem o seu alerta ("pendente de esclarecimento"): não conta duas vezes.
            ne(lancamentos.tipo, "ajuste"),
            o.todos ? undefined : inArray(lancamentos.imovelId, ids),
            sql`${lancamentos.estornoDe} is null`,
            sql`not exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`,
          ),
        )
        .groupBy(lancamentos.imovelId),
      // Reservas do período com valor que não têm nenhum lançamento: o motor não calculou (ex.: sem
      // contrato na data da entrada, mesmo que hoje o imóvel já tenha contrato).
      comValor.length
        ? db
            .selectDistinct({ reservaId: lancamentos.reservaId })
            .from(lancamentos)
            .where(
              and(
                eq(lancamentos.organizacaoId, organizacaoId),
                inArray(lancamentos.reservaId, comValor.map((r) => r.id)),
                // Só o cálculo do motor conta (um ajuste da reserva não é cálculo), e não estornado.
                eq(lancamentos.origem, "motor"),
                eq(lancamentos.tipo, "receita_bruta"),
                isNull(lancamentos.estornoDe),
                sql`not exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`,
              ),
            )
        : [],
    ]);
    financeiro = resumoFinanceiro(totais);
    const m = new Map<string, { receitaBruta: number; comissoes: number }>();
    for (const l of mensal) {
      const x = m.get(l.mes) ?? { receitaBruta: 0, comissoes: 0 };
      if ((l.tipo as TipoLancamento) === "receita_bruta") x.receitaBruta = Number(l.total ?? 0);
      else x.comissoes = Number(l.total ?? 0);
      m.set(l.mes, x);
    }
    porMes = mesesDoAno(o.ano, m);

    const selecionados = new Set(ids);
    const semContrato = regras.filter((r) => selecionados.has(r.imovelId) && !r.contrato).map((r) => r.codigo);
    const semDono = regras.filter((r) => selecionados.has(r.imovelId) && !r.proprietario).map((r) => r.codigo);
    if (semContrato.length) alertas.push({ nivel: "atencao", texto: `Sem contrato vigente: ${semContrato.join(", ")}.`, link: "/painel/sistema" });
    if (semDono.length) alertas.push({ nivel: "atencao", texto: `Sem proprietário: ${semDono.join(", ")}.`, link: "/painel/sistema" });
    const semValor = reservas.filter((r) => r.valorBruto === null).length;
    if (semValor) alertas.push({ nivel: "atencao", texto: `${semValor} reserva(s) do período sem valor: financeiro pendente.`, link: "/painel/reservas" });
    const comLancamento = new Set(calculadas.map((x) => x.reservaId));
    const semCalculo = comValor.filter((r) => !comLancamento.has(r.id)).length;
    if (semCalculo)
      alertas.push({ nivel: "atencao", texto: `${semCalculo} reserva(s) do período com valor mas sem cálculo no financeiro: confira o contrato na data da entrada.`, link: "/painel/reservas" });
    const codigoDe = new Map(regras.map((r) => [r.imovelId, r.codigo]));
    const nPendentes = pendentes.reduce((t, x) => t + x.n, 0);
    if (nPendentes) {
      const codigos = [...new Set(pendentes.map((x) => (x.imovelId ? (porId.get(x.imovelId)?.codigo ?? codigoDe.get(x.imovelId)) : null)).filter(Boolean))];
      alertas.push({
        nivel: "info",
        texto: `${nPendentes} lançamento(s) com acerto pendente${codigos.length ? ` (${codigos.join(", ")})` : ""}: falta proprietário ou confirmar quem recebe do canal.`,
        link: "/painel/sistema",
      });
    }
    // Em "todos", entram também os ajustes de imóveis arquivados (como nos totais).
    const ajustes = o.todos ? ajustesPendentes.length : ajustesPendentes.filter((a) => a.imovelId && selecionados.has(a.imovelId)).length;
    if (ajustes) alertas.push({ nivel: "info", texto: `${ajustes} ajuste(s) pendente(s) de esclarecimento.`, link: "/painel/financeiro/ajustes" });
    const aCobrar = totalACobrar(adiantamentos);
    const contestados = adiantamentos.filter((a) => a.situacao === "contestado").length;
    if (aCobrar) alertas.push({ nivel: "info", texto: `Adiantamentos a cobrar dos proprietários: ${(aCobrar / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`, link: "/painel/despesas/adiantamentos" });
    if (contestados) alertas.push({ nivel: "atencao", texto: `${contestados} adiantamento(s) contestado(s) aguardando decisão.`, link: "/painel/despesas/adiantamentos" });
    const aPagar = totaisDespesas(despesas).aPagar;
    if (aPagar) alertas.push({ nivel: "info", texto: `Despesas ainda a pagar: ${(aPagar / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`, link: "/painel/despesas" });
  }

  return {
    ocupacao,
    ocupacaoTotal: ocupacaoTotal(ocupacao),
    reservasNoPeriodo: reservas.length,
    proximasEntradas: proximas.filter((r) => r.checkin >= o.hoje && r.checkin < semana),
    proximasSaidas: proximas.filter((r) => r.checkout >= o.hoje && r.checkout < semana).sort((x, y) => x.checkout.localeCompare(y.checkout)),
    financeiro,
    porMes,
    alertas,
  };
}
