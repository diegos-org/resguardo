import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPLICACAO_FONTE_PRECOS_PORTAL, FONTES_PRECOS, fontePrecosDoPortal, NOMES_FONTE_PRECOS_PORTAL } from "@/imoveis/fonte-precos";

/**
 * M5.9 (decisão de Diego em 7/10): o Beds24 fica nos bastidores — nenhum texto que o proprietário ou o hóspede lê
 * (portal do proprietário, portal do hóspede, site, cadastro do marketplace, e-mails, mensagens, relatório) cita o
 * Beds24. O painel interno continua dizendo Beds24. Este teste varre o código dessas telas e e-mails, sem os
 * comentários e sem os nomes de função (que não aparecem para ninguém), e falha se a palavra voltar num texto.
 */
const RAIZ = join(__dirname, "..");
const PASTAS = [
  "app/portal",
  "app/hospede",
  "app/anunciar",
  "app/convite",
  "app/imoveis",
  "app/property",
  "app/reservar",
  "app/consulta",
  // Rotas públicas do site (calendário da consulta); a da situação do pagamento fica em app/reservar.
  "app/api/site",
  "components/portal",
  "components/site",
  "portal",
  "hospede",
  "site",
  "email",
  "mensagens",
  "relatorios",
  "marketplace",
  "convites",
  // Extrato, repasses e fechamento: os motivos e os e-mails chegam ao proprietário.
  "repasses",
  "fechamento",
];
const ARQUIVOS_SOLTOS = ["app/page.tsx", "app/layout.tsx"];

function arquivos(pasta: string): string[] {
  const caminho = join(RAIZ, pasta);
  let entradas: string[];
  try {
    entradas = readdirSync(caminho);
  } catch {
    return [];
  }
  return entradas.flatMap((nome) => {
    const completo = join(caminho, nome);
    if (statSync(completo).isDirectory()) return arquivos(join(pasta, nome));
    return /\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [join(pasta, nome)] : [];
  });
}

/** Tira comentários de bloco (inclusive os de JSX) e de linha; `https://` não é comentário. */
const semComentarios = (codigo: string) => codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\w])\/\/.*$/gm, "$1");

describe("Beds24 nos bastidores (M5.9)", () => {
  it("nenhum texto das telas, e-mails e documentos do proprietário e do hóspede cita o Beds24", () => {
    const lista = [...PASTAS.flatMap(arquivos), ...ARQUIVOS_SOLTOS];
    expect(lista.length).toBeGreaterThan(30);
    const achados = lista.flatMap((rel) => {
      let codigo: string;
      try {
        codigo = readFileSync(join(RAIZ, rel), "utf8");
      } catch {
        return [];
      }
      return semComentarios(codigo)
        .split("\n")
        .map((linha, i) => ({ rel, n: i + 1, linha }))
        // "Beds24" solto (texto), não como parte de um nome de função ou variável (organizacaoBeds24, precoNoBeds24).
        .filter(({ linha }) => !/^\s*import\b/.test(linha) && /(?<![A-Za-z0-9_])Beds24(?![A-Za-z0-9_])/.test(linha))
        .map(({ rel, n, linha }) => `${rel}:${n}: ${linha.trim()}`);
    });
    expect(achados).toEqual([]);
  });

  it("os nomes e as explicações da fonte de preços no portal não citam o Beds24, e a fonte chega ao portal já convertida", () => {
    for (const f of FONTES_PRECOS) {
      const doPortal = fontePrecosDoPortal(f);
      expect(doPortal).not.toMatch(/beds24/i);
      expect(NOMES_FONTE_PRECOS_PORTAL[doPortal]).not.toMatch(/beds24/i);
      expect(EXPLICACAO_FONTE_PRECOS_PORTAL[doPortal]).not.toMatch(/beds24/i);
    }
  });

  it("os componentes de navegador do portal e do site não carregam o nome interno nem como valor", () => {
    // O código de um componente "use client" vai inteiro para o navegador: nem o valor "beds24" (de fonte de preços ou
    // de bloqueio) pode estar nele — o servidor converte antes (`fontePrecosDoPortal`, `quemBloqueou`).
    const doNavegador = ["components/portal", "components/site"].flatMap(arquivos).filter((rel) => /^\s*["']use client["']/.test(readFileSync(join(RAIZ, rel), "utf8")));
    expect(doNavegador.length).toBeGreaterThan(3);
    const achados = doNavegador.filter((rel) => /beds24/i.test(semComentarios(readFileSync(join(RAIZ, rel), "utf8")).replace(/^\s*import\b.*$/gm, "")));
    expect(achados).toEqual([]);
  });
});
