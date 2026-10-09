/** Violação de índice único do Postgres (código 23505), vinda direto ou embrulhada pelo Drizzle. */
export function violouUnicidade(erro: unknown, indice?: string): boolean {
  for (let e: unknown = erro, i = 0; e && i < 5; e = (e as { cause?: unknown }).cause, i++) {
    const pg = e as { code?: unknown; constraint?: unknown; message?: unknown };
    if (pg.code === "23505") {
      if (!indice) return true;
      return pg.constraint === indice || (typeof pg.message === "string" && pg.message.includes(indice));
    }
  }
  return false;
}

/** Trava não obtida dentro do `lock_timeout` (código 55P03), vinda direto ou embrulhada pelo Drizzle. */
export function travaOcupada(erro: unknown): boolean {
  for (let e: unknown = erro, i = 0; e && i < 5; e = (e as { cause?: unknown }).cause, i++) {
    if ((e as { code?: unknown }).code === "55P03") return true;
  }
  return false;
}
