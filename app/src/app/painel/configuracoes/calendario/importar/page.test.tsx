/**
 * A lista da importação dos preços do Beds24 (M3.11a, desenho 3.4; teste 10 da seção 5) com o banco de teste: só quem tem
 * `configuracao:editar` abre; por imóvel, a fonte, a última leitura, o que já foi importado (com quem) e a última cópia.
 * PGlite, sem rede; sessão falsa e dados fictícios. A hora é a de verdade (a tela usa a hora atual).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { Sessao } from "@/acesso/politica";
import { aprovarImportacao } from "@/calendario/aprovacao";
import { montarRevisao } from "@/calendario/importacao";
import { beds24Calendario, idsExternos, imoveis, imoveisDetalhes, organizacoes, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { somarDias } from "@/imoveis/regras-venda";
import { hojeISO } from "@/lib/datas";

const m = vi.hoisted(() => ({ sessao: vi.fn(), db: null as unknown, redirect: vi.fn() }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => m.db }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
import Page from "./page";

let db: Db, close: () => Promise<void>, org: string, admin: Sessao, i403: string;
const html = async () => renderToStaticMarkup(await Page());

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  m.db = db;
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  const [u] = await db.insert(usuarios).values({ organizacaoId: org, email: "equipe.lista@example.com", nome: "Equipe Fictícia", papel: "admin" }).returning();
  admin = { usuarioId: u.id, organizacaoId: org, papel: "admin", imovelIds: [] };
  [{ id: i403 }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Studio fictício" }).returning();
  const [i102] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "102", nome: "Casa fictícia" }).returning();
  await db.insert(imoveis).values({ organizacaoId: org, codigo: "999", nome: "Arquivado fictício", ativo: false });
  await db.insert(imoveisDetalhes).values({ imovelId: i102.id, organizacaoId: org, fontePrecos: "beds24" });
  await db.insert(idsExternos).values({ organizacaoId: org, imovelId: i403, canal: "beds24", idExterno: "10", detalhe: "20" });
  // A leitura de 3 horas atrás, de 5 noites, aprovada pela equipe.
  const hoje = hojeISO();
  await db.insert(beds24Calendario).values(Array.from({ length: 5 }, (_, i) => ({ organizacaoId: org, imovelId: i403, data: somarDias(hoje, i), roomId: "20", livres: 1, preco: 45000, minimoNoites: 2, maximoNoites: 27, bloqueio: "none", observadoEm: new Date(Date.now() - 3 * 3_600_000 - 60_000) })));
  const r = (await montarRevisao(db, org, i403))!;
  expect((await aprovarImportacao(db, org, i403, { assinatura: r.proposta.assinatura, usar: r.usar }, u.id)).ok).toBe(true);
});
afterAll(() => close());
beforeEach(() => {
  vi.clearAllMocks();
  m.redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
  m.sessao.mockResolvedValue(admin);
});

it.each(["operacao", "proprietario", "limpeza"])("%s não abre a lista", async (papel) => {
  m.sessao.mockResolvedValue({ ...admin, papel });
  await expect(html()).rejects.toThrow("NEXT_REDIRECT");
  expect(m.redirect).toHaveBeenCalledWith("/painel/configuracoes");
});

it("admin vê, por imóvel ativo, a fonte, a última leitura, o que foi importado, a última cópia e o link para revisar", async () => {
  const h = await html();
  const hoje = hojeISO();
  const dia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  expect(h).toContain("Importar preços do Beds24");
  expect(h).toContain("Preços automáticos do SCL");
  expect(h).toContain("Preços definidos no Beds24 (pelo proprietário ou pela ferramenta dele)");
  expect(h).toContain("há 3 horas");
  expect(h).toContain(`5 noites, de ${dia(hoje)} a ${dia(somarDias(hoje, 4))}, em ${dia(hoje)} por Equipe Fictícia`);
  expect(h).toContain("ao aprovar uma importação");
  expect(h).toContain(`href="/painel/configuracoes/calendario/importar/${i403}"`);
  // O 102: sem leitura, nada importado, nenhuma cópia. O arquivado não aparece.
  expect(h).toContain("Sem leitura");
  expect(h).toContain("Nada importado");
  expect(h).toContain("Nenhuma");
  expect(h).not.toContain("999");
});
