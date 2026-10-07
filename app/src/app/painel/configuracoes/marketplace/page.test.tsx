import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { PRECOS_MARKETPLACE_PADRAO } from "@/marketplace/precos";
import Page from "./page";
const m = vi.hoisted(() => ({ sessao: vi.fn(), db: vi.fn(), precos: vi.fn(), antigo: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: m.db }));
vi.mock("@/marketplace/precos-config", () => ({ lerPrecosMarketplace: m.precos, pesosNoPadraoAntigo: m.antigo }));
vi.mock("@/marketplace/acoes-precos", () => ({ salvarPrecosMarketplaceAcao: vi.fn(), usarPesosPadraoAcao: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  m.db.mockReturnValue({});
  m.redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
  m.sessao.mockResolvedValue({ papel: "admin", usuarioId: "u", organizacaoId: "org" });
  m.precos.mockResolvedValue({ ...PRECOS_MARKETPLACE_PADRAO, taxaPagamentoBp: 398, pesos: { hospede: 2, proprietario: 1, scl: 1 } });
  m.antigo.mockResolvedValue(false);
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

it("pesos gravados no padrão antigo (1/1/1): avisa e oferece o novo, sem trocar sozinho (M12.5)", async () => {
  expect(await html()).not.toContain("padrão antigo");
  m.antigo.mockResolvedValue(true);
  m.precos.mockResolvedValue({ ...PRECOS_MARKETPLACE_PADRAO, pesos: { hospede: 1, proprietario: 1, scl: 1 } });
  const h = await html();
  expect(h).toContain("Os pesos gravados aqui são o padrão antigo (1/1/1, partes iguais)");
  expect(h).toContain("Usar o padrão novo");
  // O formulário continua mostrando o que está gravado.
  expect(h).toContain("<strong>4%</strong>");
});

it("o formulário recomeça quando os valores gravados mudam (ex.: depois de \"Usar o padrão novo\"), em vez de guardar os antigos", async () => {
  const chave = async () => {
    const filhos = (await Page()).props.children as unknown[];
    const form = filhos.find((f) => (f as { props?: { salvar?: unknown } })?.props?.salvar) as { key: string | null };
    return form.key;
  };
  m.precos.mockResolvedValue({ ...PRECOS_MARKETPLACE_PADRAO, pesos: { hospede: 1, proprietario: 1, scl: 1 } });
  const antes = await chave();
  m.precos.mockResolvedValue({ ...PRECOS_MARKETPLACE_PADRAO });
  const depois = await chave();
  expect(antes).toBeTruthy();
  expect(depois).not.toBe(antes);
});
