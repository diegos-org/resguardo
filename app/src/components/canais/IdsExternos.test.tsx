// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { IdExterno } from "@/canais/ids-externos";
import { IdsExternos } from "./IdsExternos";

const lista: IdExterno[] = [{ id: "r1", organizacaoId: "o1", imovelId: "i103", canal: "beds24", idExterno: "10", detalhe: "20", criadoEm: new Date("2026-10-01T12:00:00Z") } as IdExterno];
const adicionar = vi.fn();
const remover = vi.fn();
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

it("remover pede confirmação e mostra o aviso quando a remoção é recusada (envio em andamento)", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<IdsExternos imovelId="i103" lista={lista} adicionar={adicionar} remover={remover} />);
  fireEvent.click(screen.getByRole("button", { name: "Remover" }));
  expect(remover).not.toHaveBeenCalled();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  remover.mockResolvedValue({ erro: "Há um envio de calendário e preços em andamento. Aguarde alguns minutos e tente de novo." });
  fireEvent.click(screen.getByRole("button", { name: "Remover" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("envio de calendário"));
  expect((remover.mock.calls[0][1] as FormData).get("registroId")).toBe("r1");
});
