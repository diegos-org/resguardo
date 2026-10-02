import { expect, it } from "vitest";
import { instanteDaReserva } from "./normalizar";
it("normaliza instante explícito e recusa datas ambíguas/inválidas", () => {
  expect(instanteDaReserva("2026-10-01T23:30:00-03:00")).toBe("2026-10-02T02:30:00.000Z");
  for (const v of [null, undefined, "", "ontem", "2026-02-30T12:00:00Z", "2026-10-01", "2026-10-01T12:00:00"]) expect(instanteDaReserva(v)).toBeNull();
});
