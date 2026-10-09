import { describe, expect, it } from "vitest";
import type { EstadoPagamentoHospede, VistaPagamentoHospede } from "@/pagamentos/consultas";
import { emEspera, imagemDoQr, linkDoPix, mensagemDoContato, paraOHospede, TITULO_PAGAMENTO } from "./pagamento-vista";

const TODOS: EstadoPagamentoHospede[] = ["sem_pagamento", "pagar", "pix_aguardando", "pix_vencido", "pix_esgotado", "verificando", "confirmando", "confirmada", "aprovado_sem_datas", "devolucao_pedida", "devolvido"];

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
    });
    expect(paraOHospede({ ...v, pix: null, holdAte: null, devolucao: null })).toMatchObject({ pix: null, holdAte: null, devolucao: null });
  });

  it("título para cada situação com pagamento; a página acompanha sozinha só enquanto espera", () => {
    for (const e of TODOS.filter((x) => x !== "sem_pagamento")) expect(TITULO_PAGAMENTO[e as Exclude<EstadoPagamentoHospede, "sem_pagamento">]).toBeTruthy();
    expect(TODOS.filter(emEspera)).toEqual(["pix_aguardando", "pix_vencido", "verificando", "confirmando"]);
  });

  it("mensagem para a equipe: a cotação e uma linha sobre o pagamento; com as datas seguradas, a de sempre", () => {
    const texto = "Olá! Fiz a cotação COT-ABCDEFGH no site.\nEntrada: 12/10 · Saída: 15/10.\nAs datas estão seguradas para mim até 01/10, 12:30. Quero confirmar a reserva.";
    expect(mensagemDoContato(texto, "pagar", null)).toBe(texto);
    expect(mensagemDoContato(texto, "pix_esgotado", null)).toBe(texto);
    expect(mensagemDoContato(texto, "aprovado_sem_datas", null)).toBe("Olá! Fiz a cotação COT-ABCDEFGH no site.\nEntrada: 12/10 · Saída: 15/10.\nPaguei pelo Pix, mas a página diz que não deu para garantir as datas.");
    expect(mensagemDoContato(texto, "confirmada", "SCL-TESTE1")).toContain("minha reserva é a SCL-TESTE1.");
    expect(mensagemDoContato(texto, "confirmada", null)).toContain("a reserva foi confirmada");
    expect(mensagemDoContato(texto, "devolucao_pedida", null)).toContain("devolução");
  });
});
