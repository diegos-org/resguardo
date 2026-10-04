import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { PRECOS_MARKETPLACE_PADRAO } from "@/marketplace/precos";
import Page from "./page";
const m = vi.hoisted(() => ({ sessao: vi.fn(), db: vi.fn(), precos: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: m.db }));
vi.mock("@/marketplace/precos-config", () => ({ lerPrecosMarketplace: m.precos }));
vi.mock("@/marketplace/acoes-precos", () => ({ salvarPrecosMarketplaceAcao: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  m.db.mockReturnValue({});
  m.redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
  m.sessao.mockResolvedValue({ papel: "admin", usuarioId: "u", organizacaoId: "org" });
  m.precos.mockResolvedValue({ ...PRECOS_MARKETPLACE_PADRAO, taxaPagamentoBp: 398, pesos: { hospede: 2, proprietario: 1, scl: 1 } });
});
const html = async () => renderToStaticMarkup(await Page());

it.each(["operacao", "proprietario", "limpeza"])("%s não abre a aba", async (papel) => {
  m.sessao.mockResolvedValue({ papel, usuarioId: "u", organizacaoId: "org" });
  await expect(html()).rejects.toThrow("NEXT_REDIRECT");
  expect(m.redirect).toHaveBeenCalledWith("/painel/configuracoes");
  expect(m.precos).not.toHaveBeenCalled();
});
it("admin vê as taxas e os pesos gravados, o desconto resultante e a simulação padrão", async () => {
  const h = await html();
  expect(m.precos).toHaveBeenCalledWith({}, "org");
  expect(h).toContain('name="taxaOta"');
  expect(h).toContain('value="3,98"');
  expect(h).toContain('name="pesoHospede"');
  expect(h).toContain('value="2"');
  // Desconto ≈ (16 − 3,98) × 2/4 = 6,01%.
  expect(h).toContain("<strong>6,01%</strong>");
  // Simulação padrão: 3 × R$ 500 + R$ 150 = R$ 1.650 cheio.
  expect(h).toContain("Valor cheio: R$ 1.650,00");
  expect(h).toContain("Site SCL");
});
