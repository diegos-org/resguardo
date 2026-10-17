/**
 * As duas tabelas do M8.3 (migração 0072, desenho 3.2): os únicos e o índice parcial que o banco garante sozinho, e a
 * varredura `semDadosPessoais`, que passa a cobrir as duas. PGlite, sem rede.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { beds24ReservasOperacoes, beds24ReservasSite, imoveis, organizacoes, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { semDadosPessoais } from "@/pagamentos/testes";
import { chaveOperacaoBeds24, chaveSimulacaoBeds24 } from "./reservas-site-regras";

let db: Db, close: () => Promise<void>, org: string, im: string, reservaId: string;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "T1", nome: "Imóvel fictício" }).returning();
  [{ id: reservaId }] = await db.insert(reservas).values({ organizacaoId: org, imovelId: im, codigo: `SCL-${crypto.randomUUID().slice(0, 6)}`, origem: "site", fonte: "site", checkin: "2026-12-20", checkout: "2026-12-27", hospedes: 4 }).returning();
});

/** O código do Postgres do erro (o drizzle embrulha o erro do PGlite). */
async function codigoDoErro(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    const c = e as { code?: string; cause?: { code?: string } };
    return c.code ?? c.cause?.code;
  }
}
const operacao = (o: Partial<typeof beds24ReservasOperacoes.$inferInsert> = {}) =>
  db.insert(beds24ReservasOperacoes).values({ organizacaoId: org, reservaId, tipo: "criar", chave: chaveOperacaoBeds24("criar", reservaId, 1), modo: "real", ...o });

describe("tabelas das reservas do site no Beds24 (migração 0072)", () => {
  it("um acompanhamento por reserva e organização", async () => {
    await db.insert(beds24ReservasSite).values({ organizacaoId: org, reservaId, imovelId: im, referencia: "SCL-7K2QXM" });
    expect(await codigoDoErro(db.insert(beds24ReservasSite).values({ organizacaoId: org, reservaId, imovelId: im, referencia: "SCL-7K2QXM" }))).toBe("23505");
    const [linha] = await db.select().from(beds24ReservasSite).where(eq(beds24ReservasSite.organizacaoId, org));
    expect(linha).toMatchObject({ situacao: "pendente", motivo: null, versao: 0, tentativas: 0, buscasSemConclusao: 0, credencial: "", esperado: null, otaFechadaEm: null });
  });

  it("chave de idempotência única por organização; inserir de novo com on conflict não duplica", async () => {
    await operacao();
    expect(await codigoDoErro(operacao({ situacao: "superada" }))).toBe("23505");
    const repetida = await db.insert(beds24ReservasOperacoes).values({ organizacaoId: org, reservaId, tipo: "criar", chave: chaveOperacaoBeds24("criar", reservaId, 1), modo: "real", situacao: "superada" }).onConflictDoNothing({ target: [beds24ReservasOperacoes.organizacaoId, beds24ReservasOperacoes.chave] }).returning();
    expect(repetida).toEqual([]);
    expect(await db.select().from(beds24ReservasOperacoes).where(eq(beds24ReservasOperacoes.organizacaoId, org))).toHaveLength(1);
  });

  it("no máximo uma operação ativa (pendente, enviando ou incerta) por reserva; as terminadas ficam no histórico", async () => {
    await operacao({ situacao: "enviando" });
    for (const situacao of ["pendente", "incerta", "enviando"] as const) {
      expect(await codigoDoErro(operacao({ chave: `atualizar:${reservaId}:${situacao}`, tipo: "atualizar", situacao }))).toBe("23505");
    }
    for (const situacao of ["conferida", "superada", "falhou", "simulada"] as const) await operacao({ chave: `x:${situacao}`, situacao });
    // O ensaio não tem reserva: vários convivem.
    await db.insert(beds24ReservasOperacoes).values([
      { organizacaoId: org, tipo: "ensaio", chave: "ensaio:a", modo: "real", situacao: "enviando" },
      { organizacaoId: org, tipo: "ensaio", chave: "ensaio:b", modo: "real", situacao: "enviando" },
    ]);
    expect(await db.select().from(beds24ReservasOperacoes).where(eq(beds24ReservasOperacoes.organizacaoId, org))).toHaveLength(7);
  });

  it("os índices do desenho existem com os nomes da migração", async () => {
    const r = await db.execute(sql`select indexname from pg_indexes where tablename in ('beds24_reservas_site', 'beds24_reservas_operacoes') order by indexname`);
    const nomes = (r as unknown as { rows: { indexname: string }[] }).rows.map((x) => x.indexname);
    expect(nomes).toEqual(expect.arrayContaining(["beds24_reservas_site_reserva", "beds24_reservas_operacoes_chave", "beds24_reservas_operacoes_uma_ativa", "beds24_reservas_operacoes_situacao", "beds24_reservas_operacoes_beds24"]));
  });

  it("semDadosPessoais cobre as duas tabelas novas (o canário aparece; sem ele, nada)", async () => {
    const [a] = await db.insert(beds24ReservasSite).values({ organizacaoId: org, reservaId, imovelId: im, referencia: "SCL-7K2QXM" }).returning();
    await operacao({ acompanhamentoId: a.id, chave: chaveSimulacaoBeds24(reservaId, "criar", "abc", null), modo: "simulacao", situacao: "simulada", pedido: { quarto: "123456", chegada: "2026-12-20", saida: "2026-12-27", hospedes: 4, situacao: "confirmada", referencia: "SCL-7K2QXM" } });
    expect(await semDadosPessoais(db, ["canario.site@example.com", "canario.operacao@example.com"])).toEqual([]);
    await db.update(beds24ReservasSite).set({ lido: { quarto: "canario.site@example.com", chegada: "2026-12-20", saida: "2026-12-27", hospedes: 4, situacao: "confirmada" } });
    await db.update(beds24ReservasOperacoes).set({ erro: "canario.operacao@example.com" });
    expect(await semDadosPessoais(db, ["canario.site@example.com", "canario.operacao@example.com"])).toEqual(["canario.site@example.com", "canario.operacao@example.com"]);
  });
});
