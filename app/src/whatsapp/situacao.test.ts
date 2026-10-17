/**
 * Situação da conta (M10.1a, tabela de eventos do desenho, 4.3): o que cada evento faz, o e-mail só nos que pedem, os
 * rótulos completos e o prazo de 24 h contado no fuso de São Paulo. Puro, sem banco.
 */
import { describe, expect, it } from "vitest";
import { dataHoraNoFuso } from "@/lib/datas";
import type { ContaLida } from "./aviso";
import { ESTADOS_BANIMENTO, EVENTOS_COM_EMAIL, EVENTOS_CONTA, type EventoConta, MOTIVOS_DESCONEXAO, SITUACOES_CONTA } from "./regras";
import { efeitoDoEvento, MOTIVO_NAO_INFORMADO, prazoDas24h, ROTULO_EVENTO, ROTULO_MOTIVO, ROTULO_SITUACAO, rotuloDoMotivo } from "./situacao";

const EM = new Date("2026-10-17T15:00:00Z");
const conta = (evento: EventoConta, o: Partial<ContaLida> = {}): ContaLida => ({ evento, wabaIds: ["200000000000002"], em: EM, motivo: null, iniciadoPor: null, banimento: null, ...o });

describe("efeitoDoEvento", () => {
  it.each([
    ["PARTNER_ADDED", "conectada", false],
    ["PARTNER_REMOVED", "desconectada", true],
    ["ACCOUNT_OFFBOARDED", "aguardando_reconexao", true],
    ["ACCOUNT_RECONNECTED", "conectada", false],
    ["ACCOUNT_DELETED", "desconectada", true],
    ["PARTNER_APP_UNINSTALLED", "desconectada", true],
  ] as const)("%s → %s (e-mail: %s)", (evento, situacao, email) => {
    expect(efeitoDoEvento(conta(evento))).toMatchObject({ situacao, email });
  });

  it("PARTNER_ADDED começa o prazo de 24 h; os outros não mexem em conectadoEm", () => {
    expect(efeitoDoEvento(conta("PARTNER_ADDED"))?.conectadoEm).toEqual(EM);
    for (const e of EVENTOS_CONTA.filter((x) => x !== "PARTNER_ADDED")) expect(efeitoDoEvento(conta(e, { banimento: "DISABLE" }))?.conectadoEm).toBeUndefined();
  });

  it.each([
    ["DISABLE", "suspensa", true],
    ["SCHEDULE_FOR_DISABLE", "suspensa", true],
    ["REINSTATE", "conectada", false],
  ] as const)("DISABLED_UPDATE com %s → %s (e-mail: %s)", (banimento, situacao, email) => {
    expect(efeitoDoEvento(conta("DISABLED_UPDATE", { banimento }))).toMatchObject({ situacao, email });
  });

  it("ACCOUNT_RESTRICTION, ACCOUNT_VIOLATION e DISABLED_UPDATE sem estado não mudam a situação (null, sem e-mail)", () => {
    expect(efeitoDoEvento(conta("ACCOUNT_RESTRICTION"))).toBeNull();
    expect(efeitoDoEvento(conta("ACCOUNT_VIOLATION"))).toBeNull();
    expect(efeitoDoEvento(conta("DISABLED_UPDATE"))).toBeNull();
  });

  it("o motivo e quem iniciou passam adiante; a conta que volta a ficar conectada fica sem motivo", () => {
    expect(efeitoDoEvento(conta("PARTNER_REMOVED", { motivo: "PRIMARY_INACTIVITY", iniciadoPor: "SYSTEM" }))).toMatchObject({ motivo: "PRIMARY_INACTIVITY", iniciadoPor: "SYSTEM" });
    expect(efeitoDoEvento(conta("ACCOUNT_RECONNECTED", { motivo: "ACCOUNT_DISCONNECTED", iniciadoPor: "USER" }))).toMatchObject({ situacao: "conectada", motivo: null, iniciadoPor: null });
  });

  it("todo evento com e-mail está em EVENTOS_COM_EMAIL, e nenhum que conecta manda e-mail", () => {
    for (const evento of EVENTOS_CONTA) {
      for (const banimento of [null, ...ESTADOS_BANIMENTO]) {
        const e = efeitoDoEvento(conta(evento, { banimento }));
        if (e?.email) expect(EVENTOS_COM_EMAIL as readonly string[]).toContain(evento);
        if (e?.situacao === "conectada") expect(e.email).toBe(false);
      }
    }
  });
});

describe("rótulos", () => {
  it("um rótulo para cada situação, motivo e evento, sem códigos da Meta no texto", () => {
    for (const s of SITUACOES_CONTA) expect(ROTULO_SITUACAO[s]).toBeTruthy();
    for (const m of MOTIVOS_DESCONEXAO) expect(ROTULO_MOTIVO[m]).not.toMatch(/[A-Z]{2,}_/);
    for (const e of EVENTOS_CONTA) expect(ROTULO_EVENTO[e]).not.toMatch(/[A-Z]{2,}_/);
    expect(ROTULO_SITUACAO).toEqual({ nao_conectada: "Não conectado", conectada: "Conectado", aguardando_reconexao: "Aguardando reconexão", desconectada: "Desconectado", suspensa: "Suspenso" });
    expect(ROTULO_MOTIVO.PRIMARY_INACTIVITY).toBe("o celular principal ficou cerca de 14 dias sem abrir o WhatsApp Business");
    expect(ROTULO_EVENTO.PARTNER_APP_UNINSTALLED).toBe("App do sistema removido da conta");
  });

  it("sem motivo (ou motivo fora da lista, que a leitura já trocou por null): 'motivo não informado pela Meta'", () => {
    expect(rotuloDoMotivo(null)).toBe(MOTIVO_NAO_INFORMADO);
    expect(rotuloDoMotivo(undefined)).toBe("motivo não informado pela Meta");
    expect(rotuloDoMotivo("CHANGE_NUMBER")).toBe("o número da empresa foi trocado no aplicativo");
  });
});

describe("prazoDas24h", () => {
  it("conectado às 23:00 (horário de Brasília) → prazo no dia seguinte às 23:00", () => {
    const conectadoEm = new Date("2026-10-17T02:00:00Z"); // 16/10 às 23:00 em São Paulo
    const prazo = prazoDas24h({ situacao: "conectada", conectadoEm }, new Date("2026-10-17T12:00:00Z"));
    expect(prazo && dataHoraNoFuso(prazo)).toBe("17/10/2026 às 23:00");
    expect(dataHoraNoFuso(conectadoEm)).toBe("16/10/2026 às 23:00");
  });

  it("passado o prazo, ou conta que não está conectada, ou sem data: null", () => {
    const conectadoEm = new Date("2026-10-17T02:00:00Z");
    expect(prazoDas24h({ situacao: "conectada", conectadoEm }, new Date("2026-10-18T02:00:00Z"))).toBeNull();
    expect(prazoDas24h({ situacao: "conectada", conectadoEm }, new Date("2026-10-18T01:59:59Z"))).toEqual(new Date("2026-10-18T02:00:00Z"));
    expect(prazoDas24h({ situacao: "desconectada", conectadoEm }, new Date("2026-10-17T03:00:00Z"))).toBeNull();
    expect(prazoDas24h({ situacao: "conectada", conectadoEm: null }, new Date("2026-10-17T03:00:00Z"))).toBeNull();
  });
});
