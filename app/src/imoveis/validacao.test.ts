import { describe, expect, it } from "vitest";
import { validarImovel } from "./validacao";

const base = { codigo: "403", nome: "Studio Teste", ativo: "on" };

describe("validarImovel", () => {
  it("aceita o mínimo e aplica padrões", () => {
    const r = validarImovel(base);
    expect(r).toEqual({
      ok: true,
      dados: {
        codigo: "403",
        nome: "Studio Teste",
        publico: false,
        ativo: true,
        bairro: "",
        cidade: "Rio de Janeiro",
        endereco: "",
        fuso: "America/Sao_Paulo",
        capacidade: null,
        quartos: null,
        banheiros: null,
        descricao: "",
      },
    });
  });

  it("normaliza o código para minúsculas e lê números e caixas marcadas", () => {
    const r = validarImovel({ ...base, codigo: " Buzios ", publico: "on", capacidade: "4", quartos: "0", banheiros: "1" });
    expect(r.ok && r.dados).toMatchObject({ codigo: "buzios", publico: true, capacidade: 4, quartos: 0, banheiros: 1 });
  });

  it("aponta erros por campo", () => {
    const r = validarImovel({ codigo: "403 A", nome: " ", fuso: "Marte/Olympus", capacidade: "0", quartos: "2.5", banheiros: "abc" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.erros).sort()).toEqual(["banheiros", "capacidade", "codigo", "fuso", "nome", "quartos"]);
    }
  });

  it("imóvel inativo quando a caixa não vem marcada", () => {
    const r = validarImovel({ codigo: "102", nome: "X" });
    expect(r.ok && r.dados.ativo).toBe(false);
  });
});
