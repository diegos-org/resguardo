import { randomInt } from "node:crypto";
import { ORIGENS_RESERVA, type EstadoReserva, type OrigemReserva } from "@/db/schema";

/** Regras puras de reservas. Datas "AAAA-MM-DD"; checkout/fim são exclusivos (dia de saída). */

export const NOMES_ORIGEM: Record<OrigemReserva, string> = {
  airbnb: "Airbnb",
  booking: "Booking.com",
  site: "Site",
  direta: "Direta",
  outro: "Outro",
};

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

/** Pares de reservas ativas (não canceladas) do mesmo imóvel que se sobrepõem — overbooking. */
export function conflitos(lista: readonly ReservaParaConflito[]): [string, string][] {
  const ativas = lista.filter((r) => r.estado !== "cancelada").sort((a, b) => a.checkin.localeCompare(b.checkin));
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

export type DadosReserva = {
  imovelId: string;
  origem: OrigemReserva;
  estado: EstadoReserva;
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
  codigoCanal: string;
  observacoes: string;
};

export type ErrosReserva = Partial<Record<keyof DadosReserva | "geral", string>>;

const centavosOk = (v: number | null) => v === null || (Number.isSafeInteger(v) && v >= 0);

/** Valida dados já tipados (vindos de formulário, CSV ou Beds24). */
export function validarReserva(d: DadosReserva): ErrosReserva {
  const erros: ErrosReserva = {};
  if (!ORIGENS_RESERVA.includes(d.origem)) erros.origem = "Origem inválida.";
  if (!dataValida(d.checkin)) erros.checkin = "Data de entrada inválida.";
  if (!dataValida(d.checkout)) erros.checkout = "Data de saída inválida.";
  if (!erros.checkin && !erros.checkout && d.checkout <= d.checkin) erros.checkout = "A saída deve ser depois da entrada.";
  if (!erros.checkin && !erros.checkout && noites(d.checkin, d.checkout) > 365) erros.checkout = "Estadia acima de 365 noites.";
  if (d.hospedes !== null && (!Number.isInteger(d.hospedes) || d.hospedes < 1 || d.hospedes > 50)) erros.hospedes = "Entre 1 e 50 hóspedes.";
  for (const campo of ["valorBruto", "taxaCanal", "valorLiquido"] as const) {
    if (!centavosOk(d[campo])) erros[campo] = "Valor em centavos, inteiro e não negativo.";
  }
  if (!/^[A-Z]{3}$/.test(d.moeda)) erros.moeda = "Moeda com 3 letras (ex.: BRL).";
  return erros;
}
