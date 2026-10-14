import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CampoDatas } from "@/components/site/CampoDatas";
import Page, { generateMetadata } from "./page";
import { metadadosDoSite } from "@/site/pagina";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
const m = vi.hoisted(() => ({ site: vi.fn(), imoveis: vi.fn(), imovel: vi.fn(), disponibilidade: vi.fn() }));
vi.mock("@/site/pagina", () => ({ carregarSite: m.site, metadadosDoSite: vi.fn() }));
vi.mock("@/site/disponibilidade", () => ({ consultarDisponibilidade: m.disponibilidade, lerConfigDaConsulta: vi.fn(async () => ({ regras: "lidas uma vez", precos: {} })) }));
vi.mock("@/site/site", async (orig) => ({ ...(await orig<typeof import("@/site/site")>()), imoveisDoSite: m.imoveis, imovelDoSite: m.imovel }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
// Campo de datas real (M7.6), observado para conferir o "hoje" que o formulário recebe.
vi.mock("@/components/site/CampoDatas", async (orig) => ({ CampoDatas: vi.fn((await orig<typeof import("@/components/site/CampoDatas")>()).CampoDatas) }));
const hojeDoFormulario = () => vi.mocked(CampoDatas).mock.lastCall?.[0].hoje;
const imovel = { codigo: "403", fuso: "America/Sao_Paulo", nome: "Studio Exemplo", bairro: "Leblon", cidade: "Rio de Janeiro", capacidade: 4, quartos: 0, banheiros: 1, descricao: "", camas: [], comodidades: [], regrasCasa: "", aceitaAnimais: false, permiteFumar: false, permiteFestas: false, checkinAPartirDe: "15:00", checkoutAte: "11:00", estadiaMinima: null };
const conteudo = { organizacaoId: "org", nomeEmpresa: "Sua Casa Exemplo", textos: { ...TEXTOS_SITE_INICIAIS, titulo: "T", subtitulo: "", comoReservar: "", contato: "", rodape: "" }, whatsapp: "5521900000000", email: "", imagens: { capa: null, marca: "/marca.png" } };
beforeEach(() => {
  vi.clearAllMocks();
  m.site.mockResolvedValue({ db: {}, conteudo });
  m.imoveis.mockResolvedValue([imovel]);
  m.imovel.mockResolvedValue(imovel);
  m.disponibilidade.mockResolvedValue({ situacao: "disponivel", motivos: [], noites: 3, cotacao: { diarias: 135000, limpeza: 25000, hospedeExtra: 0, valorCheio: 160000, desconto: 6400, total: 153600 }, leituraEm: new Date("2026-10-01T09:15:00Z") });
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
  expect(h).toContain("agenda conferida em 01/10/2026, 06:15");
  expect(h).toContain("R$ 1.350,00");
  expect(h).toContain("R$ 1.600,00"); // valor cheio
  expect(h).toContain("R$ 64,00"); // desconto do site
  expect(h).toContain("R$ 1.536,00");
  expect(h).toContain("O site mostrou R$ 1.536,00 para 3 noites (já com o desconto do site de R$ 64,00).");
  expect(h).toContain("Enviar pelo WhatsApp");
  expect(h).toContain("wa.me/5521900000000?text=Ol%C3%A1!%20Gostaria");
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
  // O botão flutuante do WhatsApp (moldura) existe em toda página; o que não pode aparecer é o link da mensagem.
  expect(h).not.toContain("Enviar pelo WhatsApp");
  expect(h).not.toContain("Gostaria%20de%20consultar");
});
it("as datas são conferidas no fuso do imóvel escolhido, não no de São Paulo", async () => {
  // 00:30 de 12/10 em São Paulo, mas ainda 22:30 de 11/10 em Rio Branco: entrada em 11/10 vale para o imóvel de lá.
  vi.useFakeTimers({ now: new Date("2026-10-12T03:30:00Z"), toFake: ["Date"] });
  try {
    m.imovel.mockResolvedValue({ ...imovel, fuso: "America/Rio_Branco" });
    const h1 = await html({ imovel: "403", entrada: "2026-10-11", saida: "2026-10-13", hospedes: "2" });
    expect(m.disponibilidade).toHaveBeenCalledTimes(1);
    // A hora da leitura (09:15 UTC) aparece no fuso do imóvel: 04:15 em Rio Branco, 06:15 em São Paulo.
    expect(h1).toContain("agenda conferida em 01/10/2026, 04:15");
    m.disponibilidade.mockClear();
    m.imovel.mockResolvedValue(imovel);
    await html({ imovel: "403", entrada: "2026-10-11", saida: "2026-10-13", hospedes: "2" });
    expect(m.disponibilidade).not.toHaveBeenCalled();
    // Sem imóvel escolhido, o mínimo do formulário é o "hoje" mais cedo entre os imóveis da lista.
    m.imoveis.mockResolvedValue([imovel, { ...imovel, codigo: "901", fuso: "America/Rio_Branco" }]);
    await html();
    expect(hojeDoFormulario()).toBe("2026-10-11");
    m.imoveis.mockResolvedValue([imovel]);
    await html();
    expect(hojeDoFormulario()).toBe("2026-10-12");
  } finally {
    vi.useRealTimers();
  }
});
it("pedido inválido (pessoas acima da capacidade) nem chega à disponibilidade", async () => {
  const h = await html({ imovel: "403", entrada: "2099-10-12", saida: "2099-10-15", hospedes: "9" });
  expect(m.disponibilidade).not.toHaveBeenCalled();
  expect(h).toContain("Este apartamento recebe até 4 pessoas.");
});

describe("busca em todas as casas (M7.9)", () => {
  const casas = [imovel, { ...imovel, codigo: "102", nome: "Studio Pequeno", capacidade: 2 }, { ...imovel, codigo: "205", nome: "Casa Sem Capacidade", capacidade: null }];
  const disponivel = { situacao: "disponivel", motivos: [], noites: 3, cotacao: { diarias: 135000, limpeza: 25000, hospedeExtra: 0, valorCheio: 160000, desconto: 6400, total: 153600 }, leituraEm: new Date("2026-10-01T09:15:00Z") };
  const semCapacidade = {
    situacao: "a_confirmar",
    motivos: ["A capacidade deste apartamento ainda não foi cadastrada: confirmamos na conversa se o número de pessoas cabe.", "O valor dessas datas é confirmado na conversa."],
    noites: 3,
    cotacao: { diarias: null, limpeza: 25000, hospedeExtra: 0, valorCheio: null, desconto: 0, total: null },
    leituraEm: null,
  };
  beforeEach(() => {
    m.imoveis.mockResolvedValue(casas.map((c) => ({ ...c, fotos: [] })));
    m.disponibilidade.mockImplementation(async (_db: unknown, _org: string, p: { imovel: string }) => (p.imovel === "403" ? disponivel : semCapacidade));
  });

  it("sem casa escolhida: a situação real de cada casa que recebe o grupo, com o link para a página dela com as datas; nada para segurar aqui", async () => {
    // A capa manda a casa vazia ("Todas as casas"): a casa sem capacidade vem antes na ordem do site, mas a livre aparece primeiro.
    const h = await html({ imovel: "", entrada: "2099-10-12", saida: "2099-10-15", hospedes: "3" });
    expect(m.disponibilidade).toHaveBeenCalledTimes(2);
    expect(m.disponibilidade.mock.calls.map((c) => c[2].imovel).sort()).toEqual(["205", "403"]);
    for (const c of m.disponibilidade.mock.calls) expect(c[4]).toEqual({ config: { regras: "lidas uma vez", precos: {} } });
    expect(m.imovel).not.toHaveBeenCalled();
    expect(h).toContain("Sua busca");
    expect(h).toContain("Encontre seu lugar.");
    expect(h).toContain(TEXTOS_SITE_INICIAIS.buscaAviso);
    expect(h).toContain("2 casas para 3 pessoas");
    expect(h).toContain("12/10/2099 a 15/10/2099 · 3 noites · 1 casa recebe menos pessoas e não aparece aqui");
    const link403 = h.indexOf('href="/imoveis/403?checkin=2099-10-12&amp;checkout=2099-10-15&amp;guests=3"');
    const link205 = h.indexOf('href="/imoveis/205?checkin=2099-10-12&amp;checkout=2099-10-15&amp;guests=3"');
    expect(link403).toBeGreaterThan(-1);
    expect(link205).toBeGreaterThan(link403);
    expect(h).not.toContain("/imoveis/102?");
    // Valor cheio e desconto visíveis (M12.1); a casa sem capacidade nunca "disponível", com o aviso.
    const cartao403 = h.slice(link403, link205);
    expect(cartao403).toContain("Disponível");
    expect(cartao403).toContain("Valor cheio");
    expect(cartao403).toContain("R$ 1.600,00");
    expect(cartao403).toContain("− R$ 64,00");
    expect(cartao403).toContain("R$ 1.536,00");
    const cartao205 = h.slice(link205);
    expect(cartao205).toContain("Disponibilidade a confirmar");
    expect(cartao205).toContain("Capacidade não informada");
    expect(cartao205).toContain("A capacidade deste apartamento ainda não foi cadastrada");
    expect(cartao205).not.toContain(">Disponível<");
    expect(cartao205).toContain("a confirmar");
    // Segurar as datas e pagar exigem uma casa só: ficam na página dela.
    expect(h).not.toContain("Segurar");
    expect(h).not.toContain("Resumo da viagem");
    // Contato com as datas e as pessoas, sem casa nem valor.
    expect(h).toContain(`wa.me/5521900000000?text=${encodeURIComponent("Olá! Gostaria de consultar uma estadia numa das casas.\nEntrada: 12/10/2099 · Saída: 15/10/2099 · 3 pessoas.")}`);
    // O formulário volta com "Todas as casas" e o que foi pedido.
    expect(h).toContain('<option value="" selected="">Todas as casas</option>');
  });

  it("links com os nomes do contrato (checkin, checkout, guests) e sem casa também levam à busca; o título da aba diz \"Sua busca\"", async () => {
    const h = await html({ checkin: "2099-10-12", checkout: "2099-10-15", guests: "2" });
    expect(h).toContain("Encontre seu lugar.");
    expect(h).toContain("3 casas para 2 pessoas");
    await generateMetadata({ params: Promise.resolve({}), searchParams: Promise.resolve({ checkin: "2099-10-12" }) });
    expect(metadadosDoSite).toHaveBeenLastCalledWith("Sua busca");
    await generateMetadata({ params: Promise.resolve({}), searchParams: Promise.resolve({ imovel: "403", entrada: "2099-10-12" }) });
    expect(metadadosDoSite).toHaveBeenLastCalledWith("Consulta");
    await generateMetadata({ params: Promise.resolve({}), searchParams: Promise.resolve({}) });
    expect(metadadosDoSite).toHaveBeenLastCalledWith("Consulta");
  });

  it("nenhuma casa recebe o grupo: o aviso editável e o contato, sem consultar nada", async () => {
    m.imoveis.mockResolvedValue([imovel, { ...imovel, codigo: "102", capacidade: 2 }]);
    m.site.mockResolvedValue({ db: {}, conteudo: { ...conteudo, textos: { ...conteudo.textos, buscaSemCasa: "Aviso fictício: nenhuma casa para o grupo." } } });
    const h = await html({ entrada: "2099-10-12", saida: "2099-10-15", hospedes: "9" });
    expect(m.disponibilidade).not.toHaveBeenCalled();
    expect(h).toContain("Aviso fictício: nenhuma casa para o grupo.");
    expect(h).toContain("Falar pelo WhatsApp");
    expect(h).not.toContain("/imoveis/403?");
    // Sem nenhuma casa publicada, a página não diz que o grupo é grande demais.
    m.imoveis.mockResolvedValue([]);
    const vazio = await html({ entrada: "2099-10-12", saida: "2099-10-15", hospedes: "2" });
    expect(vazio).toContain("As casas ainda não estão no site. Fale com a gente.");
    expect(vazio).not.toContain("Aviso fictício");
  });

  it("datas inválidas: os erros no formulário da busca, sem consultar nenhuma casa", async () => {
    const h = await html({ entrada: "2020-01-01", saida: "2099-10-15", hospedes: "2" });
    expect(m.disponibilidade).not.toHaveBeenCalled();
    expect(h).toContain("A entrada não pode ser antes de hoje.");
    expect(h).toContain("Confira as datas e as pessoas acima para ver as casas.");
  });

  it("sem contato no cadastro: o aviso no lugar do botão", async () => {
    m.site.mockResolvedValue({ db: {}, conteudo: { ...conteudo, whatsapp: null, email: "" } });
    const h = await html({ entrada: "2099-10-12", saida: "2099-10-15", hospedes: "3" });
    expect(h).toContain("O contato ainda não foi configurado. Volte em breve.");
    expect(h).not.toContain("Falar pelo");
  });
});
