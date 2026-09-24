/**
 * Aba Apartamentos (M4.7): uma linha por imóvel com o resultado do ponto de vista da empresa
 * (comissões, despesas próprias, ajustes) e, à parte, o acerto com o proprietário (despesas
 * dele, movimento e saldo do acerto, adiantamentos a cobrar). Os números vêm das mesmas
 * funções do livro e do painel inicial: somando as linhas, o total bate com o Início.
 */
import { listarAdiantamentos } from "@/adiantamentos/adiantamentos";
import type { Imovel } from "@/imoveis/repositorio";
import type { Db } from "@/db/types";
import { saldosAcertoPorImovel, type TotaisDoImovel, totaisPorImovel } from "@/financeiro/ledger";
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
  /** Acumulado até o fim do período. Positivo: a empresa deve ao proprietário. */
  saldo: number;
  aCobrar: number;
  contestados: number;
};

const VAZIO: TotaisDoImovel = { valor: {}, montante: {}, acerto: 0 };

function temMovimento(l: LinhaApartamento): boolean {
  const f = l.financeiro;
  return Boolean(l.reservas || f.receitaBruta || f.comissoes || f.despesasEmpresa || f.ajustesEmpresa || l.despesasProprietario || l.acertoPeriodo || l.saldo || l.aCobrar || l.contestados);
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
  const [totais, saldos, reservas, bloqueios, adiantamentos] = await Promise.all([
    // Filtro sem imóvel nenhum não vira "todos": nada a somar.
    o.todos ? totaisPorImovel(db, organizacaoId, o.periodo) : ids.length ? totaisPorImovel(db, organizacaoId, { ...o.periodo, imovelIds: ids }) : new Map<string | null, TotaisDoImovel>(),
    saldosAcertoPorImovel(db, organizacaoId, o.periodo.fim, ids),
    ids.length ? listarReservas(db, organizacaoId, { ...o.periodo, imovelIds: ids }) : [],
    ids.length ? listarBloqueios(db, organizacaoId, { ...o.periodo, imovelIds: ids }) : [],
    ids.length ? listarAdiantamentos(db, organizacaoId, { imovelIds: ids, somenteAbertos: true }) : [],
  ]);
  const ocupacao = new Map(
    calcularOcupacao(
      ids,
      reservas.map((r) => ({ imovelId: r.imovelId, inicio: r.checkin, fim: r.checkout })),
      bloqueios.map((b) => ({ imovelId: b.imovelId, inicio: b.inicio, fim: b.fim })),
      o.periodo,
    ).map((x) => [x.imovelId, x]),
  );

  const linha = (imovelId: string | null, codigo: string, nome: string, ativo: boolean): LinhaApartamento => {
    const t = totais.get(imovelId) ?? VAZIO;
    const oc = imovelId ? ocupacao.get(imovelId) : undefined;
    const adiant = adiantamentos.filter((a) => a.imovelId === imovelId);
    return {
      imovelId,
      codigo,
      nome,
      ativo,
      reservas: imovelId ? reservas.filter((r) => r.imovelId === imovelId).length : 0,
      noitesVendidas: oc?.vendidas ?? 0,
      noitesDisponiveis: oc?.disponiveis ?? 0,
      ocupacao: oc?.taxa ?? null,
      financeiro: resumoFinanceiro(t.valor),
      despesasProprietario: t.montante.despesa_proprietario ?? 0,
      acertoPeriodo: t.acerto,
      saldo: imovelId ? (saldos.get(imovelId) ?? 0) : 0,
      aCobrar: adiant.filter((a) => a.situacao !== "contestado").reduce((s, a) => s + a.aberto, 0),
      contestados: adiant.filter((a) => a.situacao === "contestado").length,
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
    acertoPeriodo: s((l) => l.acertoPeriodo),
    saldo: s((l) => l.saldo),
    aCobrar: s((l) => l.aCobrar),
    contestados: s((l) => l.contestados),
  };
}
