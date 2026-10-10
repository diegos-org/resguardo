import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import type { CancelamentoNoPortal } from "@/hospede/cancelamento";
import type { ReservaDoHospede } from "@/hospede/portal";

const m = vi.hoisted(() => ({ email: vi.fn(), site: vi.fn(), reservas: vi.fn(), cancelamento: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("@/hospede/sessao-atual", () => ({ emailDoHospede: m.email }));
vi.mock("@/site/pagina", () => ({ carregarSite: m.site, metadadosDoSite: vi.fn() }));
vi.mock("@/hospede/portal", async (original) => ({ ...(await original<typeof import("@/hospede/portal")>()), reservasDoHospede: m.reservas }));
vi.mock("@/hospede/cancelamento", async (original) => ({ ...(await original<typeof import("@/hospede/cancelamento")>()), cancelamentoNoPortal: m.cancelamento }));
vi.mock("@/hospede/acoes", () => ({ pedirCancelamentoAcao: vi.fn(), sairHospede: vi.fn() }));
import { perguntaDoPedidoDeCancelamento } from "@/hospede/cancelamento";
import Page from "./page";

const conteudo = { organizacaoId: "org", nomeEmpresa: "Sua Casa Exemplo", textos: { ...TEXTOS_SITE_INICIAIS }, whatsapp: "5521900000000", email: "", imagens: { capa: null, marca: "/marca.png" } };
const reserva: ReservaDoHospede = {
  codigo: "SCL-TESTE1",
  imovel: "Studio Exemplo",
  bairro: "Leblon",
  cidade: "Rio de Janeiro",
  checkin: "2026-11-09",
  checkout: "2026-11-12",
  noites: 3,
  hospedes: 2,
  nomeHospede: "Visitante Fictício",
  entradaAPartirDe: "15:00",
  saidaAte: "11:00",
  encerrada: false,
  instrucoes: { liberadas: false, liberaEm: new Date("2026-11-07T13:00:00Z"), dia: "2026-11-07" },
  contato: { empresa: "Sua Casa Exemplo", whatsapp: "5521900000000", email: "contato@example.com" },
};
const cancelamento = (over: Partial<CancelamentoNoPortal> = {}): CancelamentoNoPortal => ({
  podePedir: true,
  pedidoEm: null,
  integralAte: "2026-10-26",
  arrependimentoAte: "2026-10-08",
  arrependimentoAteEntrada: true,
  entradaEm: new Date("2099-11-09T18:00:00Z"),
  direitoAgora: "integral",
  semPolitica: false,
  linkCotacao: "/reservar/COT-ABCDEFGH",
  ...over,
});
const html = async (busca: Record<string, string> = {}) => renderToStaticMarkup(await Page({ params: Promise.resolve({}), searchParams: Promise.resolve(busca) } as PageProps<"/hospede">));

beforeEach(() => {
  vi.clearAllMocks();
  m.email.mockResolvedValue("visitante@example.com");
  m.site.mockResolvedValue({ db: {}, conteudo });
  m.reservas.mockResolvedValue([reserva]);
  m.cancelamento.mockResolvedValue(cancelamento());
});

describe("Minha reserva: pedir o cancelamento (M8.2c)", () => {
  it("sem sessão do portal: vai para a entrada, sem ler nada", async () => {
    m.email.mockResolvedValue(null);
    await expect(html()).rejects.toThrow("REDIRECT /hospede/entrar");
    expect(m.cancelamento).not.toHaveBeenCalled();
  });

  it("reserva paga pelo site antes da entrada: o quadro com a política aceita (o que vale agora) e o botão com confirmação; nunca valores", async () => {
    const h = await html();
    expect(m.cancelamento).toHaveBeenCalledWith({}, "org", "visitante@example.com", "SCL-TESTE1", expect.any(Date));
    expect(h).toContain("Cancelar a reserva");
    expect(h).toContain(TEXTOS_SITE_INICIAIS.cancelamentoMinhaReservaIntro);
    expect(h).toContain("Pela Política de cancelamento que você aceitou: pedidos até 26/10 (23h59) têm devolução integral; depois disso, não há devolução. Pedido feito agora: devolução integral.");
    expect(h).toContain("Pedir o cancelamento");
    expect(h).toContain('name="reserva" value="SCL-TESTE1"');
    expect(h).not.toContain("R$");
  });

  it("o arrependimento só aparece quando vai além do prazo do reembolso integral (e diz 'até a entrada' pela versão aceita)", async () => {
    m.cancelamento.mockResolvedValue(cancelamento({ integralAte: "2026-10-01", arrependimentoAte: "2026-10-08", direitoAgora: "nenhum" }));
    let h = await html();
    expect(h).toContain("depois disso, não há devolução, salvo o arrependimento até 08/10 ou até a entrada, o que vier antes. Pedido feito agora: sem devolução pela política.");
    m.cancelamento.mockResolvedValue(cancelamento({ integralAte: "2026-10-01", arrependimentoAte: "2026-10-08", arrependimentoAteEntrada: false }));
    h = await html();
    expect(h).toContain("salvo o arrependimento até 08/10. Pedido feito agora");
  });

  it("sem política aceita: a equipe confirma o valor por escrito", async () => {
    m.cancelamento.mockResolvedValue(cancelamento({ semPolitica: true, integralAte: null, arrependimentoAte: null, direitoAgora: null }));
    const h = await html();
    expect(h).toContain("A equipe confirma com você, por escrito, o valor da devolução.");
    expect(h).not.toContain("Pela Política de cancelamento");
    // Nem a pergunta do botão nem o recibo dizem "a política que você aceitou".
    expect(perguntaDoPedidoDeCancelamento("SCL-TESTE1", true)).not.toContain("que você aceitou");
    expect(perguntaDoPedidoDeCancelamento("SCL-TESTE1", false)).toContain("pela política que você aceitou ao pagar");
    m.cancelamento.mockResolvedValue(cancelamento({ semPolitica: true, integralAte: null, arrependimentoAte: null, direitoAgora: null, podePedir: false, pedidoEm: new Date("2026-10-10T13:00:00Z") }));
    const recibo = await html();
    expect(recibo).toContain("Pedido de cancelamento recebido em 10/10 às 10:00 (horário de Brasília). A equipe confirma com você, por escrito, o valor da devolução.");
    expect(recibo).not.toContain(TEXTOS_SITE_INICIAIS.cancelamentoPedidoRecebido);
  });

  it("paga já depois do prazo do reembolso integral: nenhum prazo que nunca valeu, só o arrependimento", async () => {
    m.cancelamento.mockResolvedValue(cancelamento({ integralAte: "2026-10-06", arrependimentoAte: "2026-10-17", direitoAgora: "integral" }));
    const h = await html();
    expect(h).toContain("Pela Política de cancelamento que você aceitou, esta reserva foi paga quando o prazo de devolução integral já tinha passado: há devolução integral só no arrependimento, até 17/10 ou até a entrada, o que vier antes. Pedido feito agora: devolução integral.");
    expect(h).not.toContain("pedidos até 06/10");
  });

  it("pedido já recebido: a data e a hora (Brasília), a frase editável e o link para a página da reserva; sem botão", async () => {
    m.cancelamento.mockResolvedValue(cancelamento({ podePedir: false, pedidoEm: new Date("2026-10-10T13:00:00Z") }));
    const h = await html({ pedido: "ok" });
    expect(h).toContain("Pedido de cancelamento registrado.");
    expect(h).toContain(`Pedido de cancelamento recebido em 10/10 às 10:00 (horário de Brasília). ${TEXTOS_SITE_INICIAIS.cancelamentoPedidoRecebido}`);
    expect(h).toContain('href="/reservar/COT-ABCDEFGH"');
    expect(h).not.toContain("Pedir o cancelamento</button>");
  });

  it("depois da entrada: sem botão (saída antecipada não é cancelamento); reserva que não é paga pelo site (ou botão desligado): nada", async () => {
    m.cancelamento.mockResolvedValue(cancelamento({ podePedir: false, entradaEm: new Date("2020-01-01T18:00:00Z") }));
    expect(await html()).toContain("A estadia já começou: para cancelar, fale com a equipe.");
    m.cancelamento.mockResolvedValue(null);
    expect(await html()).not.toContain("Cancelar a reserva");
    m.cancelamento.mockResolvedValue(cancelamento({ podePedir: false }));
    expect(await html()).not.toContain("Cancelar a reserva");
  });

  it("a recusa volta por um código conhecido, com o texto fixo; o que não é conhecido não aparece", async () => {
    expect(await html({ erro: "cancelamento-estadia" })).toContain("A estadia já começou: para cancelar, fale com a equipe.");
    expect(await html({ erro: "cancelamento" })).toContain("Não foi possível registrar o pedido por aqui: fale com a equipe.");
    expect(await html({ erro: "<b>oi</b>" })).not.toContain("oi</b>");
  });
});
