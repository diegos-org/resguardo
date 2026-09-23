/**
 * Monta a grade do calendário (pura, testável): linhas = imóveis, colunas = dias do período.
 * Cada reserva/bloqueio vira um segmento que ocupa as NOITES (entrada até a véspera da saída).
 */

export type ItemCalendario = {
  id: string;
  imovelId: string;
  inicio: string; // entrada / início
  fim: string; // saída / fim (exclusivo)
  tipo: "reserva" | "bloqueio";
  rotulo: string;
  href?: string;
  categoria: string; // origem da reserva ou "bloqueio"
  conflito?: boolean;
};

export type Segmento = ItemCalendario & {
  /** Coluna inicial (1 = primeiro dia) e quantidade de colunas. */
  coluna: number;
  largura: number;
  /** Começou antes / termina depois do período mostrado. */
  continuaAntes: boolean;
  continuaDepois: boolean;
  /** Faixa vertical para itens sobrepostos no mesmo imóvel (0, 1, 2…). */
  faixa: number;
};

export type LinhaCalendario = { imovelId: string; segmentos: Segmento[]; faixas: number };

export function diasDoPeriodo(inicio: string, fim: string): string[] {
  const dias: string[] = [];
  for (let t = Date.parse(`${inicio}T00:00:00Z`); t < Date.parse(`${fim}T00:00:00Z`); t += 86_400_000) {
    dias.push(new Date(t).toISOString().slice(0, 10));
  }
  return dias;
}

const indiceDia = (inicio: string, dia: string) => Math.round((Date.parse(`${dia}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86_400_000);

export function montarCalendario(periodo: { inicio: string; fim: string }, imovelIds: readonly string[], itens: readonly ItemCalendario[]): LinhaCalendario[] {
  const totalDias = indiceDia(periodo.inicio, periodo.fim);
  return imovelIds.map((imovelId) => {
    const doImovel = itens
      .filter((i) => i.imovelId === imovelId && i.inicio < periodo.fim && i.fim > periodo.inicio)
      .sort((a, b) => a.inicio.localeCompare(b.inicio) || a.fim.localeCompare(b.fim));
    const fimDasFaixas: string[] = [];
    const segmentos = doImovel.map((item) => {
      const a = Math.max(0, indiceDia(periodo.inicio, item.inicio));
      const b = Math.min(totalDias, indiceDia(periodo.inicio, item.fim));
      let faixa = fimDasFaixas.findIndex((fim) => fim <= item.inicio);
      if (faixa === -1) faixa = fimDasFaixas.push(item.fim) - 1;
      else fimDasFaixas[faixa] = item.fim;
      return {
        ...item,
        coluna: a + 1,
        largura: Math.max(1, b - a),
        continuaAntes: item.inicio < periodo.inicio,
        continuaDepois: item.fim > periodo.fim,
        faixa,
      };
    });
    return { imovelId, segmentos, faixas: Math.max(1, fimDasFaixas.length) };
  });
}

/** Mês anterior e seguinte, para as setas. */
export function mesesVizinhos(ano: number, mes: number) {
  return {
    anterior: mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 },
    seguinte: mes === 12 ? { ano: ano + 1, mes: 1 } : { ano, mes: mes + 1 },
  };
}
