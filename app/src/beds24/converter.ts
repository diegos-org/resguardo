/**
 * Reserva do Beds24 → dados de reserva SCL (usado pela sincronização do M3.3).
 * O imóvel vem do mapeamento de IDs externos (canal "beds24": ID = propertyId, detalhe =
 * roomId). Sem mapeamento → divergência, nunca um imóvel adivinhado.
 */
import type { Canal, OrigemReserva } from "@/db/schema";
import type { Db } from "@/db/types";
import { resolverImovel } from "@/canais/ids-externos";
import type { DadosReserva } from "@/reservas/regras";
import type { Divergencia, ReservaBeds24 } from "./tipos";

const ORIGEM: Record<ReservaBeds24["canal"], OrigemReserva> = { airbnb: "airbnb", booking: "booking", direta: "direta", outro: "outro" };

/** Bloqueio do Beds24 não é reserva: fica de fora (vira bloqueio no M3.3). */
export function paraDadosReserva(r: ReservaBeds24, imovelId: string): DadosReserva | null {
  if (r.estado === "bloqueio") return null;
  return {
    imovelId,
    origem: ORIGEM[r.canal],
    estado: r.estado,
    reservadaEm: r.reservadaEm ? new Date(r.reservadaEm) : null,
    checkin: r.checkin,
    checkout: r.checkout,
    hospedes: r.hospedes !== null && r.hospedes <= 50 ? r.hospedes : null,
    hospedeNome: r.nome,
    hospedeEmail: r.email,
    hospedeTelefone: r.telefone,
    hospedeOrigem: "",
    moeda: "BRL",
    valorBruto: r.valorBruto,
    taxaCanal: r.comissaoCanal,
    valorLiquido: null,
    codigoCanal: r.codigoCanal,
    observacoes: "",
  };
}

export type ReservaConvertida = { idFonte: string; dados: DadosReserva };

/** Converte um lote: devolve o que dá para sincronizar e as divergências (sem imóvel mapeado etc.). */
export async function converterLote(
  db: Db,
  organizacaoId: string,
  reservas: readonly ReservaBeds24[],
): Promise<{ prontas: ReservaConvertida[]; bloqueios: ReservaBeds24[]; divergencias: Divergencia[] }> {
  const prontas: ReservaConvertida[] = [];
  const bloqueios: ReservaBeds24[] = [];
  const divergencias: Divergencia[] = [];
  const cache = new Map<string, string | null>();
  for (const r of reservas) {
    const chave = `${r.propertyId}/${r.roomId}`;
    if (!cache.has(chave)) cache.set(chave, await resolverImovel(db, organizacaoId, "beds24" satisfies Canal, r.propertyId, r.roomId));
    const imovelId = cache.get(chave);
    if (!imovelId) {
      divergencias.push({ origem: "reserva", id: r.idExterno, motivo: `imóvel do Beds24 ${chave} sem mapeamento no SCL` });
      continue;
    }
    if (r.estado === "bloqueio") {
      bloqueios.push(r);
      continue;
    }
    prontas.push({ idFonte: r.idExterno, dados: paraDadosReserva(r, imovelId)! });
  }
  return { prontas, bloqueios, divergencias };
}

