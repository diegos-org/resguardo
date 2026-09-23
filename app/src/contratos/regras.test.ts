import { describe, expect, it } from "vitest";
import { hojeISO } from "@/lib/datas";
import { bpParaTexto, contratoVigente, percentualParaBp, sobrepoe, validarContrato } from "./regras";

describe("percentuais", () => {
  it("converte texto em pontos-base e volta", () => {
    expect(percentualParaBp("15")).toBe(1500);
    expect(percentualParaBp("12,5")).toBe(1250);
    expect(percentualParaBp("0")).toBe(0);
    expect(percentualParaBp("100")).toBe(10000);
    for (const ruim of ["101", "-1", "abc", "15,555", ""]) expect(percentualParaBp(ruim)).toBeNull();
    expect(bpParaTexto(1500)).toBe("15%");
    expect(bpParaTexto(1250)).toBe("12,5%");
    expect(bpParaTexto(null)).toBe("a definir");
  });
});

describe("vigência", () => {
  // Caso real registrado nos requisitos: 102/303/399 voltam a 15/85 em 01/01/2027.
  const historico = [
    { tipo: "gestao_completa" as const, comissaoBp: 2000, inicio: "2025-01-01", fim: "2026-12-31" },
    { tipo: "gestao_completa" as const, comissaoBp: 1500, inicio: "2027-01-01", fim: null },
  ];

  it("escolhe o contrato do dia, sem recalcular o passado", () => {
    expect(contratoVigente(historico, "2026-12-31")?.comissaoBp).toBe(2000);
    expect(contratoVigente(historico, "2027-01-01")?.comissaoBp).toBe(1500);
    expect(contratoVigente(historico, "2024-06-01")).toBeNull();
  });

  it("detecta sobreposição, inclusive com contrato sem fim", () => {
    expect(sobrepoe(historico[0], historico[1])).toBe(false);
    expect(sobrepoe(historico[1], { tipo: "gestao_online", comissaoBp: 1000, inicio: "2030-01-01", fim: null })).toBe(true);
    expect(sobrepoe(historico[0], { tipo: "gestao_online", comissaoBp: 1000, inicio: "2026-12-31", fim: "2026-12-31" })).toBe(true);
  });
});

describe("validarContrato", () => {
  it("aceita contrato válido", () => {
    expect(validarContrato({ tipo: "gestao_online", comissao: "10", inicio: "2026-10-01" }, [])).toEqual({
      ok: true,
      dados: { tipo: "gestao_online", comissaoBp: 1000, inicio: "2026-10-01", fim: null, observacoes: "" },
    });
  });

  it("marketplace pode ficar sem percentual (fórmula pendente); os outros não", () => {
    expect(validarContrato({ tipo: "marketplace", inicio: "2026-10-01" }, []).ok).toBe(true);
    const r = validarContrato({ tipo: "gestao_completa", inicio: "2026-10-01" }, []);
    expect(!r.ok && r.erros.comissao).toBeTruthy();
  });

  it("rejeita datas inválidas, fim antes do início e sobreposição", () => {
    const r1 = validarContrato({ tipo: "gestao_completa", comissao: "15", inicio: "2026-02-30", fim: "x" }, []);
    expect(!r1.ok && Object.keys(r1.erros).sort()).toEqual(["fim", "inicio"]);
    const r2 = validarContrato({ tipo: "gestao_completa", comissao: "15", inicio: "2026-10-10", fim: "2026-10-01" }, []);
    expect(!r2.ok && r2.erros.fim).toBeTruthy();
    const r3 = validarContrato({ tipo: "gestao_completa", comissao: "15", inicio: "2026-10-01" }, [
      { tipo: "gestao_completa", comissaoBp: 1500, inicio: "2026-01-01", fim: null },
    ]);
    expect(!r3.ok && r3.erros.geral).toMatch(/Conflita/);
  });
});

describe("hojeISO", () => {
  it("usa o fuso de São Paulo", () => {
    expect(hojeISO(undefined, new Date("2027-01-01T02:00:00Z"))).toBe("2026-12-31");
  });
});
