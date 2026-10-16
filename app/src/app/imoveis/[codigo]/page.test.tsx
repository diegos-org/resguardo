// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TITULO_DA_SITUACAO } from "@/components/site/Disponibilidade";
import styles from "@/components/site/site.module.css";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import type { ConteudoSite, ImovelPublico } from "@/site/site";
import PaginaImovel from "./page";

/**
 * M7.21 — o link da casa (o que vai pelo WhatsApp: /imoveis/<código>?checkin=…&checkout=…&guests=…) explica o que não
 * serve: entrada antes de hoje, saída antes da entrada (ou no mesmo dia), grupo maior que a casa ou sem o número de
 * pessoas. O quadro da disponibilidade aparece em "Confira os dados", com o motivo, e os mesmos avisos aparecem nos campos
 * do cartão "Planeje sua estadia"; nada é consultado nem oferecido para segurar. Visita sem datas no link, nenhum aviso.
 * Banco e leituras simulados, como nos testes de acessibilidade.
 */
const m = vi.hoisted(() => ({ site: vi.fn(), imoveis: vi.fn(), imovel: vi.fn(), bairro: vi.fn(), disponibilidade: vi.fn(), portao: vi.fn(), pix: vi.fn() }));
vi.mock("@/site/pagina", () => ({ carregarSite: m.site, metadadosDoSite: vi.fn() }));
vi.mock("@/site/site", async (orig) => ({ ...(await orig<typeof import("@/site/site")>()), imoveisDoSite: m.imoveis, imovelDoSite: m.imovel }));
vi.mock("@/site/bairro", async (orig) => ({ ...(await orig<typeof import("@/site/bairro")>()), lugaresDoSite: m.bairro }));
vi.mock("@/site/disponibilidade", async (orig) => ({ ...(await orig<typeof import("@/site/disponibilidade")>()), consultarDisponibilidade: m.disponibilidade }));
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
  quartos: 0,
  banheiros: 1,
  descricao: "Frase fictícia do apartamento.",
  frase: "",
  camas: [],
  comodidades: [],
  regrasCasa: "",
  aceitaAnimais: false,
  permiteFumar: false,
  permiteFestas: false,
  checkinAPartirDe: "15:00",
  checkoutAte: "11:00",
  estadiaMinima: null,
  fotos: [],
};
const conteudo: ConteudoSite = { organizacaoId: "org", nomeEmpresa: "Sua Casa Exemplo", textos: TEXTOS_SITE_INICIAIS, whatsapp: "5521900000000", email: "", imagens: { capa: null, marca: "/marca.png" } };
const disponivel = { situacao: "disponivel", motivos: [], noites: 3, cotacao: { diarias: 135000, limpeza: 25000, hospedeExtra: 0, valorCheio: 160000, desconto: 0, total: 160000 }, leituraEm: null };

beforeEach(() => {
  vi.clearAllMocks();
  m.site.mockResolvedValue({ db: {}, conteudo });
  m.imoveis.mockResolvedValue([imovel]);
  m.imovel.mockResolvedValue(imovel);
  m.bairro.mockResolvedValue({ olho: "", titulo: "", subtitulo: "", lugares: [] });
  m.disponibilidade.mockResolvedValue(disponivel);
  m.portao.mockResolvedValue({ ok: false });
  m.pix.mockResolvedValue(false);
});

/** A página da casa aberta pelo link, com os nomes do contrato de links (checkin, checkout, guests). */
async function abrir(link: Record<string, string>) {
  const raiz = document.createElement("div");
  raiz.innerHTML = renderToStaticMarkup(await PaginaImovel({ params: Promise.resolve({ codigo: "403" }), searchParams: Promise.resolve(link) } as never));
  const quadro = raiz.querySelector<HTMLElement>('section[aria-label="Disponibilidade e valor"]');
  const cartao = raiz.querySelector<HTMLElement>("aside#planejar")!;
  return {
    raiz,
    quadro,
    titulo: quadro?.querySelector("h2")?.textContent,
    motivos: [...(quadro?.querySelectorAll("li") ?? [])].map((li) => li.textContent),
    /** Os avisos dos campos do cartão "Planeje sua estadia", pelo campo. */
    erros: Object.fromEntries([...cartao.querySelectorAll<HTMLElement>(`.${styles.erro}`)].map((e) => [e.id.replace("erro-", ""), e.textContent])),
    pessoas: cartao.querySelector<HTMLSelectElement>('select[name="hospedes"]')!,
    segurar: raiz.querySelector('section[aria-label="Segurar datas"]'),
  };
}

describe("link da casa com datas ou pessoas que não servem (M7.21)", () => {
  it("entrada antes de hoje: \"Confira os dados\" com o motivo, o mesmo aviso no campo da entrada, sem consultar nem segurar", async () => {
    const p = await abrir({ checkin: "2020-01-10", checkout: "2020-01-13", guests: "2" });
    expect(p.titulo).toBe(TITULO_DA_SITUACAO.invalida);
    expect(p.motivos).toEqual(["A entrada não pode ser antes de hoje."]);
    expect(p.erros).toEqual({ entrada: "A entrada não pode ser antes de hoje." });
    // O botão da entrada aponta para o aviso (o leitor de tela lê junto).
    expect(p.raiz.querySelector('#planejar button[aria-describedby="erro-entrada"]')).not.toBeNull();
    expect(m.disponibilidade).not.toHaveBeenCalled();
    expect(p.segurar).toBeNull();
    // O quadro de um pedido que não serve não promete nada: nem noites, nem valor, nem "nenhuma data fica reservada".
    expect(p.quadro?.querySelector("dl")).toBeNull();
    expect(p.quadro?.textContent).not.toContain("noites");
  });

  it("saída antes da entrada ou no mesmo dia: o motivo no quadro e no campo da saída", async () => {
    for (const checkout of ["2099-10-12", "2099-10-15"]) {
      const p = await abrir({ checkin: "2099-10-15", checkout, guests: "2" });
      expect(p.titulo, checkout).toBe(TITULO_DA_SITUACAO.invalida);
      expect(p.motivos, checkout).toEqual(["A saída precisa ser depois da entrada."]);
      expect(p.erros, checkout).toEqual({ saida: "A saída precisa ser depois da entrada." });
      expect(p.segurar, checkout).toBeNull();
    }
    expect(m.disponibilidade).not.toHaveBeenCalled();
  });

  it("grupo maior que a casa: \"recebe até N pessoas\", e o campo continua com o número pedido", async () => {
    const p = await abrir({ checkin: "2099-10-12", checkout: "2099-10-15", guests: "9" });
    expect(p.titulo).toBe(TITULO_DA_SITUACAO.invalida);
    expect(p.motivos).toEqual(["Este apartamento recebe até 4 pessoas."]);
    expect(p.erros).toEqual({ hospedes: "Este apartamento recebe até 4 pessoas." });
    expect(p.pessoas.value).toBe("9");
    expect(p.pessoas.getAttribute("aria-describedby")).toBe("erro-hospedes");
    expect([...p.pessoas.options].map((o) => o.textContent)).not.toContain("Escolha");
    // Grupo de três dígitos (fora da lista do campo, que só acrescenta números até 99): o mesmo aviso, e o campo fica em
    // "Escolha", sem um número que ninguém pediu.
    const cem = await abrir({ checkin: "2099-10-12", checkout: "2099-10-15", guests: "100" });
    expect(cem.erros).toEqual({ hospedes: "Este apartamento recebe até 4 pessoas." });
    expect(cem.pessoas.value).toBe("");
    expect(cem.pessoas.options[0].textContent).toBe("Escolha");
    expect(m.disponibilidade).not.toHaveBeenCalled();
    expect(p.segurar).toBeNull();
  });

  it("sem o número de pessoas (ou com 0, ou com texto): \"Informe quantas pessoas.\", e o campo fica em \"Escolha\", sem palpite", async () => {
    for (const link of [{ checkin: "2099-10-12", checkout: "2099-10-15" }, { checkin: "2099-10-12", checkout: "2099-10-15", guests: "0" }, { checkin: "2099-10-12", checkout: "2099-10-15", guests: "dois" }] as Record<string, string>[]) {
      const caso = JSON.stringify(link);
      const p = await abrir(link);
      expect(p.titulo, caso).toBe(TITULO_DA_SITUACAO.invalida);
      expect(p.motivos, caso).toEqual(["Informe quantas pessoas."]);
      expect(p.erros, caso).toEqual({ hospedes: "Informe quantas pessoas." });
      // O campo combina com o aviso (avisar em vez de supor): nada marcado, a primeira opção é "Escolha", que não se pode
      // escolher de volta; o campo é obrigatório, então o navegador só envia depois de uma escolha.
      expect(p.pessoas.value, caso).toBe("");
      expect(p.pessoas.required, caso).toBe(true);
      expect(p.pessoas.options[0].textContent, caso).toBe("Escolha");
      expect(p.pessoas.options[0].disabled, caso).toBe(true);
      expect([...p.pessoas.options].filter((o) => o.selected).map((o) => o.textContent), caso).toEqual(["Escolha"]);
      expect(p.pessoas.getAttribute("aria-describedby"), caso).toBe("erro-hospedes");
      expect(p.segurar, caso).toBeNull();
    }
    expect(m.disponibilidade).not.toHaveBeenCalled();
  });

  it("mais de um problema: todos os motivos, na ordem dos campos, cada um no seu campo", async () => {
    const p = await abrir({ checkin: "2020-01-10", checkout: "2020-01-13", guests: "0" });
    expect(p.motivos).toEqual(["A entrada não pode ser antes de hoje.", "Informe quantas pessoas."]);
    expect(p.erros).toEqual({ entrada: "A entrada não pode ser antes de hoje.", hospedes: "Informe quantas pessoas." });
    // Só uma das datas no link: a outra falta, como no envio da consulta.
    const soEntrada = await abrir({ checkin: "2099-10-12", guests: "2" });
    expect(soEntrada.motivos).toEqual(["Informe a data de saída."]);
    expect(soEntrada.erros).toEqual({ saida: "Informe a data de saída." });
    // Os nomes do site (entrada, saida, hospedes) valem igual.
    expect((await abrir({ entrada: "2099-10-15", saida: "2099-10-12", hospedes: "2" })).erros).toEqual({ saida: "A saída precisa ser depois da entrada." });
    expect(m.disponibilidade).not.toHaveBeenCalled();
  });

  it("visita sem datas no link: nenhum aviso, nenhum quadro, nada consultado (também só com o número de pessoas)", async () => {
    for (const link of [{}, { guests: "9" }, { guests: "2" }] as Record<string, string>[]) {
      const p = await abrir(link);
      expect(p.quadro, JSON.stringify(link)).toBeNull();
      expect(p.erros, JSON.stringify(link)).toEqual({});
      expect(p.raiz.textContent, JSON.stringify(link)).not.toContain(TITULO_DA_SITUACAO.invalida);
      // Sem aviso, nenhum "Escolha": o campo de pessoas tem o padrão de sempre.
      expect([...p.pessoas.options].map((o) => o.textContent), JSON.stringify(link)).not.toContain("Escolha");
    }
    expect((await abrir({})).pessoas.value).toBe("2");
    expect(m.disponibilidade).not.toHaveBeenCalled();
  });

  describe("\"hoje\" no fuso da casa (São Paulo), não no do servidor", () => {
    // 17/10/2026 às 2h30 em UTC ainda é 16/10 às 23h30 em São Paulo: a entrada de 16/10 ainda é hoje; a de 15/10, não.
    beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-17T02:30:00Z") }));
    afterEach(() => vi.useRealTimers());

    it("entrada no dia de hoje em São Paulo, já amanhã em UTC: sem aviso, a disponibilidade é consultada", async () => {
      const p = await abrir({ checkin: "2026-10-16", checkout: "2026-10-19", guests: "2" });
      expect(p.erros).toEqual({});
      expect(m.disponibilidade).toHaveBeenCalledWith({}, "org", { imovel: "403", entrada: "2026-10-16", saida: "2026-10-19", hospedes: "2" });
      expect(p.titulo).toBe(TITULO_DA_SITUACAO.disponivel);
    });

    it("entrada na véspera em São Paulo: \"A entrada não pode ser antes de hoje.\" no quadro e no campo", async () => {
      const p = await abrir({ checkin: "2026-10-15", checkout: "2026-10-19", guests: "2" });
      expect(p.titulo).toBe(TITULO_DA_SITUACAO.invalida);
      expect(p.motivos).toEqual(["A entrada não pode ser antes de hoje."]);
      expect(p.erros).toEqual({ entrada: "A entrada não pode ser antes de hoje." });
      expect(m.disponibilidade).not.toHaveBeenCalled();
    });
  });

  it("link que serve: a disponibilidade de verdade, sem aviso nos campos, e as datas para segurar", async () => {
    const p = await abrir({ checkin: "2099-10-12", checkout: "2099-10-15", guests: "2" });
    expect(m.disponibilidade).toHaveBeenCalledWith({}, "org", { imovel: "403", entrada: "2099-10-12", saida: "2099-10-15", hospedes: "2" });
    expect(p.titulo).toBe(TITULO_DA_SITUACAO.disponivel);
    expect(p.erros).toEqual({});
    expect(p.segurar).not.toBeNull();
  });
});
