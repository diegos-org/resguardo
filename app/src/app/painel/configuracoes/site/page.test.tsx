// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import Page from "./page";

/**
 * Configurações → Textos do site: a tela monta os campos a partir da lista dos textos do site, com os títulos e as frases
 * que eram fixos no código (M7.16) junto dos outros. As outras partes da página (imagens e bairro) ficam de fora aqui.
 */
const m = vi.hoisted(() => ({ sessao: vi.fn(), textos: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/configuracoes/acoes", () => ({ salvarTextosAcao: vi.fn() }));
vi.mock("@/components/configuracoes/ImagensSitePainel", () => ({ ImagensSitePainel: () => null }));
vi.mock("@/components/configuracoes/BairroPainel", () => ({ BairroPainel: () => null }));
vi.mock("@/configuracoes/textos-site", async (original) => ({ ...(await original<typeof import("@/configuracoes/textos-site")>()), lerTextosSite: m.textos }));

beforeEach(() => {
  vi.clearAllMocks();
  m.redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
  m.sessao.mockResolvedValue({ papel: "admin", usuarioId: "u", organizacaoId: "org" });
  m.textos.mockResolvedValue(TEXTOS_SITE_INICIAIS);
});

const tela = async () => {
  const raiz = document.createElement("div");
  raiz.innerHTML = renderToStaticMarkup(await Page());
  return raiz;
};
const campo = (raiz: HTMLElement, nome: string) => raiz.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${nome}"]`)!;
const rotulo = (raiz: HTMLElement, nome: string) => campo(raiz, nome).closest("label")!.textContent!.trim();

it("quem não edita as configurações não abre a tela", async () => {
  m.sessao.mockResolvedValue({ papel: "operacao", usuarioId: "u", organizacaoId: "org" });
  await expect(tela()).rejects.toThrow("NEXT_REDIRECT");
  expect(m.textos).not.toHaveBeenCalled();
});

it("os títulos e as frases que eram fixos (M7.16) aparecem como campos, com o texto de antes, o limite e o rótulo de cada um", async () => {
  const raiz = await tela();
  expect(m.textos).toHaveBeenCalledWith({}, "org");
  const esperado = [
    ["comoReservarOlho", "Passo a passo", 60, "Como reservar: olho"],
    ["comoReservarTitulo", "Como reservar", 120, "Como reservar: título da seção"],
    ["catalogoTitulo", "Nossas casas", 120, "Nossas casas (a página com todas as casas): título"],
    ["catalogoTexto", "Escolha um apartamento para ver o que ele oferece e consultar as datas.", 240, "Nossas casas: frase abaixo do título"],
    ["planejarOlho", "Planeje sua estadia", 60, "Página de cada casa, cartão da consulta ao lado da descrição: olho"],
    ["planejarTitulo", "Consultar disponibilidade", 120, "Página de cada casa, cartão da consulta: título"],
    ["planejarTexto", "", 240, "Página de cada casa, cartão da consulta: frase abaixo do título"],
    ["resumoOlho", "Sua estadia, sem surpresas", 60, "Página de consulta, quadro Resumo da viagem: olho"],
    ["resumoTitulo", "Resumo da viagem", 120, "Página de consulta, quadro Resumo da viagem: título"],
    ["resumoTexto", "Escolha o apartamento, as datas e quantas pessoas.", 240, "Página de consulta, quadro Resumo da viagem: frase antes da consulta"],
    ["contatoOlho", "Fale com a gente", 60, "Contato: olho"],
    ["contatoTitulo", "Contato", 120, "Contato: título da seção"],
  ] as const;
  for (const [nome, valor, limite, comeco] of esperado) {
    const c = campo(raiz, nome);
    expect(c, nome).toBeTruthy();
    expect(c.value, nome).toBe(valor);
    expect(c.maxLength, nome).toBe(limite);
    expect(c.required, nome).toBe(false);
    expect(rotulo(raiz, nome).startsWith(comeco), nome).toBe(true);
  }
  // As frases de duas linhas são caixas de texto; olhos e títulos, uma linha.
  expect(campo(raiz, "catalogoTexto").tagName).toBe("TEXTAREA");
  expect(campo(raiz, "planejarTitulo").tagName).toBe("INPUT");
  // O texto de apresentação cita as páginas novas.
  expect(raiz.textContent).toContain("Nossas casas, o cartão da consulta na página de cada casa");
});

it("mostra o que está salvo, inclusive vazio, e não o texto de antes", async () => {
  m.textos.mockResolvedValue({ ...TEXTOS_SITE_INICIAIS, catalogoTitulo: "Encontre sua casa *no Leblon.*", resumoOlho: "", planejarTexto: "Frase fictícia do cartão." });
  const raiz = await tela();
  expect(campo(raiz, "catalogoTitulo").value).toBe("Encontre sua casa *no Leblon.*");
  expect(campo(raiz, "resumoOlho").value).toBe("");
  expect(campo(raiz, "planejarTexto").value).toBe("Frase fictícia do cartão.");
});
