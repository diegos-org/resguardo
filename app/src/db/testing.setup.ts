/**
 * `globalSetup` do Vitest: gera o retrato do banco migrado uma única vez, antes de os arquivos de
 * teste começarem (senão os primeiros arquivos, em paralelo, gerariam cada um o seu).
 */
import { prepararBancoDeTeste } from "./testing";

export async function setup(): Promise<void> {
  await prepararBancoDeTeste();
}
