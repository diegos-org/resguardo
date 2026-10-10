import { describe, expect, it } from "vitest";
import type { EstadoPagamentoHospede, VistaPagamentoHospede } from "@/pagamentos/consultas";
import { contatoPrincipal, emEspera, ESTADOS_COM_DINHEIRO, ESTADOS_QUE_PAGAM, imagemDoQr, linhaDaAnalise, linkDoPix, mensagemDoContato, paraOHospede, TITULO_PAGAMENTO } from "./pagamento-vista";

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
    expect(ESTADOS_COM_DINHEIRO).toEqual(["confirmando", "confirmada", "aprovado_sem_datas", "devolucao_pedida", "devolvido"]);
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
  });
});
