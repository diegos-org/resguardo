/**
 * A ficha do imóvel com o banco de teste (M3.11a, desenho 3.4; teste 10 da seção 5): com preços importados do Beds24 de
 * hoje em diante, Preço e taxas mostra uma linha com as noites, até quando, e o link para a revisão; sem eles, nada.
 * PGlite, sem rede; sessão falsa e dados fictícios. A hora é a de verdade (a ficha usa o dia de hoje).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { Sessao } from "@/acesso/politica";
import { aprovarImportacao } from "@/calendario/aprovacao";
import { montarRevisao } from "@/calendario/importacao";
import { beds24Calendario, idsExternos, organizacoes, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { criarImovel } from "@/imoveis/repositorio";
import { somarDias } from "@/imoveis/regras-venda";
import { hojeISO } from "@/lib/datas";

const m = vi.hoisted(() => ({ sessao: vi.fn(), db: null as unknown }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => m.db }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("NEXT_REDIRECT"); }, notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, usePathname: () => "/painel/imoveis", useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
import Page from "./page";

let db: Db, close: () => Promise<void>, admin: Sessao, comImportados: string, semImportados: string;
const html = async (id: string) => renderToStaticMarkup(await Page({ params: Promise.resolve({ id }) } as PageProps<"/painel/imoveis/[id]">));
const dia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const dados = (codigo: string) => ({ codigo, nome: "Casa Fictícia", publico: false, ativo: true, bairro: "Leblon", cidade: "Rio de Janeiro", endereco: "", fuso: "America/Sao_Paulo", capacidade: 2, quartos: 1, banheiros: 1, descricao: "Descrição fictícia.", frase: "" });

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  m.db = db;
  const [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  const [u] = await db.insert(usuarios).values({ organizacaoId: org, email: "equipe.ficha@example.com", nome: "Equipe Fictícia", papel: "admin" }).returning();
  admin = { usuarioId: u.id, organizacaoId: org, papel: "admin", imovelIds: [] };
  ({ id: comImportados } = await criarImovel(db, org, dados("403"), u.id));
  ({ id: semImportados } = await criarImovel(db, org, dados("102"), u.id));
  await db.insert(idsExternos).values({ organizacaoId: org, imovelId: comImportados, canal: "beds24", idExterno: "10", detalhe: "20" });
  const hoje = hojeISO();
  await db.insert(beds24Calendario).values(Array.from({ length: 4 }, (_, i) => ({ organizacaoId: org, imovelId: comImportados, data: somarDias(hoje, i), roomId: "20", livres: 1, preco: 45000, minimoNoites: 2, maximoNoites: 27, bloqueio: "none", observadoEm: new Date() })));
  const r = (await montarRevisao(db, org, comImportados))!;
  expect((await aprovarImportacao(db, org, comImportados, { assinatura: r.proposta.assinatura, usar: r.usar }, u.id)).ok).toBe(true);
});
afterAll(() => close());
beforeEach(() => m.sessao.mockResolvedValue(admin));

it("a ficha mostra os preços importados em Preço e taxas, com o link para a revisão; a do imóvel sem importados, não", async () => {
  const h = await html(comImportados);
  expect(h).toContain(`Preços importados do Beds24: 4 noites, até ${dia(somarDias(hojeISO(), 3))}. Eventos, feriadões e períodos valem por cima.`);
  expect(h).toContain(`href="/painel/configuracoes/calendario/importar/${comImportados}"`);
  // O histórico do imóvel conta a importação com as noites e o intervalo.
  expect(h).toContain("importou os preços do Beds24");
  expect(h).toContain(`preços importados do Beds24: — → 4 noite(s), de ${dia(hojeISO())} a ${dia(somarDias(hojeISO(), 3))}`);
  expect(await html(semImportados)).not.toContain("Preços importados do Beds24");
});
