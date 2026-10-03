// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Contrato } from "@/contratos/repositorio";
import { Contratos } from "./Contratos";

const base = { organizacaoId: "o1", imovelId: "i403", tipo: "gestao_completa", comissaoBp: 1500, observacoes: "", criadoEm: new Date("2026-01-01T12:00:00Z") } as const;
const vigente = { ...base, id: "c1", inicio: "2026-01-01", fim: null, proprietarioBloqueia: true } as Contrato;
const encerrado = { ...base, id: "c0", inicio: "2025-01-01", fim: "2025-12-31", proprietarioBloqueia: false } as Contrato;
const criar = vi.fn();
const encerrar = vi.fn();
const bloqueioPortal = vi.fn();
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

const montar = (podeEditar: boolean) => render(<Contratos imovelId="i403" lista={[encerrado, vigente]} hoje="2026-10-03" criar={criar} encerrar={encerrar} bloqueioPortal={bloqueioPortal} podeEditar={podeEditar} />);

it("mostra 'Bloqueio pelo portal' por contrato e só quem edita o financeiro liga/desliga, e só em contrato em vigor", async () => {
  montar(true);
  const linhas = screen.getAllByRole("row").slice(1);
  expect(linhas[0].textContent).toContain("Não");
  expect(linhas[1].textContent).toContain("Sim");
  // Encerrado: sem botão; em vigor: "Desligar" (porque está ligado).
  expect(screen.queryByRole("button", { name: /Ligar o bloqueio pelo portal/ })).toBeNull();
  const desligar = screen.getByRole("button", { name: "Desligar o bloqueio pelo portal neste contrato" });
  bloqueioPortal.mockResolvedValue({ ok: true });
  fireEvent.click(desligar);
  await waitFor(() => expect(bloqueioPortal).toHaveBeenCalled());
  const form = bloqueioPortal.mock.calls[0][1] as FormData;
  expect(form.get("contratoId")).toBe("c1");
  expect(form.get("permitir")).toBe("nao");
});

it("sem permissão de edição não há botão; erro da ação aparece ao lado", async () => {
  montar(false);
  expect(screen.queryByRole("button", { name: /bloqueio pelo portal/ })).toBeNull();
  cleanup();
  montar(true);
  bloqueioPortal.mockResolvedValue({ mensagem: "Contrato não encontrado." });
  fireEvent.click(screen.getByRole("button", { name: "Desligar o bloqueio pelo portal neste contrato" }));
  await waitFor(() => expect(screen.getByText("Contrato não encontrado.")).toBeTruthy());
});
