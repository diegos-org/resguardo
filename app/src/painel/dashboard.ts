/**
 * Dados do painel inicial (M4.6), já filtrados pelo filtro global (imóveis + período). Cada
 * bloco vem da mesma função que alimenta a tela específica (reservas, despesas, ajustes…).
 */
import { and, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, not, or, sql, sum } from "drizzle-orm";
import { listarAdiantamentos, totalACobrar } from "@/adiantamentos/adiantamentos";
import { listarAjustes } from "@/ajustes/ajustes";
import { lerConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import { alteracoesReserva, contestacoesPagamento, lancamentos, pagamentos as pagamentosTabela, reservas as reservasTabela, type TipoLancamento } from "@/db/schema";
import type { Db } from "@/db/types";
import { listarDespesas, totaisDespesas } from "@/despesas/despesas";
import { totaisPorTipo } from "@/financeiro/ledger";
import { reservaCalculadaPeloMotor } from "@/financeiro/motor";
import { lancamentoDeConferenciaResolvida, reservaCalculadaSql, reservasQueContam } from "@/portal/posse";
import type { Imovel } from "@/imoveis/repositorio";
import { ESPERA_TELA_MS, esperarNoMaximo } from "@/lib/prazo";
import { contarPendentes as contarCadastrosPendentes } from "@/marketplace/cadastro";
import { contaDeTesteConfirmada, estadoPagamentoDoAmbiente, provedorDoAmbiente } from "@/pagamentos/ambiente";
import { alteracoesComMensagemPendente } from "@/mensagens/hospede";
import { situacaoEfetiva } from "@/pagamentos/alteracao-regras";
import { ATENCAO_AVISAR_HOSPEDE_HORAS, avisosDeCancelamento, avisosDePagamento } from "@/pagamentos/consultas";
import { carenciaNoTravado } from "@/pagamentos/travas";
import type { ProvedorPagamento } from "@/pagamentos/provedor";
import { contarPedidosNovos } from "@/proprietarios/pedidos-contato";
import {
  type AvisoDeContestacao,
  DIAS_ESCALADA_CONTESTACAO,
  linhaSemDecisao,
  textoDisputaComEstadiaPorVir,
  textoEscaladaDaDisputa,
} from "@/pagamentos/contestacao-regras";
import { prazoDosDocumentos } from "@/pagamentos/contestacao-tela";
import { avisosDeContestacaoNosRepasses } from "@/repasses/avisos-contestacao";
import { avisosDeDescontos } from "@/repasses/descontos";
import { partesDoProprietario } from "@/repasses/extrato";
import { hojeISO } from "@/lib/datas";
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
    /**
     * Quem edita reservas recebe os avisos do cancelamento pela política (M8.2c: pedidos esperando, datas a reabrir nas
     * OTAs, hóspede a avisar), da empresa toda e sem valores — mesmo sem acesso ao financeiro.
     */
    verCancelamentos?: boolean;
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
  // Cancelamento pela política (M8.2c): da operação, fora dos avisos do financeiro e sem valores.
  // A mensagem pendente ao hóspede (decisão, devolução feita) leva o valor: o aviso dela só para quem lê o financeiro.
  if (o.verCancelamentos) alertas.push(...(await avisosDeCancelamento(db, organizacaoId, o.agora ?? new Date(), { mensagensComValor: o.verPagamentos === true })));
  // Alteração de reserva paga pelo site (M8.2d): as mesmas pessoas e a mesma regra das mensagens com valor.
  if (o.verCancelamentos) alertas.push(...(await avisosDeAlteracao(db, organizacaoId, o.agora ?? new Date(), { mensagensComValor: o.verPagamentos === true })));
  // Pagamento no site (M8.2a): da empresa toda, sem depender do filtro de imóveis (aprovado sem reserva, devoluções,
  // liberação vencida, configuração e conta do Mercado Pago, live_mode, dinheiro sem cálculo, datas a fechar nas OTAs).
  if (o.verPagamentos) {
    const pagamentos = await avisosDePagamento(db, organizacaoId, o.agora ?? new Date(), { contaDeTeste: o.contaDeTesteMercadoPago ?? null });
    alertas.push(...pagamentos.alertas);
    // M8.2c: desconto de cancelamento (parte já repassada que voltou ao hóspede) que as partes disponíveis não cobriram.
    alertas.push(...(await avisosDeDescontos(db, organizacaoId, o.agora ?? new Date())));
    // M8.2e: a disputa do pagamento (decisão, documentos, resultado, escalada, estadia por vir, os avisos de cada linha) e,
    // nos repasses, o repasse a pagar com parte em disputa e o valor segurado ainda não descontado.
    alertas.push(...(await avisosDeContestacao(db, organizacaoId, o.agora ?? new Date())));
    alertas.push(...(await avisosDeContestacaoNosRepasses(db, organizacaoId, o.agora ?? new Date())));
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

// ---------------------------------------------------------------- alteração de reserva paga pelo site (M8.2d)

const horaSP = (d: Date, agora: Date) => {
  const f = (x: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", ...o }).format(x);
  const hora = f(d, { hour: "2-digit", minute: "2-digit" });
  return f(d, { day: "2-digit", month: "2-digit" }) === f(agora, { day: "2-digit", month: "2-digit" }) ? hora : `${f(d, { day: "2-digit", month: "2-digit" })} às ${hora}`;
};
/** Os códigos das reservas do aviso (até 5; o resto em número): quem lê sabe qual abrir. */
const codigosDoAviso = (xs: readonly { codigo: string }[]) => (xs.length <= 5 ? xs.map((x) => x.codigo).join(", ") : `${xs.slice(0, 5).map((x) => x.codigo).join(", ")} e mais ${xs.length - 5}`);
const linkDoAviso = (xs: readonly { reservaId: string }[]) => (xs.length === 1 ? `/painel/reservas/${xs[0].reservaId}` : "/painel/reservas");

/**
 * Os avisos da alteração de reserva paga pelo site no Início (da operação: quem edita reservas, sem valores, da empresa
 * toda): cada alteração com as datas seguradas agora (pela situação que vale agora, com a carência do pagamento), as
 * reservas alteradas cujo bloqueio nas OTAs ainda não foi mudado (o envio ao Beds24 não muda datas de reservas), e as
 * mensagens ao hóspede pendentes (a proposta e a devolução feita levam valor: só para quem lê o financeiro).
 */
export async function avisosDeAlteracao(db: Db, organizacaoId: string, agora: Date = new Date(), o: { mensagensComValor?: boolean } = {}): Promise<Alerta[]> {
  const hoje = hojeISO("America/Sao_Paulo", agora);
  const alertas: Alerta[] = [];
  const seguradas = await db
    .select({ a: alteracoesReserva, codigo: reservasTabela.codigo })
    .from(alteracoesReserva)
    .innerJoin(reservasTabela, eq(reservasTabela.id, alteracoesReserva.reservaId))
    .where(and(eq(alteracoesReserva.organizacaoId, organizacaoId), eq(alteracoesReserva.situacao, "segurada")))
    .orderBy(reservasTabela.codigo);
  const tentativas = seguradas.length
    ? await db
        .select()
        .from(pagamentosTabela)
        .where(and(eq(pagamentosTabela.organizacaoId, organizacaoId), inArray(pagamentosTabela.alteracaoId, seguradas.map((x) => x.a.id))))
    : [];
  const carencia = carenciaNoTravado({ tentativas }, agora);
  for (const { a, codigo } of seguradas) {
    if (situacaoEfetiva(a, agora, carencia(a)) !== "segurada" || !a.holdAte) continue;
    const prazo = a.holdAte.getTime() > agora.getTime() ? `datas seguradas até ${horaSP(a.holdAte, agora)}` : "prazo das datas acabou, com um pagamento da diferença em andamento";
    alertas.push({
      nivel: "info",
      texto: `Alteração da reserva ${codigo}: ${prazo}, esperando ${a.diferenca > 0 ? "o pagamento da diferença" : "a confirmação do hóspede"}.`,
      link: `/painel/reservas/${a.reservaId}`,
    });
  }
  // Aplicada e o bloqueio nas OTAs ainda não mudado (o M8.3 vai gravar sozinho; até lá, à mão), com alguma noite (de antes
  // ou de agora) ainda por vir. A reserva-pedido das datas seguradas nunca vai às OTAs. Só a que mudou as datas: as pessoas
  // ou o valor não mexem no bloqueio.
  const otas = await db
    .select({ reservaId: alteracoesReserva.reservaId, codigo: reservasTabela.codigo })
    .from(alteracoesReserva)
    .innerJoin(reservasTabela, eq(reservasTabela.id, alteracoesReserva.reservaId))
    .where(
      and(
        eq(alteracoesReserva.organizacaoId, organizacaoId),
        eq(alteracoesReserva.situacao, "aplicada"),
        isNull(alteracoesReserva.otaAtualizadaEm),
        or(ne(alteracoesReserva.checkinAntes, alteracoesReserva.checkinDepois), ne(alteracoesReserva.checkoutAntes, alteracoesReserva.checkoutDepois)),
        eq(reservasTabela.estado, "confirmada"),
        sql`greatest(${alteracoesReserva.checkoutAntes}, ${alteracoesReserva.checkoutDepois}) >= ${hoje}::date`,
      ),
    )
    .orderBy(reservasTabela.codigo);
  const alteradas = [...new Map(otas.map((x) => [x.reservaId, x])).values()];
  // Sempre, mesmo com o envio ao Beds24 ligado: o envio fecha só os bloqueios do SCL, nunca as datas das reservas (até o M8.3).
  if (alteradas.length)
    alertas.push({
      nivel: "info",
      texto: `${alteradas.length} reserva(s) do site alterada(s) (${codigosDoAviso(alteradas)}): mude o bloqueio nas OTAs (no Beds24, feche as novas datas e reabra as antigas).`,
      link: linkDoAviso(alteradas),
    });
  // A proposta leva a diferença e a devolução feita leva o valor: só quem as pode copiar (quem lê o financeiro) recebe o aviso.
  if (o.mensagensComValor === false) return alertas;
  const pendentes = await alteracoesComMensagemPendente(db, organizacaoId, agora);
  if (pendentes.length) {
    const atrasada = pendentes.some((x) => agora.getTime() - x.desde.getTime() >= ATENCAO_AVISAR_HOSPEDE_HORAS * 3_600_000);
    alertas.push({
      nivel: atrasada ? "atencao" : "info",
      texto: `${pendentes.length} alteração(ões) com mensagem ao hóspede pendente (proposta, confirmação ou devolução feita): avise o hóspede (${codigosDoAviso(pendentes)}).`,
      link: linkDoAviso(pendentes),
    });
  }
  return alertas;
}

// ---------------------------------------------------------------- disputa do pagamento (M8.2e)

const LINK_PAGAMENTOS_SITE = "/painel/financeiro/pagamentos-site";
const LINK_DISPUTAS = `${LINK_PAGAMENTOS_SITE}?disputa=1`;
const DIA_MS = 86_400_000;

/**
 * A disputa ambígua (`contestacao_ambigua`) mora só no pagamento (a leitura a tira das linhas, e no caso típico — uma
 * disputa encerrada que o sistema não conhecia — nem há linha): conta pelos pagamentos da empresa.
 */
const textoDaAmbiguaNoInicio = (n: number) => `${n} disputa(s) do pagamento que o sistema não conseguiu casar com as do quadro: confira no painel do Mercado Pago e registre pelo quadro.`;

/** Os avisos de cada linha que pedem a equipe no Início (atenção), com o texto curto da contagem. */
const AVISOS_DA_LINHA_NO_INICIO: Partial<Record<AvisoDeContestacao, (n: number) => string>> = {
  contestacao_possivel_duplicata: (n) => `${n} disputa(s) do pagamento possivelmente duplicada(s): confirme no quadro se é outra disputa (ou encerre sem efeito).`,
  contestacao_caso_de_outro_pagamento: (n) => `${n} disputa(s) com o número do caso de outro pagamento no Mercado Pago: confira no quadro.`,
  contestacao_resultado_mudou: (n) => `${n} disputa(s) encerrada(s) que o Mercado Pago voltou a mostrar de outro jeito: use "Conferir o aviso" no quadro.`,
  contestacao_leitura_conflitante: (n) => `${n} disputa(s) com leituras do Mercado Pago em conflito: confira no painel dele e confirme o resultado.`,
  contestacao_ganha_sem_recebimento: (n) => `${n} disputa(s) ganha(s) sem o recebimento do pagamento no financeiro: registre a liberação à mão quando o dinheiro cair.`,
  contestacao_sem_fonte: (n) => `${n} disputa(s) depois dos 85 dias sem de onde o sistema ler: confira o resultado no painel do Mercado Pago e confirme no quadro.`,
  contestacao_fora_do_prazo: (n) => `${n} disputa(s) aberta(s) há mais de 240 dias: confira o resultado no painel do Mercado Pago e confirme no quadro.`,
  contestacao_sem_leitura: (n) => `${n} disputa(s) que esta conta não consegue ler no Mercado Pago: acompanhe pelo painel dele.`,
};

/**
 * Os avisos da disputa do pagamento no Início (M8.2e; desenho "Painel", "Início"; quem lê o financeiro, da empresa toda):
 * - as disputas sem decisão de quem arca (a parte do proprietário espera) e a escalada depois de 15 dias (quanto da parte
 *   está preso e por quanto tempo);
 * - o prazo dos documentos de cada disputa ainda não final sem a marca (atenção dentro dos dias do aviso, antes informativo;
 *   o prazo que passou e o prazo desconhecido, atenção);
 * - as encerradas no Mercado Pago com resultado a conferir, as perdidas sem decisão de quem arca;
 * - a estadia por vir com disputa em curso ("não libere a entrada…");
 * - os avisos de cada linha (possível duplicata, caso de outro pagamento, resultado que mudou, leituras em conflito, ganha
 *   sem recebimento, dia 85 sem fonte, mais de 240 dias, sem leitura);
 * - a disputa ambígua, pelos avisos do pagamento (com ou sem linha no quadro).
 * Nada daqui é lançamento `pendente`: o contador de pendentes do Início não conta a disputa (C3).
 */
export async function avisosDeContestacao(db: Db, organizacaoId: string, agora: Date = new Date()): Promise<Alerta[]> {
  const ambiguas = await db
    .select({ reservaId: pagamentosTabela.reservaId })
    .from(pagamentosTabela)
    .where(and(eq(pagamentosTabela.organizacaoId, organizacaoId), sql`${pagamentosTabela.avisos} @> '["contestacao_ambigua"]'::jsonb`));
  const daAmbigua: Alerta[] = ambiguas.length
    ? [{ nivel: "atencao", texto: textoDaAmbiguaNoInicio(ambiguas.length), link: ambiguas.length === 1 && ambiguas[0].reservaId ? `/painel/reservas/${ambiguas[0].reservaId}` : `${LINK_PAGAMENTOS_SITE}?atencao=1` }]
    : [];
  const linhas = await db
    .select({
      l: contestacoesPagamento,
      desfecho: pagamentosTabela.desfecho,
      pagamentoReservaId: pagamentosTabela.reservaId,
      codigo: reservasTabela.codigo,
      estado: reservasTabela.estado,
      checkin: reservasTabela.checkin,
    })
    .from(contestacoesPagamento)
    .innerJoin(pagamentosTabela, eq(pagamentosTabela.id, contestacoesPagamento.pagamentoId))
    .leftJoin(reservasTabela, eq(reservasTabela.id, contestacoesPagamento.reservaId))
    .where(eq(contestacoesPagamento.organizacaoId, organizacaoId));
  if (!linhas.length) return daAmbigua;
  const { diasAvisoDocumentacao } = await lerConfigPagamentoSite(db, organizacaoId);
  const hoje = hojeISO("America/Sao_Paulo", agora);
  const alertas: Alerta[] = [];
  const naoFinal = (x: (typeof linhas)[number]) => x.l.situacao === "aberta" || x.l.situacao === "a_confirmar";
  const linkDe = (xs: readonly (typeof linhas)[number][]) => (xs.length === 1 ? `/painel/reservas/${xs[0].pagamentoReservaId}` : LINK_DISPUTAS);
  const qual = (x: (typeof linhas)[number]) => (x.l.reservaId && x.codigo ? `da reserva ${x.codigo}` : "do pagamento do site sem reserva");
  // A perdida sem decisão com perda a dividir (com nada a dividir, o domínio já marcou os definitivos: `definitivo_em`).
  const perdidas = linhas.filter((x) => x.l.situacao === "perdida" && x.l.decisaoVersao === 0 && x.l.definitivoEm === null);
  // A aberta ou a confirmar sem decisão que segura a reserva (a regra única de `linhaSemDecisao`).
  const abertasSemDecisao = linhas.filter((x) => naoFinal(x) && linhaSemDecisao({ ...x.l, desfecho: x.desfecho, perdaADividir: null }));
  if (abertasSemDecisao.length)
    alertas.push({
      nivel: "atencao",
      texto: `${abertasSemDecisao.length} disputa(s) do pagamento sem decisão de quem arca: a parte do proprietário dessas reservas espera.`,
      link: linkDe(abertasSemDecisao),
    });
  // A escalada: a parte presa há mais de 15 dias (a que ainda não foi repassada e espera a decisão).
  for (const x of abertasSemDecisao) {
    const dias = Math.floor((agora.getTime() - x.l.abertaEm.getTime()) / DIA_MS);
    if (dias < DIAS_ESCALADA_CONTESTACAO || !x.l.reservaId || !x.codigo) continue;
    const presos = await presosPelaDisputa(db, organizacaoId, x.l.reservaId, agora);
    if (presos > 0)
      alertas.push({ nivel: "atencao", texto: textoEscaladaDaDisputa({ presos, dias, valorDaDisputa: x.l.valor ?? x.l.valorEmRisco, codigoReserva: x.codigo }), link: `/painel/reservas/${x.pagamentoReservaId}` });
  }
  if (perdidas.length)
    alertas.push({
      nivel: "atencao",
      texto: `${perdidas.length} disputa(s) perdida(s) sem decisão de quem arca: registre quem arca no quadro (a reserva continua em conferência).`,
      link: linkDe(perdidas),
    });
  const aConfirmar = linhas.filter((x) => x.l.situacao === "a_confirmar");
  if (aConfirmar.length) alertas.push({ nivel: "atencao", texto: `${aConfirmar.length} disputa(s) encerrada(s) no Mercado Pago com resultado a conferir.`, link: linkDe(aConfirmar) });
  // Os documentos da defesa: o prazo de cada disputa ainda não final, sem a marca "Documentos enviados".
  for (const x of linhas.filter((y) => naoFinal(y) && !y.l.documentosEnviadosEm && !y.l.duplicataPossivel)) {
    const prazo = prazoDosDocumentos(x.l, agora, diasAvisoDocumentacao);
    if (!prazo) continue;
    const link = `/painel/reservas/${x.pagamentoReservaId}`;
    if (!x.l.documentacaoPrazo) alertas.push({ nivel: "atencao", texto: `Disputa ${qual(x)}: prazo dos documentos desconhecido — confira no painel do Mercado Pago e informe no quadro.`, link });
    else {
      const p = hojeISO("America/Sao_Paulo", x.l.documentacaoPrazo);
      const faltam = Math.round((Date.parse(`${p}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / DIA_MS);
      const dataBr = `${p.slice(8, 10)}/${p.slice(5, 7)}`;
      alertas.push({
        nivel: prazo.nivel,
        texto: faltam < 0 ? `Disputa ${qual(x)}: o prazo dos documentos passou (${dataBr}) sem a marca "Documentos enviados".` : `Disputa ${qual(x)}: documentos até ${dataBr} (${faltam === 0 ? "hoje" : `faltam ${faltam} dia${faltam === 1 ? "" : "s"}`}).`,
        link,
      });
    }
  }
  // A estadia por vir com a disputa em curso: o titular não reconheceu o pagamento antes da entrada (pode ser fraude).
  for (const x of linhas.filter((y) => naoFinal(y) && !y.l.duplicataPossivel && y.estado === "confirmada" && !!y.checkin && y.checkin >= hoje && !!y.codigo))
    alertas.push({ nivel: "atencao", texto: textoDisputaComEstadiaPorVir(x.codigo!, x.checkin!), link: `/painel/reservas/${x.pagamentoReservaId}` });
  // Os avisos de cada linha (uma contagem por aviso).
  for (const [codigo, texto] of Object.entries(AVISOS_DA_LINHA_NO_INICIO) as [AvisoDeContestacao, (n: number) => string][]) {
    const com = linhas.filter((x) => x.l.avisos.includes(codigo));
    if (com.length) alertas.push({ nivel: "atencao", texto: texto(com.length), link: linkDe(com) });
  }
  return [...alertas, ...daAmbigua];
}

/** Quanto da parte do proprietário desta reserva está preso pela disputa sem decisão (a liberar, ainda não repassado). */
async function presosPelaDisputa(db: Db, organizacaoId: string, reservaId: string, agora: Date): Promise<number> {
  const donos = await db
    .selectDistinct({ id: lancamentos.proprietarioId })
    .from(lancamentos)
    .where(and(eq(lancamentos.organizacaoId, organizacaoId), eq(lancamentos.reservaId, reservaId), eq(lancamentos.tipo, "direito_proprietario"), eq(lancamentos.origem, "motor"), isNotNull(lancamentos.proprietarioId)));
  let total = 0;
  for (const d of donos) {
    if (!d.id) continue;
    const partes = await partesDoProprietario(db, organizacaoId, d.id, agora, { reservaIds: [reservaId] });
    total += partes.filter((x) => x.situacao === "a_liberar" && x.contestacaoSemDecisao && !x.disputa).reduce((s, x) => s + x.valor, 0);
  }
  return total;
}
