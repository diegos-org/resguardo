/** Violação de índice único do Postgres (código 23505), vinda direto ou embrulhada pelo Drizzle. */
export function violouUnicidade(erro: unknown): boolean {
  for (let e: unknown = erro, i = 0; e && i < 5; e = (e as { cause?: unknown }).cause, i++) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}
