/**
 * Beds24 (M3.2) — tipos INTERNOS, já normalizados. O resto do sistema só enxerga isto;
 * o formato da API fica isolado em `http.ts`. Somente leitura: não existe operação de
 * escrita neste módulo (criar reserva no Beds24 é o M8.3, com autorização explícita).
 */
export type EstadoBeds24 = "confirmada" | "pendente" | "cancelada" | "bloqueio";
export type CanalBeds24 = "airbnb" | "booking" | "direta" | "outro";

export type ReservaBeds24 = {
  idExterno: string;
  propertyId: string;
  roomId: string;
  estado: EstadoBeds24;
  checkin: string;
  checkout: string;
  hospedes: number | null;
  nome: string;
  email: string;
  telefone: string;
  /** Centavos; null = não informado. */
  valorBruto: number | null;
  comissaoCanal: number | null;
  canal: CanalBeds24;
  /** Código no canal (ex.: HM… do Airbnb), quando vier. */
  codigoCanal: string;
  modificadoEm: string | null;
};

export type DiaCalendario = {
  roomId: string;
  data: string;
  /** Unidades livres; null = o Beds24 não informou (NUNCA tratar como disponível). */
  livres: number | null;
  /** Centavos; null = sem preço informado. */
  preco: number | null;
  minimoNoites: number | null;
};

export type QuartoBeds24 = { propertyId: string; roomId: string; nome: string };

/** Linha recebida que não passou na validação: nunca vira dado, vira divergência. */
export type Divergencia = { origem: "reserva" | "calendario" | "quarto"; id: string; motivo: string };

export type Lido<T> = { itens: T[]; divergencias: Divergencia[]; lidoEm: string };

export type FiltroReservas = { chegadaDe?: string; chegadaAte?: string; modificadasDesde?: string; propertyIds?: string[] };
export type FiltroCalendario = { roomIds: string[]; inicio: string; fim: string };

/** Contrato de leitura. Implementações: HTTP (real) e falsa (testes/desenvolvimento). */
export interface LeitorBeds24 {
  reservas(f: FiltroReservas): Promise<Lido<ReservaBeds24>>;
  calendario(f: FiltroCalendario): Promise<Lido<DiaCalendario>>;
  quartos(): Promise<Lido<QuartoBeds24>>;
}

export class ErroBeds24 extends Error {
  constructor(
    motivo: string,
    readonly tipo: "configuracao" | "rede" | "tempo" | "http" | "formato",
  ) {
    super(motivo);
    this.name = "ErroBeds24";
  }
}
