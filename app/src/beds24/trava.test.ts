/**
 * A regra de "em andamento" compartilhada (M8.3a, desenho 5.1 e 3.6): o envio de calendário `executando` (10 min) e a
 * operação de reserva do site `enviando` (6 min, relógio do banco) fazem a importação, o envio, os bloqueios, o vínculo e
 * a fonte de preços esperarem, com a mensagem da causa. PGlite, sem rede.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { beds24Envios, beds24ReservasOperacoes, bloqueios, imoveis, organizacoes, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { criarBloqueio, excluirBloqueio } from "@/reservas/bloqueios";
import { escritaBeds24EmAndamento, esperarEnvioBeds24, MENSAGEM_ENVIO_EM_ANDAMENTO, MENSAGEM_RESERVA_EM_ANDAMENTO } from "./trava";

let db: Db, close: () => Promise<void>, org: string, outra: string, im: string, reservaId: string;
const minutosAtras = (m: number) => new Date(Date.now() - m * 60_000);
const emAndamento = (o: Parameters<typeof escritaBeds24EmAndamento>[2] = {}) => db.transaction((tx) => escritaBeds24EmAndamento(tx, org, o));
const operacao = (o: Partial<typeof beds24ReservasOperacoes.$inferInsert> = {}) =>
  db.insert(beds24ReservasOperacoes).values({ organizacaoId: org, reservaId, tipo: "criar", chave: `criar:${reservaId}:1`, modo: "real", situacao: "enviando", ...o }).returning();

beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  [{ id: org }, { id: outra }] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "103", nome: "Boutique fictício" }).returning();
  [{ id: reservaId }] = await db.insert(reservas).values({ organizacaoId: org, imovelId: im, codigo: `SCL-${crypto.randomUUID().slice(0, 8)}`, origem: "site", fonte: "site", checkin: "2030-12-20", checkout: "2030-12-27", hospedes: 2 }).returning();
});

describe("escritaBeds24EmAndamento", () => {
  it("nada em andamento: null", async () => {
    expect(await emAndamento()).toBeNull();
  });

  it("envio de calendário executando há menos de 10 min: calendário; o próprio envio que pergunta não conta", async () => {
    const [e] = await db.insert(beds24Envios).values({ organizacaoId: org, iniciadoEm: minutosAtras(1), modo: "envio", situacao: "executando" }).returning({ id: beds24Envios.id });
    expect(await emAndamento()).toBe("calendario");
    expect(await emAndamento({ excetoEnvioId: e.id })).toBeNull();
    await db.update(beds24Envios).set({ iniciadoEm: minutosAtras(11) }).where(eq(beds24Envios.id, e.id));
    expect(await emAndamento()).toBeNull();
  });

  it("operação de reserva do site enviando nos últimos 6 min (relógio do banco): reserva; vencida, ou em outra situação, não", async () => {
    const [op] = await operacao();
    expect(await emAndamento()).toBe("reserva");
    // O relógio do banco vale, não o `agora` de quem pergunta.
    expect(await emAndamento({ agora: new Date("2020-01-01T00:00:00Z") })).toBe("reserva");
    await db.update(beds24ReservasOperacoes).set({ iniciadoEm: minutosAtras(5) }).where(eq(beds24ReservasOperacoes.id, op.id));
    expect(await emAndamento()).toBe("reserva");
    await db.update(beds24ReservasOperacoes).set({ iniciadoEm: minutosAtras(7) }).where(eq(beds24ReservasOperacoes.id, op.id));
    expect(await emAndamento()).toBeNull();
    for (const situacao of ["pendente", "incerta", "feita"] as const) {
      await db.update(beds24ReservasOperacoes).set({ situacao, iniciadoEm: new Date() }).where(eq(beds24ReservasOperacoes.id, op.id));
      expect(await emAndamento()).toBeNull();
    }
    // O ensaio (sem reserva) também é uma escrita no Beds24.
    await db.insert(beds24ReservasOperacoes).values({ organizacaoId: org, tipo: "ensaio", chave: "ensaio:a", modo: "real", situacao: "enviando" });
    expect(await emAndamento()).toBe("reserva");
  });

  it("isolado por organização", async () => {
    await operacao();
    await db.insert(beds24Envios).values({ organizacaoId: org, iniciadoEm: new Date(), modo: "envio", situacao: "executando" });
    expect(await db.transaction((tx) => escritaBeds24EmAndamento(tx, outra))).toBeNull();
  });
});

describe("esperarEnvioBeds24 e os bloqueios", () => {
  it("a mensagem diz a causa; a da reserva do site não cita o Beds24 (chega ao proprietário pelo portal)", async () => {
    expect(await db.transaction((tx) => esperarEnvioBeds24(tx, org))).toBeNull();
    const [op] = await operacao();
    expect(await db.transaction((tx) => esperarEnvioBeds24(tx, org))).toBe(MENSAGEM_RESERVA_EM_ANDAMENTO);
    expect(MENSAGEM_RESERVA_EM_ANDAMENTO).not.toMatch(/beds24/i);
    await db.update(beds24ReservasOperacoes).set({ situacao: "conferida" }).where(eq(beds24ReservasOperacoes.id, op.id));
    await db.insert(beds24Envios).values({ organizacaoId: org, iniciadoEm: new Date(), modo: "envio", situacao: "executando" });
    expect(await db.transaction((tx) => esperarEnvioBeds24(tx, org))).toBe(MENSAGEM_ENVIO_EM_ANDAMENTO);
  });

  it("o bloqueio de uso próprio (pelo proprietário) e a remoção esperam a reserva do site sendo enviada, sem a palavra Beds24; vencida, passam", async () => {
    const feito = await criarBloqueio(db, org, { imovelId: im, inicio: "2030-10-03", fim: "2030-10-05", motivo: "Uso próprio" }, null);
    if (!feito.ok) throw new Error(feito.erro);
    const [op] = await operacao();
    const recusado = await criarBloqueio(db, org, { imovelId: im, inicio: "2030-11-03", fim: "2030-11-05", motivo: "Uso próprio" }, null, { fonte: "proprietario", semReserva: true });
    expect(recusado).toEqual({ ok: false, erro: MENSAGEM_RESERVA_EM_ANDAMENTO });
    expect(JSON.stringify(recusado)).not.toMatch(/beds24/i);
    expect(await excluirBloqueio(db, org, feito.id, null)).toEqual({ ok: false, erro: MENSAGEM_RESERVA_EM_ANDAMENTO });
    expect(await db.select().from(bloqueios).where(eq(bloqueios.organizacaoId, org))).toHaveLength(1);
    await db.update(beds24ReservasOperacoes).set({ iniciadoEm: minutosAtras(7) }).where(eq(beds24ReservasOperacoes.id, op.id));
    expect(await criarBloqueio(db, org, { imovelId: im, inicio: "2030-11-03", fim: "2030-11-05", motivo: "Uso próprio" }, null, { fonte: "proprietario", semReserva: true })).toMatchObject({ ok: true });
  });
});
