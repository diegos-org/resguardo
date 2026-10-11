import { describe, expect, it } from "vitest";
import { formatBRL } from "@/lib/money";
import { DESFECHOS_PAGAMENTO, ORIGENS_DEVOLUCAO, SITUACOES_DEVOLUCAO, SITUACOES_PAGAMENTO } from "@/db/schema";
import { AVISOS_DE_CONTESTACAO } from "./contestacao-regras";
import {
  AVISOS_DE_DEVOLUCAO, AVISOS_PAGAMENTO, CODIGOS_FALHA_DO_PROVEDOR, CODIGOS_TOKEN, codigoMotivo, MOTIVO_RECUSA_CARTAO_GENERICO, MOTIVOS_RECUSA_CARTAO, MOTIVOS_SEM_RESERVA, motivoDoDetalhe,
  NOMES_DESFECHO, origemDeDevolucaoConhecida, ORIGENS_DEVOLUCAO_CONHECIDAS, situacaoLocal, textoContestacaoComDevolucao, textoContestacaoValorAcima, textoContestacaoValorMudou,
  textoDevolucaoAguardandoLiberacaoAtrasada, textoDoAvisoContestado, textoMotivoRecusaCartao, textoMotivoSemReserva, textosDosAvisos, transicaoPermitida,
} from "./situacoes";

describe("situações e transições do pagamento (M8.2a)", () => {
  it("tabela de transições (só por leitura do provedor): dinheiro vence ausência de dinheiro", () => {
    const permitidas = Object.fromEntries(SITUACOES_PAGAMENTO.map((de) => [de, SITUACOES_PAGAMENTO.filter((para) => transicaoPermitida(de, para))]));
    expect(permitidas).toEqual({
      criando: ["pendente", "aprovado", "recusado", "cancelado", "expirado", "devolvido", "devolvido_parcial", "contestado"],
      incerta: ["pendente", "aprovado", "recusado", "cancelado", "expirado", "devolvido", "devolvido_parcial", "contestado"],
      pendente: ["aprovado", "recusado", "cancelado", "expirado", "devolvido", "devolvido_parcial", "contestado"],
      aprovado: ["devolvido", "devolvido_parcial", "contestado"],
      recusado: ["aprovado", "devolvido", "devolvido_parcial", "contestado"],
      cancelado: ["aprovado", "devolvido", "devolvido_parcial", "contestado"],
      expirado: ["aprovado", "devolvido", "devolvido_parcial", "contestado"],
      devolvido: [],
      devolvido_parcial: ["devolvido", "contestado"],
      contestado: [],
    });
  });

  it("situação do provedor → local: em análise segue pendente; desconhecido não vira nada", () => {
    expect(situacaoLocal("em_analise")).toBe("pendente");
    expect(situacaoLocal("aprovado")).toBe("aprovado");
    expect(situacaoLocal("desconhecido")).toBeNull();
  });

  it("motivos e avisos de lista fechada", () => {
    expect(codigoMotivo("conflito:SCL-ABC123")).toBe("conflito");
    expect(codigoMotivo("qualquer")).toBe("outro");
    expect(codigoMotivo(null)).toBeNull();
    expect(textoMotivoSemReserva("conflito:SCL-ABC123")).toBe("As noites ficaram ocupadas pela reserva SCL-ABC123.");
    expect(textoMotivoSemReserva("conflito:bloqueio")).toBe("As noites ficaram ocupadas por um bloqueio.");
    expect(textoMotivoSemReserva("noites_ocupadas:agenda_externa")).toContain("agenda lida do Beds24");
    expect(textoMotivoSemReserva("valor_divergente")).toBe(MOTIVOS_SEM_RESERVA.valor_divergente);
    expect(textosDosAvisos(["ao_vivo", "inventado"])).toEqual([AVISOS_PAGAMENTO.ao_vivo]);
  });

  it("avisos do cartão (M8.2b) em lista fechada; o do cancelamento pendente vale para qualquer forma", () => {
    for (const c of ["parcelas_sem_juros", "custo_parcelas_desconhecido", "liberacao_em_parcelas", "desafio_sem_url", "outra_reserva_mesmo_email"] as const) expect(textosDosAvisos([c])).toEqual([AVISOS_PAGAMENTO[c]]);
    expect(AVISOS_PAGAMENTO.parcelas_sem_juros).toContain("parcelamento sem acréscimo");
    expect(AVISOS_PAGAMENTO.cancelamento_pendente).toContain("um pagamento que ficou sobrando");
    expect(AVISOS_PAGAMENTO.cancelamento_pendente).not.toContain("Pix");
  });
});

describe("alteração de reserva paga (M8.2d): listas fechadas", () => {
  it("origem `alteracao` conhecida (a do schema e a do domínio são as mesmas); origem de versão mais nova continua ignorada", () => {
    expect([...ORIGENS_DEVOLUCAO_CONHECIDAS]).toEqual([...ORIGENS_DEVOLUCAO]);
    expect(origemDeDevolucaoConhecida("alteracao")).toBe(true);
    expect(origemDeDevolucaoConhecida("de_uma_versao_futura")).toBe(false);
    expect(SITUACOES_DEVOLUCAO).toContain("substituida");
  });

  it("desfecho da diferença com nome; os motivos sem reserva da diferença, com o código e a reserva que ocupou", () => {
    expect(DESFECHOS_PAGAMENTO).toContain("alteracao");
    expect(NOMES_DESFECHO.alteracao).toBe("Diferença de uma alteração da reserva");
    for (const m of ["alteracao_noites_ocupadas", "alteracao_sem_leitura", "alteracao_desistida", "alteracao_reserva_mudou", "alteracao_nao_aplicada"] as const) {
      expect(codigoMotivo(m)).toBe(m);
      expect(textoMotivoSemReserva(m)).toBe(MOTIVOS_SEM_RESERVA[m]);
    }
    expect(codigoMotivo("alteracao_nao_aplicada:estadia_iniciada")).toBe("alteracao_nao_aplicada");
    expect(textoMotivoSemReserva("alteracao_nao_aplicada:financeiro_movimentado")).toBe(MOTIVOS_SEM_RESERVA.alteracao_nao_aplicada);
    expect(textoMotivoSemReserva("alteracao_noites_ocupadas:SCL-ABC123")).toBe("Diferença de uma alteração aprovada depois do prazo, com as novas noites já ocupadas pela reserva SCL-ABC123: a reserva continua como estava.");
    expect(textoMotivoSemReserva("alteracao_noites_ocupadas:agenda_externa")).toContain("pela agenda lida do Beds24");
  });

  it("aviso da devolução que espera a liberação passada a data prevista, com e sem o valor; os avisos de devolução em lista", () => {
    expect(textosDosAvisos(["devolucao_aguardando_liberacao_atrasada"])).toEqual([AVISOS_PAGAMENTO.devolucao_aguardando_liberacao_atrasada]);
    expect(textoDevolucaoAguardandoLiberacaoAtrasada(30_000)).toBe(
      `A liberação deste pagamento passou da data prevista e a devolução de ${formatBRL(30_000)} continua esperando: confira no painel do Mercado Pago e registre a liberação à mão quando ela aparecer.`,
    );
    expect(AVISOS_DE_DEVOLUCAO).toEqual(expect.arrayContaining(["devolucao_falhou", "devolucao_a_menor", "taxa_perdida_desconhecida", "devolucao_aguardando_liberacao_atrasada"]));
    for (const a of AVISOS_DE_DEVOLUCAO) expect(AVISOS_PAGAMENTO[a], a).toBeTruthy();
    expect(AVISOS_DE_DEVOLUCAO).not.toContain("devolvido_por_fora");
  });
});

describe("motivo de recusa do cartão (M8.2b, só para a equipe)", () => {
  it("todos os status_detail documentados da Orders têm texto; nomes da Payments API e códigos desconhecidos caem no genérico", () => {
    for (const c of [
      "bad_filled_card_data", "invalid_card_token", "high_risk", "rejected_by_issuer", "required_call_for_authorize", "max_attempts_exceeded", "card_disabled",
      "insufficient_amount", "card_insufficient_amount", "amount_limit_exceeded", "processing_error", "invalid_installments", "3ds_challenge_expired", "cc_rejected_3ds_challenge",
    ]) {
      expect(MOTIVOS_RECUSA_CARTAO[c]).toBeTruthy();
      expect(textoMotivoRecusaCartao(c)).toBe(MOTIVOS_RECUSA_CARTAO[c]);
    }
    for (const c of ["bad_filled_security_code", "blacklist", "constructor", "toString", "x", null]) expect(textoMotivoRecusaCartao(c)).toBe(MOTIVO_RECUSA_CARTAO_GENERICO);
    expect(CODIGOS_TOKEN).toEqual(["invalid_card_token", "card_token_not_found", "invalid_token"]);
    expect(CODIGOS_FALHA_DO_PROVEDOR).toEqual(["processing_error"]);
    for (const c of CODIGOS_TOKEN) expect(MOTIVOS_RECUSA_CARTAO[c]).toBeTruthy();
  });

  it("código do motivo no detalhe gravado: o último código, nos três formatos", () => {
    expect(motivoDoDetalhe("failed/failed; pagamento failed/rejected_by_issuer")).toBe("rejected_by_issuer");
    expect(motivoDoDetalhe("failed/failed")).toBe("failed");
    expect(motivoDoDetalhe("recusado/high_risk")).toBe("high_risk");
    expect(motivoDoDetalhe("dados_invalidos/invalid_card_token")).toBe("invalid_card_token");
    expect(motivoDoDetalhe("failed/failed; pagamento failed/3ds_challenge_expired")).toBe("3ds_challenge_expired");
    for (const sem of ["recusado/?", "dados_invalidos/?", "", "failed/<script>", null, undefined]) expect(motivoDoDetalhe(sem)).toBeNull();
  });
});

describe("disputa do pagamento (M8.2e): avisos e textos", () => {
  it("cada aviso de contestação tem texto (sem Beds24 e sem a palavra do hóspede); o aviso contestado por tipo; o desfecho da disputa perdida sem reserva", () => {
    expect(textosDosAvisos(AVISOS_DE_CONTESTACAO)).toHaveLength(AVISOS_DE_CONTESTACAO.length);
    for (const c of AVISOS_DE_CONTESTACAO) expect(AVISOS_PAGAMENTO[c]).not.toMatch(/beds24/i);
    expect(AVISOS_PAGAMENTO.contestacao_prazo_desconhecido).toBe("Prazo dos documentos desconhecido: confira no painel do Mercado Pago e informe aqui.");
    expect(AVISOS_PAGAMENTO.contestacao_liberacao_lida).toBe("O Mercado Pago mostra a liberação de um pagamento em disputa: registre a liberação à mão com o líquido do pagamento que caiu na conta.");
    expect(AVISOS_PAGAMENTO.contestacao_caso_de_outro_pagamento).toContain("Este caso é de outro pagamento no Mercado Pago");
    expect(textoDoAvisoContestado("chargeback")).toBe("Pagamento contestado no cartão: acompanhe no quadro da disputa.");
    expect(textoDoAvisoContestado("med")).toBe("Devolução pedida pelo Pix (MED): acompanhe no quadro da disputa.");
    expect(textoDoAvisoContestado("reclamacao")).toBe("Reclamação no Mercado Pago: acompanhe no quadro da disputa.");
    expect(textoDoAvisoContestado(null)).toBe(AVISOS_PAGAMENTO.contestado);
    expect(AVISOS_PAGAMENTO.situacao_inesperada).toContain("acompanhe a disputa pelo quadro do pagamento");
    expect(NOMES_DESFECHO.contestacao).toBe("Voltou ao pagador pela disputa");
  });

  it("os avisos com valores: acima da reserva, valor mudou depois da decisão e devolução já feita", () => {
    expect(textoContestacaoValorAcima(104_000, 100_000)).toBe(
      "O valor contestado (R$ 1.040,00) passa do valor da reserva (R$ 1.000,00): pode incluir os juros do parcelamento; confira no painel do Mercado Pago quanto saiu da conta.",
    );
    expect(textoContestacaoValorMudou(100_000, 80_000, 85_000)).toBe("O valor em disputa mudou de R$ 1.000,00 para R$ 800,00: o valor segurado continua R$ 850,00.");
    expect(textoContestacaoComDevolucao(20_000, "05/12", 100_000)).toBe(
      "O hóspede pode receber duas vezes: a devolução de R$ 200,00 (05/12) e a disputa de R$ 1.000,00. Envie o comprovante da devolução ao Mercado Pago como defesa e confira quanto ele debitou.",
    );
  });
});
