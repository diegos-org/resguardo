import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { count, eq } from "drizzle-orm";
import { beds24Calendario, cotacoes, idsExternos, imoveis, imoveisDetalhes, organizacoes, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { PESOS_PADRAO_ANTIGO, PRECOS_MARKETPLACE_PADRAO } from "@/marketplace/precos";
import { salvarPrecosMarketplace } from "@/marketplace/precos-config";
import { buscarEmTodasAsCasas, casasParaOGrupo, MAXIMO_CASAS_NA_BUSCA } from "./busca";
import * as disponibilidade from "./disponibilidade";
import { imoveisDoSite } from "./site";

// A consulta e a leitura das configurações são as reais, observadas para contar quantas vezes cada uma roda.
vi.mock("./disponibilidade", async (orig) => {
  const real = await orig<typeof import("./disponibilidade")>();
  return { ...real, consultarDisponibilidade: vi.fn(real.consultarDisponibilidade), lerConfigDaConsulta: vi.fn(real.lerConfigDaConsulta) };
});

let db: Db, close: () => Promise<void>, org: string;
// 1/10/2026 (quinta), 12:00 em São Paulo.
const agora = new Date("2026-10-01T15:00:00Z");
const pedido = (over: Partial<{ entrada: string; saida: string; hospedes: string }> = {}) => ({ entrada: "2026-10-12", saida: "2026-10-15", hospedes: "3", ...over });
const dias = (de: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${de}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
const ids: Record<string, string> = {};

/** Casa pública fictícia com preço e limpeza; `quarto` liga ao Beds24 e grava a leitura das noites de 12 a 15/10. */
async function casa(codigo: string, capacidade: number | null, quarto?: string, o: Partial<typeof imoveis.$inferInsert> = {}) {
  const [{ id }] = await db.insert(imoveis).values({ organizacaoId: org, codigo, nome: `Casa ${codigo}`, publico: true, capacidade, ...o }).returning();
  ids[codigo] = id;
  await db.insert(imoveisDetalhes).values({ imovelId: id, organizacaoId: org, precoBase: 45000, taxaLimpeza: 25000 });
  if (quarto) {
    await db.insert(idsExternos).values({ organizacaoId: org, imovelId: id, canal: "beds24", idExterno: `1${quarto}`, detalhe: quarto });
    await db.insert(beds24Calendario).values(dias("2026-10-12", 4).map((data) => ({ organizacaoId: org, imovelId: id, data, roomId: quarto, livres: 1, preco: 45000, minimoNoites: 1, maximoNoites: 27, bloqueio: "none", observadoEm: new Date("2026-10-01T09:15:00Z") })));
  }
}

const buscar = async (over = {}) => buscarEmTodasAsCasas(db, org, pedido(over), await imoveisDoSite(db, org), agora);

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
  vi.mocked(disponibilidade.consultarDisponibilidade).mockClear();
  vi.mocked(disponibilidade.lerConfigDaConsulta).mockClear();
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  await salvarPrecosMarketplace(db, org, { ...PRECOS_MARKETPLACE_PADRAO, pesos: { ...PESOS_PADRAO_ANTIGO } }, null);
  await casa("102", 2, "21"); // recebe menos que o grupo
  await casa("205", null, "22"); // capacidade não cadastrada
  await casa("403", 4, "20"); // com leitura recente: pode ser "disponível"
  await casa("501", 6); // sem ligação com o Beds24: nunca "disponível"
  await casa("buzios", 8, undefined, { publico: false }); // fora do site
  await casa("303", 8, undefined, { ativo: false }); // inativa
});

describe("busca em todas as casas (M7.9)", () => {
  it("casas para o grupo: as que recebem o grupo e as sem capacidade (nunca supostas como cabe); as menores ficam de fora", () => {
    const lista = [{ capacidade: 2 }, { capacidade: null }, { capacidade: 4 }, { capacidade: 0 }];
    expect(casasParaOGrupo(lista, 3)).toEqual({ cabem: [{ capacidade: null }, { capacidade: 4 }, { capacidade: 0 }], foraDoGrupo: 1 });
    expect(casasParaOGrupo(lista, 2)).toEqual({ cabem: lista, foraDoGrupo: 0 });
    expect(casasParaOGrupo([{ capacidade: 2 }], 5)).toEqual({ cabem: [], foraDoGrupo: 1 });
  });

  it("situação real de cada casa do site que recebe o grupo, as livres primeiro; sem leitura ou sem capacidade, nunca \"disponível\"", async () => {
    const r = await buscar();
    if (!r.ok) throw new Error("busca recusada");
    expect(r.hospedes).toBe(3);
    expect(r.foraDoGrupo).toBe(1);
    // Só as casas do site (públicas e ativas) que recebem 3 pessoas ou sem capacidade cadastrada.
    expect(r.casas.map((c) => [c.imovel.codigo, c.disponibilidade?.situacao])).toEqual([
      ["403", "disponivel"],
      ["205", "a_confirmar"],
      ["501", "a_confirmar"],
    ]);
    const [livre, semCapacidade, semLeitura] = r.casas;
    // Valor cheio, desconto do site e total (M12.1), o mesmo que a página da casa mostra.
    expect(livre.disponibilidade?.cotacao).toMatchObject({ valorCheio: 160000, desconto: 6400, total: 153600 });
    expect(livre.disponibilidade).toEqual(await disponibilidade.consultarDisponibilidade(db, org, { imovel: "403", ...pedido() }, agora));
    expect(semCapacidade.disponibilidade?.motivos).toContain("A capacidade deste apartamento ainda não foi cadastrada: confirmamos na conversa se o número de pessoas cabe.");
    expect(semLeitura.disponibilidade?.motivos).toContain("Ainda não conferimos a agenda mais recente para essas datas: confirmamos na conversa.");
  });

  it("casa com reserva nas datas fica na lista como indisponível, depois das que estão livres ou a confirmar", async () => {
    await db.insert(reservas).values({ organizacaoId: org, imovelId: ids["403"], codigo: "SCL-BUSCA1", origem: "airbnb", estado: "confirmada", checkin: "2026-10-13", checkout: "2026-10-14", hospedeNome: "Hóspede Fictício", hospedeEmail: "ficticio@example.invalid", fonte: "manual", idFonte: "" });
    const r = await buscar();
    if (!r.ok) throw new Error("busca recusada");
    expect(r.casas.map((c) => [c.imovel.codigo, c.disponibilidade?.situacao])).toEqual([
      ["205", "a_confirmar"],
      ["501", "a_confirmar"],
      ["403", "indisponivel"],
    ]);
    expect(r.casas[2].disponibilidade).toMatchObject({ motivos: ["Há noites já reservadas nessas datas (13/10/2026)."], cotacao: null });
    expect(JSON.stringify(r)).not.toMatch(/Fictício|ficticio@/);
  });

  it("nenhuma casa recebe o grupo: lista vazia com quantas ficaram de fora, sem nenhuma consulta", async () => {
    await db.update(imoveis).set({ capacidade: 4 }).where(eq(imoveis.id, ids["205"]));
    const r = await buscar({ hospedes: "7" });
    expect(r).toEqual({ ok: true, hospedes: 7, casas: [], foraDoGrupo: 4 });
    expect(disponibilidade.consultarDisponibilidade).not.toHaveBeenCalled();
  });

  it("datas ou pessoas inválidas: os erros da consulta, sem consultar nenhuma casa", async () => {
    expect(await buscar({ entrada: "2026-09-30" })).toEqual({ ok: false, erros: { entrada: "A entrada não pode ser antes de hoje." } });
    expect(await buscar({ saida: "2026-10-12" })).toEqual({ ok: false, erros: { saida: "A saída precisa ser depois da entrada." } });
    expect(await buscar({ entrada: "", saida: "2026-02-30", hospedes: "2e0" })).toEqual({
      ok: false,
      erros: { entrada: "Informe a data de entrada.", saida: "Informe a data de saída.", hospedes: "Informe quantas pessoas." },
    });
    expect(disponibilidade.consultarDisponibilidade).not.toHaveBeenCalled();
  });

  it("custo: as configurações são lidas uma vez e há uma consulta por casa, até o limite; as outras aparecem sem situação", async () => {
    await buscar();
    expect(disponibilidade.lerConfigDaConsulta).toHaveBeenCalledTimes(1);
    expect(disponibilidade.consultarDisponibilidade).toHaveBeenCalledTimes(3);
    for (const [, , , , o] of vi.mocked(disponibilidade.consultarDisponibilidade).mock.calls) expect(o?.config).toBeTruthy();
    vi.mocked(disponibilidade.consultarDisponibilidade).mockClear();
    for (let i = 0; i < MAXIMO_CASAS_NA_BUSCA; i++) await casa(`9${String(i).padStart(2, "0")}`, 4);
    const r = await buscar();
    if (!r.ok) throw new Error("busca recusada");
    expect(r.casas).toHaveLength(MAXIMO_CASAS_NA_BUSCA + 3);
    expect(disponibilidade.consultarDisponibilidade).toHaveBeenCalledTimes(MAXIMO_CASAS_NA_BUSCA);
    // As que passam do limite vêm no fim, sem situação (a página da casa mostra).
    // Pela ordem do site (205, 403, 501, 900…909), as dez primeiras são consultadas; 907 a 909 vêm no fim, sem situação.
    expect(r.casas.slice(-3).map((c) => [c.imovel.codigo, c.disponibilidade])).toEqual([
      ["907", null],
      ["908", null],
      ["909", null],
    ]);
    expect(r.casas[0]).toMatchObject({ imovel: { codigo: "403" }, disponibilidade: { situacao: "disponivel" } });
  });

  it("nada é gravado: nenhuma cotação nem reserva sai da busca", async () => {
    await buscar();
    expect((await db.select({ n: count() }).from(cotacoes).where(eq(cotacoes.organizacaoId, org)))[0].n).toBe(0);
    expect((await db.select({ n: count() }).from(reservas).where(eq(reservas.organizacaoId, org)))[0].n).toBe(0);
  });
});
