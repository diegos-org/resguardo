import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage } from "node:http";
import { buildCustomRoute } from "next/dist/lib/build-custom-route";
import { matchHas } from "next/dist/shared/lib/router/utils/prepare-destination";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { NAO_LISTAR, PAGINAS_FORA_DOS_BUSCADORES } from "./fora-dos-buscadores";

/**
 * Os cabeçalhos que um endereço recebe, com as regras do `next.config.ts` montadas como o Next monta na publicação (a
 * mesma expressão que vai para o manifesto de rotas que a Vercel usa) e as condições da consulta do endereço (`has`)
 * conferidas pela mesma função do Next.
 */
async function cabecalhosDe(): Promise<(endereco: string) => { key: string; value: string }[]> {
  const regras = (await nextConfig.headers!()).map((r) => buildCustomRoute("header", r));
  return (endereco) => {
    const url = new URL(endereco, "https://site.exemplo");
    const consulta: Record<string, string | string[]> = {};
    for (const [chave, valor] of url.searchParams) {
      const antes = consulta[chave];
      consulta[chave] = antes === undefined ? valor : [...(Array.isArray(antes) ? antes : [antes]), valor];
    }
    const requisicao = { headers: {} } as IncomingMessage;
    return regras
      .filter((r) => new RegExp(r.regex).test(url.pathname) && matchHas(requisicao, consulta, r.has, r.missing) !== false)
      .flatMap((r) => r.headers);
  };
}

const robotsDe = (cabecalhos: { key: string; value: string }[]) => cabecalhos.filter((c) => c.key.toLowerCase() === "x-robots-tag");

/** Endereços pessoais ou internos: nenhum buscador pode listá-los (M7.10). */
const PRIVADOS = [
  "/painel",
  "/painel/",
  "/painel/reservas",
  "/painel/reservas/00000000-0000-4000-8000-000000000000",
  "/painel/configuracoes/textos-site",
  "/equipe",
  "/portal",
  "/portal/como-funciona",
  "/portal/relatorio",
  "/portal/repasses/abc/comprovante",
  "/entrar",
  "/convite/token-ficticio",
  "/hospede",
  "/hospede/entrar",
  "/reservar/ABC123",
  "/reservar/ABC123/pagamento",
  "/anunciar/dados",
  "/anunciar/enviado",
  // A etapa do código do cadastro do proprietário, com o e-mail da pessoa no endereço (src/marketplace/acoes.ts).
  "/anunciar?etapa=codigo&email=pessoa%40exemplo.com",
  "/anunciar?etapa=codigo&email=pessoa%40exemplo.com&erro=codigo",
  "/anunciar?email=pessoa%40exemplo.com",
  "/api/health",
  "/api/auth/signin",
  "/api/cron/cotacoes",
  "/api/pagamentos/mercadopago",
];

/**
 * Endereços públicos: continuam como estão, sem pedido aos buscadores. Se o site aparece no Google é decisão de Diego
 * (mapa do site), que este item não toma.
 */
const PUBLICOS = [
  "/",
  "/imoveis",
  "/imoveis/[codigo]",
  "/consulta",
  "/anunciar",
  "/privacidade",
  "/termos",
  "/cancelamento",
  "/fotos/[id]",
  "/fotos/[id]/pequena",
  "/imagens-site/[id]",
  "/property/[codigo]",
];

/** Rotas do app (páginas e endereços de servidor), no formato das pastas: `/imoveis/[codigo]`. */
function rotasDoApp(): string[] {
  const raiz = fileURLToPath(new URL("../app", import.meta.url));
  const rotas: string[] = [];
  const andar = (pasta: string) => {
    for (const e of readdirSync(pasta, { withFileTypes: true })) {
      const caminho = join(pasta, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith("__") && !e.name.startsWith("_")) andar(caminho);
      } else if (/^(page|route)\.(ts|tsx)$/.test(e.name)) {
        const segmentos = relative(raiz, pasta).split(sep).filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("@"));
        rotas.push(`/${segmentos.join("/")}`);
      }
    }
  };
  andar(raiz);
  return [...new Set(rotas)].sort();
}

/** Um endereço de verdade para a rota: cada parte variável vira um valor fictício. */
const exemplo = (rota: string) =>
  rota
    .replace(/\[\[\.\.\.[^\]]+\]\]/g, "a/b")
    .replace(/\[\.\.\.[^\]]+\]/g, "a/b")
    .replace(/\[[^\]]+\]/g, "x1");

describe("páginas pessoais e internas fora dos buscadores (M7.10)", () => {
  it("cada endereço pessoal ou interno recebe X-Robots-Tag noindex, uma vez só (raiz, barra no fim e o que fica abaixo)", async () => {
    const de = await cabecalhosDe();
    for (const caminho of PRIVADOS) expect(robotsDe(de(caminho)), caminho).toEqual([{ key: "X-Robots-Tag", value: "noindex, nofollow" }]);
  });

  it("as páginas públicas continuam sem pedido aos buscadores, e os vizinhos dos endereços privados também", async () => {
    const de = await cabecalhosDe();
    for (const rota of PUBLICOS) expect(robotsDe(de(exemplo(rota))), rota).toEqual([]);
    // Prefixo parecido não é o mesmo endereço.
    for (const caminho of ["/painelx", "/entrada", "/anunciar/outra", "/hospedes", "/convites", "/reservarx"]) expect(robotsDe(de(caminho)), caminho).toEqual([]);
    // A /anunciar sem o e-mail na consulta continua pública (com erro ou com outra consulta, também), e o e-mail na
    // consulta de outra página pública não muda nada.
    for (const endereco of ["/anunciar?erro=email-vazio", "/anunciar?etapa=codigo", "/anunciar?email=", "/anunciar#marketplace", "/?email=pessoa%40exemplo.com", "/imoveis?email=x"])
      expect(robotsDe(de(endereco)), endereco).toEqual([]);
  });

  it("toda rota do app está decidida: pessoal ou interna (fora dos buscadores) ou pública (fica como está)", async () => {
    const de = await cabecalhosDe();
    const rotas = rotasDoApp();
    // Conferência da própria lista: ela enxerga as rotas conhecidas dos dois lados.
    expect(rotas).toEqual(expect.arrayContaining(["/", "/painel", "/entrar", "/convite/[token]", "/reservar/[codigo]", "/anunciar/dados", "/imoveis/[codigo]"]));
    const semDecisao = rotas.filter((rota) => !PUBLICOS.includes(rota) && robotsDe(de(exemplo(rota))).length === 0);
    // Rota nova sem decisão: entra em src/site/fora-dos-buscadores.ts (pessoal ou interna) ou na lista PUBLICOS daqui.
    expect(semDecisao).toEqual([]);
    // E a lista de públicas daqui não guarda rota que já não existe.
    expect(PUBLICOS.filter((rota) => !rotas.includes(rota))).toEqual([]);
  });

  it("a cotação continua com a proteção contra enquadramento (M8.2a/b) além do pedido aos buscadores", async () => {
    const de = await cabecalhosDe();
    expect(de("/reservar/ABC123").map((c) => c.key)).toEqual(["Content-Security-Policy", "X-Frame-Options", "X-Robots-Tag"]);
    // A proteção contra enquadramento continua só na cotação.
    expect(de("/painel").map((c) => c.key)).toEqual(["X-Robots-Tag"]);
  });

  it("um lugar só: cada endereço da lista vira uma regra com o mesmo cabeçalho, sem repetição", async () => {
    const regras = await nextConfig.headers!();
    const robots = regras.filter((r) => r.headers.some((c) => c.key === NAO_LISTAR.key));
    expect(robots.map((r) => (r.has ? { source: r.source, has: r.has } : r.source))).toEqual([...PAGINAS_FORA_DOS_BUSCADORES]);
    for (const r of robots) expect(r.headers).toEqual([NAO_LISTAR]);
    const chaves = PAGINAS_FORA_DOS_BUSCADORES.map((e) => JSON.stringify(e));
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});
