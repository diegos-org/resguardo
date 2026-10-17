// @vitest-environment jsdom
/**
 * O "lida" da conversa (M10.1a, 6.4): marcado pelo navegador depois de aberta, uma vez por conversa e última recebida
 * mostrada (também no modo estrito do React, que roda o efeito duas vezes), nunca pelo servidor. Falha da ação não
 * quebra a tela. A ação é simulada.
 */
import { cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ marcar: vi.fn() }));
vi.mock("@/whatsapp/acoes", () => ({ marcarComoLidaAcao: m.marcar }));
import { MarcarComoLida } from "./MarcarComoLida";

const ID = "11111111-1111-4111-8111-111111111111";
const ATE = "2026-10-17T15:00:00.000Z";
beforeEach(() => {
  vi.clearAllMocks();
  m.marcar.mockResolvedValue(undefined);
});
afterEach(cleanup);

it("no servidor não marca nada (o Link pode pré-carregar a página) e não desenha nada", () => {
  expect(renderToStaticMarkup(<MarcarComoLida contatoId={ID} ate={ATE} />)).toBe("");
  expect(m.marcar).not.toHaveBeenCalled();
});

it("no navegador marca uma vez, com o id e a hora da última recebida, mesmo no modo estrito; outra mensagem mostrada marca de novo", () => {
  const { rerender } = render(
    <StrictMode>
      <MarcarComoLida contatoId={ID} ate={ATE} />
    </StrictMode>,
  );
  expect(m.marcar).toHaveBeenCalledTimes(1);
  expect(m.marcar).toHaveBeenCalledWith(ID, ATE);
  rerender(
    <StrictMode>
      <MarcarComoLida contatoId={ID} ate={ATE} />
    </StrictMode>,
  );
  expect(m.marcar).toHaveBeenCalledTimes(1);
  rerender(
    <StrictMode>
      <MarcarComoLida contatoId={ID} ate="2026-10-17T15:05:00.000Z" />
    </StrictMode>,
  );
  expect(m.marcar).toHaveBeenCalledTimes(2);
});

it("a ação que falha não quebra a tela", async () => {
  m.marcar.mockRejectedValue(new Error("sem conexão"));
  expect(() => render(<MarcarComoLida contatoId={ID} ate={ATE} />)).not.toThrow();
  await Promise.resolve();
  expect(m.marcar).toHaveBeenCalledTimes(1);
});
