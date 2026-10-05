/**
 * Consultas dos dados novos do relatório mensal (M5.7). Nada é recalculado: as partes vêm do extrato (M4.10/M4.12), os
 * números do mês do resumo do portal, os repasses e as despesas do livro. Aqui só se junta o que cada página mostra.
 */
import { and, asc, eq, gt, gte, inArray, isNull, lt, or, sql, sum } from "drizzle-orm";
import { NOMES_TIPO } from "@/contratos/regras";
import { auditoria, bloqueios, contratos, lancamentos, proprietarioImoveis, reservas, type TipoContrato } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { ratear } from "@/lib/rateio";
import { lancamentoEmVigor } from "@/portal/posse";
import { reservasDoPortal } from "@/portal/reservas";
import { resumoDoProprietario } from "@/portal/resumo";
import { partesDoProprietario } from "@/repasses/extrato";
import { somarDias } from "@/repasses/inicio";
import { lerInicioDoSistema } from "@/repasses/regras-config";
import { itensDoRepasse, listarRepasses, type Repasse } from "@/repasses/repasses";
import type { ParteDoRelatorio } from "./dinheiro";
import { type DadosDoMes, diasDeImovel, diasDoMes, intervalosDePosse, limitesDe, type MesISO, noitesBloqueadas, noitesNoIntervalo, noitesOcupadasNoIntervalo, somarMeses, trechosNaPosse } from "./metricas";

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
  /** Os 12 meses até o mês, com os números de cada um (resultado, noites, bruto…); null = sem dado no sistema. */
  meses: [MesISO, DadosDoMes | null][];
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
  // O mês mais antigo que entra em alguma comparação é o do ano anterior (−12), antes dos 12 da série.
  const mesMaisAntigo = somarMeses(o.mes, -12);
  const inicio = await lerInicioDoSistema(db, organizacaoId);
  const comLancamento = new Set(
    (
      await db
        .selectDistinct({ mes: sql<string>`to_char(${lancamentos.competencia}, 'YYYY-MM')` })
        .from(lancamentos)
        .where(and(eq(lancamentos.organizacaoId, organizacaoId), gte(lancamentos.competencia, `${mesMaisAntigo}-01`), lt(lancamentos.competencia, limitesDe(o.mes).fim)))
    ).map((l) => l.mes),
  );
  const temDado = (m: MesISO) => (m === o.mes ? true : inicio ? m >= mesDe(inicio) && m <= o.mes : comLancamento.has(m));
  // Posse de cada imóvel pelos proprietários do relatório, como intervalos (dia em São Paulo): o histórico de
  // "proprietario.imoveis" (quem ganhou e quem perdeu o imóvel, e quando) mais o vínculo atual; sem histórico, o
  // vínculo atual e, para o dono antigo, até o dia em que o dono seguinte foi vinculado (`intervalosDePosse`). As
  // noites para vender e os bloqueios do dono contam só dentro da posse — inclusive numa posse anterior do mesmo dono.
  const donosValidos = donoIds.filter(uuidValido);
  const diaSP = (coluna: typeof proprietarioImoveis.criadoEm | typeof auditoria.criadoEm) => sql<string>`to_char((${coluna} at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD')`;
  const [vinculos, historico] = imovelIds.length
    ? await Promise.all([
        db.select({ imovelId: proprietarioImoveis.imovelId, proprietarioId: proprietarioImoveis.proprietarioId, dia: diaSP(proprietarioImoveis.criadoEm) }).from(proprietarioImoveis).where(inArray(proprietarioImoveis.imovelId, imovelIds)),
        donosValidos.length
          ? db
              .select({ proprietarioId: auditoria.entidadeId, mudancas: auditoria.mudancas, dia: diaSP(auditoria.criadoEm) })
              .from(auditoria)
              .where(and(eq(auditoria.organizacaoId, organizacaoId), eq(auditoria.acao, "proprietario.imoveis"), inArray(auditoria.entidadeId, donosValidos)))
              .orderBy(asc(auditoria.criadoEm))
          : Promise.resolve([]),
      ])
    : [[], []];
  const posseDe = new Map(imovelIds.map((id) => [id, intervalosDePosse(id, donoIds, vinculos, historico)] as const));
  const dadosDoMes = async (m: MesISO, ate: string | null): Promise<DadosDoMes> => {
    const { inicio: de, fim } = limitesDe(m);
    const fimConsiderado = ate ? somarDias(ate, 1) : fim;
    const [resumo, resumoAte, lista, bloqueiosDoDono, estadias] = await Promise.all([
      resumoDoProprietario(db, organizacaoId, { proprietarioIds: donoIds, imovelIds, semImovel: o.todosOsImoveis, periodo: { inicio: de, fim } }),
      ate ? resumoDoProprietario(db, organizacaoId, { proprietarioIds: donoIds, imovelIds, semImovel: o.todosOsImoveis, periodo: { inicio: de, fim: fimConsiderado } }) : Promise.resolve(null),
      reservasDoPortal(db, organizacaoId, { proprietarioIds: donoIds, imovelIds, periodo: { inicio: de, fim } }),
      // Bloqueios de uso próprio dos donos do relatório, pelo dono registrado no bloqueio (não pelo vínculo atual: o
      // dono antigo continua com os bloqueios que fez), e só dentro da posse de cada um.
      donosValidos.length && imovelIds.length
        ? db
            .select({ imovelId: bloqueios.imovelId, inicio: bloqueios.inicio, fim: bloqueios.fim })
            .from(bloqueios)
            .where(and(eq(bloqueios.organizacaoId, organizacaoId), inArray(bloqueios.imovelId, imovelIds), inArray(bloqueios.proprietarioId, donosValidos), eq(bloqueios.fonte, "proprietario"), lt(bloqueios.inicio, fim), gt(bloqueios.fim, de)))
        : Promise.resolve([]),
      // Estadias confirmadas nos imóveis do relatório, independentemente de em que livro está o dinheiro: a estadia que
      // atravessa a troca de dono fica no livro do dono antigo, mas as noites depois da troca são do dono novo.
      imovelIds.length
        ? db
            .select({ imovelId: reservas.imovelId, checkin: reservas.checkin, checkout: reservas.checkout, valorBruto: reservas.valorBruto })
            .from(reservas)
            .where(and(eq(reservas.organizacaoId, organizacaoId), eq(reservas.estado, "confirmada"), inArray(reservas.imovelId, imovelIds), lt(reservas.checkin, fim), gt(reservas.checkout, de)))
        : Promise.resolve([]),
    ]);
    const posse = (imovelId: string) => posseDe.get(imovelId) ?? [{ desde: null, ate: null }];
    const bloqueiosNaPosse = bloqueiosDoDono.flatMap((b) => trechosNaPosse(b.inicio, b.fim, posse(b.imovelId)).map((t) => ({ imovelId: b.imovelId, ...t })));
    // Ocupação e diária média são fatos do imóvel: toda estadia confirmada (cancelada ou pendente com valor no livro não
    // ocupa noite), recortada à posse de cada dono (o mesmo recorte dos bloqueios) e ao período — a estadia que atravessa
    // a troca de dono conta, para cada um, as noites em que o imóvel era dele, e ninguém passa de 100%. O bruto da diária
    // é o valor da reserva rateado igual por noite (a mesma conta do livro), só das noites contadas — na posse, no
    // período e fora das bloqueadas para uso próprio, a mesma régua das noites ocupadas; no mês parcial, só até o dia
    // (uma estadia futura já confirmada não entra nem no bruto nem nas noites). O dinheiro do resultado segue o livro,
    // que não é recortado.
    type Estadia = (typeof estadias)[number];
    const estadiasNaPosse = (r: Estadia) => trechosNaPosse(r.checkin, r.checkout, posse(r.imovelId)).map((t) => ({ imovelId: r.imovelId, checkin: t.inicio, checkout: t.fim }));
    const noitesContadas = (r: Estadia, ate: string) => noitesOcupadasNoIntervalo(estadiasNaPosse(r), bloqueiosNaPosse, de, ate);
    const brutoNaPosse = (r: Estadia, ate: string) => {
      const total = noitesNoIntervalo(r.checkin, r.checkout, r.checkin, r.checkout);
      const noites = noitesContadas(r, ate);
      return total > 0 && noites > 0 ? ratear(r.valorBruto ?? 0, [noites, total - noites])[0] : 0;
    };
    const noitesAte = (r: { checkin: string; checkout: string }) => noitesNoIntervalo(r.checkin, r.checkout, de, fimConsiderado);
    // Mês parcial: o resultado também vai só até o dia — a parte de cada reserva confirmada proporcional às noites já
    // passadas, mais o que não é reserva (ajustes) e menos as despesas com data até o dia — para a barra do mês corrente
    // e o acumulado ficarem no mesmo intervalo dos outros números. Mês inteiro: o livro.
    const fracaoAte = (r: (typeof lista)[number]) => {
      const noMes = noitesNoIntervalo(r.checkin, r.checkout, de, fim);
      return r.confirmada && noMes > 0 ? noitesAte(r) / noMes : 1;
    };
    const resultadoAte = resumoAte ? resumoAte.suaParte - lista.reduce((s, r) => s + r.suaParte, 0) + lista.reduce((s, r) => s + Math.round(r.suaParte * fracaoAte(r)), 0) - resumoAte.despesas : null;
    return {
      mes: m,
      resultado: resultadoAte ?? resumo.suaParte - resumo.despesas,
      bruto: estadias.reduce((s, r) => s + brutoNaPosse(r, fimConsiderado), 0),
      // Cada noite de cada imóvel conta uma vez (overbooking não passa de 100%) e noite bloqueada para uso próprio não conta.
      noitesOcupadas: noitesOcupadasNoIntervalo(estadias.flatMap(estadiasNaPosse), bloqueiosNaPosse, de, fimConsiderado),
      // Estadias com ao menos uma noite dentro da posse e do período (a mesma régua das noites ocupadas).
      reservas: estadias.filter((r) => noitesContadas(r, fimConsiderado) > 0).length,
      noitesDoPeriodo: ate ? Number(ate.slice(8, 10)) : diasDoMes(m),
      imoveis: imovelIds.length,
      diasImovel: diasDeImovel(imovelIds.flatMap(posse), de, fimConsiderado),
      noitesBloqueadas: noitesBloqueadas(bloqueiosNaPosse, de, fimConsiderado),
    };
  };
  const ate = o.parcial ? o.hoje : null;
  const atual = await dadosDoMes(o.mes, ate);
  const anteriorMes = somarMeses(o.mes, -1);
  const anoAnteriorMes = somarMeses(o.mes, -12);
  const [anterior, anoAnterior] = await Promise.all([temDado(anteriorMes) ? dadosDoMes(anteriorMes, null) : null, temDado(anoAnteriorMes) ? dadosDoMes(anoAnteriorMes, null) : null]);
  // Os 12 meses da série (M5.8: resultado, ocupação e diária média por mês), reaproveitando os já calculados.
  const demais = new Map(await Promise.all(meses.filter((m) => m !== o.mes && m !== anteriorMes && temDado(m)).map(async (m) => [m, await dadosDoMes(m, null)] as const)));
  const serie: [MesISO, DadosDoMes | null][] = meses.map((m) => [m, m === o.mes ? atual : m === anteriorMes ? anterior : (demais.get(m) ?? null)]);
  return { atual, anterior, anoAnterior, meses: serie, parcialAte: ate ? Number(ate.slice(8, 10)) : null };
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
