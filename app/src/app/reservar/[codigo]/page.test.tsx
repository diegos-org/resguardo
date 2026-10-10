import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import type { AceiteNaPagina } from "@/site/aceites";
import type { CotacaoVista } from "@/site/cotacoes";
import type { AlteracaoDoHospede, PagamentoDoHospede } from "@/site/pagamento-vista";
import Page from "./page";

const m = vi.hoisted(() => ({
  site: vi.fn(),
  verCotacao: vi.fn(),
  portao: vi.fn(),
  vistaPagamento: vi.fn(),
  pixPossivel: vi.fn(),
  autorizado: vi.fn(),
  gerarPix: vi.fn(),
  aceite: vi.fn(),
  aceiteDiferenca: vi.fn(),
  versaoPrivacidade: vi.fn(),
  cartaoNoSite: vi.fn(),
  pagarComCartao: vi.fn(),
}));
vi.mock("@/site/pagina", () => ({ carregarSite: m.site, metadadosDoSite: vi.fn() }));
vi.mock("@/site/cotacoes", async (orig) => ({ ...(await orig<typeof import("@/site/cotacoes")>()), verCotacao: m.verCotacao }));
vi.mock("@/calendario/regras-config", () => ({ lerRegrasCalendario: async () => ({ site: { minutosHold: 30 } }) }));
vi.mock("@/site/pagamento", () => ({ portaoDoSite: m.portao, vistaDoPagamento: m.vistaPagamento, pixPossivel: m.pixPossivel, cartaoNoSite: m.cartaoNoSite }));
vi.mock("@/site/checkout", () => ({ autorizadoNaCotacao: m.autorizado }));
vi.mock("@/site/aceites", () => ({ aceiteParaPagina: m.aceite, aceiteDaDiferencaParaPagina: m.aceiteDiferenca }));
vi.mock("@/configuracoes/paginas-legais", () => ({ versaoAtualDaPaginaLegal: m.versaoPrivacidade }));
vi.mock("@/site/acoes", () => ({ segurarDatasAcao: vi.fn() }));
vi.mock("@/site/acoes-pagamento", () => ({ gerarPixAcao: m.gerarPix, continuarPagamentoAcao: vi.fn(), pagarComCartaoAcao: m.pagarComCartao }));
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
  estado: "sem_pagamento", ambienteTeste: true, dinheiroSemDesfecho: false, holdAte: holdAte.toISOString(), pix: null, pixRestantes: 3, podeGerar: true, reservaCodigo: null, pagamentoEmDobro: false, devolucao: null, acompanhar: false,
  podePagarCartao: false, cartao: null, cartaoRestantes: 3, desafioUrl: null, forma: null, recusa: null, prazoDasDatas: null, cancelamento: null, pedidoCancelamentoEm: null, ...over,
});
const CARTAO = { chavePublica: "TEST-chave-publica-ficticia", valor: 182400, parcelasMaximas: null, emailTeste: "test@testuser.com" };
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
  m.aceite.mockResolvedValue(null);
  m.aceiteDiferenca.mockResolvedValue(null);
  m.versaoPrivacidade.mockResolvedValue(null);
  m.cartaoNoSite.mockResolvedValue(false);
  m.pagarComCartao.mockResolvedValue({});
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

  it("reserva já confirmada pela equipe, sem pagamento no site: nenhum texto de 'pague por Pix aqui'", async () => {
    m.verCotacao.mockResolvedValue(vistaCotacao("convertida", { reserva: { codigo: "SCL-TESTE1", estado: "confirmada" } }));
    m.portao.mockResolvedValue(GATE_OK);
    m.pixPossivel.mockResolvedValue(true);
    const h = await html();
    expect(h).not.toContain("o pagamento é por Pix");
    expect(m.pixPossivel).not.toHaveBeenCalled();
  });

  it("expirada sem pagamento: o fluxo de hoje, com a nova consulta", async () => {
    m.verCotacao.mockResolvedValue(vistaCotacao("expirada"));
    m.vistaPagamento.mockResolvedValue(pagamento({ holdAte: null }));
    const h = await html();
    expect(h).toContain("O tempo desta cotação acabou");
    expect(h).toContain("Fazer uma nova consulta");
  });
});

describe("páginas legais na página da cotação (M7.4)", () => {
  const ACEITE: AceiteNaPagina = {
    versoes: { termos: 1, privacidade: 2, cancelamento: 1 },
    aceito: null,
    resumo: [{ tipo: "paragrafo", texto: "RESUMO DA POLITICA" }],
    prazo: { tipo: "integral_ate", data: "2026-09-28" },
  };

  it("pagar: o aceite é lido para esta cotação (entrada, fuso, reserva) e a caixa vai no Gerar Pix com o resumo e o prazo", async () => {
    m.portao.mockResolvedValue(GATE_OK);
    m.vistaPagamento.mockResolvedValue(pagamento({ estado: "pagar" }));
    m.aceite.mockResolvedValue(ACEITE);
    const h = await html();
    expect(m.aceite).toHaveBeenCalledWith({}, "org", { id: cotacao.id, checkin: "2026-10-12", fuso: "America/Sao_Paulo", reservaId: cotacao.reservaId }, expect.any(Date));
    expect(h).toContain("Antes de pagar");
    expect(h).toContain("RESUMO DA POLITICA");
    expect(h).toContain("até <strong>23h59 de 28/09/2026</strong>");
    expect(h).toContain('<input type="checkbox" required="" name="aceite" value="sim"/>');
    expect(h).toContain('href="/privacidade?versao=2"');
    // Datas seguradas: sem o formulário de segurar, nem se lê a versão da privacidade para ele.
    expect(m.versaoPrivacidade).not.toHaveBeenCalled();
  });

  it("situações sem a caixa (Pix aguardando sem o cartão, devolução) nem leem o aceite; confirmada mostra o aceite da reserva", async () => {
    // M8.2b: com o Pix aguardando, a caixa só aparece quando o cartão também é oferecido (é outra forma de pagar).
    m.vistaPagamento.mockResolvedValue(pagamento({ estado: "pix_aguardando", dinheiroSemDesfecho: true, podeGerar: false }));
    await html();
    m.vistaPagamento.mockResolvedValue(pagamento({ estado: "devolvido", devolucao: { situacao: "feita", em: holdAte.toISOString() } }));
    await html();
    expect(m.aceite).not.toHaveBeenCalled();
    m.verCotacao.mockResolvedValue(vistaCotacao("convertida", { reserva: { codigo: "SCL-TESTE1", estado: "confirmada" } }));
    m.vistaPagamento.mockResolvedValue(pagamento({ estado: "confirmada", reservaCodigo: "SCL-TESTE1" }));
    m.aceite.mockResolvedValue({ ...ACEITE, aceito: { em: "2026-10-01T15:02:00.000Z", versoes: ACEITE.versoes } });
    const h = await html();
    expect(h).toContain("Você aceitou os");
    expect(h).toContain("Política de privacidade (versão 2)");
    expect(h).not.toContain('type="checkbox"');
  });

  it("cotação aberta: o formulário de segurar as datas aponta para a Política de privacidade em vigor; sem ela publicada, o aviso sem link", async () => {
    m.verCotacao.mockResolvedValue(vistaCotacao("aberta", { reserva: null }));
    // Só a privacidade publicada (termos e cancelamento ainda em preparação) já basta para o link.
    m.versaoPrivacidade.mockResolvedValue(3);
    let h = await html();
    expect(m.versaoPrivacidade).toHaveBeenCalledWith({}, "org", "privacidade");
    expect(h).toContain('<a href="/privacidade?versao=3" target="_blank" rel="noopener noreferrer">Política de privacidade</a>');
    m.versaoPrivacidade.mockResolvedValue(null);
    h = await html();
    expect(h).toContain("Usamos seus dados só para confirmar a reserva com você. Nenhum pagamento é feito aqui.");
    expect(h).not.toContain("/privacidade?versao=");
  });
});

describe("cartão de crédito na página da cotação (M8.2b)", () => {
  const ACEITE: AceiteNaPagina = { versoes: { termos: 1, privacidade: 1, cancelamento: 1 }, aceito: null, resumo: [{ tipo: "paragrafo", texto: "RESUMO DA POLITICA" }], prazo: { tipo: "integral_ate", data: "2026-09-28" } };

  it("cotação aberta com o cartão ligado: os textos dizem 'por Pix ou cartão'; sem ele, só Pix", async () => {
    m.verCotacao.mockResolvedValue(vistaCotacao("aberta", { reserva: null }));
    m.portao.mockResolvedValue(GATE_OK);
    m.pixPossivel.mockResolvedValue(true);
    m.cartaoNoSite.mockResolvedValue(true);
    let h = await html();
    expect(m.cartaoNoSite).toHaveBeenCalledWith({}, "org", GATE_OK, expect.any(Date));
    expect(h).toContain("para pagar por Pix ou cartão aqui mesmo");
    expect(h).toContain("Nada é cobrado ao segurar: o pagamento por Pix ou cartão aparece logo depois");
    expect(h).toContain("o pagamento é por Pix ou cartão de crédito, aqui no site");
    m.cartaoNoSite.mockResolvedValue(false);
    h = await html();
    expect(h).not.toContain("cartão");
  });

  it("datas seguradas com Pix e cartão: a escolha (Pix recomendado, marcado), a nota dos juros, a caixa do aceite e o Gerar Pix; o formulário do cartão só quando escolhido", async () => {
    m.portao.mockResolvedValue(GATE_OK);
    m.vistaPagamento.mockResolvedValue(pagamento({ estado: "pagar", podePagarCartao: true, cartao: CARTAO }));
    m.aceite.mockResolvedValue(ACEITE);
    const h = await html();
    expect(h).toContain("<h3>Pagamento</h3>");
    expect(h).toContain('aria-label="Pagamento"');
    expect(h).toContain('<input type="radio" name="formaPagamento" checked="" value="pix"/><span>Pix (recomendado)</span>');
    expect(h).toContain("Cartão de crédito");
    expect(h).toContain("No cartão parcelado há juros do Mercado Pago, pagos por você; o total aparece no formulário antes de confirmar.");
    expect(h).toContain("Gerar Pix");
    expect(h).toContain("Antes de pagar");
    // O SDK do Mercado Pago nunca vai na página do servidor.
    expect(h).not.toContain("sdk.mercadopago.com");
  });

  it("Pix esgotado com o cartão: o aceite é lido (a caixa vai no cartão), o texto oferece o cartão e a equipe é opção secundária", async () => {
    m.portao.mockResolvedValue(GATE_OK);
    m.vistaPagamento.mockResolvedValue(pagamento({ estado: "pix_esgotado", podeGerar: false, pixRestantes: 0, podePagarCartao: true, cartao: CARTAO }));
    m.aceite.mockResolvedValue(ACEITE);
    const h = await html();
    expect(m.aceite).toHaveBeenCalled();
    expect(h).toContain("Esta cotação já gerou o máximo de Pix. Você ainda pode pagar com cartão de crédito.");
    expect(h).toContain("Prefere combinar com a equipe?");
  });

  it("cartão em análise: o texto editável e a linha fixa do prazo das datas (hora no fuso do imóvel); a equipe é o caminho principal", async () => {
    m.site.mockResolvedValue({ db: {}, conteudo: { ...conteudo, textos: { ...conteudo.textos, pagamentoCartaoAnalise: "Texto do Diego para a análise." } } });
    m.vistaPagamento.mockResolvedValue(pagamento({ estado: "cartao_em_analise", forma: "cartao", podeGerar: false, dinheiroSemDesfecho: true, prazoDasDatas: "2099-10-01T16:30:00.000Z" }));
    const h = await html();
    expect(h).toContain("<h2>Pagamento em análise</h2>");
    expect(h).toContain("Texto do Diego para a análise.");
    expect(h).toContain("As datas estão seguradas até 01/10, 13:30.");
    expect(decodeURIComponent(h)).toContain("Paguei com cartão e a página diz que o pagamento está em análise.");
    expect(h).not.toContain("Prefere combinar com a equipe?");
    expect(m.aceite).not.toHaveBeenCalled();
  });

  it("desafio do banco: o quadro do banco com o endereço conferido e os outros caminhos; sem o endereço, o aviso", async () => {
    m.portao.mockResolvedValue(GATE_OK);
    m.vistaPagamento.mockResolvedValue(pagamento({ estado: "cartao_desafio", forma: "cartao", dinheiroSemDesfecho: true, podePagarCartao: true, cartao: CARTAO, desafioUrl: "https://www.mercadopago.com.br/checkout/v1/3ds/FALSO1" }));
    let h = await html();
    expect(h).toContain("<h2>Verificação do seu banco</h2>");
    expect(h).toContain('<iframe src="https://www.mercadopago.com.br/checkout/v1/3ds/FALSO1" title="Verificação do seu banco" referrerPolicy="no-referrer"');
    expect(h).toContain("Pagar com Pix");
    expect(h).toContain("Usar outro cartão");
    m.vistaPagamento.mockResolvedValue(pagamento({ estado: "cartao_desafio", forma: "cartao", dinheiroSemDesfecho: true, desafioUrl: null }));
    h = await html();
    expect(h).toContain("Não deu para abrir a verificação do banco.");
    expect(h).not.toContain("<iframe");
  });

  it("cartão recusado: o texto genérico (ou o da verificação), e as formas que sobram", async () => {
    m.portao.mockResolvedValue(GATE_OK);
    m.vistaPagamento.mockResolvedValue(pagamento({ estado: "cartao_recusado", forma: "cartao", recusa: "cartao", podePagarCartao: true, cartao: CARTAO }));
    let h = await html();
    expect(h).toContain("<h2>Datas seguradas</h2>");
    expect(h).toContain("Não foi possível aprovar o pagamento com este cartão. Confira os dados, use outro cartão ou pague com Pix.");
    expect(h).toContain("Pix (recomendado)");
    m.vistaPagamento.mockResolvedValue(pagamento({ estado: "cartao_recusado", forma: "cartao", recusa: "verificacao", podeGerar: false }));
    h = await html();
    expect(h).toContain("A verificação do seu banco não foi concluída. Tente de novo ou pague com Pix.");
    expect(h).toContain("O pagamento pelo site não está disponível agora.");
  });
});

describe("reserva cancelada pela política (M8.2c)", () => {
  const cancelamento = {
    recebidoEm: "2026-10-10T13:00:00.000Z",
    quemCancela: "empresa" as const,
    direito: "integral" as const,
    base: "empresa" as const,
    motivoEmpresa: "imovel_sem_condicoes" as const,
    valor: 182400,
    valorConfirmado: 182400,
    devolucaoEm: "2026-10-11T15:00:00.000Z",
    porFora: false,
    algumaPorFora: false,
    confirmadaPor: "leitura" as const,
    forma: "pix" as const,
    estornoPelaEquipe: false,
    integralAte: "2026-10-26",
    arrependimentoAte: "2026-10-08",
    entradaEm: "2026-11-09T18:00:00.000Z",
    politicaVersao: 1,
  };

  it("a situação do pagamento vence a cotação cancelada: o título, os fatos e as frases de Textos do site (as editadas; vazias, as do texto-base)", async () => {
    m.verCotacao.mockResolvedValue(vistaCotacao("cancelada"));
    m.vistaPagamento.mockResolvedValue(pagamento({ estado: "cancelada_devolvida", holdAte: null, podeGerar: false, reservaCodigo: "SCL-TESTE1", forma: "pix", cancelamento }));
    m.site.mockResolvedValue({ db: {}, conteudo: { ...conteudo, textos: { ...TEXTOS_SITE_INICIAIS, cancelamentoVoltaPix: "VOLTA PIX EDITADA", cancelamentoSemTaxas: "" } } });
    const h = await html();
    expect(h).toContain("<h2>Reserva cancelada</h2>");
    expect(h).toContain("Nós cancelamos a sua reserva SCL-TESTE1: o apartamento ficou sem condições de receber você.");
    expect(h).toContain("Devolução de R$ 1.824,00 confirmada pelo Mercado Pago em 11/10.");
    expect(h).toContain("VOLTA PIX EDITADA");
    expect(h).toContain(TEXTOS_SITE_INICIAIS.cancelamentoSemTaxas);
    expect(h).toContain(TEXTOS_SITE_INICIAIS.cancelamentoFecho);
    expect(h).toContain(encodeURIComponent("Quero falar sobre o cancelamento da minha reserva SCL-TESTE1."));
    expect(h).not.toContain("Este pedido foi cancelado");
    expect(h).not.toMatch(/Beds24/i);
    // A frase final pode ficar vazia (não volta o texto-base).
    m.site.mockResolvedValue({ db: {}, conteudo: { ...conteudo, textos: { ...TEXTOS_SITE_INICIAIS, cancelamentoFecho: "" } } });
    expect(await html()).not.toContain(TEXTOS_SITE_INICIAIS.cancelamentoFecho);
  });

  it("devolução que espera o Mercado Pago liberar o pagamento (M8.2d): a frase editável de Textos do site, nunca 'já pedimos'", async () => {
    m.verCotacao.mockResolvedValue(vistaCotacao("cancelada"));
    const esperando = { ...cancelamento, valorConfirmado: null, devolucaoEm: null, aguardandoLiberacao: { previstaEm: "2026-11-15" } };
    m.vistaPagamento.mockResolvedValue(pagamento({ estado: "cancelada_devolucao_pedida", holdAte: null, podeGerar: false, reservaCodigo: "SCL-TESTE1", forma: "cartao", cancelamento: esperando }));
    m.site.mockResolvedValue({ db: {}, conteudo: { ...conteudo, textos: { ...TEXTOS_SITE_INICIAIS, devolucaoAguardaLiberacao: "PEDIMOS QUANDO O MERCADO PAGO LIBERAR" } } });
    const h = await html();
    expect(h).toContain("Devolução de R$ 1.824,00 (previsto para 15/11). PEDIMOS QUANDO O MERCADO PAGO LIBERAR");
    expect(h).not.toContain(TEXTOS_SITE_INICIAIS.cancelamentoDevolucaoPedida);
    // Vazia (obrigatória), volta o texto-base.
    m.site.mockResolvedValue({ db: {}, conteudo: { ...conteudo, textos: { ...TEXTOS_SITE_INICIAIS, devolucaoAguardaLiberacao: "" } } });
    expect(await html()).toContain(TEXTOS_SITE_INICIAIS.devolucaoAguardaLiberacao);
  });
});

describe("alteração da reserva paga pelo site (M8.2d)", () => {
  const ID = "44444444-4444-4444-8444-444444444444";
  const alteracao = (over: Partial<AlteracaoDoHospede> = {}): AlteracaoDoHospede => ({
    id: ID,
    situacao: "segurada",
    rumo: "aumento",
    antes: { checkin: "2026-10-12", checkout: "2026-10-15", hospedes: 4, valor: 182400 },
    depois: { checkin: "2026-10-12", checkout: "2026-10-16", hospedes: 4, valor: 235200 },
    diferenca: 52800,
    valorNovo: 235200,
    holdAte: "2026-10-01T16:20:00.000Z",
    preparadaEm: "2026-10-01T15:20:00.000Z",
    aplicadaEm: null,
    reducao: null,
    devolucao: null,
    pagoSemAlteracao: null,
    pagamento: pagamento({ estado: "pagar", holdAte: "2026-10-01T16:20:00.000Z", podeGerar: true }),
    politicaVersao: 1,
    entradaDaPolitica: "2026-10-12",
    entradaDosPrazos: "2026-10-12",
    ...over,
  });
  const ACEITE_D11: AceiteNaPagina = {
    versoes: { termos: 2, privacidade: 1, cancelamento: 1 },
    aceito: null,
    resumo: [{ tipo: "paragrafo", texto: "RESUMO DA POLÍTICA DA RESERVA" }],
    prazo: { tipo: "sem_reembolso", dias: 14 },
    daReserva: { versao: 1, em: "2026-10-01T15:00:00.000Z" },
  };
  const confirmada = (a: AlteracaoDoHospede | null) => pagamento({ estado: "confirmada", holdAte: null, podeGerar: false, reservaCodigo: "SCL-TESTE1", forma: "pix", alteracao: a });
  beforeEach(() => {
    m.verCotacao.mockResolvedValue(vistaCotacao("convertida", { reserva: { codigo: "SCL-TESTE1", estado: "confirmada" } }));
  });

  it("segurada com a diferença a pagar: o quadro da alteração antes do pagamento, o Pix da diferença com a alteração e o aceite do D11 lido para esta reserva", async () => {
    m.vistaPagamento.mockResolvedValue(confirmada(alteracao()));
    m.aceiteDiferenca.mockResolvedValue(ACEITE_D11);
    const h = await html();
    expect(m.aceiteDiferenca).toHaveBeenCalledWith({}, "org", { id: cotacao.id, checkin: "2026-10-12", fuso: "America/Sao_Paulo", reservaId: cotacao.reservaId }, expect.any(Date));
    expect(h.indexOf("Alteração da sua reserva")).toBeGreaterThan(-1);
    expect(h.indexOf("Alteração da sua reserva")).toBeLessThan(h.indexOf("Pagamento aprovado: reserva SCL-TESTE1 confirmada."));
    expect(h).toContain("Alteração da reserva SCL-TESTE1: de 12/10–15/10 (3 noites, 4 pessoas) para 12/10–16/10 (4 noites, 4 pessoas).");
    expect(h).toContain("Diferença a pagar: <strong>R$ 528,00</strong>");
    expect(h).toContain(`name="alteracao" value="${ID}"`);
    expect(h).toContain("A sua reserva continua na ");
    expect(h).toContain("RESUMO DA POLÍTICA DA RESERVA");
    expect(h).toContain(encodeURIComponent("Quero falar sobre a alteração da minha reserva SCL-TESTE1."));
    expect(h).not.toMatch(/Beds24/i);
    expect(h).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });

  it("as frases da alteração vêm de Textos do site (as editadas; as obrigatórias vazias voltam ao texto-base)", async () => {
    m.vistaPagamento.mockResolvedValue(confirmada(alteracao()));
    m.site.mockResolvedValue({ db: {}, conteudo: { ...conteudo, textos: { ...TEXTOS_SITE_INICIAIS, alteracaoEmAndamento: "PAGUE A DIFERENÇA EDITADA", alteracaoPolitica: "" } } });
    const h = await html();
    expect(h).toContain("PAGUE A DIFERENÇA EDITADA");
    expect(h).toContain(TEXTOS_SITE_INICIAIS.alteracaoPolitica);
  });

  it("aplicada (sem pagamento da diferença) ou nenhuma alteração: o aceite da diferença nem é lido; a aplicada mostra a alteração confirmada", async () => {
    m.vistaPagamento.mockResolvedValue(confirmada(alteracao({ situacao: "aplicada", aplicadaEm: "2026-10-01T15:30:00.000Z", pagamento: null })));
    const h = await html();
    expect(h).toContain("Alteração confirmada em 01/10: 12/10–16/10, 4 pessoas, R$ 2.352,00.");
    expect(h).not.toContain('name="alteracao"');
    expect(m.aceiteDiferenca).not.toHaveBeenCalled();
    m.vistaPagamento.mockResolvedValue(confirmada(null));
    expect(await html()).not.toContain("Alteração");
    expect(m.aceiteDiferenca).not.toHaveBeenCalled();
  });

  it("reserva já alterada: o resumo diz que é o da cotação original e mostra as datas, as pessoas e o valor de agora (também depois que a alteração sai do quadro)", async () => {
    m.vistaPagamento.mockResolvedValue({ ...confirmada(null), reservaAtual: { checkin: "2026-10-12", checkout: "2026-10-16", hospedes: 4, valor: 235200 } });
    const h = await html();
    expect(h).toContain("A sua reserva <strong>SCL-TESTE1</strong> foi alterada depois desta cotação: agora é de 12/10/2026 a 16/10/2026 · 4 noites · 4 pessoas · valor da reserva R$ 2.352,00. O resumo abaixo é o da cotação original.");
    expect(h).not.toMatch(/Beds24/i);
    m.vistaPagamento.mockResolvedValue(confirmada(null));
    expect(await html()).not.toContain("foi alterada depois desta cotação");
  });
});
