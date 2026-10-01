// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ buscar: vi.fn(), salvar: vi.fn(), importar: vi.fn(), vincular: vi.fn() }));
vi.mock("@/beds24/sync-acoes", () => ({ conferirQuartosBeds24: m.buscar, configurarSyncBeds24: m.salvar, importarBeds24Agora: m.importar, vincularQuartoBeds24: m.vincular }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
import { SincronizarBeds24 } from "./SincronizarBeds24";
const config = { automatica: false, desde: "2026-09-28", diasCalendario: 180 };
beforeEach(() => {
  vi.resetAllMocks();
  m.buscar.mockResolvedValue({ ok: true, mensagem: "1 quarto encontrado", quartos: [{ propertyId: "10", roomId: "20", nome: "Quarto de teste", moeda: "BRL" }] });
  m.salvar.mockResolvedValue({ ok: true, mensagem: "Configuração salva" });
});
afterEach(cleanup);

it("primeiro uso começa desligado e impede importar sem vínculos", () => {
  render(<SincronizarBeds24 config={config} mapas={[]} imoveis={[]} execucoes={[]} />);
  expect((screen.getByLabelText("Importar automaticamente uma vez por dia") as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole("button", { name: "Importar agora" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText(/Conferi os vínculos/) as HTMLInputElement).required).toBe(true);
});

it("buscar quartos mostra a escolha de imóvel e não inicia importação", async () => {
  render(<SincronizarBeds24 config={config} mapas={[]} imoveis={[{ id: "im", codigo: "T1" }]} execucoes={[]} />);
  fireEvent.submit(screen.getByRole("button", { name: "Buscar quartos para vincular" }).closest("form")!);
  await waitFor(() => expect(screen.getByText("Quarto de teste")).toBeTruthy());
  expect(screen.getByLabelText("Imóvel correspondente no SCL")).toBeTruthy();
  expect(m.importar).not.toHaveBeenCalled();
  expect(m.vincular).not.toHaveBeenCalled();
});
