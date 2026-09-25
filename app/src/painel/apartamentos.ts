/**
 * Aba Apartamentos (M4.7): uma linha por imóvel com o resultado do ponto de vista da empresa
 * (comissões, despesas próprias, ajustes) e, à parte, o acerto com o proprietário (despesas
 * dele, movimento e saldo do acerto, adiantamentos a cobrar). Os números vêm das mesmas
 * funções do livro e do painel inicial: somando as linhas, o total bate com o Início.
 */
import { inArray } from "drizzle-orm";
import { listarAdiantamentos } from "@/adiantamentos/adiantamentos";
import { proprietarioImoveis, proprietarios } from "@/db/schema";
import type { Imovel } from "@/imoveis/repositorio";
import type { Db } from "@/db/types";
import { acertoPorImovelEDono, despesasProprietarioPorDono, semImovelPorDono, type TotaisDoImovel, totaisPorImovel } from "@/financeiro/ledger";
import { reservasQueContam } from "@/portal/posse";
import { listarBloqueios, listarReservas } from "@/reservas/repositorio";
import { calcularOcupacao, type Financeiro, resumoFinanceiro } from "./indicadores";

export const COLUNAS = [
  { chave: "reservas", titulo: "Reservas", grupo: "operacao", padrao: true },
  { chave: "ocupacao", titulo: "Ocupação", grupo: "operacao", padrao: true },
  { chave: "receita", titulo: "Receita bruta", grupo: "empresa", padrao: false },
  { chave: "taxas", titulo: "Taxas dos canais", grupo: "empresa", padrao: false },
  { chave: "comissoes", titulo: "Comissões", grupo: "empresa", padrao: true },
  { chave: "despesas", titulo: "Despesas da empresa", grupo: "empresa", padrao: true },
  { chave: "ajustes", titulo: "Ajustes", grupo: "empresa", padrao: false },
  { chave: "resultado", titulo: "Resultado da empresa", grupo: "empresa", padrao: true },
  { chave: "despesasProprietario", titulo: "Despesas do proprietário", grupo: "acerto", padrao: false },
  { chave: "acertoPeriodo", titulo: "Acerto no período", grupo: "acerto", padrao: false },
  { chave: "saldo", titulo: "Saldo do acerto", grupo: "acerto", padrao: true },
  { chave: "aCobrar", titulo: "Adiantamentos a cobrar (hoje)", grupo: "acerto", padrao: true },
] as const;
export type ChaveColuna = (typeof COLUNAS)[number]["chave"];

type Params = Record<string, string | string[] | undefined>;
const lista = (v: string | string[] | undefined) => (v === undefined ? [] : (Array.isArray(v) ? v : [v]).flatMap((x) => x.split(",")));

/** Colunas escolhidas (`col` na URL). Nenhuma válida = as padrão. */
export function lerColunas(params: Params): ChaveColuna[] {
  const pedidas = new Set(lista(params.col));
  const validas = COLUNAS.filter((c) => pedidas.has(c.chave)).map((c) => c.chave);
  return validas.length ? validas : COLUNAS.filter((c) => c.padrao).map((c) => c.chave);
}

const MES = /^(\d{4})-(0[1-9]|1[0-2])$/;
const LIMITE_MESES = 36;

/**
 * Intervalo de meses (`de`/`ate`, AAAA-MM) que substitui o período do filtro global.
 * Inválido não é adivinhado: devolve um aviso e fica o período do filtro.
 */
export function lerIntervalo(params: Params): { periodo?: { inicio: string; fim: string }; de?: string; ate?: string; aviso?: string } {
  const de = typeof params.de === "string" ? params.de.trim() : "";
  const ate = typeof params.ate === "string" ? params.ate.trim() : "";
  if (!de && !ate) return {};
  const a = MES.exec(de);
  const b = MES.exec(ate);
  if (!a || !b) return { de, ate, aviso: "Intervalo incompleto ou inválido: mostrando o período do filtro." };
  // Mesma faixa de anos do filtro global (o banco não tem ano zero, por exemplo).
  if ([a, b].some((m) => Number(m[1]) < 2000 || Number(m[1]) > 2100)) return { de, ate, aviso: "Ano fora da faixa (2000 a 2100): mostrando o período do filtro." };
  const meses = (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2])) + 1;
  if (meses < 1) return { de, ate, aviso: "O mês final vem antes do inicial: mostrando o período do filtro." };
  if (meses > LIMITE_MESES) return { de, ate, aviso: `Intervalo de no máximo ${LIMITE_MESES} meses: mostrando o período do filtro.` };
  const anoFim = Number(b[2]) === 12 ? Number(b[1]) + 1 : Number(b[1]);
  const mesFim = Number(b[2]) === 12 ? 1 : Number(b[2]) + 1;
  return { de, ate, periodo: { inicio: `${de}-01`, fim: `${anoFim}-${String(mesFim).padStart(2, "0")}-01` } };
}

export type Sentido = { empresaDeve: number; proprietariosDevem: number };

export type DonoAnterior = { proprietarioId: string; nome: string; despesas: number; saldo: number; acertoPeriodo: number; aCobrar: number; contestados: number };

export type LinhaApartamento = {
  /** null = lançamentos sem imóvel (despesas gerais da empresa). */
  imovelId: string | null;
  codigo: string;
  nome: string;
  ativo: boolean;
  reservas: number;
  noitesVendidas: number;
  noitesDisponiveis: number;
  ocupacao: number | null;
  financeiro: Financeiro;
  despesasProprietario: number;
  acertoPeriodo: number;
  /** Proprietário atual do imóvel (null: sem proprietário ou linha geral/total). */
  proprietarioId: string | null;
  /** Acumulado até o fim do período, do proprietário atual. Positivo: a empresa deve a ele. */
  saldo: number;
  /**
   * Só no total: somas por sentido, com os valores de cada pessoa juntados antes (um credor e um
   * devedor diferentes nunca se anulam).
   */
  porSentido?: { saldo: Sentido; acertoPeriodo: Sentido };
  /**
   * Proprietários anteriores do imóvel com algo em aberto ou movimento no período, um por pessoa
   * (não entram nos campos do dono atual e nunca se compensam entre si). Na linha "Geral",
   * o acerto de cada proprietário lançado sem imóvel.
   */
  anteriores: DonoAnterior[];
  aCobrar: number;
  contestados: number;
};

const VAZIO: TotaisDoImovel = { valor: {}, montante: {}, acerto: 0 };

function temMovimento(l: LinhaApartamento): boolean {
  const f = l.financeiro;
  return Boolean(l.reservas || f.receitaBruta || f.taxasCanais || f.comissoes || f.despesasEmpresa || f.ajustesEmpresa || l.despesasProprietario || l.acertoPeriodo || l.saldo || l.anteriores.length || l.aCobrar || l.contestados);
}

/**
 * Linhas da aba. `todos` = sem filtro de imóvel: entram também imóveis arquivados com movimento
 * e a linha "Geral da empresa" (lançamentos sem imóvel), como no Início.
 */
export async function carregarApartamentos(
  db: Db,
  organizacaoId: string,
  o: { imoveis: readonly Imovel[]; todos: boolean; periodo: { inicio: string; fim: string } },
): Promise<{ linhas: LinhaApartamento[]; total: LinhaApartamento }> {
  const candidatos = o.imoveis;
  const ids = candidatos.map((i) => i.id);
  const [totais, acertoPeriodo, saldos, despesasDono, donos, reservas, bloqueios, adiantamentos, semImovelPeriodo, semImovelSaldo] = await Promise.all([
    // Filtro sem imóvel nenhum não vira "todos": nada a somar.
    o.todos ? totaisPorImovel(db, organizacaoId, o.periodo) : ids.length ? totaisPorImovel(db, organizacaoId, { ...o.periodo, imovelIds: ids }) : new Map<string | null, TotaisDoImovel>(),
    acertoPorImovelEDono(db, organizacaoId, { ...o.periodo, imovelIds: ids }),
    acertoPorImovelEDono(db, organizacaoId, { fim: o.periodo.fim, imovelIds: ids }),
    despesasProprietarioPorDono(db, organizacaoId, { ...o.periodo, imovelIds: ids }),
    ids.length
      ? db.select({ imovelId: proprietarioImoveis.imovelId, proprietarioId: proprietarioImoveis.proprietarioId }).from(proprietarioImoveis).where(inArray(proprietarioImoveis.imovelId, ids))
      : [],
    ids.length ? listarReservas(db, organizacaoId, { ...o.periodo, imovelIds: ids }) : [],
    ids.length ? listarBloqueios(db, organizacaoId, { ...o.periodo, imovelIds: ids }) : [],
    ids.length ? listarAdiantamentos(db, organizacaoId, { imovelIds: ids, somenteAbertos: true }) : [],
    // Lançamentos de proprietário sem imóvel: só em "todos", na linha "Geral".
    o.todos ? semImovelPorDono(db, organizacaoId, o.periodo) : [],
    o.todos ? semImovelPorDono(db, organizacaoId, { fim: o.periodo.fim }) : [],
  ]);
  // Só confirmadas, como no Início, no portal e no relatório; divergente pelo livro.
  const contam = await reservasQueContam(db, organizacaoId, { imovelIds: ids, periodo: o.periodo });
  const ocupacao = new Map(
    calcularOcupacao(
      ids,
      reservas.map((r) => ({ imovelId: r.imovelId, inicio: r.checkin, fim: r.checkout })),
      bloqueios.map((b) => ({ imovelId: b.imovelId, inicio: b.inicio, fim: b.fim })),
      o.periodo,
    ).map((x) => [x.imovelId, x]),
  );

  // O acerto da linha é o do proprietário atual do imóvel; o de donos anteriores fica à parte
  // (um imóvel que trocou de dono não soma a dívida de um com o crédito do outro).
  const donoAtual = new Map(donos.map((d) => [d.imovelId, d.proprietarioId]));
  const idsDonos = [
    ...new Set(
      [...saldos, ...acertoPeriodo, ...despesasDono, ...semImovelPeriodo, ...semImovelSaldo].map((x) => x.proprietarioId).concat(adiantamentos.map((a) => a.proprietarioId)),
    ),
  ];
  const nomes = new Map(
    idsDonos.length
      ? (await db.select({ id: proprietarios.id, nome: proprietarios.nome }).from(proprietarios).where(inArray(proprietarios.id, idsDonos))).map((p) => [p.id, p.nome])
      : [],
  );
  const somaDe = (lista: typeof saldos, imovelId: string, dono: string) => lista.filter((x) => x.imovelId === imovelId && x.proprietarioId === dono).reduce((t, x) => t + x.total, 0);
  const cobrar = (lista: typeof adiantamentos) => lista.filter((a) => a.situacao !== "contestado").reduce((t, a) => t + a.aberto, 0);
  const contest = (lista: typeof adiantamentos) => lista.filter((a) => a.situacao === "contestado").length;
  // Um por proprietário anterior: valores de pessoas diferentes nunca se compensam.
  const anteriores = (imovelId: string): DonoAnterior[] => {
    const atual = donoAtual.get(imovelId);
    const outros = new Set(
      [...saldos, ...acertoPeriodo, ...despesasDono].filter((x) => x.imovelId === imovelId).map((x) => x.proprietarioId).concat(adiantamentos.filter((a) => a.imovelId === imovelId).map((a) => a.proprietarioId)),
    );
    outros.delete(atual as string);
    return [...outros]
      .map((dono) => {
        const adiant = adiantamentos.filter((a) => a.imovelId === imovelId && a.proprietarioId === dono);
        return {
          proprietarioId: dono,
          nome: nomes.get(dono) ?? "Proprietário anterior",
          despesas: somaDe(despesasDono, imovelId, dono),
          saldo: somaDe(saldos, imovelId, dono),
          acertoPeriodo: somaDe(acertoPeriodo, imovelId, dono),
          aCobrar: cobrar(adiant),
          contestados: contest(adiant),
        };
      })
      .filter((x) => x.despesas || x.saldo || x.acertoPeriodo || x.aCobrar || x.contestados);
  };

  // Linha "Geral": o acerto sem imóvel também é separado por proprietário (um item por pessoa).
  const semImovel = (): DonoAnterior[] =>
    [...new Set([...semImovelPeriodo, ...semImovelSaldo].map((x) => x.proprietarioId))]
      .map((dono) => {
        const p = semImovelPeriodo.find((x) => x.proprietarioId === dono);
        return {
          proprietarioId: dono,
          nome: nomes.get(dono) ?? "Proprietário",
          despesas: p?.despesas ?? 0,
          saldo: semImovelSaldo.find((x) => x.proprietarioId === dono)?.acerto ?? 0,
          acertoPeriodo: p?.acerto ?? 0,
          aCobrar: 0,
          contestados: 0,
        };
      })
      .filter((x) => x.despesas || x.saldo || x.acertoPeriodo);

  const linha = (imovelId: string | null, codigo: string, nome: string, ativo: boolean): LinhaApartamento => {
    const t = totais.get(imovelId) ?? VAZIO;
    // Arquivado sem noite vendida não entra na ocupação (como no Início): não dilui a taxa.
    const ocBruta = imovelId ? ocupacao.get(imovelId) : undefined;
    const oc = ocBruta && !ativo && ocBruta.vendidas === 0 ? undefined : ocBruta;
    const dono = imovelId ? donoAtual.get(imovelId) : undefined;
    const adiant = adiantamentos.filter((a) => a.imovelId === imovelId && imovelId !== null && a.proprietarioId === dono);
    return {
      imovelId,
      codigo,
      nome,
      ativo,
      reservas: imovelId ? contam.filter((r) => r.imovelId === imovelId).length : 0,
      noitesVendidas: oc?.vendidas ?? 0,
      noitesDisponiveis: oc?.disponiveis ?? 0,
      ocupacao: oc?.taxa ?? null,
      financeiro: resumoFinanceiro(t.valor),
      // Do dono atual; as de proprietários anteriores ficam no item de cada um.
      despesasProprietario: imovelId && dono ? somaDe(despesasDono, imovelId, dono) : 0,
      proprietarioId: dono ?? null,
      acertoPeriodo: imovelId && dono ? somaDe(acertoPeriodo, imovelId, dono) : 0,
      saldo: imovelId && dono ? somaDe(saldos, imovelId, dono) : 0,
      anteriores: imovelId ? anteriores(imovelId) : semImovel(),
      aCobrar: cobrar(adiant),
      contestados: contest(adiant),
    };
  };

  let linhas = candidatos.map((i) => linha(i.id, i.codigo, i.nome, i.ativo));
  if (o.todos) {
    // Arquivados só aparecem se tiverem algo no período (ou saldo em aberto).
    linhas = linhas.filter((l) => l.ativo || temMovimento(l));
    const geral = linha(null, "—", "Geral da empresa (sem imóvel)", true);
    if (temMovimento(geral)) linhas.push(geral);
  }
  return { linhas, total: somar(linhas) };
}

/**
 * Junta por pessoa (dono atual de cada linha e donos anteriores) e só então separa quem a
 * empresa deve de quem deve à empresa.
 */
function porSentido(linhas: readonly LinhaApartamento[], valor: (x: { saldo: number; acertoPeriodo: number }) => number): Sentido {
  const porDono = new Map<string, number>();
  for (const l of linhas) {
    if (l.proprietarioId) porDono.set(l.proprietarioId, (porDono.get(l.proprietarioId) ?? 0) + valor(l));
    for (const a of l.anteriores) porDono.set(a.proprietarioId, (porDono.get(a.proprietarioId) ?? 0) + valor(a));
  }
  const v = [...porDono.values()];
  return { empresaDeve: v.filter((x) => x > 0).reduce((t, x) => t + x, 0), proprietariosDevem: v.filter((x) => x < 0).reduce((t, x) => t - x, 0) };
}

/** Soma das linhas (a ocupação total é recalculada pelas noites, não pela média das taxas). */
export function somar(linhas: readonly LinhaApartamento[]): LinhaApartamento {
  const s = (f: (l: LinhaApartamento) => number) => linhas.reduce((t, l) => t + f(l), 0);
  const vendidas = s((l) => l.noitesVendidas);
  const disponiveis = s((l) => l.noitesDisponiveis);
  const comissoes = s((l) => l.financeiro.comissoes);
  const despesasEmpresa = s((l) => l.financeiro.despesasEmpresa);
  const ajustesEmpresa = s((l) => l.financeiro.ajustesEmpresa);
  return {
    imovelId: null,
    codigo: "Total",
    nome: "Total",
    ativo: true,
    reservas: s((l) => l.reservas),
    noitesVendidas: vendidas,
    noitesDisponiveis: disponiveis,
    ocupacao: disponiveis > 0 ? vendidas / disponiveis : null,
    financeiro: {
      receitaBruta: s((l) => l.financeiro.receitaBruta),
      taxasCanais: s((l) => l.financeiro.taxasCanais),
      comissoes,
      despesasEmpresa,
      ajustesEmpresa,
      resultadoEmpresa: comissoes - despesasEmpresa + ajustesEmpresa,
    },
    despesasProprietario: s((l) => l.despesasProprietario),
    proprietarioId: null,
    acertoPeriodo: s((l) => l.acertoPeriodo),
    saldo: s((l) => l.saldo),
    porSentido: { saldo: porSentido(linhas, (x) => x.saldo), acertoPeriodo: porSentido(linhas, (x) => x.acertoPeriodo) },
    // No total, somam-se só valores da mesma pessoa.
    anteriores: [
      ...linhas
        .flatMap((l) => l.anteriores)
        .reduce((m, x) => {
          const y = m.get(x.proprietarioId);
          return m.set(
            x.proprietarioId,
            y ? { ...y, despesas: y.despesas + x.despesas, saldo: y.saldo + x.saldo, acertoPeriodo: y.acertoPeriodo + x.acertoPeriodo, aCobrar: y.aCobrar + x.aCobrar, contestados: y.contestados + x.contestados } : x,
          );
        }, new Map<string, DonoAnterior>())
        .values(),
    ],
    aCobrar: s((l) => l.aCobrar),
    contestados: s((l) => l.contestados),
  };
}
