import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M7.22 (decisão de Diego em 16/10/2026): a hora no padrão do Brasil, igual em todo lugar ("15:00", "23:59", "00:00").
 * Este teste varre o código de src (sem os testes e os arquivos de apoio deles), sem os comentários, e falha se uma hora
 * de relógio voltar no formato antigo ("15h", "23h59", "0h"). Durações acima de 23 horas ("24h", "48h", "Portaria 24h")
 * não casam. A mensagem lista o arquivo e a linha de cada achado.
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

/**
 * Tira comentários de bloco (inclusive os de JSX) e de linha, mantendo as quebras de linha (o número da linha do achado
 * continua o do arquivo); `https://` não é comentário.
 */
const semComentarios = (codigo: string) =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\w])\/\/.*$/gm, "$1");

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

/** O campo nativo de hora (`type="time"`): mostra "03:00 PM" com o navegador ou o celular em inglês ou em 12 horas. */
const CAMPO_TIME = /\btype\s*=\s*\{?\s*["'`]time["'`]/;

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

describe("a hora no padrão do Brasil (M7.22)", () => {
  it("o detector pega a hora de relógio no formato antigo e deixa durações, caminhos de SVG e comentários", () => {
    for (const t of ['"às 15h"', '"até 23h59 de"', '"A partir da 0h do dia"', '"Todo dia às 20h."', '"entre 6h15 e 7h15"', '"D-2 10h,"', "<p>Enviar às 9h</p>"]) expect(horasAntigas(t), t).not.toEqual([]);
    for (const t of ['"Portaria 24h"', '"vale 48h"', '"às 15:00"', '"h1"', '"#0h"', '"v1.2h"', 'd="M4 8h16v7H4z M7 11h10"', '"M3 21h18 M3 13h18"', '"M7 5h.01"', "// às 15h", "/* até 23h59 */", "{/* às 20h */}"]) expect(horasAntigas(t), t).toEqual([]);
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
    for (const t of ['<input type="time" />', "<input type={'time'} />", '<input name="hora" type = "time" required />']) expect(CAMPO_TIME.test(t), t).toBe(true);
    for (const t of ['<input type="text" />', '<input type="timestamp" />', "// <input type=\"time\" />"]) expect(CAMPO_TIME.test(semComentarios(t)), t).toBe(false);
    const achados = fontes().flatMap((rel) =>
      semComentarios(readFileSync(join(SRC, rel), "utf8"))
        .split("\n")
        .flatMap((linha, i) => (CAMPO_TIME.test(linha) ? [`${rel}:${i + 1}: ${linha.trim()}`] : [])),
    );
    expect(achados).toEqual([]);
  });

  it("cada exceção ainda existe no arquivo dela (a que não serve mais sai da lista)", () => {
    for (const e of EXCECOES) expect(readFileSync(join(SRC, e.arquivo), "utf8"), `${e.arquivo}: ${e.trecho} (${e.motivo})`).toContain(e.trecho);
  });
});
