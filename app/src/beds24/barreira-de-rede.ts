/**
 * Barreira de rede dos testes (M8.3, desenho 2.2): a sessão de desenvolvimento pode ter a credencial REAL do Beds24 no
 * ambiente, então nenhum teste pode chegar a `beds24.com` nem a um subdomínio dele (`api.beds24.com`, `wiki.beds24.com`).
 * O `setupFiles` do Vitest (`barreira-de-rede.setup.ts`) troca o `fetch` global por este, que recusa essas URLs e deixa
 * o resto como estava. Os testes que simulam a rede injetam o próprio `fetch` (ou trocam o global), e seguem iguais.
 *
 * A recusa é dupla: a chamada lança um erro e fica registrada, e o `afterEach` do setup derruba o teste mesmo que o
 * código testado tenha engolido o erro (uma falha de rede tratada não pode passar em silêncio).
 */

/** É do Beds24? (`beds24.com` ou qualquer subdomínio, sem diferença de maiúsculas). URL que não dá para ler conta como sim. */
export function urlDoBeds24(entrada: unknown): boolean {
  let texto: string;
  if (typeof entrada === "string") texto = entrada;
  else if (entrada instanceof URL) texto = entrada.href;
  else if (typeof Request !== "undefined" && entrada instanceof Request) texto = entrada.url;
  else texto = String(entrada);
  let host: string;
  try {
    host = new URL(texto).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    // Endereço relativo ou torto: só passa se nem menciona o Beds24.
    return /beds24\.com/i.test(texto);
  }
  return host === "beds24.com" || host.endsWith(".beds24.com");
}

/** As tentativas recusadas nesta rodada (no `globalThis`: o setup e o teste enxergam a mesma lista). */
const CHAVE = Symbol.for("scl.barreiraDeRede.beds24");
type Registro = { tentativas: string[] };
function registro(): Registro {
  const g = globalThis as typeof globalThis & { [CHAVE]?: Registro };
  g[CHAVE] ??= { tentativas: [] };
  return g[CHAVE];
}

export const tentativasBloqueadas = (): readonly string[] => registro().tentativas;
/** Esvazia a lista (o `afterEach` do setup, e o teste da própria barreira depois de conferir). */
export const limparTentativasBloqueadas = () => {
  registro().tentativas.length = 0;
};

/**
 * A verificação do `afterEach` do setup: esvazia a lista e, se houve tentativa nesta rodada (mesmo com o erro engolido pelo
 * código testado), lança. Exportada para o próprio teste da barreira conferir a mensagem e a limpeza.
 */
export function verificarTentativasBloqueadas(): void {
  const tentativas = [...registro().tentativas];
  limparTentativasBloqueadas();
  if (tentativas.length) throw new Error(`Teste tentou acessar o Beds24 pela rede (${tentativas.join(", ")}). Use a versão falsa (beds24/falso.ts) ou um fetch simulado.`);
}

export class RedeBloqueadaNoTeste extends Error {
  constructor(url: string) {
    super(`Teste tentou acessar o Beds24 pela rede (${url}). Use a versão falsa (beds24/falso.ts) ou um fetch simulado.`);
    this.name = "RedeBloqueadaNoTeste";
  }
}

const MARCA = Symbol.for("scl.barreiraDeRede.fetch");
/** O `fetch` já é o da barreira (o setup não embrulha duas vezes). */
export const temBarreira = (f: unknown): boolean => typeof f === "function" && (f as unknown as Record<symbol, unknown>)[MARCA] === true;

/** O `fetch` com a barreira: URL do Beds24 lança e fica registrada (só o host vai para a mensagem); o resto vai ao `original`. */
export function fetchComBarreira(original: typeof fetch): typeof fetch {
  const f = ((entrada: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (urlDoBeds24(entrada)) {
      let host = "endereço do Beds24";
      try {
        host = new URL(typeof Request !== "undefined" && entrada instanceof Request ? entrada.url : String(entrada)).host;
      } catch {
        // fica o texto genérico
      }
      registro().tentativas.push(host);
      return Promise.reject(new RedeBloqueadaNoTeste(host));
    }
    return original(entrada, init);
  }) as typeof fetch;
  Object.defineProperty(f, MARCA, { value: true });
  return f;
}
