import { describe, expect, it } from "vitest";
import {
  CAMPO_AUTORIZACAO,
  conferirAutorizacao,
  FORMULARIOS_PROPRIETARIO,
  lerRegistroAutorizacao,
  marcaDoFormulario,
  SEM_REGISTRO_AUTORIZACAO,
  TEXTOS_AUTORIZACAO,
  textoDaAutorizacao,
} from "./autorizacao";

/**
 * Cada versão já usada do texto de cada caixa (M7.14). O registro de um envio guarda o texto inteiro, mas a versão também
 * precisa contar a verdade: mudar o texto sem subir a versão faz este teste falhar. Texto novo = versão nova aqui, sem
 * tirar as anteriores.
 */
const VERSOES: Record<(typeof FORMULARIOS_PROPRIETARIO)[number], Record<number, string>> = {
  contato: { 1: "Autorizo o uso destes dados só para a {empresa} me responder sobre a gestão do imóvel." },
  cadastro: { 1: "Autorizo a equipe a usar estes dados para analisar o cadastro e entrar em contato comigo." },
};

describe("texto da autorização dos proprietários (M7.14)", () => {
  it.each(FORMULARIOS_PROPRIETARIO)("%s: o texto atual é o da versão registrada (texto novo pede versão nova)", (f) => {
    const { versao, modelo } = TEXTOS_AUTORIZACAO[f];
    expect(VERSOES[f][versao]).toBe(modelo);
  });

  it("monta o texto com o nome da empresa, como aparece ao lado da caixa", () => {
    expect(textoDaAutorizacao("contato", "Sua Casa Exemplo")).toMatchObject({ versao: 1, texto: "Autorizo o uso destes dados só para a Sua Casa Exemplo me responder sobre a gestão do imóvel." });
    expect(textoDaAutorizacao("contato", "  Sua Casa Exemplo  ").texto).toContain("para a Sua Casa Exemplo me");
    // Sem nome cadastrado, a frase continua legível (não fica "para a  me responder").
    expect(textoDaAutorizacao("contato", " ").texto).toContain("para a empresa me responder");
    expect(textoDaAutorizacao("cadastro", "Sua Casa Exemplo").texto).toBe("Autorizo a equipe a usar estes dados para analisar o cadastro e entrar em contato comigo.");
  });

  it("a marca é curta, igual para o mesmo texto e muda com o texto ou a versão", () => {
    const a = textoDaAutorizacao("contato", "Sua Casa Exemplo");
    expect(a.marca).toMatch(/^v1\.[0-9a-z]{1,7}$/);
    expect(textoDaAutorizacao("contato", "Sua Casa Exemplo").marca).toBe(a.marca);
    expect(textoDaAutorizacao("contato", "Outra Empresa").marca).not.toBe(a.marca);
    expect(textoDaAutorizacao("cadastro", "Sua Casa Exemplo").marca).not.toBe(a.marca);
    // A marca não carrega o texto (o formulário manda só ela).
    expect(a.marca).not.toContain("Autorizo");
  });

  it("confere a marca enviada contra o texto atual e devolve sempre o texto atual", () => {
    const atual = textoDaAutorizacao("contato", "Sua Casa Exemplo");
    expect(conferirAutorizacao("contato", "Sua Casa Exemplo", atual.marca)).toEqual({ ok: true, autorizacao: atual });
    expect(conferirAutorizacao("contato", "Casa Nova Exemplo", atual.marca)).toEqual({ ok: false, autorizacao: textoDaAutorizacao("contato", "Casa Nova Exemplo") });
    expect(conferirAutorizacao("contato", "Sua Casa Exemplo", atual.texto)).toMatchObject({ ok: false });
    expect(conferirAutorizacao("contato", "Sua Casa Exemplo", "")).toMatchObject({ ok: false });
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
