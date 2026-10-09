import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { PagamentoDoPainel } from "@/pagamentos/consultas";

const m = vi.hoisted(() => ({ sessao: vi.fn(), reserva: vi.fn(), pagamentos: vi.fn(), lancamentos: vi.fn(), recebimentos: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, redirect: vi.fn() }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/reservas/repositorio", () => ({ obterReserva: m.reserva }));
vi.mock("@/reservas/horarios", async (original) => ({ ...(await original<typeof import("@/reservas/horarios")>()), lerHorariosReservas: async () => new Map() }));
vi.mock("@/imoveis/repositorio", () => ({ obterImovel: async () => ({ id: "im", codigo: "403", nome: "Studio Fictício" }) }));
vi.mock("@/auditoria/auditoria", async (original) => ({ ...(await original<typeof import("@/auditoria/auditoria")>()), historicoDe: async () => [] }));
vi.mock("@/financeiro/ledger", () => ({ listarLancamentos: m.lancamentos }));
vi.mock("@/imoveis/recebimento", () => ({ lerRecebimento: async () => ({}) }));
vi.mock("@/configuracoes/regras-financeiras", () => ({ lerRegrasFinanceiras: async () => ({ recebimento: { site: "empresa" } }) }));
vi.mock("@/repasses/recebimentos", () => ({ recebimentosDaReserva: m.recebimentos, recebidoPorReserva: async () => new Map() }));
vi.mock("@/pagamentos/consultas", () => ({ pagamentosDaReserva: m.pagamentos }));
vi.mock("@/reservas/acoes", () => ({ cancelar: vi.fn(), confirmar: vi.fn(), resolverConferenciaAcao: vi.fn(), salvarEmailHospedeAcao: vi.fn() }));
vi.mock("@/reservas/horarios-acoes", () => ({ alterarHorarioAcao: vi.fn() }));
vi.mock("@/repasses/acoes", () => ({ estornarRecebimentoAcao: vi.fn(), registrarRecebimentoAcao: vi.fn() }));
vi.mock("@/pagamentos/acoes-painel", () => ({ conferirAgoraAcao: vi.fn(), devolverAcao: vi.fn(), devolucaoPorForaAcao: vi.fn(), registrarLiberacaoAcao: vi.fn(), estornarLiberacaoAcao: vi.fn() }));
import Page from "./page";

const reserva = {
  id: "r1",
  codigo: "SCL-TESTE1",
  imovelId: "im",
  origem: "site",
  estado: "confirmada",
  checkin: "2026-10-12",
  checkout: "2026-10-15",
  reservadaEm: new Date("2026-10-01T15:00:00Z"),
  criadoEm: new Date("2026-10-01T15:00:00Z"),
  hospedes: 4,
  hospedeNome: "Visitante Fictício",
  hospedeEmail: "visitante@example.com",
  hospedeTelefone: "",
  hospedeOrigem: "",
  valorBruto: 182400,
  taxaCanal: 1806,
  valorLiquido: 180594,
  recebimento: null,
  observacoes: "",
  codigoCanal: "",
  divergenciaEm: null,
  conferenciaResolvidaEm: null,
};
const pagamento: PagamentoDoPainel = {
  id: "11111111-1111-4111-8111-111111111111",
  cotacaoId: "c",
  reservaId: "r1",
  forma: "pix",
  situacao: "aprovado",
  ambiente: "teste",
  aoVivo: false,
  valor: 182400,
  valorPago: 182400,
  taxa: 1806,
  liquido: 180594,
  liberacaoPrevistaEm: new Date("2026-10-20T15:00:00Z"),
  liberacaoConfirmadaEm: null,
  liberacaoOrigem: null,
  pixExpiraEm: null,
  aprovadoEm: new Date("2026-10-01T15:05:00Z"),
  consultadoEm: null,
  criadoEm: new Date("2026-10-01T15:00:00Z"),
  desfecho: "reserva",
  desfechoEm: new Date("2026-10-01T15:05:00Z"),
  motivoSemReserva: null,
  motivoSemReservaTexto: null,
  avisos: [],
  devolucao: null,
  pedeAtencao: false,
  acoes: { conferir: true, devolver: false, devolucaoPorFora: false, registrarLiberacao: true, estornarLiberacao: false },
};
beforeEach(() => {
  vi.clearAllMocks();
  m.reserva.mockResolvedValue(reserva);
  m.pagamentos.mockResolvedValue([pagamento]);
  m.lancamentos.mockResolvedValue([]);
  m.recebimentos.mockResolvedValue([]);
});
const html = async () => renderToStaticMarkup(await Page({ params: Promise.resolve({ id: "r1" }), searchParams: Promise.resolve({}) } as PageProps<"/painel/reservas/[id]">));

it("operação (lê reservas, não o financeiro): vê o quadro com situação e o selo de teste, sem valores nem ações", async () => {
  m.sessao.mockResolvedValue({ papel: "operacao", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  const h = await html();
  expect(m.pagamentos).toHaveBeenCalledWith({}, "org", "r1");
  expect(h).toContain('aria-label="Pagamento no site"');
  expect(h).toContain("Aprovado: confirmou a reserva");
  expect(h).toContain("pagamento de teste");
  expect(h).not.toContain("Taxa do Mercado Pago");
  expect(h).not.toContain("Registrar liberação");
  expect(h).not.toContain("Conferir agora");
});

it("admin (lê e edita o financeiro): valores e as ações que o pagamento permite", async () => {
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  const h = await html();
  expect(h).toContain("Taxa do Mercado Pago");
  expect(h).toContain("R$ 18,06");
  expect(h).toContain("Conferir agora");
  expect(h).toContain("Registrar liberação");
});

it("reserva sem pagamento no site: nenhum quadro", async () => {
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  m.pagamentos.mockResolvedValue([]);
  expect(await html()).not.toContain('aria-label="Pagamento no site"');
});

it("reserva de outra empresa (não encontrada pela sessão): 404 sem ler pagamentos", async () => {
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  m.reserva.mockResolvedValue(null);
  await expect(html()).rejects.toThrow("NEXT_NOT_FOUND");
  expect(m.pagamentos).not.toHaveBeenCalled();
});
