import { describe, expect, it } from "vitest";
import { ERRO_DADOS_PESSOAIS, temDadosPessoais, textoSemDadosPessoais } from "./dados-pessoais";

// Tudo fictício: nenhum destes dados é de alguém.
describe("notas sem dados pessoais (M8.2c)", () => {
  it.each([
    ["e-mail", "pediu por fulano.exemplo@example.com"],
    ["e-mail sem o domínio completo", "respondeu de fulano@gmail"],
    ["CPF com pontos", "CPF 123.456.789-09"],
    ["CPF sem pontos", "documento 12345678909"],
    ["CNPJ", "empresa 12.345.678/0001-90"],
    ["CNPJ sem pontuação", "empresa 12345678000190"],
    ["telefone com DDD", "ligou do (21) 99999-0000"],
    ["telefone sem pontuação", "ligou do 21999990000"],
    ["telefone com espaços", "whats 21 9 9999 0000"],
    ["telefone curto", "ligar para 9999-0000"],
    ["telefone internacional", "+55 21 99999-0000"],
    ["fim de cartão", "cartão final 1234"],
    ["fim de cartão com o nome", "final do cartão: 4321"],
    ["cartão terminado em", "cartão terminado em 9876"],
    ["começo de cartão (BIN)", "bin 423564"],
    ["chave aleatória (UUID)", "Pix para 123e4567-e89b-42d3-a456-426614174000"],
    ["chave aleatória sem hífens", "chave 123e4567e89b42d3a456426614174000"],
    ["chave com CPF", "chave Pix 123.456.789-00"],
    ["chave com telefone", "chave: (21) 9999-0000"],
    ["id de transação", "e2e E12345678202610101200abcdef"],
    ["CPF digitado com vírgula, sem R$", "documento 123.456.789,09"],
  ])("recusa %s", (_, texto) => {
    expect(temDadosPessoais(texto)).toBe(true);
    expect(textoSemDadosPessoais(texto)).toBeNull();
  });

  it.each([
    "WhatsApp da empresa, 14h10",
    // O exemplo dos formulários de pedido, com a hora no padrão do Brasil (M7.22).
    "WhatsApp da empresa, 14:10",
    "pedido de 10/10",
    "pedido de 10/10/2026 às 14:10",
    "pedido de 10/10 15:00 pelo WhatsApp",
    "recebido em 2026-10-10, às 9h",
    "R$ 1.500,00",
    "devolvido R$ 150.000,00.",
    "devolvido 1.500,00 e mais R$ 1500",
    "R$ 1.500.000,00",
    "devolvido R$ 12.345.678,90.",
    "total de R$1.500.000",
    "reserva SCL-AB12, apartamento 403",
    "a chave do apartamento ficou na portaria",
    "o hóspede desistiu no final de semana",
    "",
  ])("aceita %j", (texto) => {
    expect(temDadosPessoais(texto)).toBe(false);
    expect(textoSemDadosPessoais(texto)).toBe(texto);
  });

  it("a mensagem fixa da recusa", () => {
    expect(ERRO_DADOS_PESSOAIS).toBe("Tire dados pessoais da nota (CPF, e-mail, telefone, chave Pix, cartão).");
  });

  it("uma data não esconde um telefone colado nela", () => {
    expect(temDadosPessoais("10/10 ligou 99999-0000")).toBe(true);
    expect(temDadosPessoais("21/99999/0000")).toBe(true);
  });
});
