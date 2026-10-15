import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import { autorizacaoDeOrigem } from "@/proprietarios/autorizacao";
import Page from "./page";

/**
 * Passo 2 do cadastro do marketplace: o formulário recebe o texto da caixa de autorização em vigor (M7.15), com o nome
 * da empresa de Configurações → Empresa — o mesmo que o servidor lê no envio para conferir a marca (M7.14). Outro texto
 * aqui faria todo envio voltar com "o texto mudou".
 */
const m = vi.hoisted(() => ({ email: vi.fn(), site: vi.fn(), autorizacao: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("@/marketplace/sessao", () => ({ emailDoCadastro: m.email }));
vi.mock("@/site/pagina", () => ({ carregarSite: m.site, metadadosDoSite: vi.fn() }));
vi.mock("@/marketplace/acoes", () => ({ enviarCadastroAcao: vi.fn() }));
vi.mock("@/configuracoes/autorizacao-proprietarios", () => ({ autorizacaoEmVigor: m.autorizacao }));
vi.mock("@/components/site/FormCadastro", () => ({
  FormCadastro: ({ autorizacao }: { autorizacao: { versao: number; texto: string; marca: string } }) => <form aria-label="Cadastro do imóvel">{`[${autorizacao.texto}|${autorizacao.marca}]`}</form>,
}));

const conteudo = { organizacaoId: "org", nomeEmpresa: "Casa Exemplo", textos: TEXTOS_SITE_INICIAIS, whatsapp: null, email: "", imagens: { capa: null, marca: "/marca.png" } };

beforeEach(() => {
  vi.clearAllMocks();
  m.email.mockResolvedValue("dona@example.com");
  m.site.mockResolvedValue({ db: {}, conteudo });
  m.autorizacao.mockResolvedValue({ versao: 2, texto: "Texto fictício da versão 2.", marca: "v2.fict" });
});

it("com o e-mail confirmado, o formulário recebe o texto da caixa em vigor da organização do site", async () => {
  const h = renderToStaticMarkup(await Page());
  expect(h).toContain("E-mail confirmado: dona@example.com.");
  expect(m.autorizacao).toHaveBeenCalledWith({}, "org", "cadastro");
  expect(h).toContain('<form aria-label="Cadastro do imóvel">[Texto fictício da versão 2.|v2.fict]</form>');
});

it("sem o conteúdo do site (nenhuma organização), a página abre e a caixa mostra a versão 1, sem ler o banco", async () => {
  m.site.mockResolvedValue({ db: {}, conteudo: null });
  const h = renderToStaticMarkup(await Page());
  expect(m.autorizacao).not.toHaveBeenCalled();
  expect(h).toContain(`[${autorizacaoDeOrigem("cadastro", "").texto}|${autorizacaoDeOrigem("cadastro", "").marca}]</form>`);
});

it("sem o e-mail confirmado, volta para o início do cadastro", async () => {
  m.email.mockResolvedValue(null);
  await expect(Page()).rejects.toThrow("REDIRECT /anunciar");
  expect(m.site).not.toHaveBeenCalled();
});
