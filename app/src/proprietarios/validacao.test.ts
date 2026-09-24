import { describe, expect, it } from "vitest";
import { validarProprietario, validarRepresentante } from "./validacao";

describe("validarProprietario", () => {
  it("aceita pessoa física com CPF formatado e normaliza", () => {
    const r = validarProprietario({ nome: " Maria Teste ", documento: "529.982.247-25", email: "Maria@Example.com", telefone: "(21) 99999-0000", ativo: "on" });
    expect(r.ok && r.dados).toMatchObject({ nome: "Maria Teste", tipo: "fisica", documento: "52998224725", email: "maria@example.com", ativo: true });
  });

  it("documento é opcional, mas se vier precisa ser válido para o tipo", () => {
    expect(validarProprietario({ nome: "Sem doc", email: "semdoc@example.com" }).ok).toBe(true);
    const r = validarProprietario({ nome: "Empresa", tipo: "juridica", documento: "52998224725" });
    expect(!r.ok && r.erros.documento).toBe("CNPJ inválido.");
  });

  it("e-mail é obrigatório", () => {
    const r = validarProprietario({ nome: "Sem e-mail" });
    expect(!r.ok && r.erros.email).toContain("Informe o e-mail");
  });

  it("aponta nome, e-mail e telefone inválidos", () => {
    const r = validarProprietario({ nome: "", email: "x@", telefone: "123" });
    expect(!r.ok && Object.keys(r.erros).sort()).toEqual(["email", "nome", "telefone"]);
  });
});

describe("validarRepresentante", () => {
  it("exige nome e valida contato", () => {
    expect(validarRepresentante({ nome: "Ana", relacao: "cônjuge", recebeRelatorios: "on" })).toEqual({
      ok: true,
      dados: { nome: "Ana", relacao: "cônjuge", email: "", telefone: "", recebeRelatorios: true },
    });
    expect(validarRepresentante({ nome: "" }).ok).toBe(false);
  });
});
