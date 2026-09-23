import { describe, expect, it } from "vitest";
import { cnpjValido, cpfValido, formatarDocumento, mascararDocumento } from "./documento";

// Números de teste gerados para validação (não pertencem a pessoas reais conhecidas).
const CPF = "52998224725";
const CNPJ = "11222333000181";

describe("documentos", () => {
  it("valida CPF e CNPJ pelos dígitos verificadores", () => {
    expect(cpfValido(CPF)).toBe(true);
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("52998224724")).toBe(false);
    expect(cpfValido("11111111111")).toBe(false);
    expect(cnpjValido(CNPJ)).toBe(true);
    expect(cnpjValido("11222333000182")).toBe(false);
    expect(cnpjValido("00000000000000")).toBe(false);
  });

  it("formata e mascara", () => {
    expect(formatarDocumento(CPF)).toBe("529.982.247-25");
    expect(formatarDocumento(CNPJ)).toBe("11.222.333/0001-81");
    expect(mascararDocumento(CPF)).toBe("•••.•••.247-25");
    expect(mascararDocumento(CNPJ)).toBe("••.•••.•••/0001-81");
    expect(mascararDocumento("")).toBe("");
  });
});
