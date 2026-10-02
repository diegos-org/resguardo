import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { DETALHES_VAZIOS, regrasDeVenda } from "@/imoveis/detalhes";
import { montarPrevia } from "@/calendario/previa";
import Page from "./page";
const m = vi.hoisted(() => ({ sessao: vi.fn(), db: vi.fn(), imoveis: vi.fn(), previa: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: m.db }));
vi.mock("@/imoveis/repositorio", () => ({ listarImoveis: m.imoveis }));
vi.mock("@/calendario/previa-repositorio", () => ({ carregarPrevia: m.previa }));
const imovel = { id: "i103", codigo: "103", nome: "Fictício", ativo: true, fuso: "America/Sao_Paulo" };
const regras = regrasDeVenda({ ...DETALHES_VAZIOS, precoBase: 45000, estadiaMinima: 2 });
beforeEach(() => {
  vi.clearAllMocks();
  m.db.mockReturnValue({});
  m.redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
  m.sessao.mockResolvedValue({ papel: "operacao", usuarioId: "u", organizacaoId: "org" });
  m.imoveis.mockResolvedValue([{ ...imovel, id: "i403", codigo: "403" }, imovel]);
  m.previa.mockResolvedValue({ imovel, regras, vinculos: [], linhas: montarPrevia({ inicio: "2026-10-02", fim: "2026-10-03", hoje: "2026-10-02", regras, periodos: [], reservas: [], bloqueios: [], observacoes: [{ data: "2026-10-02", preco: 45000, minimoNoites: null, livres: null, observadoEm: new Date("2026-10-02T15:00:00Z") }] }) });
});
const html = async (params: Record<string, string> = {}) => renderToStaticMarkup(await Page({ params: Promise.resolve({}), searchParams: Promise.resolve(params) }));

it.each(["proprietario", "limpeza", "hospede"])("%s não lê a prévia mesmo por endereço direto", async papel => {
  m.sessao.mockResolvedValue({ papel, usuarioId: "u", organizacaoId: "org" });
  await expect(html()).rejects.toThrow("NEXT_REDIRECT");
  expect(m.redirect).toHaveBeenCalledWith("/painel");
  expect(m.db).not.toHaveBeenCalled();
  expect(m.imoveis).not.toHaveBeenCalled();
  expect(m.previa).not.toHaveBeenCalled();
});
it("prefere 103 e mostra cobertura parcial, horário local e limites, sem controles de envio", async () => {
  const h = await html({ inicio: "2026-10-02", fim: "2026-10-03" });
  expect(m.previa).toHaveBeenCalledWith({}, "org", "i103", "2026-10-02", "2026-10-03");
  expect(h).toContain("2 noites nesta consulta · 1 com leitura");
  expect(h).toContain("12:00");
  expect(h).toContain("Comparação incompleta");
  expect(h).toContain("Envio ao Beds24 ainda não implementado");
  expect(h).not.toContain("Editar base, períodos");
  expect(h).not.toContain('method="post"');
});
it("admin tem atalho de edição, mas imóvel desconhecido não consulta prévia de outra empresa", async () => {
  m.sessao.mockResolvedValue({ papel: "admin", usuarioId: "u", organizacaoId: "org" });
  expect(await html()).toContain("Editar base, períodos e regras do imóvel");
  m.previa.mockClear();
  expect(await html({ imovel: "outra-empresa" })).toContain("Imóvel não encontrado nesta empresa");
  expect(m.previa).not.toHaveBeenCalled();
});
it("intervalo inválido ou excessivo não consulta dados por noite", async () => {
  expect(await html({ inicio: "2026-10-01", fim: "2027-10-01" })).toContain("Confira até 92 noites por vez");
  expect(m.previa).not.toHaveBeenCalled();
});
it("sem 103 seleciona 403; com lista vazia apresenta cadastro", async () => {
  m.imoveis.mockResolvedValue([{ ...imovel, id: "i403", codigo: "403" }]);
  await html({ inicio: "2026-10-02", fim: "2026-10-03" });
  expect(m.previa).toHaveBeenCalledWith({}, "org", "i403", "2026-10-02", "2026-10-03");
  m.imoveis.mockResolvedValue([]); m.previa.mockClear();
  expect(await html()).toContain("Cadastre um imóvel para começar");
  expect(m.previa).not.toHaveBeenCalled();
});
