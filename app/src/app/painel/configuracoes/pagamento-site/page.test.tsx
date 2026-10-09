import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { ABAS_CONFIG } from "@/configuracoes/abas";

const m = vi.hoisted(() => ({ sessao: vi.fn(), config: vi.fn(), categorias: vi.fn(), motivos: vi.fn(), portao: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/configuracoes/empresa", () => ({ nomeDaEmpresa: async () => "Sua Casa Leblon" }));
vi.mock("@/configuracoes/pagamento-site", async (original) => ({ ...(await original<typeof import("@/configuracoes/pagamento-site")>()), lerConfigPagamentoSite: m.config }));
vi.mock("@/despesas/categorias", () => ({ listarCategorias: m.categorias }));
vi.mock("@/pagamentos/oferta", async (original) => ({ ...(await original<typeof import("@/pagamentos/oferta")>()), motivosPorImovel: m.motivos, podeCobrar: m.portao }));
vi.mock("@/pagamentos/acoes-painel", () => ({ conferirAgoraAcao: vi.fn(), salvarConfigPagamentoSiteAcao: vi.fn() }));
import Page from "./page";

const CAT = "33333333-3333-4333-8333-333333333333";
beforeEach(() => {
  vi.clearAllMocks();
  m.redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  m.config.mockResolvedValue({ oferecer: true, nomeFatura: null, categoriaTaxaId: CAT });
  m.categorias.mockResolvedValue([{ id: CAT, nome: "Tarifas bancárias" }]);
  m.portao.mockResolvedValue({ ok: true, provedor: {}, ambiente: "teste" });
  m.motivos.mockResolvedValue([
    { imovelId: "a", codigo: "403", nome: "Studio Fictício", oferece: true, motivo: null, texto: null },
    { imovelId: "b", codigo: "102", nome: "Outro Fictício", oferece: false, motivo: "sem_contrato", texto: "Sem contrato de gestão vigente na data de entrada: segue pela conversa." },
  ]);
});
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
  expect(h).toContain('aria-label="oferece o Pix"');
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
  expect(h).toContain("Hoje o site não oferece o Pix em nenhum imóvel: O teste do pagamento roda nas prévias da Vercel");
  expect(h).not.toContain('aria-label="oferece o Pix"');
  expect(h).toContain("cálculo sem pendência");
  // Falha inesperada ao conferir: também não mostra ✓.
  m.portao.mockRejectedValue(new Error("rede"));
  h = await html();
  expect(h).toContain("Hoje o site não oferece o Pix em nenhum imóvel: Não deu para conferir no Mercado Pago");
  expect(h).not.toContain('aria-label="oferece o Pix"');
});
