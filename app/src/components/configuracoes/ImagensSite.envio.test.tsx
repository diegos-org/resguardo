// @vitest-environment jsdom
/**
 * M7.13 — o envio da foto da capa em Configurações → Site manda as duas versões reduzidas no navegador: `arquivo` (a
 * grande) e `pequena` (800 px, para a prévia dos links), com os nomes que a ação lê. A marca sobe sozinha, sem versão
 * pequena. A redução e a ação são falsas aqui; a ação de verdade está em src/site/acoes-imagens-site.test.ts.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ enviar: vi.fn(), reduzir: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/site/acoes-imagens-site", () => ({ enviarImagemSiteAcao: m.enviar, tirarImagemSiteAcao: vi.fn() }));
vi.mock("@/imoveis/reduzir-foto", async (orig) => ({ ...(await orig<typeof import("@/imoveis/reduzir-foto")>()), reduzirFoto: m.reduzir }));
import { ImagensSite } from "./ImagensSite";

beforeEach(() => {
  vi.resetAllMocks();
  m.enviar.mockResolvedValue({ ok: true });
  m.reduzir.mockResolvedValue({ grande: new Blob(["g".repeat(64)], { type: "image/jpeg" }), pequena: new Blob(["p".repeat(16)], { type: "image/jpeg" }) });
});
afterEach(cleanup);

const escolherEEnviar = (rotulo: RegExp, botao: string, arquivo: File) => {
  fireEvent.change(screen.getByLabelText(rotulo), { target: { files: [arquivo] } });
  fireEvent.submit(screen.getByRole("button", { name: botao }).closest("form")!);
};

it("capa: o formulário leva a grande em `arquivo` e a versão pequena em `pequena`, as duas da redução no navegador", async () => {
  render(<ImagensSite capa={null} marca={null} marcaPadrao="/marca.png" />);
  const original = new File(["original"], "Foto do Celular.HEIC", { type: "image/heic" });
  escolherEEnviar(/Enviar a foto/, "Enviar foto da capa", original);
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Foto da capa trocada"));
  expect(m.reduzir).toHaveBeenCalledWith(original);
  const form = m.enviar.mock.calls[0][0] as FormData;
  expect(form.get("qual")).toBe("capa");
  const grande = form.get("arquivo") as File;
  const pequena = form.get("pequena") as File;
  expect([grande.name, grande.type, grande.size]).toEqual(["Foto do Celular.jpg", "image/jpeg", 64]);
  expect([pequena.name, pequena.type, pequena.size]).toEqual(["Foto do Celular-pequena.jpg", "image/jpeg", 16]);
});

it("marca: sobe como está, sem redução e sem versão pequena", async () => {
  render(<ImagensSite capa={null} marca={null} marcaPadrao="/marca.png" />);
  const marca = new File(["png"], "marca.png", { type: "image/png" });
  escolherEEnviar(/Trocar a marca/, "Enviar marca", marca);
  await waitFor(() => expect(m.enviar).toHaveBeenCalled());
  expect(m.reduzir).not.toHaveBeenCalled();
  const form = m.enviar.mock.calls[0][0] as FormData;
  expect(form.get("qual")).toBe("marca");
  expect((form.get("arquivo") as File).name).toBe("marca.png");
  expect(form.get("pequena")).toBeNull();
});
