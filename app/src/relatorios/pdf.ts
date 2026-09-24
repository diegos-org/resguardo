/**
 * PDF do relatório mensal do proprietário (M5.3), no modelo aprovado por Diego em 21/09:
 * primeira página com a identidade da empresa (verde sálvia, areia e dourado, títulos com serifa),
 * foto real do imóvel quando anexada e os números; depois dela, o extrato oficial do canal
 * copiado página a página, sem redesenhar nada. Foto e extrato chegam na hora de gerar e não são
 * guardados em lugar nenhum.
 */
import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import type { LinhaTabela, TextosRelatorio } from "./relatorio";

/** Limites dos anexos (a Vercel recusa pedidos acima de ~4,5 MB no total). */
export const LIMITE_FOTO = 2 * 1024 * 1024;
export const LIMITE_EXTRATO = 2 * 1024 * 1024;

/** Erro que pode ser mostrado ao usuário como está. */
export class ErroRelatorio extends Error {}

export type Anexos = {
  /** Foto real do imóvel (JPG ou PNG). Sem foto, a página sai sem imagem (nunca uma genérica). */
  foto?: Uint8Array | null;
  /** Extrato oficial do canal (PDF) e, opcionalmente, quais páginas usar ("1-2, 4"). */
  extrato?: { bytes: Uint8Array; paginas?: string } | null;
};

const cor = (hex: string) => rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
const SALVIA = cor("#505b46");
const AREIA = cor("#f0e7d7");
const AREIA_CLARA = cor("#f8f3ea");
const DOURADO = cor("#c9a96e");
const TEXTO = cor("#252b23");
const TEXTO_2 = cor("#5b604f");
const BRANCO = rgb(1, 1, 1);

const L = 595.28;
const A = 841.89;
const M = 42;
const LARG = L - 2 * M;

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

/** Confere os anexos antes de gerar (tipo e tamanho); a mensagem vai direto para a tela. */
export function conferirAnexos(a: Anexos): void {
  if (a.foto) {
    if (a.foto.length > LIMITE_FOTO) throw new ErroRelatorio("A foto passa de 2 MB: use uma versão menor.");
    if (!eJpg(a.foto) && !ePng(a.foto)) throw new ErroRelatorio("A foto precisa ser JPG ou PNG.");
  }
  if (a.extrato) {
    if (a.extrato.bytes.length > LIMITE_EXTRATO) throw new ErroRelatorio("O extrato passa de 2 MB: exporte só o período do mês.");
    if (!ePdf(a.extrato.bytes)) throw new ErroRelatorio("O extrato precisa ser o PDF oficial do canal.");
  }
}

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
      .map((c) => (ok(c) ? c : "?"))
      .join("");
}

type Fontes = { serif: PDFFont; serifN: PDFFont; sans: PDFFont; sansN: PDFFont };

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

/** Escreve páginas de cima para baixo, abrindo página nova quando falta espaço. */
class Pagina {
  page!: PDFPage;
  y = 0;
  constructor(
    private doc: PDFDocument,
    private f: Fontes,
    private limpo: (s: string) => string,
    private t: TextosRelatorio,
    private rodape: string,
  ) {}

  primeira() {
    this.page = this.doc.addPage([L, A]);
    this.fundo();
    this.page.drawRectangle({ x: 0, y: A - 92, width: L, height: 92, color: SALVIA });
    this.page.drawRectangle({ x: 0, y: A - 95, width: L, height: 3, color: DOURADO });
    this.texto(this.t.empresa, M, A - 46, this.f.serifN, 24, BRANCO);
    if (this.t.contato) this.texto(this.t.contato, M, A - 66, this.f.sans, 9, AREIA);
    this.y = A - 95 - 26;
  }

  private fundo() {
    this.texto(this.rodape, M, 24, this.f.sans, 7.5, TEXTO_2);
  }

  private continuacao() {
    this.page = this.doc.addPage([L, A]);
    this.fundo();
    this.page.drawRectangle({ x: 0, y: A - 36, width: L, height: 36, color: SALVIA });
    this.texto(`${this.t.empresa} · ${this.t.titulo} (continuação)`, M, A - 23, this.f.serif, 11, BRANCO);
    this.y = A - 36 - 28;
  }

  /** Garante `altura` pontos livres; se não houver, continua na página seguinte. */
  espaco(altura: number): boolean {
    if (this.y - altura >= M + 20) return false;
    this.continuacao();
    return true;
  }

  texto(s: string, x: number, y: number, fonte: PDFFont, tam: number, c = TEXTO) {
    this.page.drawText(this.limpo(s), { x, y, size: tam, font: fonte, color: c });
  }

  paragrafo(s: string, fonte: PDFFont, tam: number, c = TEXTO, largura = LARG, x = M, entre = 1.35) {
    for (const linha of quebrar(this.limpo(s), fonte, tam, largura)) {
      this.espaco(tam * entre);
      this.y -= tam;
      this.page.drawText(linha, { x, y: this.y, size: tam, font: fonte, color: c });
      this.y -= tam * (entre - 1);
    }
  }

  /** Caixa de fundo areia com um texto dentro (avisos). */
  caixa(s: string, tam = 9.5) {
    const linhas = quebrar(this.limpo(s), this.f.sans, tam, LARG - 20);
    const altura = linhas.length * tam * 1.35 + 14;
    this.espaco(altura);
    this.page.drawRectangle({ x: M, y: this.y - altura, width: LARG, height: altura, color: AREIA });
    this.page.drawRectangle({ x: M, y: this.y - altura, width: 3, height: altura, color: DOURADO });
    let y = this.y - 7;
    for (const l of linhas) {
      y -= tam;
      this.page.drawText(l, { x: M + 12, y, size: tam, font: this.f.sans, color: TEXTO });
      y -= tam * 0.35;
    }
    this.y -= altura + 12;
  }

  titulo(s: string) {
    this.espaco(40);
    this.y -= 14;
    this.texto(s, M, this.y, this.f.serifN, 14, SALVIA);
    this.y -= 10;
  }

  /** Foto no canto direito, a partir da altura atual; devolve a largura ocupada e onde ela termina. */
  imagemAoLado(img: PDFImage): { largura: number; base: number } {
    const escala = Math.min(200 / img.width, 150 / img.height, 1.5);
    const w = img.width * escala;
    const h = img.height * escala;
    this.page.drawImage(img, { x: M + LARG - w, y: this.y - h, width: w, height: h });
    return { largura: w + 16, base: this.y - h };
  }

  numeros(t: TextosRelatorio) {
    for (const [i, n] of t.numeros.entries()) {
      const detalhe = n.detalhe ? quebrar(this.limpo(n.detalhe), this.f.sans, 8, LARG - 200) : [];
      const altura = (n.destaque ? 30 : 20) + detalhe.length * 10.5;
      this.espaco(altura);
      const base = this.y - altura;
      if (n.destaque) this.page.drawRectangle({ x: M, y: base, width: LARG, height: altura, color: SALVIA });
      else if (i % 2 === 0) this.page.drawRectangle({ x: M, y: base, width: LARG, height: altura, color: AREIA_CLARA });
      const c = n.destaque ? BRANCO : TEXTO;
      const tam = n.destaque ? 12.5 : 10;
      const topo = this.y - (n.destaque ? 19 : 14);
      this.texto(n.rotulo, M + 10, topo, n.destaque ? this.f.serifN : this.f.sans, tam, c);
      const valor = this.limpo(n.valor);
      const fv = n.destaque ? this.f.sansN : this.f.sans;
      this.page.drawText(valor, { x: M + LARG - 10 - fv.widthOfTextAtSize(valor, tam + 1), y: topo, size: tam + 1, font: fv, color: c });
      let y = topo - 11;
      for (const d of detalhe) {
        this.page.drawText(d, { x: M + 10, y, size: 8, font: this.f.sans, color: n.destaque ? AREIA : TEXTO_2 });
        y -= 10.5;
      }
      this.y = base;
    }
    this.y -= 14;
  }

  tabela(linhas: LinhaTabela[], comImovel: boolean) {
    const colunas: { chave: keyof LinhaTabela; titulo: string; w: number; direita?: boolean }[] = comImovel
      ? [
          { chave: "imovel", titulo: "Imóvel", w: 120 },
          { chave: "entrada", titulo: "Entrada", w: 40 },
          { chave: "saida", titulo: "Saída", w: 38 },
          { chave: "hospede", titulo: "Hóspede", w: 58 },
          { chave: "canal", titulo: "Canal", w: 60 },
          { chave: "bruto", titulo: "Valor bruto", w: 62, direita: true },
          { chave: "suaParte", titulo: "Sua parte", w: 58, direita: true },
          { chave: "situacao", titulo: "Situação", w: LARG - 436 },
        ]
      : [
          { chave: "entrada", titulo: "Entrada", w: 55 },
          { chave: "saida", titulo: "Saída", w: 55 },
          { chave: "hospede", titulo: "Hóspede", w: 95 },
          { chave: "canal", titulo: "Canal", w: 80 },
          { chave: "bruto", titulo: "Valor bruto", w: 80, direita: true },
          { chave: "suaParte", titulo: "Sua parte", w: 76, direita: true },
          { chave: "situacao", titulo: "Situação", w: LARG - 441 },
        ];
    const ALT = 17;
    const cabecalho = () => {
      this.page.drawRectangle({ x: M, y: this.y - ALT, width: LARG, height: ALT, color: AREIA });
      let x = M;
      for (const c of colunas) {
        const s = this.limpo(c.titulo);
        const px = c.direita ? x + c.w - 6 - this.f.sansN.widthOfTextAtSize(s, 8) : x + 6;
        this.page.drawText(s, { x: px, y: this.y - 11.5, size: 8, font: this.f.sansN, color: TEXTO_2 });
        x += c.w;
      }
      this.y -= ALT;
    };
    this.espaco(ALT * 2);
    cabecalho();
    for (const [i, l] of linhas.entries()) {
      if (this.espaco(ALT)) cabecalho();
      if (i % 2 === 1) this.page.drawRectangle({ x: M, y: this.y - ALT, width: LARG, height: ALT, color: AREIA_CLARA });
      let x = M;
      for (const c of colunas) {
        const s = cortar(this.limpo(l[c.chave]), this.f.sans, 8, c.w - 9);
        const px = c.direita ? x + c.w - 6 - this.f.sans.widthOfTextAtSize(s, 8) : x + 5;
        this.page.drawText(s, { x: px, y: this.y - 12, size: 8, font: this.f.sans, color: TEXTO });
        x += c.w;
      }
      this.y -= ALT;
    }
    this.page.drawRectangle({ x: M, y: this.y, width: LARG, height: 0.8, color: DOURADO });
    this.y -= 8;
  }
}

const dataHora = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);

/** Gera o PDF: página do relatório (com continuação, se a tabela for longa) e o extrato oficial. */
export async function gerarPdfRelatorio(t: TextosRelatorio, anexos: Anexos = {}, agora: Date = new Date()): Promise<Uint8Array> {
  conferirAnexos(anexos);
  const doc = await PDFDocument.create();
  const f: Fontes = {
    serif: await doc.embedFont(StandardFonts.TimesRoman),
    serifN: await doc.embedFont(StandardFonts.TimesRomanBold),
    sans: await doc.embedFont(StandardFonts.Helvetica),
    sansN: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const limpo = limpador(f.sans);

  // Extrato primeiro: se o arquivo não servir, nada é gerado.
  let extrato: { doc: PDFDocument; paginas: number[] } | null = null;
  if (anexos.extrato) {
    let origem: PDFDocument;
    let total: number;
    try {
      origem = await PDFDocument.load(anexos.extrato.bytes, { updateMetadata: false });
      total = origem.getPageCount();
    } catch (e) {
      if (e instanceof Error && /encrypt/i.test(e.message)) throw new ErroRelatorio("O extrato está protegido por senha: exporte de novo sem senha.");
      throw new ErroRelatorio("Não foi possível ler o PDF do extrato.");
    }
    if (total === 0) throw new ErroRelatorio("O PDF do extrato não tem páginas.");
    extrato = { doc: origem, paginas: lerPaginas(anexos.extrato.paginas, total) };
  }
  let foto: PDFImage | null = null;
  if (anexos.foto) {
    try {
      foto = eJpg(anexos.foto) ? await doc.embedJpg(anexos.foto) : await doc.embedPng(anexos.foto);
    } catch {
      throw new ErroRelatorio("Não foi possível ler a foto: tente outro arquivo JPG ou PNG.");
    }
  }

  const p = new Pagina(doc, f, limpo, t, `Gerado em ${dataHora(agora)} pelo sistema da ${t.empresa}.`);
  p.primeira();
  // Identidade à esquerda; a foto real do imóvel (quando houver) ao lado, no canto direito.
  const lado = foto ? p.imagemAoLado(foto) : { largura: 0, base: p.y };
  const largura = LARG - lado.largura;
  p.paragrafo(t.titulo, f.serifN, 24, TEXTO, largura, M, 1.2);
  p.y -= 4;
  if (t.imoveis) p.paragrafo(t.imoveis, f.serif, 14, SALVIA, largura);
  p.paragrafo(t.destinatarios, f.sans, 10, TEXTO_2, largura);
  p.paragrafo(t.periodo, f.sans, 10, TEXTO_2, largura);
  p.y = Math.min(p.y, lado.base) - 12;
  if (t.aviso) p.caixa(t.aviso);

  p.titulo("Números do mês");
  p.numeros(t);
  if (t.emConferencia) p.caixa(t.emConferencia);

  p.titulo("Reservas");
  if (t.reservas.length) p.tabela(t.reservas, t.mostrarImovel);
  else p.paragrafo("Nenhuma reserva confirmada neste mês.", f.sans, 10);
  p.paragrafo(t.notaReservas, f.sans, 8, TEXTO_2);
  p.y -= 6;

  p.titulo(`Saldo com a ${t.empresa}`);
  for (const s of t.saldo) p.paragrafo(s, f.sans, 10.5);
  p.paragrafo(t.notaSaldo, f.sans, 8, TEXTO_2);
  p.y -= 6;

  if (!extrato) p.paragrafo("Extrato oficial do canal: não anexado a esta versão do relatório.", f.sansN, 8.5, TEXTO_2);
  else {
    const total = extrato.doc.getPageCount();
    const n = extrato.paginas.length;
    const parcial = n < total || extrato.paginas.some((x, i) => x !== i);
    p.paragrafo(
      parcial
        ? `Nas páginas seguintes: somente ${n === 1 ? "a página" : "as páginas"} ${extrato.paginas.map((x) => x + 1).join(", ")} do extrato oficial do canal (o arquivo completo tem ${total}), como emitido, sem alterações.`
        : `Nas páginas seguintes: o extrato oficial do canal (${total} página${total === 1 ? "" : "s"}), como emitido, sem alterações.`,
      f.sansN,
      8.5,
      TEXTO_2,
    );
    let copiadas;
    try {
      copiadas = await doc.copyPages(extrato.doc, extrato.paginas);
    } catch {
      throw new ErroRelatorio("Não foi possível copiar as páginas do extrato: exporte o PDF de novo.");
    }
    for (const pg of copiadas) doc.addPage(pg);
  }

  doc.setTitle(limpo(`${t.titulo} — ${t.imoveis}`));
  doc.setAuthor(limpo(t.empresa));
  doc.setCreator(limpo(`Sistema ${t.empresa}`));
  doc.setProducer("pdf-lib");
  doc.setCreationDate(agora);
  doc.setModificationDate(agora);
  return doc.save();
}
