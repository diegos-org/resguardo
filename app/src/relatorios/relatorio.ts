/**
 * Relatório mensal do proprietário (M5.3; modelo oficial no M5.7): os mesmos números do portal (resumo, reservas,
 * rodapé, extrato do M4.10, pagamentos do M4.12), montados como os textos das quatro páginas do PDF. Nada é
 * recalculado aqui — uma regra, um lugar: o PDF, o portal e o painel leem as mesmas funções.
 */
import { and, asc, eq, gte, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { imoveis, lancamentos, proprietarioImoveis, proprietarios, representantes } from "@/db/schema";
import type { Db } from "@/db/types";
import { lancamentoEmVigor } from "@/portal/posse";
import { lerEmpresa, NOME_EMPRESA_INICIAL } from "@/configuracoes/empresa";
import { periodoDosFiltros } from "@/lib/filtros";
import { uuidValido } from "@/lib/ids";
import { formatBRL } from "@/lib/money";
import { nome as nomeDoPeriodo, type SituacaoPeriodo } from "@/portal/periodo";
import { type ReservaPortal, reservasDoPortal, type SituacaoReserva } from "@/portal/reservas";
import { type ResumoPortal, resumoDoProprietario } from "@/portal/resumo";
import { type Rodape, rodapeDoPortal } from "@/portal/rodape";
import { nomeMes, type Repasse } from "@/repasses/repasses";
import { type ContratoDoRelatorio, contratosDoRelatorio, type DespesaDoRelatorio, despesasDoRelatorio, type MetricasDoRelatorio, metricasDoRelatorio, partesDoRelatorio, type RepasseDoRelatorio, repassesDoRelatorio } from "./dados";
import { DIA_FECHAMENTO_PADRAO, diaDoFechamento } from "@/repasses/periodicidade";
import { lerRegrasRepasses } from "@/repasses/regras-config";
import { type AvisoDaLinha, comoChega, conciliacao, conciliacaoFecha, dataCurta, dataDoPix, type Linha, type LinhaConciliacao, nomeDoCanal, type ParteDoRelatorio, primeiroNome } from "./dinheiro";
import { acumuladoDoAno, mesISO, type MesISO, nomeDoMes, type PontoDaSerie, type PontoOcupacao, type Quadro, quadrosDoMes, serieDe12, serieOcupacaoDe12 } from "./metricas";

export type Dono = { id: string; nome: string };
export type ImovelDoRelatorio = { id: string; codigo: string; nome: string; bairro?: string; cidade?: string };

export type DadosRelatorio = {
  empresa: string;
  /** Dia do mês seguinte em que este mês fecha (M4.13, Configurações → Repasses). */
  diaFechamento: number;
  /** Contatos da empresa (site, e-mail, telefone) cadastrados em Configurações → Empresa. */
  contato: string[];
  /** Proprietários primeiro; depois os representantes autorizados a receber relatórios. */
  proprietarios: string[];
  representantes: string[];
  imoveis: ImovelDoRelatorio[];
  ano: number;
  mes: number;
  situacao: SituacaoPeriodo;
  /** Até que dia os números valem (mês atual); null no mês terminado ou futuro. */
  ate: string | null;
  /** A data de hoje (dia em São Paulo): pagamento do canal com data depois dela é previsto, não pago. */
  hoje: string;
  resumo: ResumoPortal;
  reservas: ReservaPortal[];
  rodape: Rodape[];
  /** M5.7: as partes do extrato (mês, anterior e seguinte; e as pagas no mês) com os componentes do livro e a data do pagamento. */
  partes: ParteDoRelatorio[];
  metricas: MetricasDoRelatorio;
  repasses: RepasseDoRelatorio[];
  /** O repasse de fechamento do mês de cada proprietário (em vigor), se já existe. */
  fechamentos: Repasse[];
  despesas: DespesaDoRelatorio[];
  contratos: ContratoDoRelatorio[];
};

/**
 * Imóveis do relatório de um proprietário (painel): os ligados a ele (com período: ligados antes do
 * fim dele) e, com um período, também
 * os que têm lançamento dele no livro nesse período — o imóvel que já passou para outro dono continua
 * no relatório dos meses em que foi dele (o vínculo atual é apagado na troca de dono).
 */
export async function imoveisDoProprietario(db: Db, organizacaoId: string, proprietarioId: string, periodo?: { inicio: string; fim: string }): Promise<ImovelDoRelatorio[]> {
  if (!uuidValido(proprietarioId)) return [];
  // Vínculo atual só conta a partir da data dele (dia em São Paulo), como na regra de posse do
  // portal: um imóvel ligado depois do mês pedido não entra no relatório daquele mês.
  const ligados = db
    .select({ id: proprietarioImoveis.imovelId })
    .from(proprietarioImoveis)
    .where(
      and(
        eq(proprietarioImoveis.proprietarioId, proprietarioId),
        periodo ? sql`(${proprietarioImoveis.criadoEm} at time zone 'America/Sao_Paulo')::date < ${periodo.fim}::date` : undefined,
      ),
    );
  const doLivro = periodo
    ? db
        .select({ id: lancamentos.imovelId })
        .from(lancamentos)
        .where(
          and(
            eq(lancamentos.organizacaoId, organizacaoId),
            eq(lancamentos.proprietarioId, proprietarioId),
            gte(lancamentos.competencia, periodo.inicio),
            lt(lancamentos.competencia, periodo.fim),
            isNotNull(lancamentos.imovelId),
            // Só lançamento em vigor: um estornado (ou o estorno) não prova de quem era o imóvel.
            lancamentoEmVigor(db),
          ),
        )
    : null;
  return db
    .select({ id: imoveis.id, codigo: imoveis.codigo, nome: imoveis.nome, bairro: imoveis.bairro, cidade: imoveis.cidade })
    .from(imoveis)
    .where(and(eq(imoveis.organizacaoId, organizacaoId), doLivro ? or(inArray(imoveis.id, ligados), inArray(imoveis.id, doLivro)) : inArray(imoveis.id, ligados)))
    .orderBy(asc(imoveis.codigo));
}

/** Todo o histórico: para listar na tela os imóveis que já foram dele. */
export const HISTORICO_TODO = { inicio: "2000-01-01", fim: "2101-01-01" } as const;

/** Proprietário da organização (painel), mesmo arquivado: o relatório final ou de meses passados continua possível. */
export async function donoDoRelatorio(db: Db, organizacaoId: string, proprietarioId: string): Promise<Dono | null> {
  if (!uuidValido(proprietarioId)) return null;
  const [p] = await db
    .select({ id: proprietarios.id, nome: proprietarios.nome })
    .from(proprietarios)
    .where(and(eq(proprietarios.id, proprietarioId), eq(proprietarios.organizacaoId, organizacaoId)));
  return p ?? null;
}

const iso = (ano: number, mes: number) => `${ano}-${String(mes).padStart(2, "0")}`;

/**
 * Dados do relatório de um mês. `imoveis` são os escolhidos; `todosOsImoveis` diz se são todos os
 * do proprietário (aí entram também os lançamentos dele sem imóvel, como no portal).
 */
export async function dadosDoRelatorio(
  db: Db,
  organizacaoId: string,
  o: { donos: readonly Dono[]; imoveis: readonly ImovelDoRelatorio[]; todosOsImoveis: boolean; ano: number; mes: number; hoje: string; agora?: Date },
): Promise<DadosRelatorio> {
  const donoIds = o.donos.map((d) => d.id);
  const imovelIds = o.imoveis.map((i) => i.id);
  const periodo = periodoDosFiltros({ imoveis: [], ano: o.ano, mes: o.mes });
  const mes = iso(o.ano, o.mes);
  const agora = o.agora ?? new Date();
  const empresa = await lerEmpresa(db, organizacaoId);
  const situacao: SituacaoPeriodo = o.hoje < periodo.inicio ? "futuro" : o.hoje >= periodo.fim ? "fechado" : "parcial";
  const [resumo, lista, rodape, reps, partes, metricas, repassesDoMes, despesas, contratos, regrasRepasses] = await Promise.all([
    resumoDoProprietario(db, organizacaoId, { proprietarioIds: donoIds, imovelIds, semImovel: o.todosOsImoveis, periodo }),
    reservasDoPortal(db, organizacaoId, { proprietarioIds: donoIds, imovelIds, periodo }),
    rodapeDoPortal(db, organizacaoId, { proprietarios: o.donos, mes, hoje: o.hoje, pixEmpresa: empresa.chavePix }),
    donoIds.filter(uuidValido).length
      ? db
          .select({ nome: representantes.nome })
          .from(representantes)
          .where(and(inArray(representantes.proprietarioId, donoIds.filter(uuidValido)), eq(representantes.recebeRelatorios, true)))
          .orderBy(asc(representantes.nome))
      : Promise.resolve([]),
    partesDoRelatorio(db, organizacaoId, { donos: o.donos, imovelIds, mes, agora }),
    metricasDoRelatorio(db, organizacaoId, { donos: o.donos, imovelIds, todosOsImoveis: o.todosOsImoveis, mes, hoje: o.hoje, parcial: situacao === "parcial" }),
    repassesDoRelatorio(db, organizacaoId, o.donos, mes),
    despesasDoRelatorio(db, organizacaoId, { donos: o.donos, imovelIds, todosOsImoveis: o.todosOsImoveis, mes }),
    contratosDoRelatorio(db, organizacaoId, imovelIds, mes),
    lerRegrasRepasses(db, organizacaoId),
  ]);
  return {
    empresa: empresa.nome || NOME_EMPRESA_INICIAL,
    diaFechamento: diaDoFechamento(regrasRepasses, mes),
    contato: [empresa.site, empresa.email, empresa.telefone].filter(Boolean),
    proprietarios: o.donos.map((d) => d.nome),
    representantes: reps.map((r) => r.nome),
    imoveis: [...o.imoveis],
    ano: o.ano,
    mes: o.mes,
    situacao,
    ate: situacao === "parcial" ? o.hoje : null,
    hoje: o.hoje,
    resumo,
    reservas: lista,
    rodape,
    partes,
    metricas,
    repasses: repassesDoMes.repasses,
    fechamentos: repassesDoMes.fechamentos,
    despesas,
    contratos,
  };
}

// ---------------------------------------------------------------------------
// Textos das páginas (puros, testados; o PDF só desenha).

export type LinhaValor = { texto: string; valor: string; tipo: "normal" | "sub" | "total" | "aviso" | "info"; etiqueta?: string };
export type LinhaReserva = {
  imovel: string;
  hospede: string;
  canal: string;
  codigo: string;
  situacao: string;
  situacaoTipo: "ok" | "info" | "aviso";
  datas: string;
  noites: string;
  bruto: string;
  taxa: string;
  gestao: string;
  suaParte: string;
  atravessa: boolean;
};
export type LinhaConciliacaoTexto = { rotulo: string; reservas: string; bruto: string; taxa: string; quemRecebeu: string; suaParte: string; tipo: LinhaConciliacao["tipo"] };

export type TextosRelatorio = {
  empresa: string;
  contato: string;
  /** A marca: o começo em branco e a última palavra em itálico dourado ("Sua Casa" + "Leblon"). */
  marca: { inicio: string; destaque: string };
  mes: MesISO;
  mesNome: string;
  olho: string;
  emissao: string;
  periodo: string;
  imovelTitulo: string;
  cabecalhoCurto: string;
  para: string;
  identidade: string;
  marketplace: boolean;
  mostrarImovel: boolean;
  aviso: string | null;
  destaque: { rotulo: string; valor: string; base: string };
  comoChega: { linhas: LinhaValor[]; quemPagaQuem: string | null };
  brutoAoResultado: LinhaValor[];
  avisos: string[];
  rodapeCapa: { comAnexos: string; semAnexos: string };
  quadros: Quadro[];
  grafico: { titulo: string; serie: PontoDaSerie[]; acumulado: string | null; legendaAtual: string };
  /** M5.8 (escolha de Diego em 5/10): ocupação por mês nos 12 meses, com a diária média sobre cada barra. */
  graficoOcupacao: { titulo: string; serie: PontoOcupacao[]; legendaAtual: string; nota: string };
  reservasTitulo: string;
  reservas: LinhaReserva[];
  totalReservas: LinhaReserva | null;
  notaReservas: string;
  conciliacaoIntro: string;
  conciliacao: LinhaConciliacaoTexto[];
  conciliacaoFecha: boolean;
  repasses: LinhaValor[];
  despesas: LinhaValor[];
  acerto: LinhaValor[];
  posicao: string;
  anexosIntro: string;
  anexosNota: string;
  /** Mantidos para o e-mail do fechamento e para quem lê o saldo em texto. */
  saldo: string[];
  emConferencia: string | null;
};

const SITUACAO_RESERVA: Record<SituacaoReserva, string> = { definido: "definido", em_conferencia: "em conferência", sem_calculo: "sem cálculo ainda" };
const br = (d: string) => d.split("-").reverse().join("/");
const ultimoDia = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);
const comoLinha = (l: Linha): LinhaValor => ({ texto: l.texto, valor: formatBRL(l.valor), tipo: l.tipo });

/** Frase do saldo com a empresa, a mesma leitura do rodapé do portal. */
export function textoDoSaldo(r: Rodape, empresa: string, diaFechamento: number = DIA_FECHAMENTO_PADRAO): string[] {
  const valor = formatBRL(r.valor);
  const descontos = r.descontado > 0 ? ` (já descontados ${formatBRL(r.descontado)} de despesas que a ${empresa} pagou por você)` : "";
  const pixDele = r.chavePix ? " para a sua chave Pix cadastrada." : `. Sua chave Pix não está cadastrada: fale com a ${empresa}.`;
  const depois: string[] = [];
  if (r.diferenca !== 0) {
    depois.push(
      `Depois do fechamento, o acerto deste mês mudou ${formatBRL(Math.abs(r.diferenca))} (${r.diferenca > 0 ? "a seu favor" : `a favor da ${empresa}`}): isso entra no próximo repasse.`,
    );
  }
  if (r.emConferencia) depois.push("Há itens deste mês em conferência, lançados depois do fechamento.");
  switch (r.situacao) {
    case "pago":
      return [`Repasse de ${valor} pago em ${br(r.dataPagamento!)}.`, ...depois];
    case "no_repasse_posterior":
      return [`O saldo deste mês já entrou no repasse de ${nomeMes(r.repassePosterior!)}.`, ...depois];
    case "fechado":
      return [`Mês fechado: a ${empresa} vai lhe transferir ${valor}${descontos}${pixDele}`, ...depois];
    case "empresa_deve":
      return [`Credor: você. A ${empresa} vai lhe transferir ${valor}${descontos}${pixDele}`];
    case "proprietario_deve":
      return [`Credor: ${empresa}. Você deve ${valor} à ${empresa}.`, r.chavePix ? `Pix da ${empresa}: ${r.chavePix}` : `Fale com a ${empresa} para combinar o pagamento.`];
    case "parcial":
      return [
        `Saldo parcial até o fim do mês: ${valor}${r.aFavor === "proprietario" ? " a seu favor" : r.aFavor === "empresa" ? ` a favor da ${empresa}` : ""}. O valor final e quem paga saem no fechamento, no dia ${diaFechamento} do mês seguinte.`,
      ];
    case "em_conferencia":
      return [`Há itens em conferência: o valor final aparece depois que a ${empresa} resolver.`];
    default:
      return ["Nada a pagar ou receber neste mês."];
  }
}

/** "Sua Casa Leblon" → { inicio: "Sua Casa", destaque: "Leblon" } (a última palavra em itálico dourado, como no site). */
export function marcaDe(empresa: string): { inicio: string; destaque: string } {
  const palavras = empresa.trim().split(/\s+/).filter(Boolean);
  if (palavras.length < 2) return { inicio: empresa.trim(), destaque: "" };
  return { inicio: palavras.slice(0, -1).join(" "), destaque: palavras.at(-1)! };
}

/** A situação da parte na tabela de reservas; `hoje` separa o que o canal já pagou do que ainda está previsto. */
const situacaoDaParte = (p: ParteDoRelatorio, hoje: string): { texto: string; tipo: LinhaReserva["situacaoTipo"] } => {
  if (p.repasse) {
    if (p.repasse.tipo === "por_fora") return { texto: "acertada por fora, antes do início do sistema", tipo: "ok" };
    return p.repasse.situacao === "pago" ? { texto: `repassada em ${dataCurta(dataDoPix(p.repasse))}`, tipo: "ok" } : { texto: `em repasse de ${dataCurta(p.repasse.data)}, a pagar`, tipo: "info" };
  }
  if (p.quemRecebe === "split") {
    if (!p.pagamento) return { texto: "paga pelo canal", tipo: "ok" };
    return p.pagamento.data <= hoje ? { texto: `paga pelo canal em ${dataCurta(p.pagamento.data)}`, tipo: "ok" } : { texto: `prevista para ${dataCurta(p.pagamento.data)} pelo canal`, tipo: "info" };
  }
  if (p.situacao === "disponivel") return { texto: "a transferir no fechamento", tipo: "info" };
  if (p.quemRecebe === "a_confirmar") return { texto: "a liberar: quem recebe a confirmar", tipo: "aviso" };
  const curto = /não registrou o recebimento/i.test(p.motivo)
    ? "pagamento do canal não registrado"
    : /depois do check-in/i.test(p.motivo)
      ? "libera depois do check-in"
      : /conferência/i.test(p.motivo)
        ? "em conferência"
        : /Recebido .* de /i.test(p.motivo)
          ? "recebido em parte"
          : p.motivo.replace(/\.$/, "");
  return { texto: `a liberar: ${curto}`, tipo: "aviso" };
};

/**
 * Os textos dependem só dos dados (nunca do relógio): o e-mail do fechamento (M5.4) versiona o conteúdo por eles, e uma
 * retomada tem de bater com o pedido guardado. A data e a hora de emissão entram na hora de desenhar o PDF (`pdf.ts`).
 */
export function textosDoRelatorio(d: DadosRelatorio): TextosRelatorio {
  const e = d.empresa;
  const mes = mesISO(d.ano, d.mes);
  const mesNome = nomeDoMes(mes);
  const extenso = nomeDoPeriodo({ ano: d.ano, mes: d.mes });
  const fim = ultimoDia(d.ano, d.mes);
  const ateDia = d.ate ? Number(d.ate.slice(8, 10)) : null;
  const r = d.resumo;
  const resultado = r.suaParte - r.despesas;
  const doMes = d.partes.filter((p) => p.mes === mes);
  const noites = d.metricas.atual.noitesOcupadas;
  const nReservas = r.reservas;
  const marketplace = d.contratos.length > 0 && d.contratos.every((c) => c.tipo === "marketplace");
  const comissoes = [...new Set(d.contratos.map((c) => c.comissao).filter((x): x is string => Boolean(x)))];
  const tiposContrato = [...new Set(d.contratos.map((c) => c.tipoNome.toLowerCase()))];
  const lugar = [...new Set(d.imoveis.map((i) => [i.bairro, i.cidade].filter(Boolean).join(", ")).filter(Boolean))].join(" · ");

  const periodo = d.situacao === "parcial" ? `1 a ${ateDia}/${d.mes}/${d.ano} (parcial: posição de ${br(d.ate!)})` : `1 a ${fim} de ${mesNome}${d.situacao === "futuro" ? " (previsto: só reservas já confirmadas)" : ""}`;
  const emissao = d.situacao === "parcial" ? `parcial até ${ateDia}/${d.mes}` : d.situacao === "futuro" ? "mês ainda não começou" : "fechamento do mês";
  const aviso =
    d.situacao === "parcial"
      ? `Relatório parcial, para acompanhar o andamento do mês, com a posição de ${br(d.ate!)}. Ele já inclui as reservas confirmadas até o fim do mês, inclusive as que ainda não aconteceram (como no portal): os números podem mudar. O fechamento completo vem no início do mês seguinte.`
      : d.situacao === "futuro"
        ? "Mês ainda não começou: só reservas já confirmadas, nada foi recebido ainda."
        : null;

  // Capa: destaque e "como chega".
  const base = `Sua parte ${nReservas === 1 ? "na" : "nas"} ${nReservas} ${plural(nReservas, "reserva", "reservas")} com noites em ${mesNome}, em todos os canais${r.despesas > 0 ? `, já descontadas as despesas do imóvel (${formatBRL(r.despesas)})` : " (sem despesas do imóvel no mês)"}. Resultado por noite: não é o total que um canal pagou no mês nem o valor de um Pix só.`;
  const chega = comoChega(d.partes, mes, d.hoje, d.rodape, e, d.repasses);
  const canaisComTaxa = [...new Set(doMes.filter((p) => p.taxa > 0).map((p) => nomeDoCanal(p.canal, e)))];
  const nDespesas = d.despesas.length;
  const brutoAoResultado: LinhaValor[] = [
    { texto: `Bruto das reservas (${nReservas} ${plural(nReservas, "reserva", "reservas")}, ${noites} ${plural(noites, "noite", "noites")} em ${mesNome})`, valor: formatBRL(r.receitaBruta), tipo: "normal" },
    { texto: `− Taxas dos canais${canaisComTaxa.length ? ` (${canaisComTaxa.join(", ")})` : ""}`, valor: `− ${formatBRL(r.taxasCanais)}`, tipo: "sub" },
    { texto: "Líquido depois dos canais", valor: formatBRL(r.receitaBruta - r.taxasCanais), tipo: "normal" },
    { texto: `− Comissão da gestão${comissoes.length === 1 ? ` (${comissoes[0]} do líquido)` : ""}`, valor: `− ${formatBRL(r.comissao)}`, tipo: "sub" },
    { texto: "Sua parte nas reservas", valor: formatBRL(r.suaParte), tipo: "normal" },
    ...(r.despesas > 0 ? [{ texto: `− Despesas do imóvel (${nDespesas || 1} ${plural(nDespesas || 1, "lançamento", "lançamentos")} — detalhe na página 3)`, valor: `− ${formatBRL(r.despesas)}`, tipo: "sub" as const }] : []),
    { texto: `Seu resultado em ${mesNome}`, valor: formatBRL(resultado), tipo: "total" },
  ];
  const emConferencia = r.emConferencia
    ? `Em conferência: há itens deste mês ainda não definidos${r.acertoPendente !== 0 ? ` (${formatBRL(Math.abs(r.acertoPendente))} ${r.acertoPendente > 0 ? "a seu favor" : `a favor da ${e}`})` : ""}. Eles ficaram fora do resultado acima, que ainda não é definitivo.`
    : null;
  // O complemento de cada aviso diz o que o proprietário precisa (ou não precisa) fazer: só o valor a liberar "entra no
  // próximo repasse"; quando é ele quem transfere, o aviso pede a transferência, nunca o contrário.
  const complemento: Record<AvisoDaLinha, string> = {
    a_liberar: "Entra no próximo repasse assim que o canal pagar; você não precisa fazer nada.",
    voce_transfere: `As despesas do mês passaram da sua parte; a chave Pix da ${e} está no portal.`,
    em_conferencia: "Esse valor é provisório e pode mudar; você não precisa fazer nada até a conferência terminar.",
  };
  const avisos = [
    ...chega.linhas.filter((l) => l.tipo === "aviso").map((l) => `${l.texto} (${formatBRL(l.valor)}).${l.aviso ? ` ${complemento[l.aviso]}` : ""}`),
    ...(emConferencia ? [emConferencia] : []),
    ...d.rodape.filter((x) => x.diferenca !== 0).map((x) => `Depois do fechamento, o acerto deste mês mudou ${formatBRL(Math.abs(x.diferenca))} (${x.diferenca > 0 ? "a seu favor" : `a favor da ${e}`}): isso entra no próximo repasse.`),
  ];

  // Página 2: quadros, gráfico e reservas.
  const quadros = quadrosDoMes({ atual: d.metricas.atual, anterior: d.metricas.anterior, anoAnterior: d.metricas.anoAnterior, parcialAte: d.metricas.parcialAte });
  const mesesDados = new Map(d.metricas.meses);
  const resultados = new Map([...mesesDados].map(([m, x]) => [m, x?.resultado ?? null] as const));
  const acumulado = acumuladoDoAno(resultados, mes);
  const nomes = new Map(d.imoveis.map((i) => [i.id, i.nome]));
  const partesDasReservas = new Set(doMes.map((p) => p.reservaId));
  const linhasReservas: LinhaReserva[] = [
    ...doMes.map((p) => {
      const s = situacaoDaParte(p, d.hoje);
      const atravessa = p.noitesNoMes !== p.noitesTotal;
      return {
        imovel: nomes.get(d.reservas.find((x) => x.id === p.reservaId)?.imovelId ?? "") ?? "",
        hospede: primeiroNome(p.hospede) || "não informado",
        canal: nomeDoCanal(p.canal, e),
        codigo: p.codigoCanal || p.codigo,
        situacao: s.texto,
        situacaoTipo: s.tipo,
        datas: `${dataCurta(p.checkin)} → ${dataCurta(p.checkout)}${atravessa ? " *" : ""}`,
        noites: atravessa ? `${p.noitesNoMes} de ${p.noitesTotal}` : String(p.noitesNoMes),
        bruto: formatBRL(p.bruto),
        taxa: formatBRL(p.taxa),
        gestao: formatBRL(p.comissao),
        suaParte: formatBRL(p.suaParte),
        atravessa,
      };
    }),
    // Reserva do mês sem parte no extrato (sem cálculo, em conferência): entra pelo que o portal mostra.
    ...d.reservas
      .filter((x) => !partesDasReservas.has(x.id))
      .map((x) => ({
        imovel: nomes.get(x.imovelId) ?? x.imovelCodigo,
        hospede: primeiroNome(x.hospede) || "não informado",
        canal: nomeDoCanal(x.canal, e),
        codigo: x.codigo,
        situacao: SITUACAO_RESERVA[x.situacao],
        situacaoTipo: (x.situacao === "definido" ? "info" : "aviso") as LinhaReserva["situacaoTipo"],
        datas: `${dataCurta(x.checkin)} → ${dataCurta(x.checkout)}`,
        noites: "—",
        bruto: formatBRL(x.bruto),
        taxa: "—",
        gestao: "—",
        suaParte: formatBRL(x.suaParte),
        atravessa: false,
      })),
  ];
  const soma = (f: (p: ParteDoRelatorio) => number) => doMes.reduce((s, p) => s + f(p), 0);
  const totalReservas: LinhaReserva | null = linhasReservas.length
    ? {
        imovel: "",
        hospede: `Total de ${mesNome}`,
        canal: "",
        codigo: "",
        situacao: "",
        situacaoTipo: "ok",
        datas: "",
        noites: String(noites),
        bruto: formatBRL(r.receitaBruta),
        taxa: formatBRL(doMes.length ? soma((p) => p.taxa) : r.taxasCanais),
        gestao: formatBRL(doMes.length ? soma((p) => p.comissao) : r.comissao),
        suaParte: formatBRL(r.suaParte),
        atravessa: false,
      }
    : null;
  const atravessam = linhasReservas.filter((l) => l.atravessa);

  // Página 3: conciliação, repasses, despesas, acerto.
  const conc = conciliacao(d.partes, mes, d.hoje, e);
  const repasses: LinhaValor[] = [
    ...d.repasses.map((x) => ({
      texto: `${dataCurta(dataDoPix(x))} — ${x.tipo === "por_fora" ? "acertado por fora, antes do início do sistema" : "repasse antecipado"}${x.reservas.length ? ` (${x.reservas.join(", ")})` : ""}`,
      valor: formatBRL(x.valor),
      tipo: "normal" as const,
      etiqueta: x.tipo === "por_fora" ? "acertado fora do sistema" : x.situacao === "pago" ? `pago em ${dataCurta(dataDoPix(x))}${x.dataPagamento && x.dataPagamento !== x.data ? ` (programado para ${dataCurta(x.data)})` : ""} · comprovante no portal` : x.situacao === "a_pagar" ? "a pagar" : x.situacao,
    })),
    // O que o canal pagou direto e os antecipados já estão acima (tabela de repasses) ou na conciliação; aqui só o fechamento e o a liberar.
    ...chega.linhas.filter((l) => l.origem === "fechamento" || l.origem === "a_liberar").map((l) => ({ texto: l.texto, valor: formatBRL(l.valor), tipo: l.tipo, etiqueta: l.origem === "a_liberar" ? "próximo repasse" : undefined })),
  ];
  const despesas: LinhaValor[] = d.despesas.map((x) => ({ texto: `${dataCurta(x.data)} — ${x.descricao}`, valor: formatBRL(x.valor), tipo: "normal" as const }));
  if (despesas.length) despesas.push({ texto: "Total descontado no fechamento", valor: formatBRL(d.despesas.reduce((s, x) => s + x.valor, 0)), tipo: "total" });
  const acerto: LinhaValor[] = d.rodape.flatMap((x) => {
    const quem = d.rodape.length > 1 ? ` — ${x.nome}` : "";
    const saldoTexto = x.saldo > 0 ? `(a ${e} deve a você)` : x.saldo < 0 ? `(você deve à ${e})` : "(zerado)";
    const linhas: LinhaValor[] = [{ texto: `Saldo do acerto em ${fim}/${d.mes} ${saldoTexto}${quem}`, valor: formatBRL(Math.abs(x.saldo)), tipo: "normal" }];
    if (x.descontado > 0) linhas.push({ texto: `− Adiantamentos descontados${quem}`, valor: `− ${formatBRL(x.descontado)}`, tipo: "sub" });
    if (x.situacao === "pago") linhas.push({ texto: `Transferido em ${br(x.dataPagamento!)}${quem}`, valor: formatBRL(x.valor), tipo: "total" });
    else if (x.situacao === "fechado" || x.situacao === "empresa_deve" || x.situacao === "proprietario_deve") linhas.push({ texto: `${x.situacao === "proprietario_deve" ? "Você transfere" : "A transferir"} no fechamento${quem}`, valor: formatBRL(x.valor), tipo: "total" });
    else if (x.situacao === "no_repasse_posterior") linhas.push({ texto: `Levado pelo repasse de ${nomeMes(x.repassePosterior!)}${quem}`, valor: formatBRL(x.valor), tipo: "total" });
    else if (x.situacao === "parcial") linhas.push({ texto: `Saldo parcial, fecha em ${br(`${d.ano}-${String(d.mes).padStart(2, "0")}-${String(fim).padStart(2, "0")}`)}${quem}`, valor: formatBRL(x.valor), tipo: "total" });
    return linhas;
  });

  const saldo = d.rodape.flatMap((x) => {
    const linhas = textoDoSaldo(x, e, d.diaFechamento);
    return d.rodape.length > 1 ? [`${x.nome}: ${linhas[0]}`, ...linhas.slice(1)] : linhas;
  });
  const imovelTitulo = d.imoveis.map((i) => i.nome).join(" · ");
  return {
    empresa: e,
    contato: d.contato.join(" · "),
    marca: marcaDe(e),
    mes,
    mesNome,
    olho: `Relatório mensal · ${capitalizar(extenso)}`,
    emissao,
    periodo,
    imovelTitulo,
    cabecalhoCurto: `${imovelTitulo} · ${capitalizar(extenso)}`,
    para: `Para ${d.proprietarios.join(" e ")}${d.representantes.length ? ` · com cópia a ${d.representantes.join(" e ")}, representante${d.representantes.length > 1 ? "s" : ""} autorizado${d.representantes.length > 1 ? "s" : ""}` : ""}`,
    identidade: [lugar, tiposContrato.length ? `contrato de ${tiposContrato.join(" e ")}` : "", comissoes.length === 1 && !marketplace ? `comissão de ${comissoes[0]} sobre o líquido dos canais` : ""].filter(Boolean).join(" · "),
    marketplace,
    mostrarImovel: d.imoveis.length > 1,
    aviso,
    destaque: { rotulo: `Seu resultado em ${mesNome}`, valor: formatBRL(resultado), base },
    comoChega: { linhas: chega.linhas.map(comoLinha), quemPagaQuem: chega.quemPagaQuem },
    brutoAoResultado,
    avisos,
    rodapeCapa: {
      comAnexos: "Os números são os mesmos do portal. Números e reservas na página 2; conciliação e repasses na 3; extratos oficiais dos canais no fim, como emitidos.",
      semAnexos: "Os números são os mesmos do portal. Números e reservas na página 2; conciliação e repasses na 3. Os extratos oficiais dos canais ficam com a equipe: peça se precisar.",
    },
    quadros,
    grafico: {
      titulo: "Resultado mensal, últimos 12 meses (R$ mil)",
      serie: serieDe12(resultados, mes),
      acumulado: acumulado ? `Acumulado ${acumulado.desde === `${d.ano}-01` ? `de ${d.ano}` : `desde ${nomeDoMes(acumulado.desde)} (primeiro mês com dado)`}: ${formatBRL(acumulado.valor)}` : null,
      legendaAtual: mesNome,
    },
    graficoOcupacao: {
      titulo: "Ocupação por mês, últimos 12 meses (%)",
      serie: serieOcupacaoDe12(mesesDados, mes),
      legendaAtual: mesNome,
      nota: "sobre cada barra, a diária média do mês",
    },
    reservasTitulo: `Reservas do mês · ${nReservas} ${plural(nReservas, "reserva", "reservas")} · ${noites} ${plural(noites, "noite", "noites")} em ${mesNome}`,
    reservas: linhasReservas,
    totalReservas,
    notaReservas: `${atravessam.length ? `* Estadia que atravessa o mês entra só com as noites de ${mesNome}, rateadas por noite (regra de 24/09); as outras noites vão para o relatório do mês delas. ` : ""}A limpeza está dentro do bruto. Do hóspede, só o primeiro nome; o código é o do canal.`,
    conciliacaoIntro: `O que cada canal pagou em ${mesNome} (pela data do pagamento: Airbnb no dia seguinte ao check-in, direto a você; Booking, site e direta pela data em que a ${e} recebeu), a ponte para o resultado por noite, e como o dinheiro chegou (ou vai chegar) até você.`,
    conciliacao: conc.map((l) => ({ rotulo: l.rotulo, reservas: String(l.reservas), bruto: formatBRL(l.bruto), taxa: formatBRL(l.taxa), quemRecebeu: l.quemRecebeu, suaParte: formatBRL(l.suaParte), tipo: l.tipo })),
    conciliacaoFecha: conciliacaoFecha(conc),
    repasses,
    despesas,
    acerto,
    posicao: `Nenhum valor é estimado: o que o sistema ainda não tem aparece como "a receber" ou "a liberar". Um repasse "enviado" não confirma o crédito na sua conta: confira o comprovante no portal.`,
    anexosIntro: "Como emitidos pelo canal, sem alterações. Só as páginas deste imóvel e destes favorecidos.",
    anexosNota: `Diferença entre o total do extrato do canal e o bruto deste relatório tem explicação na conciliação (página 3): período, base "ganhos" × "pagamentos", estadia que atravessa o mês. O total do canal não é lucro nem erro.`,
    saldo: saldo.length ? saldo : ["Nada a pagar ou receber neste mês."],
    emConferencia,
  };
}
