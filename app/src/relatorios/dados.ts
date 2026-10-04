/**
 * Consultas dos dados novos do relatório mensal (M5.7). Nada é recalculado: as partes vêm do extrato (M4.10/M4.12), os
 * números do mês do resumo do portal, os repasses e as despesas do livro. Aqui só se junta o que cada página mostra.
 */
import { and, eq, gte, inArray, isNull, lt, or, sql, sum } from "drizzle-orm";
import { NOMES_TIPO } from "@/contratos/regras";
import { contratos, lancamentos, reservas, type TipoContrato } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { lancamentoEmVigor } from "@/portal/posse";
import { bloqueiosDoPortal, reservasDoPortal } from "@/portal/reservas";
import { resumoDoProprietario } from "@/portal/resumo";
import { partesDoProprietario } from "@/repasses/extrato";
import { somarDias } from "@/repasses/inicio";
import { lerInicioDoSistema } from "@/repasses/regras-config";
import { itensDoRepasse, listarRepasses, type Repasse } from "@/repasses/repasses";
import type { ParteDoRelatorio } from "./dinheiro";
import { type DadosDoMes, diasDoMes, limitesDe, type MesISO, noitesBloqueadas, noitesNoIntervalo, somarMeses } from "./metricas";

type Dono = { id: string; nome: string };
const mesDe = (data: string): MesISO => data.slice(0, 7);
const comissaoTexto = (bp: number | null): string | null => (bp === null ? null : `${(bp / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);

/**
 * As partes do proprietário que o relatório de `mes` precisa: as de competência no mês, no anterior e no seguinte (a
 * ponte da conciliação) e qualquer parte paga pelo canal dentro do mês; só dos imóveis do relatório. Cada parte traz os
 * componentes do livro daquele mês (bruto, taxa do canal, comissão) e a data em que o canal pagou (M4.12).
 */
export async function partesDoRelatorio(db: Db, organizacaoId: string, o: { donos: readonly Dono[]; imovelIds: readonly string[]; mes: MesISO; agora: Date }): Promise<ParteDoRelatorio[]> {
  const imoveis = new Set(o.imovelIds.filter(uuidValido));
  if (!imoveis.size) return [];
  const meses = new Set([somarMeses(o.mes, -1), o.mes, somarMeses(o.mes, 1)]);
  const todas = (await Promise.all(o.donos.map((d) => partesDoProprietario(db, organizacaoId, d.id, o.agora)))).flat();
  const partes = todas.filter((p) => imoveis.has(p.imovelId) && (meses.has(mesDe(p.competencia)) || mesDe(p.pagamento?.data ?? "") === o.mes));
  if (!partes.length) return [];
  const reservaIds = [...new Set(partes.map((p) => p.reservaId))];
  const mesesDasPartes = [...new Set(partes.map((p) => mesDe(p.competencia)))].sort();
  const [componentes, codigos] = await Promise.all([
    db
      .select({ reservaId: lancamentos.reservaId, mes: sql<string>`to_char(${lancamentos.competencia}, 'YYYY-MM')`, tipo: lancamentos.tipo, valor: sum(lancamentos.valor) })
      .from(lancamentos)
      .where(
        and(
          eq(lancamentos.organizacaoId, organizacaoId),
          inArray(lancamentos.reservaId, reservaIds),
          inArray(lancamentos.tipo, ["receita_bruta", "taxa_canal", "comissao"]),
          gte(lancamentos.competencia, `${mesesDasPartes[0]}-01`),
          lt(lancamentos.competencia, limitesDe(mesesDasPartes.at(-1)!).fim),
          lancamentoEmVigor(db),
        ),
      )
      .groupBy(sql`1`, sql`2`, sql`3`),
    db.select({ id: reservas.id, codigoCanal: reservas.codigoCanal }).from(reservas).where(inArray(reservas.id, reservaIds)),
  ]);
  const comp = (reservaId: string, mes: MesISO, tipo: string) => Number(componentes.find((c) => c.reservaId === reservaId && c.mes === mes && c.tipo === tipo)?.valor ?? 0);
  const codigoCanal = new Map(codigos.map((c) => [c.id, c.codigoCanal]));
  return partes
    .map((p) => {
      const mes = mesDe(p.competencia);
      const { inicio, fim } = limitesDe(mes);
      return {
        reservaId: p.reservaId,
        codigo: p.codigoReserva,
        codigoCanal: codigoCanal.get(p.reservaId) ?? "",
        hospede: p.hospede,
        canal: p.origem,
        checkin: p.checkin,
        checkout: p.checkout,
        mes,
        noitesNoMes: noitesNoIntervalo(p.checkin, p.checkout, inicio, fim),
        noitesTotal: noitesNoIntervalo(p.checkin, p.checkout, p.checkin, p.checkout),
        bruto: comp(p.reservaId, mes, "receita_bruta"),
        taxa: -comp(p.reservaId, mes, "taxa_canal"),
        comissao: comp(p.reservaId, mes, "comissao"),
        suaParte: p.valor,
        quemRecebe: p.quemRecebe,
        situacao: p.situacao,
        motivo: p.motivo,
        pagamento: p.pagamento,
        repasse: p.repasse,
      };
    })
    .sort((a, b) => a.checkin.localeCompare(b.checkin) || a.codigo.localeCompare(b.codigo));
}

export type MetricasDoRelatorio = {
  atual: DadosDoMes;
  anterior: DadosDoMes | null;
  anoAnterior: DadosDoMes | null;
  /** Resultado (sua parte − despesas) dos 12 meses até o mês; null = sem dado no sistema. */
  serie: [MesISO, number | null][];
  /** Dia até onde os números do mês corrente valem; null no mês terminado. */
  parcialAte: number | null;
};

/**
 * Números do mês e dos meses de comparação, todos pelo resumo do portal (uma regra, um lugar). Mês "sem dado no
 * sistema": anterior ao início do sistema (M4.11) ou, sem início definido, sem nenhum lançamento na organização.
 */
export async function metricasDoRelatorio(
  db: Db,
  organizacaoId: string,
  o: { donos: readonly Dono[]; imovelIds: readonly string[]; todosOsImoveis: boolean; mes: MesISO; hoje: string; parcial: boolean },
): Promise<MetricasDoRelatorio> {
  const donoIds = o.donos.map((d) => d.id);
  const imovelIds = [...o.imovelIds];
  const meses = Array.from({ length: 12 }, (_, i) => somarMeses(o.mes, i - 11));
  const candidatos = [...new Set([...meses, somarMeses(o.mes, -12)])];
  const inicio = await lerInicioDoSistema(db, organizacaoId);
  const comLancamento = new Set(
    (
      await db
        .selectDistinct({ mes: sql<string>`to_char(${lancamentos.competencia}, 'YYYY-MM')` })
        .from(lancamentos)
        .where(and(eq(lancamentos.organizacaoId, organizacaoId), gte(lancamentos.competencia, `${candidatos[0]}-01`), lt(lancamentos.competencia, limitesDe(o.mes).fim)))
    ).map((l) => l.mes),
  );
  const temDado = (m: MesISO) => (m === o.mes ? true : inicio ? m >= mesDe(inicio) && m <= o.mes : comLancamento.has(m));
  const dadosDoMes = async (m: MesISO, ate: string | null): Promise<DadosDoMes> => {
    const { inicio: de, fim } = limitesDe(m);
    const fimConsiderado = ate ? somarDias(ate, 1) : fim;
    const [resumo, lista, bloqueios] = await Promise.all([
      resumoDoProprietario(db, organizacaoId, { proprietarioIds: donoIds, imovelIds, semImovel: o.todosOsImoveis, periodo: { inicio: de, fim } }),
      reservasDoPortal(db, organizacaoId, { proprietarioIds: donoIds, imovelIds, periodo: { inicio: de, fim } }),
      bloqueiosDoPortal(db, organizacaoId, { proprietarioIds: donoIds, imovelIds, periodo: { inicio: de, fim } }),
    ]);
    return {
      mes: m,
      resultado: resumo.suaParte - resumo.despesas,
      bruto: resumo.receitaBruta,
      noitesOcupadas: lista.reduce((s, r) => s + noitesNoIntervalo(r.checkin, r.checkout, de, fimConsiderado), 0),
      noitesDoPeriodo: ate ? Number(ate.slice(8, 10)) : diasDoMes(m),
      imoveis: imovelIds.length,
      noitesBloqueadas: noitesBloqueadas(
        bloqueios.filter((b) => b.fonte === "proprietario"),
        de,
        fimConsiderado,
      ),
    };
  };
  const ate = o.parcial ? o.hoje : null;
  const atual = await dadosDoMes(o.mes, ate);
  const anteriorMes = somarMeses(o.mes, -1);
  const anoAnteriorMes = somarMeses(o.mes, -12);
  const [anterior, anoAnterior] = await Promise.all([temDado(anteriorMes) ? dadosDoMes(anteriorMes, null) : null, temDado(anoAnteriorMes) ? dadosDoMes(anoAnteriorMes, null) : null]);
  const serie: [MesISO, number | null][] = [];
  for (const m of meses) {
    if (m === o.mes) serie.push([m, atual.resultado]);
    else if (m === anteriorMes && anterior) serie.push([m, anterior.resultado]);
    else if (!temDado(m)) serie.push([m, null]);
    else {
      const r = await resumoDoProprietario(db, organizacaoId, { proprietarioIds: donoIds, imovelIds, semImovel: o.todosOsImoveis, periodo: limitesDe(m) });
      serie.push([m, r.suaParte - r.despesas]);
    }
  }
  return { atual, anterior, anoAnterior, serie, parcialAte: ate ? Number(ate.slice(8, 10)) : null };
}

export type RepasseDoRelatorio = { id: string; tipo: Repasse["tipo"]; data: string; situacao: Repasse["situacao"]; dataPagamento: string | null; valor: number; reservas: string[] };

/** Repasses do mês (antecipados e acertos por fora com data no mês, em vigor) e o fechamento do mês, de cada proprietário. */
export async function repassesDoRelatorio(db: Db, organizacaoId: string, donos: readonly Dono[], mes: MesISO): Promise<{ repasses: RepasseDoRelatorio[]; fechamentos: Repasse[] }> {
  const { inicio, fim } = limitesDe(mes);
  const todos = (await Promise.all(donos.map((d) => listarRepasses(db, organizacaoId, d.id)))).flat().filter((r) => !r.estornadoEm);
  const doMes = todos.filter((r) => r.tipo !== "fechamento" && r.data >= inicio && r.data < fim).sort((a, b) => a.data.localeCompare(b.data));
  const repasses = await Promise.all(
    doMes.map(async (r) => ({
      id: r.id,
      tipo: r.tipo,
      data: r.data,
      situacao: r.situacao,
      dataPagamento: r.dataPagamento,
      valor: r.valor,
      reservas: [...new Set((await itensDoRepasse(db, organizacaoId, r.id)).map((i) => i.hospede.trim().split(/\s+/)[0] || i.codigoReserva))],
    })),
  );
  return { repasses, fechamentos: todos.filter((r) => r.tipo === "fechamento" && r.mes === inicio) };
}

export type DespesaDoRelatorio = { data: string; descricao: string; valor: number };

/** Despesas atribuídas ao proprietário no mês (o montante da despesa), dos imóveis do relatório. */
export async function despesasDoRelatorio(db: Db, organizacaoId: string, o: { donos: readonly Dono[]; imovelIds: readonly string[]; todosOsImoveis: boolean; mes: MesISO }): Promise<DespesaDoRelatorio[]> {
  const donoIds = o.donos.map((d) => d.id).filter(uuidValido);
  const imovelIds = o.imovelIds.filter(uuidValido);
  if (!donoIds.length || !imovelIds.length) return [];
  const { inicio, fim } = limitesDe(o.mes);
  const linhas = await db
    .select({ competencia: lancamentos.competencia, dataCaixa: lancamentos.dataCaixa, descricao: lancamentos.descricao, montante: lancamentos.montante, valor: lancamentos.valor })
    .from(lancamentos)
    .where(
      and(
        eq(lancamentos.organizacaoId, organizacaoId),
        eq(lancamentos.tipo, "despesa_proprietario"),
        inArray(lancamentos.proprietarioId, donoIds),
        o.todosOsImoveis ? or(inArray(lancamentos.imovelId, imovelIds), isNull(lancamentos.imovelId)) : inArray(lancamentos.imovelId, imovelIds),
        gte(lancamentos.competencia, inicio),
        lt(lancamentos.competencia, fim),
        lancamentoEmVigor(db),
      ),
    )
    .orderBy(lancamentos.competencia, lancamentos.criadoEm);
  return linhas.map((l) => ({ data: l.dataCaixa ?? l.competencia, descricao: l.descricao, valor: l.montante ?? l.valor }));
}

export type ContratoDoRelatorio = { imovelId: string; tipo: TipoContrato; tipoNome: string; comissao: string | null };

/** O contrato em vigor no fim do mês (ou o último que valeu nele) de cada imóvel do relatório. */
export async function contratosDoRelatorio(db: Db, organizacaoId: string, imovelIds: readonly string[], mes: MesISO): Promise<ContratoDoRelatorio[]> {
  const ids = imovelIds.filter(uuidValido);
  if (!ids.length) return [];
  const { inicio, fim } = limitesDe(mes);
  const linhas = await db
    .select()
    .from(contratos)
    .where(and(eq(contratos.organizacaoId, organizacaoId), inArray(contratos.imovelId, ids), lt(contratos.inicio, fim), or(isNull(contratos.fim), gte(contratos.fim, inicio))))
    .orderBy(contratos.imovelId, contratos.inicio);
  const porImovel = new Map<string, (typeof linhas)[number]>();
  for (const c of linhas) porImovel.set(c.imovelId, c);
  return [...porImovel.values()].map((c) => ({ imovelId: c.imovelId, tipo: c.tipo, tipoNome: NOMES_TIPO[c.tipo], comissao: comissaoTexto(c.comissaoBp) }));
}
