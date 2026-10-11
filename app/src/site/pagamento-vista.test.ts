import { describe, expect, it } from "vitest";
import type { EstadoPagamentoHospede, VistaPagamentoHospede } from "@/pagamentos/consultas";
import {
  type CancelamentoDoHospede,
  contatoPrincipal,
  emEspera,
  ESTADOS_COM_DINHEIRO,
  ESTADOS_QUE_PAGAM,
  imagemDoQr,
  linhaDaAnalise,
  linkDoPix,
  mensagemDoContato,
  mensagemDoContatoDaAlteracao,
  paraOHospede,
  type TextosDoCancelamento,
  textoDoCancelamento,
  TITULO_PAGAMENTO,
} from "./pagamento-vista";

const TODOS: EstadoPagamentoHospede[] = [
  "sem_pagamento",
  "pagar",
  "pix_aguardando",
  "pix_vencido",
  "pix_esgotado",
  "verificando",
  "confirmando",
  "confirmada",
  "aprovado_sem_datas",
  "devolucao_pedida",
  "devolvido",
  "cartao_desafio",
  "cartao_em_analise",
  "cartao_recusado",
  "cancelada_devolucao_pedida",
  "cancelada_devolvida",
  "cancelada_com_a_equipe",
  "cancelada_em_conferencia",
  "cancelada_sem_devolucao",
];

describe("vista do pagamento para o navegador (M8.2a)", () => {
  it("QR só como PNG em base64 conferido; link do Pix só https", () => {
    expect(imagemDoQr("RkFMU08=")).toBe("data:image/png;base64,RkFMU08=");
    expect(imagemDoQr("data:image/png;base64,RkFM\nU08=")).toBe("data:image/png;base64,RkFMU08=");
    for (const ruim of [null, undefined, "", "data:text/html;base64,PHNjcmlwdD4=", "javascript:alert(1)", "não é base64", "x".repeat(200_001)]) expect(imagemDoQr(ruim)).toBeNull();
    expect(linkDoPix("https://www.mercadopago.com.br/payments/1/ticket")).toBe("https://www.mercadopago.com.br/payments/1/ticket");
    for (const ruim of [null, "", "http://inseguro.example/pix", "javascript:alert(1)", "não é endereço"]) expect(linkDoPix(ruim)).toBeNull();
  });

  it("datas viram texto ISO; nada além do que a vista do domínio tem", () => {
    const v: VistaPagamentoHospede = {
      estado: "pix_aguardando",
      ambienteTeste: true,
      dinheiroSemDesfecho: true,
      holdAte: new Date("2026-10-01T15:32:00Z"),
      pix: { copiaECola: "000201", imagemBase64: "RkFMU08=", link: "javascript:alert(1)", expiraEm: new Date("2026-10-01T15:30:00Z") },
      pixRestantes: 2,
      reservaCodigo: null,
      pagamentoEmDobro: false,
      devolucao: { situacao: "pedida", em: new Date("2026-10-02T12:00:00Z") },
      cartaoRestantes: 3,
      forma: "pix",
      desafioUrl: null,
      recusa: null,
      prazoDasDatas: null,
      // Só para o servidor: não vai ao navegador (o toEqual abaixo confere).
      aoVivo: true,
      acompanhar: true,
      cancelamento: null,
      pedidoCancelamentoEm: null,
    };
    expect(paraOHospede(v)).toEqual({
      estado: "pix_aguardando",
      ambienteTeste: true,
      dinheiroSemDesfecho: true,
      holdAte: "2026-10-01T15:32:00.000Z",
      pix: { copiaECola: "000201", imagem: "data:image/png;base64,RkFMU08=", link: null, expiraEm: "2026-10-01T15:30:00.000Z" },
      pixRestantes: 2,
      podeGerar: false,
      reservaCodigo: null,
      pagamentoEmDobro: false,
      devolucao: { situacao: "pedida", em: "2026-10-02T12:00:00.000Z" },
      acompanhar: true,
      // A oferta do cartão (e o formulário) quem decide é a vista do site; aqui, nada.
      podePagarCartao: false,
      cartao: null,
      cartaoRestantes: 3,
      desafioUrl: null,
      forma: "pix",
      recusa: null,
      prazoDasDatas: null,
      cancelamento: null,
      pedidoCancelamentoEm: null,
    });
    expect(paraOHospede({ ...v, pix: null, holdAte: null, devolucao: null })).toMatchObject({ pix: null, holdAte: null, devolucao: null });
  });

  it("cartão (M8.2b): o endereço do desafio é conferido de novo (só https de domínio do Mercado Pago); recusa, forma e prazo das datas", () => {
    const v: VistaPagamentoHospede = {
      estado: "cartao_desafio",
      ambienteTeste: true,
      dinheiroSemDesfecho: true,
      holdAte: new Date("2026-10-01T15:42:00Z"),
      pix: null,
      pixRestantes: 3,
      reservaCodigo: null,
      pagamentoEmDobro: false,
      devolucao: null,
      cartaoRestantes: 2,
      forma: "cartao",
      desafioUrl: "https://www.mercadopago.com.br/checkout/v1/3ds/FALSO1",
      recusa: null,
      prazoDasDatas: null,
      aoVivo: false,
      acompanhar: true,
      cancelamento: null,
      pedidoCancelamentoEm: null,
    };
    expect(paraOHospede(v)).toMatchObject({ estado: "cartao_desafio", desafioUrl: "https://www.mercadopago.com.br/checkout/v1/3ds/FALSO1", forma: "cartao", cartaoRestantes: 2, podePagarCartao: false, cartao: null });
    for (const ruim of ["http://www.mercadopago.com.br/3ds", "https://mercadopago.com.br.golpe.example/3ds", "javascript:alert(1)", "https://example.com/3ds"]) expect(paraOHospede({ ...v, desafioUrl: ruim }).desafioUrl).toBeNull();
    expect(paraOHospede({ ...v, estado: "cartao_recusado", recusa: "verificacao", desafioUrl: null })).toMatchObject({ recusa: "verificacao", desafioUrl: null });
    expect(paraOHospede({ ...v, estado: "cartao_em_analise", prazoDasDatas: new Date("2026-10-01T16:30:00Z") }).prazoDasDatas).toBe("2026-10-01T16:30:00.000Z");
    expect(JSON.stringify(paraOHospede(v))).not.toContain("aoVivo");
  });

  it("título para cada situação com pagamento; a página acompanha sozinha só enquanto espera", () => {
    for (const e of TODOS.filter((x) => x !== "sem_pagamento")) expect(TITULO_PAGAMENTO[e as Exclude<EstadoPagamentoHospede, "sem_pagamento">]).toBeTruthy();
    expect(TODOS.filter(emEspera)).toEqual(["pix_aguardando", "pix_vencido", "verificando", "confirmando", "cartao_desafio", "cartao_em_analise"]);
  });

  it("situações que podem pagar (M8.2b): uma lista só para a oferta e para a caixa do aceite; dinheiro recarrega na hora", () => {
    expect(ESTADOS_QUE_PAGAM).toEqual(["sem_pagamento", "pagar", "pix_aguardando", "pix_vencido", "pix_esgotado", "cartao_recusado", "cartao_desafio"]);
    expect(ESTADOS_QUE_PAGAM).not.toContain("cartao_em_analise");
    // M8.2c: as cinco situações da reserva cancelada também recarregam na hora (o formulário do cartão nunca fica aberto).
    expect(ESTADOS_COM_DINHEIRO).toEqual([
      "confirmando",
      "confirmada",
      "aprovado_sem_datas",
      "devolucao_pedida",
      "devolvido",
      "cancelada_devolucao_pedida",
      "cancelada_devolvida",
      "cancelada_com_a_equipe",
      "cancelada_em_conferencia",
      "cancelada_sem_devolucao",
    ]);
  });

  it("botão da equipe como caminho principal: dinheiro sem as datas, devolução, cartão em análise; esgotado ou recusado só sem outra forma de pagar", () => {
    const c = (estado: EstadoPagamentoHospede, podeGerar = false, podePagarCartao = false) => contatoPrincipal({ estado, podeGerar, podePagarCartao });
    for (const e of ["aprovado_sem_datas", "devolucao_pedida", "devolvido", "cartao_em_analise"] as const) expect(c(e, true, true)).toBe(true);
    expect(c("pix_esgotado")).toBe(true);
    expect(c("pix_esgotado", false, true)).toBe(false);
    expect(c("cartao_recusado")).toBe(true);
    expect(c("cartao_recusado", true)).toBe(false);
    for (const e of ["pagar", "pix_aguardando", "pix_vencido", "verificando", "confirmada", "cartao_desafio"] as const) expect(c(e)).toBe(false);
  });

  it("linha fixa do cartão em análise: até quando as datas ficam seguradas; depois, o que acontece se aprovar (hora no fuso do imóvel)", () => {
    const agora = new Date("2026-10-01T15:00:00Z"); // 12:00 em São Paulo
    expect(linhaDaAnalise("2026-10-01T16:30:00.000Z", agora, "America/Sao_Paulo")).toBe("As datas estão seguradas até 13:30.");
    expect(linhaDaAnalise("2026-10-01T14:10:00.000Z", agora, "America/Sao_Paulo")).toBe(
      "O prazo das datas acabou às 11:10: se a análise aprovar e as datas ainda estiverem livres, confirmamos a reserva; senão, devolvemos o valor integral.",
    );
    expect(linhaDaAnalise("2026-09-30T14:10:00.000Z", agora, "America/Sao_Paulo")).toContain("O prazo das datas acabou em 30/09, 11:10:");
    expect(linhaDaAnalise(null, agora, "America/Sao_Paulo")).toBeNull();
    expect(linhaDaAnalise("não é data", agora, "America/Sao_Paulo")).toBeNull();
  });

  it("mensagem para a equipe: a cotação e uma linha sobre o pagamento; com as datas seguradas, a de sempre", () => {
    const texto = "Olá! Fiz a cotação COT-ABCDEFGH no site.\nEntrada: 12/10 · Saída: 15/10.\nAs datas estão seguradas para mim até 01/10, 12:30. Quero confirmar a reserva.";
    expect(mensagemDoContato(texto, "pagar", null)).toBe(texto);
    expect(mensagemDoContato(texto, "pix_esgotado", null)).toBe(texto);
    expect(mensagemDoContato(texto, "aprovado_sem_datas", null)).toBe("Olá! Fiz a cotação COT-ABCDEFGH no site.\nEntrada: 12/10 · Saída: 15/10.\nPaguei pelo Pix, mas a página diz que não deu para garantir as datas.");
    expect(mensagemDoContato(texto, "confirmada", "SCL-TESTE1")).toContain("minha reserva é a SCL-TESTE1.");
    expect(mensagemDoContato(texto, "confirmada", null)).toContain("a reserva foi confirmada");
    expect(mensagemDoContato(texto, "devolucao_pedida", null)).toContain("devolução");
    // M8.2b: a linha diz a forma do pagamento que manda na página.
    expect(mensagemDoContato(texto, "confirmada", "SCL-TESTE1", "cartao")).toContain("Paguei com cartão e minha reserva é a SCL-TESTE1.");
    expect(mensagemDoContato(texto, "verificando", null, "cartao")).toContain("Fiz o pagamento com cartão e a página ainda está conferindo.");
    expect(mensagemDoContato(texto, "verificando", null, "pix")).toContain("Fiz o pagamento por Pix e a página ainda está conferindo.");
    expect(mensagemDoContato(texto, "cartao_em_analise", null, "cartao")).toBe("Olá! Fiz a cotação COT-ABCDEFGH no site.\nEntrada: 12/10 · Saída: 15/10.\nPaguei com cartão e a página diz que o pagamento está em análise.");
    expect(mensagemDoContato(texto, "cartao_recusado", null, "cartao")).toBe(texto);
    // M8.2d: no quadro da alteração, a linha cita a reserva.
    expect(mensagemDoContatoDaAlteracao(texto, "SCL-TESTE1")).toBe("Olá! Fiz a cotação COT-ABCDEFGH no site.\nEntrada: 12/10 · Saída: 15/10.\nQuero falar sobre a alteração da minha reserva SCL-TESTE1.");
  });
});

describe("textoDoCancelamento: o texto único da página e das mensagens (M8.2c)", () => {
  // Textos editáveis trocados por marcadores: prova que cada caso usa a chave certa (e nada fixo no lugar).
  const textos: TextosDoCancelamento = {
    cancelamentoSemTaxas: "[sem taxas]",
    cancelamentoDevolucaoPedida: "[pedida]",
    cancelamentoEstornoNoCartao: "[estorno no cartão]",
    cancelamentoVoltaPix: "[volta Pix]",
    cancelamentoVoltaCartao: "[volta cartão]",
    cancelamentoVoltaPorFora: "[volta por fora]",
    cancelamentoComAEquipe: "[com a equipe]",
    cancelamentoEmConferencia: "[em conferência]",
    cancelamentoSemDevolucaoPrazo: "[sem devolução: prazo]",
    cancelamentoSemDevolucaoNaoComparecimento: "[não comparecimento]",
    cancelamentoSemDevolucaoEquipe: "[sem política]",
    cancelamentoFecho: "[fecho]",
    cancelamentoPedidoRecebido: "[pedido recebido]",
  };
  const base: CancelamentoDoHospede = {
    recebidoEm: "2026-10-05T13:10:00.000Z",
    quemCancela: "hospede",
    direito: "integral",
    base: "prazo",
    motivoEmpresa: null,
    valor: 182400,
    valorConfirmado: null,
    devolucaoEm: null,
    porFora: false,
    algumaPorFora: false,
    confirmadaPor: null,
    forma: "pix",
    estornoPelaEquipe: false,
    integralAte: "2026-10-28",
    arrependimentoAte: "2026-10-08",
    entradaEm: "2026-11-11T18:00:00.000Z",
    politicaVersao: 2,
  };
  const texto = (estado: EstadoPagamentoHospede, c: Partial<CancelamentoDoHospede> = {}) => textoDoCancelamento({ estado, reservaCodigo: "SCL-ABC123", cancelamento: { ...base, ...c } }, textos);

  it("integral pela política: devolvida (confirmada pela leitura, pela equipe, por fora), pedida, estorno no cartão, com a equipe, em conferência", () => {
    const feita = texto("cancelada_devolvida", { devolucaoEm: "2026-10-06T15:00:00.000Z", valorConfirmado: 182400, confirmadaPor: "leitura" });
    expect(feita).toEqual({
      linhas: [
        "Reserva SCL-ABC123 cancelada. Recebemos o seu pedido em 05/10 às 10:10 (horário de Brasília).",
        "Pela Política de cancelamento que você aceitou (versão 2), devolvemos o valor integral pago, R$ 1.824,00, [sem taxas]",
        "Devolução de R$ 1.824,00 confirmada pelo Mercado Pago em 06/10.",
        "[volta Pix]",
        "[fecho]",
      ],
      decisao: "Pela Política de cancelamento que você aceitou (versão 2), devolvemos o valor integral pago, R$ 1.824,00, [sem taxas] Devolução de R$ 1.824,00 confirmada pelo Mercado Pago em 06/10.",
      comoVolta: "[volta Pix]",
    });
    expect(texto("cancelada_devolvida", { devolucaoEm: "2026-10-06T15:00:00.000Z", confirmadaPor: "equipe", forma: "cartao" }).decisao).toContain("Devolução de R$ 1.824,00 feita pelo Mercado Pago em 06/10.");
    expect(texto("cancelada_devolvida", { devolucaoEm: "2026-10-06T15:00:00.000Z", confirmadaPor: "equipe", forma: "cartao" }).comoVolta).toBe("[volta cartão]");
    // Por fora: sem a linha do meio de pagamento (Pix ou cartão).
    const porFora = texto("cancelada_devolvida", { porFora: true, devolucaoEm: "2026-10-06T15:00:00.000Z" });
    expect(porFora.decisao).toContain("Devolução de R$ 1.824,00 feita em 06/10.");
    expect(porFora.comoVolta).toBe("[volta por fora]");
    expect(porFora.linhas.join(" ")).not.toMatch(/volta Pix|volta cartão/);
    expect(texto("cancelada_devolucao_pedida").decisao).toContain("[pedida]");
    expect(texto("cancelada_devolucao_pedida", { forma: "cartao", estornoPelaEquipe: true }).decisao).toContain("[estorno no cartão]");
    expect(texto("cancelada_com_a_equipe").decisao).toContain("A devolução de R$ 1.824,00 pelo Mercado Pago não foi possível. [com a equipe]");
    expect(texto("cancelada_com_a_equipe").comoVolta).toBeNull();
    expect(texto("cancelada_em_conferencia").decisao).toContain("[em conferência]");
  });

  it("devoluções por meios diferentes (reserva no Pix, diferença no cartão): as duas frases de como o dinheiro volta", () => {
    expect(texto("cancelada_devolucao_pedida", { forma: null }).comoVolta).toBe("[volta Pix] [volta cartão]");
    expect(texto("cancelada_devolvida", { forma: null, devolucaoEm: "2026-10-06T15:00:00.000Z", confirmadaPor: "leitura" }).linhas).toContain("[volta Pix] [volta cartão]");
  });

  it("uma parte por fora e outra pelo Mercado Pago: as frases dos dois caminhos, e o total nunca 'pelo Mercado Pago'", () => {
    const feita = texto("cancelada_devolvida", { forma: "cartao", algumaPorFora: true, devolucaoEm: "2026-10-06T15:00:00.000Z", valorConfirmado: 182400, confirmadaPor: "leitura" });
    expect(feita.decisao).toContain("Devolução de R$ 1.824,00 feita em 06/10.");
    expect(feita.decisao).not.toContain("Mercado Pago");
    expect(feita.comoVolta).toBe("[volta cartão] [volta por fora]");
    expect(texto("cancelada_devolucao_pedida", { forma: "pix", algumaPorFora: true }).comoVolta).toBe("[volta Pix] [volta por fora]");
    expect(texto("cancelada_devolucao_pedida", { forma: null, algumaPorFora: true }).comoVolta).toBe("[volta Pix] [volta cartão] [volta por fora]");
    // Todas por fora: só a transferência.
    expect(texto("cancelada_devolvida", { porFora: true, algumaPorFora: true, devolucaoEm: "2026-10-06T15:00:00.000Z" }).comoVolta).toBe("[volta por fora]");
  });

  it("quem cancela e a base: a SCL (com o motivo), exceção (decisão da equipe), sem devolução pelo prazo (o arrependimento só quando vai além), não comparecimento, sem política", () => {
    expect(texto("cancelada_devolucao_pedida", { quemCancela: "empresa", base: "empresa", motivoEmpresa: "imovel_sem_condicoes" }).linhas[0]).toBe("Nós cancelamos a sua reserva SCL-ABC123: o apartamento ficou sem condições de receber você.");
    expect(texto("cancelada_devolucao_pedida", { quemCancela: "empresa", base: "empresa", motivoEmpresa: "outro" }).linhas[0]).toBe("Nós cancelamos a sua reserva SCL-ABC123.");
    expect(texto("cancelada_devolucao_pedida", { base: "excecao" }).decisao).toMatch(/^Por decisão da nossa equipe, devolvemos o valor integral pago/);
    const semDevolucao = { direito: "nenhum" as const, base: "fora_do_prazo" as const, valor: 0 };
    expect(texto("cancelada_sem_devolucao", semDevolucao).decisao).toBe("Prazo de reembolso integral: pedidos até 28/10, às 23h59. [sem devolução: prazo]");
    expect(texto("cancelada_sem_devolucao", { ...semDevolucao, integralAte: "2026-10-01", arrependimentoAte: "2026-10-08" }).decisao).toBe("Prazo de reembolso integral: pedidos até 01/10, às 23h59. Arrependimento: até 08/10. [sem devolução: prazo]");
    // Paga já depois do prazo do reembolso integral (aprovada em 10/10, prazo até 06/10): nenhum prazo que nunca valeu.
    expect(texto("cancelada_sem_devolucao", { ...semDevolucao, integralAte: "2026-10-06", arrependimentoAte: "2026-10-17" }).decisao).toBe(
      "Esta reserva foi paga quando o prazo de reembolso integral já tinha passado. Arrependimento: até 17/10. [sem devolução: prazo]",
    );
    // A política para o arrependimento na entrada, e a entrada (15/10, 15:00) vem antes dos 7 dias: o texto diz a entrada.
    const comEntrada = { ...semDevolucao, integralAte: "2026-10-06", arrependimentoAte: "2026-10-17", entradaEm: "2026-10-15T18:00:00.000Z" };
    expect(texto("cancelada_sem_devolucao", { ...comEntrada, arrependimentoAteEntrada: true }).decisao).toBe(
      "Esta reserva foi paga quando o prazo de reembolso integral já tinha passado. Arrependimento: até a entrada, em 15/10. [sem devolução: prazo]",
    );
    expect(texto("cancelada_sem_devolucao", { ...comEntrada, arrependimentoAteEntrada: false }).decisao).toContain("Arrependimento: até 17/10.");
    expect(texto("cancelada_sem_devolucao", { ...semDevolucao, integralAte: "2026-10-01", arrependimentoAte: "2026-10-08", arrependimentoAteEntrada: true, entradaEm: "2026-10-05T18:00:00.000Z" }).decisao).toBe(
      "Prazo de reembolso integral: pedidos até 01/10, às 23h59. Arrependimento: até a entrada, em 05/10. [sem devolução: prazo]",
    );
    const naoVeio = texto("cancelada_sem_devolucao", { ...semDevolucao, quemCancela: "nao_comparecimento", base: "nao_comparecimento" });
    expect(naoVeio.linhas[0]).toBe("A reserva SCL-ABC123 foi cancelada por não comparecimento.");
    expect(naoVeio.decisao).toBe("[não comparecimento]");
    expect(texto("cancelada_sem_devolucao", { ...semDevolucao, base: "sem_politica", politicaVersao: null, integralAte: null, arrependimentoAte: null }).decisao).toBe("[sem política]");
    for (const e of ["cancelada_devolvida", "cancelada_devolucao_pedida", "cancelada_com_a_equipe", "cancelada_em_conferencia", "cancelada_sem_devolucao"] as const) expect(JSON.stringify(texto(e))).not.toMatch(/Beds24/i);
  });

  it("pedido ainda sem decisão: só a linha do pedido; sem pedido nem cancelamento: nada", () => {
    expect(textoDoCancelamento({ estado: "confirmada", reservaCodigo: "SCL-ABC123", cancelamento: null, pedidoCancelamentoEm: "2026-10-05T13:10:00.000Z" }, textos)).toEqual({
      linhas: ["Pedido de cancelamento recebido em 05/10 às 10:10 (horário de Brasília). [pedido recebido]"],
      decisao: "",
      comoVolta: null,
    });
    expect(textoDoCancelamento({ estado: "confirmada", reservaCodigo: "SCL-ABC123", cancelamento: null }, textos)).toEqual({ linhas: [], decisao: "", comoVolta: null });
    // Pagamento sem a política aceita: o recibo não diz "a política que você aceitou" (a frase editável cita a política).
    expect(textoDoCancelamento({ estado: "confirmada", reservaCodigo: "SCL-ABC123", cancelamento: null, pedidoCancelamentoEm: "2026-10-05T13:10:00.000Z", pedidoCancelamentoSemPolitica: true }, textos).linhas).toEqual([
      "Pedido de cancelamento recebido em 05/10 às 10:10 (horário de Brasília). A equipe confirma com você, por escrito, o valor da devolução.",
    ]);
    // O fecho vazio não vira linha.
    expect(textoDoCancelamento({ estado: "cancelada_em_conferencia", reservaCodigo: "X", cancelamento: base }, { ...textos, cancelamentoFecho: "" }).linhas).not.toContain("");
  });
});
