import { describe, expect, it } from "vitest";
import { FOLGA_LEITURA_CARTAO_ENCERRADO_MS, FOLGA_LEITURA_PIX_ENCERRADO_MS, paginaAindaLe, PRAZO_RELEITURA_DIAS } from "./andamento";
import { DESAFIO_3DS_MINUTOS } from "./provedor";
import { AGORA, minutos } from "./testes";

const base = { idProvedor: "ORDTST0001", pixExpiraEm: null, criadoEm: AGORA, encerradoEm: null };

describe("a página ainda lê a tentativa? (M8.2b: pela forma)", () => {
  it("em andamento (Pix ou cartão): sim, dentro do prazo de releitura", () => {
    for (const forma of ["pix", "cartao"] as const)
      for (const situacao of ["criando", "incerta", "pendente"] as const) {
        expect(paginaAindaLe({ ...base, forma, situacao }, minutos(60))).toBe(true);
        expect(paginaAindaLe({ ...base, forma, situacao }, minutos((PRAZO_RELEITURA_DIAS + 1) * 24 * 60))).toBe(false);
      }
  });

  it("cartão recusado: nunca (uma order failed não volta; nada se relê antes de cada tentativa nova)", () => {
    expect(paginaAindaLe({ ...base, forma: "cartao", situacao: "recusado", encerradoEm: AGORA }, minutos(1))).toBe(false);
  });

  it("cartão cancelado ou vencido (desafio): até o encerramento + 15 min; sem encerramento, a criação + 40 min + 15 min; sem order, nunca", () => {
    for (const situacao of ["cancelado", "expirado"] as const) {
      const fechado = { ...base, forma: "cartao" as const, situacao, encerradoEm: minutos(10) };
      expect(paginaAindaLe(fechado, minutos(24))).toBe(true);
      expect(paginaAindaLe(fechado, new Date(minutos(10).getTime() + FOLGA_LEITURA_CARTAO_ENCERRADO_MS))).toBe(false);
      const semEncerramento = { ...fechado, encerradoEm: null };
      expect(paginaAindaLe(semEncerramento, minutos(DESAFIO_3DS_MINUTOS + 14))).toBe(true);
      expect(paginaAindaLe(semEncerramento, minutos(DESAFIO_3DS_MINUTOS + 15))).toBe(false);
      expect(paginaAindaLe({ ...fechado, idProvedor: null }, minutos(11))).toBe(false);
    }
  });

  it("Pix: como antes (até o prazo do Pix + 15 min, inclusive recusado)", () => {
    const pix = { ...base, forma: "pix" as const, pixExpiraEm: minutos(30), encerradoEm: minutos(31) };
    for (const situacao of ["recusado", "cancelado", "expirado"] as const) {
      expect(paginaAindaLe({ ...pix, situacao }, minutos(44))).toBe(true);
      expect(paginaAindaLe({ ...pix, situacao }, new Date(minutos(30).getTime() + FOLGA_LEITURA_PIX_ENCERRADO_MS))).toBe(false);
    }
    expect(paginaAindaLe({ ...pix, situacao: "aprovado" }, minutos(1))).toBe(false);
  });
});
