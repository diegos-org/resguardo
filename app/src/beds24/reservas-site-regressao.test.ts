/**
 * Reserva paga do site no Beds24 (M8.3c) — teste 39 do plano: a regressão da alteração. Uma reserva que o sistema criou no
 * Beds24 fecha as noites dela lá, e a importação lê essas noites como fechadas (`livres = 0`) ou, com outra reserva por cima,
 * em overbooking (`livres = -1`, aceito desde o bloco A). A alteração que acrescenta uma noite no fim continua aceita: nas
 * noites da própria reserva, a leitura do Beds24 não decide (`pagamentos/alteracao.ts`, `noitesLivres` sem ela, e
 * `site/disponibilidade.ts`, `propria`); só a noite nova passa pela conferência. Depois, a atualização sai ao Beds24. PGlite,
 * os cenários do pagamento e o Beds24 falso: nada vai ao Beds24.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { gravarConfig } from "@/configuracoes/armazem";
import { beds24Calendario } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { alterar, type Cenario, env, minutos, montarCenario, pagarEConfirmar, usuarioDeTeste } from "@/pagamentos/testes";
import { Beds24Falso, ESCOPOS_ESPERADOS_FALSO } from "./falso";
import { impressaoCredencialBeds24 } from "./http";
import { enviarReservasDoSite } from "./reservas-site-envio";
import { gravarEscoposLidos } from "./reservas-site-rotina";

const PRONTO = env({ VERCEL_ENV: "production", NODE_ENV: "production", BEDS24_ESCRITA_RESERVAS: "ligada", BEDS24_REFRESH_TOKEN: "refresh-ficticio" });
const CREDENCIAL = impressaoCredencialBeds24(PRONTO);
type Obj = Record<string, unknown>;

let db: Db, close: () => Promise<void>, c: Cenario, falso: Beds24Falso, autorId: string;
let espiao: ReturnType<typeof vi.spyOn>;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  espiao = vi.spyOn(globalThis, "fetch");
  c = await montarCenario(db);
  autorId = await usuarioDeTeste(c);
  falso = new Beds24Falso(() => minutos(10));
  falso.properties = [{ id: 10, currency: "BRL", roomTypes: [{ id: 20, name: "Studio" }] }];
  const dias: Obj[] = [];
  for (let d = "2026-10-01"; d <= "2026-11-30"; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) dias.push({ from: d, to: d, numAvail: 1, price1: 450 });
  falso.calendarios = [{ roomId: 20, calendar: dias }];
  await gravarConfig(db, c.org, "reservas_beds24", { pausado: null, retomado: null, imoveis: [{ imovelId: c.imovel, ligadoEm: "2026-09-01T00:00:00.000Z", ligadoPor: null }], ensaio: { credencial: CREDENCIAL, em: "2026-09-01T00:00:00.000Z", operacaoId: "6f1c2a7e-3b4d-4c5e-8f90-123456789abc" } }, null);
  await gravarEscoposLidos(db, c.org, CREDENCIAL, { escopos: [...ESCOPOS_ESPERADOS_FALSO], ilegiveis: [] }, minutos(0));
});
afterEach(() => {
  expect(espiao).not.toHaveBeenCalled();
  espiao.mockRestore();
});

const rodar = (agora: Date) => enviarReservasDoSite(db, c.org, falso, { env: PRONTO, relogio: { agora: () => agora, restanteMs: () => 240_000 } });

/** A reserva paga, criada pelo sistema e conferida; a importação leu depois as noites dela (12 a 14) com `livres`. */
async function criadaELida(livres: number) {
  const x = await pagarEConfirmar(c);
  expect(await rodar(minutos(10))).toMatchObject({ criadas: 1, conferidas: 1 });
  for (const data of ["2026-10-12", "2026-10-13", "2026-10-14"]) {
    await db.update(beds24Calendario).set({ livres, observadoEm: minutos(15) }).where(and(eq(beds24Calendario.organizacaoId, c.org), eq(beds24Calendario.data, data)));
  }
  return x;
}

describe("teste 39: a alteração de uma reserva criada pelo sistema, com as noites dela fechadas na leitura do Beds24", () => {
  it.each([0, -1])("livres = %i nas noites dela: pela cotação do site, a noite acrescentada no fim é aceita (segurada à espera da diferença)", async (livres) => {
    const x = await criadaELida(livres);
    const { previa, resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId });
    expect(previa.ok).toBe(true);
    expect(resultado).toMatchObject({ ok: true, situacao: "segurada" });
  });

  it.each([0, -1])("livres = %i nas noites dela: sem mudar o valor, aplicada na hora, e a atualização sai ao Beds24 na volta seguinte", async (livres) => {
    const x = await criadaELida(livres);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16", valor: { origem: "mantido", motivo: "acordo_com_hospede", nota: "Uma noite a mais combinada" } }, minutos(20), { autorId, aplicar: true });
    expect(resultado).toMatchObject({ ok: true, situacao: "aplicada" });
    expect(await rodar(minutos(30))).toMatchObject({ posts: 1, atualizadas: 1, conferidas: 1 });
    expect(falso.escritasReservas.at(-1)?.corpo).toEqual([{ id: 900001, arrival: "2026-10-12", departure: "2026-10-16", numAdult: 4 }]);
  });
});
