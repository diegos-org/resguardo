import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { TEXTOS_PROPRIETARIOS_INICIAIS } from "@/configuracoes/pagina-proprietarios";
import Page from "./page";
const m = vi.hoisted(() => ({ sessao: vi.fn(), db: vi.fn(), textos: vi.fn(), mercado: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: m.db }));
vi.mock("@/configuracoes/acoes", () => ({ salvarTextosProprietariosAcao: vi.fn(), salvarMercadoAcao: vi.fn() }));
vi.mock("@/configuracoes/pagina-proprietarios", async (original) => ({
  ...(await original<typeof import("@/configuracoes/pagina-proprietarios")>()),
  lerTextosProprietarios: m.textos,
  lerMercado: m.mercado,
}));
beforeEach(() => {
  vi.clearAllMocks();
  m.db.mockReturnValue({});
  m.redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
  m.sessao.mockResolvedValue({ papel: "admin", usuarioId: "u", organizacaoId: "org" });
  m.textos.mockResolvedValue(TEXTOS_PROPRIETARIOS_INICIAIS);
  m.mercado.mockResolvedValue({ referencia: "2026-09", fonte: "Reservas dos imóveis que administramos", linhas: [{ tipo: "Studio", diaria: 45000, ocupacao: 7250, liquido: null }] });
});
const html = async () => renderToStaticMarkup(await Page());

it.each(["operacao", "proprietario", "limpeza"])("%s não abre a aba", async (papel) => {
  m.sessao.mockResolvedValue({ papel, usuarioId: "u", organizacaoId: "org" });
  await expect(html()).rejects.toThrow("NEXT_REDIRECT");
  expect(m.redirect).toHaveBeenCalledWith("/painel/configuracoes");
  expect(m.textos).not.toHaveBeenCalled();
});

it("admin vê os textos (com o texto-base) e a faixa de mercado gravada, com seis linhas para preencher", async () => {
  const h = await html();
  expect(m.textos).toHaveBeenCalledWith({}, "org");
  expect(h).toContain('aria-label="Textos da página para proprietários"');
  expect(h).toContain("Seu imóvel bem cuidado, *sem dor de cabeça*.");
  expect(h).toContain('aria-label="Faixa de mercado"');
  expect(h).toContain('value="2026-09"');
  expect(h).toContain('value="Studio"');
  expect(h).toContain('value="72,5"');
  expect(h).toContain('name="tipo_5"');
  expect(h).not.toContain('name="tipo_6"');
});
