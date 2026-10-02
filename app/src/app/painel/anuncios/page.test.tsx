import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import Page from "./page";
const m = vi.hoisted(() => ({ sessao: vi.fn(), listar: vi.fn(), site: vi.fn() }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/anuncios/repositorio", () => ({ listarAnuncios: m.listar }));
vi.mock("@/anuncios/acoes", () => ({ salvarAnuncioAcao: async () => ({ ok: true }) }));
vi.mock("@/site/site", () => ({ organizacaoDoSite: m.site }));
beforeEach(() => {
  vi.clearAllMocks();
  m.sessao.mockResolvedValue({ papel: "operacao", usuarioId: "u", organizacaoId: "org" });
  m.site.mockResolvedValue("org");
  m.listar.mockResolvedValue([
    { id: "im", codigo: "T1", nome: "Studio fictício", descricao: "Do site", ativo: true, publico: true, precoBase: 10000, anuncios: [], vinculos: [{ canal: "airbnb", idExterno: "123" }] },
    { id: "arq", codigo: "ARQ", nome: "Arquivado", descricao: "", ativo: false, publico: true, precoBase: null, anuncios: [], vinculos: [] },
  ]);
});
const html = async (params = {}) => renderToStaticMarkup(await Page({ params: Promise.resolve({}), searchParams: Promise.resolve(params) }));
it("operação lê sem formulários de edição; ID não significa publicação", async () => {
  const h = await html();
  expect(h).toContain("Anúncios T1"); expect(h).not.toContain("Anúncios ARQ");
  expect(h).toContain("Não conferido"); expect(h).toContain("Vínculo não comprova publicação");
  expect(h).toContain("Preço interno de referência");
  expect(h).not.toContain("Editar referência do");
});
it("admin pode editar as referências e tem atalho para o cadastro do site", async () => {
  m.sessao.mockResolvedValue({ papel: "admin", usuarioId: "u", organizacaoId: "org" });
  const h = await html(); expect(h).toContain("Editar referência do Airbnb"); expect(h).toContain("Editar dados do site no cadastro");
});
it("mantém seleção explícita e arquivados sem dar link para site de outra empresa", async () => {
  m.site.mockResolvedValue("outra");
  const h = await html({ imovel: ["T1", "ARQ"], ano: "2027", mes: "todos" });
  expect(h).toContain("Anúncios ARQ");
  expect(h.match(/<input[^>]*name="imovel"[^>]*value="ARQ"[^>]*>/)?.[0]).toContain('checked=""');
  expect(h).toContain('name="ano" value="2027"');
  expect(h).not.toContain("Abrir página do imóvel");
  expect(h).toContain("Site não configurado para esta empresa");
});
it("não anuncia diferenças quando faltam referências; permite incluir arquivados", async () => {
  const h = await html({ arquivados: "sim" });
  expect(h).toContain("Anúncios ARQ"); expect(h).not.toContain("Diferenças para conferir");
  expect(h).toContain("canais não conferidos ainda precisam");
});
