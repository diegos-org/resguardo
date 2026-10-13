import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ email: vi.fn(), org: vi.fn(), pedir: vi.fn(), avisar: vi.fn(), after: vi.fn(), revalidar: vi.fn(), correio: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: async () => new Headers({ host: "preview.example.com", "x-forwarded-proto": "https" }) }));
vi.mock("next/server", () => ({ after: m.after }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidar }));
vi.mock("@/db/client", () => ({ getDb: () => ({ banco: true }) }));
vi.mock("@/email/correio", () => ({ correioDoAmbiente: m.correio }));
vi.mock("@/site/site", () => ({ organizacaoDoSite: m.org }));
vi.mock("./sessao-atual", () => ({ emailDoHospede: m.email }));
vi.mock("./cancelamento", async (original) => ({ ...(await original<typeof import("./cancelamento")>()), pedirCancelamentoPeloHospede: m.pedir, avisarEquipeDoPedido: m.avisar }));
import { pedirCancelamentoAcao } from "./acoes";
import { ESTADIA_COMECOU, JA_CANCELADA, NAO_DA, PEDIDO_DESLIGADO, PEDIDO_OCUPADO } from "./cancelamento";

const form = (v: Record<string, string>) => {
  const f = new FormData();
  for (const [k, x] of Object.entries(v)) f.set(k, x);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  m.email.mockResolvedValue("visitante@example.com");
  m.org.mockResolvedValue("org");
  m.correio.mockReturnValue({ falso: true });
});

describe("pedir o cancelamento em Minha reserva (M8.2c)", () => {
  it("sem a sessão do portal (código do e-mail): vai para a entrada; nada é pedido", async () => {
    m.email.mockResolvedValue(null);
    await expect(pedirCancelamentoAcao(form({ reserva: "SCL-TESTE1" }))).rejects.toThrow("REDIRECT /hospede/entrar");
    expect(m.pedir).not.toHaveBeenCalled();
  });

  it("o e-mail vem só da sessão e a empresa só do site; código fora do formato nem chega ao domínio", async () => {
    await expect(pedirCancelamentoAcao(form({ reserva: "x' or 1=1", email: "outro@example.com" }))).rejects.toThrow("REDIRECT /hospede?erro=cancelamento");
    expect(m.pedir).not.toHaveBeenCalled();
    m.pedir.mockResolvedValue({ ok: true, recebidoEm: new Date(), cancelamentoId: "c1", novo: true });
    await expect(pedirCancelamentoAcao(form({ reserva: "SCL-TESTE1", email: "outro@example.com" }))).rejects.toThrow("REDIRECT /hospede?pedido=ok");
    expect(m.pedir).toHaveBeenCalledWith({ banco: true }, "org", "visitante@example.com", "SCL-TESTE1", expect.any(Date));
    expect(m.revalidar).toHaveBeenCalledWith("/hospede");
  });

  it("pedido novo: a equipe é avisada depois da resposta, com o link dos pedidos no painel; repetido, nenhum e-mail", async () => {
    m.pedir.mockResolvedValue({ ok: true, recebidoEm: new Date(), cancelamentoId: "c1", novo: true });
    await expect(pedirCancelamentoAcao(form({ reserva: "SCL-TESTE1" }))).rejects.toThrow("REDIRECT /hospede?pedido=ok");
    expect(m.after).toHaveBeenCalledTimes(1);
    expect(m.avisar).not.toHaveBeenCalled();
    await m.after.mock.calls[0][0]();
    expect(m.avisar).toHaveBeenCalledWith({ banco: true }, "org", "c1", { falso: true }, "https://preview.example.com/painel/reservas?cancelamento=pedido");
    m.after.mockClear();
    m.pedir.mockResolvedValue({ ok: true, recebidoEm: new Date(), cancelamentoId: "c1", novo: false });
    await expect(pedirCancelamentoAcao(form({ reserva: "SCL-TESTE1" }))).rejects.toThrow("REDIRECT /hospede?pedido=ok");
    expect(m.after).not.toHaveBeenCalled();
  });

  it("cada recusa do domínio vira um código conhecido no endereço (a página mostra o texto fixo)", async () => {
    const casos: [string, string][] = [
      [PEDIDO_DESLIGADO, "cancelamento-desligado"],
      [ESTADIA_COMECOU, "cancelamento-estadia"],
      [JA_CANCELADA, "cancelamento-cancelada"],
      [PEDIDO_OCUPADO, "cancelamento-ocupado"],
      [NAO_DA, "cancelamento"],
    ];
    for (const [erro, codigo] of casos) {
      m.pedir.mockResolvedValue({ ok: false, erro });
      await expect(pedirCancelamentoAcao(form({ reserva: "SCL-TESTE1" }))).rejects.toThrow(`REDIRECT /hospede?erro=${codigo}`);
    }
    expect(m.after).not.toHaveBeenCalled();
  });

  it("sem a empresa do site: recusa sem pedir", async () => {
    m.org.mockResolvedValue(null);
    await expect(pedirCancelamentoAcao(form({ reserva: "SCL-TESTE1" }))).rejects.toThrow("REDIRECT /hospede?erro=cancelamento");
    expect(m.pedir).not.toHaveBeenCalled();
  });
});
