import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Cotacao } from "@/components/site/Cotacao";
import styles from "@/components/site/site.module.css";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import type { CotacaoVista } from "@/site/cotacoes";
import { regrasDaCasa } from "@/site/regras-da-casa";
import type { ConteudoSite, ImovelPublico } from "@/site/site";
import PaginaImovel from "../imoveis/[codigo]/page";

/**
 * M7.20 — horários e regras da casa num lugar só: a página da casa passa a ler as regras de convivência e os horários da
 * mesma função que a página da cotação, e continua igual (as mesmas fichas, na mesma ordem, com a estadia mínima entre os
 * horários e as regras, e o texto livre). Banco e leituras simulados, como nos testes de acessibilidade.
 */
const m = vi.hoisted(() => ({ site: vi.fn(), imoveis: vi.fn(), imovel: vi.fn(), bairro: vi.fn(), portao: vi.fn(), pix: vi.fn() }));
vi.mock("@/site/pagina", () => ({ carregarSite: m.site, metadadosDoSite: vi.fn() }));
vi.mock("@/site/site", async (orig) => ({ ...(await orig<typeof import("@/site/site")>()), imoveisDoSite: m.imoveis, imovelDoSite: m.imovel }));
vi.mock("@/site/bairro", async (orig) => ({ ...(await orig<typeof import("@/site/bairro")>()), lugaresDoSite: m.bairro }));
vi.mock("@/site/pagamento", () => ({ portaoDoSite: m.portao, pixPossivel: m.pix }));
vi.mock("@/db/client", async (orig) => ({ ...(await orig<typeof import("@/db/client")>()), getDb: vi.fn(() => ({})) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NAO_ENCONTRADA");
  },
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...resto }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
}));

const imovel: ImovelPublico = {
  codigo: "403",
  fuso: "America/Sao_Paulo",
  nome: "Studio Exemplo",
  bairro: "Leblon",
  cidade: "Rio de Janeiro",
  capacidade: 4,
  quartos: 1,
  banheiros: 1,
  descricao: "Frase fictícia do apartamento.",
  frase: "",
  camas: [],
  comodidades: [],
  regrasCasa: "Silêncio depois das 22h.",
  aceitaAnimais: false,
  permiteFumar: false,
  permiteFestas: false,
  checkinAPartirDe: "15:00",
  checkoutAte: "11:00",
  estadiaMinima: 3,
  fotos: [],
};
const conteudo: ConteudoSite = { organizacaoId: "org", nomeEmpresa: "Sua Casa Exemplo", textos: TEXTOS_SITE_INICIAIS, whatsapp: "5521900000000", email: "", imagens: { capa: null, marca: "/marca.png" } };

beforeEach(() => {
  vi.clearAllMocks();
  m.site.mockResolvedValue({ db: {}, conteudo });
  m.imoveis.mockResolvedValue([imovel]);
  m.imovel.mockResolvedValue(imovel);
  m.bairro.mockResolvedValue({ olho: "", titulo: "", subtitulo: "", lugares: [] });
  m.portao.mockResolvedValue({ ok: false });
  m.pix.mockResolvedValue(false);
});

const paginaDaCasa = async (i: ImovelPublico) => {
  m.imovel.mockResolvedValue(i);
  m.imoveis.mockResolvedValue([i]);
  return renderToStaticMarkup(await PaginaImovel({ params: Promise.resolve({ codigo: "403" }), searchParams: Promise.resolve({}) } as never));
};
const parteDasRegras = (html: string) => html.match(/<section aria-labelledby="titulo-regras">[\s\S]*?<\/section>/)?.[0] ?? "";
/** A parte "Regras da casa" exatamente como a página da casa escrevia antes do M7.20. */
const comoAntes = (fichas: string[], texto: string) =>
  `<section aria-labelledby="titulo-regras"><h2 id="titulo-regras" class="${styles.tituloFicha}">Regras da casa</h2><ul class="${styles.fichas}">${fichas.map((f) => `<li>${f}</li>`).join("")}</ul>${texto ? `<p class="${styles.texto}" style="margin-top:12px">${texto}</p>` : ""}</section>`;

describe("regras da casa num lugar só (M7.20)", () => {
  it("a página da casa continua igual: horários, estadia mínima, animais, fumo e festas, na mesma ordem, e o texto livre", async () => {
    expect(parteDasRegras(await paginaDaCasa(imovel))).toBe(
      comoAntes(
        ["Entrada a partir das 15:00", "Saída até as 11:00", "Em geral, mínimo de 3 noites (datas especiais podem ter outro mínimo)", "Não aceita animais", "Proibido fumar", "Sem festas ou eventos"],
        "Silêncio depois das 22h.",
      ),
    );
    // Outra ficha: horários próprios, uma noite de mínimo, tudo liberado e sem texto livre.
    const liberada = { ...imovel, checkinAPartirDe: "14:30", checkoutAte: "10:00", estadiaMinima: 1, aceitaAnimais: true, permiteFumar: true, permiteFestas: true, regrasCasa: "" };
    expect(parteDasRegras(await paginaDaCasa(liberada))).toBe(
      comoAntes(["Entrada a partir das 14:30", "Saída até as 10:00", "Em geral, mínimo de 1 noite (datas especiais podem ter outro mínimo)", "Aceita animais"], ""),
    );
    // Sem estadia mínima: os horários e logo as regras de convivência.
    expect(parteDasRegras(await paginaDaCasa({ ...imovel, estadiaMinima: null, permiteFumar: true }))).toBe(
      comoAntes(["Entrada a partir das 15:00", "Saída até as 11:00", "Não aceita animais", "Sem festas ou eventos"], "Silêncio depois das 22h."),
    );
  });

  it("a página da cotação mostra as mesmas regras de convivência e o mesmo texto livre da página da casa", async () => {
    const casa = parteDasRegras(await paginaDaCasa(imovel));
    const vista: CotacaoVista = {
      cotacao: {
        id: "c1", organizacaoId: "org", imovelId: "i1", codigo: "COT-ABCDEFGH", estado: "aberta", checkin: "2026-10-12", checkout: "2026-10-15", hospedes: 4, noites: 3, situacao: "disponivel",
        diarias: 135000, limpeza: 25000, hospedeExtra: 30000, valorCheio: 190000, desconto: 7600, total: 182400, leituraEm: null, reservaId: null, holdAte: null, criadaEm: new Date(), atualizadaEm: new Date(),
        imovelCodigo: "403", imovelNome: "Studio Exemplo", fuso: "America/Sao_Paulo",
      },
      estado: "aberta",
      atual: null,
      mudou: false,
      reserva: null,
    };
    const cotacao = parteDasRegras(renderToStaticMarkup(<Cotacao vista={vista} whatsapp={null} email="" regras={regrasDaCasa(imovel)} />));
    const fichas = (html: string) => [...html.matchAll(/<li>([^<]*)<\/li>/g)].map((x) => x[1]);
    expect(fichas(cotacao)).toEqual(["Não aceita animais", "Proibido fumar", "Sem festas ou eventos"]);
    expect(fichas(casa).slice(-3)).toEqual(fichas(cotacao));
    expect(cotacao).toContain(">Regras da casa</h3>");
    expect(cotacao).toContain(`<p class="${styles.texto}" style="margin-top:12px">Silêncio depois das 22h.</p>`);
  });
});
