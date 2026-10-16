// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { ConfigBairro } from "@/site/bairro";
import { LIMITES_BAIRRO } from "@/site/bairro";

/**
 * Quadro "O bairro à sua porta" em Configurações → Textos do site: o que o servidor lê da configuração do bairro chega a
 * cada campo do formulário (o olho, M7.16, o título e o subtítulo), e cada lugar com a foto e o aviso de bairro. Só a
 * leitura do banco é trocada por dados fictícios.
 */
const m = vi.hoisted(() => ({ ler: vi.fn(), bairros: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/site/bairro", async (orig) => ({ ...(await orig<typeof import("@/site/bairro")>()), lerBairro: m.ler, bairrosDoSite: m.bairros }));
vi.mock("@/site/acoes-bairro", () => ({
  salvarTextosBairroAcao: vi.fn(),
  adicionarLugarAcao: vi.fn(),
  editarLugarAcao: vi.fn(),
  moverLugarAcao: vi.fn(),
  removerLugarAcao: vi.fn(),
  fotoLugarAcao: vi.fn(),
  tirarFotoLugarAcao: vi.fn(),
}));
vi.mock("@/imoveis/reduzir-foto", () => ({ reduzirFoto: vi.fn(), nomeJpg: (n: string) => n, ErroFoto: class extends Error {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { BairroPainel } = await import("./BairroPainel");

const FOTO = "11111111-1111-4111-8111-111111111111";
const config: ConfigBairro = {
  olho: "Olho fictício do bairro",
  titulo: "Título fictício do bairro.",
  subtitulo: "Subtítulo fictício do bairro.",
  lugares: [
    { id: "22222222-2222-4222-8222-222222222222", nome: "Praia Fictícia", distancia: "5 min a pé", frase: "Mar aberto.", bairro: "leblon", fotoId: FOTO },
    { id: "33333333-3333-4333-8333-333333333333", nome: "Mirante Inventado", distancia: "", frase: "", bairro: "Bairro Nenhum", fotoId: null },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  m.ler.mockResolvedValue(config);
  m.bairros.mockResolvedValue(["Leblon"]);
});

const tela = async () => {
  const raiz = document.createElement("div");
  raiz.innerHTML = renderToStaticMarkup(await BairroPainel({ organizacaoId: "org" }));
  return raiz;
};
/** O campo do formulário dos textos da seção (os lugares têm os formulários deles). */
const campoDosTextos = (raiz: HTMLElement, nome: string) =>
  raiz.querySelector('form[aria-label="Textos da seção O bairro à sua porta"]')!.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${nome}"]`)!;

it("cada texto da seção chega ao seu campo: o olho mostra o olho salvo, com o limite dele; o título e o subtítulo, os deles", async () => {
  const raiz = await tela();
  expect(m.ler).toHaveBeenCalledWith({}, "org");
  expect(m.bairros).toHaveBeenCalledWith({}, "org");
  const olho = campoDosTextos(raiz, "olho");
  expect(olho.closest("label")!.textContent).toMatch(/^Olho/);
  expect(olho.getAttribute("value")).toBe("Olho fictício do bairro");
  expect(olho.getAttribute("maxlength")).toBe(String(LIMITES_BAIRRO.olho));
  expect(campoDosTextos(raiz, "titulo").getAttribute("value")).toBe("Título fictício do bairro.");
  const subtitulo = campoDosTextos(raiz, "subtitulo");
  expect(subtitulo.tagName).toBe("TEXTAREA");
  expect(subtitulo.textContent).toBe("Subtítulo fictício do bairro.");
});

it("olho salvo em branco: o campo aparece vazio (não volta ao texto inicial)", async () => {
  m.ler.mockResolvedValue({ ...config, olho: "" });
  const raiz = await tela();
  expect(campoDosTextos(raiz, "olho").getAttribute("value")).toBe("");
});

it("cada lugar com a foto pelo endereço público e o aviso só no lugar cujo bairro não está em nenhuma casa do site", async () => {
  const raiz = await tela();
  expect(raiz.innerHTML).toContain(FOTO);
  const itens = [...raiz.querySelectorAll("li")];
  const doLugar = (nome: string) => itens.find((li) => li.querySelector(`input[name="nome"][value="${nome}"]`))!;
  const praia = doLugar("Praia Fictícia");
  const mirante = doLugar("Mirante Inventado");
  expect(praia.querySelector("img")!.getAttribute("alt")).toBe("Foto de Praia Fictícia");
  // "leblon" no lugar e "Leblon" na casa: o mesmo bairro (sem diferença de maiúscula), sem aviso.
  expect(praia.textContent).not.toContain("Nenhum imóvel do site está no bairro");
  expect(mirante.textContent).toContain("Nenhum imóvel do site está no bairro “Bairro Nenhum”");
});
