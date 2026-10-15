import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { NOTAS_PRECO_SITE } from "@/components/anuncios/QuadroAnuncios";
import Page from "./page";
const m = vi.hoisted(() => ({ sessao: vi.fn(), listar: vi.fn(), site: vi.fn(), db: vi.fn(), redirect: vi.fn(), fotos: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: m.db }));
vi.mock("@/anuncios/repositorio", () => ({ listarAnuncios: m.listar }));
vi.mock("@/anuncios/acoes", () => ({ salvarAnuncioAcao: async () => ({ ok: true }) }));
vi.mock("@/site/site", () => ({ organizacaoDoSite: m.site }));
vi.mock("@/imoveis/fotos", () => ({ quantasFotos: m.fotos }));
beforeEach(() => {
  vi.clearAllMocks();
  m.db.mockReturnValue({});
  m.redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
  m.sessao.mockResolvedValue({ papel: "operacao", usuarioId: "u", organizacaoId: "org" });
  m.site.mockResolvedValue("org");
  m.fotos.mockResolvedValue(new Map([["im", 3]]));
  m.listar.mockResolvedValue([
    { id: "im", codigo: "T1", nome: "Studio fictício", bairro: "Leblon", cidade: "Rio de Janeiro", descricao: "Do site", frase: "", ativo: true, publico: true, precoBase: 10000, fontePrecos: "scl", anuncios: [], vinculos: [{ canal: "airbnb", idExterno: "123" }] },
    { id: "arq", codigo: "ARQ", nome: "Arquivado", bairro: "", cidade: "Rio de Janeiro", descricao: "", frase: "", ativo: false, publico: true, precoBase: null, fontePrecos: "beds24", anuncios: [], vinculos: [] },
  ]);
});
const html = async (params = {}) => renderToStaticMarkup(await Page({ params: Promise.resolve({}), searchParams: Promise.resolve(params) }));
it.each(["proprietario", "hospede", "limpeza"])("acesso direto de %s redireciona antes de consultar dados internos", async (papel) => {
  m.sessao.mockResolvedValue({ papel, usuarioId: "u", organizacaoId: "org", imovelIds: ["im"] });
  await expect(html()).rejects.toThrow("NEXT_REDIRECT");
  expect(m.redirect).toHaveBeenCalledWith("/painel");
  expect(m.db).not.toHaveBeenCalled();
  expect(m.listar).not.toHaveBeenCalled();
  expect(m.site).not.toHaveBeenCalled();
  expect(m.fotos).not.toHaveBeenCalled();
});
it("operação lê sem formulários de edição; ID não significa publicação", async () => {
  const h = await html();
  expect(h).toContain("Anúncios T1"); expect(h).not.toContain("Anúncios ARQ");
  expect(h).toContain("Não conferido"); expect(h).toContain("Vínculo não comprova publicação");
  // Nota do preço base pela fonte de preços (M7.17): com SCL, é a base da noite no site.
  expect(h).toContain(NOTAS_PRECO_SITE.scl);
  expect(h).not.toContain("Editar referência do");
  // Fotos reais do site (M7.3): quantas há, ou o aviso de que ainda não há.
  expect(h).toContain("3 fotos reais na galeria (a primeira é a capa).");
  m.fotos.mockResolvedValue(new Map());
  expect(await html()).toContain("Sem fotos ainda");
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
  // O arquivado tem preços do Beds24: a nota diz que o preço base fica só como referência.
  expect(h).toContain(NOTAS_PRECO_SITE.beds24);
  expect(h).toContain("canais não conferidos ainda precisam");
});
