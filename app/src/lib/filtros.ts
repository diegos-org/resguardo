/**
 * Filtro global do painel (imóveis + período), guardado na URL para poder ser
 * compartilhado e reaproveitado por qualquer tela. Ver requisitos/product/ARCHITECTURE-NOTES.md.
 */

export type OpcaoImovel = { codigo: string; nome: string };

/**
 * Lista provisória até o cadastro de imóveis (M2.1) ir para o banco.
 * Búzios é operado, mas não aparece no site público.
 */
export const IMOVEIS_PROVISORIOS: readonly OpcaoImovel[] = [
  { codigo: "102", nome: "102" },
  { codigo: "103", nome: "103" },
  { codigo: "303", nome: "303" },
  { codigo: "399", nome: "399" },
  { codigo: "403", nome: "403" },
  { codigo: "buzios", nome: "Búzios" },
];

export type Filtros = {
  /** Códigos selecionados; lista vazia significa "todos os imóveis". */
  imoveis: string[];
  ano: number;
  /** 1–12, ou `null` para o ano inteiro. */
  mes: number | null;
};

type Params = Record<string, string | string[] | undefined>;

const FUSO = "America/Sao_Paulo";

export function hojeNoFuso(agora: Date = new Date()): { ano: number; mes: number } {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "numeric" }).formatToParts(agora);
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
  return { ano: valor("year"), mes: valor("month") };
}

function lista(valor: string | string[] | undefined): string[] {
  if (valor === undefined) return [];
  return (Array.isArray(valor) ? valor : [valor]).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
}

function primeiro(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

function inteiro(valor: string | undefined): number | undefined {
  if (valor === undefined || !/^\d+$/.test(valor)) return undefined;
  return Number(valor);
}

/** Seleção explícita e validada, inclusive quando todos os imóveis foram marcados. */
export function lerImoveisSelecionados(params: Params, opcoes: readonly OpcaoImovel[]): string[] {
  const validos = new Set(opcoes.map((o) => o.codigo));
  return [...new Set(lista(params.imovel))].filter((c) => validos.has(c));
}

/** Lê os filtros da URL. Valores inválidos ou desconhecidos são ignorados. */
export function lerFiltros(
  params: Params,
  opcoes: readonly OpcaoImovel[] = IMOVEIS_PROVISORIOS,
  agora: Date = new Date(),
): Filtros {
  const hoje = hojeNoFuso(agora);
  const validos = new Set(opcoes.map((o) => o.codigo));
  const imoveis = lerImoveisSelecionados(params, opcoes);

  const ano = inteiro(primeiro(params.ano));
  const anoOk = ano !== undefined && ano >= 2000 && ano <= 2100 ? ano : hoje.ano;

  const mesTexto = primeiro(params.mes);
  let mes: number | null;
  if (mesTexto === "todos") {
    mes = null;
  } else {
    const m = inteiro(mesTexto);
    mes = m !== undefined && m >= 1 && m <= 12 ? m : hoje.mes;
  }

  return { imoveis: imoveis.length === validos.size ? [] : imoveis, ano: anoOk, mes };
}

/** Converte filtros de volta para a query string da URL. */
export function filtrosParaQuery(f: Filtros): string {
  const q = new URLSearchParams();
  for (const c of f.imoveis) q.append("imovel", c);
  q.set("ano", String(f.ano));
  q.set("mes", f.mes === null ? "todos" : String(f.mes));
  return q.toString();
}

const CHAVES_FILTRO = ["imovel", "ano", "mes"] as const;

/**
 * Mantém só os parâmetros do filtro global, como vieram na URL, para levá-los
 * adiante ao navegar entre seções. Retorna "" ou "?imovel=...&ano=...".
 */
export function manterFiltros(params: Params | URLSearchParams): string {
  const q = new URLSearchParams();
  for (const chave of CHAVES_FILTRO) {
    const valores = params instanceof URLSearchParams ? params.getAll(chave) : [params[chave] ?? []].flat();
    for (const v of valores) q.append(chave, v);
  }
  const texto = q.toString();
  return texto ? `?${texto}` : "";
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function nomeDoMes(mes: number): string {
  return MESES[mes - 1];
}

/** Texto curto que descreve a seleção, ex.: "Todos os imóveis · setembro de 2026". */
export function descreverFiltros(f: Filtros, opcoes: readonly OpcaoImovel[] = IMOVEIS_PROVISORIOS): string {
  const nomes = f.imoveis.map((c) => opcoes.find((o) => o.codigo === c)?.nome ?? c);
  const imoveis = nomes.length === 0 ? "Todos os imóveis" : nomes.join(", ");
  const periodo = f.mes === null ? `ano de ${f.ano}` : `${nomeDoMes(f.mes)} de ${f.ano}`;
  return `${imoveis} · ${periodo}`;
}

/** Período [inicio, fim) do filtro: o mês escolhido ou o ano inteiro. */
export function periodoDosFiltros(f: Filtros): { inicio: string; fim: string } {
  const p = (n: number) => String(n).padStart(2, "0");
  if (f.mes === null) return { inicio: `${f.ano}-01-01`, fim: `${f.ano + 1}-01-01` };
  const fimAno = f.mes === 12 ? f.ano + 1 : f.ano;
  const fimMes = f.mes === 12 ? 1 : f.mes + 1;
  return { inicio: `${f.ano}-${p(f.mes)}-01`, fim: `${fimAno}-${p(fimMes)}-01` };
}
