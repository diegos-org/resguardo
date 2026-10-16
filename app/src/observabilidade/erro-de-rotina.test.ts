import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb } from "@/db/testing";
import { ErroDeRotina, erroParaOAviso, MENSAGEM_OMITIDA, type OndeFicaODetalhe, somarFalhas, totalDeFalhas, umaFalha } from "./erro-de-rotina";

/**
 * M0.9 (revisão do Codex): das rotinas e do aviso do Mercado Pago, o Sentry recebe o resumo sem dados pessoais de um
 * `ErroDeRotina` ou um texto fixo, nunca a mensagem original. Os nomes são fictícios.
 */
const NOME = "Maria Fictícia Teste";

/** Tudo o que o Sentry lê do erro e das causas encadeadas: o tipo, a mensagem e a pilha. */
const cadeia = (e: unknown): Error[] => (e instanceof Error ? [e, ...cadeia(e.cause)] : []);
const textoDoAviso = (e: Error) => JSON.stringify(cadeia(e).map((x) => [x.name, x.message, x.stack]));

describe("ErroDeRotina", () => {
  it("a mensagem é o detalhe (para Sistema); o resumo só tem as contagens, com os textos fixos", () => {
    const e = new ErroDeRotina(`1 repasse(s) antecipado(s) gerado(s), ${NOME}: Reservas deste proprietário estão sendo recalculadas agora`, { antecipado_nao_gerado: 1, email_nao_enviado: 2, sem_provedor: 0 });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ErroDeRotina");
    expect(e.message).toContain(NOME);
    expect(e.resumo).toBe("1 repasse(s) antecipado(s) não gerado(s), 2 e-mail(s) não enviado(s) (detalhe na página Sistema)");
    expect(new ErroDeRotina("x", {}).resumo).toBe("falha sem contagem (detalhe na página Sistema)");
  });

  it("o resumo diz onde está o detalhe, de uma lista fechada (padrão: a página Sistema)", () => {
    expect(new ErroDeRotina(`${NOME}: falhou`, umaFalha("rede"), { detalheEm: "integracoes" }).resumo).toBe("1 falha de rede (detalhe em Configurações → Integrações, nas últimas importações do Beds24)");
    expect(new ErroDeRotina("x", umaFalha("erro_na_organizacao"), { detalheEm: "mensagens" }).resumo).toBe("1 organização(ões) com erro inesperado (detalhe em Configurações → Modelos de mensagem, na última execução de cada organização)");
    expect(new ErroDeRotina("x", umaFalha("credencial"), { detalheEm: "sem_registro" }).resumo).toBe("1 chave de acesso recusada ou inválida (sem detalhe guardado: o aviso fica marcado como erro e a rotina dos pagamentos confere depois)");
    expect(new ErroDeRotina("x", umaFalha("rede")).detalheEm).toBe("sistema");
    // Fora da lista (só por um erro de tipo), volta ao padrão: nenhum texto livre entra no resumo.
    const fora = new ErroDeRotina("x", umaFalha("rede"), { detalheEm: NOME as OndeFicaODetalhe });
    expect(fora.resumo).toBe("1 falha de rede (detalhe na página Sistema)");
    expect(umaFalha("tempo")).toEqual({ tempo: 1 });
  });

  it("soma as contagens das organizações; zero, negativo e fração não contam", () => {
    const falhas = {};
    somarFalhas(falhas, { email_nao_enviado: 1, erro_na_organizacao: 0 });
    somarFalhas(falhas, { email_nao_enviado: 2, erro_na_organizacao: 1, sem_provedor: -1, rede: 0.5 });
    expect(falhas).toEqual({ email_nao_enviado: 3, erro_na_organizacao: 1 });
    expect(totalDeFalhas(falhas)).toBe(4);
    expect(totalDeFalhas({})).toBe(0);
  });
});

describe("erroParaOAviso: o que vai ao Sentry", () => {
  it("de um ErroDeRotina, o resumo no lugar do detalhe, com o tipo e a pilha do código", () => {
    const original = new ErroDeRotina(`${NOME}: falhou`, { antecipado_nao_gerado: 1 });
    const aviso = erroParaOAviso(original);
    expect(aviso.name).toBe("ErroDeRotina");
    expect(aviso.message).toBe("1 repasse(s) antecipado(s) não gerado(s) (detalhe na página Sistema)");
    expect(aviso.stack!.split("\n")[0]).toBe(`ErroDeRotina: ${aviso.message}`);
    expect(aviso.stack).toMatch(/\n\s+at .*erro-de-rotina\.test\.ts/);
    expect(textoDoAviso(aviso)).not.toContain(NOME);
    // O original fica como estava: é ele que a rotina registra em Sistema.
    expect(original.message).toBe(`${NOME}: falhou`);
  });

  it("de qualquer outro erro, um texto fixo no lugar da mensagem (nem a primeira linha da pilha sobra)", () => {
    const aviso = erroParaOAviso(new Error(`erro numa organização: relatório de ${NOME}\n    at ${NOME} (x.js:1:1)`));
    expect(aviso.name).toBe("Error");
    expect(aviso.message).toBe(MENSAGEM_OMITIDA);
    expect(textoDoAviso(aviso)).not.toContain(NOME);
  });

  it("valor lançado que não é um erro: o mesmo texto fixo", () => {
    for (const lancado of [`falhou para ${NOME}`, { nome: NOME }, null]) {
      const aviso = erroParaOAviso(lancado);
      expect(aviso.message).toBe(MENSAGEM_OMITIDA);
      expect(textoDoAviso(aviso)).not.toContain(NOME);
    }
  });

  it("erro do banco de verdade (PGlite): sai o tipo, o código do Postgres e a pilha; o valor repetido na causa não", async () => {
    const { db, close } = await createTestDb();
    try {
      const erro = await db.execute(sql`select ${NOME}::uuid`).then(
        () => null,
        (e: unknown) => e,
      );
      // O erro do Drizzle esconde o valor nos parâmetros; a causa, o erro do Postgres, o repete na mensagem.
      expect(String((erro as Error).cause)).toContain(NOME);
      const aviso = erroParaOAviso(erro);
      expect(aviso.name).toBe("DrizzleQueryError");
      expect(aviso.message).toBe(MENSAGEM_OMITIDA);
      const causa = aviso.cause as Error;
      expect(causa).toBeInstanceOf(Error);
      expect(causa.message).toBe(`${MENSAGEM_OMITIDA}; código 22P02`);
      expect(textoDoAviso(aviso)).not.toContain(NOME);
    } finally {
      await close();
    }
  });

  it("a causa de um ErroDeRotina segue pela mesma regra; as causas param em 5", () => {
    let fundo: Error = Object.assign(new Error(`chave ${NOME}`), { code: "ECONNRESET" });
    for (let i = 0; i < 8; i++) fundo = new Error(`nível ${i} de ${NOME}`, { cause: fundo });
    const aviso = erroParaOAviso(new ErroDeRotina("a rotina parou no meio", { rotina_interrompida: 1 }, { cause: fundo }));
    expect(aviso.message).toBe("1 rotina interrompida no meio (detalhe na página Sistema)");
    expect(cadeia(aviso)).toHaveLength(6);
    expect(textoDoAviso(aviso)).not.toContain(NOME);
  });

  it("código técnico só quando tem a forma de um código; tipo estranho vira Error", () => {
    const comCodigo = (code: unknown) => erroParaOAviso(Object.assign(new Error("x"), { code })).message;
    expect(comCodigo("23505")).toBe(`${MENSAGEM_OMITIDA}; código 23505`);
    expect(comCodigo("UND_ERR_SOCKET")).toBe(`${MENSAGEM_OMITIDA}; código UND_ERR_SOCKET`);
    expect(comCodigo(NOME)).toBe(MENSAGEM_OMITIDA);
    expect(comCodigo(42)).toBe(MENSAGEM_OMITIDA);
    const nomeEstranho = Object.assign(new Error("x"), { name: NOME });
    expect(erroParaOAviso(nomeEstranho).name).toBe("Error");
    class ErroDoProvedor extends Error {}
    expect(erroParaOAviso(new ErroDoProvedor("x")).name).toBe("ErroDoProvedor");
  });
});
