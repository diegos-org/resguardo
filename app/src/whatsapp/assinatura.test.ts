import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assinaturaConfere, CHALLENGE_VALIDO, lerCabecalhoAssinatura, tokenConfere } from "./assinatura";
import { assinar, SEGREDO_TESTE } from "./testes";

// Vetor de teste fixo (fictício): o corpo da fixture, byte a byte, assinado com o segredo de teste.
const CORPO = readFileSync(fileURLToPath(new URL("./fixtures/corpo-assinado.json", import.meta.url)));
const ESPERADO = "sha256=b3af869c6474ba4be7a413495d0a0f8f1b9e0f110b62895bd78951ff6ab0df24";
const confere = (bytes: Buffer, cabecalho: string, segredo = SEGREDO_TESTE) => {
  const assinatura = lerCabecalhoAssinatura(cabecalho);
  return assinatura !== null && assinaturaConfere(bytes, assinatura, segredo);
};

describe("assinatura do aviso (x-hub-signature-256)", () => {
  it("o vetor da fixture confere sobre os bytes crus", () => {
    expect(assinar(CORPO)).toBe(ESPERADO);
    expect(confere(CORPO, ESPERADO)).toBe(true);
  });

  it("o mesmo JSON reescrito (JSON.stringify do parse, ou outro espaçamento) não confere", () => {
    const reescrito = Buffer.from(JSON.stringify(JSON.parse(CORPO.toString("utf8"))));
    expect(assinar(reescrito)).toMatch(/^sha256=c02615a7/);
    expect(confere(reescrito, ESPERADO)).toBe(false);
    const espacado = Buffer.from(JSON.stringify(JSON.parse(CORPO.toString("utf8")), null, 2));
    expect(confere(espacado, ESPERADO)).toBe(false);
  });

  it("hex em maiúsculas confere (comparado em minúsculas)", () => {
    expect(confere(CORPO, `sha256=${ESPERADO.slice(7).toUpperCase()}`)).toBe(true);
  });

  it("segredo errado ou um byte a mais no corpo não confere", () => {
    expect(confere(CORPO, ESPERADO, "outro-segredo-ficticio")).toBe(false);
    expect(confere(Buffer.concat([CORPO, Buffer.from(" ")]), ESPERADO)).toBe(false);
    const trocado = ESPERADO.slice(0, -1) + (ESPERADO.endsWith("4") ? "5" : "4");
    expect(confere(CORPO, trocado)).toBe(false);
  });

  it("cabeçalho fora da forma → null", () => {
    const hex = ESPERADO.slice(7);
    for (const ruim of [null, "", hex, `sha1=${hex}`, `SHA256=${hex}`, `sha256=${hex.slice(1)}`, `sha256=${hex}a`, `sha256=${"z".repeat(64)}`, ` ${ESPERADO}`, `${ESPERADO},v2=x`, "a".repeat(10_000)]) {
      expect(lerCabecalhoAssinatura(ruim)).toBeNull();
    }
    expect(lerCabecalhoAssinatura(ESPERADO)).toHaveLength(32);
  });

  it("segredo vazio ou assinatura de outro tamanho → false, sem lançar", () => {
    const assinatura = lerCabecalhoAssinatura(ESPERADO)!;
    expect(assinaturaConfere(CORPO, assinatura, "")).toBe(false);
    expect(assinaturaConfere(CORPO, assinatura.subarray(0, 31), SEGREDO_TESTE)).toBe(false);
    expect(assinaturaConfere(CORPO, Buffer.alloc(0), SEGREDO_TESTE)).toBe(false);
  });
});

describe("senha de verificação (hub.verify_token)", () => {
  const senha = "senha-de-verificacao-ficticia-com-mais-de-32";

  it("confere só com o valor igual; tamanhos diferentes não lançam", () => {
    expect(tokenConfere(senha, senha)).toBe(true);
    expect(tokenConfere(`${senha}x`, senha)).toBe(false);
    expect(tokenConfere("curta", senha)).toBe(false);
    expect(tokenConfere("", senha)).toBe(false);
    expect(tokenConfere(null, senha)).toBe(false);
    expect(tokenConfere("a".repeat(5000), senha)).toBe(false);
  });

  it("esperada vazia nunca confere", () => {
    expect(tokenConfere("", "")).toBe(false);
    expect(tokenConfere(null, "")).toBe(false);
  });
});

describe("hub.challenge", () => {
  it.each([
    ["123456789", true],["abc_DEF-123", true], ["a".repeat(128), true],
    ["", false], ["a".repeat(129), false], ["<script>", false], ["com espaço", false], ["acentuação", false], ["a\nb", false],
  ])("%j → %s", (valor, esperado) => {
    expect(CHALLENGE_VALIDO.test(valor)).toBe(esperado);
  });
});
