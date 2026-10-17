/**
 * Layout do painel (M10.1a): o item "Mensagens" do menu só para quem vê as conversas do WhatsApp. Quem decide é
 * `whatsapp/acesso.ts` (de verdade aqui), com a configuração "Quem vê as conversas" simulada; o banco é um objeto vazio
 * (qualquer consulta lançaria). O menu é simulado para anotar o que recebe.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ sessao: vi.fn(), config: vi.fn(), menu: vi.fn() }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/acesso/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/configuracoes/empresa", () => ({ nomeDaEmpresa: async () => "Sua Casa Exemplo" }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/components/painel/Menu", () => ({ Menu: (p: { papel: string; ocultar?: readonly string[] }) => (m.menu(p), <nav>menu</nav>) }));
vi.mock("@/whatsapp/configuracao", async (original) => ({ ...(await original<typeof import("@/whatsapp/configuracao")>()), lerConfigWhatsapp: m.config }));
import PainelLayout from "./layout";

const render = async () => renderToStaticMarkup(await PainelLayout({ children: <p>conteúdo</p> } as LayoutProps<"/painel">));
const sessao = (papel: string) => m.sessao.mockResolvedValue({ papel, organizacaoId: "org", usuarioId: "u", imovelIds: [] });
const configuracao = (quemVeConversas: string) => m.config.mockResolvedValue({ wabaId: null, numeroId: null, quemVeConversas });

beforeEach(() => {
  vi.clearAllMocks();
  configuracao("so_admin");
});

describe("menu do painel e as conversas do WhatsApp (M10.1a)", () => {
  it("operação com o padrão só o admin: o menu recebe ocultar=[\"mensagens\"] (a configuração da organização da sessão foi lida)", async () => {
    sessao("operacao");
    expect(await render()).toContain("conteúdo");
    expect(m.config).toHaveBeenCalledWith({}, "org");
    expect(m.menu).toHaveBeenCalledWith({ papel: "operacao", ocultar: ["mensagens"] });
  });

  it("com a configuração liberada (admin e operação), a operação vê \"Mensagens\"", async () => {
    sessao("operacao");
    configuracao("admin_e_operacao");
    await render();
    expect(m.menu).toHaveBeenCalledWith({ papel: "operacao", ocultar: [] });
  });

  it.each(["so_admin", "admin_e_operacao", "valor-torto"])("o admin sempre vê \"Mensagens\", sem ler a configuração (%s)", async (quem) => {
    sessao("admin");
    configuracao(quem);
    await render();
    expect(m.config).not.toHaveBeenCalled();
    expect(m.menu).toHaveBeenCalledWith({ papel: "admin", ocultar: [] });
  });

  it.each(["proprietario", "limpeza"])("%s nunca recebe a seção, com qualquer valor da configuração (que nem é lida)", async (papel) => {
    sessao(papel);
    configuracao("admin_e_operacao");
    await render();
    expect(m.config).not.toHaveBeenCalled();
    expect(m.menu).toHaveBeenCalledWith({ papel, ocultar: ["mensagens"] });
  });
});
