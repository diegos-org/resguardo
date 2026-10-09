import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import type { CotacaoVista } from "@/site/cotacoes";
import type { PagamentoDoHospede } from "@/site/pagamento-vista";
import Page from "./page";

const m = vi.hoisted(() => ({
  site: vi.fn(),
  verCotacao: vi.fn(),
  portao: vi.fn(),
  vistaPagamento: vi.fn(),
  pixPossivel: vi.fn(),
  autorizado: vi.fn(),
  gerarPix: vi.fn(),
}));
vi.mock("@/site/pagina", () => ({ carregarSite: m.site, metadadosDoSite: vi.fn() }));
vi.mock("@/site/cotacoes", async (orig) => ({ ...(await orig<typeof import("@/site/cotacoes")>()), verCotacao: m.verCotacao }));
vi.mock("@/calendario/regras-config", () => ({ lerRegrasCalendario: async () => ({ site: { minutosHold: 30 } }) }));
vi.mock("@/site/pagamento", () => ({ portaoDoSite: m.portao, vistaDoPagamento: m.vistaPagamento, pixPossivel: m.pixPossivel }));
vi.mock("@/site/checkout", () => ({ autorizadoNaCotacao: m.autorizado }));
vi.mock("@/site/acoes", () => ({ segurarDatasAcao: vi.fn() }));
vi.mock("@/site/acoes-pagamento", () => ({ gerarPixAcao: m.gerarPix, continuarPagamentoAcao: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NAO_ENCONTRADA");
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const conteudo = { organizacaoId: "org", nomeEmpresa: "Sua Casa Exemplo", textos: { ...TEXTOS_SITE_INICIAIS }, whatsapp: "5521900000000", email: "", imagens: { capa: null, marca: "/marca.png" } };
const holdAte = new Date("2026-10-01T15:30:00Z");
const cotacao: CotacaoVista["cotacao"] = {
  id: "11111111-1111-4111-8111-111111111111", organizacaoId: "org", imovelId: "22222222-2222-4222-8222-222222222222", codigo: "COT-ABCDEFGH", estado: "segurada", checkin: "2026-10-12", checkout: "2026-10-15", hospedes: 4, noites: 3, situacao: "disponivel",
  diarias: 135000, limpeza: 25000, hospedeExtra: 30000, valorCheio: 190000, desconto: 7600, total: 182400, leituraEm: null, reservaId: "33333333-3333-4333-8333-333333333333", holdAte, criadaEm: new Date(), atualizadaEm: new Date(),
  imovelCodigo: "403", imovelNome: "Studio Exemplo", fuso: "America/Sao_Paulo",
};
const vistaCotacao = (estado: CotacaoVista["estado"], over: Partial<CotacaoVista> = {}): CotacaoVista => ({ cotacao: { ...cotacao, estado }, estado, atual: null, mudou: false, reserva: { codigo: "SCL-TESTE1", estado: "pedido" }, ...over });
const pagamento = (over: Partial<PagamentoDoHospede>): PagamentoDoHospede => ({
  estado: "sem_pagamento", ambienteTeste: true, dinheiroSemDesfecho: false, holdAte: holdAte.toISOString(), pix: null, pixRestantes: 3, reservaCodigo: null, pagamentoEmDobro: false, devolucao: null, ...over,
});
const GATE_OK = { ok: true, ambiente: "teste", provedor: {} };
const GATE_NAO = { ok: false, motivo: "desligado", texto: "desligado" };

beforeEach(() => {
  vi.clearAllMocks();
  m.site.mockResolvedValue({ db: {}, conteudo });
  m.portao.mockResolvedValue(GATE_NAO);
  m.pixPossivel.mockResolvedValue(false);
  m.autorizado.mockResolvedValue(true);
  m.verCotacao.mockResolvedValue(vistaCotacao("segurada"));
  m.vistaPagamento.mockResolvedValue(pagamento({}));
  m.gerarPix.mockResolvedValue({});
});
const html = async (codigo = "COT-ABCDEFGH") => renderToStaticMarkup(await Page({ params: Promise.resolve({ codigo }) } as PageProps<"/reservar/[codigo]">));

describe("página da cotação com o pagamento no site (M8.2a)", () => {
  it("código inválido: não encontrada, sem ler nada", async () => {
    await expect(html("COT-0000")).rejects.toThrow("NAO_ENCONTRADA");
    expect(m.verCotacao).not.toHaveBeenCalled();
  });

  it("sem o Pix oferecido: o fluxo de hoje (prazo, WhatsApp, 'nenhum pagamento é feito no site') e sem faixa de teste", async () => {
    const h = await html();
    expect(h).toContain("Datas seguradas");
    expect(h).toContain("Fale com a equipe para confirmar a reserva");
    expect(h).toContain("Nenhum pagamento é feito no site por enquanto.");
    expect(h).not.toContain("Ambiente de teste");
    expect(h).not.toContain("Pague com Pix");
  });

  it("cotação aberta: o texto do pagamento depende de o Pix ser oferecido para a estadia", async () => {
    m.verCotacao.mockResolvedValue(vistaCotacao("aberta", { reserva: null }));
    let h = await html();
    expect(h).toContain("Nenhum pagamento é feito aqui.");
    expect(h).toContain("Nenhum pagamento é feito no site por enquanto.");
    m.portao.mockResolvedValue(GATE_OK);
    m.pixPossivel.mockResolvedValue(true);
    h = await html();
    expect(m.pixPossivel).toHaveBeenLastCalledWith({}, "org", { imovel: { id: cotacao.imovelId }, checkin: "2026-10-12", checkout: "2026-10-15", situacao: "disponivel", total: 182400 }, GATE_OK);
    expect(h).toContain("Ambiente de teste: nenhuma cobrança real.");
    expect(h).toContain("Nada é cobrado ao segurar: o Pix aparece logo depois");
    expect(h).toContain("Nada é cobrado ao segurar as datas: o pagamento é por Pix");
    expect(h).toContain("para pagar por Pix aqui mesmo");
    expect(h).not.toContain("Nenhum pagamento é feito");
  });

  it("datas seguradas com o Pix oferecido: Pix em destaque e primeiro (antes do resumo), Gerar Pix, WhatsApp como opção, faixa de teste", async () => {
    m.portao.mockResolvedValue(GATE_OK);
    m.vistaPagamento.mockResolvedValue(pagamento({ estado: "pagar" }));
    const h = await html();
    expect(m.vistaPagamento).toHaveBeenCalledWith({}, "org", cotacao.id, expect.any(Date), expect.objectContaining({ comAutorizacao: true }));
    expect(h).toContain("Ambiente de teste: nenhuma cobrança real.");
    expect(h).toContain("Pague com Pix");
    expect(h).toContain(TEXTOS_SITE_INICIAIS.pagamentoConvite);
    expect(h.indexOf("Pague com Pix")).toBeLessThan(h.indexOf("Diárias"));
    expect(h).toContain("Gerar Pix");
    expect(h).toContain("Prefere combinar com a equipe?");
    expect(h).toContain("wa.me/5521900000000");
    expect(h).not.toContain("Nenhum pagamento é feito");
  });

  it("sem o cookie do pedido: a vista é pedida sem autorização e a página oferece 'Continuar o pagamento'", async () => {
    m.autorizado.mockResolvedValue(false);
    m.vistaPagamento.mockResolvedValue(pagamento({ estado: "pix_aguardando", dinheiroSemDesfecho: true }));
    const h = await html();
    expect(m.autorizado).toHaveBeenCalledWith(cotacao.id, expect.any(Date));
    expect(m.vistaPagamento).toHaveBeenCalledWith({}, "org", cotacao.id, expect.any(Date), expect.objectContaining({ comAutorizacao: false }));
    expect(h).toContain("Há um Pix desta cotação aguardando pagamento");
    expect(h).toContain("Continuar o pagamento");
    expect(h).not.toContain("Pix copia e cola");
  });

  it("Pix aguardando com o cookie: copia e cola, QR e 'pode fechar e voltar'; textos editáveis do painel", async () => {
    m.site.mockResolvedValue({ db: {}, conteudo: { ...conteudo, textos: { ...conteudo.textos, pagamentoAguardando: "Texto do Diego para o Pix." } } });
    m.vistaPagamento.mockResolvedValue(pagamento({ estado: "pix_aguardando", dinheiroSemDesfecho: true, pix: { copiaECola: "000201PIXFICTICIO", imagem: "data:image/png;base64,RkFMU08=", link: null, expiraEm: holdAte.toISOString() } }));
    const h = await html();
    expect(h).toContain("Texto do Diego para o Pix.");
    expect(h).toContain("000201PIXFICTICIO");
    expect(h).toContain('src="data:image/png;base64,RkFMU08="');
    expect(h).toContain("Este Pix vale até <strong>12:30</strong>");
    expect(h).toContain("Pode fechar e voltar por este link");
    // Mesmo sem as chaves agora, o pagamento de teste já criado mostra a faixa.
    expect(h).toContain("Ambiente de teste: nenhuma cobrança real.");
  });

  it.each([
    ["verificando", "Conferindo o pagamento", "Estamos conferindo o pagamento"],
    ["confirmando", "Pagamento recebido", "Pagamento recebido, confirmando sua reserva."],
    ["confirmada", "Reserva confirmada", "Pagamento aprovado: reserva SCL-TESTE1 confirmada."],
    ["aprovado_sem_datas", "Pagamento recebido", TEXTOS_SITE_INICIAIS.pagamentoSemDatas],
    ["devolucao_pedida", "Devolução pedida", "Pedimos a devolução do valor integral"],
    ["devolvido", "Valor devolvido", "O valor do pagamento foi devolvido"],
    ["pix_vencido", "Datas seguradas", "Gerar outro Pix"],
    ["pix_esgotado", "Datas seguradas", "já gerou o máximo de Pix"],
  ] as const)("%s: título e texto do design; um pagamento vence 'expirada' e 'cancelada' (sem 'nova consulta')", async (estado, titulo, texto) => {
    for (const cot of ["expirada", "cancelada", "convertida", "segurada"] as const) {
      m.verCotacao.mockResolvedValue(vistaCotacao(cot));
      m.vistaPagamento.mockResolvedValue(pagamento({ estado, reservaCodigo: "SCL-TESTE1", dinheiroSemDesfecho: estado !== "confirmada", devolucao: estado.startsWith("devol") ? { situacao: estado === "devolvido" ? "feita" : "pedida", em: holdAte.toISOString() } : null }));
      const h = await html();
      expect(h).toContain(`<h2>${titulo}</h2>`);
      expect(h).toContain(texto);
      expect(h).not.toContain("Fazer uma nova consulta");
      expect(h).not.toContain("O tempo desta cotação acabou");
      expect(h).not.toContain("Este pedido foi cancelado");
      expect(h).not.toContain("Nenhum pagamento é feito no site");
    }
  });

  it("confirmada: link para Minha reserva e 'guarde este link'; WhatsApp com a mensagem do pagamento; nada pessoal na página", async () => {
    m.verCotacao.mockResolvedValue(vistaCotacao("convertida", { reserva: { codigo: "SCL-TESTE1", estado: "confirmada" } }));
    m.vistaPagamento.mockResolvedValue(pagamento({ estado: "aprovado_sem_datas", dinheiroSemDesfecho: true }));
    let h = await html();
    expect(decodeURIComponent(h)).toContain("Paguei pelo Pix, mas a página diz que não deu para garantir as datas.");
    m.vistaPagamento.mockResolvedValue(pagamento({ estado: "confirmada", reservaCodigo: "SCL-TESTE1" }));
    h = await html();
    expect(h).toContain('href="/hospede"');
    expect(h).toContain("Guarde este link");
    expect(h).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });

  it("expirada sem pagamento: o fluxo de hoje, com a nova consulta", async () => {
    m.verCotacao.mockResolvedValue(vistaCotacao("expirada"));
    m.vistaPagamento.mockResolvedValue(pagamento({ holdAte: null }));
    const h = await html();
    expect(h).toContain("O tempo desta cotação acabou");
    expect(h).toContain("Fazer uma nova consulta");
  });
});
