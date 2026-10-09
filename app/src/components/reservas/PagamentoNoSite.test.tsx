import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PagamentoDoPainel } from "@/pagamentos/consultas";
vi.mock("@/pagamentos/acoes-painel", () => ({ conferirAgoraAcao: vi.fn(), devolverAcao: vi.fn(), devolucaoPorForaAcao: vi.fn(), registrarLiberacaoAcao: vi.fn(), estornarLiberacaoAcao: vi.fn() }));
import { PagamentoNoSite, situacaoEmPalavras } from "./PagamentoNoSite";

const sem = { conferir: false, devolver: false, devolucaoPorFora: false, registrarLiberacao: false, estornarLiberacao: false };
const base: PagamentoDoPainel = {
  id: "11111111-1111-4111-8111-111111111111",
  cotacaoId: "c",
  reservaId: "r",
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
  consultadoEm: new Date("2026-10-01T15:06:00Z"),
  criadoEm: new Date("2026-10-01T15:00:00Z"),
  desfecho: "reserva",
  desfechoEm: new Date("2026-10-01T15:05:00Z"),
  motivoSemReserva: null,
  motivoSemReservaTexto: null,
  avisos: [],
  devolucao: null,
  pedeAtencao: false,
  acoes: { ...sem, conferir: true, registrarLiberacao: true },
};
const html = (p: PagamentoDoPainel[], o: { verValores?: boolean; editar?: boolean } = {}) =>
  renderToStaticMarkup(<PagamentoNoSite pagamentos={p} verValores={o.verValores ?? true} editar={o.editar ?? true} hoje="2026-10-09" />);

describe("quadro Pagamento no site", () => {
  it("sem tentativas, nada aparece", () => {
    expect(html([])).toBe("");
  });

  it("quem só lê reservas vê forma, situação em palavras, datas e o selo de teste — nenhum valor nem ação", () => {
    const h = html([base], { verValores: false, editar: false });
    expect(h).toContain("Pagamento no site");
    expect(h).toContain("Pix");
    expect(h).toContain("Aprovado: confirmou a reserva");
    expect(h).toContain("pagamento de teste");
    expect(h).toContain("01/10/2026");
    expect(h).not.toContain("R$");
    expect(h).not.toContain("Taxa do Mercado Pago");
    expect(h).not.toContain("<form");
  });

  it("quem lê o financeiro vê valor, taxa, líquido e a liberação prevista; sem editar, nenhuma ação", () => {
    const h = html([base], { editar: false });
    expect(h).toContain("R$ 1.824,00");
    expect(h).toContain("R$ 18,06");
    expect(h).toContain("R$ 1.805,94");
    expect(h).toContain("o Mercado Pago libera em 20/10/2026 (previsão)");
    expect(h).not.toContain("<form");
  });

  it("quem edita o financeiro vê só as ações que o pagamento permite; registrar liberação pede confirmação, com data até hoje", () => {
    const h = html([base]);
    expect(h).toContain("Conferir agora");
    expect(h).toContain("Registrar liberação");
    expect(h).toContain('max="2026-10-09"');
    expect(h).toContain('value="1805,94"');
    expect(h).not.toContain("Devolver pelo Mercado Pago");
    expect(h).not.toContain("Estornar liberação");
    expect(h).not.toContain("Registrar devolução feita por fora");
    expect(h).toContain(`name="pagamentoId" value="${base.id}"`);
  });

  it("aprovado sem reserva: o motivo, o aviso de devolver e as duas devoluções", () => {
    const p: PagamentoDoPainel = {
      ...base,
      desfecho: null,
      desfechoEm: null,
      motivoSemReserva: "conflito:SCL-123",
      motivoSemReservaTexto: "As noites ficaram ocupadas pela reserva SCL-123.",
      pedeAtencao: true,
      avisos: ["O Mercado Pago marcou este pagamento como real (live_mode) no ambiente de teste."],
      acoes: { ...sem, conferir: true, devolver: true, devolucaoPorFora: true },
    };
    const h = html([p]);
    expect(situacaoEmPalavras(p)).toBe("Aprovado sem reserva: As noites ficaram ocupadas pela reserva SCL-123. O valor precisa ser devolvido ao hóspede.");
    expect(h).toContain("pede atenção");
    expect(h).toContain("live_mode");
    expect(h).toContain("Devolver pelo Mercado Pago");
    expect(h).toContain("Registrar devolução feita por fora");
    expect(h).toContain('name="nota"');
    expect(h).toContain('value="1824,00"');
    expect(h).not.toContain("Registrar liberação");
    // Sem quem lê o financeiro, a pergunta não leva o valor (a ação continua exigindo financeiro:editar no servidor).
    expect(html([p], { verValores: false })).not.toContain("1.824");
  });

  it("liberação registrada à mão: estornar com motivo e confirmação; devolução por fora e Pix aguardando em palavras", () => {
    const manual: PagamentoDoPainel = { ...base, liberacaoConfirmadaEm: new Date("2026-10-08T15:00:00Z"), liberacaoOrigem: "manual", acoes: { ...sem, conferir: true, estornarLiberacao: true } };
    const h = html([manual]);
    expect(h).toContain("registrada à mão em 08/10/2026");
    expect(h).toContain("Estornar liberação");
    expect(h).toMatch(/<input required=""[^>]*name="motivo"/);
    const porFora: PagamentoDoPainel = {
      ...base,
      desfecho: "por_fora",
      devolucao: { situacao: "por_fora", valor: 182400, tentativas: 0, falhas: 0, confirmadaEm: null, porForaData: "2026-10-05", porForaValor: 182400, porForaNota: "Pix da empresa", taxaPerdida: null },
      acoes: sem,
    };
    expect(html([porFora])).toContain("feita por fora · R$ 1.824,00 · em 05/10/2026 · nota: Pix da empresa");
    const pendente: PagamentoDoPainel = { ...base, situacao: "pendente", desfecho: null, pixExpiraEm: new Date("2026-10-01T15:30:00Z"), acoes: { ...sem, conferir: true } };
    expect(situacaoEmPalavras(pendente)).toBe("Aguardando o pagamento do Pix (vale até 12:30 de 01/10/2026)");
  });
});
