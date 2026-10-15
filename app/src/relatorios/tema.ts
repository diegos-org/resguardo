/**
 * Cores do relatório em PDF (M5.7): os mesmos valores dos tokens do M7.5 (`requisitos/product/DESIGN.md` é a fonte;
 * `src/app/globals.css` os usa na tela). Uma lista só, para o PDF e o site não divergirem. Nenhuma cor fixa fora daqui.
 * Também a cor da barra do navegador no celular (M7.18, `viewport` do layout raiz: `floresta`); um teste confere que ela
 * é o valor de `--scl-floresta` em globals.css.
 */
export const TEMA = {
  floresta: "#505b46",
  profundo: "#3d4736",
  musgo: "#58684d",
  salvia: "#626e55",
  creme: "#f3eee3",
  papel: "#f8f4ea",
  areia: "#e6dcc8",
  /** Só decoração (itálico da marca grande, filetes): nunca em texto pequeno. */
  dourado: "#c9a96e",
  /** Texto dourado pequeno sobre os verdes. */
  douradoClaro: "#ecd8b0",
  /** Texto dourado pequeno sobre fundos claros. */
  douradoEscuro: "#75592a",
  tinta: "#252b23",
  texto2: "#5b604f",
  borda: "#cfc1a9",
  /** Barras dos meses anteriores no gráfico (o mês atual usa floresta). */
  barra: "#8f9a82",
  branco: "#ffffff",
} as const;
export type CorDoTema = keyof typeof TEMA;
