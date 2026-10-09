import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ sessao: vi.fn(), mp: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ orderBy: async () => [] }) }) }) }),
}));
vi.mock("@/beds24/configuracao", () => ({ lerConfigBeds24: async () => ({ automatica: false, desde: "2026-09-28", diasCalendario: 180 }), listarMapeamentosBeds24: async () => [] }));
vi.mock("@/beds24/sincronizacao", () => ({ ultimasSincronizacoes: async () => [] }));
vi.mock("@/components/configuracoes/TestarBeds24", () => ({ TestarBeds24: () => null }));
vi.mock("@/components/configuracoes/SincronizarBeds24", () => ({ SincronizarBeds24: () => null }));
vi.mock("@/pagamentos/integracao", () => ({ situacaoDoMercadoPago: m.mp }));
import Page from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  m.redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  m.mp.mockResolvedValue({
    situacao: "teste",
    motivo: null,
    contaDeTeste: true,
    segredoWebhook: true,
    ultimoAvisoValidoEm: null,
    assinaturasRecusadasHoje: 1,
    enderecoWebhook: "https://scl-reconstrucao.vercel.app/api/pagamentos/mercadopago",
  });
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "TEST-token-secreto-ficticio");
});
afterEach(() => vi.unstubAllEnvs());

it.each(["operacao", "proprietario", "limpeza"])("%s não abre Integrações", async (papel) => {
  m.sessao.mockResolvedValue({ papel, organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  await expect(Page()).rejects.toThrow("NEXT_REDIRECT");
  expect(m.mp).not.toHaveBeenCalled();
});

it("Mercado Pago pela mesma função de Sistema: linha na tabela com as variáveis, o quadro com o endereço e a nota da prévia, sem chave", async () => {
  const h = renderToStaticMarkup(await Page());
  expect(m.mp).toHaveBeenCalledTimes(1);
  expect(h).toContain("Pagamentos (Mercado Pago)");
  expect(h).toContain("conta conferida como de teste");
  expect(h).toContain("MERCADOPAGO_PUBLIC_KEY, MERCADOPAGO_ACCESS_TOKEN e MERCADOPAGO_AMBIENTE");
  expect(h).toContain("MERCADOPAGO_WEBHOOK_SECRET: em Preview e Production");
  expect(h).toContain("https://scl-reconstrucao.vercel.app/api/pagamentos/mercadopago");
  expect(h).toContain("aqui use Conferir agora");
  expect(h).not.toContain("TEST-token-secreto-ficticio");
});
