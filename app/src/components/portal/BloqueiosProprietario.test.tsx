// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BloqueiosProprietario } from "./BloqueiosProprietario";

const imoveis = [
  { id: "i403", codigo: "403", nome: "Quatro", permissao: true as boolean | null },
  { id: "i303", codigo: "303", nome: "Três", permissao: false as boolean | null },
];
const bloqueios = [
  { id: "b1", imovelId: "i403", codigo: "403", inicio: "2026-10-10", fim: "2026-10-12", motivo: "Uso próprio", fonte: "proprietario", liberavel: true },
  { id: "b2", imovelId: "i403", codigo: "403", inicio: "2026-11-10", fim: "2026-11-12", motivo: "Manutenção", fonte: "manual", liberavel: false },
];
const bloquear = vi.fn();
const liberar = vi.fn();
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

it("lista os bloqueios com quem fez cada um e só deixa liberar os do proprietário", () => {
  render(<BloqueiosProprietario imoveis={imoveis} bloqueios={bloqueios} empresa="Sua Casa Exemplo" hoje="2026-10-03" bloquear={bloquear} liberar={liberar} />);
  expect(screen.getByText("Você")).toBeTruthy();
  expect(screen.getByText("Sua Casa Exemplo")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Liberar" })).toHaveLength(1);
  // Só o imóvel com permissão entra no formulário; o outro é explicado.
  expect(screen.queryByRole("option", { name: /303/ })).toBeNull();
  expect(screen.getByText(/Imóveis sem a opção acima/)).toBeTruthy();
});

it("bloquear envia imóvel, datas e motivo; a recusa aparece como aviso; liberar pede confirmação", async () => {
  bloquear.mockResolvedValue({ erro: "Há reserva nessas datas: não dá para bloquear por cima de um hóspede.", valores: { imovelId: "i403", inicio: "2026-10-20", fim: "2026-10-22", motivo: "x" } });
  render(<BloqueiosProprietario imoveis={imoveis} bloqueios={bloqueios} empresa="Sua Casa Exemplo" hoje="2026-10-03" bloquear={bloquear} liberar={liberar} />);
  fireEvent.change(screen.getByLabelText("Primeira noite"), { target: { value: "2026-10-20" } });
  fireEvent.change(screen.getByLabelText("Liberado a partir de"), { target: { value: "2026-10-22" } });
  fireEvent.change(screen.getByLabelText("Motivo (opcional)"), { target: { value: "x" } });
  fireEvent.submit(screen.getByRole("button", { name: "Bloquear" }).closest("form")!);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Há reserva"));
  const form = bloquear.mock.calls[0][1] as FormData;
  expect([form.get("imovelId"), form.get("inicio"), form.get("fim"), form.get("motivo")]).toEqual(["i403", "2026-10-20", "2026-10-22", "x"]);
  vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "Liberar" }));
  expect(liberar).not.toHaveBeenCalled();
});

it("sem nenhum imóvel com permissão, explica em vez de mostrar o formulário", () => {
  render(<BloqueiosProprietario imoveis={[imoveis[1]]} bloqueios={[]} empresa="Sua Casa Exemplo" hoje="2026-10-03" bloquear={bloquear} liberar={liberar} />);
  expect(screen.getByRole("note").textContent).toContain("não prevê bloqueio");
  expect(screen.queryByRole("button", { name: "Bloquear" })).toBeNull();
  cleanup();
  render(<BloqueiosProprietario imoveis={[{ ...imoveis[0], permissao: null }]} bloqueios={[]} empresa="Sua Casa Exemplo" hoje="2026-10-03" bloquear={bloquear} liberar={liberar} />);
  expect(screen.getByRole("note").textContent).toContain("contrato em vigor");
});
