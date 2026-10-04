/**
 * Trava por reserva do motor financeiro (M4.10, 2ª rodada do Codex): quem recalcula a reserva
 * (`aplicarMotor`) e quem reúne as partes dela num repasse travam a MESMA chave, dentro da
 * transação. Assim um repasse nunca é gerado sobre uma parte que o motor está estornando no
 * mesmo instante, e o motor nunca mexe numa parte enquanto ela está sendo vinculada.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db/types";

export const chaveTravaMotor = (organizacaoId: string, reservaId: string) => `motor:${organizacaoId}:${reservaId}`;

/** Trava a reserva até o fim da transação (espera se outra transação já a tem). */
export async function travarMotorDaReserva(tx: Db, organizacaoId: string, reservaId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${chaveTravaMotor(organizacaoId, reservaId)}))`);
}

/**
 * Lê um resultado que depende de partes de reservas, trava as reservas que apareceram (em ordem,
 * para não haver impasse) e relê: o que vale é a leitura feita com as reservas travadas. Repete
 * enquanto a releitura trouxer reserva nova; depois de algumas voltas sem estabilizar, devolve
 * null (quem chama avisa e pede para tentar de novo).
 */
export async function lerComReservasTravadas<T>(tx: Db, organizacaoId: string, ler: () => Promise<T>, reservasDe: (resultado: T) => string[]): Promise<T | null> {
  const travadas = new Set<string>();
  let atual = await ler();
  for (let volta = 0; volta < 5; volta++) {
    const novas = [...new Set(reservasDe(atual))].filter((id) => !travadas.has(id)).sort();
    if (!novas.length) return atual;
    for (const id of novas) {
      await travarMotorDaReserva(tx, organizacaoId, id);
      travadas.add(id);
    }
    atual = await ler();
  }
  return null;
}
