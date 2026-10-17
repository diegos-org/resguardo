/**
 * Contadores do dia dos avisos do WhatsApp (M10.1a, desenho 4.4): a soma atômica por dia de São Paulo, o "último aviso
 * válido", a situação para Integrações e a limpeza de 90 dias (o mesmo prazo do Mercado Pago). PGlite, sem rede.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { organizacoes, whatsappAvisosDia, whatsappEventos } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { GUARDAR_EVENTOS_DIAS as GUARDAR_DO_MERCADO_PAGO } from "@/pagamentos/eventos";
import { GUARDAR_EVENTOS_DIAS } from "@/lib/retencao";
import { apagarAvisosWhatsappAntigos, situacaoDosAvisosWhatsapp, somarContagens, somarNoDia } from "./contadores";
import { CONTADORES_DIA } from "./regras";

let db: Db, close: () => Promise<void>, org: string;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  // Os contadores não têm organização: cada teste começa sem nenhum dia gravado.
  await db.delete(whatsappAvisosDia);
  await db.delete(whatsappEventos);
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
});

const dia = async (d: string) => (await db.select().from(whatsappAvisosDia).where(eq(whatsappAvisosDia.dia, d)))[0];
const DIA_SEGUINTE = 86_400_000;

describe("somarNoDia", () => {
  it("cada contador soma no dia de São Paulo: 23:30 de um dia e 00:30 do seguinte (horário de Brasília) caem em dias diferentes", async () => {
    const noite = new Date("2026-10-18T02:30:00Z"); // 17/10 às 23:30 em São Paulo
    const madrugada = new Date("2026-10-18T03:30:00Z"); // 18/10 às 00:30
    for (const k of CONTADORES_DIA) await somarNoDia(db, { [k]: 1 }, noite);
    await somarNoDia(db, { outra_conta: 2, ignorados: 3 }, noite);
    await somarNoDia(db, { desconhecidos: 1 }, madrugada);
    expect(await dia("2026-10-17")).toMatchObject({ assinaturasRecusadas: 1, ilegiveis: 1, outraConta: 3, desconhecidos: 1, ignorados: 4, ultimoValidoEm: null });
    expect(await dia("2026-10-18")).toMatchObject({ assinaturasRecusadas: 0, ilegiveis: 0, outraConta: 0, desconhecidos: 1, ignorados: 0, ultimoValidoEm: null });
  });

  it("valido grava o último aviso válido, que só avança; nada a somar e não válido não toca o banco", async () => {
    const t1 = new Date("2026-10-17T15:00:00Z");
    await somarNoDia(db, {}, t1, { valido: true });
    expect(await dia("2026-10-17")).toMatchObject({ ultimoValidoEm: t1, ilegiveis: 0 });
    await somarNoDia(db, { ilegiveis: 1 }, new Date(t1.getTime() + 60_000), { valido: true });
    // Um aviso processado depois, com uma hora mais velha, não volta o "último aviso válido".
    await somarNoDia(db, {}, new Date(t1.getTime() - 60_000), { valido: true });
    expect(await dia("2026-10-17")).toMatchObject({ ultimoValidoEm: new Date(t1.getTime() + 60_000), ilegiveis: 1 });
    await somarNoDia(db, {}, new Date("2026-10-19T15:00:00Z"));
    await somarNoDia(db, { ilegiveis: 0, ignorados: -3 }, new Date("2026-10-19T15:00:00Z"));
    expect(await dia("2026-10-19")).toBeUndefined();
  });

  it("somarContagens soma contador a contador e ignora o que não é inteiro positivo", () => {
    expect(somarContagens({ outra_conta: 1 }, { outra_conta: 2, ignorados: 1, desconhecidos: 0 })).toEqual({ outra_conta: 3, ignorados: 1 });
    expect(somarContagens({}, { ignorados: 1.5, desconhecidos: Number.NaN })).toEqual({});
  });
});

describe("situacaoDosAvisosWhatsapp", () => {
  it("os contadores de hoje (zero sem linha) e o último aviso válido de qualquer dia", async () => {
    const ontem = new Date("2026-10-16T15:00:00Z");
    const hoje = new Date("2026-10-17T15:00:00Z");
    expect(await situacaoDosAvisosWhatsapp(db, hoje)).toEqual({ hoje: { assinaturas_recusadas: 0, ilegiveis: 0, outra_conta: 0, desconhecidos: 0, ignorados: 0 }, ultimoValidoEm: null });
    await somarNoDia(db, { ignorados: 2 }, ontem, { valido: true });
    await somarNoDia(db, { assinaturas_recusadas: 1 }, hoje);
    expect(await situacaoDosAvisosWhatsapp(db, hoje)).toEqual({ hoje: { assinaturas_recusadas: 1, ilegiveis: 0, outra_conta: 0, desconhecidos: 0, ignorados: 0 }, ultimoValidoEm: ontem });
  });
});

describe("apagarAvisosWhatsappAntigos", () => {
  it(`o prazo é o mesmo do Mercado Pago (${GUARDAR_EVENTOS_DIAS} dias, lib/retencao.ts)`, () => {
    expect(GUARDAR_EVENTOS_DIAS).toBe(90);
    expect(GUARDAR_DO_MERCADO_PAGO).toBe(GUARDAR_EVENTOS_DIAS);
  });

  it("apaga eventos com mais de 90 dias e os dias antigos, guardando o último dia com aviso válido", async () => {
    const agora = new Date("2026-10-17T15:00:00Z");
    const antes = (dias: number) => new Date(agora.getTime() - dias * DIA_SEGUINTE);
    await db.insert(whatsappEventos).values([
      { organizacaoId: org, campo: "messages", resultado: "gravado", recebidoEm: antes(GUARDAR_EVENTOS_DIAS + 1) },
      { organizacaoId: org, campo: "messages", resultado: "gravado", recebidoEm: antes(GUARDAR_EVENTOS_DIAS - 1) },
    ]);
    await somarNoDia(db, { ignorados: 1 }, antes(200), { valido: true });
    await somarNoDia(db, { ignorados: 1 }, antes(120), { valido: true });
    await somarNoDia(db, { assinaturas_recusadas: 1 }, antes(100));
    await somarNoDia(db, { assinaturas_recusadas: 1 }, antes(10));
    expect(await apagarAvisosWhatsappAntigos(db, agora)).toEqual({ eventos: 1, dias: 2 });
    expect(await db.select({ recebidoEm: whatsappEventos.recebidoEm }).from(whatsappEventos)).toEqual([{ recebidoEm: antes(GUARDAR_EVENTOS_DIAS - 1) }]);
    // Fica o dia de 120 dias atrás (o último com aviso válido) e o de 10 dias atrás; os de 200 e 100 dias saem.
    const dias = (await db.select({ dia: whatsappAvisosDia.dia }).from(whatsappAvisosDia)).map((d) => d.dia).sort();
    expect(dias).toEqual(["2026-06-19", "2026-10-07"]);
    expect(await situacaoDosAvisosWhatsapp(db, agora)).toMatchObject({ ultimoValidoEm: antes(120) });
    expect(await apagarAvisosWhatsappAntigos(db, agora)).toEqual({ eventos: 0, dias: 0 });
  });
});
