import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DadosEmpresa, salvarEmpresa } from "@/configuracoes/empresa";
import { publicarPaginaLegal } from "@/configuracoes/paginas-legais";
import { RASCUNHO_PAGINAS_LEGAIS } from "@/configuracoes/paginas-legais-rascunho";
import type { DocumentoLegal as Documento } from "@/configuracoes/paginas-legais-texto";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import { organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { PaginaLegal } from "./PaginaLegal";

const m = vi.hoisted(() => ({ site: vi.fn() }));
vi.mock("@/site/pagina", () => ({ carregarSite: m.site, metadadosDoSite: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NAO_ENCONTRADA");
  },
}));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

// Dados fictícios da empresa, com todos os campos que os textos-base usam.
const EMPRESA: DadosEmpresa = {
  nome: "Casa Exemplo",
  razaoSocial: "Casa Exemplo Temporada Ltda.",
  cnpj: "00.000.000/0001-00",
  email: "contato@example.com",
  telefone: "(21) 90000-0000",
  endereco: "Rua Fictícia, 100, Rio de Janeiro, RJ",
  encarregado: "Pessoa Exemplo",
  site: "",
  chavePix: "",
};

let db: Db, close: () => Promise<void>, org: string;
beforeEach(async () => {
  vi.clearAllMocks();
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Casa Exemplo" }).returning();
  await salvarEmpresa(db, org, EMPRESA, null);
  m.site.mockResolvedValue({ db, conteudo: { organizacaoId: org, nomeEmpresa: "Casa Exemplo", textos: TEXTOS_SITE_INICIAIS, whatsapp: null, email: "", imagens: { capa: null, marca: "/marca.png" } } });
});
afterEach(() => close());

const publicar = async (doc: Documento, hoje: string, texto?: string) => {
  const base = RASCUNHO_PAGINAS_LEGAIS[doc];
  const r = await publicarPaginaLegal(db, org, doc, { secoes: { ...base.secoes, ...(texto ? { texto } : {}) }, diasReembolsoIntegral: base.diasReembolsoIntegral }, null, hoje);
  expect(r.ok).toBe(true);
};
const html = async (documento: Documento, versao?: string | string[]) => renderToStaticMarkup(await PaginaLegal({ documento, versao }));

describe("páginas legais no site (M7.4)", () => {
  it("sem versão publicada: só o aviso de que a página está em preparação, nunca o texto-base", async () => {
    const h = await html("termos");
    expect(h).toContain("<h1>Termos de uso</h1>");
    expect(h).toContain("Esta página está em preparação. Enquanto isso, as reservas seguem pela conversa com a nossa equipe.");
    expect(h).not.toContain("Quem somos");
    expect(h).not.toContain("{{");
    expect(h).not.toContain("Versão");
    // Pedir uma versão que não existe: não encontrada.
    await expect(html("termos", "1")).rejects.toThrow("NAO_ENCONTRADA");
  });

  it("versão 1: data em vigor, dados da empresa congelados na versão (o cadastro mudar depois não muda a página), títulos e listas", async () => {
    await publicar("termos", "2026-10-01");
    await publicar("privacidade", "2026-10-01");
    await salvarEmpresa(db, org, { ...EMPRESA, cnpj: "11.111.111/0001-11" }, null);
    const h = await html("termos");
    expect(h).toContain("Versão 1, em vigor desde 01/10/2026.");
    expect(h).toContain("Casa Exemplo é a marca de Casa Exemplo Temporada Ltda., CNPJ 00.000.000/0001-00");
    expect(h).not.toContain("11.111.111/0001-11");
    expect(h).toContain("<h2>Quem somos</h2>");
    expect(h).toMatch(/<ol start="1"><li>Você escolhe o apartamento/);
    expect(h).not.toContain("{{");
    expect(h).not.toContain("Outras versões");
    expect(h).not.toContain("Resumo");
    const p = await html("privacidade");
    expect(p).toMatch(/<ul><li>Consulta de datas:/);
    expect(p).toContain("Pessoa Exemplo");
    expect(p).not.toContain("Beds24");
  });

  it("versão anterior (?versao=1): aviso de que foi substituída, link para a atual e as outras versões; a atual mostra a lista também", async () => {
    await publicar("termos", "2026-10-01");
    await publicar("termos", "2026-10-10", `${RASCUNHO_PAGINAS_LEGAIS.termos.secoes.texto}\n\nParágrafo novo da versão 2.`);
    const antiga = await html("termos", "1");
    expect(antiga).toContain("Versão 1, de 01/10/2026.");
    expect(antiga).toContain('Você está vendo a versão 1, de 01/10/2026, substituída em 10/10/2026. <a href="/termos">Ver a versão atual</a>');
    expect(antiga).not.toContain("Parágrafo novo da versão 2.");
    expect(antiga).toContain('<a href="/termos?versao=2">Versão 2, de 10/10/2026 (em vigor)</a>');
    expect(antiga).not.toContain('href="/termos?versao=1"');
    const atual = await html("termos");
    expect(atual).toContain("Versão 2, em vigor desde 10/10/2026.");
    expect(atual).toContain("Parágrafo novo da versão 2.");
    expect(atual).not.toContain("substituída");
    expect(atual).toContain('<a href="/termos?versao=1">Versão 1, de 01/10/2026</a>');
    expect(await html("termos", "2")).toContain("Versão 2, em vigor desde 10/10/2026.");
  });

  it.each([["9"], ["abc"], [""], ["0"], ["1234567"], [["1", "2"]]])("versão %j: não encontrada", async (versao) => {
    await publicar("termos", "2026-10-01");
    await expect(html("termos", versao)).rejects.toThrow("NAO_ENCONTRADA");
  });

  it("Política de cancelamento: o resumo em destaque antes do texto, com o prazo da versão", async () => {
    await publicar("cancelamento", "2026-10-01");
    const h = await html("cancelamento");
    expect(h).toMatch(/<section class="[^"]*" aria-labelledby="titulo-resumo-legal"><h2 id="titulo-resumo-legal">Resumo<\/h2>/);
    expect(h).toContain("Cancelamento até 14 dias antes da data de entrada: devolvemos o valor integral.");
    expect(h.indexOf("Resumo")).toBeLessThan(h.indexOf("A quem vale esta política"));
  });

  it("sem organização do site: o aviso de site em configuração", async () => {
    m.site.mockResolvedValue({ db, conteudo: null });
    expect(await html("privacidade")).toContain("Site em configuração");
  });
});
