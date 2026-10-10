/**
 * Dados do painel inicial (M4.6), já filtrados pelo filtro global (imóveis + período). Cada
 * bloco vem da mesma função que alimenta a tela específica (reservas, despesas, ajustes…).
 */
import { and, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, not, or, sql, sum } from "drizzle-orm";
import { listarAdiantamentos, totalACobrar } from "@/adiantamentos/adiantamentos";
import { listarAjustes } from "@/ajustes/ajustes";
import { lancamentos, reservas as reservasTabela, type TipoLancamento } from "@/db/schema";
import type { Db } from "@/db/types";
import { listarDespesas, totaisDespesas } from "@/despesas/despesas";
import { totaisPorTipo } from "@/financeiro/ledger";
import { reservaCalculadaPeloMotor } from "@/financeiro/motor";
import { lancamentoDeConferenciaResolvida, reservaCalculadaSql, reservasQueContam } from "@/portal/posse";
import type { Imovel } from "@/imoveis/repositorio";
import { ESPERA_TELA_MS, esperarNoMaximo } from "@/lib/prazo";
import { contarPendentes as contarCadastrosPendentes } from "@/marketplace/cadastro";
import { contaDeTesteConfirmada, estadoPagamentoDoAmbiente, provedorDoAmbiente } from "@/pagamentos/ambiente";
import { avisosDePagamento } from "@/pagamentos/consultas";
import type { ProvedorPagamento } from "@/pagamentos/provedor";
import { contarPedidosNovos } from "@/proprietarios/pedidos-contato";
import { avisosDeDescontos } from "@/repasses/descontos";
import { conflitos } from "@/reservas/regras";
import { listarBloqueios, listarReservas, type Reserva } from "@/reservas/repositorio";
import { rotinasPendentes } from "@/rotinas/rotinas";
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

/**
 * A conta das chaves do Mercado Pago, para o aviso do Início, sem segurar a página: a mesma conferência de
 * Integrações e das travas (lembrada por alguns minutos), esperada no máximo `esperaMs`; passou disso, ou fora do
 * ambiente de teste, null (o aviso não aparece — Integrações mostra a situação completa).
 */
export async function contaDeTesteParaInicio(o: { env?: NodeJS.ProcessEnv; provedor?: ProvedorPagamento; esperaMs?: number } = {}): Promise<boolean | null> {
  const env = o.env ?? process.env;
  const provedor = o.provedor ?? (estadoPagamentoDoAmbiente(env).situacao === "teste" ? provedorDoAmbiente(env) : null);
  if (!provedor) return null;
  return esperarNoMaximo(contaDeTesteConfirmada(provedor), o.esperaMs ?? ESPERA_TELA_MS, null);
}

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
    /** Quem vê rotinas recebe o aviso das atrasadas ou que vencem hoje. */
    verRotinas?: boolean;
    /** Quem trata proprietários recebe o aviso dos pedidos de contato e dos cadastros vindos do site. */
    verProprietarios?: boolean;
    /** Quem lê o financeiro recebe os avisos do pagamento no site (M8.2a), da empresa toda. */
    verPagamentos?: boolean;
    /** Conta das chaves do Mercado Pago conferida agora (true/false); null ou ausente = não conferida (sem esse aviso). */
    contaDeTesteMercadoPago?: boolean | null;
    agora?: Date;
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
  // Só confirmadas, como no portal e no relatório (pendente ainda não é venda); divergente pelo livro.
  const contam = vazio ? [] : await reservasQueContam(db, organizacaoId, { imovelIds: ids, periodo: o.periodo });
  const semana = somaDias(o.hoje, 7);
  const porId = new Map(o.imoveis.map((i) => [i.id, i]));
  const ocupacao = calcularOcupacao(
    ids,
    reservas.map((r) => ({ imovelId: r.imovelId, inicio: r.checkin, fim: r.checkout })),
    bloqueios.map((b) => ({ imovelId: b.imovelId, inicio: b.inicio, fim: b.fim })),
    o.periodo,
  )
    .map((x) => ({ ...x, codigo: porId.get(x.imovelId)!.codigo, nome: porId.get(x.imovelId)!.nome }))
    // Imóvel arquivado só aparece (e conta na ocupação) se teve reserva no período.
    .filter((x) => porId.get(x.imovelId)!.ativo !== false || x.vendidas > 0);

  const alertas: Alerta[] = [];
  const sobrepostas = new Set(conflitos(reservas).flat()).size;
  if (sobrepostas) alertas.push({ nivel: "atencao", texto: `${sobrepostas} reserva(s) sobreposta(s) no mesmo imóvel (possível overbooking).`, link: "/painel/reservas" });
  // Rotinas são da organização (não dependem do filtro de imóveis).
  const rotinas = o.verRotinas ? await rotinasPendentes(db, organizacaoId, o.hoje) : 0;
  if (rotinas) alertas.push({ nivel: "atencao", texto: `${rotinas} rotina(s) atrasada(s) ou para hoje.`, link: "/painel/rotinas" });
  // Pedidos do site (M7.7, M12.3) também são da organização, não dos imóveis filtrados.
  if (o.verProprietarios) {
    const [contatos, cadastros] = await Promise.all([contarPedidosNovos(db, organizacaoId), contarCadastrosPendentes(db, organizacaoId)]);
    if (contatos) alertas.push({ nivel: "info", texto: `${contatos} pedido(s) de contato de proprietário esperando resposta.`, link: "/painel/proprietarios/contatos" });
    if (cadastros) alertas.push({ nivel: "info", texto: `${cadastros} cadastro(s) de proprietário pelo site esperando análise.`, link: "/painel/proprietarios/cadastros" });
  }
  // Pagamento no site (M8.2a): da empresa toda, sem depender do filtro de imóveis (aprovado sem reserva, devoluções,
  // liberação vencida, configuração e conta do Mercado Pago, live_mode, dinheiro sem cálculo, datas a fechar nas OTAs).
  if (o.verPagamentos) {
    const pagamentos = await avisosDePagamento(db, organizacaoId, o.agora ?? new Date(), { contaDeTeste: o.contaDeTesteMercadoPago ?? null });
    alertas.push(...pagamentos.alertas);
    // M8.2c: desconto de cancelamento (parte já repassada que voltou ao hóspede) que as partes disponíveis não cobriram.
    alertas.push(...(await avisosDeDescontos(db, organizacaoId, o.agora ?? new Date())));
  }

  let financeiro: Financeiro | null = null;
  let porMes: Dashboard["porMes"] = null;
  // "Todos" roda mesmo sem imóvel ativo: despesas gerais e imóveis arquivados continuam contando.
  if (o.verFinanceiro && (!vazio || o.todos)) {
    // "Todos os imóveis" inclui o que não é de imóvel nenhum (custos gerais da empresa).
    const f = o.todos ? o.periodo : { ...o.periodo, imovelIds: ids };
    const inicioAno = `${o.ano}-01-01`;
    const fimAno = `${o.ano + 1}-01-01`;
    // Em "todos", a conferência de cálculo olha também reservas de imóveis arquivados (como os totais).
    const doPeriodo = o.todos ? await listarReservas(db, organizacaoId, o.periodo) : reservas;
    // Pendente não é calculada até confirmar (M4.8): não entra no aviso de "sem cálculo". A cancelada com valor retido
    // pela política (M8.2c) é calculada como uma confirmada: entra (a lista do período não traz canceladas).
    const retidas = await db
      .select()
      .from(reservasTabela)
      .where(
        and(
          eq(reservasTabela.organizacaoId, organizacaoId),
          eq(reservasTabela.estado, "cancelada"),
          gt(reservasTabela.valorRetido, 0),
          lt(reservasTabela.checkin, o.periodo.fim),
          gt(reservasTabela.checkout, o.periodo.inicio),
          o.todos ? undefined : inArray(reservasTabela.imovelId, ids),
        ),
      );
    const comValor = [...doPeriodo, ...retidas].filter((r) => reservaCalculadaPeloMotor(r) && (r.valorBruto !== null || r.estado === "cancelada"));
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
      // Mesmo recorte (período e imóveis) da tela Despesas, para onde o alerta leva.
      listarDespesas(db, organizacaoId, o.todos ? o.periodo : { ...o.periodo, imovelIds: ids }),
      listarAjustes(db, organizacaoId, { pendentes: true }),
      listarAdiantamentos(db, organizacaoId, o.todos ? { somenteAbertos: true } : { imovelIds: ids, somenteAbertos: true }),
      db
        .select({ imovelId: lancamentos.imovelId, n: sql<number>`count(*)::int` })
        .from(lancamentos)
        .where(
          and(
            eq(lancamentos.organizacaoId, organizacaoId),
            eq(lancamentos.estado, "pendente"),
            // Reserva com a conferência dada por resolvida: a decisão vale para os pendentes dela.
            sql`not ${lancamentoDeConferenciaResolvida()}`,
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
    // Imóvel arquivado não aparece em Reservas nem em Sistema: o alerta diz qual é e como chegar lá.
    const notaArquivados = (imovelIds: (string | null)[]) => {
      const codigos = [...new Set(imovelIds.filter((i): i is string => Boolean(i) && porId.get(i!)?.ativo === false).map((i) => porId.get(i)!.codigo))];
      return codigos.length ? ` Inclui imóvel arquivado (${codigos.join(", ")}): reative-o em Imóveis para ver e corrigir.` : "";
    };
    const semValorLista = doPeriodo.filter((r) => r.valorBruto === null);
    if (semValorLista.length)
      alertas.push({
        nivel: "atencao",
        texto: `${semValorLista.length} reserva(s) do período sem valor: financeiro pendente.${notaArquivados(semValorLista.map((r) => r.imovelId))}`,
        link: "/painel/reservas",
      });
    const comLancamento = new Set(calculadas.map((x) => x.reservaId));
    const semCalculo = comValor.filter((r) => !comLancamento.has(r.id));
    if (semCalculo.length)
      alertas.push({
        nivel: "atencao",
        texto: `${semCalculo.length} reserva(s) do período com valor mas sem cálculo no financeiro: confira o contrato na data da entrada.${notaArquivados(semCalculo.map((r) => r.imovelId))}`,
        link: "/painel/reservas",
      });
    // Reserva que o motor não calcula mais (pendente, cancelada sem valor retido) e ainda tem lançamento do motor em
    // vigor no período: já movimentou dinheiro (o recálculo não mexe nisso) e fica em conferência.
    const comDinheiro = await db
      .selectDistinct({ reservaId: lancamentos.reservaId })
      .from(lancamentos)
      .innerJoin(reservasTabela, eq(reservasTabela.id, lancamentos.reservaId))
      .where(
        and(
          eq(lancamentos.organizacaoId, organizacaoId),
          or(not(reservaCalculadaSql()), isNotNull(reservasTabela.divergenciaEm)),
          isNull(reservasTabela.conferenciaResolvidaEm),
          eq(lancamentos.origem, "motor"),
          gte(lancamentos.competencia, o.periodo.inicio),
          lt(lancamentos.competencia, o.periodo.fim),
          o.todos ? undefined : inArray(lancamentos.imovelId, ids),
          isNull(lancamentos.estornoDe),
          sql`not exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`,
        ),
      );
    if (comDinheiro.length)
      alertas.push({
        nivel: "atencao",
        texto: `${comDinheiro.length} reserva(s) pendente(s) ou cancelada(s) com dinheiro já movimentado: os valores continuam no financeiro, em conferência. Confirme a reserva, ou faça o ajuste manual e dê a conferência por resolvida na reserva.`,
        link: "/painel/reservas",
      });
    const codigoDe = new Map(regras.map((r) => [r.imovelId, r.codigo]));
    const nPendentes = pendentes.reduce((t, x) => t + x.n, 0);
    if (nPendentes) {
      const codigos = [...new Set(pendentes.map((x) => (x.imovelId ? (porId.get(x.imovelId)?.codigo ?? codigoDe.get(x.imovelId)) : null)).filter(Boolean))];
      alertas.push({
        nivel: "info",
        texto: `${nPendentes} lançamento(s) com acerto pendente${codigos.length ? ` (${codigos.join(", ")})` : ""}: falta proprietário ou confirmar quem recebe do canal.${notaArquivados(pendentes.map((x) => x.imovelId))}`,
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
    if (aPagar) alertas.push({ nivel: "info", texto: `Despesas do período ainda a pagar: ${(aPagar / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`, link: "/painel/despesas" });
  }

  return {
    ocupacao,
    ocupacaoTotal: ocupacaoTotal(ocupacao),
    reservasNoPeriodo: contam.length,
    proximasEntradas: proximas.filter((r) => r.checkin >= o.hoje && r.checkin < semana),
    proximasSaidas: proximas.filter((r) => r.checkout >= o.hoje && r.checkout < semana).sort((x, y) => x.checkout.localeCompare(y.checkout)),
    financeiro,
    porMes,
    alertas,
  };
}
