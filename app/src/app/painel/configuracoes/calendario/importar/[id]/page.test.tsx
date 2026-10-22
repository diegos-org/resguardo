/**
 * A revisão da importação dos preços do Beds24 (M3.11a, desenho 3.4; testes 9 e 10 da seção 5) com o banco de teste: só
 * quem tem `configuracao:editar` abre; o topo, os avisos de bloqueio, a proposta com as caixas, a conferência pelo motor
 * (igual ao Beds24 numa leitura sem pisos, também depois de aprovar; a diferença por piso com o motivo), o detalhe por mês
 * e as ações. PGlite, sem rede; sessão falsa, ações anotadas e dados fictícios. A hora é a de verdade (a tela usa a atual).
 */
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sessao } from "@/acesso/politica";
import { aprovarImportacao } from "@/calendario/aprovacao";
import { montarRevisao } from "@/calendario/importacao";
import { beds24Calendario, idsExternos, imoveis, imoveisDetalhes, organizacoes, precosImportados, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { somarDias } from "@/imoveis/regras-venda";
import { hojeISO } from "@/lib/datas";

const m = vi.hoisted(() => ({ sessao: vi.fn(), db: null as unknown, redirect: vi.fn() }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => m.db }));
vi.mock("next/navigation", () => ({ redirect: m.redirect, notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/calendario/acoes-importacao", () => ({ aprovarImportacaoAcao: vi.fn(), desfazerImportacaoAcao: vi.fn(), guardarCopiaAcao: vi.fn() }));
import Page from "./page";

let db: Db, close: () => Promise<void>, org: string, im: string, admin: Sessao;
const html = async (id: string, sp: Record<string, string> = {}) =>
  renderToStaticMarkup(await Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve(sp) } as PageProps<"/painel/configuracoes/calendario/importar/[id]">));
const dia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** 30 noites lidas do quarto 20 há uma hora: R$ 450 de domingo a quinta, R$ 520 na sexta e no sábado; mínimo 3; máximo 30. */
const lerBeds24 = async (over: (data: string) => Partial<typeof beds24Calendario.$inferInsert> = () => ({})) => {
  await db.delete(beds24Calendario).where(eq(beds24Calendario.imovelId, im));
  await db.insert(beds24Calendario).values(Array.from({ length: 30 }, (_, i) => somarDias(hojeISO(), i)).map((data) => {
    const d = new Date(`${data}T00:00:00Z`).getUTCDay();
    return { organizacaoId: org, imovelId: im, data, roomId: "20", livres: 1, preco: d === 5 || d === 6 ? 52000 : 45000, minimoNoites: 3, maximoNoites: 30, bloqueio: "none", observadoEm: new Date(Date.now() - 3_600_000 - 60_000), ...over(data) };
  }));
};

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  m.db = db;
});
afterAll(() => close());
beforeEach(async () => {
  vi.clearAllMocks();
  m.redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  const [u] = await db.insert(usuarios).values({ organizacaoId: org, email: `equipe.revisao.${org.slice(0, 8)}@example.com`, nome: "Equipe Fictícia", papel: "admin" }).returning();
  admin = { usuarioId: u.id, organizacaoId: org, papel: "admin", imovelIds: [] };
  m.sessao.mockResolvedValue(admin);
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Studio fictício" }).returning();
  await db.insert(idsExternos).values({ organizacaoId: org, imovelId: im, canal: "beds24", idExterno: "10", detalhe: "20" });
  await lerBeds24();
});

describe("revisão da importação (M3.11a, 3.4)", () => {
  it.each(["operacao", "proprietario", "limpeza"])("%s não abre a revisão", async (papel) => {
    m.sessao.mockResolvedValue({ ...admin, papel });
    await expect(html(im)).rejects.toThrow("NEXT_REDIRECT");
    expect(m.redirect).toHaveBeenCalledWith("/painel/configuracoes");
  });

  it("imóvel de outra organização ou id inválido: não encontrado", async () => {
    const [{ id: outra }] = await db.insert(organizacoes).values({ nome: "Outra organização" }).returning();
    m.sessao.mockResolvedValue({ ...admin, organizacaoId: outra });
    await expect(html(im)).rejects.toThrow("NEXT_NOT_FOUND");
    m.sessao.mockResolvedValue(admin);
    await expect(html("nao-e-um-id")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("admin vê o topo, a proposta com as caixas marcadas, a conferência igual ao Beds24, o detalhe por mês e as ações", async () => {
    const hoje = hojeISO();
    const h = await html(im);
    expect(h).toContain("Importar preços do Beds24 — imóvel 403");
    expect(h).toContain("Fonte de preços: <strong>Preços automáticos do SCL</strong>");
    expect(h).toContain(`há 1 hora`);
    expect(h).toContain(`30 noites, de ${dia(hoje)} a ${dia(somarDias(hoje, 29))}`);
    expect(h).toContain("Quarto do Beds24: 20");
    expect(h).not.toContain('role="alert"');
    // A proposta: R$ 450 (o mais comum entre as noites mais baratas) e 30 noites; sem cadastro, as caixas vêm marcadas.
    expect(h).toContain("<strong>Preço base:</strong> proposto R$ 450,00 · atual sem preço base");
    expect(h).toContain("<strong>Estadia máxima:</strong> proposta 30 noites · atual 27 noites (de Configurações → Calendário e preços)");
    expect(h).toMatch(/name="usarPrecoBase" checked=""/);
    expect(h).toMatch(/name="usarEstadiaMaxima" checked=""/);
    expect(h).toContain("Conferir com estas escolhas");
    expect(h).toContain(`<strong>Noites a importar:</strong> 30, de ${dia(hoje)} a ${dia(somarDias(hoje, 29))}`);
    expect(h).toContain("Depois de aprovar, o SCL calcularia igual ao Beds24 em 30 de 30 noites.");
    expect(h).not.toContain("Noites diferentes e o motivo do SCL");
    expect(h).toContain("<details><summary>");
    expect(h).toContain("Preço no Beds24");
    // As ações: aprovar com a assinatura e as caixas da conferência; nada importado ainda, sem "Desfazer".
    const r = (await montarRevisao(db, org, im))!;
    expect(h).toContain(`name="assinatura" value="${r.proposta.assinatura}"`);
    expect(h).toContain('name="usarEstadiaMaxima" value="sim"/>');
    expect(h).toContain("Aprovar e importar");
    expect(h).toContain("Guardar uma cópia agora");
    expect(h).not.toContain("Desfazer a importação");
  });

  it("as caixas desmarcadas recarregam a conferência: com a máxima de hoje (27), todas as noites diferem do Beds24 (30)", async () => {
    const h = await html(im, { conferir: "1", usarPrecoBase: "sim" });
    expect(h).toMatch(/name="usarPrecoBase" checked=""/);
    expect(h).not.toMatch(/name="usarEstadiaMaxima" checked=""/);
    expect(h).toContain("Depois de aprovar, o SCL calcularia igual ao Beds24 em 0 de 30 noites.");
    expect(h).toContain("Noites diferentes e o motivo do SCL");
    expect(h).toContain("máx. 27");
    expect(h).toContain('name="usarEstadiaMaxima" value="nao"/>');
  });

  it("depois de aprovar, a conferência continua igual ao Beds24 e aparecem os importados e o Desfazer", async () => {
    const r = (await montarRevisao(db, org, im))!;
    expect((await aprovarImportacao(db, org, im, { assinatura: r.proposta.assinatura, usar: r.usar }, admin.usuarioId)).ok).toBe(true);
    const h = await html(im);
    expect(h).toContain(`Importados de hoje em diante: 30 noites, até ${dia(somarDias(hojeISO(), 29))}`);
    // O cadastro agora tem os valores: as caixas vêm desmarcadas, e o SCL já calcula igual.
    expect(h).toContain("atual R$ 450,00");
    expect(h).not.toMatch(/name="usarPrecoBase" checked=""/);
    expect(h).toContain("Depois de aprovar, o SCL calcularia igual ao Beds24 em 30 de 30 noites.");
    expect(h).toContain("Desfazer a importação");
    expect(await db.select().from(precosImportados).where(eq(precosImportados.imovelId, im))).toHaveLength(30);
  });

  it("a diferença por piso de última hora aparece com o motivo do plano", async () => {
    // D+3 está na 1ª faixa (15%, piso R$ 350): R$ 393 no Beds24 → a referência do SCL sobe para R$ 411,77.
    const d3 = somarDias(hojeISO(), 3);
    await lerBeds24((data) => (data === d3 ? { preco: 39300 } : {}));
    await db.insert(imoveisDetalhes).values({ imovelId: im, organizacaoId: org, pisoUltimaHora1: 35000, pisoUltimaHora2: 30000 });
    const h = await html(im);
    expect(h).toContain("Depois de aprovar, o SCL calcularia igual ao Beds24 em 29 de 30 noites.");
    expect(h).toContain(`<th scope="row">${dia(d3)}</th><td>R$ 393,00 · mín. 3 · máx. 30</td><td>R$ 411,77 · mín. 3 · máx. 30</td><td>preço (+R$ 18,77)</td>`);
    expect(h).toContain("Beds24 aplica 15%; referência elevada para proteger o piso de R$ 350,00");
    expect(h).toContain(`Preço importado do Beds24 em ${dia(hojeISO())}`);
  });

  it("bloqueios: fonte diferente de SCL e leitura vencida viram avisos, e o Aprovar some", async () => {
    await db.insert(imoveisDetalhes).values({ imovelId: im, organizacaoId: org, fontePrecos: "beds24" });
    const fonte = await html(im);
    expect(fonte).toContain('role="alert" class="');
    expect(fonte).toContain("A importação vale para preços automáticos do SCL. Mude a fonte na ficha do imóvel.");
    expect(fonte).toContain("Sem conferência: a camada importada só vale com preços automáticos do SCL.");
    expect(fonte).toContain("Aprovar fica disponível depois de resolver os avisos do topo.");
    expect(fonte).not.toContain("Aprovar e importar");
    await db.update(imoveisDetalhes).set({ fontePrecos: "scl" }).where(eq(imoveisDetalhes.imovelId, im));
    await db.update(beds24Calendario).set({ observadoEm: new Date(Date.now() - 40 * 3_600_000) }).where(eq(beds24Calendario.imovelId, im));
    const vencida = await html(im);
    expect(vencida).toContain("A leitura do Beds24 tem mais de 36 horas. Leia de novo em Configurações → Integrações → Importar agora, e volte aqui.");
    expect(vencida).not.toContain("Aprovar e importar");
    await db.delete(idsExternos).where(eq(idsExternos.imovelId, im));
    const semVinculo = await html(im);
    expect(semVinculo).toContain("Quarto do Beds24: sem vínculo");
    expect(semVinculo).toContain("não tem um vínculo ativo e único");
  });
});
