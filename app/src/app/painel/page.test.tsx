import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ sessao: vi.fn(), dashboard: vi.fn(), conta: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/imoveis/repositorio", () => ({ listarImoveis: async () => [{ id: "im", codigo: "403", nome: "Studio Fictício", ativo: true }] }));
vi.mock("@/painel/dashboard", () => ({ carregarDashboard: m.dashboard, contaDeTesteParaInicio: m.conta }));
import Page from "./page";

const vazio = { ocupacao: [], ocupacaoTotal: { vendidas: 0, disponiveis: 0, taxa: null }, reservasNoPeriodo: 0, proximasEntradas: [], proximasSaidas: [], financeiro: null, porMes: null };
beforeEach(() => {
  vi.clearAllMocks();
  m.conta.mockResolvedValue(false);
  m.dashboard.mockResolvedValue({
    ...vazio,
    alertas: [
      { nivel: "atencao", texto: "1 pagamento(s) do site aprovado(s) sem reserva: devolva ao hóspede (pelo Mercado Pago ou por fora).", link: "/painel/financeiro/pagamentos-site?atencao=1" },
      { nivel: "info", texto: "1 rotina(s) atrasada(s) ou para hoje.", link: "/painel/rotinas" },
    ],
  });
});
const html = async (params: Record<string, string> = {}) => renderToStaticMarkup(await Page({ params: Promise.resolve({}), searchParams: Promise.resolve(params) } as PageProps<"/painel">));

it("quem lê o financeiro recebe os avisos do pagamento no site, com a conta das chaves conferida", async () => {
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  await html();
  expect(m.conta).toHaveBeenCalled();
  expect(m.dashboard).toHaveBeenCalledWith({}, "org", expect.objectContaining({ verPagamentos: true, contaDeTesteMercadoPago: false }));
});

it("operação não recebe os avisos do pagamento e não confere a conta", async () => {
  m.sessao.mockResolvedValue({ papel: "operacao", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  await html();
  expect(m.conta).not.toHaveBeenCalled();
  expect(m.dashboard).toHaveBeenCalledWith({}, "org", expect.objectContaining({ verPagamentos: false, contaDeTesteMercadoPago: null }));
});

it("links dos alertas com os filtros do Início continuam válidos (link que já tem parâmetros ganha &)", async () => {
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  const h = await html({ imovel: "403", ano: "2026", mes: "10" });
  expect(h).toContain('href="/painel/financeiro/pagamentos-site?atencao=1&amp;imovel=403&amp;ano=2026&amp;mes=10"');
  expect(h).toContain('href="/painel/rotinas?imovel=403&amp;ano=2026&amp;mes=10"');
});
