import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import Page from "./page";

/**
 * Passo 2 do cadastro do marketplace: o formulário recebe o nome da empresa de Configurações → Empresa, o mesmo que o
 * servidor lê no envio para conferir o texto da autorização (M7.14). Outro nome aqui faria todo envio voltar com "o
 * texto mudou".
 */
const m = vi.hoisted(() => ({ email: vi.fn(), site: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("@/marketplace/sessao", () => ({ emailDoCadastro: m.email }));
vi.mock("@/site/pagina", () => ({ carregarSite: m.site, metadadosDoSite: vi.fn() }));
vi.mock("@/marketplace/acoes", () => ({ enviarCadastroAcao: vi.fn() }));
vi.mock("@/components/site/FormCadastro", () => ({ FormCadastro: ({ empresa }: { empresa: string }) => <form aria-label="Cadastro do imóvel">{`[${empresa}]`}</form> }));

const conteudo = { organizacaoId: "org", nomeEmpresa: "Casa Exemplo", textos: TEXTOS_SITE_INICIAIS, whatsapp: null, email: "", imagens: { capa: null, marca: "/marca.png" } };

beforeEach(() => {
  vi.clearAllMocks();
  m.email.mockResolvedValue("dona@example.com");
  m.site.mockResolvedValue({ db: {}, conteudo });
});

it("com o e-mail confirmado, o formulário recebe o nome da empresa do site", async () => {
  const h = renderToStaticMarkup(await Page());
  expect(h).toContain("E-mail confirmado: dona@example.com.");
  expect(h).toContain('<form aria-label="Cadastro do imóvel">[Casa Exemplo]</form>');
});

it("sem o conteúdo do site (nenhuma organização), a página abre e o formulário recebe o nome vazio", async () => {
  m.site.mockResolvedValue({ db: {}, conteudo: null });
  const h = renderToStaticMarkup(await Page());
  expect(h).toContain("[]</form>");
});

it("sem o e-mail confirmado, volta para o início do cadastro", async () => {
  m.email.mockResolvedValue(null);
  await expect(Page()).rejects.toThrow("REDIRECT /anunciar");
  expect(m.site).not.toHaveBeenCalled();
});
