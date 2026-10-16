/**
 * Rotinas diárias do Beds24 (M8.3a, desenho 8 "Sistema"; seção 10, teste 13): a importação e o envio que terminam
 * "ocupada" ficam registrados como "Não rodou: <causa>" (ok falso, sem virar erro), nunca como sucesso. PGlite e a versão
 * falsa do Beds24 (injetada: nenhuma credencial vira cliente de rede aqui).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { REGRAS_CALENDARIO_PADRAO } from "@/calendario/regras-config";
import { gravarConfig } from "@/configuracoes/armazem";
import { beds24Envios, beds24ReservasOperacoes, execucoesAutomacao, idsExternos, imoveis, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { ultimasExecucoes } from "@/sistema/automacoes";
import { executarCronBeds24 } from "./cron";
import { executarCronEnvioBeds24 } from "./cron-envio";
import { Beds24Falso } from "./falso";

let db: Db, close: () => Promise<void>, org: string, im: string, beds: Beds24Falso;
const env = (o: Record<string, string> = {}) => ({ NODE_ENV: "test", BEDS24_ORGANIZACAO_ID: org, BEDS24_API_KEY: "chave-ficticia", ...o }) as unknown as NodeJS.ProcessEnv;

beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  await db.delete(execucoesAutomacao);
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Organização de teste" }).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "103", nome: "Boutique fictício" }).returning();
  await db.insert(idsExternos).values({ organizacaoId: org, imovelId: im, canal: "beds24", idExterno: "10", detalhe: "20" });
  await db.transaction((tx) => gravarConfig(tx, org, "beds24", { automatica: true, desde: "2026-09-01", diasCalendario: 2 }, null));
  await db.transaction((tx) => gravarConfig(tx, org, "calendario_regras", { ...REGRAS_CALENDARIO_PADRAO, horizonteDias: 10, envio: { imoveis: [im], automatico: true } }, null));
  beds = new Beds24Falso();
  beds.properties = [{ id: 10, currency: "BRL", roomTypes: [{ id: 20, name: "Quarto fictício" }] }];
});

describe("ocupada vira 'não rodou' (M8.3a, teste 13)", () => {
  it("importação diária com um envio de calendário em andamento: não rodou, com a causa; sem erro e sem ler o Beds24", async () => {
    await db.insert(beds24Envios).values({ organizacaoId: org, iniciadoEm: new Date(), modo: "envio", situacao: "executando" });
    expect(await executarCronBeds24(db, env(), { leitor: beds })).toBe("Não rodou: envio de calendário e preços ao Beds24 em andamento");
    expect((await ultimasExecucoes(db)).get("sync-beds24")).toMatchObject({ ok: false, resumo: "Não rodou: envio de calendário e preços ao Beds24 em andamento" });
    expect(beds.chamadas).toBe(0);
  });

  it("importação e envio diários com uma reserva do site sendo enviada: não rodou, com a causa", async () => {
    await db.insert(beds24ReservasOperacoes).values({ organizacaoId: org, tipo: "ensaio", chave: "ensaio:a", modo: "real", situacao: "enviando" });
    expect(await executarCronBeds24(db, env(), { leitor: beds })).toBe("Não rodou: envio de reserva do site ao Beds24 em andamento");
    expect(await executarCronEnvioBeds24(db, env({ BEDS24_ESCRITA: "ligada" }), { leitor: beds, escritor: beds })).toBe("Não rodou: envio de reserva do site ao Beds24 em andamento");
    const u = await ultimasExecucoes(db);
    expect(u.get("sync-beds24")).toMatchObject({ ok: false, resumo: "Não rodou: envio de reserva do site ao Beds24 em andamento" });
    expect(u.get("envio-beds24")).toMatchObject({ ok: false, resumo: "Não rodou: envio de reserva do site ao Beds24 em andamento" });
    expect(beds.chamadas).toBe(0);
    expect(beds.escritas).toHaveLength(0);
  });

  it("envio diário com outro envio em andamento: não rodou; sem nada em andamento, o envio e a importação rodam e registram o sucesso", async () => {
    const [outro] = await db.insert(beds24Envios).values({ organizacaoId: org, iniciadoEm: new Date(), modo: "envio", situacao: "executando" }).returning({ id: beds24Envios.id });
    expect(await executarCronEnvioBeds24(db, env({ BEDS24_ESCRITA: "ligada" }), { leitor: beds, escritor: beds })).toBe("Não rodou: envio de calendário e preços ao Beds24 em andamento");
    await db.update(beds24Envios).set({ situacao: "ok" }).where(eq(beds24Envios.id, outro.id));
    beds.bookings = [];
    beds.calendarios = [{ roomId: 20, calendar: [{ from: "2026-01-01", to: "2031-01-01", numAvail: 1, price1: 400, minStay: 1, maxStay: 27, override: "none" }] }];
    const resumo = await executarCronEnvioBeds24(db, env({ BEDS24_ESCRITA: "ligada" }), { leitor: beds, escritor: beds });
    expect(resumo).not.toContain("Não rodou");
    expect((await ultimasExecucoes(db)).get("envio-beds24")).toMatchObject({ ok: true, resumo });
    expect(await executarCronBeds24(db, env(), { leitor: beds })).not.toContain("Não rodou");
    expect((await ultimasExecucoes(db)).get("sync-beds24")).toMatchObject({ ok: true });
  });
});
