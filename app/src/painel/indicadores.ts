/**
 * Indicadores do painel inicial (M4.6). Tudo sai das mesmas fontes das outras telas — reservas,
 * bloqueios e o livro de lançamentos — para os números baterem (uma regra, um lugar).
 *
 * - Ocupação: noites vendidas ÷ noites disponíveis no período (noites do período menos as
 *   bloqueadas), por imóvel e no total. Datas "AAAA-MM-DD", fim exclusivo.
 * - Resultado da empresa: comissões + despesas da empresa + ajustes que afetam a empresa
 *   (receita bruta, taxas e a parte do proprietário são dinheiro que passa, não é da empresa).
 */
import type { TipoLancamento } from "@/db/schema";

const DIA = 86_400_000;
const utc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
export const diasEntre = (a: string, b: string) => Math.max(0, Math.round((utc(b) - utc(a)) / DIA));

/** Noites de [inicio, fim) que caem dentro de [pInicio, pFim). */
export function noitesNoPeriodo(inicio: string, fim: string, pInicio: string, pFim: string): number {
  const a = inicio > pInicio ? inicio : pInicio;
  const b = fim < pFim ? fim : pFim;
  return b > a ? diasEntre(a, b) : 0;
}

type Intervalo = { imovelId: string; inicio: string; fim: string };
export type OcupacaoImovel = { imovelId: string; vendidas: number; bloqueadas: number; disponiveis: number; taxa: number | null };

/** Ocupação por imóvel. Sem noites disponíveis (tudo bloqueado), a taxa fica null. */
export function calcularOcupacao(imovelIds: readonly string[], reservas: readonly Intervalo[], bloqueios: readonly Intervalo[], periodo: { inicio: string; fim: string }): OcupacaoImovel[] {
  const total = diasEntre(periodo.inicio, periodo.fim);
  return imovelIds.map((id) => {
    const noites = (xs: readonly Intervalo[]) => {
      // Dias já contados (evita somar duas vezes reservas/bloqueios sobrepostos).
      const dias = new Set<number>();
      for (const x of xs.filter((y) => y.imovelId === id)) {
        const a = Math.max(utc(x.inicio), utc(periodo.inicio));
        const b = Math.min(utc(x.fim), utc(periodo.fim));
        for (let t = a; t < b; t += DIA) dias.add(t);
      }
      return dias;
    };
    const bloq = noites(bloqueios);
    const vend = [...noites(reservas)].filter((t) => !bloq.has(t)).length;
    const disponiveis = total - bloq.size;
    return { imovelId: id, vendidas: vend, bloqueadas: bloq.size, disponiveis, taxa: disponiveis > 0 ? vend / disponiveis : null };
  });
}

export function ocupacaoTotal(lista: readonly OcupacaoImovel[]): { vendidas: number; disponiveis: number; taxa: number | null } {
  const vendidas = lista.reduce((s, x) => s + x.vendidas, 0);
  const disponiveis = lista.reduce((s, x) => s + x.disponiveis, 0);
  return { vendidas, disponiveis, taxa: disponiveis > 0 ? vendidas / disponiveis : null };
}

export type Financeiro = {
  receitaBruta: number;
  taxasCanais: number;
  comissoes: number;
  despesasEmpresa: number;
  ajustesEmpresa: number;
  resultadoEmpresa: number;
};

/**
 * Números financeiros a partir dos totais por tipo (valores do livro, estornos já anulados).
 * `ajustesEmpresa` recebe os ajustes que mexem no resultado (os do acerto têm valor 0).
 */
export function resumoFinanceiro(t: Partial<Record<TipoLancamento, number>>): Financeiro {
  const v = (k: TipoLancamento) => t[k] ?? 0;
  // Sem "-0" (apareceria como "-R$ 0,00").
  const neg = (x: number) => (x === 0 ? 0 : -x);
  const comissoes = v("comissao");
  const despesasEmpresa = neg(v("despesa_empresa"));
  const ajustesEmpresa = v("ajuste");
  return {
    receitaBruta: v("receita_bruta"),
    taxasCanais: neg(v("taxa_canal")),
    comissoes,
    despesasEmpresa,
    ajustesEmpresa,
    resultadoEmpresa: comissoes - despesasEmpresa + ajustesEmpresa,
  };
}

/** Os 12 meses do ano (para o gráfico), preenchendo com zero os meses sem movimento. */
export function mesesDoAno(ano: number, porMes: ReadonlyMap<string, { receitaBruta: number; comissoes: number }>) {
  return Array.from({ length: 12 }, (_, i) => {
    const chave = `${ano}-${String(i + 1).padStart(2, "0")}`;
    return { mes: i + 1, ...(porMes.get(chave) ?? { receitaBruta: 0, comissoes: 0 }) };
  });
}
