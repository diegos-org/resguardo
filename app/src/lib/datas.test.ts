import { describe, expect, it } from "vitest";
import { instanteLocal as instanteDoPortal, somarDias as somarDoPortal } from "@/hospede/portal";
import { hojeISO, instanteLocal, somarDias } from "./datas";

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
});
