import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AlteracaoDoPainel } from "@/pagamentos/alteracao-painel";
vi.mock("@/pagamentos/acoes-alteracao", () => ({
  calcularAlteracaoAcao: vi.fn(),
  segurarAlteracaoAcao: vi.fn(),
  previaDaAplicacaoAcao: vi.fn(),
  aplicarAlteracaoAcao: vi.fn(),
  desistirDaAlteracaoAcao: vi.fn(),
  marcarOtaAtualizadaAcao: vi.fn(),
  marcarHospedeAvisadoAlteracaoAcao: vi.fn(),
}));
import { AlteracaoSite, type PropsAlteracaoSite } from "./AlteracaoSite";

const AGORA = new Date("2026-10-01T15:00:00Z");
const reserva: PropsAlteracaoSite["reserva"] = { id: "r1", codigo: "SCL-TESTE1", estado: "confirmada", checkin: "2026-11-10", checkout: "2026-11-14", hospedes: 2, valorBruto: 150000 };
const alteracao = (over: Partial<AlteracaoDoPainel> = {}): AlteracaoDoPainel => ({
  id: "33333333-3333-4333-8333-333333333333",
  situacao: "segurada",
  quemPede: "hospede",
  motivoEmpresa: null,
  canal: "whatsapp",
  pedidoRecebidoEm: new Date("2026-10-01T14:30:00Z"),
  antes: { checkin: "2026-11-10", checkout: "2026-11-14", hospedes: 2, valor: 150000 },
  depois: { checkin: "2026-11-10", checkout: "2026-11-15", hospedes: 2, valor: 190000 },
  diferenca: 40000,
  valorNovo: 190000,
  origemValor: "cotacao",
  motivoValor: null,
  noitesNovas: { inicio: "2026-11-14", fim: "2026-11-15" },
  holdAte: new Date("2026-10-01T16:00:00Z"),
  emCarencia: false,
  criadaEm: new Date("2026-10-01T15:00:00Z"),
  criadaPor: "Equipe Fictícia",
  aplicadaEm: null,
  aplicadaPor: null,
  aplicadaTardia: false,
  expiradaEm: null,
  desistidaEm: null,
  desistidaPor: null,
  desistenciaMotivo: "",
  direito: null,
  base: null,
  valorADevolver: null,
  politicaVersao: null,
  integralAte: null,
  entradaDaPolitica: "2026-11-10",
  resultado: null,
  ota: null,
  avisados: { proposta: null, confirmacao: null, devolucao: null },
  devolucao: null,
  tentativas: [{ id: "p2", forma: "pix", situacao: "pendente", criadoEm: new Date("2026-10-01T15:05:00Z"), desfecho: null }],
  mensagens: { proposta: { texto: "Olá! Preparamos a alteração da sua reserva SCL-TESTE1: … diferença de R$ 400,00 …", falta: [], textoBase: true }, confirmada: null, devolvida: null },
  ...over,
});
const aplicada = (over: Partial<AlteracaoDoPainel> = {}) =>
  alteracao({
    situacao: "aplicada",
    aplicadaEm: new Date("2026-10-01T15:20:00Z"),
    tentativas: [{ id: "p2", forma: "pix", situacao: "aprovado", criadoEm: new Date("2026-10-01T15:05:00Z"), desfecho: "alteracao" }],
    resultado: { meses: [{ mes: "2026-11", antes: { bruto: 150000, taxa: -1485, comissao: 22277, parte: 126238 }, depois: { bruto: 190000, taxa: -1881, comissao: 28218, parte: 159901 } }] },
    mensagens: { proposta: null, confirmada: { texto: "Olá! A alteração da sua reserva SCL-TESTE1 está confirmada: … R$ 1.900,00.", falta: [], textoBase: true }, devolvida: null },
    ...over,
  });
const html = (o: Partial<PropsAlteracaoSite> = {}) =>
  renderToStaticMarkup(
    <AlteracaoSite
      reserva={reserva}
      capacidade={4}
      alteracoes={[]}
      comCancelamento={false}
      entradaEm={new Date("2026-11-10T18:00:00Z")}
      editarReserva
      editarFinanceiro
      verValores
      agora={AGORA}
      {...o}
    />,
  );
const operacao = { editarFinanceiro: false, verValores: false };

describe("alteração da reserva paga pelo site na ficha (M8.2d)", () => {
  it("sem financeiro:editar: só a linha de que o financeiro faz a alteração — nenhum formulário, nenhum valor", () => {
    const h = html(operacao);
    expect(h).toContain("Esta reserva foi paga pelo site: a alteração é feita por quem cuida do financeiro.");
    expect(h).not.toContain("Calcular a alteração");
    expect(h).not.toContain("R$");
  });

  it("quem cuida do financeiro vê o formulário (com a capacidade e o valor de agora); a reserva cancelada sem alterações não mostra nada", () => {
    const h = html();
    expect(h).toContain("Calcular a alteração");
    expect(h).toContain("Manter o valor atual (R$ 1.500,00)");
    expect(h).toContain("Este apartamento recebe até 4 pessoas.");
    expect(html({ reserva: { ...reserva, estado: "cancelada" } })).toBe("");
  });

  it("a segurada (aumento): o que espera, as datas, as tentativas da diferença, a proposta e desistir com o Pix cancelado — sem 'Aplicar' e sem o formulário", () => {
    const h = html({ alteracoes: [alteracao()] });
    expect(h).toContain("Alteração com as novas datas seguradas");
    expect(h).toContain("datas seguradas até 01/10 às 13:00 (esperando o pagamento da diferença)");
    expect(h).toContain("de 10/11–14/11 (4 noites, 2 pessoas) para 10/11–15/11 (5 noites, 2 pessoas)");
    expect(h).toContain("o hóspede paga a diferença de R$ 400,00");
    expect(h).toContain("Pix de 01/10 às 12:05: aguardando pagamento");
    expect(h).toContain("Copiar a proposta");
    expect(h).toContain("Desistir da alteração");
    expect(h).not.toContain("Conferir para aplicar");
    expect(h).not.toContain("Calcular a alteração");
    // A operação vê a segurada sem valores e sem as ações do financeiro; a mensagem com valor fica com o financeiro.
    const op = html({ alteracoes: [alteracao()], ...operacao });
    expect(op).toContain("Alteração com as novas datas seguradas");
    expect(op).not.toContain("R$");
    expect(op).not.toContain("Desistir da alteração");
    expect(op).not.toContain("Copiar a proposta");
    expect(op).toContain("quem cuida do financeiro copia e envia esta mensagem");
  });

  it("a segurada sem aumento: 'Conferir para aplicar'; no prazo da carência, diz que um pagamento da diferença ainda está em andamento", () => {
    expect(html({ alteracoes: [alteracao({ diferenca: 0, depois: { checkin: "2026-11-11", checkout: "2026-11-15", hospedes: 2, valor: 150000 } })] })).toContain("Conferir para aplicar (o hóspede aceitou)");
    expect(html({ alteracoes: [alteracao({ emCarencia: true })] })).toContain("o prazo das datas acabou às 13:00, mas um pagamento da diferença ainda está em andamento");
  });

  it("a aplicada: quem aplicou (o pagamento da diferença), o financeiro por mês, as OTAs e a mensagem de confirmação", () => {
    const h = html({ alteracoes: [aplicada()] });
    expect(h).toContain("Alteração aplicada");
    expect(h).toContain("pelo pagamento da diferença");
    expect(h).toContain('aria-label="Financeiro da alteração"');
    expect(h).toContain("+R$ 400,00");
    expect(h).toContain("Datas atualizadas nas OTAs");
    // M8.3b: sem o texto da tarefa das OTAs, o genérico (no mesmo bloqueio, sem apagar); com ele, as datas da reserva.
    expect(h).toContain("Mude as datas do bloqueio no Beds24 para as novas (não apague nem crie outro).");
    expect(h).not.toMatch(/reabra as antigas|feche as novas datas/);
    expect(html({ alteracoes: [aplicada()], textoOta: "Mude as datas do bloqueio para 10/11 a 15/11 (não apague nem crie outro)." })).toContain("Mude as datas do bloqueio para 10/11 a 15/11 (não apague nem crie outro).");
    expect(h).toContain("Copiar mensagem: alteração confirmada");
    expect(h).toContain("Calcular a alteração");
    const marcada = html({ alteracoes: [aplicada({ ota: { em: new Date("2026-10-02T15:00:00Z"), por: "Equipe Fictícia" } })] });
    expect(marcada).toContain("bloqueio mudado em 02/10 por Equipe Fictícia");
    expect(marcada).not.toContain("Datas atualizadas nas OTAs");
    const op = html({ alteracoes: [aplicada()], ...operacao });
    expect(op).not.toContain("R$");
    expect(op).not.toContain("Financeiro da alteração");
    expect(op).toContain("Datas atualizadas nas OTAs");
  });

  it("revisão do M8.2d: a aplicada que mudou só as pessoas ou o valor (as mesmas datas) não pede para mudar o bloqueio nas OTAs", () => {
    const soPessoas = aplicada({ depois: { checkin: "2026-11-10", checkout: "2026-11-14", hospedes: 3, valor: 160000 }, diferenca: 10000, valorNovo: 160000, noitesNovas: null });
    const h = html({ alteracoes: [soPessoas] });
    expect(h).toContain("Alteração aplicada");
    expect(h).not.toContain("Datas atualizadas nas OTAs");
    expect(h).not.toContain("Mude as datas do bloqueio");
    expect(html({ alteracoes: [aplicada({ id: "a3" }), soPessoas] })).not.toContain("bloqueio nas OTAs ainda não marcado");
  });

  it("a redução aplicada: a devolução da diferença esperando a liberação (nunca 'pedida'), e a retida sem devolução", () => {
    const reducao = aplicada({
      diferenca: -30000,
      depois: { checkin: "2026-12-05", checkout: "2026-12-09", hospedes: 2, valor: 120000 },
      direito: "integral",
      base: "prazo",
      valorADevolver: 30000,
      devolucao: { estado: "aguardando_liberacao", valor: 30000, valorConfirmado: null, em: null, previstaEm: "2026-10-20", porFora: false, algumaPorFora: false, forma: "pix" },
    });
    expect(html({ alteracoes: [reducao] })).toContain("Devolução de R$ 300,00: esperando o Mercado Pago liberar o pagamento (previsto para 20/10): nada foi pedido ainda");
    expect(html({ alteracoes: [reducao], ...operacao })).toContain("Devolução: esperando o Mercado Pago liberar o pagamento");
    // Feita com uma parte por fora (e a outra pelo Mercado Pago), e toda por fora.
    const feita = (porFora: boolean) => html({ alteracoes: [{ ...reducao, devolucao: { ...reducao.devolucao!, estado: "feita", em: new Date("2026-10-06T15:00:00Z"), porFora, algumaPorFora: true } }] });
    expect(feita(false)).toContain("(uma parte por fora)");
    expect(feita(true)).toContain("(por fora)");
    expect(feita(true)).not.toContain("uma parte");
    const retida = html({ alteracoes: [{ ...reducao, direito: "nenhum", base: "fora_do_prazo", valorADevolver: 0, devolucao: null }] });
    expect(retida).toContain("sem devolução pela política");
    expect(retida).toContain("continua R$ 1.500,00: pela política, a diferença de R$ 300,00 não é devolvida");
  });

  it("o histórico (nunca apagado): vencida, desistida (o motivo só com o financeiro) e a aplicada mais antiga", () => {
    const h = html({
      alteracoes: [
        aplicada({ id: "a3" }),
        alteracao({ id: "a2", situacao: "desistida", desistidaEm: new Date("2026-09-30T15:00:00Z"), desistidaPor: "Equipe Fictícia", desistenciaMotivo: "o hóspede desistiu" }),
        alteracao({ id: "a1", situacao: "expirada" }),
        aplicada({ id: "a0", ota: { em: new Date("2026-09-20T15:00:00Z"), por: null } }),
      ],
    });
    expect(h).toContain("Histórico das alterações");
    expect(h).toContain("desistida em 30/09 por Equipe Fictícia: o hóspede desistiu");
    expect(h).toContain("o prazo das datas acabou (as novas datas voltaram à venda)");
    expect(h).toContain("aplicada em 01/10");
    const op = html({ alteracoes: [alteracao({ id: "a2", situacao: "desistida", desistidaEm: new Date("2026-09-30T15:00:00Z"), desistenciaMotivo: "o hóspede desistiu" })], ...operacao });
    expect(op).not.toContain("o hóspede desistiu");
    expect(op).not.toContain("R$");
  });

  it("com cancelamento ativo ou depois da entrada, o formulário não aparece e a ficha diz por quê", () => {
    expect(html({ comCancelamento: true })).toContain("Há um pedido de cancelamento desta reserva: decida ou descarte o pedido antes de alterar.");
    expect(html({ comCancelamento: true })).not.toContain("Calcular a alteração");
    const depois = html({ entradaEm: new Date("2026-09-30T18:00:00Z") });
    expect(depois).toContain("A estadia já começou");
    expect(depois).not.toContain("Calcular a alteração");
  });
});
