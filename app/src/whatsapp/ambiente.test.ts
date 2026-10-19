import { describe, expect, it } from "vitest";
import { recebimentoLigado, segredoDoApp, situacaoDoToken, TOKEN_MINIMO, tokenDeVerificacao } from "./ambiente";

// Valores fictícios; nunca o process.env da sessão.
const env = (v: Record<string, string | undefined> = {}) => v as unknown as NodeJS.ProcessEnv;
const SENHA = "senha-de-verificacao-ficticia-abcdefghij";

describe("WHATSAPP_RECEBIMENTO", () => {
  it.each([
    ["ligada", true], [" ligada\n", true],
    [undefined, false], ["", false], ["ligado", false], ["LIGADA", false], ["true", false], ["1", false], ["sim", false],
  ])("%j → %s", (valor, esperado) => {
    expect(recebimentoLigado(env({ WHATSAPP_RECEBIMENTO: valor }))).toBe(esperado);
  });
});

describe("WHATSAPP_APP_SECRET", () => {
  it("aparado; ausente ou vazio = null", () => {
    expect(segredoDoApp(env({ WHATSAPP_APP_SECRET: "  segredo-ficticio \n" }))).toBe("segredo-ficticio");
    expect(segredoDoApp(env({ WHATSAPP_APP_SECRET: "   " }))).toBeNull();
    expect(segredoDoApp(env())).toBeNull();
  });
});

describe("WHATSAPP_VERIFY_TOKEN", () => {
  it("falta, curta (menos de 32 caracteres, já aparada) ou ok; nunca devolve o valor fora do ok", () => {
    expect(TOKEN_MINIMO).toBe(32);
    expect(situacaoDoToken(env())).toBe("falta");
    expect(situacaoDoToken(env({ WHATSAPP_VERIFY_TOKEN: "  " }))).toBe("falta");
    expect(situacaoDoToken(env({ WHATSAPP_VERIFY_TOKEN: "a".repeat(31) }))).toBe("curto");
    expect(situacaoDoToken(env({ WHATSAPP_VERIFY_TOKEN: ` ${"a".repeat(31)} ` }))).toBe("curto");
    expect(situacaoDoToken(env({ WHATSAPP_VERIFY_TOKEN: "a".repeat(32) }))).toBe("ok");
    expect(tokenDeVerificacao(env({ WHATSAPP_VERIFY_TOKEN: "a".repeat(31) }))).toBeNull();
    expect(tokenDeVerificacao(env())).toBeNull();
    expect(tokenDeVerificacao(env({ WHATSAPP_VERIFY_TOKEN: ` ${SENHA}\n` }))).toBe(SENHA);
  });
});
