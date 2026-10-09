import { beforeEach, expect, it, vi } from "vitest";
import { cancelar } from "./acoes";
const m = vi.hoisted(() => ({ sessao: vi.fn(), cancelar: vi.fn(), revalidar: vi.fn(), redirecionar: vi.fn() }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("./repositorio", () => ({ tentarCancelarReserva: m.cancelar }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidar }));
vi.mock("next/navigation", () => ({ redirect: m.redirecionar }));
beforeEach(() => {
  vi.clearAllMocks();
  m.sessao.mockResolvedValue({ papel: "operacao", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
});

it("cancelar recusado (pagamento do site em andamento, M8.2a): a ficha mostra o motivo", async () => {
  m.cancelar.mockResolvedValue({ ok: false, aviso: "Não cancelada: há um Pix do site em andamento até 12:30." });
  const f = new FormData();
  f.set("id", "r1");
  await cancelar(f);
  expect(m.cancelar).toHaveBeenCalledWith({}, "org", "r1", "u");
  expect(m.redirecionar).toHaveBeenCalledWith(`/painel/reservas/r1?erro=${encodeURIComponent("Não cancelada: há um Pix do site em andamento até 12:30.")}`);
});

it("cancelar que deu certo não redireciona com erro", async () => {
  m.cancelar.mockResolvedValue({ ok: true });
  const f = new FormData();
  f.set("id", "r1");
  await cancelar(f);
  expect(m.redirecionar).not.toHaveBeenCalled();
  expect(m.revalidar).toHaveBeenCalledWith("/painel/reservas");
});
