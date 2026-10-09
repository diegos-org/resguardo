import { describe, expect, it } from "vitest";
import { SITUACOES_PAGAMENTO } from "@/db/schema";
import { AVISOS_PAGAMENTO, codigoMotivo, MOTIVOS_SEM_RESERVA, situacaoLocal, textoMotivoSemReserva, textosDosAvisos, transicaoPermitida } from "./situacoes";

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
});
