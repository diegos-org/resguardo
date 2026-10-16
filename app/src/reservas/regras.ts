import { randomInt } from "node:crypto";
import { ESTADOS_RESERVA, ORIGENS_RESERVA, RECEBIMENTOS_RESERVA, type EstadoReserva, type OrigemReserva, type RecebimentoReserva } from "@/db/schema";

/** Regras puras de reservas. Datas "AAAA-MM-DD"; checkout/fim são exclusivos (dia de saída). */

export const NOMES_RECEBIMENTO: Record<RecebimentoReserva, string> = {
  split: "Canal paga o proprietário direto (split)",
  empresa: "Empresa recebe tudo e repassa",
};

export const NOMES_ORIGEM: Record<OrigemReserva, string> = {
  airbnb: "Airbnb",
  booking: "Booking.com",
  site: "Site",
  direta: "Direta (WhatsApp, indicação)",
  outro: "Outro",
};

export const NOMES_ESTADO: Record<EstadoReserva, string> = { pendente: "Pendente", confirmada: "Confirmada", cancelada: "Cancelada", consulta: "Consulta", pedido: "Pedido de reserva" };

export function dataValida(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().startsWith(d);
}

export function noites(checkin: string, checkout: string): number {
  return Math.round((Date.parse(`${checkout}T00:00:00Z`) - Date.parse(`${checkin}T00:00:00Z`)) / 86_400_000);
}

/** Dois períodos [inicio, fim) se cruzam? Checkout num dia e check-in no mesmo dia não conflitam. */
export function periodosCruzam(a: { inicio: string; fim: string }, b: { inicio: string; fim: string }): boolean {
  return a.inicio < b.fim && b.inicio < a.fim;
}

export type ReservaParaConflito = { id: string; imovelId: string; checkin: string; checkout: string; estado: EstadoReserva };

/** Consulta não ocupa datas. Pedidos mantêm a restrição anterior até confirmação/cancelamento. */
export const ESTADOS_OCUPANTES = ["confirmada", "pendente", "pedido"] as const;
export function ocupaInventario(estado: EstadoReserva): boolean {
  return (ESTADOS_OCUPANTES as readonly EstadoReserva[]).includes(estado);
}

/** Pares de reservas ativas (que ocupam inventário) do mesmo imóvel que se sobrepõem — overbooking. */
export function conflitos(lista: readonly ReservaParaConflito[]): [string, string][] {
  const ativas = lista.filter((r) => ocupaInventario(r.estado)).sort((a, b) => a.checkin.localeCompare(b.checkin));
  const pares: [string, string][] = [];
  for (let i = 0; i < ativas.length; i++) {
    for (let j = i + 1; j < ativas.length; j++) {
      const a = ativas[i];
      const b = ativas[j];
      if (b.checkin >= a.checkout) break; // ordenado por check-in: os próximos também não cruzam
      if (a.imovelId === b.imovelId && periodosCruzam({ inicio: a.checkin, fim: a.checkout }, { inicio: b.checkin, fim: b.checkout })) {
        pares.push([a.id, b.id]);
      }
    }
  }
  return pares;
}

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I
/** Código público curto, ex.: SCL-7K2QXM. Não serve como senha/credencial. */
export function gerarCodigo(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += ALFABETO[randomInt(ALFABETO.length)];
  return `SCL-${s}`;
}

/** Um código no formato de `gerarCodigo` (mesmo alfabeto), sem nada em volta. */
export const ehCodigoDeReserva = (t: string): boolean => new RegExp(`^SCL-[${ALFABETO}]{6}$`).test(t);

/**
 * Os códigos no formato de `gerarCodigo` que aparecem soltos num texto (ex.: o nome ou a nota de um registro do Beds24,
 * M8.3), sem repetição e na ordem em que aparecem. Grudado em outra letra ou número não conta.
 */
export function codigosDeReservaNoTexto(t: string): string[] {
  return [...new Set(t.match(new RegExp(`\\bSCL-[${ALFABETO}]{6}\\b`, "g")) ?? [])];
}

export type DadosReserva = {
  imovelId: string;
  origem: OrigemReserva;
  estado: EstadoReserva;
  reservadaEm?: Date | null;
  checkin: string;
  checkout: string;
  hospedes: number | null;
  hospedeNome: string;
  hospedeEmail: string;
  hospedeTelefone: string;
  hospedeOrigem: string;
  moeda: string;
  valorBruto: number | null;
  taxaCanal: number | null;
  valorLiquido: number | null;
  /** Omitido = mantém o que já estava gravado (sincronização). */
  recebimento?: RecebimentoReserva | null;
  codigoCanal: string;
  observacoes: string;
};

export type ErrosReserva = Partial<Record<keyof DadosReserva | "geral", string>>;

/** Limite das colunas integer do Postgres (≈ R$ 21 milhões). */
export const CENTAVOS_MAXIMO = 2_147_483_647;
const centavosOk = (v: number | null) => v === null || (Number.isSafeInteger(v) && v >= 0 && v <= CENTAVOS_MAXIMO);

/** Valida dados já tipados (vindos de formulário, CSV ou Beds24). */
export function validarReserva(d: DadosReserva): ErrosReserva {
  const erros: ErrosReserva = {};
  if (!ESTADOS_RESERVA.includes(d.estado)) erros.estado = "Situação inválida.";
  if (d.reservadaEm != null && (!(d.reservadaEm instanceof Date) || !Number.isFinite(d.reservadaEm.getTime()))) erros.reservadaEm = "Data original inválida.";
  if (!ORIGENS_RESERVA.includes(d.origem)) erros.origem = "Origem inválida.";
  if (!dataValida(d.checkin)) erros.checkin = "Data de entrada inválida.";
  if (!dataValida(d.checkout)) erros.checkout = "Data de saída inválida.";
  if (!erros.checkin && !erros.checkout && d.checkout <= d.checkin) erros.checkout = "A saída deve ser depois da entrada.";
  if (!erros.checkin && !erros.checkout && noites(d.checkin, d.checkout) > 365) erros.checkout = "Estadia acima de 365 noites.";
  if (d.hospedes !== null && (!Number.isInteger(d.hospedes) || d.hospedes < 1 || d.hospedes > 50)) erros.hospedes = "Entre 1 e 50 hóspedes.";
  for (const campo of ["valorBruto", "taxaCanal", "valorLiquido"] as const) {
    if (!centavosOk(d[campo])) erros[campo] = "Valor inválido: precisa ser positivo e até R$ 21 milhões.";
  }
  if (d.recebimento != null && !RECEBIMENTOS_RESERVA.includes(d.recebimento)) erros.recebimento = "Forma de recebimento inválida.";
  if (!/^[A-Z]{3}$/.test(d.moeda)) erros.moeda = "Moeda com 3 letras (ex.: BRL).";
  return erros;
}

