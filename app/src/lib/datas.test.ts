import { describe, expect, it } from "vitest";
import { instanteLocal as instanteDoPortal, somarDias as somarDoPortal } from "@/hospede/portal";
import { escreverHora, FUSO_PADRAO, HORA_VALIDA, horaNoFuso, hojeISO, instanteLocal, lerHora, PADRAO_DO_CAMPO_HORA, somarDias } from "./datas";

describe("datas no fuso do imóvel", () => {
  it("somarDias anda pelo calendário (mês, ano e ano bissexto)", () => {
    expect(somarDias("2026-10-30", 3)).toBe("2026-11-02");
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(somarDias("2028-02-28", 1)).toBe("2028-02-29");
    expect(somarDias("2026-03-01", -1)).toBe("2026-02-28");
    expect(somarDias("2026-10-10", 0)).toBe("2026-10-10");
  });

  it("instanteLocal: a hora do dia no fuso (São Paulo é UTC−3; outro fuso, outro instante)", () => {
    expect(instanteLocal("2026-10-10", "15:00", "America/Sao_Paulo").toISOString()).toBe("2026-10-10T18:00:00.000Z");
    expect(instanteLocal("2026-10-10", "00:00", "America/Sao_Paulo").toISOString()).toBe("2026-10-10T03:00:00.000Z");
    expect(instanteLocal("2026-10-10", "23:59", "America/Sao_Paulo").toISOString()).toBe("2026-10-11T02:59:00.000Z");
    expect(instanteLocal("2026-07-10", "15:00", "Europe/Lisbon").toISOString()).toBe("2026-07-10T14:00:00.000Z");
    // O mesmo instante é de dias diferentes em UTC e em São Paulo.
    const tarde = instanteLocal("2026-10-16", "23:30", "America/Sao_Paulo");
    expect(hojeISO("America/Sao_Paulo", tarde)).toBe("2026-10-16");
    expect(hojeISO("UTC", tarde)).toBe("2026-10-17");
  });

  it("o portal do hóspede continua exportando as mesmas funções (uma regra, um lugar)", () => {
    expect(instanteDoPortal).toBe(instanteLocal);
    expect(somarDoPortal).toBe(somarDias);
  });

  it("escreverHora (casa, cotação e Minha reserva; Diego, 16/10/2026): sempre HH:MM com dois dígitos, nunca '15h'", () => {
    expect(escreverHora("15:00")).toBe("15:00");
    expect(escreverHora("11:00")).toBe("11:00");
    expect(escreverHora("09:00")).toBe("09:00");
    expect(escreverHora("9:00")).toBe("09:00");
    expect(escreverHora("10:00")).toBe("10:00");
    expect(escreverHora("00:00")).toBe("00:00");
    expect(escreverHora("15:30")).toBe("15:30");
    expect(escreverHora("09:30")).toBe("09:30");
    // O formato antigo (M7.20) também sai no novo.
    expect(escreverHora("15h")).toBe("15:00");
    expect(escreverHora("15h30")).toBe("15:30");
    // O que não é hora sai como está, sem palpite.
    expect(escreverHora("a combinar")).toBe("a combinar");
  });

  it("lerHora: aceita '15:00', '9:00', '15h', '15h30' e '9h05' e devolve HH:MM; o resto é null, sem adivinhar", () => {
    const validas: [string, string][] = [
      ["15:00", "15:00"],
      ["9:00", "09:00"],
      ["09:05", "09:05"],
      ["00:00", "00:00"],
      ["23:59", "23:59"],
      ["15h", "15:00"],
      ["15H", "15:00"],
      ["15h30", "15:30"],
      ["9h05", "09:05"],
      ["0h", "00:00"],
      [" 15:00 ", "15:00"],
    ];
    for (const [t, h] of validas) expect(lerHora(t), t).toBe(h);
    for (const t of ["25:00", "24:00", "15:60", "15:7", "15h7", "15", "1500", "", "  ", "texto", "15:00h", "15 h", "3 da tarde", "-1:00", "115:00"]) expect(lerHora(t), t).toBeNull();
  });

  it("HORA_VALIDA é o formato guardado (dois dígitos); o pattern do campo aceita o que lerHora lê com dois-pontos", () => {
    for (const h of ["00:00", "09:05", "15:00", "23:59"]) expect(HORA_VALIDA.test(h), h).toBe(true);
    for (const h of ["9:00", "24:00", "15:60", "15h", "15:00 "]) expect(HORA_VALIDA.test(h), h).toBe(false);
    // O navegador ancora o pattern no começo e no fim.
    const campo = new RegExp(`^(?:${PADRAO_DO_CAMPO_HORA})$`);
    for (const h of ["9:00", "09:00", "15:30", "23:59", "0:00"]) {
      expect(campo.test(h), h).toBe(true);
      expect(HORA_VALIDA.test(lerHora(h)!), h).toBe(true);
    }
    for (const h of ["24:00", "15:60", "15h", "15", "1:5"]) expect(campo.test(h), h).toBe(false);
  });

  it("horaNoFuso: HH:MM em 24 horas no fuso (padrão: São Paulo), meia-noite como 00:05, nunca AM/PM", () => {
    expect(FUSO_PADRAO).toBe("America/Sao_Paulo");
    expect(horaNoFuso(new Date("2026-10-17T01:30:00Z"))).toBe("22:30");
    expect(horaNoFuso(new Date("2026-10-17T01:30:00Z"), "America/Sao_Paulo")).toBe("22:30");
    expect(horaNoFuso(new Date("2026-10-17T03:05:00Z"))).toBe("00:05");
    expect(horaNoFuso(new Date("2026-07-10T23:05:00Z"), "Europe/Lisbon")).toBe("00:05");
    expect(horaNoFuso(new Date("2026-07-10T14:00:00Z"), "Europe/Lisbon")).toBe("15:00");
    for (let h = 0; h < 24; h++) {
      const saida = horaNoFuso(new Date(Date.UTC(2026, 9, 16, h, 7)));
      expect(saida, saida).toMatch(HORA_VALIDA);
      expect(saida).not.toMatch(/AM|PM/i);
    }
  });
});
