import { describe, expect, it } from "vitest";
import { lerCorpoLimitado, respostaVazia } from "./corpo-limitado";

/** Um pedido com o corpo em partes (sem Content-Length, como um envio em blocos), cada parte com `tamanho` bytes. */
const emPartes = (partes: number, tamanho: number, cabecalhos: Record<string, string> = {}) =>
  new Request("https://exemplo.test/aviso", {
    method: "POST",
    headers: cabecalhos,
    body: new ReadableStream<Uint8Array>({
      start(ctl) {
        for (let i = 0; i < partes; i++) ctl.enqueue(new Uint8Array(tamanho).fill(65));
        ctl.close();
      },
    }),
    duplex: "half",
  } as RequestInit);

const pedido = (corpo: BodyInit | null, cabecalhos: Record<string, string> = {}) => new Request("https://exemplo.test/aviso", { method: "POST", headers: cabecalhos, body: corpo });

describe("lerCorpoLimitado (M10.1a, comum ao Mercado Pago e ao WhatsApp)", () => {
  it("devolve os bytes crus, exatamente como chegaram (sem decodificar)", async () => {
    const bytes = Buffer.from([0x7b, 0xff, 0xfe, 0x7d]);
    const r = await lerCorpoLimitado(pedido(bytes), 100);
    expect(r).toEqual({ ok: true, bytes });
  });

  it("sem corpo: Buffer vazio", async () => {
    const r = await lerCorpoLimitado(new Request("https://exemplo.test/aviso", { method: "POST" }), 100);
    expect(r).toEqual({ ok: true, bytes: Buffer.alloc(0) });
  });

  it("no limite exato passa; um byte a mais é 413 (pela leitura)", async () => {
    expect(await lerCorpoLimitado(emPartes(4, 25), 100)).toMatchObject({ ok: true, bytes: expect.any(Buffer) });
    expect(((await lerCorpoLimitado(emPartes(4, 25), 100)) as { bytes: Buffer }).bytes).toHaveLength(100);
    expect(await lerCorpoLimitado(emPartes(101, 1), 100)).toEqual({ ok: false, status: 413 });
  });

  it("Content-Length acima do limite: 413 sem começar a ler; no limite, lê", async () => {
    const acima = pedido("x".repeat(10), { "content-length": "101" });
    expect(await lerCorpoLimitado(acima, 100)).toEqual({ ok: false, status: 413 });
    expect(acima.bodyUsed).toBe(false);
    expect(await lerCorpoLimitado(pedido("x".repeat(100), { "content-length": "100" }), 100)).toMatchObject({ ok: true });
  });

  it("Content-Length que não é número é ignorado: a leitura confere o tamanho", async () => {
    expect(await lerCorpoLimitado(emPartes(1, 10, { "content-length": "muito" }), 100)).toMatchObject({ ok: true });
    expect(await lerCorpoLimitado(emPartes(1, 101, { "content-length": "-5" }), 100)).toEqual({ ok: false, status: 413 });
    // `Number()` leria estes como grandes, mas não são um Content-Length válido (só dígitos): também ignorados.
    expect(await lerCorpoLimitado(emPartes(1, 10, { "content-length": "1e9" }), 100)).toMatchObject({ ok: true });
    expect(await lerCorpoLimitado(emPartes(1, 10, { "content-length": "0x1F4" }), 100)).toMatchObject({ ok: true });
  });

  it("leitura que lança (corpo já lido, conexão caída): 400", async () => {
    const lido = pedido("abc");
    await lido.text();
    expect(await lerCorpoLimitado(lido, 100)).toEqual({ ok: false, status: 400 });
    const quebrado = new Request("https://exemplo.test/aviso", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        pull() {
          throw new Error("conexão caiu");
        },
      }),
      duplex: "half",
    } as RequestInit);
    expect(await lerCorpoLimitado(quebrado, 100)).toEqual({ ok: false, status: 400 });
  });

  it("respostaVazia: sem corpo e sem cache", async () => {
    const r = respostaVazia(503);
    expect(r.status).toBe(503);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.text()).toBe("");
  });
});
