import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ABAS_CONFIG } from "@/configuracoes/abas";
import { CONFIG_PAGAMENTO_SITE_PADRAO } from "@/configuracoes/pagamento-site";
import { ESPERA_TELA_MS } from "@/lib/prazo";

const m = vi.hoisted(() => ({ sessao: vi.fn(), config: vi.fn(), categorias: vi.fn(), motivos: vi.fn(), portao: vi.fn(), redirect: vi.fn(), disjuntor: vi.fn(), recusas: vi.fn(), disparos: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/configuracoes/empresa", () => ({ nomeDaEmpresa: async () => "Sua Casa Leblon" }));
vi.mock("@/configuracoes/pagamento-site", async (original) => ({ ...(await original<typeof import("@/configuracoes/pagamento-site")>()), lerConfigPagamentoSite: m.config }));
vi.mock("@/despesas/categorias", () => ({ listarCategorias: m.categorias }));
vi.mock("@/pagamentos/oferta", async (original) => ({ ...(await original<typeof import("@/pagamentos/oferta")>()), motivosPorImovel: m.motivos, podeCobrar: m.portao }));
vi.mock("@/pagamentos/acoes-painel", () => ({ conferirAgoraAcao: vi.fn(), salvarConfigPagamentoSiteAcao: vi.fn(), religarCartaoAcao: vi.fn() }));
vi.mock("@/pagamentos/disjuntor", async (original) => ({ ...(await original<typeof import("@/pagamentos/disjuntor")>()), disjuntorAberto: m.disjuntor, recusasNasUltimas24h: m.recusas, ultimosDisparos: m.disparos }));
import Page from "./page";

const CAT = "33333333-3333-4333-8333-333333333333";
beforeEach(() => {
  vi.clearAllMocks();
  m.redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  m.config.mockResolvedValue({ ...CONFIG_PAGAMENTO_SITE_PADRAO, oferecer: true, nomeFatura: null, categoriaTaxaId: CAT, cartao: false, parcelasMaximas: null, tresDS: "on_fraud_risk" });
  m.disjuntor.mockResolvedValue(null);
  m.recusas.mockResolvedValue(0);
  m.disparos.mockResolvedValue([]);
  m.categorias.mockResolvedValue([{ id: CAT, nome: "Tarifas bancárias" }]);
  m.portao.mockResolvedValue({ ok: true, provedor: {}, ambiente: "teste" });
  m.motivos.mockResolvedValue([
    { imovelId: "a", codigo: "403", nome: "Studio Fictício", oferece: true, motivo: null, texto: null },
    { imovelId: "b", codigo: "102", nome: "Outro Fictício", oferece: false, motivo: "sem_contrato", texto: "Sem contrato de gestão vigente na data de entrada: segue pela conversa." },
  ]);
});
afterEach(() => vi.useRealTimers());
const html = async () => renderToStaticMarkup(await Page());

it("a aba existe em Configurações para quem edita o financeiro", () => {
  expect(ABAS_CONFIG.find((a) => a.slug === "pagamento-site")).toEqual({ slug: "pagamento-site", titulo: "Pagamento no site", exige: "financeiro:editar" });
});

it.each(["operacao", "limpeza", "proprietario"])("%s não abre a aba", async (papel) => {
  m.sessao.mockResolvedValue({ papel, organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  await expect(html()).rejects.toThrow("NEXT_REDIRECT");
  expect(m.redirect).toHaveBeenCalledWith("/painel/configuracoes");
  expect(m.config).not.toHaveBeenCalled();
});

it("admin vê a chave, o nome na fatura com a prévia (padrão o nome da empresa), a categoria, a lista de imóveis e o Conferir agora", async () => {
  const h = await html();
  expect(m.config).toHaveBeenCalledWith({}, "org");
  expect(m.motivos).toHaveBeenCalledWith({}, "org");
  expect(h).toMatch(/<input type="checkbox" name="oferecer" checked=""/);
  expect(h).toContain('maxLength="22"');
  expect(h).toContain('placeholder="Sua Casa Leblon"');
  // Prévia: os primeiros 10 caracteres.
  expect(h).toContain("<strong>Sua Casa L</strong>");
  expect(h).toContain("Criar “Taxa do pagamento do site” no primeiro uso");
  expect(h).toMatch(new RegExp(`<option value="${CAT}" selected="">Tarifas bancárias</option>`));
  expect(h).toContain("403 · Studio Fictício");
  expect(h).toContain('aria-label="oferece o pagamento"');
  expect(h).toContain("Sem contrato de gestão vigente na data de entrada");
  expect(h).toContain("Conferir agora");
  expect(h).toContain(">Salvar<");
  expect(h).not.toContain("<fieldset disabled");
});

it("categoria escolhida que foi arquivada vira aviso (nunca troca sozinha)", async () => {
  m.categorias.mockResolvedValue([]);
  const h = await html();
  expect(h).toContain("A categoria escolhida antes foi arquivada ou não existe mais");
});

it("travas fechadas (ex.: deploy de produção ou chave do painel desligada): diz por quê e nenhum imóvel aparece com ✓", async () => {
  m.portao.mockResolvedValue({ ok: false, motivo: "so_nas_previas", texto: "O teste do pagamento roda nas prévias da Vercel, não no deploy de produção." });
  let h = await html();
  expect(h).toContain("Hoje o site não oferece o pagamento em nenhum imóvel: O teste do pagamento roda nas prévias da Vercel");
  expect(h).not.toContain('aria-label="oferece o pagamento"');
  expect(h).toContain("cálculo sem pendência");
  // Falha inesperada ao conferir: também não mostra ✓.
  m.portao.mockRejectedValue(new Error("rede"));
  h = await html();
  expect(h).toContain("Hoje o site não oferece o pagamento em nenhum imóvel: Não deu para conferir no Mercado Pago");
  expect(h).not.toContain('aria-label="oferece o pagamento"');
});

it("Mercado Pago sem responder (conferência da conta presa): a página não espera mais que alguns segundos, avisa que não deu para conferir e mostra o resto (inclusive a chave para desligar)", async () => {
  vi.useFakeTimers();
  m.portao.mockReturnValue(new Promise(() => undefined));
  const pagina = Page();
  await vi.advanceTimersByTimeAsync(ESPERA_TELA_MS);
  const h = renderToStaticMarkup(await pagina);
  expect(h).toContain("Não deu para conferir a conta do Mercado Pago agora (ele demorou a responder)");
  expect(h).not.toContain("Hoje o site não oferece o pagamento em nenhum imóvel");
  expect(h).not.toContain('aria-label="oferece o pagamento"');
  expect(h).toContain("cálculo sem pendência (as travas não foram conferidas agora)");
  expect(h).toMatch(/<input type="checkbox" name="oferecer" checked=""/);
  expect(h).toContain(">Salvar<");
});

describe("cartão de crédito (M8.2b)", () => {
  const disparo = (o: Record<string, unknown>) => ({ id: "d1", organizacaoId: "org", abertoEm: new Date("2026-10-09T13:00:00Z"), ate: new Date("2026-10-09T14:00:00Z"), recusas: 8, janela: "30min", reincidente: false, religadoEm: null, religadoPor: null, ...o });

  it("campos do cartão no formulário (desligado por padrão), os freios fixos e a situação; sem disjuntor aberto, nada de religar", async () => {
    const h = await html();
    expect(h).toMatch(/<input type="checkbox" name="cartao"\/> Oferecer cartão de crédito/);
    expect(h).toContain('name="parcelasMaximas"');
    expect(h).toContain('<option value="on_fraud_risk" selected="">Quando houver risco (recomendado): o banco pede a verificação só nos pagamentos arriscados');
    expect(h).toContain("Nunca: nenhuma verificação; toda contestação por cartão roubado fica com a SCL");
    expect(h).toContain("Desligado (marque “Oferecer cartão de crédito” acima)");
    expect(h).toContain("o cartão desliga sozinho por 60 minutos com 8 recusas em 30 minutos, e até alguém religar com 20 recusas em 24 horas");
    expect(h).toContain("até 3 tentativas por cotação, 30 por hora na empresa toda e 5 por endereço de internet por hora");
    expect(h).toContain("Recusas que contaram no disjuntor nas últimas 24 horas: <strong>0</strong>");
    expect(h).not.toContain("nesta fase, só Pix");
    expect(h).not.toContain("Religar o cartão");
    m.config.mockResolvedValue({ ...CONFIG_PAGAMENTO_SITE_PADRAO, oferecer: true, nomeFatura: null, categoriaTaxaId: CAT, cartao: true, parcelasMaximas: 6, tresDS: "never" });
    const ligado = await html();
    expect(ligado).toContain("<strong>Ligado</strong>");
    expect(ligado).toMatch(/name="cartao" checked=""/);
    expect(ligado).toContain('value="6"');
    expect(ligado).toContain('<option value="never" selected="">');
  });

  it("disjuntor aberto: até quando e por quê, os últimos disparos e o Religar o cartão com confirmação", async () => {
    m.config.mockResolvedValue({ ...CONFIG_PAGAMENTO_SITE_PADRAO, oferecer: true, nomeFatura: null, categoriaTaxaId: CAT, cartao: true, parcelasMaximas: null, tresDS: "on_fraud_risk" });
    m.disjuntor.mockResolvedValue({ ate: new Date("2026-10-09T14:00:00Z"), recusas: 8, abertoEm: new Date("2026-10-09T13:00:00Z"), janela: "30min" });
    m.recusas.mockResolvedValue(9);
    m.disparos.mockResolvedValue([disparo({}), disparo({ id: "d0", abertoEm: new Date("2026-10-08T12:00:00Z"), religadoEm: new Date("2026-10-08T12:30:00Z") })]);
    let h = await html();
    expect(h).toContain("Desligado pelo disjuntor até 11:00 — 8 recusas em 30 minutos. O Pix continua.");
    expect(h).toContain("<strong>9</strong>");
    expect(h).toContain("09/10/2026, 10:00");
    expect(h).toContain("religado em 08/10/2026, 09:30");
    expect(h).toContain("Religar o cartão");
    m.disjuntor.mockResolvedValue({ ate: null, recusas: 20, abertoEm: new Date("2026-10-09T13:00:00Z"), janela: "24h" });
    h = await html();
    expect(h).toContain("Desligado até alguém religar — 20 recusas em 24 horas. O Pix continua.");
  });
});

describe("disputa do pagamento (M8.2e)", () => {
  it("a categoria da perda (criada no primeiro uso), os dias de aviso (1 a 15, padrão 5) e o nome e a frase de cada causa, editáveis", async () => {
    const h = await html();
    expect(h).toContain('aria-label="Disputa do pagamento"');
    expect(h).toContain('name="categoriaDaContestacao"');
    expect(h).toContain("Criar “Perda por disputa do pagamento” no primeiro uso");
    const dias = h.match(/<input[^>]*name="diasAvisoDocumentacao"[^>]*>/)?.[0] ?? "";
    expect(dias).toContain('min="1"');
    expect(dias).toContain('max="15"');
    expect(dias).toContain('value="5"');
    for (const codigo of ["imovel", "scl", "cobranca", "fraude", "outro"]) {
      expect(h).toContain(`name="causa_${codigo}_nome"`);
      expect(h).toContain(`name="causa_${codigo}_frase"`);
    }
    // A causa da fraude tem as frases da verificação do banco e do Pix.
    expect(h).toContain('name="causa_fraude_fraseComVerificacao"');
    expect(h).toContain('name="causa_fraude_frasePix"');
    expect(h).toContain("Problema do imóvel (estrutura, equipamento ou obra do proprietário)");
  });

  it("a categoria escolhida que foi arquivada vira aviso (nunca troca sozinha)", async () => {
    m.config.mockResolvedValue({ ...CONFIG_PAGAMENTO_SITE_PADRAO, oferecer: true, categoriaTaxaId: CAT, categoriaDaContestacao: "44444444-4444-4444-8444-444444444444" });
    const h = await html();
    expect(h).toContain("A categoria escolhida antes foi arquivada ou não existe mais");
  });
});
