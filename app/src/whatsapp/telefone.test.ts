import { describe, expect, it } from "vitest";
import { chavesDeTelefone, chavesDoWaId, FORMA_WA_ID, formatarWaId, temChaveEmComum, ultimos8 } from "./telefone";
import { CANARIOS } from "./testes";

// Vetores de teste fictícios: o celular canário (21) 99999-0000 em várias formas, o fixo (21) 2222-3333 e o estrangeiro
// canário da faixa reservada de exemplo dos EUA (555-01xx). Nenhum é telefone real.
const DUAS = [CANARIOS.waIdBr, CANARIOS.waIdBrSem9];
const NACIONAL = CANARIOS.waIdBr.slice(2); // DDD + 9 dígitos
const NACIONAL_SEM_9 = CANARIOS.waIdBrSem9.slice(2); // DDD + 8 dígitos (celular antigo)

describe("chavesDeTelefone (cadastro em texto livre)", () => {
  it.each([
    CANARIOS.telefoneFormatado,
    NACIONAL,
    CANARIOS.waIdBr,
    "+55 21 99999-0000",
    CANARIOS.comMais,
    `0055 ${NACIONAL}`,
    "021 99999-0000",
    ` (021) 9 9999 0000 `,
  ])("celular %j → as duas variantes (com e sem o nono dígito)", (texto) => {
    expect(chavesDeTelefone(texto)).toEqual(DUAS);
  });

  it("celular antigo de 8 dígitos (6 a 9) → as mesmas duas", () => {
    expect(chavesDeTelefone(NACIONAL_SEM_9)).toEqual(DUAS);
    expect(chavesDeTelefone("(21) 9999-0000")).toEqual(DUAS);
    expect(chavesDeTelefone(`+${CANARIOS.waIdBrSem9}`)).toEqual(DUAS);
  });

  it("fixo (2 a 5) → uma chave", () => {
    expect(chavesDeTelefone("(21) 2222-3333")).toEqual(["5521" + "22223333"]);
    expect(chavesDeTelefone("+55 21 2222-3333")).toEqual(["5521" + "22223333"]);
  });

  it("estrangeiro só com DDI explícito: com + (ou 00) vale como veio; sem + os 11 dígitos são lidos como Brasil e não casam com o wa_id", () => {
    expect(chavesDeTelefone("+1 650 555 0199")).toEqual([CANARIOS.waIdEstrangeiro]);
    expect(chavesDeTelefone("001 650 555 0199")).toEqual([CANARIOS.waIdEstrangeiro]);
    // Sem "+": DDD 16 e 9 dígitos que não começam com 9, que não é celular brasileiro → nada a comparar.
    const semMais = chavesDeTelefone(CANARIOS.waIdEstrangeiro);
    expect(semMais).toEqual([]);
    expect(temChaveEmComum(semMais, chavesDoWaId(CANARIOS.waIdEstrangeiro))).toBe(false);
    // O mesmo número com "+" casa.
    expect(temChaveEmComum(chavesDeTelefone("+1 (650) 555-0199"), chavesDoWaId(CANARIOS.waIdEstrangeiro))).toBe(true);
  });

  it.each([
    ["(10) 99999-0000", "DDD 10"],
    ["999990000", "9 dígitos"],
    ["", "vazio"],
    ["   ", "só espaços"],
    ["sem telefone", "sem dígitos"],
    ["(21) 89999-0000", "9 dígitos sem começar com 9"],
    ["(21) 1999-0000", "8 dígitos começando com 1"],
    ["+0 21 99999-0000", "DDI começando com 0"],
    ["+55 21 999", "+55 curto"],
    [`${CANARIOS.comMais} / +1 650 555 0199`, "dois números no mesmo campo"],
    ["1".repeat(14), "14 dígitos sem DDI"],
  ])("%j (%s) → []", (texto) => {
    expect(chavesDeTelefone(texto)).toEqual([]);
  });
});

describe("chavesDoWaId", () => {
  it("brasileiro com e sem o nono dígito têm chave em comum", () => {
    expect(chavesDoWaId(CANARIOS.waIdBr)).toEqual(DUAS);
    expect(chavesDoWaId(CANARIOS.waIdBrSem9)).toEqual(DUAS);
    expect(temChaveEmComum(chavesDoWaId(CANARIOS.waIdBr), chavesDoWaId(CANARIOS.waIdBrSem9))).toBe(true);
    expect(temChaveEmComum(chavesDeTelefone(CANARIOS.telefoneFormatado), chavesDoWaId(CANARIOS.waIdBrSem9))).toBe(true);
  });

  it("estrangeiro, fixo e brasileiro que a regra não reconhece: só ele mesmo", () => {
    expect(chavesDoWaId(CANARIOS.waIdEstrangeiro)).toEqual([CANARIOS.waIdEstrangeiro]);
    expect(chavesDoWaId("5521" + "22223333")).toEqual(["5521" + "22223333"]);
    expect(chavesDoWaId("5510" + "999990000")).toEqual(["5510" + "999990000"]);
  });

  it("fora da forma de wa_id → []", () => {
    for (const ruim of [CANARIOS.comMais, "", "abc", "12345", "1".repeat(21), CANARIOS.telefoneFormatado]) expect(chavesDoWaId(ruim)).toEqual([]);
  });

  it("a forma é a mesma do parser e do CHECK da 0073 (6 a 20 dígitos): um wa_id começando com 0 é ele mesmo", () => {
    expect(chavesDoWaId("0" + CANARIOS.waIdEstrangeiro)).toEqual(["0" + CANARIOS.waIdEstrangeiro]);
    expect(FORMA_WA_ID.test("0" + CANARIOS.waIdEstrangeiro)).toBe(true);
  });
});

describe("ultimos8 e formatarWaId", () => {
  it("os 8 últimos dígitos são iguais com e sem o nono dígito", () => {
    expect(ultimos8(CANARIOS.waIdBr)).toBe("99990000");
    expect(ultimos8(CANARIOS.waIdBr)).toBe(ultimos8(CANARIOS.waIdBrSem9));
  });

  it("brasileiro com espaço e hífen; estrangeiro com + e os dígitos", () => {
    expect(formatarWaId(CANARIOS.waIdBr)).toBe("+55 21 99999-0000");
    expect(formatarWaId(CANARIOS.waIdBrSem9)).toBe("+55 21 9999-0000");
    expect(formatarWaId("5521" + "22223333")).toBe("+55 21 2222-3333");
    expect(formatarWaId(CANARIOS.waIdEstrangeiro)).toBe(`+${CANARIOS.waIdEstrangeiro}`);
  });
});
