import { describe, expect, it } from "vitest";
import { SITUACOES_PAGAMENTO } from "@/db/schema";
import {
  AVISOS_PAGAMENTO, CODIGOS_FALHA_DO_PROVEDOR, CODIGOS_TOKEN, codigoMotivo, MOTIVO_RECUSA_CARTAO_GENERICO, MOTIVOS_RECUSA_CARTAO, MOTIVOS_SEM_RESERVA, motivoDoDetalhe, situacaoLocal,
  textoMotivoRecusaCartao, textoMotivoSemReserva, textosDosAvisos, transicaoPermitida,
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
    for (const c of ["parcelas_sem_juros", "liberacao_em_parcelas", "desafio_sem_url", "outra_reserva_mesmo_email"] as const) expect(textosDosAvisos([c])).toEqual([AVISOS_PAGAMENTO[c]]);
    expect(AVISOS_PAGAMENTO.parcelas_sem_juros).toContain("parcelamento sem acréscimo");
    expect(AVISOS_PAGAMENTO.cancelamento_pendente).toContain("um pagamento que ficou sobrando");
    expect(AVISOS_PAGAMENTO.cancelamento_pendente).not.toContain("Pix");
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
