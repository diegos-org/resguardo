import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import Page from "./page";
const m = vi.hoisted(() => ({ site: vi.fn(), imoveis: vi.fn(), imovel: vi.fn(), disponibilidade: vi.fn() }));
vi.mock("@/site/pagina", () => ({ carregarSite: m.site, metadadosDoSite: vi.fn() }));
vi.mock("@/site/disponibilidade", () => ({ consultarDisponibilidade: m.disponibilidade }));
vi.mock("@/site/site", async (orig) => ({ ...(await orig<typeof import("@/site/site")>()), imoveisDoSite: m.imoveis, imovelDoSite: m.imovel }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
const imovel = { codigo: "403", fuso: "America/Sao_Paulo", nome: "Studio Exemplo", bairro: "Leblon", cidade: "Rio de Janeiro", capacidade: 4, quartos: 0, banheiros: 1, descricao: "", camas: [], comodidades: [], regrasCasa: "", aceitaAnimais: false, permiteFumar: false, permiteFestas: false, checkinAPartirDe: "15:00", checkoutAte: "11:00", estadiaMinima: null };
const conteudo = { organizacaoId: "org", nomeEmpresa: "Sua Casa Exemplo", textos: { titulo: "T", subtitulo: "", sobre: "", comoReservar: "", contato: "", rodape: "" }, whatsapp: "5521900000000", email: "" };
beforeEach(() => {
  vi.clearAllMocks();
  m.site.mockResolvedValue({ db: {}, conteudo });
  m.imoveis.mockResolvedValue([imovel]);
  m.imovel.mockResolvedValue(imovel);
  m.disponibilidade.mockResolvedValue({ situacao: "disponivel", motivos: [], noites: 3, cotacao: { diarias: 135000, limpeza: 25000, hospedeExtra: 0, total: 160000 }, leituraEm: new Date("2026-10-01T09:15:00Z") });
});
const html = async (params: Record<string, string> = {}) => renderToStaticMarkup(await Page({ params: Promise.resolve({}), searchParams: Promise.resolve(params) }));

it("sem pedido não consulta disponibilidade", async () => {
  const h = await html();
  expect(m.disponibilidade).not.toHaveBeenCalled();
  expect(h).toContain("Escolha o apartamento, as datas e quantas pessoas.");
});
it("pedido válido mostra disponibilidade, valor por partes e a mensagem com o valor de referência", async () => {
  const h = await html({ imovel: "403", entrada: "2099-10-12", saida: "2099-10-15", hospedes: "2" });
  expect(m.disponibilidade).toHaveBeenCalledWith({}, "org", { imovel: "403", entrada: "2099-10-12", saida: "2099-10-15", hospedes: "2" });
  expect(h).toContain("Disponível");
  expect(h).toContain("agenda conferida em");
  expect(h).toContain("R$ 1.350,00");
  expect(h).toContain("R$ 1.600,00");
  expect(h).toContain("O site mostrou R$ 1.600,00 para 3 noites.");
  expect(h).toContain("wa.me/5521900000000");
  expect(h).toContain("Nenhuma data fica reservada pela consulta.");
});
it("indisponível explica os motivos, não mostra valor nem o põe na mensagem", async () => {
  m.disponibilidade.mockResolvedValue({ situacao: "indisponivel", motivos: ["Essas datas já estão reservadas."], noites: 3, cotacao: null, leituraEm: null });
  const h = await html({ imovel: "403", entrada: "2099-10-12", saida: "2099-10-15", hospedes: "2" });
  expect(h).toContain("Indisponível nessas datas");
  expect(h).toContain("Essas datas já estão reservadas.");
  expect(h).not.toContain("Total");
  expect(h).not.toContain("O site mostrou");
});
it("disponibilidade inválida não oferece a mensagem, mesmo que a conferência básica tenha passado", async () => {
  m.disponibilidade.mockResolvedValue({ situacao: "invalida", motivos: ["Escolha um apartamento."], noites: 0, cotacao: null, leituraEm: null });
  const h = await html({ imovel: "403", entrada: "2099-10-12", saida: "2099-10-15", hospedes: "2" });
  expect(h).toContain("Confira os dados");
  expect(h).toContain("Escolha um apartamento.");
  expect(h).not.toContain("Sua mensagem");
  expect(h).not.toContain("wa.me");
});
it("as datas são conferidas no fuso do imóvel escolhido, não no de São Paulo", async () => {
  // 00:30 de 12/10 em São Paulo, mas ainda 22:30 de 11/10 em Rio Branco: entrada em 11/10 vale para o imóvel de lá.
  vi.useFakeTimers({ now: new Date("2026-10-12T03:30:00Z"), toFake: ["Date"] });
  try {
    m.imovel.mockResolvedValue({ ...imovel, fuso: "America/Rio_Branco" });
    await html({ imovel: "403", entrada: "2026-10-11", saida: "2026-10-13", hospedes: "2" });
    expect(m.disponibilidade).toHaveBeenCalledTimes(1);
    m.disponibilidade.mockClear();
    m.imovel.mockResolvedValue(imovel);
    await html({ imovel: "403", entrada: "2026-10-11", saida: "2026-10-13", hospedes: "2" });
    expect(m.disponibilidade).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
it("pedido inválido (pessoas acima da capacidade) nem chega à disponibilidade", async () => {
  const h = await html({ imovel: "403", entrada: "2099-10-12", saida: "2099-10-15", hospedes: "9" });
  expect(m.disponibilidade).not.toHaveBeenCalled();
  expect(h).toContain("Este apartamento recebe até 4 pessoas.");
});
