import { describe, expect, it } from "vitest";
import { LIMITE_FRASE, validarImovel } from "./validacao";

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
        frase: "",
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

  describe("frase de abertura (M7.17)", () => {
    const frase = (valor: string) => validarImovel({ ...base, frase: valor });

    it("vazia é permitida e nunca vem preenchida sozinha", () => {
      for (const v of ["", "   "]) expect(frase(v)).toMatchObject({ ok: true, dados: { frase: "" } });
      expect(validarImovel(base)).toMatchObject({ ok: true, dados: { frase: "" } });
    });

    it("apara os espaços das pontas e guarda o texto como foi escrito", () => {
      expect(frase("  Dias leves entre a praia e os restaurantes.  ")).toMatchObject({ ok: true, dados: { frase: "Dias leves entre a praia e os restaurantes." } });
    });

    it(`até ${LIMITE_FRASE} caracteres: no limite passa, um a mais é recusado`, () => {
      expect(LIMITE_FRASE).toBe(120);
      expect(frase("a".repeat(120))).toMatchObject({ ok: true, dados: { frase: "a".repeat(120) } });
      // O limite vale depois de aparar: espaços nas pontas não contam.
      expect(frase(` ${"a".repeat(120)} `)).toMatchObject({ ok: true });
      expect(frase("a".repeat(121))).toEqual({ ok: false, erros: { frase: "Máximo de 120 caracteres." } });
    });

    it("sem quebra de linha no meio (é um título na página da casa)", () => {
      for (const v of ["Primeira linha\nsegunda", "Uma\r\nduas", "Uma\u2028duas"]) {
        expect(frase(v), JSON.stringify(v)).toEqual({ ok: false, erros: { frase: "Escreva a frase numa linha só, sem quebra de linha." } });
      }
      // Quebra só nas pontas some com o aparo.
      expect(frase("Uma linha só.\n")).toMatchObject({ ok: true, dados: { frase: "Uma linha só." } });
    });

    it("o erro da frase não esconde os dos outros campos", () => {
      const r = validarImovel({ codigo: "", nome: "", frase: "x".repeat(121) });
      expect(r.ok === false && Object.keys(r.erros).sort()).toEqual(["codigo", "frase", "nome"]);
    });
  });
});
