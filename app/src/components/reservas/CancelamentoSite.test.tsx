import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CancelamentoDoPainel } from "@/pagamentos/cancelamento-painel";
import type { PagamentoDoPainel } from "@/pagamentos/consultas";
vi.mock("@/pagamentos/acoes-cancelamento", () => ({
  calcularCancelamentoAcao: vi.fn(),
  cancelarReservaPagaAcao: vi.fn(),
  registrarPedidoCancelamentoAcao: vi.fn(),
  descartarPedidoCancelamentoAcao: vi.fn(),
  marcarOtaLiberadaAcao: vi.fn(),
  marcarHospedeAvisadoAcao: vi.fn(),
}));
vi.mock("@/pagamentos/acoes-painel", () => ({}));
import { CancelamentoSite, type PropsCancelamentoSite } from "./CancelamentoSite";

const AGORA = new Date("2026-10-01T15:00:00Z"); // 12:00 em São Paulo
const sem = { conferir: false, devolver: false, devolucaoPorFora: false, registrarLiberacao: false, estornarLiberacao: false, registrarTaxaPerdida: false };
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
  liberacaoPrevistaEm: null,
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
  acoes: sem,
  aceite: { versoes: { termos: 1, privacidade: 1, cancelamento: 1 }, aceitoEm: new Date("2026-10-01T15:02:00Z"), diasReembolsoIntegral: 14 },
};
const msg = (texto: string | null, o: { textoBase?: boolean; falta?: ("hospede" | "link" | "valor")[]; modeloRecusado?: string } = {}) => ({
  texto,
  falta: o.falta ?? [],
  textoBase: o.textoBase ?? true,
  ...(o.modeloRecusado ? { modeloRecusado: o.modeloRecusado } : {}),
});
const pedido: CancelamentoDoPainel = {
  id: "c1",
  situacao: "pedido",
  pedidoRecebidoEm: new Date("2026-10-01T15:30:00Z"),
  pedidoRegistradoOriginalEm: null,
  motivoMomento: "",
  canal: "whatsapp",
  pedidoPor: "Equipe Fictícia",
  quemCancela: "hospede",
  motivoEmpresa: null,
  motivoExcecao: null,
  politicaVersao: null,
  integralAte: null,
  arrependimentoAte: null,
  arrependimentoAteEntrada: null,
  entradaEm: null,
  calculado: null,
  direito: null,
  base: null,
  motivoDecisao: "",
  nota: "WhatsApp da empresa, 12h30",
  valorPago: null,
  valorADevolver: null,
  canceladaEm: null,
  canceladaPor: null,
  resultadoLancadoEm: null,
  espelhado: false,
  caixaLancadoEm: null,
  ota: null,
  descontos: [],
  avisados: { pedido: null, decisao: null, devolucao: null },
  descartados: [],
  mensagens: { recebido: msg("Olá, Visitante! Recebemos o seu pedido de cancelamento da reserva SCL-TESTE1 em 01/10/2026 às 12:30."), decidido: null, devolvida: null },
};
const cancelada: CancelamentoDoPainel = {
  ...pedido,
  situacao: "cancelada",
  politicaVersao: 1,
  integralAte: "2026-10-26",
  arrependimentoAte: "2026-10-08",
  arrependimentoAteEntrada: true,
  entradaEm: new Date("2026-11-09T18:00:00Z"),
  calculado: "integral",
  direito: "integral",
  base: "prazo",
  valorPago: 182400,
  valorADevolver: 182400,
  canceladaEm: new Date("2026-10-01T16:00:00Z"),
  canceladaPor: "Diego Fictício",
  resultadoLancadoEm: new Date("2026-10-01T16:00:00Z"),
  mensagens: {
    recebido: msg("Olá, Visitante! Recebemos o seu pedido de cancelamento da reserva SCL-TESTE1."),
    decidido: msg("Olá, Visitante! A reserva SCL-TESTE1 foi cancelada. Devolvemos R$ 1.824,00.", { textoBase: false }),
    devolvida: msg(null, { falta: ["link"] }),
  },
};
const props = (over: Partial<PropsCancelamentoSite> = {}): PropsCancelamentoSite => ({
  reserva: { id: "22222222-2222-4222-8222-222222222222", codigo: "SCL-TESTE1", estado: "confirmada", checkin: "2026-11-09" },
  pagamento,
  cancelamento: null,
  momentos: { entradaEm: new Date("2026-11-09T18:00:00Z"), naoComparecimentoApos: new Date("2026-11-10T15:00:00Z"), fuso: "America/Sao_Paulo" },
  editarReserva: true,
  editarFinanceiro: true,
  verValores: true,
  agora: AGORA,
  ...over,
});
const html = (over: Partial<PropsCancelamentoSite> = {}) => renderToStaticMarkup(<CancelamentoSite {...props(over)} />);
const operacao = { editarFinanceiro: false, verValores: false };

describe("cancelamento pela política na ficha (M8.2c)", () => {
  it("reserva confirmada sem pedido: quem cuida do financeiro registra o pedido e calcula; o não comparecimento diz a partir de quando", () => {
    const h = html();
    expect(h).toContain('aria-label="Cancelamento pela política"');
    expect(h).toContain("Registrar pedido de cancelamento");
    expect(h).toContain("Calcular o cancelamento pela política");
    expect(h).toContain("Não comparecimento (o hóspede não chegou e não avisou; só depois de 10/11 às 12:00)");
    expect(h).toContain('max="2026-10-01"');
    expect(h).not.toContain("Cancelar a reserva</button>");
    expect(h).not.toContain("é feito por quem cuida do financeiro");
  });

  it("operação (sem o financeiro): só registrar o pedido, o aviso de que quem cancela é o financeiro, nenhum valor e nenhum cálculo", () => {
    const h = html(operacao);
    expect(h).toContain("Esta reserva foi paga pelo site: o cancelamento com devolução é feito por quem cuida do financeiro.");
    expect(h).toContain("Registrar pedido de cancelamento");
    expect(h).not.toContain("Calcular o cancelamento");
    expect(h).not.toContain("R$");
    // Sem reserva:editar (só leitura), nada de formulário.
    expect(html({ ...operacao, editarReserva: false })).not.toContain("<form");
  });

  it("pedido da equipe esperando: o momento, quem registrou, descartar com confirmação, a mensagem de pedido recebido para copiar e o 'mensagem enviada'", () => {
    const h = html({ ...operacao, cancelamento: pedido });
    expect(h).toContain("01/10 às 12:30 · WhatsApp · registrado por Equipe Fictícia");
    expect(h).toContain("esperando a equipe decidir");
    expect(h).toContain("Descartar pedido");
    expect(h).toContain("Copiar mensagem: pedido recebido");
    expect(h).toContain("texto-base — edite em Configurações → Mensagens ao hóspede");
    expect(h).toContain("Mensagem enviada ao hóspede");
    expect(h).not.toContain("Registrar pedido de cancelamento");
    expect(h).not.toContain("R$");
  });

  it("pedido feito pelo hóspede no site: a operação não descarta (só o financeiro, como desistência); o financeiro vê o momento travado no cálculo", () => {
    const site = { ...pedido, canal: "site" as const, pedidoPor: null };
    const op = html({ ...operacao, cancelamento: site });
    expect(op).toContain("Pedido feito pelo hóspede no site: só quem cuida do financeiro descarta, como desistência do hóspede.");
    expect(op).not.toContain('aria-label="Descartar pedido de cancelamento"');
    const fin = html({ cancelamento: site });
    expect(fin).toContain("Descartar pedido (o hóspede desistiu)");
    expect(fin).toContain("Por onde o hóspede desistiu");
    expect(fin).toContain("pedido feito pelo hóspede em Minha reserva (o horário é o do sistema e não muda)");
    expect(fin).not.toContain('name="recebidoData"');
  });

  it("com pedido ativo, o não comparecimento fica desligado (vale o horário do pedido)", () => {
    const h = html({ cancelamento: pedido });
    expect(h).toContain('disabled="" name="quemCancela" value="nao_comparecimento"');
    expect(h).toContain("Há um pedido de cancelamento do hóspede: não é não comparecimento");
    expect(h).toContain('value="2026-10-01"');
    expect(h).toContain('value="12:30"');
    expect(html()).not.toContain('disabled="" name="quemCancela" value="nao_comparecimento"');
    expect(html()).toContain('name="quemCancela" value="nao_comparecimento"');
  });

  it("cancelada com devolução integral: pedido, quem cancelou, política, decisão com o valor, devolução, financeiro, parte do proprietário, OTAs e mensagens", () => {
    const h = html({
      reserva: { ...props().reserva, estado: "cancelada" },
      cancelamento: { ...cancelada, descontos: [{ valor: 63119, situacao: { tipo: "a_descontar" } }] },
      pagamento: { ...pagamento, devolucao: { situacao: "pedida", valor: 182400, tentativas: 1, falhas: 0, confirmadaEm: null, porForaData: null, porForaValor: null, porForaNota: "", taxaPerdida: null, origem: "cancelamento", ultimoCodigo: "em_andamento" } },
    });
    expect(h).toContain("O hóspede pediu");
    expect(h).toContain("01/10 às 13:00 por Diego Fictício");
    expect(h).toContain("versão 1 — reembolso integral para pedidos até 26/10 (23h59) — arrependimento até 08/10, ou até a entrada");
    expect(h).toContain("Devolução integral — pedido dentro do prazo de reembolso integral (R$ 1.824,00)");
    expect(h).toContain("pedida ao Mercado Pago, aguardando confirmação");
    expect(h).toContain("o Mercado Pago pediu para esperar: o sistema tenta de novo sozinho");
    expect(h).toContain("resultado lançado em 01/10 · aguardando a devolução ser realizada");
    expect(h).toContain("já repassada: R$ 631,19 de desconto lançado em 01/10 — a descontar no próximo repasse");
    expect(h).toContain("reabra as datas nas OTAs (no Beds24, apague o bloqueio)");
    expect(h).toContain("Datas reabertas nas OTAs");
    expect(h).toContain("Copiar mensagem: cancelamento");
    // Falta um dado: a mensagem não sai e o aviso diz o quê.
    expect(h).toContain("Copiar mensagem: devolução feita: falta {link} na reserva: complete antes de copiar.");
    // Cancelada: nenhum formulário de cálculo.
    expect(h).not.toContain("Calcular o cancelamento");
  });

  it("sem financeiro:ler: nenhum valor e nenhuma mensagem com valor (cancelamento, devolução feita); a nota da decisão também não", () => {
    const h = html({
      ...operacao,
      reserva: { ...props().reserva, estado: "cancelada" },
      cancelamento: { ...cancelada, base: "excecao", motivoExcecao: "cortesia_comercial", motivoDecisao: "cliente antigo", descontos: [{ valor: 63119, situacao: { tipo: "descontado", data: "2026-10-05" } }] },
    });
    expect(h).not.toContain("R$");
    expect(h).not.toContain("Copiar mensagem: cancelamento");
    expect(h).not.toContain("Copiar mensagem: devolução feita");
    expect(h).not.toContain("cliente antigo");
    expect(h).toContain("Devolução integral por exceção (Cortesia comercial)");
    expect(h).toContain("já repassada: desconto lançado em 01/10 — descontado no repasse de 05/10");
    expect(h).toContain("Copiar mensagem: pedido recebido");
  });

  it("sem financeiro:ler: a 'mensagem enviada' da decisão e da devolução fica com quem pode copiá-las (só a do pedido recebido é da operação)", () => {
    const h = html({ ...operacao, reserva: { ...props().reserva, estado: "cancelada" }, cancelamento: { ...cancelada, mensagens: { ...cancelada.mensagens, devolvida: msg("Olá! A devolução foi feita.") } } });
    expect(h.match(/Mensagem enviada ao hóspede/g)).toHaveLength(1);
    expect(h).toContain("ainda não enviada (quem cuida do financeiro copia e envia esta mensagem)");
    expect(html({ reserva: { ...props().reserva, estado: "cancelada" }, cancelamento: { ...cancelada, mensagens: { ...cancelada.mensagens, devolvida: msg("Olá! A devolução foi feita.") } } }).match(/Mensagem enviada ao hóspede/g)).toHaveLength(3);
  });

  it("mensagem que falta um dado do cancelamento (não da reserva) e modelo que não serve: o aviso diz o que é, sem mandar completar a reserva", () => {
    const h = html({
      reserva: { ...props().reserva, estado: "cancelada" },
      cancelamento: {
        ...cancelada,
        mensagens: { recebido: msg("Olá! Recebemos o seu pedido.", { modeloRecusado: "“Cancelamento: pedido recebido” não pode usar {valor}." }), decidido: msg(null, { falta: ["valor"] }), devolvida: null },
      },
    });
    expect(h).toContain("Copiar mensagem: cancelamento: {valor} ainda não existe neste cancelamento: o modelo escolhido não serve para este caso (ajuste-o em Configurações → Modelos de mensagem).");
    expect(h).not.toContain("{valor} na reserva");
    expect(h).toContain("texto-base: o modelo escolhido não serve para esta mensagem (“Cancelamento: pedido recebido” não pode usar {valor}.) — edite em Configurações → Mensagens ao hóspede");
  });

  it("sem devolução: a parte retida, nada a lançar no caixa; OTAs marcadas e mensagens enviadas mostram quando e quem", () => {
    const h = html({
      reserva: { ...props().reserva, estado: "cancelada" },
      cancelamento: {
        ...cancelada,
        direito: "nenhum",
        calculado: "nenhum",
        base: "fora_do_prazo",
        valorADevolver: 0,
        caixaLancadoEm: new Date("2026-10-01T16:00:00Z"),
        ota: { em: new Date("2026-10-02T13:00:00Z"), por: "Equipe Fictícia" },
        avisados: { pedido: { em: new Date("2026-10-01T16:10:00Z"), por: null }, decisao: { em: new Date("2026-10-01T16:20:00Z"), por: "Equipe Fictícia" }, devolucao: null },
        mensagens: { ...cancelada.mensagens, devolvida: null },
      },
    });
    expect(h).toContain("Sem devolução — pedido depois do prazo de reembolso integral");
    expect(h).toContain("retida: dividida como uma reserva normal; disponível depois de 09/11 e da liberação do Mercado Pago");
    expect(h).toContain("nada a lançar no caixa (o valor fica retido)");
    expect(h).toContain("datas reabertas em 02/10 por Equipe Fictícia");
    expect(h).toContain("enviada em 01/10 por o sistema");
    expect(h).toContain("enviada em 01/10 por Equipe Fictícia");
    expect(h).not.toContain("Hóspede avisado: devolução feita");
    expect(h).not.toContain("Datas reabertas nas OTAs</button>");
  });

  it("pedidos descartados ficam no histórico; reserva cancelada sem cancelamento pela política não mostra o quadro", () => {
    const h = html({ cancelamento: { ...pedido, descartados: [{ em: new Date("2026-09-30T13:00:00Z"), canal: "site", motivo: "O hóspede desistiu do pedido: vem mesmo", por: "Diego Fictício", descartadoEm: new Date("2026-09-30T20:00:00Z") }] } });
    expect(h).toContain("Pedidos descartados");
    expect(h).toContain("30/09 às 10:00 (pelo hóspede, no site) — descartado por Diego Fictício em 30/09: O hóspede desistiu do pedido: vem mesmo");
    expect(html({ reserva: { ...props().reserva, estado: "cancelada" } })).toBe("");
  });
});

describe("cancelamento depois de uma alteração (M8.2d)", () => {
  const devolucaoDe = (over: Partial<NonNullable<PagamentoDoPainel["devolucao"]>> = {}): NonNullable<PagamentoDoPainel["devolucao"]> => ({
    situacao: "pedida",
    valor: 182400,
    tentativas: 1,
    falhas: 0,
    confirmadaEm: null,
    porForaData: null,
    porForaValor: null,
    porForaNota: "",
    taxaPerdida: null,
    origem: "cancelamento",
    ultimoCodigo: null,
    ...over,
  });
  const reservaCancelada = { ...props().reserva, estado: "cancelada" as const };
  const doCancelamento = { ...pagamento, devolucao: devolucaoDe({ situacao: "confirmada", confirmadaEm: new Date("2026-10-02T15:00:00Z") }) };
  const diferenca: PagamentoDoPainel = {
    ...pagamento,
    id: "33333333-3333-4333-8333-333333333333",
    desfecho: "alteracao",
    valor: 40000,
    valorPago: 40000,
    criadoEm: new Date("2026-10-05T15:00:00Z"),
    devolucao: devolucaoDe({ valor: 40000 }),
  };

  it("depois de um aumento, a linha Devolução mostra a de cada pagamento (a do pagamento da diferença também): nunca 'feita' com a outra pendente", () => {
    const h = html({ reserva: reservaCancelada, cancelamento: cancelada, pagamento: doCancelamento, pagamentos: [doCancelamento, diferenca] });
    expect(h).toContain("Pix de 01/10/2026: confirmada pelo Mercado Pago · R$ 1.824,00 · em 02/10/2026");
    expect(h).toContain("Pix de 05/10/2026 (a diferença da alteração): pedida ao Mercado Pago, aguardando confirmação · R$ 400,00 · 1 pedido(s) ao Mercado Pago");
    // Sem o financeiro, as duas sem valores.
    const op = html({ ...operacao, reserva: reservaCancelada, cancelamento: cancelada, pagamento: doCancelamento, pagamentos: [doCancelamento, diferenca] });
    expect(op).toContain("Pix de 05/10/2026 (a diferença da alteração): pedida ao Mercado Pago, aguardando confirmação");
    expect(op).not.toContain("R$");
  });

  it("a devolução do cancelamento só num pagamento (o outro já devolvido por uma redução): a linha é a dele; com um só pagamento, a de sempre", () => {
    const reduzido = { ...pagamento, devolucao: devolucaoDe({ origem: "alteracao", situacao: "confirmada", valor: 30000 }) };
    const h = html({ reserva: reservaCancelada, cancelamento: cancelada, pagamento: reduzido, pagamentos: [reduzido, diferenca] });
    expect(h).toContain("pedida ao Mercado Pago, aguardando confirmação · R$ 400,00");
    expect(h).not.toContain("R$ 300,00");
    expect(html({ reserva: reservaCancelada, cancelamento: cancelada, pagamento: doCancelamento })).toContain("confirmada pelo Mercado Pago · R$ 1.824,00 · em 02/10/2026");
  });
});
