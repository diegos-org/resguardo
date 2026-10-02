import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import Page from "./page";
const mocks = vi.hoisted(() => ({ listar: vi.fn(), sessao: vi.fn(), imoveis: vi.fn() }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: mocks.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/imoveis/repositorio", () => ({ listarImoveis: mocks.imoveis }));
vi.mock("@/reservas/listagem", async original => ({ ...await original<object>(), listarReservasPaginadas: mocks.listar, resumoImportacao: async () => null }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.imoveis.mockResolvedValue([{ id: "im", codigo: "FAKE", nome: "Fictício", ativo: true }, { id: "arq", codigo: "ARQ", nome: "Antigo", ativo: false }]);
  mocks.sessao.mockResolvedValue({ organizacaoId: "org", papel: "operacao" });
  mocks.listar.mockResolvedValue({ total: 56, pagina: 2, paginas: 3, itens: [{ id: "fake", codigo: "SCL-FICTIC", imovelId: "im", origem: "airbnb", estado: "consulta", checkin: "2027-06-01", checkout: "2027-06-04", hospedeNome: "Fictício", valorBruto: 90000, reservadaEm: new Date("2026-10-02T02:30:00Z"), conflito: false }] });
});

it.each([
  [{}, ["im"]],
  [{ imovel: "desconhecido" }, ["im"]],
  [{ escopo: "historico" }, ["im", "arq"]],
  [{ imovel: "ARQ" }, ["arq"]],
  [{ imovel: ["FAKE", "ARQ"] }, ["im", "arq"]],
  [{ imovel: " FAKE, ARQ, desconhecido,ARQ " }, ["im", "arq"]],
  [{ escopo: "historico", imovel: "FAKE" }, ["im"]],
])("respeita o escopo e a seleção explícita de imóveis: %j", async (params, ids) => {
  await Page({ params: Promise.resolve({}), searchParams: Promise.resolve(params) });
  expect(mocks.listar).toHaveBeenCalledWith(expect.anything(), "org", expect.anything(), expect.objectContaining({ imovelIds: ids }));
});

it("marca apenas ativos por padrão e permite ampliar para histórico sem fixar a seleção", async () => {
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }));
  const checkbox = (codigo: string) => html.match(new RegExp(`<input[^>]*type="checkbox"[^>]*value="${codigo}"[^>]*>`))?.[0];
  expect(checkbox("FAKE")).toContain('checked=""');
  expect(checkbox("ARQ")).not.toContain('checked=""');
  expect(html).toContain("Antigo (arquivado)");
  expect(html).not.toContain('type="hidden" name="imovel"');
});

it("preserva seleção explícita de todos os imóveis no formulário de busca e na paginação", async () => {
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({}), searchParams: Promise.resolve({ imovel: ["FAKE", "ARQ"] }) }));
  expect(html).toContain('type="hidden" name="imovel" value="FAKE"');
  expect(html).toContain('type="hidden" name="imovel" value="ARQ"');
  expect(html).toMatch(/href="[^"]*imovel=FAKE&amp;imovel=ARQ[^"]*pagina=3/);
});

it("não inclui arquivados quando não existe nenhum imóvel ativo", async () => {
  mocks.imoveis.mockResolvedValue([{ id: "arq", codigo: "ARQ", nome: "Antigo", ativo: false }]);
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }));
  expect(mocks.listar).toHaveBeenCalledWith(expect.anything(), "org", expect.anything(), expect.objectContaining({ imovelIds: [] }));
  expect(html).not.toContain('checked=""');
  expect(html).toContain("Nenhum imóvel ativo selecionado");
});
it("página preserva filtros nos links, mostra consulta/data local e oculta financeiro da operação", async () => {
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({}), searchParams: Promise.resolve({ escopo: "historico", ordem: "origem", situacao: "consulta", busca: "SCL-FICTIC", pagina: "2" }) }));
  expect(html).toContain("26–50 de 56");
  expect(html).toContain("Próxima");
  expect(html).toContain("situacao=consulta&amp;escopo=historico&amp;ordem=origem&amp;pagina=3");
  expect(html).toContain("01/10/2026, 23:30:00");
  expect(html).not.toContain("<th>Bruto</th>");
  expect(html).not.toContain("possível overbooking");
  expect(mocks.listar.mock.calls[0][1]).toBe("org");
});
it("administrador vê a coluna financeira; busca vazia explica como ampliar os filtros", async () => {
  mocks.sessao.mockResolvedValue({ organizacaoId: "org", papel: "admin" });
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }));
  expect(html).toContain("<th>Bruto</th>");
  mocks.listar.mockResolvedValue({ total: 0, pagina: 1, paginas: 1, itens: [] });
  const vazio = renderToStaticMarkup(await Page({ params: Promise.resolve({}), searchParams: Promise.resolve({ busca: "inexistente" }) }));
  expect(vazio).toContain("Nenhum registro corresponde aos filtros");
  expect(vazio).not.toContain(">Próxima</a>");
});
