// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FormAnuncio } from "./FormAnuncio";
afterEach(cleanup);
it("envia os dados e a conferência explícita, mostrando o resultado", async () => {
  const salvar = vi.fn().mockResolvedValue({ ok: true });
  render(<FormAnuncio imovelId="im" canal="airbnb" salvar={salvar} />);
  fireEvent.change(screen.getByLabelText("Título no canal"), { target: { value: "Studio teste" } });
  fireEvent.change(screen.getByLabelText("Preço base informado (R$)"), { target: { value: "250,50" } });
  fireEvent.click(screen.getByLabelText("Conferi estas informações no canal agora"));
  fireEvent.submit(screen.getByRole("form"));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Referência salva."));
  const f = salvar.mock.calls[0][1] as FormData;
  expect(Object.fromEntries(f)).toMatchObject({ imovelId: "im", canal: "airbnb", versao: "0", titulo: "Studio teste", precoBase: "250,50", conferido: "on" });
});
it("mostra erro retornado pelo servidor sem anunciar sucesso", async () => {
  render(<FormAnuncio imovelId="im" canal="booking" salvar={async () => ({ erro: "Este anúncio mudou em outra tela." })} />);
  fireEvent.submit(screen.getByRole("form"));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("outra tela"));
  expect(screen.queryByRole("status")).toBeNull();
});
