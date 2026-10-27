import { describe, expect, it } from "vitest";
import { FONTES_PRECOS, fontePrecosDoPortal, precoForaDoPortal, precoLidoDoBeds24 } from "./fonte-precos";

describe("fonte de preços por imóvel: quem define o preço (M3.9, M3.11b)", () => {
  it("o preço é lido do Beds24 nas fontes \"beds24\" e \"só disponibilidade\"; nas outras é do SCL", () => {
    expect(FONTES_PRECOS.filter(precoLidoDoBeds24)).toEqual(["beds24", "so_disponibilidade"]);
  });

  it("no portal, o preço fica fora da edição exatamente nas fontes que leem o preço do Beds24 (uma regra, um lugar)", () => {
    for (const fonte of FONTES_PRECOS) expect(precoForaDoPortal(fontePrecosDoPortal(fonte))).toBe(precoLidoDoBeds24(fonte));
    expect(precoForaDoPortal("ferramenta")).toBe(true);
    expect(precoForaDoPortal("so_disponibilidade")).toBe(true);
    expect(precoForaDoPortal("scl")).toBe(false);
    expect(precoForaDoPortal("manual")).toBe(false);
  });
});
