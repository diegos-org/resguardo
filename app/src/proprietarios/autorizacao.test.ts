import { describe, expect, it } from "vitest";
import {
  autorizacaoDeOrigem,
  CAMPO_AUTORIZACAO,
  ERROS_TEXTO_AUTORIZACAO,
  FORMULARIOS_PROPRIETARIO,
  LIMITE_TEXTO_AUTORIZACAO,
  lerRegistroAutorizacao,
  marcaDoFormulario,
  montarAutorizacao,
  SEM_REGISTRO_AUTORIZACAO,
  TEXTOS_ORIGEM_AUTORIZACAO,
  VERSAO_ORIGEM_AUTORIZACAO,
  validarTextoAutorizacao,
} from "./autorizacao";

/**
 * A versão 1 de cada caixa, exatamente como o M7.14 a mostrou e gravou nos envios (antes do M7.15, este teste guardava
 * cada versão do código). Ela continua sendo a versão 1 do motor de versões (a de origem): mudar o texto aqui criaria
 * duas "versão 1" diferentes — os envios já gravados com a versão 1 têm este texto.
 */
const VERSAO_1: Record<(typeof FORMULARIOS_PROPRIETARIO)[number], string> = {
  contato: "Autorizo o uso destes dados só para a {empresa} me responder sobre a gestão do imóvel.",
  cadastro: "Autorizo a equipe a usar estes dados para analisar o cadastro e entrar em contato comigo.",
};

describe("texto da autorização dos proprietários (M7.14; editável no M7.15)", () => {
  it.each(FORMULARIOS_PROPRIETARIO)("%s: a versão de origem é a 1, com o texto de hoje, e não pode ser trocada", (f) => {
    expect(VERSAO_ORIGEM_AUTORIZACAO).toBe(1);
    expect(TEXTOS_ORIGEM_AUTORIZACAO[f]).toBe(VERSAO_1[f]);
    expect(Object.isFrozen(TEXTOS_ORIGEM_AUTORIZACAO)).toBe(true);
    // O texto de origem passa nas regras de publicação (é um texto que o painel aceitaria).
    expect(validarTextoAutorizacao(VERSAO_1[f])).toEqual({ ok: true, texto: VERSAO_1[f] });
  });

  it("monta o texto com o nome da empresa, como aparece ao lado da caixa (o mesmo que o M7.14 mostrava)", () => {
    expect(autorizacaoDeOrigem("contato", "Sua Casa Exemplo")).toMatchObject({ versao: 1, texto: "Autorizo o uso destes dados só para a Sua Casa Exemplo me responder sobre a gestão do imóvel." });
    expect(autorizacaoDeOrigem("contato", "  Sua Casa Exemplo  ").texto).toContain("para a Sua Casa Exemplo me");
    // Sem nome cadastrado, a frase continua legível (não fica "para a  me responder").
    expect(autorizacaoDeOrigem("contato", " ").texto).toContain("para a empresa me responder");
    expect(autorizacaoDeOrigem("cadastro", "Sua Casa Exemplo").texto).toBe("Autorizo a equipe a usar estes dados para analisar o cadastro e entrar em contato comigo.");
    // Texto editado: o marcador vale em qualquer caixa e em qualquer lugar do texto, quantas vezes aparecer.
    expect(montarAutorizacao(2, "Autorizo a {empresa} (e só a {empresa}) a analisar o cadastro.", "Casa Exemplo")).toMatchObject({
      versao: 2,
      texto: "Autorizo a Casa Exemplo (e só a Casa Exemplo) a analisar o cadastro.",
    });
  });

  it("a marca é curta, igual para o mesmo texto e muda com o texto, o nome da empresa ou a versão", () => {
    const a = autorizacaoDeOrigem("contato", "Sua Casa Exemplo");
    expect(a.marca).toMatch(/^v1\.[0-9a-z]{1,7}$/);
    // A mesma marca do M7.14 (a impressão não mudou): página aberta antes da publicação deste item continua valendo.
    expect(a.marca).toBe(montarAutorizacao(1, VERSAO_1.contato, "Sua Casa Exemplo").marca);
    expect(autorizacaoDeOrigem("contato", "Outra Empresa").marca).not.toBe(a.marca);
    expect(autorizacaoDeOrigem("cadastro", "Sua Casa Exemplo").marca).not.toBe(a.marca);
    expect(montarAutorizacao(2, VERSAO_1.contato, "Sua Casa Exemplo").marca).not.toBe(a.marca);
    expect(montarAutorizacao(2, "Outro texto.", "Sua Casa Exemplo").marca).toMatch(/^v2\./);
    // A marca não carrega o texto (o formulário manda só ela).
    expect(a.marca).not.toContain("Autorizo");
  });

  it("texto para publicar: pontas e espaços seguidos arrumados; vazio, longo, com quebra, invisível, < > ou outra chave, recusado", () => {
    expect(validarTextoAutorizacao("  Autorizo   a {empresa}\ta responder.  ")).toEqual({ ok: true, texto: "Autorizo a {empresa} a responder." });
    for (const vazio of ["", "   ", "\n\n", null, undefined, 42]) expect(validarTextoAutorizacao(vazio)).toEqual({ ok: false, erro: ERROS_TEXTO_AUTORIZACAO.vazio });
    expect(validarTextoAutorizacao("x".repeat(LIMITE_TEXTO_AUTORIZACAO))).toMatchObject({ ok: true });
    expect(validarTextoAutorizacao("x".repeat(LIMITE_TEXTO_AUTORIZACAO + 1))).toEqual({ ok: false, erro: `Máximo de ${LIMITE_TEXTO_AUTORIZACAO} caracteres (o texto tem ${LIMITE_TEXTO_AUTORIZACAO + 1}).` });
    expect(validarTextoAutorizacao("Autorizo o uso.\r\nOutra linha.")).toEqual({ ok: false, erro: ERROS_TEXTO_AUTORIZACAO.linhas });
    for (const invisivel of ["Autorizo\u200b o uso.", "Autorizo \u202eosu o.", "Autorizo\u0007 o uso.", "Autorizo o\ufeff uso."]) {
      expect(validarTextoAutorizacao(invisivel)).toEqual({ ok: false, erro: ERROS_TEXTO_AUTORIZACAO.invisivel });
    }
    expect(validarTextoAutorizacao("Autorizo o <b>uso</b>.")).toEqual({ ok: false, erro: ERROS_TEXTO_AUTORIZACAO.marcacao });
    expect(validarTextoAutorizacao("Autorizo a {nome} a responder.")).toEqual({ ok: false, erro: ERROS_TEXTO_AUTORIZACAO.chaves });
    expect(validarTextoAutorizacao("Autorizo a {empresa a responder.")).toEqual({ ok: false, erro: ERROS_TEXTO_AUTORIZACAO.chaves });
    expect(validarTextoAutorizacao("Autorizo a {{empresa}} a responder.")).toEqual({ ok: false, erro: ERROS_TEXTO_AUTORIZACAO.chaves });
    // Nas pontas, o invisível sai junto com os espaços (o texto mostrado é o mesmo).
    expect(validarTextoAutorizacao("\ufeffAutorizo o uso.")).toEqual({ ok: true, texto: "Autorizo o uso." });
    // Acentos, aspas e travessão são texto comum.
    expect(validarTextoAutorizacao("Autorizo — de acordo com a “política” — o uso.")).toMatchObject({ ok: true });
  });

  it("lê a marca do campo escondido: só texto, sem espaços nas pontas e com tamanho limitado", () => {
    expect(CAMPO_AUTORIZACAO).toBe("autorizacao");
    expect(marcaDoFormulario({ autorizacao: "  v1.abc  " })).toBe("v1.abc");
    expect(marcaDoFormulario({})).toBe("");
    expect(marcaDoFormulario({ autorizacao: 123 })).toBe("");
    expect(marcaDoFormulario({ autorizacao: "x".repeat(500) })).toHaveLength(64);
  });

  it("registro do envio: os três campos juntos; faltando qualquer um, não há registro (sem palpite)", () => {
    const em = new Date("2026-10-15T15:00:00Z");
    expect(lerRegistroAutorizacao({ autorizadoEm: em, autorizacaoVersao: 1, autorizacaoTexto: "Texto." })).toEqual({ em, versao: 1, texto: "Texto." });
    expect(lerRegistroAutorizacao({ autorizadoEm: null, autorizacaoVersao: null, autorizacaoTexto: null })).toBeNull();
    expect(lerRegistroAutorizacao({ autorizadoEm: em, autorizacaoVersao: null, autorizacaoTexto: "Texto." })).toBeNull();
    expect(lerRegistroAutorizacao({ autorizadoEm: em, autorizacaoVersao: 1, autorizacaoTexto: "" })).toBeNull();
    expect(SEM_REGISTRO_AUTORIZACAO).toContain("Sem registro");
    expect(SEM_REGISTRO_AUTORIZACAO).toContain("A caixa já era obrigatória.");
    // Sem data fixa: o registro começa quando a mudança entra no ar, não no dia em que foi escrita.
    expect(SEM_REGISTRO_AUTORIZACAO).not.toMatch(/\d{1,2}\/\d{1,2}/);
  });
});
