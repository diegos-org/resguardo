// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEXTO_FAIXA_PREVIA } from "@/components/FaixaPrevia";
import stylesPainel from "@/components/painel/painel.module.css";
import { MolduraPortal } from "@/components/portal/MolduraPortal";
import stylesPortal from "@/components/portal/portal.module.css";
import { AVISO_NOVA_JANELA, ID_CONTEUDO, ROTULO_PULAR } from "@/components/site/Acessibilidade";
import { AceiteFeito, BlocoAceite } from "@/components/site/BlocoAceite";
import { BotaoContato } from "@/components/site/Cotacao";
import { FormSegurar } from "@/components/site/FormSegurar";
import { Moldura } from "@/components/site/Moldura";
import { MolduraBase } from "@/components/site/MolduraBase";
import styles from "@/components/site/site.module.css";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import type { AceiteNaPagina } from "@/site/aceites";
import type { ConteudoSite, ImovelPublico } from "@/site/site";
import Consulta from "../consulta/page";
import RootLayout from "../layout";
import PaginaImovel from "../imoveis/[codigo]/page";
import Catalogo from "../imoveis/page";
import NaoEncontradaNoSite from "../not-found";
import Inicio from "../page";
import PainelLayout from "../painel/layout";

/**
 * M7.11 — acessibilidade do site público, das páginas do hóspede e dos portais (levantamento de 14/10): o contorno de
 * foco visível também sobre os verdes, a miniatura escolhida da galeria, o "Pular para o conteúdo", o aviso dos links que
 * abrem outra janela e a ordem dos títulos. Os contrastes saem dos valores dos tokens em globals.css, sem cor repetida aqui.
 */
const m = vi.hoisted(() => ({ site: vi.fn(), imoveis: vi.fn(), imovel: vi.fn(), tem: vi.fn(), bairro: vi.fn(), disponibilidade: vi.fn(), portao: vi.fn(), pix: vi.fn(), sessao: vi.fn(), empresa: vi.fn() }));
vi.mock("@/site/pagina", () => ({ carregarSite: m.site, metadadosDoSite: vi.fn() }));
vi.mock("@/site/site", async (orig) => ({ ...(await orig<typeof import("@/site/site")>()), imoveisDoSite: m.imoveis, imovelDoSite: m.imovel, temCasaNoSite: m.tem }));
vi.mock("@/site/bairro", async (orig) => ({ ...(await orig<typeof import("@/site/bairro")>()), lugaresDoSite: m.bairro }));
// A busca em todas as casas (M7.9) lê as configurações uma vez e consulta cada casa pela mesma `consultarDisponibilidade`.
vi.mock("@/site/disponibilidade", async (orig) => ({
  ...(await orig<typeof import("@/site/disponibilidade")>()),
  consultarDisponibilidade: m.disponibilidade,
  lerConfigDaConsulta: vi.fn(async () => ({})),
}));
vi.mock("@/site/pagamento", () => ({ portaoDoSite: m.portao, pixPossivel: m.pix }));
// O layout do painel (faixa da prévia, M7.12): a sessão, o nome da empresa e o banco simulados; nada é lido de verdade.
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/acesso/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/configuracoes/empresa", async (orig) => ({ ...(await orig<typeof import("@/configuracoes/empresa")>()), nomeDaEmpresa: m.empresa }));
vi.mock("@/db/client", async (orig) => ({ ...(await orig<typeof import("@/db/client")>()), getDb: vi.fn(() => ({})) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NAO_ENCONTRADA");
  },
  // A troca de casa no envio do "Planeje sua estadia" (M7.9), na página do imóvel.
  useRouter: () => ({ push: vi.fn() }),
  // O menu do painel (faixa da prévia, M7.12).
  usePathname: () => "/painel",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...resto }: { children: React.ReactNode; href: string; className?: string; "aria-label"?: string }) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
}));

const SRC = join(process.cwd(), "src");
const ler = (rel: string) => readFileSync(join(SRC, rel), "utf8");

// ——— CSS: regras e tokens lidos dos arquivos ———

type Regra = { seletor: string; corpo: string };
/** Regras de um CSS (as de dentro de @media/@supports também), sem comentários; seletor com espaços normalizados. */
const regras = (css: string): Regra[] =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((r) => ({ seletor: r[1].trim().replace(/\s+/g, " "), corpo: r[2] }));
const valor = (corpo: string, propriedade: string) => new RegExp(`(?:^|[;{\\s])${propriedade}\\s*:\\s*([^;]+);`).exec(corpo)?.[1].trim();
const regra = (css: string, seletor: string) => {
  const achada = regras(css).find((r) => r.seletor === seletor);
  if (!achada) throw new Error(`regra ${seletor} não encontrada`);
  return achada.corpo;
};

const GLOBAL = ler("app/globals.css");
const TOKENS = Object.fromEntries([...regra(GLOBAL, ":root").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((t) => [t[1], t[2].trim()]));
/** O valor final de um token (segue `var(--outro)` até a cor). */
function cor(token: string): string {
  const v = TOKENS[token];
  if (!v) throw new Error(`token ${token} não existe em globals.css`);
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  return ref ? cor(ref[1]) : v;
}
const tokenDe = (texto: string) => /var\((--[\w-]+)\)/.exec(texto)?.[1] ?? "";

/** Contraste WCAG 2 entre duas cores #rrggbb. */
function contraste(a: string, b: string): number {
  const luminancia = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const MINIMO_INDICADOR = 3; // WCAG 1.4.11 (e DESIGN.md): 3:1 para contornos, ícones e indicadores
const VERDES = ["--scl-floresta", "--scl-profundo", "--scl-musgo", "--scl-salvia"];
const CLAROS = ["--scl-creme", "--scl-papel", "--scl-areia"];

const SELETOR_FOCO = "a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible, [tabindex]:focus-visible";
const FOCO = regra(GLOBAL, SELETOR_FOCO);
const [larguraFoco, , corFoco] = (valor(FOCO, "outline") ?? "").split(/\s+/);
const deslocamentoFoco = parseFloat(valor(FOCO, "outline-offset") ?? "0");
/** Até onde o contorno chega fora do elemento: o deslocamento mais a espessura. */
const ALCANCE_FOCO = deslocamentoFoco + parseFloat(larguraFoco);

const CSS_MODULOS: string[] = [];
(function varrer(dir: string) {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) varrer(caminho);
    else if (nome.endsWith(".module.css")) CSS_MODULOS.push(relative(SRC, caminho).split(sep).join("/"));
  }
})(join(SRC, "components"));

/**
 * Toda regra com fundo verde, classificada. Contêiner: há coisa focável sobre o verde (ou, no dia do calendário, o
 * contorno fica por dentro do próprio verde) — troca a cor do foco para a clara. Peça: um botão, um cartão-link ou um
 * enfeite sem nada focável; o contorno dele fica por fora, sobre o fundo de quem o contém, e herda a cor dali.
 */
const CONTEINERES = [
  "components/site/site.module.css | .topo",
  "components/site/site.module.css | .capa",
  "components/site/site.module.css | .casas",
  "components/site/site.module.css | .fechamento",
  "components/site/site.module.css | .rodape",
  'components/site/calendario.module.css | .ponta, .ponta:hover, .dia[aria-disabled="true"].ponta:hover',
  "components/painel/painel.module.css | .lateral",
  "components/portal/portal.module.css | .topo",
  "components/portal/portal.module.css | .rodape",
];
const PECAS = [
  "components/site/site.module.css | .botao",
  "components/site/site.module.css | .botao:hover",
  "components/site/site.module.css | .cartaoCasa",
  "components/site/site.module.css | .whatsapp",
  "components/site/site.module.css | .whatsapp:hover",
  "components/site/site.module.css | .capaComFoto::before",
  "components/site/site.module.css | .foto",
  "components/site/site.module.css | .contador",
  "components/site/site.module.css | .legendaFoto",
  "components/site/calendario.module.css | .fundo",
  "components/calendario/calendario.module.css | .hoje strong",
  "components/formularios.module.css | .acoes button, .botao",
  "components/formularios.module.css | .acoes button:hover, .botao:hover",
  "components/painel/painel.module.css | .filtro button",
  "components/painel/painel.module.css | .filtro button:hover",
  "components/painel/painel.module.css | .conteudo button:not([class])",
  "components/painel/painel.module.css | .conteudo button:not([class]):hover",
  "components/portal/portal.module.css | .botao",
  "components/portal/portal.module.css | .botao:hover",
];
const FUNDO_VERDE = /background(?:-color)?\s*:[^;]*var\(--scl-(?:floresta|profundo|musgo|musgo-escuro|salvia)\)/;
const FOCO_CLARO = /--scl-foco-cor\s*:\s*var\(--scl-foco-sobre-verde\)/;
/**
 * Áreas claras que aparecem dentro de um contêiner verde com coisa focável dentro (ex.: o cartão papel de "nenhuma casa
 * publicada", na faixa verde das casas da capa): herdariam o creme do verde, que some no fundo claro (1,05:1 no papel);
 * cada uma devolve o laranja no mesmo seletor do fundo.
 */
const CLAROS_DENTRO_DE_VERDE = ["components/site/site.module.css | .semCasas"];
const FUNDO_CLARO = /background(?:-color)?\s*:[^;]*var\(--scl-(?:creme|papel|areia|branco|neutro-fundo|erro-fundo|aviso-fundo|ok-fundo|info-fundo|dourado-claro)\)/;
const FOCO_LARANJA = /--scl-foco-cor\s*:\s*var\(--scl-foco\)/;
const regrasVerdes = () =>
  CSS_MODULOS.flatMap((arquivo) =>
    regras(ler(arquivo))
      .filter((r) => FUNDO_VERDE.test(r.corpo))
      .map((r) => ({ chave: `${arquivo} | ${r.seletor}`, corpo: r.corpo })),
  );

describe("contorno de foco visível sobre os verdes (M7.11)", () => {
  it("um contorno só para tudo: 3px, deslocado 5px (DESIGN.md), na cor da variável que os contêineres verdes trocam", () => {
    expect(larguraFoco).toBe("3px");
    expect(deslocamentoFoco).toBe(5);
    expect(corFoco).toBe("var(--scl-foco-cor)");
    expect(TOKENS["--scl-foco-cor"]).toBe("var(--scl-foco)");
    expect(TOKENS["--scl-foco-sobre-verde"]).toBe("var(--scl-creme)");
  });

  it("contrastes a partir dos tokens: o laranja nos fundos claros, o creme nos quatro verdes, sempre ≥ 3:1", () => {
    const laranja = cor("--scl-foco");
    const claro = cor("--scl-foco-sobre-verde");
    for (const fundo of CLAROS) expect(contraste(laranja, cor(fundo)), `foco sobre ${fundo}`).toBeGreaterThanOrEqual(MINIMO_INDICADOR);
    for (const verde of VERDES) {
      expect(contraste(claro, cor(verde)), `foco claro sobre ${verde}`).toBeGreaterThanOrEqual(MINIMO_INDICADOR);
      // O motivo do item: o laranja quase some nos verdes (1,27 a 2,29:1).
      expect(contraste(laranja, cor(verde)), `laranja sobre ${verde}`).toBeLessThan(MINIMO_INDICADOR);
    }
    // Os números do registro em DESIGN.md (desvio de 14/10).
    expect([cor("--scl-floresta"), cor("--scl-profundo"), cor("--scl-salvia"), cor("--scl-musgo")].map((v) => contraste(claro, v).toFixed(2))).toEqual(["6.20", "8.43", "4.68", "5.18"]);
    expect([cor("--scl-creme"), cor("--scl-papel")].map((v) => contraste(laranja, v).toFixed(2))).toEqual(["3.68", "3.88"]);
  });

  it("toda regra de fundo verde está classificada: os contêineres trocam para o foco claro, as peças não (herdam de quem as contém)", () => {
    const achadas = regrasVerdes();
    const chaves = achadas.map((r) => r.chave);
    // Fundo verde novo? Decida aqui: contêiner (algo focável sobre ele) ou peça (o contorno fica por fora).
    expect(chaves.filter((c) => !CONTEINERES.includes(c) && !PECAS.includes(c))).toEqual([]);
    // E a lista não fica velha: cada item ainda existe.
    expect([...CONTEINERES, ...PECAS].filter((c) => !chaves.includes(c))).toEqual([]);
    for (const r of achadas) expect(FOCO_CLARO.test(r.corpo), r.chave).toBe(CONTEINERES.includes(r.chave));
    // Cada contêiner, com o próprio fundo dele: o foco claro passa de 3:1.
    for (const r of achadas.filter((a) => CONTEINERES.includes(a.chave))) {
      const fundo = tokenDe(valor(r.corpo, "background") ?? "");
      expect(contraste(cor("--scl-foco-sobre-verde"), cor(fundo)), r.chave).toBeGreaterThanOrEqual(MINIMO_INDICADOR);
    }
  });

  it("as áreas claras dentro dos contêineres verdes devolvem o contorno laranja, no mesmo seletor do fundo claro", () => {
    for (const chave of CLAROS_DENTRO_DE_VERDE) {
      const [arquivo, seletor] = chave.split(" | ");
      const corpo = regra(ler(arquivo), seletor);
      expect(FUNDO_CLARO.test(corpo), chave).toBe(true);
      expect(FOCO_LARANJA.test(corpo), chave).toBe(true);
      const fundo = tokenDe(valor(corpo, "background") ?? "");
      expect(contraste(cor("--scl-foco"), cor(fundo)), chave).toBeGreaterThanOrEqual(MINIMO_INDICADOR);
      // O motivo: o creme herdado do verde some no fundo claro.
      expect(contraste(cor("--scl-foco-sobre-verde"), cor(fundo)), chave).toBeLessThan(MINIMO_INDICADOR);
    }
    // Nenhum contêiner verde devolve o laranja, e nenhuma área clara fora da lista troca a cor do foco.
    for (const arquivo of CSS_MODULOS)
      for (const r of regras(ler(arquivo)).filter((x) => FOCO_LARANJA.test(x.corpo)))
        expect(CLAROS_DENTRO_DE_VERDE, `${arquivo} | ${r.seletor}`).toContain(`${arquivo} | ${r.seletor}`);
  });

  it("dia do calendário de datas: o contorno fica inteiro por dentro do dia, sobre o fundo dele, e com a opacidade cheia", () => {
    const calendario = ler("components/site/calendario.module.css");
    const foco = regra(calendario, ".dia:focus-visible");
    const largura = parseFloat(valor(foco, "outline-width")!);
    // Deslocamento negativo de pelo menos a espessura: da borda do dia para dentro (os dias ficam colados um no outro).
    expect(-parseFloat(valor(foco, "outline-offset")!)).toBeGreaterThanOrEqual(largura);
    // O dia indisponível é apagado pela opacidade, que apagaria também o contorno.
    expect(valor(foco, "opacity")).toBe("1");
    // No dia escolhido (musgo), o contorno por dentro é o claro.
    const ponta = regra(calendario, '.ponta, .ponta:hover, .dia[aria-disabled="true"].ponta:hover');
    expect(contraste(cor("--scl-foco-sobre-verde"), cor(tokenDe(valor(ponta, "background")!)))).toBeGreaterThanOrEqual(MINIMO_INDICADOR);
  });

  it("o que flutua sobre faixas claras e verdes (WhatsApp, Pular para o conteúdo) ganha o halo creme sob o contorno laranja", () => {
    const halo = tokenDe(TOKENS["--scl-foco-halo"]);
    expect(halo).toBe("--scl-creme");
    expect(contraste(cor("--scl-foco"), cor(halo))).toBeGreaterThanOrEqual(MINIMO_INDICADOR);
    for (const verde of VERDES) expect(contraste(cor(halo), cor(verde)), verde).toBeGreaterThanOrEqual(MINIMO_INDICADOR);
    // O halo cobre o contorno inteiro (que vai até 8px fora), com folga.
    expect(parseFloat(TOKENS["--scl-foco-halo"].split(/\s+/)[3])).toBeGreaterThan(ALCANCE_FOCO);
    expect(valor(regra(ler("components/site/site.module.css"), ".whatsapp:focus-visible"), "box-shadow")).toBe("var(--scl-foco-halo)");
    expect(valor(regra(GLOBAL, ".scl-pular:focus-visible"), "box-shadow")).toBe("var(--scl-foco-halo)");
  });

  it("rolagens com coisa focável dentro têm folga para o contorno inteiro (a rolagem corta o que passa da borda)", () => {
    const site = ler("components/site/site.module.css");
    const folgas = (padding: string) => padding.split(/\s+/).map(parseFloat);
    // Carrossel da vitrine: folga dos quatro lados e o cartão para com a mesma folga depois de rolar.
    const carrossel = regras(site).find((r) => r.seletor === ".carrossel" && valor(r.corpo, "overflow-x"))!.corpo;
    expect(Math.min(...folgas(valor(carrossel, "padding")!))).toBeGreaterThanOrEqual(ALCANCE_FOCO);
    expect(parseFloat(valor(carrossel, "scroll-padding-inline")!)).toBeGreaterThanOrEqual(ALCANCE_FOCO);
    // Miniaturas da galeria quando rolam (mais de quatro fotos): para baixo no computador, para o lado no celular.
    const miniaturas = regra(site, ".miniaturasRolagem");
    expect(Math.min(...folgas(valor(miniaturas, "padding")!))).toBeGreaterThanOrEqual(ALCANCE_FOCO);
    expect(parseFloat(valor(miniaturas, "scroll-padding")!)).toBeGreaterThanOrEqual(ALCANCE_FOCO);
    // O menu do painel no celular rolava para o lado até o M0.10; agora abre a lista inteira (conferido mais abaixo).
  });
});

/** As regras de dentro de um @media (achado pelo par de chaves) e as de fora de todos eles. */
function porTela(css: string, condicao: string): { dentro: Regra[]; fora: Regra[] } {
  const limpo = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const inicio = limpo.indexOf(`@media ${condicao}`);
  if (inicio < 0) throw new Error(`@media ${condicao} não encontrado`);
  const abre = limpo.indexOf("{", inicio);
  let fim = abre + 1;
  for (let nivel = 1; nivel > 0; fim++) nivel += limpo[fim] === "{" ? 1 : limpo[fim] === "}" ? -1 : 0;
  const semMedias = (texto: string) => texto.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  return { dentro: regras(limpo.slice(abre + 1, fim - 1)), fora: regras(semMedias(limpo)) };
}

describe("menu do painel no celular (M0.10)", () => {
  const PAINEL = ler("components/painel/painel.module.css");
  const CELULAR = "(max-width: 760px)";
  const { dentro: celular, fora: computador } = porTela(PAINEL, CELULAR);
  const em = (lista: Regra[], seletor: string) => {
    const achada = lista.find((r) => r.seletor === seletor);
    if (!achada) throw new Error(`regra ${seletor} não encontrada`);
    return achada.corpo;
  };

  it("no computador, nada muda: o botão Menu não aparece e a lista lateral segue em coluna, sempre à vista", () => {
    expect(valor(em(computador, ".gaveta"), "display")).toBe("none");
    const menu = em(computador, ".menu");
    expect([valor(menu, "display"), valor(menu, "flex-direction")]).toEqual(["flex", "column"]);
    // A lista só se esconde com o <details> fechado, e isso só no celular.
    expect(computador.filter((r) => r.seletor.includes("[open]"))).toEqual([]);
  });

  it("no celular, o botão Menu abre a lista inteira, sem rolagem para o lado", () => {
    expect(valor(em(celular, ".gaveta"), "display")).toBe("block");
    expect(valor(em(celular, ".gaveta:not([open]) + .menu"), "display")).toBe("none");
    const menu = em(celular, ".menu");
    expect(valor(menu, "display")).toBe("grid");
    // Nenhuma regra do menu rola (nem esconde o que passa da borda), no celular ou no computador.
    for (const r of regras(PAINEL).filter((x) => /\.menu\b/.test(x.seletor))) expect(r.corpo, r.seletor).not.toMatch(/overflow|scroll-/);
    // Os itens quebram em linhas (grade), em vez de seguir numa faixa só.
    expect(valor(menu, "grid-template-columns")).toMatch(/^repeat\(auto-fill, minmax\(/);
    expect(valor(em(celular, ".menu a"), "white-space")).toBeUndefined();
  });

  it("alvos de toque de 44px: o botão e cada seção da lista", () => {
    expect(parseFloat(valor(em(celular, ".botaoMenu"), "min-height")!)).toBeGreaterThanOrEqual(44);
    expect(parseFloat(valor(em(celular, ".menu a"), "min-height")!)).toBeGreaterThanOrEqual(44);
  });

  it("o contorno do foco (M7.11) aparece no botão e fica inteiro sobre o verde do menu", () => {
    // O botão é um <summary>, que entra no mesmo contorno dos links e botões.
    expect(SELETOR_FOCO.split(", ")).toContain("summary:focus-visible");
    // O menu lateral é o contêiner verde que troca o contorno para o creme (M7.11)…
    expect(FOCO_CLARO.test(regra(PAINEL, ".lateral"))).toBe(true);
    // …e, no celular, a folga dos quatro lados cobre o alcance do contorno (deslocamento mais espessura).
    const folgas = (valor(em(celular, ".lateral"), "padding") ?? "").split(/\s+/).map(parseFloat);
    expect(Math.min(...folgas)).toBeGreaterThanOrEqual(ALCANCE_FOCO);
    // O triângulo padrão do <summary> sai: o botão tem a própria seta.
    expect(valor(em(celular, ".botaoMenu"), "list-style")).toBe("none");
    expect(valor(em(celular, ".botaoMenu::-webkit-details-marker"), "display")).toBe("none");
  });

  it("cabeçalho do painel no celular: o selo e o Sair descem de linha em vez de estourar a largura", () => {
    for (const seletor of [".cabecalho", ".cabecalhoAcoes"]) {
      const quebra = celular.filter((r) => r.seletor.split(", ").includes(seletor)).map((r) => valor(r.corpo, "flex-wrap"));
      expect(quebra, seletor).toContain("wrap");
    }
    // O selo não se espreme em duas linhas dentro da pílula.
    expect(valor(em(celular, ".selo"), "white-space")).toBe("nowrap");
    // No computador, como antes: uma linha só.
    expect(valor(em(computador, ".cabecalho"), "flex-wrap")).toBeUndefined();
    expect(valor(em(computador, ".cabecalhoAcoes"), "flex-wrap")).toBeUndefined();
  });
});

describe("miniatura escolhida da galeria (M7.11)", () => {
  it("anel dourado-escuro por dentro (≥ 3:1 no creme e no papel), sem disputar com o contorno do foco, que fica por fora", () => {
    const site = ler("components/site/site.module.css");
    const escolhida = regra(site, '.miniatura[aria-current="true"]::after');
    const [espessura, , corAnel] = (valor(escolhida, "border") ?? "").split(/\s+/);
    expect(espessura).toBe("3px");
    expect(tokenDe(corAnel)).toBe("--scl-dourado-escuro");
    for (const fundo of ["--scl-creme", "--scl-papel"]) expect(contraste(cor(tokenDe(corAnel)), cor(fundo)), fundo).toBeGreaterThanOrEqual(MINIMO_INDICADOR);
    // O dourado de antes não chegava a 3:1.
    expect(contraste(cor("--scl-dourado"), cor("--scl-creme"))).toBeLessThan(MINIMO_INDICADOR);
    // Por dentro da borda (inset 0) e acima da foto; a miniatura não tem contorno próprio: vale o do foco, a 5px por fora.
    expect(valor(escolhida, "inset")).toBe("0");
    expect(regras(site).filter((r) => r.seletor.startsWith(".miniatura") && valor(r.corpo, "outline"))).toEqual([]);
  });
});

// ——— Telas ———

const imovel: ImovelPublico = {
  codigo: "403",
  fuso: "America/Sao_Paulo",
  nome: "Studio Exemplo",
  bairro: "Leblon",
  cidade: "Rio de Janeiro",
  capacidade: 4,
  quartos: 0,
  banheiros: 1,
  descricao: "Frase fictícia do apartamento.",
  frase: "",
  camas: ["1 cama de casal"],
  comodidades: ["Wi-Fi", "Comodidade sem ícone"],
  regrasCasa: "",
  aceitaAnimais: false,
  permiteFumar: false,
  permiteFestas: false,
  checkinAPartirDe: "15:00",
  checkoutAte: "11:00",
  estadiaMinima: null,
  fotos: [
    { grande: "/fotos/f1", pequena: "/fotos/f1/pequena", legenda: "" },
    { grande: "/fotos/f2", pequena: "/fotos/f2/pequena", legenda: "" },
  ],
};
const conteudo: ConteudoSite = {
  organizacaoId: "org",
  nomeEmpresa: "Sua Casa Exemplo",
  textos: { ...TEXTOS_SITE_INICIAIS, porque: "Primeiro\nTexto um.\n\nSegundo\nTexto dois.", comoReservar: "Passos fictícios.", contato: "Contato fictício.", chamada: "Venha *logo*." },
  whatsapp: "5521900000000",
  email: "",
  imagens: { capa: null, marca: "/marca.png" },
};
const disponivel = { situacao: "disponivel", motivos: [], noites: 3, cotacao: { diarias: 135000, limpeza: 25000, hospedeExtra: 0, valorCheio: 160000, desconto: 6400, total: 153600 }, leituraEm: new Date("2026-10-01T09:15:00Z") };
const pedido = { imovel: "403", entrada: "2099-10-12", saida: "2099-10-15", hospedes: "2" };
/** Busca em todas as casas (M7.9): as datas e as pessoas, sem casa escolhida. */
const busca = { entrada: pedido.entrada, saida: pedido.saida, hospedes: pedido.hospedes };

beforeEach(() => {
  vi.clearAllMocks();
  m.site.mockResolvedValue({ db: {}, conteudo });
  m.imoveis.mockResolvedValue([imovel]);
  m.imovel.mockResolvedValue(imovel);
  m.tem.mockResolvedValue(true);
  m.bairro.mockResolvedValue({ olho: "O bairro à sua porta", titulo: "O Leblon a pé", subtitulo: "", lugares: [{ nome: "Praia fictícia", distancia: "2 min", frase: "", foto: null }] });
  m.disponibilidade.mockResolvedValue(disponivel);
  m.portao.mockResolvedValue({ ok: false });
  m.pix.mockResolvedValue(false);
});

const dom = (html: string) => {
  const raiz = document.createElement("div");
  raiz.innerHTML = html;
  return raiz;
};
const props = (params: Record<string, string>, searchParams: Record<string, string> = {}) => ({ params: Promise.resolve(params), searchParams: Promise.resolve(searchParams) });
const telas = async () => ({
  "página inicial": renderToStaticMarkup(await Inicio()),
  "Nossas casas": renderToStaticMarkup(await Catalogo()),
  "página do imóvel": renderToStaticMarkup(await PaginaImovel(props({ codigo: "403" }, pedido) as never)),
  consulta: renderToStaticMarkup(await Consulta(props({}, pedido) as never)),
  "Sua busca": renderToStaticMarkup(await Consulta(props({}, busca) as never)),
  "não encontrada": renderToStaticMarkup(await NaoEncontradaNoSite()),
});
/** As telas com o site sem nenhuma casa publicada (M7.8), como na produção hoje; a busca mostra o mesmo aviso (M7.9). */
const telasSemCasas = async () => {
  m.imoveis.mockResolvedValue([]);
  m.tem.mockResolvedValue(false);
  return {
    "página inicial": renderToStaticMarkup(await Inicio()),
    "Nossas casas": renderToStaticMarkup(await Catalogo()),
    consulta: renderToStaticMarkup(await Consulta(props({}) as never)),
    "Sua busca": renderToStaticMarkup(await Consulta(props({}, busca) as never)),
    "não encontrada": renderToStaticMarkup(await NaoEncontradaNoSite()),
  };
};

/** Níveis dos títulos na ordem da página. */
const niveis = (html: string) => [...dom(html).querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => Number(h.tagName[1]));
/** Saltos na ordem dos títulos: o primeiro tem de ser o h1, há um h1 só e nenhum título desce mais de um nível. */
function saltos(lista: number[]): string[] {
  const erros: string[] = [];
  if (lista[0] !== 1) erros.push(`começa em h${lista[0]}`);
  if (lista.filter((n) => n === 1).length !== 1) erros.push(`${lista.filter((n) => n === 1).length} h1`);
  lista.forEach((n, i) => i > 0 && n > lista[i - 1] + 1 && erros.push(`h${lista[i - 1]} → h${n}`));
  return erros;
}

const FOCAVEIS = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]';
const primeiroFocavel = (raiz: HTMLElement) => [...raiz.querySelectorAll<HTMLElement>(FOCAVEIS)].find((el) => el.getAttribute("tabindex") !== "-1");

describe("Pular para o conteúdo (M7.11)", () => {
  const confere = (html: string) => {
    const raiz = dom(html);
    const pular = primeiroFocavel(raiz);
    expect(pular?.textContent).toBe(ROTULO_PULAR);
    expect(pular?.getAttribute("href")).toBe(`#${ID_CONTEUDO}`);
    expect(pular?.className).toBe("scl-pular");
    // O alvo existe, é o miolo, um só, e recebe o foco de fato (tabIndex -1: fora da ordem do Tab, mas focável).
    const alvos = raiz.querySelectorAll(`#${ID_CONTEUDO}`);
    expect(alvos.length).toBe(1);
    expect(alvos[0].tagName).toBe("MAIN");
    expect(alvos[0].getAttribute("tabindex")).toBe("-1");
  };

  it("primeiro elemento focável da moldura do site (com e sem o banco) e da moldura dos portais, apontando para o miolo", async () => {
    confere(renderToStaticMarkup(<Moldura conteudo={conteudo}>{<h1>Oi</h1>}</Moldura>));
    confere(renderToStaticMarkup(<MolduraBase>{<h1>Erro</h1>}</MolduraBase>));
    confere(renderToStaticMarkup(<MolduraPortal empresa="Sua Casa Exemplo" titulo="Portal do proprietário">{<h1>Portal</h1>}</MolduraPortal>));
    confere(renderToStaticMarkup(<MolduraPortal empresa="">{<h1>Erro</h1>}</MolduraPortal>));
    for (const [tela, html] of Object.entries(await telas())) {
      expect(primeiroFocavel(dom(html))?.textContent, tela).toBe(ROTULO_PULAR);
      confere(html);
    }
  });

  it("escondido até receber o foco, e o miolo focado pelo link não ganha contorno (é um contêiner, não um controle)", () => {
    expect(valor(regra(GLOBAL, ".scl-pular"), "top")).toBe("-100px");
    expect(valor(regra(GLOBAL, ".scl-pular:focus"), "top")).toBe("10px");
    expect(valor(regra(GLOBAL, 'main[tabindex="-1"]:focus'), "outline")).toBe("none");
    // Texto e fundo do link legíveis (tinta sobre papel).
    expect(contraste(cor(tokenDe(valor(regra(GLOBAL, ".scl-pular"), "color")!)), cor(tokenDe(valor(regra(GLOBAL, ".scl-pular"), "background")!)))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("resultado à vista depois do envio da consulta (M7.21)", () => {
  /** A âncora do envio (`ID_RESULTADO`, em FormConsulta.tsx): fica no endereço, que o visitante pode copiar e mandar. */
  const ID_RESULTADO = "resultado";
  /** O destino da âncora na página. */
  const alvos = (raiz: HTMLElement) => [...raiz.querySelectorAll<HTMLElement>(`#${ID_RESULTADO}`)];
  const consultar = async (sp: Record<string, string>) => renderToStaticMarkup(await Consulta(props({}, sp) as never));
  /** O nome que o leitor de tela anuncia ao focar o alvo: o título ligado por aria-labelledby, senão o aria-label. */
  const nome = (raiz: HTMLElement, alvo: HTMLElement) => (alvo.getAttribute("aria-labelledby") ? raiz.querySelector(`#${alvo.getAttribute("aria-labelledby")}`)?.textContent : alvo.getAttribute("aria-label"));

  it("todo formulário da consulta (capa, página da casa, consulta e busca) envia por GET para a âncora do resultado", async () => {
    const comFormulario: string[] = [];
    for (const [tela, html] of Object.entries(await telas())) {
      const forms = dom(html).querySelectorAll('form[aria-label="Consultar disponibilidade"]');
      if (forms.length) comFormulario.push(tela);
      for (const form of forms) {
        expect(form.getAttribute("action"), tela).toBe(`/consulta#${ID_RESULTADO}`);
        expect(form.getAttribute("method"), tela).toBe("get");
      }
    }
    expect(comFormulario).toEqual(["página inicial", "página do imóvel", "consulta", "Sua busca"]);
  });

  it("com resultado, a página abre nele: um alvo só, focável fora da ordem do Tab, com nome para o leitor de tela", async () => {
    // Consulta de uma casa: o quadro "Resumo da viagem", com a disponibilidade e o valor dentro.
    const consulta = dom(await consultar(pedido));
    const [resumo, ...outros] = alvos(consulta);
    expect(outros).toEqual([]);
    expect(resumo.tagName).toBe("ASIDE");
    expect(resumo.className).toBe(styles.resumoViagem);
    expect(resumo.getAttribute("tabindex")).toBe("-1");
    expect(nome(consulta, resumo)).toBe("Resumo da viagem");
    expect(resumo.querySelector('[aria-label="Disponibilidade e valor"]')?.textContent).toContain("Disponível");
    // Busca em todas as casas: a lista "N casas na sua busca", com os cartões dentro.
    const busca1 = dom(await consultar(busca));
    const [lista, ...maisListas] = alvos(busca1);
    expect(maisListas).toEqual([]);
    expect(lista.tagName).toBe("SECTION");
    expect(lista.getAttribute("tabindex")).toBe("-1");
    expect(nome(busca1, lista)).toBe("1 casa na sua busca");
    expect(lista.querySelector('a[href^="/imoveis/403?"]')).not.toBeNull();
    // Nenhuma casa recebe o grupo: o aviso com o contato é o resultado.
    const grande = dom(await consultar({ ...busca, hospedes: "9" }));
    const [aviso, ...maisAvisos] = alvos(grande);
    expect(maisAvisos).toEqual([]);
    expect(aviso.getAttribute("tabindex")).toBe("-1");
    expect(nome(grande, aviso)).toBe("Nenhuma casa para o grupo");
    expect(aviso.textContent).toContain(TEXTOS_SITE_INICIAIS.buscaSemCasa);
    // O alvo não entra na ordem do Tab: o primeiro focável continua sendo o "Pular para o conteúdo".
    for (const raiz of [consulta, busca1, grande]) expect(primeiroFocavel(raiz)?.textContent).toBe(ROTULO_PULAR);
  });

  it("com erro de preenchimento (ou sem datas), nenhum alvo: a âncora não acha nada e a página fica no topo, onde os erros aparecem", async () => {
    const casos: [string, Record<string, string>, string | null][] = [
      ["consulta sem datas", {}, null],
      ["consulta com a entrada antes de hoje", { ...pedido, entrada: "2020-01-10" }, "A entrada não pode ser antes de hoje."],
      ["consulta com o grupo maior que a casa", { ...pedido, hospedes: "9" }, "Este apartamento recebe até 4 pessoas."],
      ["busca com a saída igual à entrada", { ...busca, saida: busca.entrada }, "A saída precisa ser depois da entrada."],
      ["busca sem o número de pessoas", { ...busca, hospedes: "" }, "Informe quantas pessoas."],
    ];
    for (const [caso, sp, erro] of casos) {
      const raiz = dom(await consultar(sp));
      expect(alvos(raiz), caso).toEqual([]);
      if (erro) expect([...raiz.querySelectorAll(`form .${styles.erro}`)].map((e) => e.textContent), caso).toContain(erro);
    }
    // Busca sem o número de pessoas: o campo combina com o aviso ("Escolha", obrigatório), sem um palpite de 2 pessoas.
    const semPessoas = dom(await consultar({ ...busca, hospedes: "" })).querySelector<HTMLSelectElement>('form select[name="hospedes"]')!;
    expect(semPessoas.value).toBe("");
    expect(semPessoas.required).toBe(true);
    expect(semPessoas.options[0].textContent).toBe("Escolha");
    expect(semPessoas.getAttribute("aria-describedby")).toBe("erro-hospedes");
    // Grupo maior que a casa: o número pedido continua marcado, ao lado do aviso "recebe até N pessoas".
    expect(dom(await consultar({ ...pedido, hospedes: "9" })).querySelector<HTMLSelectElement>('form select[name="hospedes"]')!.value).toBe("9");
    // Nada foi consultado com dados errados (e o quadro do resumo fica com "a confirmar").
    expect(m.disponibilidade).not.toHaveBeenCalled();
    // A página da casa não é destino do envio: nem com a disponibilidade à vista há alvo nela.
    const casa = dom(renderToStaticMarkup(await PaginaImovel(props({ codigo: "403" }, pedido) as never)));
    expect(casa.querySelector('[aria-label="Disponibilidade e valor"]')).not.toBeNull();
    expect(alvos(casa)).toEqual([]);
  });

  it("o alvo focado não ganha contorno (é um contêiner, como o miolo) e para com folga da borda; o contorno dos controles continua", () => {
    expect(valor(regra(GLOBAL, `#${ID_RESULTADO}[tabindex="-1"]:focus`), "outline")).toBe("none");
    expect(valor(regra(GLOBAL, 'main[tabindex="-1"]:focus'), "outline")).toBe("none");
    expect(parseFloat(valor(regra(GLOBAL, `#${ID_RESULTADO}`), "scroll-margin-top") ?? "0")).toBeGreaterThan(0);
    // O contorno de sempre, nos controles (inclusive os de tabindex próprio, como os dias do calendário), não mudou.
    expect(valor(FOCO, "outline")).toBe("3px solid var(--scl-foco-cor)");
    // Sem rolagem animada na página: o navegador pula direto para o resultado, também com "reduzir movimento".
    expect(regras(GLOBAL).filter((r) => valor(r.corpo, "scroll-behavior"))).toEqual([]);
  });
});

describe("áreas claras dentro das faixas verdes do site, nas telas (M7.11)", () => {
  it("toda área clara com coisa focável dentro de um contêiner verde está na lista das que devolvem o laranja", async () => {
    const SITE = "components/site/site.module.css";
    /** Classes simples (`.nome`) de uma lista "arquivo | seletor", só as do site. */
    const classesDoSite = (lista: string[]) =>
      lista
        .filter((c) => c.startsWith(`${SITE} | `))
        .flatMap((c) => c.split(" | ")[1].split(", "))
        .filter((sel) => /^\.\w+$/.test(sel))
        .map((sel) => sel.slice(1));
    const verdes = classesDoSite(CONTEINERES);
    const claras = [
      ...new Set(
        regras(ler(SITE))
          .filter((r) => FUNDO_CLARO.test(r.corpo))
          .flatMap((r) => r.seletor.split(", "))
          .filter((sel) => /^\.\w+$/.test(sel))
          .map((sel) => sel.slice(1)),
      ),
    ];
    expect(verdes).toEqual(["topo", "capa", "casas", "fechamento", "rodape"]);
    expect(claras).toContain("semCasas");
    /** As áreas claras, dentro de algum contêiner verde, que têm link, botão ou campo dentro (o contorno cai sobre elas). */
    const achadas = new Set<string>();
    const procurar = (html: string) => {
      const raiz = dom(html);
      for (const v of verdes)
        for (const conteiner of raiz.querySelectorAll(`.${styles[v]}`))
          for (const c of claras) if ([...conteiner.querySelectorAll(`.${styles[c]}`)].some((el) => el.querySelector(FOCAVEIS))) achadas.add(c);
    };
    for (const html of Object.values(await telas())) procurar(html);
    // Sem casas publicadas, como na produção hoje (a busca também).
    for (const html of Object.values(await telasSemCasas())) procurar(html);
    expect([...achadas].filter((c) => !classesDoSite(CLAROS_DENTRO_DE_VERDE).includes(c))).toEqual([]);
    // E a lista não fica velha: o aviso sem casas aparece de fato dentro da faixa verde das casas, com o botão do contato.
    expect([...achadas]).toContain("semCasas");
  });
});

describe("links que abrem outra janela avisam quem usa leitor de tela (M7.11)", () => {
  const aviso = `(${AVISO_NOVA_JANELA})`;
  /** Cada `target="_blank"` do HTML: rel seguro e o aviso no aria-label ou no texto oculto do fim do link. */
  const semAviso = (html: string) =>
    [...dom(html).querySelectorAll("a[target]")]
      .filter((a) => {
        const rotulo = a.getAttribute("aria-label");
        const oculto = a.querySelector(".scl-so-leitor")?.textContent?.trim();
        return a.getAttribute("target") !== "_blank" || a.getAttribute("rel") !== "noopener noreferrer" || !(rotulo ? rotulo.endsWith(` ${aviso}`) : oculto === aviso);
      })
      .map((a) => a.outerHTML);
  const contar = (html: string) => dom(html).querySelectorAll('a[target="_blank"]').length;

  it("nas telas do site e do hóspede: WhatsApp da moldura e da consulta, contato do site sem casas, páginas legais, Pix", async () => {
    const t = await telas();
    for (const [tela, html] of Object.entries(t)) expect(semAviso(html), tela).toEqual([]);
    // O botão flutuante: o aviso vai no rótulo que ele já tinha.
    expect(dom(t.consulta).querySelector(`a[aria-label="Falar com Sua Casa Exemplo pelo WhatsApp ${aviso}"]`)).toBeTruthy();
    // A mensagem da consulta pelo WhatsApp (botão com texto): o aviso no fim do link, só para o leitor de tela.
    expect([...dom(t.consulta).querySelectorAll("a")].find((a) => a.textContent?.startsWith("Enviar pelo WhatsApp"))?.textContent).toBe(`Enviar pelo WhatsApp↗ ${aviso}`);
    expect(contar(t.consulta)).toBe(2);
    // Sua busca (M7.9): o botão do contato, ao lado das casas, também abre o WhatsApp (o botão flutuante e ele).
    expect(contar(t["Sua busca"])).toBe(2);
    expect([...dom(t["Sua busca"]).querySelectorAll(`.${styles.contatoBusca} a`)].map((a) => a.textContent)).toEqual([`Falar pelo WhatsApp↗ ${aviso}`]);
    // Sem casas: o contato do site também abre o WhatsApp (na busca, com as datas e as pessoas na mensagem).
    const semCasas = await telasSemCasas();
    for (const tela of ["página inicial", "não encontrada", "Sua busca"] as const) {
      expect(contar(semCasas[tela]), tela).toBe(2);
      expect(semAviso(semCasas[tela]), tela).toEqual([]);
    }
    for (const [tela, html] of Object.entries(semCasas)) expect(semAviso(html), tela).toEqual([]);
    // Cotação, segurar as datas e o aceite das páginas legais (antes de pagar e já feito).
    const aceite: AceiteNaPagina = { versoes: { termos: 2, privacidade: 1, cancelamento: 3 }, aceito: null, resumo: [{ tipo: "paragrafo", texto: "RESUMO" }], prazo: { tipo: "integral_ate", data: "2099-10-01" } };
    const pecas = [
      renderToStaticMarkup(<BotaoContato whatsapp="5521900000000" email="" codigo="COT-ABCDEFGH" texto="Olá" />),
      renderToStaticMarkup(<FormSegurar codigo="COT-ABCDEFGH" minutos={30} acao={vi.fn()} comPagamento privacidade={2} />),
      renderToStaticMarkup(<BlocoAceite aceite={aceite} fuso="America/Sao_Paulo" />),
      renderToStaticMarkup(<AceiteFeito aceito={{ em: "2026-10-01T15:02:00.000Z", versoes: aceite.versoes }} fuso="America/Sao_Paulo" />),
    ];
    expect(pecas.map(contar)).toEqual([1, 1, 3, 3]);
    for (const html of pecas) expect(semAviso(html)).toEqual([]);
  });

  it('um lugar só: fora do painel, nenhum target="_blank" no código além do LinkNovaJanela', () => {
    // O painel interno ficou fora do M7.11 (seus links seguem como estavam): estes são os dele.
    const PAINEL = ["components/reservas/PaginasLegaisAceitas.tsx", "components/reservas/ContestacaoSite.tsx", "components/reservas/PagamentoNoSite.tsx", "components/anuncios/QuadroAnuncios.tsx"];
    const achados: string[] = [];
    (function varrer(dir: string) {
      for (const nome of readdirSync(dir)) {
        const caminho = join(dir, nome);
        const rel = relative(SRC, caminho).split(sep).join("/");
        if (statSync(caminho).isDirectory()) {
          if (rel !== "app/painel") varrer(caminho);
        } else if (/\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome) && !PAINEL.includes(rel) && rel !== "components/site/Acessibilidade.tsx" && readFileSync(caminho, "utf8").includes("_blank")) achados.push(rel);
      }
    })(SRC);
    expect(achados).toEqual([]);
  });
});

describe("ordem dos títulos sem saltos (M7.11)", () => {
  it("página do imóvel: h1 do imóvel, as partes da ficha em h2 (antes h3) e os lugares do bairro em h3", async () => {
    const html = renderToStaticMarkup(await PaginaImovel(props({ codigo: "403" }, pedido) as never));
    expect(niveis(html)).toEqual([1, 2, 2, 2, 2, 2, 2, 2, 3]);
    expect(saltos(niveis(html))).toEqual([]);
    // O visual não muda: as partes da ficha mantêm o tamanho menor pela classe.
    for (const titulo of ["O que você encontra", "Camas", "Regras da casa"]) {
      const h = [...dom(html).querySelectorAll("h2")].find((e) => e.textContent === titulo);
      expect(h?.className, titulo).toBe(styles.tituloFicha);
    }
    // Sem datas no link, sem o bairro e sem camas: continua sem salto.
    m.bairro.mockResolvedValue({ olho: "", titulo: "", subtitulo: "", lugares: [] });
    m.imovel.mockResolvedValue({ ...imovel, camas: [], comodidades: [] });
    expect(saltos(niveis(renderToStaticMarkup(await PaginaImovel(props({ codigo: "403" }) as never))))).toEqual([]);
  });

  it("frase de abertura da casa (M7.17): h2 em serifa logo acima da descrição, sem salto; sem frase, nada no lugar", async () => {
    const frase = "Dias leves fictícios entre a praia e os restaurantes.";
    m.imovel.mockResolvedValue({ ...imovel, frase });
    const comDatas = renderToStaticMarkup(await PaginaImovel(props({ codigo: "403" }, pedido) as never));
    // Um h2 a mais que a página sem frase (o teste acima), no mesmo nível das partes da ficha.
    expect(niveis(comDatas)).toEqual([1, 2, 2, 2, 2, 2, 2, 2, 2, 3]);
    expect(saltos(niveis(comDatas))).toEqual([]);
    const h = [...dom(comDatas).querySelectorAll("h2")].find((e) => e.textContent === frase);
    expect(h?.className).toBe(styles.fraseDaCasa);
    // Acima da descrição, logo depois da disponibilidade das datas do link.
    expect(h?.nextElementSibling?.textContent).toBe(imovel.descricao);
    expect(h?.nextElementSibling?.className).toBe(styles.texto);
    // Sem datas no link, é a primeira coisa da coluna do texto.
    const semDatas = dom(renderToStaticMarkup(await PaginaImovel(props({ codigo: "403" }) as never)));
    expect(semDatas.querySelector(`.${styles.editorial}`)?.firstElementChild?.textContent).toBe(frase);
    // Frase sem descrição: a frase aparece sozinha, sem parágrafo vazio.
    m.imovel.mockResolvedValue({ ...imovel, frase, descricao: "" });
    const soFrase = dom(renderToStaticMarkup(await PaginaImovel(props({ codigo: "403" }) as never)));
    expect(soFrase.querySelector(`.${styles.fraseDaCasa}`)?.textContent).toBe(frase);
    expect(soFrase.querySelector(`.${styles.editorial} > .${styles.texto}`)).toBeNull();
    // Sem frase (o padrão de todo imóvel): nenhum título no lugar e a descrição abre a coluna, como antes.
    m.imovel.mockResolvedValue(imovel);
    const semFrase = dom(renderToStaticMarkup(await PaginaImovel(props({ codigo: "403" }) as never)));
    expect(semFrase.querySelector(`.${styles.fraseDaCasa}`)).toBeNull();
    expect(semFrase.querySelector(`.${styles.editorial}`)?.firstElementChild?.textContent).toBe(imovel.descricao);
    // A serifa vem do h2 do site (globals.css): a regra da frase não troca a fonte, só o tamanho e o espaço.
    const css = ler("components/site/site.module.css");
    expect(valor(regra(css, ".editorial .fraseDaCasa"), "font-family")).toBeUndefined();
    expect(valor(regra(GLOBAL, "h1, h2, h3"), "font-family")).toBe("var(--font-serif)");
  });

  it("Nossas casas: o título de cada casa é h2, logo abaixo do h1 (na vitrine da capa, h3 abaixo do h2 da faixa), com o mesmo visual", async () => {
    const catalogo = renderToStaticMarkup(await Catalogo());
    expect(niveis(catalogo)).toEqual([1, 2]);
    expect(dom(catalogo).querySelector("h2")?.className).toBe(styles.cartaoTitulo);
    const inicio = renderToStaticMarkup(await Inicio());
    expect(dom(inicio).querySelector(`.${styles.cartaoCasa} h3`)?.className).toBe(styles.cartaoTitulo);
  });

  it("capa, Nossas casas, consulta e não encontrada: nenhuma tela salta um nível", async () => {
    for (const [tela, html] of Object.entries(await telas())) expect(saltos(niveis(html)), tela).toEqual([]);
    for (const [tela, html] of Object.entries(await telasSemCasas())) expect(saltos(niveis(html)), tela).toEqual([]);
  });

  it("Sua busca (M7.9): o h1 do cabeçalho da busca, o h2 da lista de casas e o nome de cada casa em h3, no visual do cartão", async () => {
    m.imoveis.mockResolvedValue([imovel, { ...imovel, codigo: "404", nome: "Casa Exemplo" }]);
    const lista = renderToStaticMarkup(await Consulta(props({}, busca) as never));
    expect(niveis(lista)).toEqual([1, 2, 3, 3]);
    expect(dom(lista).querySelector("h2")?.textContent).toBe("2 casas na sua busca");
    for (const h of dom(lista).querySelectorAll("h3")) expect(h.className).toBe(styles.cartaoTitulo);
    // Nenhuma casa para o grupo, datas erradas e o site sem casas: só o h1 do cabeçalho da busca, sem salto.
    for (const pedidoBusca of [{ ...busca, hospedes: "9" }, { ...busca, saida: busca.entrada }]) {
      const html = renderToStaticMarkup(await Consulta(props({}, pedidoBusca) as never));
      expect(niveis(html), JSON.stringify(pedidoBusca)).toEqual([1]);
    }
    m.imoveis.mockResolvedValue([]);
    expect(niveis(renderToStaticMarkup(await Consulta(props({}, busca) as never)))).toEqual([1]);
  });
});

describe('faixa "Prévia de teste" no topo (M7.12)', () => {
  it("texto legível pelos tokens (≥ 4,5:1, texto pequeno), fundo claro fora das listas de verdes e nada focável dentro", () => {
    const faixa = regra(GLOBAL, ".scl-previa");
    const [texto, fundo] = [tokenDe(valor(faixa, "color")!), tokenDe(valor(faixa, "background")!)];
    expect([texto, fundo]).toEqual(["--scl-tinta", "--scl-areia"]);
    expect(contraste(cor(texto), cor(fundo)).toFixed(2)).toBe("10.66");
    expect(contraste(cor(texto), cor(fundo))).toBeGreaterThanOrEqual(4.5);
    // Não é fundo verde: não entra na classificação de contêineres e peças, e o contorno do foco segue o de cada página.
    expect(FUNDO_VERDE.test(faixa)).toBe(false);
    expect(FOCO_CLARO.test(faixa) || FOCO_LARANJA.test(faixa)).toBe(false);
  });

  it("com a faixa, a moldura de baixo ocupa o resto da tela (sem rolagem a mais nas páginas curtas); sem ela, nada muda", () => {
    // As molduras seguem com uma tela inteira de altura (100vh): é o que, somado à faixa, passaria do fim da tela.
    for (const [arquivo, seletor] of [["components/site/site.module.css", ".pagina"], ["components/portal/portal.module.css", ".pagina"], ["components/painel/painel.module.css", ".estrutura"]])
      expect(valor(regra(ler(arquivo), seletor), "min-height"), arquivo).toBe("100vh");
    // Só com a faixa (:has): o corpo, que já tem uma tela de altura, vira coluna, e o que vem logo depois da faixa cresce
    // até o fim dela, sem os 100vh da moldura (sem altura fixa: no celular a faixa pode ter duas linhas).
    expect(valor(regra(GLOBAL, "body"), "min-height")).toBe("100vh");
    const corpo = regra(GLOBAL, "body:has(> .scl-previa)");
    expect([valor(corpo, "display"), valor(corpo, "flex-direction")]).toEqual(["flex", "column"]);
    const moldura = regra(GLOBAL, "body:has(> .scl-previa) > .scl-previa + *");
    expect([valor(moldura, "flex"), valor(moldura, "min-height")]).toEqual(["1 0 auto", "0"]);
    expect(moldura).not.toMatch(/calc|(^|[;\s])height\s*:/);
    // Na produção (sem a faixa), o corpo segue como era: nenhuma regra solta muda o display dele.
    expect(valor(regra(GLOBAL, "body"), "display")).toBeUndefined();
    expect(regras(GLOBAL).filter((r) => /(^|,\s*)body\s*(,|$)/.test(r.seletor) && /display/.test(r.corpo))).toEqual([]);
  });

  it("com a faixa no topo (layout raiz, na prévia), logo depois dela vem a moldura de 100vh e o Pular para o conteúdo continua o primeiro focável", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    try {
      // O documento inteiro, como no navegador: o que o React põe no <head> (ex.: o preload das fotos dos cartões da busca)
      // fica lá, e a conferência olha o <body>. No HTML do Next (16.3.6, conferido num build mínimo em 15/10), o corpo
      // começa por um <div hidden> dos metadados, antes da faixa e nunca entre ela e a moldura; os scripts vêm no fim.
      const comFaixa = (miolo: React.ReactNode) =>
        new DOMParser().parseFromString(renderToStaticMarkup(RootLayout({ children: miolo } as LayoutProps<"/">)), "text/html").body;
      // Cada página com a moldura que a regra do CSS espera logo depois da faixa (`.scl-previa + *` em globals.css).
      const paginas: [string, HTMLElement, string][] = [
        ["moldura do site", comFaixa(<Moldura conteudo={conteudo}>{<h1>Oi</h1>}</Moldura>), styles.pagina],
        ["moldura do site sem o banco", comFaixa(<MolduraBase>{<h1>Erro</h1>}</MolduraBase>), styles.pagina],
        ["moldura dos portais", comFaixa(<MolduraPortal empresa="Sua Casa Exemplo" titulo="Portal do proprietário">{<h1>Portal</h1>}</MolduraPortal>), stylesPortal.pagina],
        ["consulta", comFaixa(await Consulta(props({}, pedido) as never)), styles.pagina],
        // Sua busca (M7.9): a lista das casas e, com o site sem casas, o aviso; a página nova fica na mesma moldura.
        ["Sua busca", comFaixa(await Consulta(props({}, busca) as never)), styles.pagina],
      ];
      m.imoveis.mockResolvedValue([]);
      m.tem.mockResolvedValue(false);
      paginas.push(["Sua busca sem casas", comFaixa(await Consulta(props({}, busca) as never)), styles.pagina]);
      expect(paginas[4][1].querySelector("h2")?.textContent).toBe("1 casa na sua busca");
      expect(paginas[5][1].querySelector(`.${styles.semCasas}`)).not.toBeNull();
      for (const [tela, raiz, moldura] of paginas) {
        expect(raiz.firstElementChild?.textContent, tela).toBe(TEXTO_FAIXA_PREVIA);
        expect(raiz.firstElementChild?.querySelector(FOCAVEIS), tela).toBeNull();
        expect(raiz.firstElementChild?.nextElementSibling?.className, tela).toBe(moldura);
        const pular = primeiroFocavel(raiz);
        expect(pular?.textContent, tela).toBe(ROTULO_PULAR);
        expect(pular?.getAttribute("href"), tela).toBe(`#${ID_CONTEUDO}`);
      }
      // Painel (layout dele, com a sessão e o nome da empresa simulados): também a moldura de 100vh logo depois da faixa.
      // Ele não tem o Pular para o conteúdo (ficou fora do M7.11).
      m.sessao.mockResolvedValue({ usuarioId: "u-1", organizacaoId: "org-1", papel: "admin", imovelIds: [] });
      m.empresa.mockResolvedValue("Sua Casa Exemplo");
      const painel = comFaixa(await PainelLayout({ children: <h1>Início</h1> } as LayoutProps<"/painel">));
      expect(painel.firstElementChild?.textContent).toBe(TEXTO_FAIXA_PREVIA);
      expect(painel.firstElementChild?.querySelector(FOCAVEIS)).toBeNull();
      expect(painel.firstElementChild?.nextElementSibling?.className).toBe(stylesPainel.estrutura);
      expect(painel.querySelector("h1")?.textContent).toBe("Início");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
