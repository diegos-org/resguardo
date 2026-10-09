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

/** Códigos de "trava não obtida": `lock_timeout` vencido (55P03) e impasse desfeito pelo Postgres (40P01). */
const TRAVA_NAO_OBTIDA = new Set(["55P03", "40P01"]);

/**
 * Trava não obtida, vinda direto ou embrulhada pelo Drizzle: o tempo-limite de espera passou (55P03) ou o Postgres
 * desfez um impasse abortando esta transação (40P01). Nos dois casos nada foi gravado e dá para tentar de novo.
 */
export function travaOcupada(erro: unknown): boolean {
  for (let e: unknown = erro, i = 0; e && i < 5; e = (e as { cause?: unknown }).cause, i++) {
    const codigo = (e as { code?: unknown }).code;
    if (typeof codigo === "string" && TRAVA_NAO_OBTIDA.has(codigo)) return true;
  }
  return false;
}
