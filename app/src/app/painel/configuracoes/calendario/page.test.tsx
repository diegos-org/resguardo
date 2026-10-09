import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { REGRAS_CALENDARIO_PADRAO } from "@/calendario/regras-config";
import Page from "./page";
const m = vi.hoisted(() => ({ sessao: vi.fn(), db: vi.fn(), imoveis: vi.fn(), regras: vi.fn(), mapas: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: m.db }));
vi.mock("@/imoveis/repositorio", () => ({ listarImoveis: m.imoveis }));
vi.mock("@/imoveis/detalhes", () => ({ fontesDePrecosDosImoveis: async () => new Map([["ib", "beds24"]]) }));
vi.mock("@/beds24/configuracao", () => ({ listarMapeamentosBeds24: m.mapas }));
vi.mock("@/calendario/regras-config", async (orig) => ({ ...(await orig<typeof import("@/calendario/regras-config")>()), lerRegrasCalendario: m.regras }));
vi.mock("@/calendario/acoes", () => ({ novoEventoAcao: vi.fn(), removerEventoAcao: vi.fn(), salvarRegrasCalendarioAcao: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  m.db.mockReturnValue({});
  m.redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
  m.sessao.mockResolvedValue({ papel: "admin", usuarioId: "u", organizacaoId: "org" });
  m.imoveis.mockResolvedValue([{ id: "i103", codigo: "103", nome: "Boutique" }, { id: "ib", codigo: "buzios", nome: "Búzios" }]);
  m.mapas.mockResolvedValue([{ id: "m", imovelId: "i103", codigo: "103", ativo: true, propertyId: "10", roomId: "20" }]);
  m.regras.mockResolvedValue({ ...REGRAS_CALENDARIO_PADRAO, feriados: [{ data: "2026-11-02", nome: "Finados" }], eventos: [{ id: "e", nome: "Carnaval", inicio: "2027-02-08", fim: "2027-02-17", multiplicador: 400, estadiaMinima: 5, todosImoveis: false, imoveis: ["i103"] }], envio: { imoveis: ["i103"], automatico: false } });
});
afterEach(() => vi.unstubAllEnvs());
const html = async () => renderToStaticMarkup(await Page());

it.each(["operacao", "proprietario", "limpeza"])("%s não abre a aba", async (papel) => {
  m.sessao.mockResolvedValue({ papel, usuarioId: "u", organizacaoId: "org" });
  await expect(html()).rejects.toThrow("NEXT_REDIRECT");
  expect(m.redirect).toHaveBeenCalledWith("/painel/configuracoes");
  expect(m.regras).not.toHaveBeenCalled();
});
it("admin vê as regras, feriados, eventos, imóveis com vínculo e o sinal da Vercel", async () => {
  vi.stubEnv("BEDS24_ESCRITA", "desligada");
  const h = await html();
  expect(h).toContain("02/11/2026 Finados");
  expect(h).toContain("Carnaval");
  expect(h).toContain("4×");
  expect(h).toContain("buzios (sem vínculo Beds24) (preços do Beds24: o SCL envia só calendário)");
  expect(h).toContain("Sinal de escrita na Vercel: <strong>desligado</strong>");
  expect(h).toContain('name="envioImoveis" checked="" value="i103"');
  expect(h).toContain('name="faixa2Pct"');
  // M8.2a: perto do prazo de "segurar as datas", quanto cada Pix segura.
  expect(h).toContain("Com o pagamento no site ligado, cada Pix segura as datas por pelo menos 30 minutos (até 3 por cotação, um de cada vez).");
});
