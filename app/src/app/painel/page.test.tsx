import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ sessao: vi.fn(), dashboard: vi.fn(), conta: vi.fn(), semResposta: vi.fn(), configWhatsapp: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
// O banco é um objeto vazio: qualquer consulta de verdade lançaria (o que prova, na operação, que a contagem não consulta).
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/imoveis/repositorio", () => ({ listarImoveis: async () => [{ id: "im", codigo: "403", nome: "Studio Fictício", ativo: true }] }));
vi.mock("@/painel/dashboard", () => ({ carregarDashboard: m.dashboard, contaDeTesteParaInicio: m.conta }));
// M10.1a: a contagem das conversas sem resposta (simulada; no caso da operação, a função de verdade) e a configuração
// "Quem vê as conversas" que `whatsapp/acesso.ts` lê.
vi.mock("@/whatsapp/conversas", async (original) => ({ ...(await original<typeof import("@/whatsapp/conversas")>()), contarConversasSemResposta: m.semResposta }));
vi.mock("@/whatsapp/configuracao", async (original) => ({ ...(await original<typeof import("@/whatsapp/configuracao")>()), lerConfigWhatsapp: m.configWhatsapp }));
import Page from "./page";

const vazio = { ocupacao: [], ocupacaoTotal: { vendidas: 0, disponiveis: 0, taxa: null }, reservasNoPeriodo: 0, proximasEntradas: [], proximasSaidas: [], financeiro: null, porMes: null };
beforeEach(() => {
  vi.clearAllMocks();
  m.conta.mockResolvedValue(false);
  m.semResposta.mockResolvedValue(0);
  m.configWhatsapp.mockResolvedValue({ wabaId: null, numeroId: null, quemVeConversas: "so_admin" });
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

it("M8.2c e M8.3b: quem edita reservas recebe os avisos do cancelamento e as tarefas das OTAs (sem valores), mesmo sem o financeiro, com o ambiente", async () => {
  m.sessao.mockResolvedValue({ papel: "operacao", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  await html();
  expect(m.dashboard).toHaveBeenLastCalledWith({}, "org", expect.objectContaining({ verCancelamentos: true, verPagamentos: false, env: process.env }));
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  await html();
  expect(m.dashboard).toHaveBeenLastCalledWith({}, "org", expect.objectContaining({ verCancelamentos: true, verPagamentos: true }));
  // Sem reserva:editar (ex.: limpeza), nenhum.
  m.sessao.mockResolvedValue({ papel: "limpeza", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  await html();
  expect(m.dashboard).toHaveBeenLastCalledWith({}, "org", expect.objectContaining({ verCancelamentos: false }));
});
it("M8.3c (bloco G): o link da linha \"Envio de reservas parado\" para Integrações só para quem edita as configurações", async () => {
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  await html();
  expect(m.dashboard).toHaveBeenLastCalledWith({}, "org", expect.objectContaining({ verConfiguracao: true }));
  m.sessao.mockResolvedValue({ papel: "operacao", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  await html();
  expect(m.dashboard).toHaveBeenLastCalledWith({}, "org", expect.objectContaining({ verConfiguracao: false, verCancelamentos: true }));
});


it("M8.2d e M8.3b: a alteração segurada e as tarefas das OTAs aparecem com o link da ficha, sem valores", async () => {
  m.sessao.mockResolvedValue({ papel: "operacao", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  m.dashboard.mockResolvedValue({
    ...vazio,
    alertas: [
      { nivel: "info", texto: "Alteração da reserva SCL-TESTE1: datas seguradas até 13:00, esperando o pagamento da diferença.", link: "/painel/reservas/r1" },
      { nivel: "info", texto: "Reserva SCL-TESTE1, alterada: mude as datas do bloqueio para 12/10 a 16/10 (não apague nem crie outro).", link: "/painel/reservas/r1" },
      { nivel: "info", texto: "1 reserva(s) do site paga(s) (SCL-TESTE2): feche as datas no Beds24 como bloqueio e marque Datas fechadas nas OTAs.", link: "/painel/reservas/r2" },
    ],
  });
  const h = await html();
  expect(h).toContain("Alteração da reserva SCL-TESTE1: datas seguradas até 13:00, esperando o pagamento da diferença.");
  expect(h).toContain("mude as datas do bloqueio para 12/10 a 16/10 (não apague nem crie outro)");
  expect(h).toContain("feche as datas no Beds24 como bloqueio e marque Datas fechadas nas OTAs");
  expect(h).toContain('href="/painel/reservas/r2"');
  expect(h).toContain('href="/painel/reservas/r1"');
  expect(h).not.toContain("R$");
  expect(m.dashboard).toHaveBeenLastCalledWith({}, "org", expect.objectContaining({ verCancelamentos: true }));
});

describe("WhatsApp no Início (M10.1a)", () => {
  it("a página passa ao dashboard o número que contarConversasSemResposta(db, sessao) devolveu; a conta do WhatsApp só para quem edita as configurações", async () => {
    m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
    m.semResposta.mockResolvedValue(3);
    await html();
    expect(m.semResposta).toHaveBeenCalledWith({}, expect.objectContaining({ organizacaoId: "org", papel: "admin" }));
    expect(m.dashboard).toHaveBeenLastCalledWith({}, "org", expect.objectContaining({ conversasSemResposta: 3, verContaWhatsapp: true }));
    m.sessao.mockResolvedValue({ papel: "operacao", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
    await html();
    expect(m.dashboard).toHaveBeenLastCalledWith({}, "org", expect.objectContaining({ verContaWhatsapp: false }));
  });

  it("o aviso das conversas sem resposta aparece com o link do filtro (os filtros do Início vão junto e a caixa de entrada os ignora)", async () => {
    m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
    m.dashboard.mockResolvedValue({ ...vazio, alertas: [{ nivel: "info", texto: "2 conversa(s) do WhatsApp sem resposta.", link: "/painel/mensagens?filtro=sem_resposta" }] });
    const h = await html({ imovel: "403" });
    expect(h).toContain("2 conversa(s) do WhatsApp sem resposta.");
    expect(h).toContain('href="/painel/mensagens?filtro=sem_resposta&amp;imovel=403"');
  });

  it("operação com o padrão só o admin: a contagem de verdade devolve 0 sem consultar o banco (um objeto vazio), e o Início não mostra a linha", async () => {
    const real = await vi.importActual<typeof import("@/whatsapp/conversas")>("@/whatsapp/conversas");
    m.semResposta.mockImplementation(real.contarConversasSemResposta);
    m.sessao.mockResolvedValue({ papel: "operacao", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
    await html();
    expect(m.configWhatsapp).toHaveBeenCalledWith({}, "org");
    expect(await m.semResposta.mock.results[0].value).toBe(0);
    expect(m.dashboard).toHaveBeenLastCalledWith({}, "org", expect.objectContaining({ conversasSemResposta: 0, verContaWhatsapp: false }));
  });

  it.each(["proprietario", "limpeza"])("%s: a contagem de verdade devolve 0 sem ler nem a configuração, com qualquer valor dela", async (papel) => {
    const real = await vi.importActual<typeof import("@/whatsapp/conversas")>("@/whatsapp/conversas");
    m.semResposta.mockImplementation(real.contarConversasSemResposta);
    m.configWhatsapp.mockResolvedValue({ wabaId: null, numeroId: null, quemVeConversas: "admin_e_operacao" });
    m.sessao.mockResolvedValue({ papel, organizacaoId: "org", usuarioId: "u", imovelIds: ["im"] });
    await html();
    expect(m.configWhatsapp).not.toHaveBeenCalled();
    expect(m.dashboard).toHaveBeenLastCalledWith({}, "org", expect.objectContaining({ conversasSemResposta: 0, verContaWhatsapp: false }));
  });
});
