import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { LinhaPagamento } from "@/pagamentos/consultas";

const m = vi.hoisted(() => ({ sessao: vi.fn(), listar: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/pagamentos/consultas", async (original) => ({ ...(await original<typeof import("@/pagamentos/consultas")>()), listarPagamentos: m.listar }));
vi.mock("@/pagamentos/acoes-painel", () => ({ conferirAgoraAcao: vi.fn() }));
import Page from "./page";

const sem = { conferir: true, devolver: true, devolucaoPorFora: true, registrarLiberacao: false, estornarLiberacao: false, registrarTaxaPerdida: false };
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
  alteracaoEm: null,
  disputa: null,
  emDisputa: false,
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
  expect(m.listar).toHaveBeenCalledWith({}, "org", { de, ate, atencao: false, disputa: false });
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
  expect(m.listar).toHaveBeenCalledWith({}, "org", { de: "2026-09-01", ate: "2026-09-30", atencao: true, disputa: false });
  await html({ de: "lixo", ate: "2026-02-31" });
  expect(m.listar).toHaveBeenLastCalledWith({}, "org", expect.objectContaining({ ate: hoje(), atencao: false }));
  m.listar.mockResolvedValue([]);
  expect(await html({ atencao: "1" })).toContain("Nenhum pagamento do site pedindo atenção.");
});

it("M8.2c: reserva paga cancelada pela política — o desfecho diz o que houve com a devolução; o devolvido em parte sem reserva diz como devolver o restante (M8.2d)", async () => {
  const cancelada = (estado: "cancelada_devolucao_pedida" | "cancelada_sem_devolucao" | "cancelada_devolvida") => ({
    ...linha,
    id: `${estado}-1`,
    desfecho: "reserva" as const,
    motivoSemReserva: null,
    motivoSemReservaTexto: null,
    avisos: [],
    reservaEstado: "cancelada",
    cancelada: { estado, estornoPelaEquipe: false },
  });
  m.listar.mockResolvedValue([cancelada("cancelada_devolucao_pedida"), cancelada("cancelada_sem_devolucao"), cancelada("cancelada_devolvida")]);
  const h = await html();
  expect(h).toContain("Reserva cancelada: devolução pedida");
  expect(h).toContain("Reserva cancelada: sem devolução (valor retido)");
  expect(h).toContain("Reserva cancelada: devolvida");
  m.listar.mockResolvedValue([{ ...linha, situacao: "devolvido_parcial", motivoSemReservaTexto: "Chegou já devolvido em parte." }]);
  const parcial = await html();
  expect(parcial).toContain("Sem reserva: Chegou já devolvido em parte. Devolva o restante pelo quadro do pagamento.");
  expect(parcial).not.toMatch(/M8\.2/);
});

it("M8.2d: o pagamento da diferença de uma alteração aplicada diz de qual alteração é", async () => {
  m.listar.mockResolvedValue([{ ...linha, id: "dif-1", desfecho: "alteracao" as const, motivoSemReserva: null, motivoSemReservaTexto: null, avisos: [], alteracaoId: "a1", alteracaoEm: new Date("2026-10-01T15:00:00Z") }]);
  expect(await html()).toContain("Diferença da alteração de 01/10");
  m.listar.mockResolvedValue([{ ...linha, id: "dif-2", desfecho: "alteracao" as const, motivoSemReserva: null, motivoSemReservaTexto: null, avisos: [], alteracaoId: "a1", alteracaoEm: null }]);
  expect(await html()).toContain("Diferença de uma alteração da reserva");
});

it("M8.2e: filtro Com disputa (de qualquer data), a coluna Disputa com o link para a reserva e o desfecho 'Reserva (pagamento em disputa)'", async () => {
  m.listar.mockResolvedValue([
    { ...linha, id: "disp-1", desfecho: "reserva" as const, situacao: "contestado" as const, motivoSemReserva: null, motivoSemReservaTexto: null, avisos: [], disputa: "Contestação no cartão: aberta", emDisputa: true },
  ]);
  const h = await html({ disputa: "1" });
  expect(m.listar).toHaveBeenCalledWith({}, "org", expect.objectContaining({ disputa: true }));
  expect(h).toContain("<th>Disputa</th>");
  expect(h).toContain("Contestação no cartão: aberta");
  expect(h).toContain("Reserva (pagamento em disputa)");
  expect(h).toContain('name="disputa"');
  m.listar.mockResolvedValue([]);
  expect(await html({ disputa: "1" })).toContain("Nenhum pagamento do site com disputa pedindo a equipe.");
  // Sem reserva e contestado: o texto aponta para o quadro (nunca "se resolve pelo painel do Mercado Pago").
  m.listar.mockResolvedValue([{ ...linha, situacao: "contestado" as const, motivoSemReservaTexto: "Chegou contestado." }]);
  const semReserva = await html();
  expect(semReserva).toContain("Acompanhe a disputa no quadro do pagamento.");
  expect(semReserva).not.toContain("se resolve pelo painel");
});
