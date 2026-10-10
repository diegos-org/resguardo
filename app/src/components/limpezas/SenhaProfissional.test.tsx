import { describe, expect, it } from "vitest";
import { mensagemDeAcesso } from "./SenhaProfissional";

describe("mensagem de acesso da equipe (M6.8)", () => {
  it("leva o endereço completo da entrada, que abre direto do WhatsApp", () => {
    const m = mensagemDeAcesso("maria.limpeza", "abcd-efgh-jkmn", "https://exemplo.com.br/entrar");
    expect(m).toContain("Usuário: maria.limpeza\nSenha: abcd-efgh-jkmn");
    expect(m).toContain("Entre em https://exemplo.com.br/entrar, em \"Entrar com usuário e senha\".");
    // Sem endereço (nunca acontece pela ação), não manda um caminho solto que não abre.
    expect(mensagemDeAcesso("maria.limpeza", "x", undefined)).not.toContain(" /entrar");
  });
});
