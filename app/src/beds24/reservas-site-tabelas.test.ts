/**
 * As duas tabelas do M8.3 (migração 0072, desenho 3.2): os únicos e o índice parcial que o banco garante sozinho, e a
 * varredura `semDadosPessoais`, que passa a cobrir as duas. M8.3c (migração 0074): a resposta e o detalhe das operações, o
 * índice do último 403 ou 401, o estado da rotina (uma linha por organização) e a varredura também no resumo das rotinas e
 * nos e-mails. M3.11b (migração 0076): as marcas das OTAs da reserva direta (`reservas_diretas_otas`, só ids e horas) e a
 * varredura também nela. PGlite, sem rede.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { beds24ReservasOperacoes, beds24ReservasRotina, beds24ReservasSite, execucoesAutomacao, imoveis, organizacoes, reservas, reservasDiretasOtas } from "@/db/schema";
import { CorreioMemoria } from "@/email/correio";
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

describe("as colunas e a tabela da escrita (migração 0074, M8.3c)", () => {
  it("a operação nasce sem resposta e com o detalhe vazio; a resposta e o detalhe gravados voltam como foram", async () => {
    const [o] = await operacao().returning();
    expect(o).toMatchObject({ resposta: null, detalhe: {} });
    await db.update(beds24ReservasOperacoes).set({ resposta: "sem_id", detalhe: { candidato: "98765", bloqueio: { inicio: "2026-12-20", fim: "2026-12-22" } } }).where(eq(beds24ReservasOperacoes.id, o.id));
    const [l] = await db.select().from(beds24ReservasOperacoes).where(eq(beds24ReservasOperacoes.id, o.id));
    expect(l).toMatchObject({ resposta: "sem_id", detalhe: { candidato: "98765", bloqueio: { inicio: "2026-12-20", fim: "2026-12-22" } } });
  });

  it("o índice do último 403 ou 401 existe com o nome da migração; o estado da rotina é uma linha por organização", async () => {
    const r = await db.execute(sql`select indexname from pg_indexes where tablename in ('beds24_reservas_operacoes', 'beds24_reservas_rotina') order by indexname`);
    const nomes = (r as unknown as { rows: { indexname: string }[] }).rows.map((x) => x.indexname);
    expect(nomes).toEqual(expect.arrayContaining(["beds24_reservas_operacoes_resposta", "beds24_reservas_rotina_pkey"]));
    await db.insert(beds24ReservasRotina).values({ organizacaoId: org });
    expect(await codigoDoErro(db.insert(beds24ReservasRotina).values({ organizacaoId: org }))).toBe("23505");
    const [linha] = await db.select().from(beds24ReservasRotina).where(eq(beds24ReservasRotina.organizacaoId, org));
    expect(linha).toMatchObject({ escopos: null, escoposCredencial: "", escoposLidosEm: null, conferenciaEm: null, releituraEm: null });
  });

  it("semDadosPessoais cobre a resposta e o detalhe, o estado da rotina, o resumo das rotinas e os e-mails (o canário aparece; sem ele, nada)", async () => {
    const canarios = ["canario.detalhe@example.com", "canario.rotina@example.com", "canario.resumo@example.com", "canario.email@example.com"];
    const [o] = await operacao({ detalhe: { candidato: "98765" } }).returning();
    await db.insert(beds24ReservasRotina).values({ organizacaoId: org, escoposCredencial: "refresh:0123456789abcdef" });
    await db.insert(execucoesAutomacao).values({ nome: "reservas-beds24", ok: true, resumo: "1 criada, 0 avisos" });
    const correio = new CorreioMemoria();
    await correio.enviar({ para: "equipe@example.com", assunto: "Reserva SCL-7K2QXM no Beds24", texto: "As noites de 20/12 a 27/12 da reserva SCL-7K2QXM estão ocupadas." });
    expect(await semDadosPessoais(db, canarios, { correio })).toEqual([]);
    await db.update(beds24ReservasOperacoes).set({ detalhe: { candidato: canarios[0] } as never }).where(eq(beds24ReservasOperacoes.id, o.id));
    await db.update(beds24ReservasRotina).set({ escoposCredencial: canarios[1] }).where(eq(beds24ReservasRotina.organizacaoId, org));
    await db.insert(execucoesAutomacao).values({ nome: "reservas-beds24", ok: true, resumo: canarios[2] });
    await correio.enviar({ para: "equipe@example.com", assunto: "Aviso", texto: `Contato ${canarios[3]}` });
    expect(await semDadosPessoais(db, canarios, { correio })).toEqual(canarios);
    // Sem o correio, os e-mails não entram (quem chama passa o dele).
    expect(await semDadosPessoais(db, canarios)).toEqual(canarios.slice(0, 3));
  });
});

describe("as marcas das OTAs da reserva direta (migração 0076, M3.11b)", () => {
  it("uma linha por reserva, só ids e horas (nenhuma coluna de texto); o índice do desenho; a varredura semDadosPessoais cobre a tabela", async () => {
    const [{ id: direta }] = await db.insert(reservas).values({ organizacaoId: org, imovelId: im, codigo: `SCL-${crypto.randomUUID().slice(0, 6)}`, origem: "direta", fonte: "manual", checkin: "2026-12-20", checkout: "2026-12-27", hospedes: 2 }).returning();
    await db.insert(reservasDiretasOtas).values({ reservaId: direta, organizacaoId: org, fechadasEm: new Date("2026-10-02T12:00:00Z") });
    expect(await codigoDoErro(db.insert(reservasDiretasOtas).values({ reservaId: direta, organizacaoId: org, fechadasEm: new Date("2026-10-03T12:00:00Z") }))).toBe("23505");
    // A reserva do site do cenário não tem marca nenhuma aqui (as dela ficam no acompanhamento).
    expect(await codigoDoErro(db.insert(reservasDiretasOtas).values({ reservaId: crypto.randomUUID(), organizacaoId: org, fechadasEm: new Date() }))).toBe("23503");
    const [linha] = await db.select().from(reservasDiretasOtas).where(eq(reservasDiretasOtas.organizacaoId, org));
    expect(linha).toMatchObject({ reservaId: direta, fechadasEm: new Date("2026-10-02T12:00:00Z"), fechadasPor: null, reabertasEm: null, reabertasPor: null });
    const tipos = await db.execute(sql`select data_type from information_schema.columns where table_schema = 'public' and table_name = 'reservas_diretas_otas'`);
    expect(new Set((tipos as unknown as { rows: { data_type: string }[] }).rows.map((x) => x.data_type))).toEqual(new Set(["uuid", "timestamp with time zone"]));
    const indices = await db.execute(sql`select indexname from pg_indexes where tablename = 'reservas_diretas_otas' order by indexname`);
    expect((indices as unknown as { rows: { indexname: string }[] }).rows.map((x) => x.indexname)).toEqual(["reservas_diretas_otas_organizacao", "reservas_diretas_otas_pkey"]);
    expect(await semDadosPessoais(db, ["canario.direta@example.com"])).toEqual([]);
  });
});
