import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { LinhaPagamento } from "@/pagamentos/consultas";

const m = vi.hoisted(() => ({ sessao: vi.fn(), listar: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/pagamentos/consultas", () => ({ listarPagamentos: m.listar }));
vi.mock("@/pagamentos/acoes-painel", () => ({ conferirAgoraAcao: vi.fn() }));
import Page from "./page";

const sem = { conferir: true, devolver: true, devolucaoPorFora: true, registrarLiberacao: false, estornarLiberacao: false };
const linha: LinhaPagamento = {
  id: "11111111-1111-4111-8111-111111111111",
  cotacaoId: "c",
  reservaId: "22222222-2222-4222-8222-222222222222",
  forma: "pix",
  situacao: "aprovado",
  ambiente: "teste",
  aoVivo: false,
  valor: 182400,
  valorPago: 182400,
  taxa: null,
  liquido: null,
  liberacaoPrevistaEm: null,
  liberacaoConfirmadaEm: null,
  liberacaoOrigem: null,
  pixExpiraEm: null,
  aprovadoEm: new Date("2026-10-01T15:05:00Z"),
  consultadoEm: null,
  criadoEm: new Date("2026-10-01T15:00:00Z"),
  desfecho: null,
  desfechoEm: null,
  motivoSemReserva: "conflito",
  motivoSemReservaTexto: "As noites ficaram ocupadas por outra reserva ou bloqueio.",
  avisos: ["A devolução pelo Mercado Pago falhou três vezes: tente de novo ou registre a devolução feita por fora."],
  devolucao: null,
  pedeAtencao: true,
  acoes: sem,
  reservaCodigo: "SCL-TESTE1",
  reservaEstado: "pedido",
  imovelCodigo: "403",
  checkin: "2026-10-12",
  checkout: "2026-10-15",
  cotacaoCodigo: "COT1",
};
const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const html = async (params: Record<string, string> = {}) => renderToStaticMarkup(await Page({ params: Promise.resolve({}), searchParams: Promise.resolve(params) } as PageProps<"/painel/financeiro/pagamentos-site">));
beforeEach(() => {
  vi.clearAllMocks();
  m.redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  m.listar.mockResolvedValue([linha]);
});

it.each(["operacao", "limpeza", "proprietario"])("%s não abre a lista (sem financeiro:ler, ou proprietário: a lista é da empresa toda)", async (papel) => {
  m.sessao.mockResolvedValue({ papel, organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  await expect(html()).rejects.toThrow("NEXT_REDIRECT");
  expect(m.redirect).toHaveBeenCalledWith("/painel");
  expect(m.listar).not.toHaveBeenCalled();
});

it("padrão: os últimos 30 dias da empresa da sessão; colunas, link para a reserva, selo de teste e o desfecho", async () => {
  const h = await html();
  const ate = hoje();
  const de = new Date(Date.parse(`${ate}T12:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  expect(m.listar).toHaveBeenCalledWith({}, "org", { de, ate, atencao: false });
  for (const col of ["Data", "Reserva", "Imóvel", "Forma", "Situação", "Valor", "Desfecho"]) expect(h).toContain(`<th>${col}</th>`);
  expect(h).toContain('href="/painel/reservas/22222222-2222-4222-8222-222222222222"');
  expect(h).toContain("SCL-TESTE1");
  expect(h).toContain("12/10 → 15/10");
  expect(h).toContain("R$ 1.824,00");
  expect(h).toContain("teste");
  expect(h).toContain("pede atenção");
  expect(h).toContain("Sem reserva, a devolver: As noites ficaram ocupadas por outra reserva ou bloqueio.");
  expect(h).toContain("falhou três vezes");
  // Quem edita o financeiro tem o "Conferir agora" de todos os pendentes.
  expect(h).toContain("Conferir agora");
});

it("filtro pede atenção e período informado; datas inválidas voltam ao padrão", async () => {
  await html({ de: "2026-09-01", ate: "2026-09-30", atencao: "1" });
  expect(m.listar).toHaveBeenCalledWith({}, "org", { de: "2026-09-01", ate: "2026-09-30", atencao: true });
  await html({ de: "lixo", ate: "2026-02-31" });
  expect(m.listar).toHaveBeenLastCalledWith({}, "org", expect.objectContaining({ ate: hoje(), atencao: false }));
  m.listar.mockResolvedValue([]);
  expect(await html({ atencao: "1" })).toContain("Nenhum pagamento do site pedindo atenção.");
});
