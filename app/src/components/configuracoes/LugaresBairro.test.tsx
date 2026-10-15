// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LIMITES_BAIRRO } from "@/site/bairro";

const m = vi.hoisted(() => ({
  textos: vi.fn(),
  adicionar: vi.fn(),
  editar: vi.fn(),
  mover: vi.fn(),
  remover: vi.fn(),
  foto: vi.fn(),
  tirar: vi.fn(),
  reduzir: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/site/acoes-bairro", () => ({
  salvarTextosBairroAcao: m.textos,
  adicionarLugarAcao: m.adicionar,
  editarLugarAcao: m.editar,
  moverLugarAcao: m.mover,
  removerLugarAcao: m.remover,
  fotoLugarAcao: m.foto,
  tirarFotoLugarAcao: m.tirar,
}));
vi.mock("@/imoveis/reduzir-foto", () => ({ reduzirFoto: m.reduzir, nomeJpg: (n: string) => n, ErroFoto: class extends Error {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
import { type LugarDoPainel, LugaresBairro } from "./LugaresBairro";

// Lugares fictícios.
const praia: LugarDoPainel = { id: "l1", nome: "Praia Fictícia", distancia: "5 min a pé", frase: "Mar aberto.", bairro: "Leblon", foto: "/imagens-site/f1", semImovel: false };
const mirante: LugarDoPainel = { id: "l2", nome: "Mirante Inventado", distancia: "", frase: "", bairro: "Bairro Nenhum", foto: null, semImovel: true };
const tela = (lugares: LugarDoPainel[] = [praia, mirante]) =>
  render(<LugaresBairro olho="Olho fictício" titulo="Título fictício" subtitulo="Sub fictício" lugares={lugares} bairros={["Leblon", "Ipanema"]} limites={LIMITES_BAIRRO} />);
const enviado = (fn: ReturnType<typeof vi.fn>) => Object.fromEntries((fn.mock.calls.at(-1)![0] as FormData).entries());
const item = (nome: string) => within(screen.getByRole("form", { name: new RegExp(nome) }).closest("li")!);
/** Espera a ação anterior terminar (os botões ficam desligados enquanto isso) antes de clicar. */
const livre = (b: HTMLElement) => waitFor(() => expect((b as HTMLButtonElement).disabled).toBe(false));

beforeEach(() => {
  vi.resetAllMocks();
  for (const f of [m.textos, m.editar, m.mover, m.remover, m.foto, m.tirar]) f.mockResolvedValue({ ok: true, mudou: true });
  m.adicionar.mockResolvedValue({ ok: true, mudou: true, id: "novo-id" });
  m.reduzir.mockResolvedValue({ grande: new Blob(["g"]), pequena: new Blob(["p"]) });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("explica a seção (e que as fotos do estudo não podem ser usadas) e mostra textos, lugares, foto, aviso de bairro e o formulário novo", () => {
  tela();
  expect(screen.getByRole("heading", { level: 2, name: "O bairro à sua porta" })).toBeTruthy();
  expect(screen.getByText(/direitos delas não foram liberados/)).toBeTruthy();
  expect((screen.getByLabelText("Título da seção") as HTMLInputElement).value).toBe("Título fictício");
  // O olho da seção (M7.16), junto do título e do subtítulo, com o limite próprio.
  const olho = screen.getByLabelText(/^Olho/) as HTMLInputElement;
  expect(olho.value).toBe("Olho fictício");
  expect(olho.maxLength).toBe(LIMITES_BAIRRO.olho);
  expect(olho.required).toBe(false);
  const p = item("Praia Fictícia");
  expect((p.getByLabelText("Nome") as HTMLInputElement).value).toBe("Praia Fictícia");
  expect((p.getByLabelText("Distância") as HTMLInputElement).value).toBe("5 min a pé");
  expect(p.getByRole("img", { name: "Foto de Praia Fictícia" }).getAttribute("src")).toBe("/imagens-site/f1");
  expect(p.getByRole("button", { name: "Trocar foto: Praia Fictícia" })).toBeTruthy();
  expect(p.getByRole("button", { name: "Tirar foto: Praia Fictícia" })).toBeTruthy();
  expect((p.getByRole("button", { name: "Subir: Praia Fictícia" }) as HTMLButtonElement).disabled).toBe(true);
  const mi = item("Mirante Inventado");
  expect(mi.getByText(/Sem foto/)).toBeTruthy();
  expect(mi.getByRole("button", { name: "Pôr foto: Mirante Inventado" })).toBeTruthy();
  expect(mi.queryByRole("button", { name: /Tirar foto/ })).toBeNull();
  expect(mi.getByText(/Nenhum imóvel do site está no bairro/)).toBeTruthy();
  expect((mi.getByRole("button", { name: "Descer: Mirante Inventado" }) as HTMLButtonElement).disabled).toBe(true);
  expect(p.queryByText(/Nenhum imóvel do site está no bairro/)).toBeNull();
  expect(screen.getByRole("form", { name: "Adicionar lugar" })).toBeTruthy();
  expect([...document.querySelectorAll("datalist option")].map((o) => o.getAttribute("value"))).toEqual(["Leblon", "Ipanema"]);
});

it("salvar os textos da seção manda o olho (M7.16), o título e o subtítulo; erro do olho aparece no campo", async () => {
  tela();
  const form = within(screen.getByRole("form", { name: "Textos da seção O bairro à sua porta" }));
  fireEvent.change(form.getByLabelText(/^Olho/), { target: { value: "" } });
  fireEvent.click(form.getByRole("button", { name: "Salvar textos" }));
  await waitFor(() => expect(form.getByRole("status").textContent).toBe("Textos da seção salvos."));
  expect(enviado(m.textos)).toEqual({ olho: "", titulo: "Título fictício", subtitulo: "Sub fictício" });
  m.textos.mockResolvedValue({ ok: false, erro: "Confira os campos destacados.", erros: { olho: "Máximo de 60 caracteres." } });
  const salvar = form.getByRole("button", { name: "Salvar textos" });
  await livre(salvar);
  fireEvent.click(salvar);
  await waitFor(() => expect(form.getByText("Máximo de 60 caracteres.")).toBeTruthy());
});

it("salvar o lugar manda o que está no formulário e mostra o resultado; erro de campo aparece no campo", async () => {
  tela();
  const p = item("Praia Fictícia");
  fireEvent.change(p.getByLabelText("Frase curta"), { target: { value: "Frase nova." } });
  fireEvent.click(p.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(p.getByRole("status").textContent).toBe("Lugar salvo."));
  expect(enviado(m.editar)).toEqual({ id: "l1", nome: "Praia Fictícia", distancia: "5 min a pé", frase: "Frase nova.", bairro: "Leblon" });
  expect(m.refresh).toHaveBeenCalled();

  m.editar.mockResolvedValue({ ok: false, erro: "Confira os campos destacados.", erros: { distancia: "Máximo de 40 caracteres." } });
  await livre(p.getByRole("button", { name: "Salvar" }));
  fireEvent.click(p.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(p.getByText("Máximo de 40 caracteres.")).toBeTruthy());
  expect(p.getByRole("alert").textContent).toBe("Confira os campos destacados.");
});

it("remover e tirar foto só depois de confirmar; setas mudam a ordem", async () => {
  tela();
  const p = item("Praia Fictícia");
  vi.stubGlobal("confirm", vi.fn(() => false));
  fireEvent.click(p.getByRole("button", { name: "Remover: Praia Fictícia" }));
  fireEvent.click(p.getByRole("button", { name: "Tirar foto: Praia Fictícia" }));
  expect(m.remover).not.toHaveBeenCalled();
  expect(m.tirar).not.toHaveBeenCalled();
  vi.stubGlobal("confirm", vi.fn(() => true));
  fireEvent.click(p.getByRole("button", { name: "Tirar foto: Praia Fictícia" }));
  await waitFor(() => expect(m.tirar).toHaveBeenCalledTimes(1));
  expect(enviado(m.tirar)).toEqual({ id: "l1" });
  await livre(p.getByRole("button", { name: "Remover: Praia Fictícia" }));
  fireEvent.click(p.getByRole("button", { name: "Remover: Praia Fictícia" }));
  await waitFor(() => expect(screen.getByText('"Praia Fictícia" saiu da seção e do site.')).toBeTruthy());
  expect(enviado(m.remover)).toEqual({ id: "l1" });
  await livre(p.getByRole("button", { name: "Descer: Praia Fictícia" }));
  fireEvent.click(p.getByRole("button", { name: "Descer: Praia Fictícia" }));
  await waitFor(() => expect(enviado(m.mover)).toEqual({ id: "l1", passo: "1" }));
});

it("foto escolhida é reduzida no navegador e sobe sozinha, na versão pequena", async () => {
  tela();
  const mi = item("Mirante Inventado");
  const arquivo = new File(["x"], "mirante.jpg", { type: "image/jpeg" });
  fireEvent.change(mi.getByLabelText("Foto de Mirante Inventado"), { target: { files: [arquivo] } });
  await waitFor(() => expect(mi.getByRole("status").textContent).toMatch(/Foto salva/));
  expect(m.reduzir).toHaveBeenCalledWith(arquivo);
  const form = enviado(m.foto);
  expect(form.id).toBe("l2");
  expect(await (form.arquivo as File).text()).toBe("p");
});

it("adicionar lugar (com foto opcional, que sobe depois com o id novo); no máximo de 12, o formulário sai", async () => {
  tela();
  const novo = within(screen.getByRole("form", { name: "Adicionar lugar" }));
  fireEvent.change(novo.getByLabelText("Nome"), { target: { value: "Livraria de Teste" } });
  fireEvent.change(novo.getByLabelText(/Foto \(opcional/), { target: { files: [new File(["x"], "livraria.jpg", { type: "image/jpeg" })] } });
  fireEvent.click(novo.getByRole("button", { name: "Adicionar lugar" }));
  await waitFor(() => expect(novo.getByRole("status").textContent).toMatch(/Lugar adicionado/));
  expect(enviado(m.adicionar)).toEqual({ nome: "Livraria de Teste", distancia: "", frase: "", bairro: "" });
  expect(enviado(m.foto).id).toBe("novo-id");
  cleanup();
  tela(Array.from({ length: LIMITES_BAIRRO.lugares }, (_, i) => ({ ...mirante, id: `l${i}`, nome: `Lugar ${i}`, semImovel: false })));
  expect(screen.queryByRole("form", { name: "Adicionar lugar" })).toBeNull();
  expect(screen.getByText(/Já são 12 lugares, o máximo/)).toBeTruthy();
});
