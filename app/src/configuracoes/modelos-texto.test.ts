import { describe, expect, it } from "vitest";
import { TIPOS_MENSAGEM_HOSPEDE } from "@/db/schema";
import {
  EXEMPLO,
  NOMES_TIPO,
  ONDE_VALE,
  ondeVale,
  preencherModelo,
  problemaDoModeloNoTipo,
  ehMensagemDeAlteracao,
  ehMensagemDeCancelamento,
  TEXTOS_BASE_ALTERACAO,
  TEXTOS_BASE_CANCELAMENTO,
  TIPOS_MENSAGEM_ALTERACAO,
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
      // M8.2d: a devolução feita serve também à devolução da diferença de uma alteração.
      "Devolução feita (cancelamento ou alteração)",
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
    expect(problemaDoModeloNoTipo("devolucao_concluida", "{valor} {decisao}")).toBe("“Devolução feita (cancelamento ou alteração)” não pode usar {decisao}: essa variável só vale em “Cancelamento: decisão”.");
    expect(problemaDoModeloNoTipo("confirmacao", "Olá, {hospede}! {recebido}")).toContain("não pode usar {recebido}");
    expect(problemaDoModeloNoTipo("checkin", "Olá! {link}")).toContain("não pode usar {link}");
    expect(variaveisForaDoLugar("agradecimento", "{valor} {data} {hospede}")).toEqual(["valor", "data"]);
    // {valor}, {data} e {comovolta} só existem com a devolução feita (na decisão sairiam vazios e travariam a mensagem).
    expect(variaveisForaDoLugar("cancelamento_decidido", "{recebido} {decisao} {valor} {data} {comovolta} {link}")).toEqual(["valor", "data", "comovolta"]);
    expect(variaveisForaDoLugar("cancelamento_decidido", "{recebido} {decisao} {link}")).toEqual([]);
    expect(problemaDoModeloNoTipo("cancelamento_decidido", "A reserva {codigo} foi cancelada. {decisao} Valor: {valor}.")).toBe("“Cancelamento: decisão” não pode usar {valor}: essa variável só vale em “Devolução feita (cancelamento ou alteração)”.");
    expect(variaveisForaDoLugar("devolucao_concluida", "{valor} {data} {comovolta} {link}")).toEqual([]);
    expect(variaveisForaDoLugar("cancelamento_recebido", "{recebido} {link} {hospede} {codigo}")).toEqual([]);
    // Toda variável com restrição vale em algum tipo de cancelamento.
    for (const [v, tipos] of Object.entries(ONDE_VALE)) expect(tipos!.length, v).toBeGreaterThan(0);
  });

  it("variáveis obrigatórias e o endereço", () => {
    expect(problemaDoModeloNoTipo("cancelamento_recebido", "Recebemos o seu pedido da reserva {codigo}.")).toBe("“Cancelamento: pedido recebido” precisa usar {recebido}.");
    expect(problemaDoModeloNoTipo("cancelamento_recebido", "Recebemos o seu pedido.")).toBe("“Cancelamento: pedido recebido” precisa usar {codigo} e {recebido}.");
    expect(problemaDoModeloNoTipo("devolucao_concluida", "A devolução foi feita em {data}.")).toBe("“Devolução feita (cancelamento ou alteração)” precisa usar {valor}.");
    expect(problemaDoModeloNoTipo("cancelamento_decidido", "A reserva {codigo} foi cancelada.")).toBeNull();
    expect(problemaDoModeloNoTipo("cancelamento_decidido", "{decisao} O endereço era {endereco}.")).toBe("“Cancelamento: decisão” não pode usar {endereco}: uma reserva cancelada não recebe o endereço.");
    expect(problemaDoModeloNoTipo("confirmacao", "Endereço: {endereco}")).toBe("A confirmação não pode usar {endereco}: o endereço só é enviado 2 dias antes da entrada (use no modelo de check-in).");
    expect(problemaDoModeloNoTipo("checkin", "Endereço: {endereco}")).toBeNull();
  });
});

describe("mensagens da alteração (M8.2d) nos modelos de mensagem", () => {
  it("dois tipos novos com nome e a variável {alteracao} (sem sublinhado, com exemplo)", () => {
    expect(TIPOS_MENSAGEM_ALTERACAO).toEqual(["alteracao_proposta", "alteracao_confirmada"]);
    for (const t of TIPOS_MENSAGEM_ALTERACAO) {
      expect(TIPOS_MENSAGEM_HOSPEDE).toContain(t);
      expect(ehMensagemDeAlteracao(t)).toBe(true);
      expect(ehMensagemDeCancelamento(t)).toBe(false);
    }
    expect(ehMensagemDeAlteracao("devolucao_concluida")).toBe(false);
    expect([NOMES_TIPO.alteracao_proposta, NOMES_TIPO.alteracao_confirmada]).toEqual(["Alteração: proposta (e pagamento da diferença, se houver)", "Alteração: confirmada"]);
    expect(VARIAVEIS.alteracao).toBe("Alteração da reserva, em frases prontas, com o prazo das datas seguradas");
    expect("alteracao").toMatch(/^[a-z]+$/);
    expect(preencherModelo("{alteracao} {link}", EXEMPLO)).toBe(`${EXEMPLO.alteracao} ${EXEMPLO.link}`);
    expect(EXEMPLO.alteracao).not.toMatch(/beds24/i);
  });

  it("textos-base válidos para o próprio tipo, com {alteracao} e {link}", () => {
    for (const t of TIPOS_MENSAGEM_ALTERACAO) {
      expect(validarModelo({ nome: NOMES_TIPO[t], texto: TEXTOS_BASE_ALTERACAO[t] }).ok, t).toBe(true);
      expect(problemaDoModeloNoTipo(t, TEXTOS_BASE_ALTERACAO[t]), t).toBeNull();
      expect(TEXTOS_BASE_ALTERACAO[t], t).not.toMatch(/beds24|\{endereco\}|\{valor\}/i);
    }
    expect(TEXTOS_BASE_ALTERACAO.alteracao_proposta).toBe("Olá, {hospede}! Preparamos a alteração da sua reserva {codigo}: {alteracao} Veja os detalhes em {link}. Até a confirmação, a reserva continua como está.");
    expect(TEXTOS_BASE_ALTERACAO.alteracao_confirmada).toBe("Olá, {hospede}! A alteração da sua reserva {codigo} está confirmada: {alteracao} Acompanhe em {link}. Qualquer dúvida, é só responder esta mensagem.");
  });

  it("{alteracao} só nas mensagens da alteração; {link} vale nelas; as do cancelamento, não", () => {
    expect(problemaDoModeloNoTipo("confirmacao", "Olá! {alteracao}")).toBe(
      "“Confirmação da reserva” não pode usar {alteracao}: essa variável só vale em “Alteração: proposta (e pagamento da diferença, se houver)” e “Alteração: confirmada”.",
    );
    expect(variaveisForaDoLugar("cancelamento_decidido", "{decisao} {alteracao}")).toEqual(["alteracao"]);
    expect(variaveisForaDoLugar("alteracao_proposta", "{alteracao} {link} {hospede} {codigo} {checkin}")).toEqual([]);
    expect(variaveisForaDoLugar("alteracao_confirmada", "{alteracao} {recebido} {decisao} {valor}")).toEqual(["recebido", "decisao", "valor"]);
    expect(ONDE_VALE.link).toEqual([...TIPOS_MENSAGEM_CANCELAMENTO, ...TIPOS_MENSAGEM_ALTERACAO]);
    // A frase de onde a variável vale (a da escolha do modelo e a do aviso do envio): os nomes, tirados de ONDE_VALE.
    expect(ondeVale("alteracao")).toBe("“Alteração: proposta (e pagamento da diferença, se houver)” e “Alteração: confirmada”");
    expect(ondeVale("valor")).toBe("“Devolução feita (cancelamento ou alteração)”");
    expect(ondeVale("link")).toBe(
      "“Cancelamento: pedido recebido”, “Cancelamento: decisão”, “Devolução feita (cancelamento ou alteração)”, “Alteração: proposta (e pagamento da diferença, se houver)” e “Alteração: confirmada”",
    );
    expect(ondeVale("hospede")).toBe("");
  });

  it("obrigatórias: a proposta usa {alteracao} e {link}; a confirmação, {alteracao}; nenhuma das duas usa {endereco}", () => {
    expect(problemaDoModeloNoTipo("alteracao_proposta", "Olá, {hospede}! {alteracao}")).toBe("“Alteração: proposta (e pagamento da diferença, se houver)” precisa usar {link}.");
    expect(problemaDoModeloNoTipo("alteracao_proposta", "Olá, {hospede}!")).toBe("“Alteração: proposta (e pagamento da diferença, se houver)” precisa usar {alteracao} e {link}.");
    expect(problemaDoModeloNoTipo("alteracao_confirmada", "Olá, {hospede}! Confirmada.")).toBe("“Alteração: confirmada” precisa usar {alteracao}.");
    expect(problemaDoModeloNoTipo("alteracao_confirmada", "{alteracao}")).toBeNull();
    expect(problemaDoModeloNoTipo("alteracao_confirmada", "{alteracao} Endereço: {endereco}")).toBe("“Alteração: confirmada” não pode usar {endereco}: o endereço só é enviado 2 dias antes da entrada (use no modelo de check-in).");
    // A devolução feita de uma alteração usa o mesmo modelo do cancelamento (só {valor} obrigatório).
    expect(problemaDoModeloNoTipo("devolucao_concluida", TEXTOS_BASE_CANCELAMENTO.devolucao_concluida)).toBeNull();
  });
});
