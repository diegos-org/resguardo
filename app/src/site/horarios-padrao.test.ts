import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { horaDeEntrada, HORA_ENTRADA_PADRAO } from "@/configuracoes/politica-cancelamento";
import { imoveis, organizacoes, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { reservasDoHospede } from "@/hospede/portal";
import { DETALHES_VAZIOS, validarDetalhes } from "@/imoveis/detalhes";
import { imovelDoSite } from "./site";

/**
 * M7.20 — o horário padrão (casa sem horário na ficha) mora num lugar só, `HORARIOS_PADRAO`: com outro valor ali, o
 * cadastro (ficha vazia e hora em branco), a política de cancelamento, a página da casa e Minha reserva seguem juntos.
 * Os números de mentira (16:30 e 10:00) só existem neste teste.
 */
vi.mock("@/site/regras-da-casa", async (orig) => ({ ...(await orig<typeof import("@/site/regras-da-casa")>()), HORARIOS_PADRAO: { entrada: "16:30", saida: "10:00" } }));

let db: Db;
let close: () => Promise<void>;
let org: string;
let casa: string;
// 25/09/2026 12:00 em São Paulo.
const agora = new Date("2026-09-25T15:00:00Z");

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  // Casa no site sem a ficha gravada (sem linha em imoveis_detalhes).
  [{ id: casa }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Studio Exemplo", publico: true, capacidade: 2, endereco: "Rua Fictícia, 403" }).returning();
});
afterEach(() => close());

describe("horário padrão num lugar só (M7.20)", () => {
  it("o cadastro: a ficha vazia e o campo de hora em branco usam o padrão", () => {
    expect([DETALHES_VAZIOS.checkinAPartirDe, DETALHES_VAZIOS.checkoutAte]).toEqual(["16:30", "10:00"]);
    const v = validarDetalhes({});
    expect(v.ok && [v.dados.checkinAPartirDe, v.dados.checkoutAte]).toEqual(["16:30", "10:00"]);
  });

  it("a política de cancelamento conta a entrada no padrão quando a casa não tem horário", () => {
    expect(HORA_ENTRADA_PADRAO).toBe("16:30");
    expect(horaDeEntrada(null)).toBe("16:30");
    expect(horaDeEntrada("14:00")).toBe("14:00");
  });

  it("a página da casa e Minha reserva, numa casa sem ficha, mostram o padrão", async () => {
    const publico = await imovelDoSite(db, org, "403");
    expect([publico?.checkinAPartirDe, publico?.checkoutAte]).toEqual(["16:30", "10:00"]);
    await db.insert(reservas).values({ organizacaoId: org, imovelId: casa, codigo: "SCL-0001", origem: "direta", checkin: "2026-10-10", checkout: "2026-10-13", hospedes: 2, hospedeNome: "Ana Exemplo", hospedeEmail: "ana@example.com" });
    const [r] = await reservasDoHospede(db, org, "ana@example.com", agora);
    expect([r?.entradaAPartirDe, r?.saidaAte]).toEqual(["16:30", "10:00"]);
  });
});
