import { afterEach, expect, it, vi } from "vitest";
import { ESPERA_TELA_MS, esperarNoMaximo } from "./prazo";

afterEach(() => vi.useRealTimers());

it("devolve o resultado quando chega a tempo, e o valor de esgotado quando não chega (sem esperar mais que o limite)", async () => {
  expect(await esperarNoMaximo(Promise.resolve(true), 50, null)).toBe(true);
  vi.useFakeTimers();
  const nunca = new Promise<boolean>(() => undefined);
  const r = esperarNoMaximo(nunca, ESPERA_TELA_MS, "esgotou" as const);
  await vi.advanceTimersByTimeAsync(ESPERA_TELA_MS - 1);
  let pronto = false;
  void r.then(() => (pronto = true));
  await vi.advanceTimersByTimeAsync(0);
  expect(pronto).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await r).toBe("esgotou");
  // O relógio é limpo quando o resultado chega antes.
  await esperarNoMaximo(Promise.resolve(1), ESPERA_TELA_MS, null);
  expect(vi.getTimerCount()).toBe(0);
});

it("falha da promessa sobe (quem chama decide o que fazer com ela)", async () => {
  await expect(esperarNoMaximo(Promise.reject(new Error("rede")), 50, null)).rejects.toThrow("rede");
});
