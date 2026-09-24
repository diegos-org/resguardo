/**
 * Envio de e-mail atrás de um adaptador trocável (M1.3).
 * - `CorreioMemoria`: testes e desenvolvimento (guarda as mensagens, não envia nada).
 * - `CorreioResend`: provedor real, ligado só quando RESEND_API_KEY e EMAIL_REMETENTE
 *   existem no ambiente. O provedor definitivo é decisão do Diego (M11.2); trocar é
 *   escrever outro adaptador com o mesmo formato.
 */
import { createHash } from "node:crypto";

export type Mensagem = {
  para: string;
  assunto: string;
  texto: string;
  /** Chave de idempotência: o provedor ignora um segundo envio com a mesma chave (ex.: nova tentativa). */
  chave?: string;
};

/** Chave de idempotência com tamanho fixo: hash da chave inteira (cortar poderia juntar e-mails diferentes). */
export function chaveIdempotencia(chave: string): string {
  return createHash("sha256").update(chave).digest("hex");
}

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

/**
 * Falha em que não dá para saber se o e-mail saiu (conexão caiu, erro do provedor). Quem envia
 * não deve tratar como recusa: repetir com a mesma chave de idempotência é o seguro.
 */
export class ErroEnvioIncerto extends Error {}

export class CorreioResend implements Correio {
  readonly nome = "resend";
  constructor(
    private readonly chave: string,
    private readonly remetente: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async enviar(m: Mensagem) {
    let r: Response;
    try {
      r = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.chave}`, "Content-Type": "application/json", ...(m.chave ? { "Idempotency-Key": chaveIdempotencia(m.chave) } : {}) },
        body: JSON.stringify({ from: this.remetente, to: [m.para], subject: m.assunto, text: m.texto }),
        // Não fica pendurada: sem resposta em 50s, vira envio incerto.
        signal: AbortSignal.timeout(50_000),
      });
    } catch (e) {
      // A conexão caiu sem resposta: o provedor pode ter recebido.
      throw new ErroEnvioIncerto(`Sem resposta do provedor de e-mail (${e instanceof Error ? e.message : String(e)}).`);
    }
    // 5xx: erro do lado do provedor, que pode ou não ter aceitado. 4xx: recusado com certeza.
    if (r.status >= 500) throw new ErroEnvioIncerto(`Falha ao enviar e-mail (HTTP ${r.status}).`);
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
