import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * M7.22 (decisão de Diego em 16/10/2026): a hora no padrão do Brasil, igual em todo lugar ("15:00", "23:59", "00:00").
 * Este teste varre o código de src (sem os testes e os arquivos de apoio deles), sem os comentários, e falha se uma hora
 * de relógio voltar no formato antigo ("15h", "23h59", "0h"). Durações acima de 23 horas ("24h", "48h", "Portaria 24h")
 * não casam. Falha também se uma data ou hora para pessoas for formatada fora de lib/datas.ts (Intl, toLocale de data ou
 * hora, ou o dia cortado de um carimbo ISO), o que já deixou segundos, vírgula, PM e o dia em UTC na tela. E, desde a decisão de Diego de que a semana começa na
 * segunda em todos os calendários (16/10/2026), falha se o dia da semana for calculado (`getUTCDay`, `getDay`) ou se uma
 * lista de nomes ou letras dos dias for escrita fora de lib/datas.ts: a ordem da semana e os nomes ficam num lugar só.
 * A mensagem lista o arquivo e a linha de cada achado.
 */
const SRC = join(__dirname, "..", "..");

/** Testes e os arquivos de apoio deles (`testes.ts`, `testing.ts`, `paginas-legais-testes.ts`): não chegam a ninguém. */
const ehDeTeste = (nome: string) => /\.test\.tsx?$/.test(nome) || /(^|[-.])(testes|testing)([-.])/.test(nome);

function fontes(dir = SRC): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return fontes(caminho);
    return /\.tsx?$/.test(nome) && !ehDeTeste(nome) ? [relative(SRC, caminho).split(sep).join("/")] : [];
  });
}

const jaLimpos = new Map<string, string>();

/**
 * Tira comentários de bloco (inclusive os de JSX) e de linha, mantendo as quebras de linha (o número da linha do achado
 * continua o do arquivo). Quem acha os comentários é o próprio TypeScript, token a token: um "/*" ou um "//" dentro de
 * texto ("image/*", "https://"), de expressão regular ou de JSX não é comentário e não esconde o que vem depois. Antes, uma
 * expressão regular tirava de "image/*" até o "* /" seguinte, e 26 linhas de LugaresBairro.tsx saíam da varredura.
 */
function semComentarios(codigo: string): string {
  const pronto = jaLimpos.get(codigo);
  if (pronto !== undefined) return pronto;
  const arquivo = ts.createSourceFile("varredura.tsx", codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const textosJsx: [number, number][] = [];
  const comentarios = new Map<number, number>();
  const anotar = (rs: ts.CommentRange[] | undefined) => rs?.forEach((r) => comentarios.set(r.pos, r.end));
  const visitar = (no: ts.Node) => {
    if (no.kind === ts.SyntaxKind.JsxText) textosJsx.push([no.pos, no.end]);
    anotar(ts.getLeadingCommentRanges(codigo, no.pos));
    anotar(ts.getTrailingCommentRanges(codigo, no.end));
    for (const filho of no.getChildren(arquivo)) visitar(filho);
  };
  visitar(arquivo);
  let limpo = "";
  let i = 0;
  for (const [inicio, fim] of [...comentarios].sort(([a], [b]) => a - b)) {
    // O texto de JSX ("<p>// texto</p>") não é comentário, nem o que já ficou dentro de outro comentário.
    if (inicio < i || textosJsx.some(([a, b]) => inicio >= a && inicio < b)) continue;
    limpo += codigo.slice(i, inicio) + codigo.slice(inicio, fim).replace(/[^\n]/g, " ");
    i = fim;
  }
  limpo += codigo.slice(i);
  jaLimpos.set(codigo, limpo);
  return limpo;
}

/** Hora de relógio no formato antigo: "15h", "9h", "23h59", "0h", "às 20h." (não "24h", "48h", "M7 5h.01" nem "h1"). */
const HORA_ANTIGA = /(?<![\w.#/-])(?:[01]?\d|2[0-3])h(?:[0-5]\d)?(?!\w|\.\d)/g;

/** Um caminho de SVG ("M4 8h16v7H4z"): os comandos h e v com números, não uma hora. */
const CAMINHO_SVG = /^\s*[Mm]\s*-?\d[\d\s.,MmLlHhVvCcSsQqTtAaZz-]*$/;

/** O texto entre as aspas (", ' ou `) em volta da posição, na mesma linha; null fora de aspas. */
function textoEntreAspas(linha: string, i: number): string | null {
  for (let a = i - 1; a >= 0; a--) {
    const aspa = linha[a];
    if (aspa !== '"' && aspa !== "'" && aspa !== "`") continue;
    const fim = linha.indexOf(aspa, i);
    return fim === -1 ? null : linha.slice(a + 1, fim);
  }
  return null;
}

/**
 * Exceções com motivo; quando o trecho sair do arquivo, a exceção também sai (o último teste avisa). As da agenda saíram
 * na parte 2 do M7.22: a agenda lê o "15h" guardado com `lerHora` e grava "15:00", e o padrão dela é `HORARIOS_PADRAO`.
 */
const EXCECOES: { arquivo: string; trecho: string; motivo: string }[] = [];

/**
 * O campo nativo de hora (`type="time"`): mostra "03:00 PM" com o navegador ou o celular em inglês ou em 12 horas. Também
 * pelo objeto que um ajudante passa adiante ("{ type: \"time\" }", "{ tipo: \"time\" }").
 */
const CAMPO_TIME = /\b(?:type\s*=\s*\{?\s*|type\s*:\s*|tipo\s*:\s*)["'`]time["'`]/;

/**
 * Datas e horas para pessoas saem de lib/datas.ts (parte 3 do M7.22): fora dele, nenhuma opção de hora ou de estilo do
 * Intl, nenhum toLocaleDateString/toLocaleTimeString e nenhum toLocaleString sem opção de número (`style`, `currency`,
 * `minimumFractionDigits`, `maximumFractionDigits`): sem elas, num Date, ele escreve "10/16/2026, 6:05:00 PM" no navegador
 * em inglês e a hora em UTC, com segundos, no servidor. O de dinheiro e de números com essas opções continua; o de número
 * sem opção fica nas exceções. O formatador pt-BR de datas também fica só lá, e o dia não se corta de um carimbo ISO
 * (`.slice(0, 10).split("-").reverse()`): o dia de um instante sai no fuso de São Paulo, por `dataNoFuso`.
 */
const FORMATO_FORA_DA_LIB: { nome: string; re: RegExp }[] = [
  { nome: "hour:", re: /\bhour\s*:/g },
  { nome: "timeStyle:", re: /\btimeStyle\s*:/g },
  { nome: "dateStyle:", re: /\bdateStyle\s*:/g },
  { nome: "toLocaleDateString(", re: /\.toLocaleDateString\(/g },
  { nome: "toLocaleTimeString(", re: /\.toLocaleTimeString\(/g },
  { nome: "toLocaleString( sem opção de número", re: /\.toLocaleString\((?![^)]*\b(?:style|currency|minimumFractionDigits|maximumFractionDigits)\b)[^)]*\)/g },
  { nome: 'Intl.DateTimeFormat("pt-BR"', re: /\bIntl\.DateTimeFormat\(\s*["'`]pt-BR["'`]/g },
  { nome: "weekday:", re: /\bweekday\s*:/g },
  { nome: "dia cortado de um carimbo", re: /\.slice\(0,\s*10\)\.split\(["'`]-["'`]\)\.reverse\(\)/g },
];

/**
 * Exceções do formato, com motivo; a que não servir mais sai da lista (o último teste avisa). A do `weekday` de Minha
 * reserva saiu na parte da semana do M7.22: o dia vem de `diaDaSemanaEData` ("sex, 16/10/2026").
 */
const EXCECOES_FORMATO: { arquivo: string; trecho: string; motivo: string }[] = [
  { arquivo: "components/configuracoes/FormPaginaLegal.tsx", trecho: 's.limite.toLocaleString("pt-BR")', motivo: "número (limite e caracteres usados), não data" },
  { arquivo: "components/configuracoes/FormPaginaLegal.tsx", trecho: '.length.toLocaleString("pt-BR")', motivo: "número (caracteres usados), não data" },
  { arquivo: "relatorios/pdf.ts", trecho: 'Math.round(p.diaria / 100).toLocaleString("pt-BR")', motivo: "número (diária em reais inteiros), não data" },
  { arquivo: "configuracoes/pagina-proprietarios.ts", trecho: 'Math.trunc(c / 100).toLocaleString("pt-BR")', motivo: "número (reais inteiros), não data" },
];

/**
 * A semana fora de lib/datas.ts: o dia calculado por `getUTCDay`/`getDay` (o número guardado sai de `diaDaSemana`, e a
 * ordem mostrada, de `DIAS_NA_ORDEM`), uma lista com dois nomes de dias seguidos entre aspas ("dom", "seg"; "domingo",
 * "segunda-feira") ou a lista das sete letras.
 */
const SEMANA_FORA_DA_LIB: { nome: string; re: RegExp }[] = [
  { nome: "getUTCDay/getDay", re: /\.get(?:UTC)?Day\(\)/g },
  {
    nome: "lista de nomes de dias",
    re: /\[\s*(["'`])(?:domingo|segunda|terça|quarta|quinta|sexta|sábado|dom|seg|ter|qua|qui|sex|sáb)(?:-feira)?\1\s*,\s*(["'`])(?:domingo|segunda|terça|quarta|quinta|sexta|sábado|dom|seg|ter|qua|qui|sex|sáb)(?:-feira)?\2/g,
  },
  { nome: "lista de letras dos dias", re: /\[\s*(?:["'`][DSTQ]["'`]\s*,\s*){6}["'`][DSTQ]["'`]\s*,?\s*\]/g },
];

function achadosForaDaLib(regras: { nome: string; re: RegExp }[], codigo: string): { n: number; nome: string; linha: string }[] {
  const limpo = semComentarios(codigo);
  const linhas = limpo.split("\n");
  return regras.flatMap(({ nome, re }) =>
    [...limpo.matchAll(re)].map((m) => {
      const n = limpo.slice(0, m.index).split("\n").length;
      return { n, nome, linha: linhas[n - 1] };
    }),
  );
}

const formatosForaDaLib = (codigo: string) => achadosForaDaLib(FORMATO_FORA_DA_LIB, codigo);
const semanaForaDaLib = (codigo: string) => achadosForaDaLib(SEMANA_FORA_DA_LIB, codigo);

function horasAntigas(codigo: string): { n: number; linha: string; hora: string }[] {
  return semComentarios(codigo)
    .split("\n")
    .flatMap((linha, i) =>
      [...linha.matchAll(HORA_ANTIGA)]
        .filter((m) => {
          const entreAspas = textoEntreAspas(linha, m.index);
          return !(entreAspas !== null && CAMINHO_SVG.test(entreAspas));
        })
        .map((m) => ({ n: i + 1, linha, hora: m[0] })),
    );
}

describe("a hora e a data no padrão do Brasil (M7.22)", () => {
  it("o detector pega a hora de relógio no formato antigo e deixa durações, caminhos de SVG e comentários", () => {
    for (const t of ['"às 15h"', '"até 23h59 de"', '"A partir da 0h do dia"', '"Todo dia às 20h."', '"entre 6h15 e 7h15"', '"D-2 10h,"', "<p>Enviar às 9h</p>"]) expect(horasAntigas(t), t).not.toEqual([]);
    for (const t of ['"Portaria 24h"', '"vale 48h"', '"às 15:00"', '"h1"', '"#0h"', '"v1.2h"', 'd="M4 8h16v7H4z M7 11h10"', '"M3 21h18 M3 13h18"', '"M7 5h.01"', "// às 15h", "/* até 23h59 */", "{/* às 20h */}"]) expect(horasAntigas(t), t).toEqual([]);
  });

  it('um "/*" ou "//" dentro de texto, de expressão regular ou de JSX não esconde o código seguinte dos detectores', () => {
    // O caso de LugaresBairro.tsx: `accept="image/*"` e, linhas depois, um comentário de JSX que fecha com "* /".
    const tela = ['<input accept="image/jpeg,image/png,image/*" />', "<p>Enviar às 15h</p>", '<input type="time" />', "{new Date().getDay()}", "{/* x */}"].join("\n");
    const limpo = semComentarios(tela);
    expect(horasAntigas(tela).map((a) => a.n)).toEqual([2]);
    expect(limpo.split("\n")[2]).toMatch(CAMPO_TIME);
    expect(semanaForaDaLib(tela).map((a) => a.n)).toEqual([4]);
    expect(limpo.split("\n")[4]).toBe("{       }");
    // Nem "https://", nem uma expressão regular com "//" ou "/*", nem o texto de JSX: só o comentário de verdade sai.
    const outros = ['const u = "https://example.com"; // às 15h', "const re = /https?:\\/\\//; const r2 = /a\\/*/;", "<p>// às 9h</p>", "<p>às 10h</p>"].join("\n");
    expect(horasAntigas(outros).map((a) => [a.n, a.hora])).toEqual([[3, "9h"], [4, "10h"]]);
    expect(semComentarios(outros).split("\n")[1]).toBe("const re = /https?:\\/\\//; const r2 = /a\\/*/;");
    // E o número da linha de cada achado continua o do arquivo.
    expect(semComentarios("/* a\nb */ x\n// c\ny").split("\n")).toEqual(["    ", "     x", "    ", "y"]);
  });

  it("nenhuma hora de relógio no formato antigo ('15h', '23h59', '0h') no código, fora dos comentários", () => {
    const lista = fontes();
    expect(lista.length).toBeGreaterThan(300);
    const achados = lista.flatMap((rel) =>
      horasAntigas(readFileSync(join(SRC, rel), "utf8"))
        .filter(({ linha }) => !EXCECOES.some((e) => e.arquivo === rel && linha.includes(e.trecho)))
        .map(({ n, linha, hora }) => `${rel}:${n}: "${hora}" em ${linha.trim()}`),
    );
    expect(achados).toEqual([]);
  });

  it('nenhum campo type="time": a hora se digita no CampoHora, "15:00" em qualquer aparelho', () => {
    for (const t of ['<input type="time" />', "<input type={'time'} />", '<input name="hora" type = "time" required />', 'campo("hora", "Hora", { type: "time" })', '{ nome: "hora", tipo: "time" }']) expect(CAMPO_TIME.test(t), t).toBe(true);
    for (const t of ['<input type="text" />', '<input type="timestamp" />', "// <input type=\"time\" />", '{ type: "month" }', '{ tipo: "texto" }']) expect(CAMPO_TIME.test(semComentarios(t)), t).toBe(false);
    const achados = fontes().flatMap((rel) =>
      semComentarios(readFileSync(join(SRC, rel), "utf8"))
        .split("\n")
        .flatMap((linha, i) => (CAMPO_TIME.test(linha) ? [`${rel}:${i + 1}: ${linha.trim()}`] : [])),
    );
    expect(achados).toEqual([]);
  });

  it("o detector de formato pega Intl e toLocale de data e hora e deixa dinheiro, números e comentários", () => {
    for (const t of [
      'new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, hour: "2-digit", minute: "2-digit" })',
      'd.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })',
      'd.toLocaleString("pt-BR", {\n  timeZone: FUSO,\n})',
      'd.toLocaleString("pt-BR", { timeZone: FUSO, dateStyle: "short", timeStyle: "short" })',
      'd.toLocaleDateString("pt-BR", { timeZone: FUSO })',
      "d.toLocaleTimeString()",
      'new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit" })',
      'new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short" })',
      'new Intl.DateTimeFormat("en-US", { weekday: "long" })',
      // Sem fuso: "10/16/2026, 6:05:00 PM" no navegador em inglês; a hora em UTC, com segundos, no servidor.
      "{ultima.toLocaleString()}",
      'r.criadoEm.toLocaleString("pt-BR")',
      'r.criadoEm.toLocaleString("en-US")',
      // O dia cortado de um carimbo ISO é o dia em UTC: depois das 21:00 de Brasília, já é o dia seguinte.
      'iso.slice(0, 10).split("-").reverse().join("/")',
    ])
      expect(formatosForaDaLib(t), t).not.toEqual([]);
    for (const t of [
      '(c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })',
      '(bp / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })',
      '(c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })',
      '(x / 10).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })',
      'new Intl.DateTimeFormat("en-US", { timeZone: fuso })',
      "// d.toLocaleString(\"pt-BR\", { timeZone: FUSO })",
      "/* hour: 2 */",
      "hourCycle: \"h23\"",
    ])
      expect(formatosForaDaLib(t), t).toEqual([]);
  });

  it("datas e horas para pessoas só por lib/datas.ts: nenhum Intl ou toLocale de data e hora fora dele", () => {
    const achados = fontes()
      .filter((rel) => rel !== "lib/datas.ts")
      .flatMap((rel) =>
        formatosForaDaLib(readFileSync(join(SRC, rel), "utf8"))
          .filter(({ linha }) => !EXCECOES_FORMATO.some((e) => e.arquivo === rel && linha.includes(e.trecho)))
          .map(({ n, nome, linha }) => `${rel}:${n}: ${nome} em ${linha.trim()}`),
      );
    expect(achados).toEqual([]);
  });

  it("o detector da semana pega getUTCDay, getDay e listas de nomes ou letras dos dias e deixa o resto", () => {
    for (const t of [
      "new Date(`${d}T12:00:00Z`).getUTCDay()",
      "agora.getDay()",
      'const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];',
      "const DIAS = ['domingo', 'segunda', 'terça'];",
      'const NOMES = ["segunda-feira", "terça-feira"] as const;',
      'const LETRAS = ["D", "S", "T", "Q", "Q", "S", "S"];',
      'const L = ["S", "T", "Q", "Q", "S", "S", "D",]',
    ])
      expect(semanaForaDaLib(t), t).not.toEqual([]);
    for (const t of [
      "diaDaSemana(d)",
      "DIAS_NA_ORDEM.map((n) => DIAS_SEMANA[n])",
      '"Entrada só em: sexta, sábado."',
      '["segunda"]',
      '["D", "S"]',
      'const ESTADOS = ["pedida", "confirmada"];',
      "// const SEMANA = [\"dom\", \"seg\"];",
      "d.getUTCDate()",
    ])
      expect(semanaForaDaLib(t), t).toEqual([]);
  });

  it("a semana só por lib/datas.ts: nenhum getUTCDay ou getDay e nenhuma lista de nomes ou letras dos dias fora dele", () => {
    const achados = fontes()
      .filter((rel) => rel !== "lib/datas.ts")
      .flatMap((rel) => semanaForaDaLib(readFileSync(join(SRC, rel), "utf8")).map(({ n, nome, linha }) => `${rel}:${n}: ${nome} em ${linha.trim()}`));
    expect(achados).toEqual([]);
    // E lib/datas.ts tem a regra: segunda primeiro, com os números guardados de domingo (0) a sábado (6).
    const lib = readFileSync(join(SRC, "lib/datas.ts"), "utf8");
    expect(lib).toContain("export const PRIMEIRO_DIA_DA_SEMANA = 1;");
  });

  it("cada exceção ainda existe no arquivo dela (a que não serve mais sai da lista)", () => {
    for (const e of [...EXCECOES, ...EXCECOES_FORMATO]) expect(readFileSync(join(SRC, e.arquivo), "utf8"), `${e.arquivo}: ${e.trecho} (${e.motivo})`).toContain(e.trecho);
  });
});
