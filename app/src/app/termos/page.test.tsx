import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { publicarPaginasLegaisDeTeste } from "@/configuracoes/paginas-legais-testes";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import { organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { PaginaLegal } from "@/components/site/PaginaLegal";
import Cancelamento, { generateMetadata as metadadosCancelamento } from "../cancelamento/page";
import Privacidade from "../privacidade/page";
import Termos, { generateMetadata } from "./page";

const m = vi.hoisted(() => ({ site: vi.fn(), metadados: vi.fn() }));
vi.mock("@/site/pagina", () => ({ carregarSite: m.site, metadadosDoSite: m.metadados }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NAO_ENCONTRADA");
  },
}));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

let db: Db, close: () => Promise<void>, org: string;
beforeEach(async () => {
  vi.clearAllMocks();
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Casa Exemplo" }).returning();
  m.site.mockResolvedValue({ db, conteudo: { organizacaoId: org, nomeEmpresa: "Casa Exemplo", textos: TEXTOS_SITE_INICIAIS, whatsapp: null, email: "", imagens: { capa: null, marca: "/marca.png" } } });
  m.metadados.mockImplementation(async (pagina?: string) => ({ title: `${pagina} | Casa Exemplo`, description: "Descrição" }));
});
afterEach(() => close());

const props = (sp: Record<string, string> = {}) => ({ params: Promise.resolve({}), searchParams: Promise.resolve(sp) });

// A rota só repassa o documento e o ?versao= ao componente (assíncrono, do servidor), que é renderizado aqui.
const renderizar = async (pagina: Promise<React.ReactElement>) => {
  const el = (await pagina) as React.ReactElement<Parameters<typeof PaginaLegal>[0]>;
  expect(el.type).toBe(PaginaLegal);
  return { props: el.props, html: renderToStaticMarkup(await PaginaLegal(el.props)) };
};

it("as três rotas mostram o documento certo e passam o ?versao= adiante", async () => {
  await publicarPaginasLegaisDeTeste(db, org);
  const t = await renderizar(Termos(props()));
  expect(t.props).toEqual({ documento: "termos", versao: undefined });
  expect(t.html).toContain("<h1>Termos de uso</h1>");
  expect((await renderizar(Privacidade(props()))).html).toContain("<h1>Política de privacidade</h1>");
  const c = await renderizar(Cancelamento(props({ versao: "1" })));
  expect(c.props).toEqual({ documento: "cancelamento", versao: "1" });
  expect(c.html).toContain("<h1>Política de cancelamento</h1>");
  expect(c.html).toContain("Versão 1, em vigor desde 01/10/2026.");
  await expect(renderizar(Termos(props({ versao: "2" })))).rejects.toThrow("NAO_ENCONTRADA");
});

it("metadados: o título do documento; fora dos buscadores em preparação e em ?versao=, indexada só a versão em vigor sem parâmetro", async () => {
  expect(await generateMetadata(props())).toEqual({ title: "Termos de uso | Casa Exemplo", description: "Descrição", robots: { index: false, follow: true } });
  expect(m.metadados).toHaveBeenCalledWith("Termos de uso");
  await publicarPaginasLegaisDeTeste(db, org);
  expect(await generateMetadata(props())).toEqual({ title: "Termos de uso | Casa Exemplo", description: "Descrição" });
  expect(await generateMetadata(props({ versao: "1" }))).toMatchObject({ robots: { index: false, follow: true } });
  expect(await metadadosCancelamento(props())).toEqual({ title: "Política de cancelamento | Casa Exemplo", description: "Descrição" });
  m.site.mockResolvedValue({ db, conteudo: null });
  expect(await generateMetadata(props())).toMatchObject({ robots: { index: false, follow: true } });
});
