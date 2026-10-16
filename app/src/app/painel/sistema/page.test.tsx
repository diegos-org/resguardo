import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ sessao: vi.fn(), mp: vi.fn(), execute: vi.fn(), redirect: vi.fn(), execucoes: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => ({ execute: m.execute }) }));
vi.mock("@/sistema/automacoes", async (original) => ({ ...(await original<typeof import("@/sistema/automacoes")>()), ultimasExecucoes: m.execucoes }));
vi.mock("@/sistema/regras", () => ({ regrasEmVigor: async () => [] }));
vi.mock("@/configuracoes/regras-financeiras", () => ({ lerRegrasFinanceiras: async () => ({ base: "bruto" }) }));
vi.mock("@/pagamentos/integracao", () => ({ situacaoDoMercadoPago: m.mp }));
import Page from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  m.redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
  m.execute.mockResolvedValue([]);
  m.execucoes.mockResolvedValue(new Map([["pedidos-site", { nome: "pedidos-site", iniciadoEm: new Date("2026-10-08T13:00:00Z"), ok: true, resumo: "Pagamentos: 1 conferido(s)" }]]));
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  m.mp.mockResolvedValue({ situacao: "so_nas_previas", motivo: null, contaDeTeste: null, segredoWebhook: true, ultimoAvisoValidoEm: null, assinaturasRecusadasHoje: 0, enderecoWebhook: "https://scl-reconstrucao.vercel.app/api/pagamentos/mercadopago" });
});

it("operação não abre Sistema", async () => {
  m.sessao.mockResolvedValue({ papel: "operacao", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  await expect(Page()).rejects.toThrow("NEXT_REDIRECT");
  expect(m.mp).not.toHaveBeenCalled();
});

it("Mercado Pago pela mesma função de Integrações e a rotina dos pedidos e pagamentos do site", async () => {
  const h = renderToStaticMarkup(await Page());
  expect(m.mp).toHaveBeenCalledTimes(1);
  expect(h).toContain("Pagamentos (Mercado Pago)");
  expect(h).toContain("o teste do pagamento roda nas prévias da Vercel");
  expect(h).toContain("Pedidos e pagamentos do site");
  expect(h).toContain("Pagamentos: 1 conferido(s)");
});

it("sem banco, a linha do Mercado Pago diz que não foi conferida (sem chamar a função)", async () => {
  m.execute.mockRejectedValue(new Error("fora do ar"));
  const h = renderToStaticMarkup(await Page());
  expect(m.mp).not.toHaveBeenCalled();
  expect(h).toContain("Situação não conferida nesta abertura");
});

it("rotina que não rodou (M8.3a): o resumo com o selo de aviso, não o de falha nem como sucesso", async () => {
  m.execucoes.mockResolvedValue(
    new Map([
      ["sync-beds24", { nome: "sync-beds24", iniciadoEm: new Date("2026-10-16T09:15:00Z"), ok: false, resumo: "Não rodou: envio de reserva do site ao Beds24 em andamento" }],
      ["envio-beds24", { nome: "envio-beds24", iniciadoEm: new Date("2026-10-16T10:00:00Z"), ok: false, resumo: "Falhou: Credencial Beds24 não configurada." }],
    ]),
  );
  const h = renderToStaticMarkup(await Page());
  expect(h).toContain('style="background:var(--scl-aviso-fundo)">Não rodou: envio de reserva do site ao Beds24 em andamento</span>');
  expect(h).toContain('style="background:var(--scl-erro-fundo)">Falhou: Credencial Beds24 não configurada.</span>');
});
