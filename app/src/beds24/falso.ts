/**
 * Beds24 FALSO para testes e desenvolvimento: guarda registros no formato da API e passa
 * pela mesma normalização do cliente real. Nunca usa rede.
 */
import { normalizarCalendario, normalizarQuartos, normalizarReserva } from "./normalizar";
import type { DiaCalendario, FiltroCalendario, FiltroReservas, LeitorBeds24, Lido, QuartoBeds24, ReservaBeds24 } from "./tipos";

type Obj = Record<string, unknown>;

export class Beds24Falso implements LeitorBeds24 {
  bookings: Obj[] = [];
  calendarios: Obj[] = [];
  properties: Obj[] = [];
  /** Para simular falhas do serviço. */
  falhar: Error | null = null;
  chamadas = 0;

  constructor(private readonly agora: () => Date = () => new Date()) {}

  private checar() {
    this.chamadas++;
    if (this.falhar) throw this.falhar;
  }

  async reservas(f: FiltroReservas): Promise<Lido<ReservaBeds24>> {
    this.checar();
    const filtrados = this.bookings.filter((b) => {
      const chegada = String(b.arrival ?? "");
      if (f.chegadaDe && chegada < f.chegadaDe) return false;
      if (f.chegadaAte && chegada > f.chegadaAte) return false;
      if (f.saidaDe && String(b.departure ?? "") < f.saidaDe) return false;
      if (f.ids?.length && !f.ids.includes(String(b.id))) return false;
      if (f.modificadasDesde && String(b.modifiedTime ?? "") < f.modificadasDesde) return false;
      if (f.propertyIds?.length && !f.propertyIds.includes(String(b.propertyId))) return false;
      return true;
    });
    const itens: ReservaBeds24[] = [];
    const divergencias = [];
    for (const b of filtrados) {
      const n = normalizarReserva(b);
      if (n.ok) itens.push(n.r);
      else divergencias.push(n.d);
    }
    return { itens, divergencias, lidoEm: this.agora().toISOString() };
  }

  async calendario(f: FiltroCalendario): Promise<Lido<DiaCalendario>> {
    this.checar();
    const salas = this.calendarios.filter((c) => f.roomIds.includes(String(c.roomId)));
    return { ...normalizarCalendario(salas, f.inicio, f.fim), lidoEm: this.agora().toISOString() };
  }

  async quartos(): Promise<Lido<QuartoBeds24>> {
    this.checar();
    return { ...normalizarQuartos(this.properties), lidoEm: this.agora().toISOString() };
  }
}

