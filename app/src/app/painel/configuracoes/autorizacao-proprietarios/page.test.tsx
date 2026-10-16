import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { DadosEmpresa } from "@/configuracoes/empresa";
import { TEXTOS_ORIGEM_AUTORIZACAO } from "@/proprietarios/autorizacao";
import Page from "./page";

const m = vi.hoisted(() => ({ sessao: vi.fn(), db: vi.fn(), versoes: vi.fn(), envios: vi.fn(), empresa: vi.fn(), redirect: vi.fn(), autores: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: m.db }));
vi.mock("@/configuracoes/acoes", () => ({ publicarAutorizacaoAcao: vi.fn() }));
vi.mock("@/configuracoes/autorizacao-proprietarios", async (orig) => ({
  ...(await orig<typeof import("@/configuracoes/autorizacao-proprietarios")>()),
  lerVersoesAutorizacao: m.versoes,
  enviosPorVersao: m.envios,
}));
vi.mock("@/configuracoes/empresa", async (orig) => ({ ...(await orig<typeof import("@/configuracoes/empresa")>()), lerEmpresa: m.empresa }));

const EMPRESA = { nome: "Casa Exemplo" } as DadosEmpresa;
const U1 = "11111111-1111-4111-8111-111111111111";
const V2 = "Autorizo a {empresa} a usar estes dados só para me responder (texto fictício da versão 2).";

beforeEach(() => {
  vi.clearAllMocks();
  m.redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
  m.sessao.mockResolvedValue({ papel: "admin", usuarioId: U1, organizacaoId: "org" });
  m.autores.mockResolvedValue([{ id: U1, nome: "Diego Exemplo" }]);
  m.db.mockReturnValue({ select: () => ({ from: () => ({ where: m.autores }) }) });
  m.empresa.mockResolvedValue(EMPRESA);
  m.versoes.mockResolvedValue([]);
  m.envios.mockResolvedValue(new Map());
});
const html = async () => renderToStaticMarkup(await Page());

it.each(["operacao", "proprietario", "limpeza"])("%s não abre a aba (deny-by-default no servidor)", async (papel) => {
  m.sessao.mockResolvedValue({ papel, usuarioId: U1, organizacaoId: "org" });
  await expect(html()).rejects.toThrow("NEXT_REDIRECT");
  expect(m.redirect).toHaveBeenCalledWith("/painel/configuracoes");
  expect(m.versoes).not.toHaveBeenCalled();
  expect(m.empresa).not.toHaveBeenCalled();
});

it("nada publicado: as duas caixas na versão 1, o texto que veio com o sistema, com o que aparece no site agora e os envios de cada versão", async () => {
  m.envios.mockImplementation(async (_db: unknown, _org: string, f: string) => (f === "contato" ? new Map([[1, { envios: 3, primeiro: new Date("2026-10-15T13:20:00Z") }]]) : new Map()));
  const h = await html();
  expect(m.versoes).toHaveBeenCalledWith(expect.anything(), "org", "contato");
  expect(m.versoes).toHaveBeenCalledWith(expect.anything(), "org", "cadastro");
  expect(h).toContain("Pedido de contato para a gestão completa");
  expect(h).toContain("Cadastro do marketplace");
  // O que aparece no site agora: a versão 1 com o nome da empresa.
  expect(h).toContain("No site agora (versão 1): “Autorizo o uso destes dados só para a Casa Exemplo me responder sobre a gestão do imóvel.”");
  // O formulário traz o texto da versão 1, com o marcador, e oferece a versão 2.
  expect(h).toContain(`>${TEXTOS_ORIGEM_AUTORIZACAO.contato}</textarea>`);
  expect(h).toContain(`>${TEXTOS_ORIGEM_AUTORIZACAO.cadastro}</textarea>`);
  expect(h.match(/Publicar a versão 2/g)).toHaveLength(2);
  expect(h).toContain("o texto que veio com o sistema");
  // Histórico: a versão 1 sem data inventada, com os envios registrados.
  expect(h).toContain("<td>1 (em vigor)</td><td>veio com o sistema</td><td>—</td><td>3 (o primeiro em 15/10/2026)</td>");
  expect(h).toContain("<td>veio com o sistema</td><td>—</td><td>nenhum</td>");
});

it("com a versão 2 publicada numa caixa: ela fica em vigor, com data e autor, e a versão 1 continua no histórico; a outra caixa não muda", async () => {
  m.versoes.mockImplementation(async (_db: unknown, _org: string, f: string) => (f === "contato" ? [{ numero: 2, data: "2026-10-15", autorId: U1, secoes: { texto: V2 } }] : []));
  const h = await html();
  expect(h).toContain("No site agora (versão 2): “Autorizo a Casa Exemplo a usar estes dados só para me responder (texto fictício da versão 2).”");
  expect(h).toContain(`>${V2}</textarea>`);
  expect(h).toContain("Versão 2, publicada em 15/10/2026.");
  expect(h).toContain("Publicar a versão 3");
  expect(h).toContain("<td>2 (em vigor)</td><td>15/10/2026</td><td>Diego Exemplo</td>");
  expect(h).toContain(`<td>1</td><td>veio com o sistema</td><td>—</td><td>nenhum</td><td style="white-space:normal;min-width:280px">“${TEXTOS_ORIGEM_AUTORIZACAO.contato}”</td>`);
  // O cadastro continua na versão 1.
  expect(h).toContain(`>${TEXTOS_ORIGEM_AUTORIZACAO.cadastro}</textarea>`);
  expect(h).toContain("Publicar a versão 2");
});
