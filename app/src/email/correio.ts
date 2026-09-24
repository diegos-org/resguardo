/**
 * Envio de e-mail atrás de um adaptador trocável (M1.3).
 * - `CorreioMemoria`: testes e desenvolvimento (guarda as mensagens, não envia nada).
 * - `CorreioResend`: provedor real, ligado só quando RESEND_API_KEY e EMAIL_REMETENTE
 *   existem no ambiente. O provedor definitivo é decisão do Diego (M11.2); trocar é
 *   escrever outro adaptador com o mesmo formato.
 */
export type Mensagem = {
  para: string;
  assunto: string;
  texto: string;
  /** Chave de idempotência: o provedor ignora um segundo envio com a mesma chave (ex.: nova tentativa). */
  chave?: string;
};

export interface Correio {
  readonly nome: string;
  enviar(m: Mensagem): Promise<void>;
}

export class CorreioMemoria implements Correio {
  readonly nome = "memoria";
  readonly enviadas: Mensagem[] = [];
  constructor(private readonly mostrarNoConsole = false) {}
  async enviar(m: Mensagem) {
    this.enviadas.push(m);
    // Só em `next dev`: mostra o e-mail no terminal para quem está testando no computador.
    if (this.mostrarNoConsole) console.info(`[e-mail de desenvolvimento] para ${m.para}: ${m.assunto}\n${m.texto}`);
  }
}

export class CorreioResend implements Correio {
  readonly nome = "resend";
  constructor(
    private readonly chave: string,
    private readonly remetente: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async enviar(m: Mensagem) {
    const r = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.chave}`, "Content-Type": "application/json", ...(m.chave ? { "Idempotency-Key": m.chave.slice(0, 256) } : {}) },
      body: JSON.stringify({ from: this.remetente, to: [m.para], subject: m.assunto, text: m.texto }),
    });
    if (!r.ok) throw new Error(`Falha ao enviar e-mail (HTTP ${r.status}).`);
  }
}

let correioDev: CorreioMemoria | undefined;

/** Correio configurado no ambiente, ou null se não há como enviar (login por código desligado). */
export function correioDoAmbiente(env: NodeJS.ProcessEnv = process.env): Correio | null {
  if (env.RESEND_API_KEY && env.EMAIL_REMETENTE) return new CorreioResend(env.RESEND_API_KEY, env.EMAIL_REMETENTE);
  if (env.NODE_ENV === "development") return (correioDev ??= new CorreioMemoria(true));
  return null;
}
