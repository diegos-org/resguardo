import { describe, expect, it } from "vitest";
import { linkDaCasa } from "./link-da-casa";
import { lerPedidoConsulta } from "./site";

describe("link da página da casa com as datas (M7.9)", () => {
  it("leva as datas e as pessoas com os nomes do contrato de links, que a página lê como os do site", () => {
    const link = linkDaCasa("403", { entrada: "2026-10-12", saida: "2026-10-15", hospedes: "2" });
    expect(link).toBe("/imoveis/403?checkin=2026-10-12&checkout=2026-10-15&guests=2");
    const sp = Object.fromEntries(new URLSearchParams(link!.split("?")[1]));
    expect(lerPedidoConsulta(sp)).toEqual({ imovel: "", entrada: "2026-10-12", saida: "2026-10-15", hospedes: "2" });
  });

  it("só o que tem o formato certo entra; sem critério, a página sem parâmetros", () => {
    expect(linkDaCasa("403")).toBe("/imoveis/403");
    expect(linkDaCasa("403", { entrada: "", saida: "", hospedes: "2" })).toBe("/imoveis/403?guests=2");
    expect(linkDaCasa("403", { entrada: "amanhã", saida: "2026-10-15", hospedes: "2e0" })).toBe("/imoveis/403?checkout=2026-10-15");
    expect(linkDaCasa("casa-1_b", { hospedes: "10" })).toBe("/imoveis/casa-1_b?guests=10");
  });

  it("\"Todas as casas\" (vazio) ou um código que não é de casa não viram link (nada de endereço montado com texto qualquer)", () => {
    expect(linkDaCasa("")).toBeNull();
    expect(linkDaCasa("javascript:alert(1)")).toBeNull();
    expect(linkDaCasa("../painel")).toBeNull();
    expect(linkDaCasa("x".repeat(41))).toBeNull();
  });
});
