/**
 * Beds24 (M3.2/M3.7) — tipos INTERNOS, já normalizados. O resto do sistema só enxerga isto;
 * o formato da API fica isolado em `http.ts`. A única escrita é a do calendário (preço,
 * mínimo/máximo e bloqueio por noite — M3.7), atrás de `BEDS24_ESCRITA=ligada`. Criar
 * reserva no Beds24 é o M8.3, atrás de uma chave própria (`BEDS24_ESCRITA_RESERVAS=ligada`,
 * `escritaReservasBeds24Pronta`); o M8.3a só lê (a marca do SCL e os escopos da credencial).
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
  /**
   * M8.3: o código da reserva do SCL (SCL-XXXXXX) que marca o registro como uma reserva paga pelo site criada pelo
   * sistema: o info item `SCL` ou, como reforço, o código solto no nome ou nas notas. null = sem marca legível (inclusive
   * quando a leitura não pediu os info items, ou quando há mais de um código e não dá para saber qual vale).
   */
  referenciaScl: string | null;
  /** M8.3: registro do ensaio do SCL (info item `SCL-ENSAIO`): nunca vira reserva nem bloqueio. */
  ensaio: boolean;
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

export type FiltroReservas = {
  chegadaDe?: string;
  chegadaAte?: string;
  saidaDe?: string;
  ids?: string[];
  modificadasDesde?: string;
  propertyIds?: string[];
  /** M8.3: só as reservas deste quarto (`roomId`). */
  quarto?: string;
  /**
   * M8.3: só as reservas com entrada neste dia (`arrivalFrom` = `arrivalTo`, explícitos: sem filtro de chegada, o Beds24
   * só devolve as reservas futuras). Vale no lugar de `chegadaDe`/`chegadaAte`.
   */
  chegadaExata?: string;
  /** M8.3: busca por texto do Beds24 (`searchString`), para achar a marca no nome. */
  pesquisa?: string;
  /** M8.3: pede os info items (`includeInfoItems=true`), onde mora a marca do SCL. Sem isto, `referenciaScl` só sai do nome ou das notas. */
  incluirInfo?: boolean;
};
export type FiltroCalendario = { roomIds: string[]; inicio: string; fim: string };

/** Contrato de leitura. Implementações: HTTP (real) e falsa (testes/desenvolvimento). */
export interface LeitorBeds24 {
  reservas(f: FiltroReservas): Promise<Lido<ReservaBeds24>>;
  calendario(f: FiltroCalendario): Promise<Lido<DiaCalendario>>;
  quartos(): Promise<Lido<QuartoBeds24>>;
}

/**
 * O que a credencial pode fazer (M8.3, prontidão; GET /authentication/details), só leitura. O formato dos escopos na
 * resposta ainda está "a confirmar" com o Beds24: o que não estiver no formato "nível:recurso" conhecido vai para
 * `ilegiveis` e nunca conta como em ordem.
 */
export type CredencialBeds24 = {
  /** Escopos lidos, em minúsculas (ex.: "read:bookings", "write:inventory"); null = a resposta não trouxe uma lista que dê para ler. */
  escopos: string[] | null;
  /** Itens da lista fora do formato conhecido (texto curto, só para mostrar na tela). */
  ilegiveis: string[];
  lidoEm: string;
};

/**
 * Leitura dos escopos da credencial (M8.3). Contrato à parte de `LeitorBeds24`: só a prontidão das reservas precisa dele.
 * Implementações: HTTP (real) e falsa.
 */
export interface LeitorCredencialBeds24 {
  credencial(): Promise<CredencialBeds24>;
}

/** Valores de `override` do calendário Beds24 que o SCL sabe ler e escrever. */
export const BLOQUEIOS_BEDS24 = ["none", "blackout", "exception", "noCheckIn", "noCheckOut", "noCheckInOrCheckOut"] as const;
/**
 * Bloqueio por noite enviado ao Beds24: "blackout" fecha a noite; "none" reabre o que o SCL fechou;
 * os demais devolvem a restrição que já existia no Beds24 antes do bloqueio do SCL.
 */
export type BloqueioEnvio = (typeof BLOQUEIOS_BEDS24)[number];
export const ehBloqueioEnvio = (b: unknown): b is BloqueioEnvio => typeof b === "string" && (BLOQUEIOS_BEDS24 as readonly string[]).includes(b);
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

