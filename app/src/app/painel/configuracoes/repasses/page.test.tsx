import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { REGRAS_REPASSES_PADRAO } from "@/repasses/periodicidade";
import Page from "./page";
const m = vi.hoisted(() => ({ sessao: vi.fn(), db: vi.fn(), regras: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: m.db }));
vi.mock("@/repasses/regras-config", () => ({ lerRegrasRepasses: m.regras }));
vi.mock("@/repasses/acoes", () => ({ salvarRegrasRepassesAcao: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  m.db.mockReturnValue({});
  m.redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
  m.sessao.mockResolvedValue({ papel: "admin", usuarioId: "u", organizacaoId: "org" });
  m.regras.mockResolvedValue({ ...REGRAS_REPASSES_PADRAO, diaSemanal: 3, diasQuinzenal: [5, 20], padraoPorContrato: { ...REGRAS_REPASSES_PADRAO.padraoPorContrato, marketplace: "semanal" } });
});
const html = async () => renderToStaticMarkup(await Page());

it.each(["operacao", "proprietario", "limpeza"])("%s não abre a aba", async (papel) => {
  m.sessao.mockResolvedValue({ papel, usuarioId: "u", organizacaoId: "org" });
  await expect(html()).rejects.toThrow("NEXT_REDIRECT");
  expect(m.redirect).toHaveBeenCalledWith("/painel/configuracoes");
  expect(m.regras).not.toHaveBeenCalled();
});
it("admin vê os dias e o padrão por contrato gravados", async () => {
  const h = await html();
  expect(m.regras).toHaveBeenCalledWith({}, "org");
  expect(h).toContain('<option value="3" selected="">quarta-feira</option>');
  expect(h).toMatch(/<input[^>]*name="diaQuinzenal1"[^>]*value="5"/);
  expect(h).toMatch(/<input[^>]*name="diaQuinzenal2"[^>]*value="20"/);
  expect(h).toContain('name="padrao_marketplace"');
  expect(h).toContain('<option value="semanal" selected="">Semanal</option>');
  expect(h).toContain("Financeiro → Repasses");
});
