import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PagamentoDoPainel } from "@/pagamentos/consultas";
vi.mock("@/pagamentos/acoes-painel", () => ({ conferirAgoraAcao: vi.fn(), devolverAcao: vi.fn(), devolucaoPorForaAcao: vi.fn(), registrarLiberacaoAcao: vi.fn(), estornarLiberacaoAcao: vi.fn(), registrarTaxaPerdidaAcao: vi.fn() }));
// A pergunta de confirmação só aparece no clique: aqui ela vira um atributo, para conferir o texto.
vi.mock("@/components/pagamentos/FormAcaoPagamento", () => ({
  FormAcaoPagamento: (p: { rotulo: string; pergunta?: string; children?: ReactNode }) => (
    <form data-pergunta={p.pergunta ?? ""}>
      {p.children}
      <button>{p.rotulo}</button>
    </form>
  ),
}));
import { PagamentoNoSite } from "./PagamentoNoSite";

const sem = { conferir: false, devolver: false, devolucaoPorFora: false, registrarLiberacao: false, estornarLiberacao: false, registrarTaxaPerdida: false };
const pagamento: PagamentoDoPainel = {
  id: "11111111-1111-4111-8111-111111111111",
  cotacaoId: "c",
  reservaId: "r",
  forma: "pix",
  situacao: "aprovado",
  ambiente: "teste",
  aoVivo: false,
  valor: 182400,
  valorPago: 172400,
  taxa: 1806,
  liquido: 170594,
  liberacaoPrevistaEm: null,
  liberacaoConfirmadaEm: null,
  liberacaoOrigem: null,
  pixExpiraEm: null,
  aprovadoEm: new Date("2026-10-01T15:05:00Z"),
  consultadoEm: new Date("2026-10-01T15:06:00Z"),
  criadoEm: new Date("2026-10-01T15:00:00Z"),
  desfecho: null,
  desfechoEm: null,
  motivoSemReserva: "valor_divergente",
  motivoSemReservaTexto: "O valor aprovado é diferente do total da cotação.",
  avisos: [],
  devolucao: null,
  pedeAtencao: true,
  acoes: { ...sem, devolver: true, devolucaoPorFora: true },
};

describe("quadro Pagamento no site: perguntas de confirmação", () => {
  it("valor pago diferente do pedido (valor divergente): a pergunta da devolução e o valor do registro por fora são o pago", () => {
    const h = renderToStaticMarkup(<PagamentoNoSite pagamentos={[pagamento]} verValores editar hoje="2026-10-09" />);
    expect(h).toContain("valor integral de R$ 1.724,00");
    expect(h).not.toContain("valor integral de R$ 1.824,00");
    expect(h).toContain('value="1724,00"');
  });

  it("cartão (M8.2b): registrar a devolução por fora avisa que o hóspede pode contestar no cartão e receber de novo; no Pix, não", () => {
    const cartao = renderToStaticMarkup(<PagamentoNoSite pagamentos={[{ ...pagamento, forma: "cartao" }]} verValores editar hoje="2026-10-09" />);
    expect(cartao).toContain("O hóspede pode também contestar a cobrança no cartão e receber de novo: só registre se a devolução já foi feita e combinada com ele.");
    const pix = renderToStaticMarkup(<PagamentoNoSite pagamentos={[pagamento]} verValores editar hoje="2026-10-09" />);
    expect(pix).not.toContain("contestar a cobrança no cartão");
  });
});
