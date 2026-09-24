/**
 * Relatório mensal do proprietário (M5.3): os mesmos números do portal (resumo, reservas e
 * rodapé), montados como textos da primeira página do PDF. Nada é recalculado aqui — uma regra,
 * um lugar: o PDF, o portal e o painel leem as mesmas funções.
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
import { nomeMes } from "@/repasses/repasses";
import { NOMES_ORIGEM } from "@/reservas/regras";

export type Dono = { id: string; nome: string };
export type ImovelDoRelatorio = { id: string; codigo: string; nome: string };

export type DadosRelatorio = {
  empresa: string;
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
  resumo: ResumoPortal;
  reservas: ReservaPortal[];
  rodape: Rodape[];
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
    .select({ id: imoveis.id, codigo: imoveis.codigo, nome: imoveis.nome })
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
  o: { donos: readonly Dono[]; imoveis: readonly ImovelDoRelatorio[]; todosOsImoveis: boolean; ano: number; mes: number; hoje: string },
): Promise<DadosRelatorio> {
  const donoIds = o.donos.map((d) => d.id);
  const imovelIds = o.imoveis.map((i) => i.id);
  const periodo = periodoDosFiltros({ imoveis: [], ano: o.ano, mes: o.mes });
  const empresa = await lerEmpresa(db, organizacaoId);
  const [resumo, lista, rodape, reps] = await Promise.all([
    resumoDoProprietario(db, organizacaoId, { proprietarioIds: donoIds, imovelIds, semImovel: o.todosOsImoveis, periodo }),
    reservasDoPortal(db, organizacaoId, { proprietarioIds: donoIds, imovelIds, periodo }),
    rodapeDoPortal(db, organizacaoId, { proprietarios: o.donos, mes: iso(o.ano, o.mes), hoje: o.hoje, pixEmpresa: empresa.chavePix }),
    donoIds.filter(uuidValido).length
      ? db
          .select({ nome: representantes.nome })
          .from(representantes)
          .where(and(inArray(representantes.proprietarioId, donoIds.filter(uuidValido)), eq(representantes.recebeRelatorios, true)))
          .orderBy(asc(representantes.nome))
      : Promise.resolve([]),
  ]);
  const situacao: SituacaoPeriodo = o.hoje < periodo.inicio ? "futuro" : o.hoje >= periodo.fim ? "fechado" : "parcial";
  return {
    empresa: empresa.nome || NOME_EMPRESA_INICIAL,
    contato: [empresa.site, empresa.email, empresa.telefone].filter(Boolean),
    proprietarios: o.donos.map((d) => d.nome),
    representantes: reps.map((r) => r.nome),
    imoveis: [...o.imoveis],
    ano: o.ano,
    mes: o.mes,
    situacao,
    ate: situacao === "parcial" ? o.hoje : null,
    resumo,
    reservas: lista,
    rodape,
  };
}

// ---------------------------------------------------------------------------
// Textos da primeira página (puros, testados; o PDF só desenha).

export type Numero = { rotulo: string; valor: string; detalhe?: string; destaque?: boolean };
export type LinhaTabela = { imovel: string; entrada: string; saida: string; hospede: string; canal: string; bruto: string; suaParte: string; situacao: string };

export type TextosRelatorio = {
  empresa: string;
  contato: string;
  titulo: string;
  imoveis: string;
  destinatarios: string;
  periodo: string;
  aviso: string | null;
  numeros: Numero[];
  emConferencia: string | null;
  mostrarImovel: boolean;
  reservas: LinhaTabela[];
  notaReservas: string;
  saldo: string[];
  notaSaldo: string;
};

const SITUACAO_RESERVA: Record<SituacaoReserva, string> = { definido: "Definido", em_conferencia: "Em conferência", sem_calculo: "Sem cálculo ainda" };
const br = (d: string) => d.split("-").reverse().join("/");
/** Dia/mês (a tabela é de um mês só; o ano está no título). */
const curta = (d: string) => br(d).slice(0, 5);
const primeiroNome = (n: string) => n.trim().split(/\s+/)[0] ?? "";
const ultimoDia = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
const dd = (n: number) => String(n).padStart(2, "0");

/** Frase do saldo com a empresa, a mesma leitura do rodapé do portal. */
export function textoDoSaldo(r: Rodape, empresa: string): string[] {
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
        `Saldo parcial até o fim do mês: ${valor}${r.aFavor === "proprietario" ? " a seu favor" : r.aFavor === "empresa" ? ` a favor da ${empresa}` : ""}. O valor final e quem paga saem no fechamento, no dia 1º do mês seguinte.`,
      ];
    case "em_conferencia":
      return [`Há itens em conferência: o valor final aparece depois que a ${empresa} resolver.`];
    default:
      return ["Nada a pagar ou receber neste mês."];
  }
}

export function textosDoRelatorio(d: DadosRelatorio): TextosRelatorio {
  const extenso = nomeDoPeriodo({ ano: d.ano, mes: d.mes });
  const fim = ultimoDia(d.ano, d.mes);
  const inicio = `1º/${dd(d.mes)}/${d.ano}`;
  const periodo =
    d.situacao === "parcial"
      ? `De ${inicio} a ${dd(fim)}/${dd(d.mes)}/${d.ano} (parcial: posição de ${br(d.ate!)})`
      : d.situacao === "futuro"
        ? `De ${inicio} a ${dd(fim)}/${dd(d.mes)}/${d.ano} (previsto: só reservas já confirmadas)`
        : `De ${inicio} a ${dd(fim)}/${dd(d.mes)}/${d.ano}`;
  const aviso =
    d.situacao === "parcial"
      ? `Relatório parcial, para acompanhar o andamento do mês, com a posição de ${br(d.ate!)}. Ele já inclui as reservas confirmadas até o fim do mês, inclusive as que ainda não aconteceram (como no portal): os números podem mudar. O fechamento completo vem no início do mês seguinte.`
      : d.situacao === "futuro"
        ? "Mês ainda não começou: só reservas já confirmadas, nada foi recebido ainda."
        : null;
  const r = d.resumo;
  const e = d.empresa;
  // Vendas diretas (site, WhatsApp, indicação) em destaque logo no início, só quando existem.
  const diretas = d.reservas.filter((x) => x.canal === "site" || x.canal === "direta");
  const numeros: Numero[] = [
    { rotulo: "Reservas no mês", valor: String(r.reservas) },
    ...(diretas.length
      ? [
          {
            rotulo: "Vendas diretas",
            valor: formatBRL(diretas.reduce((t, x) => t + x.bruto, 0)),
            detalhe: `${diretas.length} reserva(s) vendida(s) direto, sem Airbnb ou Booking (site, WhatsApp, indicação); valor bruto do mês`,
          },
        ]
      : []),
    { rotulo: "Valor bruto das reservas", valor: formatBRL(r.receitaBruta), detalhe: "o que o hóspede pagou, pela parte do mês de cada estada" },
    { rotulo: "Taxas dos canais", valor: formatBRL(r.taxasCanais), detalhe: "Airbnb, Booking e outros" },
    { rotulo: `Comissão da ${e}`, valor: formatBRL(r.comissao) },
    {
      rotulo: "Sua parte das reservas",
      valor: formatBRL(r.suaParte),
      detalhe: "pelo contrato, depois das taxas dos canais e da comissão; não é o total do canal nem lucro",
      destaque: true,
    },
    { rotulo: "Despesas atribuídas a você", valor: formatBRL(r.despesas) },
    {
      rotulo: "Acerto do mês",
      valor: formatBRL(Math.abs(r.acerto)),
      detalhe: r.acerto > 0 ? `a ${e} passou a lhe dever (já conta os repasses)` : r.acerto < 0 ? `você passou a dever à ${e} (já conta os repasses)` : "zerado no mês (já conta os repasses)",
    },
  ];
  const emConferencia = r.emConferencia
    ? `Em conferência: há itens deste mês ainda não definidos${
        r.acertoPendente !== 0 ? ` (${formatBRL(Math.abs(r.acertoPendente))} ${r.acertoPendente > 0 ? "a seu favor" : `a favor da ${e}`})` : ""
      }. Eles ficaram fora do acerto acima, que ainda não é definitivo.`
    : null;
  const nomes = new Map(d.imoveis.map((i) => [i.id, i.nome]));
  const reservas = d.reservas.map((x) => ({
    imovel: nomes.get(x.imovelId) ?? x.imovelCodigo,
    entrada: curta(x.checkin),
    saida: curta(x.checkout),
    hospede: primeiroNome(x.hospede) || "não informado",
    canal: NOMES_ORIGEM[x.canal],
    bruto: formatBRL(x.bruto),
    suaParte: formatBRL(x.suaParte),
    situacao: SITUACAO_RESERVA[x.situacao],
  }));
  const saldo = d.rodape.flatMap((x) => {
    const linhas = textoDoSaldo(x, e);
    return d.rodape.length > 1 ? [`${x.nome}: ${linhas[0]}`, ...linhas.slice(1)] : linhas;
  });
  return {
    empresa: e,
    contato: d.contato.join(" · "),
    titulo: `Relatório de ${extenso}`,
    imoveis: d.imoveis.map((i) => i.nome).join(" · "),
    destinatarios: [
      d.proprietarios.length === 1 ? `Proprietário: ${d.proprietarios[0]}` : `Proprietários: ${d.proprietarios.join(", ")}`,
      ...(d.representantes.length ? [`${d.representantes.length === 1 ? "Representante" : "Representantes"}: ${d.representantes.join(", ")}`] : []),
    ].join(" · "),
    periodo,
    aviso,
    numeros,
    emConferencia,
    mostrarImovel: d.imoveis.length > 1,
    reservas,
    notaReservas:
      "Reservas confirmadas do mês. Valores pela parte do mês de cada estada (as que passam de um mês para o outro são divididas pelas noites). Do hóspede, só o primeiro nome.",
    saldo: saldo.length ? saldo : ["Nada a pagar ou receber neste mês."],
    notaSaldo: `O saldo considera todos os seus imóveis até o fim de ${extenso}, já com os repasses feitos.`,
  };
}
