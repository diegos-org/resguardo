/**
 * Período do portal do proprietário (M5.1): mês ou ano, com navegação limitada a nove meses
 * para trás e nove para a frente do mês atual (fuso de São Paulo). Puro, sem banco.
 */
import { type Filtros, hojeNoFuso, lerFiltros, type OpcaoImovel } from "@/lib/filtros";

export const JANELA_MESES = 9;

type Params = Record<string, string | string[] | undefined>;
type Mes = { ano: number; mes: number };

const indice = (m: Mes) => m.ano * 12 + (m.mes - 1);
const deIndice = (i: number): Mes => ({ ano: Math.floor(i / 12), mes: (i % 12) + 1 });

/** Primeiro e último mês que o portal mostra. */
export function janela(agora: Date = new Date()): { de: Mes; ate: Mes; atual: Mes } {
  const atual = hojeNoFuso(agora);
  return { de: deIndice(indice(atual) - JANELA_MESES), ate: deIndice(indice(atual) + JANELA_MESES), atual };
}

export type SituacaoPeriodo = "fechado" | "parcial" | "futuro";

/** Mês já terminado, o atual (ainda pode mudar) ou futuro (só o que já está reservado). Ano: pelo mês atual. */
export function situacaoDoPeriodo(f: Pick<Filtros, "ano" | "mes">, agora: Date = new Date()): SituacaoPeriodo {
  const atual = hojeNoFuso(agora);
  if (f.mes === null) return f.ano < atual.ano ? "fechado" : f.ano === atual.ano ? "parcial" : "futuro";
  const d = indice({ ano: f.ano, mes: f.mes }) - indice(atual);
  return d < 0 ? "fechado" : d === 0 ? "parcial" : "futuro";
}

/**
 * Lê o filtro da URL (mesmos parâmetros do painel: imovel, ano, mes) só com os imóveis do
 * proprietário, e mantém o período dentro da janela. Fora dela, volta ao limite e avisa.
 */
export function lerPeriodoPortal(params: Params, opcoes: readonly OpcaoImovel[], agora: Date = new Date()): { filtros: Filtros; aviso?: string } {
  const f = lerFiltros(params, opcoes, agora);
  const j = janela(agora);
  if (f.mes === null) {
    if (f.ano < j.de.ano || f.ano > j.ate.ano) {
      return { filtros: { ...f, ano: j.atual.ano }, aviso: `O portal mostra de ${nome(j.de)} a ${nome(j.ate)}: voltamos para ${j.atual.ano}.` };
    }
    return { filtros: f };
  }
  const i = indice({ ano: f.ano, mes: f.mes });
  if (i < indice(j.de) || i > indice(j.ate)) {
    const limite = i < indice(j.de) ? j.de : j.ate;
    return { filtros: { ...f, ...limite }, aviso: `O portal mostra de ${nome(j.de)} a ${nome(j.ate)}: mostrando ${nome(limite)}.` };
  }
  return { filtros: f };
}

/** Mês anterior e seguinte (null quando sairia da janela). Na visão do ano, o ano anterior/seguinte. */
export function vizinhos(f: Pick<Filtros, "ano" | "mes">, agora: Date = new Date()): { anterior: Mes | { ano: number; mes: null } | null; seguinte: Mes | { ano: number; mes: null } | null } {
  const j = janela(agora);
  if (f.mes === null) {
    return {
      anterior: f.ano - 1 >= j.de.ano ? { ano: f.ano - 1, mes: null } : null,
      seguinte: f.ano + 1 <= j.ate.ano ? { ano: f.ano + 1, mes: null } : null,
    };
  }
  const i = indice({ ano: f.ano, mes: f.mes });
  return { anterior: i - 1 >= indice(j.de) ? deIndice(i - 1) : null, seguinte: i + 1 <= indice(j.ate) ? deIndice(i + 1) : null };
}

/** Meses da janela, para o seletor. */
export function mesesDaJanela(agora: Date = new Date()): Mes[] {
  const j = janela(agora);
  return Array.from({ length: indice(j.ate) - indice(j.de) + 1 }, (_, k) => deIndice(indice(j.de) + k));
}

const NOMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const nome = (m: Mes) => `${NOMES[m.mes - 1]} de ${m.ano}`;
