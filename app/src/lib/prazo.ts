/** Quanto uma tela do painel espera, no máximo, por um serviço de fora (Mercado Pago, por exemplo) antes de seguir sem ele. */
export const ESPERA_TELA_MS = 2_000;

/**
 * Espera `p` no máximo `ms`; passou disso, devolve `aoEsgotar` e segue (a promessa continua no fundo, e quem a criou
 * cuida do resultado — ex.: a conferência da conta de teste fica lembrada para a próxima vez). Para telas que nunca
 * podem ficar presas a um serviço lento.
 */
export async function esperarNoMaximo<T, F>(p: Promise<T>, ms: number, aoEsgotar: F): Promise<T | F> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<F>((r) => {
    relogio = setTimeout(() => r(aoEsgotar), ms);
  });
  try {
    return await Promise.race([p, limite]);
  } finally {
    clearTimeout(relogio);
  }
}
