/**
 * PDF do relatório mensal do proprietário no modelo oficial (M5.7, decisão de Diego em 4/10/2026): quatro páginas em
 * A4 — capa e resultado; números do mês (quadros 2×2 e barras de 12 meses) e reservas; conciliação e repasses; anexos
 * (extratos oficiais dos canais, copiados como emitidos). Cores pelos tokens do M7.5 (`tema.ts`), títulos em serifa,
 * corpo sem serifa. O PDF só desenha: todo texto vem de `textosDoRelatorio`. Uma página que não cabe continua na
 * seguinte, com a mesma faixa; a numeração "N de M" conta só as páginas desenhadas aqui (os extratos copiados têm a
 * numeração deles).
 */
import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import { escalaEmMil, mesCurto } from "./metricas";
import type { LinhaConciliacaoTexto, LinhaReserva, LinhaValor, TextosRelatorio } from "./relatorio";
import { TEMA } from "./tema";

/** Limites dos anexos (a Vercel recusa pedidos acima de ~4,5 MB no total). */
export const LIMITE_FOTO = 2 * 1024 * 1024;
export const LIMITE_EXTRATO = 2 * 1024 * 1024;

/** Erro que pode ser mostrado ao usuário como está. */
export class ErroRelatorio extends Error {}

export type ExtratoAnexo = {
  /** Nome do canal ("Airbnb", "Booking.com"); aparece no selo do anexo. */
  canal: string;
  /** Título do documento ("Relatório de ganhos — outubro de 2026"); opcional. */
  nome?: string;
  bytes: Uint8Array;
  /** Quais páginas usar ("1-2, 4"); vazio = todas. */
  paginas?: string;
};

export type Anexos = {
  /** Foto real do imóvel (JPG ou PNG). Sem foto, a capa mostra o quadro "foto em breve" (nunca uma genérica). */
  foto?: Uint8Array | null;
  /** Um extrato só (formulário do painel): vale como `extratos` com um item. */
  extrato?: { bytes: Uint8Array; paginas?: string; canal?: string; nome?: string } | null;
  /** Extratos oficiais, um por canal, na ordem em que entram no fim. */
  extratos?: ExtratoAnexo[];
};

const cor = (hex: string) => rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
const C = {
  floresta: cor(TEMA.floresta),
  musgo: cor(TEMA.musgo),
  creme: cor(TEMA.creme),
  papel: cor(TEMA.papel),
  areia: cor(TEMA.areia),
  dourado: cor(TEMA.dourado),
  douradoClaro: cor(TEMA.douradoClaro),
  douradoEscuro: cor(TEMA.douradoEscuro),
  tinta: cor(TEMA.tinta),
  texto2: cor(TEMA.texto2),
  borda: cor(TEMA.borda),
  barra: cor(TEMA.barra),
  branco: cor(TEMA.branco),
};

const L = 595.28;
const A = 841.89;
const M = 36;
const LARG = L - 2 * M;
const RODAPE = 30;

const eJpg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const ePng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const ePdf = (b: Uint8Array) => b.length > 5 && String.fromCharCode(...b.slice(0, 5)) === "%PDF-";

/**
 * Páginas escolhidas do extrato ("" = todas), em índices a partir de 0, na ordem digitada e sem
 * repetir. Formato: números e intervalos separados por vírgula ("1-2, 4").
 */
export function lerPaginas(texto: string | undefined, total: number): number[] {
  const t = (texto ?? "").trim();
  if (!t) return Array.from({ length: total }, (_, i) => i);
  const saida: number[] = [];
  for (const parte of t.split(",").map((p) => p.trim())) {
    const m = /^(\d{1,4})(?:\s*-\s*(\d{1,4}))?$/.exec(parte);
    if (!m) throw new ErroRelatorio(`Páginas do extrato: "${parte}" não é um número nem um intervalo (ex.: 1-2, 4).`);
    const de = Number(m[1]);
    const ate = m[2] ? Number(m[2]) : de;
    if (de < 1 || ate < de) throw new ErroRelatorio(`Páginas do extrato: intervalo "${parte}" inválido.`);
    if (ate > total) throw new ErroRelatorio(`Páginas do extrato: o arquivo tem ${total} página(s), não dá para usar a ${ate}.`);
    for (let p = de; p <= ate; p++) if (!saida.includes(p - 1)) saida.push(p - 1);
  }
  return saida;
}

/** Os extratos dos anexos numa lista só (o campo antigo `extrato` vira um item). */
export function extratosDe(a: Anexos): ExtratoAnexo[] {
  return [...(a.extratos ?? []), ...(a.extrato ? [{ canal: a.extrato.canal ?? "Canal", nome: a.extrato.nome, bytes: a.extrato.bytes, paginas: a.extrato.paginas }] : [])];
}

/** Confere os anexos antes de gerar (tipo e tamanho); a mensagem vai direto para a tela. */
export function conferirAnexos(a: Anexos): void {
  if (a.foto) {
    if (a.foto.length > LIMITE_FOTO) throw new ErroRelatorio("A foto passa de 2 MB: use uma versão menor.");
    if (!eJpg(a.foto) && !ePng(a.foto)) throw new ErroRelatorio("A foto precisa ser JPG ou PNG.");
  }
  for (const e of extratosDe(a)) {
    if (e.bytes.length > LIMITE_EXTRATO) throw new ErroRelatorio(`O extrato${e.canal ? ` (${e.canal})` : ""} passa de 2 MB: exporte só o período do mês.`);
    if (!ePdf(e.bytes)) throw new ErroRelatorio(`O extrato${e.canal ? ` (${e.canal})` : ""} precisa ser o PDF oficial do canal.`);
  }
}

/** Sinais fora da fonte padrão que têm um parecido nela; o resto vira "?". */
const TROCAS: Record<string, string> = { "→": "›", "−": "-", "✓": "ok", "≥": ">=", "≤": "<=" };

/** Texto que a fonte padrão do PDF consegue escrever (acentos do português, sim; emoji, não). */
function limpador(fonte: PDFFont) {
  const cache = new Map<string, boolean>();
  const ok = (c: string) => {
    let v = cache.get(c);
    if (v === undefined) {
      try {
        fonte.encodeText(c);
        v = true;
      } catch {
        v = false;
      }
      cache.set(c, v);
    }
    return v;
  };
  return (s: string) =>
    Array.from(s.normalize("NFC").replace(/[\t\r\n]+/g, " "))
      .map((c) => (ok(c) ? c : (TROCAS[c] ?? "?")))
      .join("");
}

type Fontes = { serif: PDFFont; serifN: PDFFont; serifI: PDFFont; sans: PDFFont; sansN: PDFFont };

function quebrar(s: string, fonte: PDFFont, tam: number, largura: number): string[] {
  const linhas: string[] = [];
  let atual = "";
  for (const palavra of s.split(" ").filter(Boolean)) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (fonte.widthOfTextAtSize(tentativa, tam) <= largura || !atual) atual = tentativa;
    else {
      linhas.push(atual);
      atual = palavra;
    }
  }
  if (atual) linhas.push(atual);
  return linhas.length ? linhas : [""];
}

function cortar(s: string, fonte: PDFFont, tam: number, largura: number): string {
  if (fonte.widthOfTextAtSize(s, tam) <= largura) return s;
  let t = s;
  while (t.length > 1 && fonte.widthOfTextAtSize(`${t}…`, tam) > largura) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

type Col<T> = { chave: keyof T; titulo: string; w: number; direita?: boolean; quebra?: boolean };

/** Escreve de cima para baixo nas páginas desenhadas aqui; abre outra (com a faixa fina) quando falta espaço. */
class Folhas {
  readonly paginas: { page: PDFPage; rodape: string }[] = [];
  page!: PDFPage;
  y = 0;
  constructor(
    private doc: PDFDocument,
    private f: Fontes,
    private limpo: (s: string) => string,
    private t: TextosRelatorio,
  ) {}

  /** Página nova com a faixa fina (marca + imóvel · mês); devolve o topo livre. */
  nova(rodape: string) {
    this.page = this.doc.addPage([L, A]);
    this.paginas.push({ page: this.page, rodape });
    this.page.drawRectangle({ x: 0, y: A - 34, width: L, height: 34, color: C.floresta });
    this.marca(M, A - 22, 13);
    this.textoDireita(this.t.cabecalhoCurto, L - M, A - 21, this.f.sans, 8.5, C.creme);
    this.y = A - 34 - 22;
  }

  /** Capa: faixa alta com olho, marca, emissão e período. */
  capa(rodape: string) {
    this.page = this.doc.addPage([L, A]);
    this.paginas.push({ page: this.page, rodape });
    this.page.drawRectangle({ x: 0, y: A - 78, width: L, height: 78, color: C.floresta });
    this.page.drawRectangle({ x: 0, y: A - 80, width: L, height: 2, color: C.dourado });
    this.texto(this.t.olho.toUpperCase(), M, A - 26, this.f.sans, 7.5, C.douradoClaro);
    this.marca(M, A - 54, 22);
    this.textoDireita(this.t.emissao, L - M, A - 28, this.f.sans, 8.5, C.creme);
    this.textoDireita(this.t.periodo, L - M, A - 42, this.f.sans, 8.5, C.creme);
    this.y = A - 80 - 26;
  }

  private marca(x: number, y: number, tam: number) {
    const inicio = this.limpo(this.t.marca.inicio);
    this.page.drawText(inicio, { x, y, size: tam, font: this.f.serifN, color: C.branco });
    if (this.t.marca.destaque) this.page.drawText(this.limpo(this.t.marca.destaque), { x: x + this.f.serifN.widthOfTextAtSize(`${inicio} `, tam), y, size: tam, font: this.f.serifI, color: C.dourado });
  }

  /** Garante `altura` pontos livres; se não houver, continua numa página nova. Devolve se abriu página. */
  espaco(altura: number): boolean {
    if (this.y - altura >= RODAPE + 10) return false;
    this.nova(this.paginas.at(-1)!.rodape);
    return true;
  }

  texto(s: string, x: number, y: number, fonte: PDFFont, tam: number, c = C.tinta) {
    this.page.drawText(this.limpo(s), { x, y, size: tam, font: fonte, color: c });
  }

  textoDireita(s: string, xDireita: number, y: number, fonte: PDFFont, tam: number, c = C.tinta) {
    const l = this.limpo(s);
    this.page.drawText(l, { x: xDireita - fonte.widthOfTextAtSize(l, tam), y, size: tam, font: fonte, color: c });
  }

  /** Parágrafo a partir do cursor; devolve a altura usada. */
  paragrafo(s: string, fonte: PDFFont, tam: number, c = C.tinta, largura = LARG, x = M, entre = 1.3): number {
    let usado = 0;
    for (const linha of quebrar(this.limpo(s), fonte, tam, largura)) {
      this.espaco(tam * entre);
      this.y -= tam;
      this.page.drawText(linha, { x, y: this.y, size: tam, font: fonte, color: c });
      this.y -= tam * (entre - 1);
      usado += tam * entre;
    }
    return usado;
  }

  /** Linhas de texto numa posição fixa (sem mexer no cursor); devolve a altura. */
  bloco(s: string, x: number, topo: number, fonte: PDFFont, tam: number, c: ReturnType<typeof rgb>, largura: number, entre = 1.3): number {
    let y = topo;
    for (const linha of quebrar(this.limpo(s), fonte, tam, largura)) {
      y -= tam;
      this.page.drawText(linha, { x, y, size: tam, font: fonte, color: c });
      y -= tam * (entre - 1);
    }
    return topo - y;
  }

  alturaDe(s: string, fonte: PDFFont, tam: number, largura: number, entre = 1.3): number {
    return quebrar(this.limpo(s), fonte, tam, largura).length * tam * entre;
  }

  h2(s: string, sub?: string) {
    this.espaco(sub ? 44 : 28);
    this.y -= 15;
    this.texto(s, M, this.y, this.f.serifN, 15, C.floresta);
    this.y -= 8;
    if (sub) this.paragrafo(sub, this.f.sans, 8.5, C.texto2);
    this.y -= 6;
  }

  h3(s: string) {
    this.espaco(24);
    this.y -= 11;
    this.texto(s, M, this.y, this.f.serifN, 11, C.floresta);
    this.y -= 7;
  }

  /** Caixa areia com filete dourado (avisos). */
  caixaAvisos(titulo: string, itens: readonly string[]) {
    const linhas = itens.flatMap((i) => quebrar(this.limpo(`• ${i}`), this.f.sans, 8.5, LARG - 24));
    const altura = 16 + linhas.length * 11 + 8;
    this.espaco(altura);
    this.page.drawRectangle({ x: M, y: this.y - altura, width: LARG, height: altura, color: C.areia });
    this.page.drawRectangle({ x: M, y: this.y - altura, width: 3, height: altura, color: C.dourado });
    this.texto(titulo, M + 12, this.y - 12, this.f.sansN, 8.5, C.tinta);
    let y = this.y - 16;
    for (const l of linhas) {
      y -= 11;
      this.page.drawText(l, { x: M + 12, y, size: 8.5, font: this.f.sans, color: C.tinta });
    }
    this.y -= altura + 10;
  }

  /** Tabela de duas colunas (texto + valor) com linhas "normal", "sub", "total". */
  tabelaValores(titulo: string | null, linhas: readonly LinhaValor[], largura = LARG, x = M) {
    const ALT = 15;
    if (titulo) {
      this.espaco(ALT);
      this.page.drawRectangle({ x, y: this.y - ALT, width: largura, height: ALT, color: C.areia });
      this.texto(titulo, x + 6, this.y - 10.5, this.f.sansN, 8, C.texto2);
      this.textoDireita("R$", x + largura - 6, this.y - 10.5, this.f.sansN, 8, C.texto2);
      this.y -= ALT;
    }
    for (const l of linhas) {
      const fonte = l.tipo === "total" ? this.f.sansN : this.f.sans;
      const c = l.tipo === "sub" || l.tipo === "info" ? C.texto2 : C.tinta;
      const valor = this.limpo(l.valor.replace(/^R\$\s?/, "").replace(/^(−|-)\s*R\$\s?/, "− "));
      const largTexto = largura - 12 - this.f.sansN.widthOfTextAtSize(valor, 8.5) - 8;
      const texto = quebrar(this.limpo(l.texto), fonte, 8.5, largTexto);
      const etiqueta = l.etiqueta ? quebrar(this.limpo(l.etiqueta), this.f.sans, 7, largTexto) : [];
      const altura = 5 + texto.length * 10.5 + etiqueta.length * 9 + 3;
      this.espaco(altura);
      if (l.tipo === "total") this.page.drawRectangle({ x, y: this.y, width: largura, height: 0.8, color: C.dourado });
      let y = this.y - 4;
      for (const t of texto) {
        y -= 10.5;
        this.page.drawText(t, { x: x + 6, y: y + 2, size: 8.5, font: fonte, color: c });
      }
      for (const e of etiqueta) {
        y -= 9;
        this.page.drawText(e, { x: x + 6, y: y + 2, size: 7, font: this.f.sans, color: l.tipo === "aviso" ? C.douradoEscuro : C.texto2 });
      }
      this.page.drawText(valor, { x: x + largura - 6 - this.f.sansN.widthOfTextAtSize(valor, 8.5), y: this.y - 4 - 10.5 + 2, size: 8.5, font: l.tipo === "total" || l.tipo === "normal" ? this.f.sansN : this.f.sans, color: c });
      this.y -= altura;
      this.page.drawRectangle({ x, y: this.y, width: largura, height: 0.4, color: C.areia });
    }
    this.y -= 6;
  }

  /** Tabela com colunas; células com `quebra` embrulham o texto e a linha cresce. */
  tabela<T extends Record<string, string>>(colunas: readonly Col<T>[], linhas: readonly T[], o: { total?: T | null; destaqueTipo?: (l: T) => "normal" | "sub" | "total" | "ponte" } = {}) {
    const ALT = 15;
    const cabecalho = () => {
      this.espaco(ALT);
      this.page.drawRectangle({ x: M, y: this.y - ALT, width: LARG, height: ALT, color: C.areia });
      let x = M;
      for (const c of colunas) {
        const s = this.limpo(c.titulo);
        const px = c.direita ? x + c.w - 5 - this.f.sansN.widthOfTextAtSize(s, 7.5) : x + 5;
        this.page.drawText(s, { x: px, y: this.y - 10.5, size: 7.5, font: this.f.sansN, color: C.texto2 });
        x += c.w;
      }
      this.y -= ALT;
    };
    const linha = (l: T, i: number, tipo: "normal" | "sub" | "total" | "ponte") => {
      const celulas = colunas.map((c) => (c.quebra ? quebrar(this.limpo(String(l[c.chave] ?? "")), tipo === "total" ? this.f.sansN : this.f.sans, 8, c.w - 10) : [cortar(this.limpo(String(l[c.chave] ?? "")), this.f.sans, 8, c.w - 10)]));
      const nLinhas = Math.max(1, ...celulas.map((c) => c.length));
      const altura = 6 + nLinhas * 10;
      if (this.espaco(altura)) cabecalho();
      if (tipo === "total" || tipo === "sub") this.page.drawRectangle({ x: M, y: this.y - altura, width: LARG, height: altura, color: C.areia });
      else if (i % 2 === 1) this.page.drawRectangle({ x: M, y: this.y - altura, width: LARG, height: altura, color: C.papel });
      let x = M;
      for (const [k, c] of colunas.entries()) {
        const fonte = tipo === "total" || tipo === "sub" ? this.f.sansN : this.f.sans;
        const corTexto = tipo === "ponte" ? C.texto2 : C.tinta;
        let y = this.y - 3;
        for (const s of celulas[k]) {
          y -= 10;
          const px = c.direita ? x + c.w - 5 - fonte.widthOfTextAtSize(s, 8) : x + 5;
          this.page.drawText(s, { x: px, y: y + 1, size: 8, font: fonte, color: corTexto });
        }
        x += c.w;
      }
      this.y -= altura;
    };
    cabecalho();
    linhas.forEach((l, i) => linha(l, i, o.destaqueTipo?.(l) ?? "normal"));
    if (o.total) linha(o.total, linhas.length, "total");
    this.page.drawRectangle({ x: M, y: this.y, width: LARG, height: 0.8, color: C.dourado });
    this.y -= 8;
  }

  /** Tabela das reservas: a primeira coluna tem duas linhas (hóspede · canal · código; situação). */
  tabelaReservas(linhas: readonly LinhaReserva[], total: LinhaReserva | null, comImovel: boolean) {
    const colunas: { titulo: string; w: number; direita?: boolean; de: (l: LinhaReserva) => string }[] = [
      { titulo: "Hóspede · canal · situação", w: 190, de: () => "" },
      { titulo: "Datas", w: 60, de: (l) => l.datas },
      { titulo: "Noites", w: 40, direita: true, de: (l) => l.noites },
      { titulo: "Bruto", w: 60, direita: true, de: (l) => l.bruto.replace(/^R\$\s?/, "") },
      { titulo: "Taxa do canal", w: 56, direita: true, de: (l) => l.taxa.replace(/^R\$\s?/, "") },
      { titulo: "Gestão", w: 54, direita: true, de: (l) => l.gestao.replace(/^R\$\s?/, "") },
      { titulo: "Sua parte", w: LARG - 460, direita: true, de: (l) => l.suaParte.replace(/^R\$\s?/, "") },
    ];
    const ALT = 15;
    const cabecalho = () => {
      this.espaco(ALT);
      this.page.drawRectangle({ x: M, y: this.y - ALT, width: LARG, height: ALT, color: C.areia });
      let x = M;
      for (const c of colunas) {
        const s = this.limpo(c.titulo);
        const px = c.direita ? x + c.w - 5 - this.f.sansN.widthOfTextAtSize(s, 7.5) : x + 5;
        this.page.drawText(s, { x: px, y: this.y - 10.5, size: 7.5, font: this.f.sansN, color: C.texto2 });
        x += c.w;
      }
      this.y -= ALT;
    };
    cabecalho();
    const corSituacao = (tipo: LinhaReserva["situacaoTipo"]) => (tipo === "ok" ? C.musgo : tipo === "info" ? C.douradoEscuro : C.tinta);
    for (const [i, l] of linhas.entries()) {
      const altura = 25;
      if (this.espaco(altura)) cabecalho();
      if (i % 2 === 1) this.page.drawRectangle({ x: M, y: this.y - altura, width: LARG, height: altura, color: C.papel });
      // Primeira coluna: hóspede em negrito, canal e código; embaixo, a situação.
      const hospede = this.limpo(comImovel && l.imovel ? `${l.imovel} · ${l.hospede}` : l.hospede);
      const resto = this.limpo(` · ${l.canal}${l.codigo ? ` · ${l.codigo}` : ""}`);
      const hospedeCortado = cortar(hospede, this.f.sansN, 8.5, 180 - this.f.sans.widthOfTextAtSize(resto, 8));
      this.page.drawText(hospedeCortado, { x: M + 5, y: this.y - 11, size: 8.5, font: this.f.sansN, color: C.tinta });
      this.page.drawText(cortar(resto, this.f.sans, 8, 180 - this.f.sansN.widthOfTextAtSize(hospedeCortado, 8.5)), { x: M + 5 + this.f.sansN.widthOfTextAtSize(hospedeCortado, 8.5), y: this.y - 11, size: 8, font: this.f.sans, color: C.tinta });
      if (l.situacao) this.page.drawText(cortar(this.limpo(l.situacao), this.f.sans, 7, 180), { x: M + 5, y: this.y - 21, size: 7, font: this.f.sans, color: corSituacao(l.situacaoTipo) });
      let x = M;
      for (const c of colunas) {
        if (c.titulo !== colunas[0].titulo) {
          const s = cortar(this.limpo(c.de(l)), this.f.sans, 8, c.w - 10);
          const px = c.direita ? x + c.w - 5 - this.f.sans.widthOfTextAtSize(s, 8) : x + 5;
          this.page.drawText(s, { x: px, y: this.y - 15, size: 8, font: this.f.sans, color: C.tinta });
        }
        x += c.w;
      }
      this.y -= altura;
    }
    if (total) {
      const altura = 16;
      if (this.espaco(altura)) cabecalho();
      this.page.drawRectangle({ x: M, y: this.y - altura, width: LARG, height: altura, color: C.areia });
      this.page.drawText(this.limpo(total.hospede), { x: M + 5, y: this.y - 11, size: 8, font: this.f.sansN, color: C.tinta });
      let x = M;
      for (const c of colunas) {
        if (c.titulo !== colunas[0].titulo) {
          const s = this.limpo(c.de(total));
          const px = c.direita ? x + c.w - 5 - this.f.sansN.widthOfTextAtSize(s, 8) : x + 5;
          this.page.drawText(s, { x: px, y: this.y - 11, size: 8, font: this.f.sansN, color: C.tinta });
        }
        x += c.w;
      }
      this.y -= altura;
    }
    this.page.drawRectangle({ x: M, y: this.y, width: LARG, height: 0.8, color: C.dourado });
    this.y -= 8;
  }

  /** Os quatro quadros dos números do mês, em duas linhas de dois. */
  quadros() {
    const w = (LARG - 10) / 2;
    const h = 54;
    for (let linha = 0; linha < 2; linha++) {
      this.espaco(h + 8);
      for (let col = 0; col < 2; col++) {
        const q = this.t.quadros[linha * 2 + col];
        if (!q) continue;
        const x = M + col * (w + 10);
        this.page.drawRectangle({ x, y: this.y - h, width: w, height: h, color: C.papel, borderColor: C.borda, borderWidth: 0.8 });
        if (q.semDado) this.texto(q.valor, x + 10, this.y - 20, this.f.sans, 10.5, C.texto2);
        else this.texto(cortar(this.limpo(q.valor), this.f.serifN, 15, w - 20), x + 10, this.y - 22, this.f.serifN, 15, C.floresta);
        this.bloco(q.legenda, x + 10, this.y - 26, this.f.sans, 7.5, C.texto2, w - 20, 1.25);
      }
      this.y -= h + 8;
    }
  }

  /**
   * Barras dos últimos 12 meses (R$ mil), com hachura para "sem dado"; o mês atual em floresta. Mês com resultado
   * negativo (despesas maiores que a parte do proprietário) entra na escala e desce abaixo da linha do zero, no
   * tamanho real, em dourado escuro.
   */
  grafico() {
    const g = this.t.grafico;
    const h = 150;
    this.espaco(h + 10);
    const topo = this.y;
    this.page.drawRectangle({ x: M, y: topo - h, width: LARG, height: h, color: C.papel, borderColor: C.borda, borderWidth: 0.8 });
    this.texto(g.titulo, M + 10, topo - 15, this.f.serifN, 10, C.floresta);
    if (g.acumulado) this.textoDireita(g.acumulado, M + LARG - 10, topo - 15, this.f.sans, 7.5, C.texto2);
    const x0 = M + 44;
    const x1 = M + LARG - 12;
    const base = topo - h + 26;
    const alturaBarras = h - 26 - 42;
    const valores = g.serie.map((p) => p.resultado).filter((v): v is number => v !== null);
    const max = Math.max(0, ...valores);
    const min = Math.min(0, ...valores);
    // Um passo só para os dois lados; o lado positivo tem sempre ao menos um passo (cabe a hachura do "sem dado").
    const { passo } = escalaEmMil(Math.max(max, -min));
    const topoMil = Math.max(passo, Math.ceil(max / 100_000 / passo) * passo);
    const fundoMil = -Math.ceil(-min / 100_000 / passo) * passo;
    const porMil = alturaBarras / (topoMil - fundoMil);
    const zero = base - fundoMil * porMil;
    for (let v = fundoMil; v <= topoMil; v += passo) {
      const y = base + (v - fundoMil) * porMil;
      this.page.drawLine({ start: { x: x0, y }, end: { x: x1, y }, thickness: 0.6, color: C.areia });
      this.textoDireita(v === 0 ? "0" : `${v} mil`, x0 - 5, y - 2.5, this.f.sans, 7, C.texto2);
    }
    const slot = (x1 - x0) / g.serie.length;
    const w = slot * 0.6;
    for (const [i, p] of g.serie.entries()) {
      const x = x0 + i * slot + (slot - w) / 2;
      if (p.resultado === null) {
        const hb = topoMil * porMil * 0.28;
        this.page.drawRectangle({ x, y: zero, width: w, height: hb, color: C.creme, borderColor: C.borda, borderWidth: 0.6 });
        for (let o = -hb; o < w; o += 5) {
          const xa = Math.max(x, x + o);
          const ya = zero + Math.max(0, -o);
          const xb = Math.min(x + w, x + o + hb);
          const yb = zero + Math.min(hb, w - o);
          if (xb > xa) this.page.drawLine({ start: { x: xa, y: ya }, end: { x: xb, y: yb }, thickness: 0.6, color: C.borda });
        }
      } else {
        const hb = (Math.abs(p.resultado) / 100_000) * porMil;
        // Positivo sobe da linha do zero; negativo desce dela, e o rótulo fica logo acima da linha (o espaço livre).
        if (p.resultado >= 0) this.page.drawRectangle({ x, y: zero, width: w, height: hb, color: p.atual ? C.floresta : C.barra });
        else this.page.drawRectangle({ x, y: zero - hb, width: w, height: hb, color: C.douradoEscuro });
        const rotulo = (p.resultado / 100_000).toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
        const lr = this.limpo(rotulo);
        this.page.drawText(lr, { x: x + w / 2 - this.f.sans.widthOfTextAtSize(lr, 7) / 2, y: (p.resultado >= 0 ? zero + hb : zero) + 3, size: 7, font: this.f.sans, color: C.tinta });
      }
      const lm = this.limpo(mesCurto(p.mes));
      this.page.drawText(lm, { x: x + w / 2 - this.f.sans.widthOfTextAtSize(lm, 7) / 2, y: base - 11, size: 7, font: this.f.sans, color: C.texto2 });
    }
    this.page.drawLine({ start: { x: x0, y: zero }, end: { x: x1, y: zero }, thickness: 0.8, color: C.borda });
    // Legenda.
    let lx = M + 10;
    const ly = topo - h + 8;
    const legenda: (readonly [typeof C.barra, string])[] = [
      [C.barra, "meses anteriores"],
      [C.floresta, g.legendaAtual],
      [C.creme, "sem dado no sistema"],
    ];
    if (min < 0) legenda.push([C.douradoEscuro, "mês negativo (despesas acima da sua parte)"]);
    for (const [c, s] of legenda) {
      this.page.drawRectangle({ x: lx, y: ly, width: 8, height: 6, color: c, borderColor: C.borda, borderWidth: 0.5 });
      this.texto(s, lx + 11, ly, this.f.sans, 7, C.texto2);
      lx += 11 + this.f.sans.widthOfTextAtSize(this.limpo(s), 7) + 14;
    }
    this.y = topo - h - 10;
  }

  /** Rodapés "Página N de M" em todas as páginas desenhadas aqui. */
  rodapes() {
    const total = this.paginas.length;
    for (const [i, p] of this.paginas.entries()) {
      const num = this.limpo(`Página ${i + 1} de ${total}`);
      p.page.drawLine({ start: { x: M, y: RODAPE + 8 }, end: { x: L - M, y: RODAPE + 8 }, thickness: 0.5, color: C.borda });
      p.page.drawText(num, { x: L - M - this.f.sans.widthOfTextAtSize(num, 7), y: RODAPE - 3, size: 7, font: this.f.sans, color: C.texto2 });
      const largura = LARG - this.f.sans.widthOfTextAtSize(num, 7) - 12;
      p.page.drawText(cortar(this.limpo(p.rodape), this.f.sans, 7, largura), { x: M, y: RODAPE - 3, size: 7, font: this.f.sans, color: C.texto2 });
    }
  }
}

const dataDe = (d: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
const dataHora = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);

/** Gera o PDF: as páginas do relatório e, no fim, os extratos oficiais copiados como vieram. */
export async function gerarPdfRelatorio(t: TextosRelatorio, anexos: Anexos = {}, agora: Date = new Date()): Promise<Uint8Array> {
  conferirAnexos(anexos);
  const doc = await PDFDocument.create();
  const f: Fontes = {
    serif: await doc.embedFont(StandardFonts.TimesRoman),
    serifN: await doc.embedFont(StandardFonts.TimesRomanBold),
    serifI: await doc.embedFont(StandardFonts.TimesRomanItalic),
    sans: await doc.embedFont(StandardFonts.Helvetica),
    sansN: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const limpo = limpador(f.sans);

  // Extratos primeiro: se um arquivo não servir, nada é gerado.
  const extratos: { anexo: ExtratoAnexo; doc: PDFDocument; paginas: number[]; total: number }[] = [];
  for (const e of extratosDe(anexos)) {
    let origem: PDFDocument;
    let total: number;
    try {
      origem = await PDFDocument.load(e.bytes, { updateMetadata: false });
      total = origem.getPageCount();
    } catch (err) {
      if (err instanceof Error && /encrypt/i.test(err.message)) throw new ErroRelatorio(`O extrato${e.canal ? ` (${e.canal})` : ""} está protegido por senha: exporte de novo sem senha.`);
      throw new ErroRelatorio(`Não foi possível ler o PDF do extrato${e.canal ? ` (${e.canal})` : ""}.`);
    }
    if (total === 0) throw new ErroRelatorio("O PDF do extrato não tem páginas.");
    extratos.push({ anexo: e, doc: origem, paginas: lerPaginas(e.paginas, total), total });
  }
  let foto: PDFImage | null = null;
  if (anexos.foto) {
    try {
      foto = eJpg(anexos.foto) ? await doc.embedJpg(anexos.foto) : await doc.embedPng(anexos.foto);
    } catch {
      throw new ErroRelatorio("Não foi possível ler a foto: tente outro arquivo JPG ou PNG.");
    }
  }
  const comAnexos = extratos.length > 0;
  // Data e hora de emissão entram aqui, não nos textos: o conteúdo versionado pelo e-mail do fechamento fica estável.
  const tt: TextosRelatorio = {
    ...t,
    emissao: `Emitido em ${dataDe(agora)} · ${t.emissao}`,
    posicao: `Posição extraída do sistema em ${dataHora(agora)} (horário de Brasília). ${t.posicao}`,
  };
  const p = new Folhas(doc, f, limpo, tt);

  // ---- Página 1: capa e resultado -------------------------------------------------------------
  p.capa(comAnexos ? t.rodapeCapa.comAnexos : t.rodapeCapa.semAnexos);
  const fotoW = 168;
  const fotoH = 112;
  const topoIdentidade = p.y;
  const larguraTexto = LARG - fotoW - 16;
  p.paragrafo(t.imovelTitulo, f.serifN, 19, C.floresta, larguraTexto, M, 1.15);
  p.y -= 3;
  p.paragrafo(t.para, f.sans, 9.5, C.tinta, larguraTexto);
  if (t.identidade) p.paragrafo(t.identidade, f.sans, 8.5, C.texto2, larguraTexto);
  if (foto) {
    const escala = Math.min(fotoW / foto.width, fotoH / foto.height);
    const w = foto.width * escala;
    const h = foto.height * escala;
    p.page.drawImage(foto, { x: L - M - w, y: topoIdentidade - h, width: w, height: h });
  } else {
    p.page.drawRectangle({ x: L - M - fotoW, y: topoIdentidade - fotoH, width: fotoW, height: fotoH, color: C.creme, borderColor: C.borda, borderWidth: 0.8 });
    const s = limpo("foto do imóvel — em breve");
    p.page.drawText(s, { x: L - M - fotoW / 2 - f.sans.widthOfTextAtSize(s, 7.5) / 2, y: topoIdentidade - fotoH / 2 - 3, size: 7.5, font: f.sans, color: C.texto2 });
  }
  p.y = Math.min(p.y, topoIdentidade - fotoH) - 14;
  if (t.aviso) p.caixaAvisos("Relatório parcial", [t.aviso]);

  // Destaque (esquerda) e "como chega" (direita), com a mesma altura.
  const wDest = 226;
  const xCam = M + wDest + 12;
  const wCam = LARG - wDest - 12;
  const baseLinhas = quebrar(limpo(t.destaque.base), f.sans, 7.8, wDest - 22);
  const altDest = 14 + 12 + 30 + baseLinhas.length * 10 + 12;
  const camLinhas = t.comoChega.linhas.map((l) => ({ l, texto: quebrar(limpo(l.texto), f.sans, 8, wCam - 20 - 62) }));
  const altCam = 26 + camLinhas.reduce((s, c) => s + c.texto.length * 10 + 4, 0) + (t.comoChega.quemPagaQuem ? p.alturaDe(t.comoChega.quemPagaQuem, f.sans, 7.5, wCam - 20, 1.3) + 8 : 0) + (camLinhas.length ? 0 : 14) + 8;
  const alt = Math.max(altDest, altCam);
  p.espaco(alt + 12);
  const topo = p.y;
  p.page.drawRectangle({ x: M, y: topo - alt, width: wDest, height: alt, color: C.floresta });
  p.texto(t.destaque.rotulo.toUpperCase(), M + 11, topo - 16, f.sans, 7.2, C.douradoClaro);
  p.texto(t.destaque.valor, M + 11, topo - 44, f.sansN, 24, C.branco);
  p.bloco(t.destaque.base, M + 11, topo - 54, f.sans, 7.8, C.creme, wDest - 22, 1.28);
  p.page.drawRectangle({ x: xCam, y: topo - alt, width: wCam, height: alt, color: C.papel, borderColor: C.borda, borderWidth: 0.8 });
  p.texto("Como chega até você", xCam + 10, topo - 16, f.serifN, 11, C.floresta);
  let y = topo - 26;
  if (!camLinhas.length) {
    y -= 12;
    p.page.drawText(limpo("Nada a receber nem a pagar neste mês."), { x: xCam + 10, y, size: 8, font: f.sans, color: C.texto2 });
  }
  for (const c of camLinhas) {
    const corLinha = c.l.tipo === "aviso" ? C.douradoEscuro : c.l.tipo === "info" ? C.texto2 : C.tinta;
    const valor = limpo(c.l.valor);
    p.page.drawText(valor, { x: xCam + wCam - 10 - f.sansN.widthOfTextAtSize(valor, 8.5), y: y - 10, size: 8.5, font: f.sansN, color: corLinha });
    for (const linha of c.texto) {
      y -= 10;
      p.page.drawText(linha, { x: xCam + 10, y, size: 8, font: f.sans, color: corLinha });
    }
    y -= 4;
    p.page.drawLine({ start: { x: xCam + 10, y: y + 1 }, end: { x: xCam + wCam - 10, y: y + 1 }, thickness: 0.4, color: C.areia });
  }
  if (t.comoChega.quemPagaQuem) {
    y -= 6;
    p.bloco(t.comoChega.quemPagaQuem, xCam + 10, y, f.sans, 7.5, C.texto2, wCam - 20, 1.3);
  }
  p.y = topo - alt - 14;
  p.tabelaValores("Do bruto ao seu resultado", t.brutoAoResultado);
  if (t.avisos.length) p.caixaAvisos("Avisos", t.avisos);

  // ---- Página 2: números e reservas do mês ---------------------------------------------------
  p.nova("Hóspedes só pelo primeiro nome. Códigos são os do canal. Os números são os mesmos do portal.");
  p.h2("Números e reservas do mês", `Os números de ${t.mesNome} e cada reserva com noites no mês, ordenadas pela entrada.`);
  p.h3("Números do mês");
  p.quadros();
  p.grafico();
  p.h3(t.reservasTitulo);
  if (t.reservas.length) p.tabelaReservas(t.reservas, t.totalReservas, t.mostrarImovel);
  else p.paragrafo("Nenhuma reserva confirmada com noites neste mês.", f.sans, 9, C.tinta);
  p.paragrafo(t.notaReservas, f.sans, 7.5, C.texto2);

  // ---- Página 3: conciliação e repasses ---------------------------------------------------------
  p.nova("Os mesmos números do portal, na mesma data.");
  p.h2("Conciliação e repasses", t.conciliacaoIntro);
  const colunasConc: Col<LinhaConciliacaoTexto>[] = [
    { chave: "rotulo", titulo: "Canal", w: 150, quebra: true },
    { chave: "reservas", titulo: "Reservas", w: 44, direita: true },
    { chave: "bruto", titulo: "Bruto", w: 62, direita: true },
    { chave: "taxa", titulo: "Taxa", w: 54, direita: true },
    { chave: "quemRecebeu", titulo: "Quem recebeu", w: LARG - 150 - 44 - 62 - 54 - 66, quebra: true },
    { chave: "suaParte", titulo: "Sua parte", w: 66, direita: true },
  ];
  const semReal = (l: LinhaConciliacaoTexto): LinhaConciliacaoTexto => ({ ...l, bruto: l.bruto.replace(/R\$\s?/, ""), taxa: l.taxa.replace(/R\$\s?/, ""), suaParte: l.suaParte.replace(/R\$\s?/, "") });
  p.tabela(colunasConc, t.conciliacao.filter((l) => l.tipo !== "total").map(semReal), {
    total: t.conciliacao.find((l) => l.tipo === "total") ? semReal(t.conciliacao.find((l) => l.tipo === "total")!) : null,
    destaqueTipo: (l) => (l.tipo === "subtotal" ? "sub" : l.tipo === "ponte" ? "ponte" : "normal"),
  });
  if (!t.conciliacaoFecha) p.paragrafo("Atenção: a ponte não fechou nos centavos; a equipe confere antes do fechamento.", f.sans, 7.5, C.douradoEscuro);
  // Duas colunas: repasses à esquerda; despesas e acerto à direita.
  const wCol = (LARG - 14) / 2;
  const topoCols = p.y;
  // A página em que as colunas começam, guardada ANTES de desenhar a da esquerda: se a lista de repasses abrir outra
  // página, a direita não volta para o topo da anterior — segue embaixo, na largura toda.
  const paginaEsq = p.page;
  p.h3("Repasses do mês");
  if (t.repasses.length) p.tabelaValores(null, t.repasses, wCol);
  else p.paragrafo("Nenhum repasse neste mês.", f.sans, 8.5, C.texto2, wCol);
  const fimEsq = p.y;
  if (p.page === paginaEsq) {
    // Coluna da direita na mesma página (a esquerda não mudou de página).
    p.y = topoCols;
    const xDir = M + wCol + 14;
    p.y -= 11;
    p.texto("Despesas e ajustes do imóvel", xDir, p.y, f.serifN, 11, C.floresta);
    p.y -= 7;
    if (t.despesas.length) p.tabelaValores(null, t.despesas, wCol, xDir);
    else {
      p.y -= 12;
      p.texto("Nenhuma despesa do imóvel neste mês.", xDir, p.y, f.sans, 8.5, C.texto2);
      p.y -= 6;
    }
    p.y -= 8;
    p.texto(`Acerto com a ${t.empresa}`, xDir, p.y - 4, f.serifN, 11, C.floresta);
    p.y -= 14;
    if (t.acerto.length) p.tabelaValores(null, t.acerto, wCol, xDir);
    else {
      p.y -= 12;
      p.texto("Nada a pagar ou receber neste mês.", xDir, p.y, f.sans, 8.5, C.texto2);
    }
    p.y = Math.min(p.y, fimEsq) - 8;
  } else {
    p.h3("Despesas e ajustes do imóvel");
    if (t.despesas.length) p.tabelaValores(null, t.despesas);
    else p.paragrafo("Nenhuma despesa do imóvel neste mês.", f.sans, 8.5, C.texto2);
    p.h3(`Acerto com a ${t.empresa}`);
    if (t.acerto.length) p.tabelaValores(null, t.acerto);
    else p.paragrafo("Nada a pagar ou receber neste mês.", f.sans, 8.5, C.texto2);
  }
  p.paragrafo(tt.posicao, f.sans, 7.5, C.texto2);

  // ---- Página 4: anexos (só quando há extratos) ------------------------------------------------
  if (comAnexos) {
    p.nova(`Dúvidas: fale com a ${t.empresa} pelo contato do portal.`);
    p.h2("Anexos: extratos oficiais dos canais", t.anexosIntro);
    for (const [i, e] of extratos.entries()) {
      const n = e.paginas.length;
      const parcial = n < e.total || e.paginas.some((x, k) => x !== k);
      const linhas = [
        e.anexo.nome ?? `Extrato oficial — ${t.mesNome}`,
        parcial ? `${n === 1 ? "Página" : "Páginas"} ${e.paginas.map((x) => x + 1).join(", ")} do extrato completo (que tem ${e.total}), ${n === 1 ? "copiada" : "copiadas"} como ${n === 1 ? "emitida" : "emitidas"}.` : `${e.total} ${e.total === 1 ? "página" : "páginas"} do extrato completo, ${e.total === 1 ? "copiada" : "copiadas"} como ${e.total === 1 ? "emitida" : "emitidas"}.`,
      ];
      const altura = 46;
      p.espaco(altura + 8);
      p.page.drawRectangle({ x: M, y: p.y - altura, width: LARG, height: altura, color: C.papel, borderColor: C.borda, borderWidth: 0.8 });
      p.texto(`ANEXO ${i + 1} · ${e.anexo.canal}`.toUpperCase(), M + 10, p.y - 13, f.sans, 7, C.douradoEscuro);
      p.texto(cortar(limpo(linhas[0]), f.sansN, 10, LARG - 20), M + 10, p.y - 27, f.sansN, 10, C.tinta);
      p.texto(cortar(limpo(linhas[1]), f.sans, 8, LARG - 20), M + 10, p.y - 39, f.sans, 8, C.texto2);
      p.y -= altura + 8;
    }
    p.paragrafo(t.anexosNota, f.sans, 7.5, C.texto2);
  }

  p.rodapes();
  for (const e of extratos) {
    let copiadas;
    try {
      copiadas = await doc.copyPages(e.doc, e.paginas);
    } catch {
      throw new ErroRelatorio(`Não foi possível copiar as páginas do extrato${e.anexo.canal ? ` (${e.anexo.canal})` : ""}: exporte o PDF de novo.`);
    }
    for (const pg of copiadas) doc.addPage(pg);
  }

  doc.setTitle(limpo(`${t.olho} — ${t.imovelTitulo}`));
  doc.setAuthor(limpo(t.empresa));
  doc.setCreator(limpo(`Sistema ${t.empresa}`));
  doc.setProducer("pdf-lib");
  doc.setSubject(limpo(`Posição de ${dataHora(agora)}`));
  doc.setCreationDate(agora);
  doc.setModificationDate(agora);
  return doc.save();
}
