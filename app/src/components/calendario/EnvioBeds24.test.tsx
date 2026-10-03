// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ enviar: vi.fn() }));
vi.mock("@/calendario/acoes", () => ({ enviarCalendarioAcao: m.enviar }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
import { EnvioBeds24 } from "./EnvioBeds24";

const props = { imovelId: "i103", codigo: "103", escritaLigada: true, envioLigado: true, vinculoOk: true, horizonteDias: 270 };
beforeEach(() => {
  vi.resetAllMocks();
  m.enviar.mockResolvedValue({ resultado: { ok: true, situacao: "simulacao", mensagem: "Simulação: 10 noite(s) seriam enviadas", envioId: "e", imoveis: [{ imovelId: "i103", codigo: "103", resumo: { noites: 10, enviar: 10, iguais: 0, semDados: 0, ocupadas: 1, comAvisos: 2 }, enviadas: 0, confirmadas: 0, divergentes: 0, falha: "" }], avisos: ["aviso"], totalAvisos: 1 } });
});
afterEach(cleanup);

it("sem o sinal da Vercel o envio fica bloqueado, mas a simulação continua disponível", () => {
  render(<EnvioBeds24 {...props} escritaLigada={false} />);
  expect(screen.getByText(/BEDS24_ESCRITA/).textContent).toContain("desligado");
  expect((screen.getByRole("button", { name: "Enviar agora ao Beds24" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText(/Conferi a prévia e a simulação/) as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Simular envio (não grava nada)" }) as HTMLButtonElement).disabled).toBe(false);
});

it("envio desligado no painel ou vínculo ausente bloqueia simulação e envio", () => {
  render(<EnvioBeds24 {...props} envioLigado={false} />);
  expect((screen.getByRole("button", { name: "Simular envio (não grava nada)" }) as HTMLButtonElement).disabled).toBe(true);
  cleanup();
  render(<EnvioBeds24 {...props} vinculoOk={false} />);
  expect((screen.getByRole("button", { name: "Enviar agora ao Beds24" }) as HTMLButtonElement).disabled).toBe(true);
});

it("simular chama a ação em modo simulação e mostra o resultado com avisos", async () => {
  render(<EnvioBeds24 {...props} />);
  fireEvent.submit(screen.getByRole("button", { name: "Simular envio (não grava nada)" }).closest("form")!);
  await waitFor(() => expect(screen.getByText(/Simulação \(nada enviado\)/)).toBeTruthy());
  const form = m.enviar.mock.calls[0][1] as FormData;
  expect(form.get("modo")).toBe("simulacao");
  expect(form.get("imovelId")).toBe("i103");
  expect(screen.getByText(/10 a enviar/)).toBeTruthy();
  expect(screen.getByText("aviso")).toBeTruthy();
});

it("enviar exige confirmação na janela e manda modo envio", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<EnvioBeds24 {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Enviar agora ao Beds24" }));
  expect(m.enviar).not.toHaveBeenCalled();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  fireEvent.click(screen.getByLabelText(/Conferi a prévia e a simulação/));
  m.enviar.mockResolvedValue({ erro: "Confirme que conferiu a prévia e a simulação e quer enviar ao Beds24." });
  fireEvent.submit(screen.getByRole("button", { name: "Enviar agora ao Beds24" }).closest("form")!);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Confirme"));
  const form = m.enviar.mock.calls.at(-1)![1] as FormData;
  expect(form.get("modo")).toBe("envio");
});
