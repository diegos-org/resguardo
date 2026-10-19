/**
 * Configurações → Usuários (M10.1a, 6.10): a linha "Ver as conversas do WhatsApp" na tabela de permissões, calculada pela
 * mesma regra das telas (`podeVerConversasCom`) com a configuração "Quem vê as conversas" da organização: ✓ só no admin
 * com o padrão; no admin e na operação com a configuração liberada; nunca no proprietário nem na limpeza.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ sessao: vi.fn(), config: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/configuracoes/usuarios", async (original) => ({ ...(await original<typeof import("@/configuracoes/usuarios")>()), listarUsuarios: async () => [] }));
vi.mock("@/configuracoes/acoes", () => ({ alterarUsuarioAcao: vi.fn(), novoUsuarioAcao: vi.fn() }));
vi.mock("@/components/configuracoes/Usuarios", () => ({ Usuarios: () => null }));
vi.mock("@/whatsapp/configuracao", async (original) => ({ ...(await original<typeof import("@/whatsapp/configuracao")>()), lerConfigWhatsapp: m.config }));
import Page from "./page";

/** As células da linha do WhatsApp, na ordem dos papéis da tabela (admin, operação, proprietário, limpeza). */
const linhaDoWhatsapp = (h: string) => {
  const linha = /<tr><td>Ver as conversas do WhatsApp[\s\S]*?<\/tr>/.exec(h)?.[0] ?? "";
  return [...linha.matchAll(/<td>(✓|—)<\/td>/g)].map((x) => x[1]);
};

beforeEach(() => {
  vi.clearAllMocks();
  m.redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
});

it("com o padrão só o admin: ✓ só no admin, com a nota de onde muda (a configuração da organização da sessão)", async () => {
  m.config.mockResolvedValue({ wabaId: null, numeroId: null, quemVeConversas: "so_admin" });
  const h = renderToStaticMarkup(await Page());
  expect(m.config).toHaveBeenCalledWith({}, "org");
  expect(h).toContain("Ver as conversas do WhatsApp");
  expect(h).toContain("(muda em Configurações → Integrações → WhatsApp)");
  expect(linhaDoWhatsapp(h)).toEqual(["✓", "—", "—", "—"]);
  // Logo abaixo de "Ver mensagens" (que a política dá à operação), para as duas linhas serem lidas juntas.
  const linhas = [...h.matchAll(/<tr><td>([^<]+)/g)].map((x) => x[1].trim());
  expect(linhas[linhas.indexOf("Ver mensagens") + 1]).toBe("Ver as conversas do WhatsApp");
});

it("com a configuração liberada: ✓ no admin e na operação; proprietário e limpeza nunca", async () => {
  m.config.mockResolvedValue({ wabaId: null, numeroId: null, quemVeConversas: "admin_e_operacao" });
  expect(linhaDoWhatsapp(renderToStaticMarkup(await Page()))).toEqual(["✓", "✓", "—", "—"]);
});

it("quem não gere usuários é redirecionado sem ler a configuração", async () => {
  m.sessao.mockResolvedValue({ papel: "operacao", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  await expect(Page()).rejects.toThrow("NEXT_REDIRECT");
  expect(m.config).not.toHaveBeenCalled();
});
