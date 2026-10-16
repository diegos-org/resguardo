import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CampoDatas } from "@/components/site/CampoDatas";
import Page, { generateMetadata } from "./page";
import { metadadosDoSite } from "@/site/pagina";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import { MOTIVO_SEM_CAPACIDADE } from "@/site/disponibilidade";
const m = vi.hoisted(() => ({ site: vi.fn(), imoveis: vi.fn(), imovel: vi.fn(), disponibilidade: vi.fn() }));
vi.mock("@/site/pagina", () => ({ carregarSite: m.site, metadadosDoSite: vi.fn() }));
vi.mock("@/site/disponibilidade", async (orig) => ({
  ...(await orig<typeof import("@/site/disponibilidade")>()),
  consultarDisponibilidade: m.disponibilidade,
  lerConfigDaConsulta: vi.fn(async () => ({ regras: "lidas uma vez", precos: {} })),
}));
vi.mock("@/site/site", async (orig) => ({ ...(await orig<typeof import("@/site/site")>()), imoveisDoSite: m.imoveis, imovelDoSite: m.imovel }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
// Campo de datas real (M7.6), observado para conferir o "hoje" que o formulário recebe.
vi.mock("@/components/site/CampoDatas", async (orig) => ({ CampoDatas: vi.fn((await orig<typeof import("@/components/site/CampoDatas")>()).CampoDatas) }));
const hojeDoFormulario = () => vi.mocked(CampoDatas).mock.lastCall?.[0].hoje;
const imovel = { codigo: "403", fuso: "America/Sao_Paulo", nome: "Studio Exemplo", bairro: "Leblon", cidade: "Rio de Janeiro", capacidade: 4, quartos: 0, banheiros: 1, descricao: "", frase: "", camas: [], comodidades: [], regrasCasa: "", aceitaAnimais: false, permiteFumar: false, permiteFestas: false, checkinAPartirDe: "15:00", checkoutAte: "11:00", estadiaMinima: null };
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
  expect(h).toContain("agenda conferida em 01/10/2026 às 06:15");
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
    expect(h1).toContain("agenda conferida em 01/10/2026 às 04:15");
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
it("link antigo para uma casa que saiu do site: o campo volta em \"Todas as casas\" e o erro não pede para escolher uma casa", async () => {
  m.imovel.mockResolvedValue(null);
  const h = await html({ imovel: "303", entrada: "2099-10-12", saida: "2099-10-15", hospedes: "2" });
  expect(m.disponibilidade).not.toHaveBeenCalled();
  expect(h).toContain("Essa casa não está mais no site. Escolha outra ou busque em todas as casas.");
  expect(h).not.toContain("Escolha um apartamento.");
  // A opção da casa 303 não existe: nenhuma opção marcada, e o navegador mostra a primeira ("Todas as casas").
  expect(h).not.toContain('value="303"');
  expect(h).toContain('<option value="">Todas as casas</option>');
});
it("link antigo de uma casa que saiu do site, sem datas (M7.9): o aviso aparece já na chegada; casa que está no site, nenhum aviso", async () => {
  const h = await html({ imovel: "303" });
  expect(h).toContain("Essa casa não está mais no site. Escolha outra ou busque em todas as casas.");
  expect(h).not.toContain('value="303"');
  expect(m.disponibilidade).not.toHaveBeenCalled();
  const daCasa = await html({ imovel: "403" });
  expect(daCasa).not.toContain("Essa casa não está mais no site.");
  expect(daCasa).not.toContain("Escolha um apartamento.");
});
it("pedido inválido (pessoas acima da capacidade) nem chega à disponibilidade", async () => {
  const h = await html({ imovel: "403", entrada: "2099-10-12", saida: "2099-10-15", hospedes: "9" });
  expect(m.disponibilidade).not.toHaveBeenCalled();
  expect(h).toContain("Este apartamento recebe até 4 pessoas.");
});
it("sem nenhuma casa publicada (M7.8): no lugar do formulário, que não teria casa para consultar, o aviso e o contato", async () => {
  m.imoveis.mockResolvedValue([]);
  const h = await html({ imovel: "403", entrada: "2099-10-12", saida: "2099-10-15", hospedes: "2" });
  expect(h).toContain(TEXTOS_SITE_INICIAIS.semCasasTexto);
  expect(h).toContain("Falar pelo WhatsApp");
  expect(h).toContain("A gente encontra sua casa."); // o título da consulta continua
  expect(h).not.toContain('name="imovel"');
  expect(h).not.toContain("Seu lugar");
  expect(h).not.toContain(TEXTOS_SITE_INICIAIS.consultaTexto);
  expect(h).not.toContain("Resumo da viagem");
  expect(m.disponibilidade).not.toHaveBeenCalled();
});
it("sem nenhuma casa publicada, o mesmo aviso em qualquer pedido (M7.8 com a busca do M7.9): o link de uma casa fora do site e a busca com datas erradas", async () => {
  m.imoveis.mockResolvedValue([]);
  // Casa fora do site com o site sem casas: o aviso do site sem casas, não o da casa que saiu (não há outra para escolher).
  const casaFora = await html({ imovel: "303" });
  expect(casaFora).toContain(TEXTOS_SITE_INICIAIS.semCasasTexto);
  expect(casaFora).not.toContain("Essa casa não está mais no site.");
  expect(casaFora).toContain("A gente encontra sua casa.");
  expect(casaFora).not.toContain('name="imovel"');
  // Busca com datas erradas: o mesmo aviso, com a mensagem padrão do site (não há datas conferidas para levar à conversa).
  const erradas = await html({ entrada: "2020-01-01", saida: "2099-10-15", hospedes: "2" });
  expect(erradas).toContain(TEXTOS_SITE_INICIAIS.semCasasTexto);
  expect(erradas).toContain("Encontre seu lugar.");
  expect(erradas).not.toContain("A entrada não pode ser antes de hoje.");
  expect(erradas).not.toContain('name="imovel"');
  expect(erradas).toContain(`wa.me/5521900000000?text=${encodeURIComponent("Olá! Vim pelo site e gostaria de falar com a equipe.")}`);
  // Pelo e-mail (sem WhatsApp no cadastro), as datas e as pessoas da busca vão no corpo da mensagem, com o assunto da
  // busca (o mesmo da busca com casas no site); com datas erradas, o mesmo assunto, sem corpo.
  m.site.mockResolvedValue({ db: {}, conteudo: { ...conteudo, whatsapp: null, email: " contato@exemplo.com " } });
  const porEmail = await html({ entrada: "2099-10-12", saida: "2099-10-15", hospedes: "2" });
  expect(porEmail).toContain(`href="mailto:contato@exemplo.com?subject=Consulta%20de%20disponibilidade&amp;body=${encodeURIComponent("Olá! Gostaria de consultar uma estadia numa das casas.\nEntrada: 12/10/2099 · Saída: 15/10/2099 · 2 pessoas.")}"`);
  expect(porEmail).toContain("Enviar um e-mail");
  expect(await html({ entrada: "2020-01-01", saida: "2099-10-15", hospedes: "2" })).toContain('href="mailto:contato@exemplo.com?subject=Consulta%20de%20disponibilidade"');
  // Fora da busca (a consulta e o link de uma casa fora do site), o contato padrão do aviso do site sem casas.
  expect(await html({ imovel: "303" })).toContain('href="mailto:contato@exemplo.com?subject=Contato%20pelo%20site"');
  expect(m.disponibilidade).not.toHaveBeenCalled();
});
it("envio da consulta por e-mail (sem WhatsApp no cadastro): a mensagem pronta no corpo, com o assunto da consulta", async () => {
  m.site.mockResolvedValue({ db: {}, conteudo: { ...conteudo, whatsapp: null, email: " contato@exemplo.com " } });
  const h = await html({ imovel: "403", entrada: "2099-10-12", saida: "2099-10-15", hospedes: "2" });
  const href = h.match(/href="(mailto:[^"]+)"[^>]*>Enviar por e-mail/)?.[1];
  expect(href).toMatch(/^mailto:contato@exemplo\.com\?subject=Consulta%20de%20disponibilidade&amp;body=Ol%C3%A1!%20Gostaria/);
  expect(h).not.toContain("Enviar pelo WhatsApp");
});

describe("busca em todas as casas (M7.9)", () => {
  // Na ordem do site, a casa sem capacidade (205) vem antes da livre (403): a página precisa reordenar.
  const casas = [{ ...imovel, codigo: "205", nome: "Casa Sem Capacidade", capacidade: null }, { ...imovel, codigo: "102", nome: "Studio Pequeno", capacidade: 2 }, imovel];
  const disponivel = { situacao: "disponivel", motivos: [], noites: 3, cotacao: { diarias: 135000, limpeza: 25000, hospedeExtra: 0, valorCheio: 160000, desconto: 6400, total: 153600 }, leituraEm: new Date("2026-10-01T09:15:00Z") };
  const semCapacidade = {
    situacao: "a_confirmar",
    motivos: [MOTIVO_SEM_CAPACIDADE, "O valor dessas datas é confirmado na conversa."],
    noites: 3,
    cotacao: { diarias: null, limpeza: 25000, hospedeExtra: 0, valorCheio: null, desconto: 0, total: null },
    leituraEm: null,
  };
  beforeEach(() => {
    m.imoveis.mockResolvedValue(casas.map((c) => ({ ...c, fotos: [] })));
    m.disponibilidade.mockImplementation(async (_db: unknown, _org: string, p: { imovel: string }) => (p.imovel === "403" ? disponivel : semCapacidade));
  });

  it("sem casa escolhida: a situação real de cada casa que recebe o grupo, com o link para a página dela com as datas; nada para segurar aqui", async () => {
    // A capa manda a casa vazia ("Todas as casas"): a casa sem capacidade vem antes na ordem do site (205, 102, 403), mas a livre aparece primeiro.
    const h = await html({ imovel: "", entrada: "2099-10-12", saida: "2099-10-15", hospedes: "3" });
    expect(m.disponibilidade).toHaveBeenCalledTimes(2);
    expect(m.disponibilidade.mock.calls.map((c) => c[2].imovel).sort()).toEqual(["205", "403"]);
    for (const c of m.disponibilidade.mock.calls) expect(c[4]).toEqual({ config: { regras: "lidas uma vez", precos: {} } });
    expect(m.imovel).not.toHaveBeenCalled();
    expect(h).toContain("Sua busca");
    expect(h).toContain("Encontre seu lugar.");
    expect(h).toContain(TEXTOS_SITE_INICIAIS.buscaAviso);
    expect(h).toContain("2 casas na sua busca");
    expect(h).toContain("12/10/2099 a 15/10/2099 · 3 noites · 3 pessoas · 1 casa recebe menos pessoas e não aparece aqui");
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
    // Um aviso só sobre a capacidade: a linha do cartão no lugar do motivo da consulta que diz o mesmo.
    expect(cartao205).toContain("Capacidade não informada: a equipe confirma na conversa se o grupo cabe.");
    expect(cartao205).not.toContain("A capacidade deste apartamento ainda não foi cadastrada");
    expect(cartao205).toContain("O valor dessas datas é confirmado na conversa.");
    expect(cartao205).not.toContain(">Disponível<");
    expect(cartao205).toContain("a confirmar");
    // Segurar as datas e pagar exigem uma casa só: ficam na página dela.
    expect(h).not.toContain("Segurar");
    expect(h).not.toContain("Resumo da viagem");
    // Contato com a frase editável e as datas e as pessoas, sem casa nem valor.
    expect(h).toContain(TEXTOS_SITE_INICIAIS.buscaContato);
    expect(h).toContain(`wa.me/5521900000000?text=${encodeURIComponent("Olá! Gostaria de consultar uma estadia numa das casas.\nEntrada: 12/10/2099 · Saída: 15/10/2099 · 3 pessoas.")}`);
    // O formulário volta com "Todas as casas" e o que foi pedido.
    expect(h).toContain('<option value="" selected="">Todas as casas</option>');
  });

  it("links com os nomes do contrato (checkin, checkout, guests) e sem casa também levam à busca; o título da aba diz \"Sua busca\"", async () => {
    const h = await html({ checkin: "2099-10-12", checkout: "2099-10-15", guests: "2" });
    expect(h).toContain("Encontre seu lugar.");
    expect(h).toContain("3 casas na sua busca");
    // Prévia do link (M7.13): a frase que cada página mostra — na busca, o aviso acima das casas; na consulta, a frase
    // abaixo do título — e, só na consulta, o endereço principal sem as datas, as pessoas e a casa do link (a busca não
    // indica nenhum: com o da consulta, o Facebook trocaria a prévia dela pela da consulta).
    const caminho = "/consulta";
    await generateMetadata({ params: Promise.resolve({}), searchParams: Promise.resolve({ checkin: "2099-10-12" }) });
    expect(metadadosDoSite).toHaveBeenLastCalledWith("Sua busca", { descricao: TEXTOS_SITE_INICIAIS.buscaAviso, caminho: undefined });
    await generateMetadata({ params: Promise.resolve({}), searchParams: Promise.resolve({ imovel: "403", entrada: "2099-10-12" }) });
    expect(metadadosDoSite).toHaveBeenLastCalledWith("Consulta", { descricao: TEXTOS_SITE_INICIAIS.consultaTexto, caminho });
    await generateMetadata({ params: Promise.resolve({}), searchParams: Promise.resolve({}) });
    expect(metadadosDoSite).toHaveBeenLastCalledWith("Consulta", { descricao: TEXTOS_SITE_INICIAIS.consultaTexto, caminho });
    // Sem nenhuma casa no site (M7.8), as duas mostram o aviso do site sem casas no lugar da frase: a prévia diz o mesmo.
    m.imoveis.mockResolvedValue([]);
    await generateMetadata({ params: Promise.resolve({}), searchParams: Promise.resolve({ checkin: "2099-10-12" }) });
    expect(metadadosDoSite).toHaveBeenLastCalledWith("Sua busca", { descricao: TEXTOS_SITE_INICIAIS.semCasasTexto, caminho: undefined });
    await generateMetadata({ params: Promise.resolve({}), searchParams: Promise.resolve({}) });
    expect(metadadosDoSite).toHaveBeenLastCalledWith("Consulta", { descricao: TEXTOS_SITE_INICIAIS.semCasasTexto, caminho });
    expect(m.imoveis).toHaveBeenCalledWith({}, "org");
  });

  it("nenhuma casa recebe o grupo: o aviso editável e o contato, sem consultar nada", async () => {
    m.imoveis.mockResolvedValue([imovel, { ...imovel, codigo: "102", capacidade: 2 }]);
    m.site.mockResolvedValue({ db: {}, conteudo: { ...conteudo, textos: { ...conteudo.textos, buscaSemCasa: "Aviso fictício: nenhuma casa para o grupo." } } });
    const h = await html({ entrada: "2099-10-12", saida: "2099-10-15", hospedes: "9" });
    expect(m.disponibilidade).not.toHaveBeenCalled();
    expect(h).toContain("Aviso fictício: nenhuma casa para o grupo.");
    expect(h).toContain("Falar pelo WhatsApp");
    expect(h).not.toContain("/imoveis/403?");
    // Sem nenhuma casa publicada, a página não diz que o grupo é grande demais: o aviso do site sem casas (M7.8), a regra
    // única desse caso, com o cabeçalho da busca, sem o formulário e com as datas e as pessoas na mensagem do contato.
    m.imoveis.mockResolvedValue([]);
    m.site.mockResolvedValue({ db: {}, conteudo: { ...conteudo, textos: { ...conteudo.textos, buscaSemCasa: "Aviso fictício: nenhuma casa para o grupo." } } });
    const vazio = await html({ entrada: "2099-10-12", saida: "2099-10-15", hospedes: "2" });
    expect(vazio).toContain(TEXTOS_SITE_INICIAIS.semCasasTexto);
    expect(vazio).not.toContain("Aviso fictício");
    expect(vazio).toContain("Encontre seu lugar.");
    expect(vazio).not.toContain('name="imovel"');
    expect(vazio).not.toContain("na sua busca");
    expect(vazio).toContain(`wa.me/5521900000000?text=${encodeURIComponent("Olá! Gostaria de consultar uma estadia numa das casas.\nEntrada: 12/10/2099 · Saída: 15/10/2099 · 2 pessoas.")}`);
    expect(m.disponibilidade).not.toHaveBeenCalled();
    m.site.mockResolvedValue({ db: {}, conteudo: { ...conteudo, textos: { ...conteudo.textos, semCasasTexto: "Frase fictícia: o site ainda não tem casas." } } });
    expect(await html({ entrada: "2099-10-12", saida: "2099-10-15", hospedes: "2" })).toContain("Frase fictícia: o site ainda não tem casas.");
  });

  it("datas inválidas: os erros no formulário da busca, sem consultar nenhuma casa", async () => {
    const h = await html({ entrada: "2020-01-01", saida: "2099-10-15", hospedes: "2" });
    expect(m.disponibilidade).not.toHaveBeenCalled();
    expect(h).toContain("A entrada não pode ser antes de hoje.");
    expect(h).toContain("Confira as datas e as pessoas acima para ver as casas.");
  });

  it("mais casas que o limite: as além dele, sem consulta, com a etiqueta neutra e sem valor; a sem capacidade avisa também ali", async () => {
    // 12 casas na ordem do site; as 2 últimas passam do limite de 10 consultas, e a última não tem capacidade cadastrada.
    const muitas = Array.from({ length: 12 }, (_, i) => ({ ...imovel, codigo: `C${i + 1}`, nome: `Casa ${i + 1}`, capacidade: i === 11 ? null : 4, fotos: [] }));
    m.imoveis.mockResolvedValue(muitas);
    m.disponibilidade.mockImplementation(async (_db: unknown, _org: string, p: { imovel: string }) =>
      p.imovel === "C1" ? { situacao: "invalida", motivos: ["Motivo fictício: confira as datas desta casa."], noites: 0, cotacao: null, leituraEm: null } : disponivel,
    );
    const h = await html({ entrada: "2099-10-12", saida: "2099-10-15", hospedes: "3" });
    expect(m.disponibilidade).toHaveBeenCalledTimes(10);
    expect(m.disponibilidade.mock.calls.map((c) => c[2].imovel)).not.toContain("C11");
    expect(h).toContain("12 casas na sua busca");
    const cartao = (codigo: string) => {
      const ini = h.indexOf(`href="/imoveis/${codigo}?`);
      expect(ini).toBeGreaterThan(-1);
      const fim = h.indexOf("</a>", ini);
      return h.slice(ini, fim);
    };
    // Dados a conferir: a etiqueta "Confira os dados" e o motivo, sem valor nem "Disponível".
    const c1 = cartao("C1");
    expect(c1).toContain("Confira os dados");
    expect(c1).toContain("Motivo fictício: confira as datas desta casa.");
    expect(c1).not.toContain("Total");
    expect(c1).not.toContain("R$");
    expect(c1).not.toContain(">Disponível<");
    // Além do limite: a etiqueta neutra (não a de indisponível), sem valor nem situação.
    for (const codigo of ["C11", "C12"]) {
      const c = cartao(codigo);
      expect(c).toContain("Veja as datas na página da casa");
      expect(c).toMatch(/class="[^"]*etiquetaNaoConsultada/);
      expect(c).not.toMatch(/etiquetaIndisponivel/);
      expect(c).not.toContain("R$");
      expect(c).not.toContain(">Disponível<");
      expect(c).not.toContain("Indisponível");
    }
    expect(cartao("C12")).toContain("Capacidade não informada");
    expect(cartao("C11")).not.toContain("Capacidade não informada");
    // Ordem: as livres, depois a de dados a conferir e, por fim, as não consultadas.
    expect(h.indexOf('href="/imoveis/C2?')).toBeLessThan(h.indexOf('href="/imoveis/C1?'));
    expect(h.indexOf('href="/imoveis/C1?')).toBeLessThan(h.indexOf('href="/imoveis/C11?'));
  });

  it("frase do contato editável: vazia, só o botão", async () => {
    m.site.mockResolvedValue({ db: {}, conteudo: { ...conteudo, textos: { ...conteudo.textos, buscaContato: "" } } });
    const h = await html({ entrada: "2099-10-12", saida: "2099-10-15", hospedes: "3" });
    expect(h).not.toContain(TEXTOS_SITE_INICIAIS.buscaContato);
    expect(h).toContain("Falar pelo WhatsApp");
  });

  it("contato por e-mail (sem WhatsApp no cadastro): o mesmo link e o mesmo rótulo com casas no site e no site sem casas", async () => {
    m.site.mockResolvedValue({ db: {}, conteudo: { ...conteudo, whatsapp: null, email: " contato@exemplo.com " } });
    const mailto = `href="mailto:contato@exemplo.com?subject=Consulta%20de%20disponibilidade&amp;body=${encodeURIComponent("Olá! Gostaria de consultar uma estadia numa das casas.\nEntrada: 12/10/2099 · Saída: 15/10/2099 · 3 pessoas.")}"`;
    // O botão: o link da busca e, logo nele, o rótulo do contato do site.
    const botao = (h: string) => h.slice(h.indexOf(mailto), h.indexOf("</a>", h.indexOf(mailto)));
    // Com a lista: o botão depois dela.
    const comLista = await html({ entrada: "2099-10-12", saida: "2099-10-15", hospedes: "3" });
    expect(comLista).toContain("2 casas na sua busca");
    expect(botao(comLista)).toMatch(/>Enviar um e-mail<span/);
    // Nenhuma casa recebe o grupo.
    m.imoveis.mockResolvedValue([{ ...imovel, codigo: "102", capacidade: 2, fotos: [] }]);
    const semCasaParaOGrupo = await html({ entrada: "2099-10-12", saida: "2099-10-15", hospedes: "3" });
    expect(semCasaParaOGrupo).toContain(TEXTOS_SITE_INICIAIS.buscaSemCasa);
    expect(botao(semCasaParaOGrupo)).toMatch(/>Enviar um e-mail<span/);
    // Site sem nenhuma casa: o aviso do M7.8, com o mesmo contato.
    m.imoveis.mockResolvedValue([]);
    const semCasasNoSite = await html({ entrada: "2099-10-12", saida: "2099-10-15", hospedes: "3" });
    expect(semCasasNoSite).toContain(TEXTOS_SITE_INICIAIS.semCasasTexto);
    expect(botao(semCasasNoSite)).toMatch(/>Enviar um e-mail<span/);
    for (const h of [comLista, semCasaParaOGrupo, semCasasNoSite]) {
      expect(h).toContain(mailto);
      expect(h).not.toContain("Falar por e-mail");
      expect(h).not.toContain("Contato%20pelo%20site");
    }
  });

  it("sem contato no cadastro: o aviso no lugar do botão", async () => {
    m.site.mockResolvedValue({ db: {}, conteudo: { ...conteudo, whatsapp: null, email: "" } });
    const h = await html({ entrada: "2099-10-12", saida: "2099-10-15", hospedes: "3" });
    expect(h).toContain("O contato ainda não foi configurado. Volte em breve.");
    expect(h).not.toContain("Falar pelo");
  });
});
