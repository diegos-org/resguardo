import { describe, expect, it } from "vitest";
import { TIPOS_MENSAGEM_HOSPEDE } from "@/db/schema";
import {
  EXEMPLO,
  NOMES_TIPO,
  ONDE_VALE,
  preencherModelo,
  problemaDoModeloNoTipo,
  TEXTOS_BASE_CANCELAMENTO,
  TIPOS_MENSAGEM_CANCELAMENTO,
  validarModelo,
  VARIAVEIS,
  variaveisForaDoLugar,
} from "./modelos-texto";

describe("mensagens do cancelamento (M8.2c) nos modelos de mensagem", () => {
  it("três tipos novos com nome, e as variáveis novas sem sublinhado (o preenchimento lê só letras)", () => {
    expect(TIPOS_MENSAGEM_CANCELAMENTO).toEqual(["cancelamento_recebido", "cancelamento_decidido", "devolucao_concluida"]);
    for (const t of TIPOS_MENSAGEM_CANCELAMENTO) expect(TIPOS_MENSAGEM_HOSPEDE).toContain(t);
    expect([NOMES_TIPO.cancelamento_recebido, NOMES_TIPO.cancelamento_decidido, NOMES_TIPO.devolucao_concluida]).toEqual([
      "Cancelamento: pedido recebido",
      "Cancelamento: decisão",
      "Cancelamento: devolução feita",
    ]);
    for (const v of ["recebido", "decisao", "valor", "data", "comovolta", "link"] as const) {
      expect(VARIAVEIS[v], v).toBeTruthy();
      expect(v).toMatch(/^[a-z]+$/);
      expect(EXEMPLO[v], v).toBeTruthy();
    }
    expect(preencherModelo("Recebido em {recebido}. {decisao} {valor} em {data}. {comovolta} {link}", EXEMPLO)).toBe(
      `Recebido em ${EXEMPLO.recebido}. ${EXEMPLO.decisao} ${EXEMPLO.valor} em ${EXEMPLO.data}. ${EXEMPLO.comovolta} ${EXEMPLO.link}`,
    );
    // Salvar o modelo aceita as variáveis novas (onde cada uma vale é conferido ao escolher o modelo para a mensagem).
    expect(validarModelo({ nome: "Pedido recebido", texto: "Olá, {hospede}! {codigo} em {recebido}. {link}" }).ok).toBe(true);
  });

  it("textos-base válidos para o próprio tipo e sem dado que não cabe nele", () => {
    for (const t of TIPOS_MENSAGEM_CANCELAMENTO) {
      expect(validarModelo({ nome: NOMES_TIPO[t], texto: TEXTOS_BASE_CANCELAMENTO[t] }).ok, t).toBe(true);
      expect(problemaDoModeloNoTipo(t, TEXTOS_BASE_CANCELAMENTO[t]), t).toBeNull();
      expect(TEXTOS_BASE_CANCELAMENTO[t], t).not.toMatch(/beds24|\{endereco\}/i);
    }
    expect(TEXTOS_BASE_CANCELAMENTO.cancelamento_recebido).not.toContain("{valor}");
    expect(TEXTOS_BASE_CANCELAMENTO.cancelamento_decidido).toBe("Olá, {hospede}! A reserva {codigo} foi cancelada. {decisao} Acompanhe em {link}. Qualquer dúvida, é só responder esta mensagem.");
  });

  it("onde cada variável vale: {valor} nunca no pedido recebido; {decisao} só na decisão; as do cancelamento fora das outras mensagens", () => {
    expect(problemaDoModeloNoTipo("cancelamento_recebido", "{codigo} {recebido} {valor}")).toBe(
      "“Cancelamento: pedido recebido” não pode usar {valor}: essa mensagem é copiada pela operação, que não vê valores, e o valor só existe depois da decisão.",
    );
    expect(problemaDoModeloNoTipo("devolucao_concluida", "{valor} {decisao}")).toBe("“Cancelamento: devolução feita” não pode usar {decisao}: essa variável só vale em “Cancelamento: decisão”.");
    expect(problemaDoModeloNoTipo("confirmacao", "Olá, {hospede}! {recebido}")).toContain("não pode usar {recebido}");
    expect(problemaDoModeloNoTipo("checkin", "Olá! {link}")).toContain("não pode usar {link}");
    expect(variaveisForaDoLugar("agradecimento", "{valor} {data} {hospede}")).toEqual(["valor", "data"]);
    expect(variaveisForaDoLugar("cancelamento_decidido", "{recebido} {decisao} {valor} {data} {comovolta} {link}")).toEqual([]);
    expect(variaveisForaDoLugar("cancelamento_recebido", "{recebido} {link} {hospede} {codigo}")).toEqual([]);
    // Toda variável com restrição vale em algum tipo de cancelamento.
    for (const [v, tipos] of Object.entries(ONDE_VALE)) expect(tipos!.length, v).toBeGreaterThan(0);
  });

  it("variáveis obrigatórias e o endereço", () => {
    expect(problemaDoModeloNoTipo("cancelamento_recebido", "Recebemos o seu pedido da reserva {codigo}.")).toBe("“Cancelamento: pedido recebido” precisa usar {recebido}.");
    expect(problemaDoModeloNoTipo("cancelamento_recebido", "Recebemos o seu pedido.")).toBe("“Cancelamento: pedido recebido” precisa usar {codigo} e {recebido}.");
    expect(problemaDoModeloNoTipo("devolucao_concluida", "A devolução foi feita em {data}.")).toBe("“Cancelamento: devolução feita” precisa usar {valor}.");
    expect(problemaDoModeloNoTipo("cancelamento_decidido", "A reserva {codigo} foi cancelada.")).toBeNull();
    expect(problemaDoModeloNoTipo("cancelamento_decidido", "{decisao} O endereço era {endereco}.")).toBe("“Cancelamento: decisão” não pode usar {endereco}: uma reserva cancelada não recebe o endereço.");
    expect(problemaDoModeloNoTipo("confirmacao", "Endereço: {endereco}")).toBe("A confirmação não pode usar {endereco}: o endereço só é enviado 2 dias antes da entrada (use no modelo de check-in).");
    expect(problemaDoModeloNoTipo("checkin", "Endereço: {endereco}")).toBeNull();
  });
});
