import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { HorariosReserva, RegistroHorario } from "@/reservas/horarios";
import { Horarios } from "./Horarios";
vi.mock("@/reservas/horarios-acoes", () => ({ alterarHorarioAcao: vi.fn() }));
const registro: RegistroHorario = { id: "pedido-ficticio", hora: "13:30", canal: "Airbnb", referencia: "pedido fictício", registradoEm: "2026-10-01T10:00:00Z",
  registradoPor: "equipe", imovelId: "imovel", checkin: "2026-10-02", checkout: "2026-10-04", confirmacaoReserva: 1 };
const horarios: HorariosReserva = { versao: 1, entrada: { pedido: registro }, saida: {}, confirmacoes: 1 };
it("pedido é mostrado como pendente e exige referência e aceite para confirmar", () => {
  const h = renderToStaticMarkup(<Horarios id="reserva" horarios={horarios} editar vigentes={{ entrada: false, saida: false }} />);
  expect(h).toContain("Pedido pendente: 13:30");
  expect(h).toContain("Ainda não altera o horário da agenda");
  expect(h).toContain('name="referencia" required=""');
  expect(h).toContain('type="checkbox" required="" name="aceite"');
  expect(h).toContain("Canal do aceite");
  expect(h).toContain("Registrar acordo confirmado");
  // O horário pedido se digita como 15:00 (M7.22): campo de texto, nunca o nativo, que mostra AM/PM em inglês.
  expect(h).not.toContain('type="time"');
  const campo = h.match(/<input [^>]*name="hora"[^>]*\/>/)?.[0] ?? "";
  for (const a of ['type="text"', 'placeholder="15:00"', 'required=""']) expect(campo, a).toContain(a);
});
it("sem edição não oferece formulários de mutação", () => {
  const h = renderToStaticMarkup(<Horarios id="reserva" horarios={horarios} editar={false} vigentes={{ entrada: false, saida: false }} />);
  expect(h).not.toContain("<form");
});
it("acordo inválido fica explícito na ficha", () => {
  const h = renderToStaticMarkup(<Horarios id="reserva" horarios={{ ...horarios, entrada: { acordo: registro } }} editar vigentes={{ entrada: false, saida: false }} />);
  expect(h).toContain("Este acordo precisa de reconfirmação");
  expect(h).toContain("Revogar acordo");
});
