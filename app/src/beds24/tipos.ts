/**
 * Beds24 (M3.2/M3.7) — tipos INTERNOS, já normalizados. O resto do sistema só enxerga isto;
 * o formato da API fica isolado em `http.ts`. A única escrita é a do calendário (preço,
 * mínimo/máximo e bloqueio por noite — M3.7), atrás de `BEDS24_ESCRITA=ligada`. Criar
 * reserva no Beds24 continua sendo o M8.3, com autorização explícita.
 */
export type EstadoBeds24 = "confirmada" | "pendente" | "cancelada" | "bloqueio" | "consulta" | "pedido";
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
  reservadaEm?: string | null;
};

export type DiaCalendario = {
  roomId: string;
  data: string;
  /** Unidades livres; null = o Beds24 não informou (NUNCA tratar como disponível). */
  livres: number | null;
  /** Centavos; null = sem preço informado. */
  preco: number | null;
  minimoNoites: number | null;
  maximoNoites: number | null;
  /** `override` do calendário ("none", "blackout", "noCheckIn"…); null = não informado. */
  bloqueio: string | null;
};

export type QuartoBeds24 = { propertyId: string; roomId: string; nome: string; moeda?: string };

/** Linha recebida que não passou na validação: nunca vira dado, vira divergência. */
export type Divergencia = { origem: "reserva" | "calendario" | "quarto"; id: string; motivo: string };

export type Lido<T> = { itens: T[]; divergencias: Divergencia[]; lidoEm: string };

export type FiltroReservas = { chegadaDe?: string; chegadaAte?: string; saidaDe?: string; ids?: string[]; modificadasDesde?: string; propertyIds?: string[] };
export type FiltroCalendario = { roomIds: string[]; inicio: string; fim: string };

/** Contrato de leitura. Implementações: HTTP (real) e falsa (testes/desenvolvimento). */
export interface LeitorBeds24 {
  reservas(f: FiltroReservas): Promise<Lido<ReservaBeds24>>;
  calendario(f: FiltroCalendario): Promise<Lido<DiaCalendario>>;
  quartos(): Promise<Lido<QuartoBeds24>>;
}

/** Bloqueio por noite enviado ao Beds24: "blackout" fecha a noite; "none" reabre o que o SCL fechou. */
export type BloqueioEnvio = "blackout" | "none";
/** Faixa de noites [from, to] (inclusive) com os mesmos valores. Campo ausente = não alterar. */
export type FaixaEnvio = { from: string; to: string; preco?: number; minimo?: number; maximo?: number; bloqueio?: BloqueioEnvio };
export type EnvioCalendario = { roomId: string; faixas: FaixaEnvio[] };
export type ResultadoEscrita = { roomId: string; ok: boolean; erro: string };

/**
 * Contrato de escrita (M3.7): só o calendário por noite. Nunca cria/altera reservas.
 * Só sai do ambiente com `BEDS24_ESCRITA=ligada` (ver `escritorDoAmbiente`).
 */
export interface EscritorBeds24 {
  escreverCalendario(itens: EnvioCalendario[]): Promise<ResultadoEscrita[]>;
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

