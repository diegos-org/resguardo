// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ novo: vi.fn(), remover: vi.fn() }));
vi.mock("@/calendario/acoes", () => ({ novoBloqueioAcao: m.novo, removerBloqueioAcao: m.remover }));
import { Bloqueios } from "./Bloqueios";

const imoveis = [{ id: "i103", codigo: "103" }];
const bloqueios = [
  { id: "b1", imovelId: "i103", inicio: "2026-10-03", fim: "2026-10-05", motivo: "Uso próprio", fonte: "manual" },
  { id: "b2", imovelId: "i103", inicio: "2026-10-07", fim: "2026-10-08", motivo: "", fonte: "beds24" },
];
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

it("lista bloqueios com origem e só permite remover os do SCL", () => {
  render(<Bloqueios imoveis={imoveis} bloqueios={bloqueios} />);
  expect(screen.getByText("Uso próprio")).toBeTruthy();
  expect(screen.getByText("Beds24 (mude lá)")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Remover" })).toHaveLength(1);
});

it("remover pede confirmação; o formulário de novo bloqueio envia imóvel, datas e motivo", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<Bloqueios imoveis={imoveis} bloqueios={bloqueios} />);
  fireEvent.click(screen.getByRole("button", { name: "Remover" }));
  expect(m.remover).not.toHaveBeenCalled();
  m.novo.mockResolvedValue({ erro: "Já existe um bloqueio nessas datas. Remova-o ou ajuste as datas.", valores: { imovelId: "i103", inicio: "2026-10-03", fim: "2026-10-04", motivo: "x" } });
  fireEvent.change(screen.getByLabelText("Imóvel"), { target: { value: "i103" } });
  fireEvent.change(screen.getByLabelText("Primeira noite bloqueada"), { target: { value: "2026-10-03" } });
  fireEvent.change(screen.getByLabelText("Liberado a partir de"), { target: { value: "2026-10-04" } });
  fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "x" } });
  fireEvent.submit(screen.getByRole("button", { name: "Bloquear" }).closest("form")!);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Já existe"));
  const form = m.novo.mock.calls[0][1] as FormData;
  expect([form.get("imovelId"), form.get("inicio"), form.get("fim"), form.get("motivo")]).toEqual(["i103", "2026-10-03", "2026-10-04", "x"]);
});

it("remoção recusada (envio em andamento) mostra o aviso", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  m.remover.mockResolvedValue({ erro: "Há um envio de calendário e preços em andamento. Aguarde alguns minutos e tente de novo." });
  render(<Bloqueios imoveis={imoveis} bloqueios={bloqueios} />);
  fireEvent.click(screen.getByRole("button", { name: "Remover" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("envio de calendário"));
  expect((m.remover.mock.calls[0][1] as FormData).get("id")).toBe("b1");
});
