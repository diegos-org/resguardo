import { describe, expect, it } from "vitest";
import { blocosDoTexto, partesDoTitulo, TEXTOS_SITE_INICIAIS, tituloSimples, validarTextosSite } from "./textos-site";

describe("textos do site (M7.5): destaque no título e blocos do texto", () => {
  it("palavra entre asteriscos vira destaque; sem asteriscos, uma parte só", () => {
    expect(partesDoTitulo("Um pouco de Rio. Um lugar *seu*.")).toEqual([
      { texto: "Um pouco de Rio. Um lugar ", destaque: false },
      { texto: "seu", destaque: true },
      { texto: ".", destaque: false },
    ]);
    expect(partesDoTitulo("Sem destaque")).toEqual([{ texto: "Sem destaque", destaque: false }]);
    expect(partesDoTitulo("*Tudo*")).toEqual([{ texto: "Tudo", destaque: true }]);
    expect(partesDoTitulo("")).toEqual([{ texto: "", destaque: false }]);
    expect(tituloSimples(TEXTOS_SITE_INICIAIS.titulo)).toBe("Um pouco de Rio. Um lugar seu.");
  });

  it("blocos separados por linha em branco; a primeira linha de um bloco com várias é o título", () => {
    expect(blocosDoTexto("")).toEqual([]);
    expect(blocosDoTexto("Só um parágrafo.")).toEqual([{ titulo: null, texto: "Só um parágrafo." }]);
    expect(blocosDoTexto("Preço justo\nSem a taxa das plataformas.\n\nAtendimento direto\nQuem responde é quem cuida da casa.\nSempre.\n\n  \nSem título aqui")).toEqual([
      { titulo: "Preço justo", texto: "Sem a taxa das plataformas." },
      { titulo: "Atendimento direto", texto: "Quem responde é quem cuida da casa.\nSempre." },
      { titulo: null, texto: "Sem título aqui" },
    ]);
  });

  it("os textos novos da capa (olho e chamada) são opcionais e respeitam o limite", () => {
    const v = validarTextosSite({ ...TEXTOS_SITE_INICIAIS, olho: "", chamada: "" });
    expect(v.ok).toBe(true);
    expect(validarTextosSite({ ...TEXTOS_SITE_INICIAIS, olho: "x".repeat(61) })).toMatchObject({ ok: false, erros: { olho: "Máximo de 60 caracteres." } });
  });
});
