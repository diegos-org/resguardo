/**
 * Apoio aos testes (M4.10): registra o recebimento que falta para a parte do proprietário de uma
 * reserva ficar disponível (o dinheiro "com a empresa"). Só testes importam daqui.
 */
import type { Db } from "@/db/types";
import { recebidoPorReserva, registrarRecebimento } from "./recebimentos";

export async function receberTudo(db: Db, org: string, reservaId: string, data: string): Promise<void> {
  const d = (await recebidoPorReserva(db, org, [reservaId])).get(reservaId);
  if (!d || d.devido - d.recebido <= 0) return;
  const r = await registrarRecebimento(db, org, { reservaId, data, valor: d.devido - d.recebido, nota: "teste" }, null, data);
  if (!r.ok) throw new Error(r.erro);
}
