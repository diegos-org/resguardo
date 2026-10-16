/**
 * Barreira de rede dos testes (M8.3a; seção 10, teste 3): o `setupFiles` derruba qualquer `fetch` para `*.beds24.com`
 * (a sessão pode ter a credencial real) e deixa o resto passar. Nenhum destes testes sai da máquina: as URLs do Beds24
 * são recusadas antes da rede, e o resto vai a um `fetch` falso.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchComBarreira, limparTentativasBloqueadas, RedeBloqueadaNoTeste, temBarreira, tentativasBloqueadas, urlDoBeds24 } from "./barreira-de-rede";
import { ClienteBeds24Http } from "./http";

// A barreira também derrubaria o teste no afterEach do setup: aqui as tentativas são de propósito, então a lista é
// conferida e esvaziada no próprio teste.
afterEach(() => limparTentativasBloqueadas());

/**
 * Antes de usar o `fetch` global com uma URL do Beds24, confere (sem rede) que ele é o da barreira e que a URL é
 * reconhecida: se a barreira estivesse quebrada, o teste falharia aqui, nunca na rede.
 */
function exigirBarreira(...entradas: unknown[]) {
  expect(temBarreira(globalThis.fetch)).toBe(true);
  for (const e of entradas) expect(urlDoBeds24(e)).toBe(true);
}

describe("barreira de rede do Beds24 (M8.3a)", () => {
  it("o setup trocou o fetch global pelo da barreira", () => {
    expect(temBarreira(globalThis.fetch)).toBe(true);
  });

  it.each([
    "https://beds24.com/api/v2/bookings",
    "https://api.beds24.com/v2/bookings",
    "https://wiki.beds24.com/index.php/Category:API_V2",
    "http://BEDS24.COM/api/v2/authentication/details",
    "https://beds24.com./api/v2",
  ])("o fetch global recusa %s, sem rede, e registra a tentativa", async (url) => {
    exigirBarreira(url, new URL(url), new Request(url));
    await expect(fetch(url)).rejects.toBeInstanceOf(RedeBloqueadaNoTeste);
    await expect(fetch(new URL(url))).rejects.toBeInstanceOf(RedeBloqueadaNoTeste);
    await expect(fetch(new Request(url))).rejects.toBeInstanceOf(RedeBloqueadaNoTeste);
    expect(tentativasBloqueadas()).toHaveLength(3);
    limparTentativasBloqueadas();
  });

  it("o cliente do Beds24 com o fetch padrão também para na barreira (nenhuma credencial chega a sair)", async () => {
    exigirBarreira("https://beds24.com/api/v2/properties");
    const c = new ClienteBeds24Http({ token: "token-ficticio" });
    await expect(c.quartos()).rejects.toMatchObject({ tipo: "rede" });
    expect(tentativasBloqueadas()).toEqual(["beds24.com"]);
    limparTentativasBloqueadas();
  });

  it("embrulhado num fetch falso, o cliente nunca chega ao fetch de baixo com URL do Beds24", async () => {
    const baixo = vi.fn<typeof fetch>(async () => new Response("{}"));
    const c = new ClienteBeds24Http({ refreshToken: "refresh-ficticio", fetchImpl: fetchComBarreira(baixo) });
    await expect(c.reservas({ chegadaExata: "2026-12-20", incluirInfo: true })).rejects.toThrow();
    await expect(c.credencial()).rejects.toThrow();
    expect(baixo).not.toHaveBeenCalled();
    limparTentativasBloqueadas();
  });

  it("o resto passa pelo fetch de antes, sem mudança", async () => {
    const original = vi.fn<typeof fetch>(async () => new Response("ok"));
    const f = fetchComBarreira(original);
    for (const url of ["https://example.com/x", "https://notbeds24.com/api", "https://beds24.com.example.org/api", "https://api.mercadopago.com/v1"]) {
      expect(await (await f(url, { method: "GET" })).text()).toBe("ok");
    }
    expect(original).toHaveBeenCalledTimes(4);
    expect(original.mock.calls[0]).toEqual(["https://example.com/x", { method: "GET" }]);
    expect(tentativasBloqueadas()).toHaveLength(0);
  });

  it("reconhece o host, inclusive em endereço torto que menciona o Beds24", () => {
    expect(urlDoBeds24("https://api.beds24.com")).toBe(true);
    expect(urlDoBeds24("/api/v2/beds24.com")).toBe(true);
    expect(urlDoBeds24("https://beds24-falso.example.com")).toBe(false);
    expect(urlDoBeds24("/api/local")).toBe(false);
  });

  it("os testes que simulam a rede injetando o fetch seguem iguais", async () => {
    const injetado = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }));
    const c = new ClienteBeds24Http({ token: "token-ficticio", fetchImpl: injetado });
    expect((await c.quartos()).itens).toEqual([]);
    expect(injetado).toHaveBeenCalledTimes(1);
    expect(tentativasBloqueadas()).toHaveLength(0);
  });
});
