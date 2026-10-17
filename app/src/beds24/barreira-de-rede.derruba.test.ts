/**
 * Barreira de rede dos testes (M8.3a; seção 10, teste 3; M10.1a): a metade "derruba o teste mesmo com o erro tratado".
 * Este arquivo não tem `afterEach` próprio que esvazie a lista: quem derruba o primeiro caso é o `afterEach` do setup
 * (`barreira-de-rede.setup.ts`). Sem ele, o primeiro caso passaria e o `it.fails` acusaria. A tentativa é sobre a
 * barreira em cima de um `fetch` falso que lança: nada vai à rede.
 */
import { describe, expect, it, vi } from "vitest";
import { fetchComBarreira, tentativasBloqueadas } from "./barreira-de-rede";

describe("o afterEach do setup derruba o teste que tentou chegar ao Beds24 (M8.3a)", () => {
  it.fails("a tentativa engolida pelo código testado derruba o teste", async () => {
    const f = fetchComBarreira(vi.fn<typeof fetch>(async () => {
      throw new Error("rede no teste");
    }));
    await f("https://beds24.com/api/v2/bookings").catch(() => null);
  });

  it("o caso seguinte começa com a lista vazia (o setup a esvaziou)", () => {
    expect(tentativasBloqueadas()).toHaveLength(0);
  });
});

describe("o afterEach do setup derruba o teste que tentou chegar à Meta (M10.1a)", () => {
  it.fails("a tentativa engolida de chegar à Graph API derruba o teste", async () => {
    const f = fetchComBarreira(vi.fn<typeof fetch>(async () => {
      throw new Error("rede no teste");
    }));
    await f("https://graph.facebook.com/v26.0/100000000000001/messages").catch(() => null);
  });

  it("o caso seguinte começa com a lista vazia (o setup a esvaziou)", () => {
    expect(tentativasBloqueadas()).toHaveLength(0);
  });
});
