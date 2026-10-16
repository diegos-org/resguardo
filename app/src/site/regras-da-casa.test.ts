import { describe, expect, it } from "vitest";
import { imoveisDetalhes } from "@/db/schema";
import type { EstadoPagamentoHospede } from "@/pagamentos/consultas";
import { frasesDosHorarios, HORARIOS_PADRAO, MOSTRA_REGRAS_NO_PAGAMENTO, regrasDaCasa, regrasNaCotacao } from "./regras-da-casa";

const ficha = (over: Partial<Parameters<typeof regrasDaCasa>[0]> = {}) => ({
  checkinAPartirDe: "14:00",
  checkoutAte: "10:30",
  aceitaAnimais: false,
  permiteFumar: false,
  permiteFestas: false,
  regrasCasa: "",
  ...over,
});

describe("horários e regras da casa num lugar só (M7.20)", () => {
  it("com horários na ficha: os da ficha; sem ficha (leitura sem detalhes), entrada às 15:00 e saída às 11:00", () => {
    expect(regrasDaCasa(ficha())).toMatchObject({ entrada: "14:00", saida: "10:30" });
    const semFicha = regrasDaCasa({ checkinAPartirDe: null, checkoutAte: null, aceitaAnimais: null, permiteFumar: null, permiteFestas: null, regrasCasa: null });
    expect(semFicha).toEqual({ entrada: "15:00", saida: "11:00", convivencia: ["Não aceita animais", "Proibido fumar", "Sem festas ou eventos"], texto: "" });
    expect(HORARIOS_PADRAO).toEqual({ entrada: "15:00", saida: "11:00" });
  });

  it("o padrão da coluna no banco (migração, para linha gravada sem horário) é o mesmo HORARIOS_PADRAO", () => {
    expect(imoveisDetalhes.checkinAPartirDe.default).toBe(HORARIOS_PADRAO.entrada);
    expect(imoveisDetalhes.checkoutAte.default).toBe(HORARIOS_PADRAO.saida);
  });

  it("as frases dos horários são as mesmas nas duas páginas: a da casa com a hora como está, a da cotação com a hora escrita", () => {
    expect(frasesDosHorarios({ entrada: "15:00", saida: "11:00" })).toEqual(["Entrada a partir das 15:00", "Saída até as 11:00"]);
    expect(frasesDosHorarios({ entrada: "14:30", saida: "10:00" }, (h) => `[${h}]`)).toEqual(["Entrada a partir das [14:30]", "Saída até as [10:00]"]);
  });

  it("animais sempre aparecem (aceita ou não); fumar e festas só quando proibidos; a ordem é a da página da casa", () => {
    expect(regrasDaCasa(ficha()).convivencia).toEqual(["Não aceita animais", "Proibido fumar", "Sem festas ou eventos"]);
    expect(regrasDaCasa(ficha({ aceitaAnimais: true })).convivencia).toEqual(["Aceita animais", "Proibido fumar", "Sem festas ou eventos"]);
    expect(regrasDaCasa(ficha({ permiteFumar: true })).convivencia).toEqual(["Não aceita animais", "Sem festas ou eventos"]);
    expect(regrasDaCasa(ficha({ permiteFestas: true })).convivencia).toEqual(["Não aceita animais", "Proibido fumar"]);
    expect(regrasDaCasa(ficha({ aceitaAnimais: true, permiteFumar: true, permiteFestas: true })).convivencia).toEqual(["Aceita animais"]);
  });

  it("o texto livre das regras vem como está na ficha; vazio = nada", () => {
    expect(regrasDaCasa(ficha({ regrasCasa: "Silêncio depois das 22h.\nNão use a churrasqueira." })).texto).toBe("Silêncio depois das 22h.\nNão use a churrasqueira.");
    expect(regrasDaCasa(ficha({ regrasCasa: "" })).texto).toBe("");
    expect(regrasDaCasa(ficha({ regrasCasa: null })).texto).toBe("");
  });
});

describe("quando a página da cotação mostra os horários e as regras (M7.20)", () => {
  type Vista = Parameters<typeof regrasNaCotacao>[0];
  const sem = (estado: Vista["estado"], mudou = false, reserva: Vista["reserva"] = null) => regrasNaCotacao({ estado, mudou, reserva }, null);
  it("sem pagamento: aberta e válida, segurada e reserva feita mostram; expirada, cancelada e desatualizada (ou aberta que mudou) não", () => {
    expect(sem("aberta")).toBe(true);
    expect(sem("segurada")).toBe(true);
    expect(sem("convertida")).toBe(true);
    expect(sem("aberta", true)).toBe(false);
    expect(sem("desatualizada")).toBe(false);
    expect(sem("expirada")).toBe(false);
    expect(sem("cancelada")).toBe(false);
    // "sem_pagamento" vale como sem pagamento.
    expect(regrasNaCotacao({ estado: "expirada", mudou: false, reserva: null }, "sem_pagamento")).toBe(false);
    expect(regrasNaCotacao({ estado: "segurada", mudou: false, reserva: null }, "sem_pagamento")).toBe(true);
  });

  it("reserva feita sem pagamento no site e cancelada depois (a cotação continua 'convertida'): sem horários nem regras", () => {
    expect(sem("convertida", false, { estado: "confirmada" })).toBe(true);
    expect(sem("convertida", false, { estado: "pendente" })).toBe(true);
    expect(sem("convertida", false, { estado: "cancelada" })).toBe(false);
    expect(regrasNaCotacao({ estado: "convertida", mudou: false, reserva: { estado: "cancelada" } }, "sem_pagamento")).toBe(false);
  });

  it("com pagamento, a situação dele manda: oferecido, em andamento e confirmado mostram; sem as datas, devolvido e cancelado não", () => {
    const mostram: EstadoPagamentoHospede[] = ["pagar", "pix_aguardando", "pix_vencido", "pix_esgotado", "verificando", "confirmando", "cartao_desafio", "cartao_em_analise", "cartao_recusado", "confirmada"];
    const naoMostram: EstadoPagamentoHospede[] = ["aprovado_sem_datas", "devolucao_pedida", "devolvido", "cancelada_devolucao_pedida", "cancelada_devolvida", "cancelada_com_a_equipe", "cancelada_em_conferencia", "cancelada_sem_devolucao"];
    // A cotação "expirada" ou "cancelada" com um pagamento em andamento mostra (o pagamento vence a cotação, como na página).
    for (const p of mostram) expect([p, regrasNaCotacao({ estado: "expirada", mudou: false, reserva: null }, p)]).toEqual([p, true]);
    for (const p of naoMostram) expect([p, regrasNaCotacao({ estado: "segurada", mudou: false, reserva: null }, p)]).toEqual([p, false]);
    // Toda situação do pagamento tem a decisão no mapa (um estado novo exige a escolha lá, e aqui).
    expect([...mostram, ...naoMostram].sort()).toEqual(Object.keys(MOSTRA_REGRAS_NO_PAGAMENTO).sort());
  });
});
