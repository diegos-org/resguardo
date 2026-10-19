/**
 * Barreira de rede dos testes (M8.3, desenho 2.2; M10.1a): a sessão de desenvolvimento pode ter credenciais REAIS do
 * Beds24 e da Meta (WhatsApp) no ambiente, então nenhum teste pode chegar a `beds24.com` nem aos domínios da Meta
 * (`facebook.com`, `facebook.net`, `fbsbx.com`, `whatsapp.com`, `whatsapp.net`), nem a um subdomínio deles
 * (`api.beds24.com`, `graph.facebook.com`). O `setupFiles` do Vitest (`barreira-de-rede.setup.ts`) troca o `fetch` global
 * por este, que recusa essas URLs e deixa o resto como estava. Os testes que simulam a rede injetam o próprio `fetch` (ou
 * trocam o global), e seguem iguais. O arquivo fica aqui (e não numa pasta comum) para não mexer no `setupFiles` nem nos
 * outros itens que tocam a barreira.
 *
 * A recusa é dupla: a chamada lança um erro e fica registrada, e o `afterEach` do setup derruba o teste mesmo que o
 * código testado tenha engolido o erro (uma falha de rede tratada não pode passar em silêncio).
 */

/** Os serviços que nenhum teste alcança, numa lista só: o domínio e como a mensagem do erro chama o serviço. */
const BLOQUEADOS = [
  { dominio: "beds24.com", nome: "o Beds24", dica: "Use a versão falsa (beds24/falso.ts) ou um fetch simulado." },
  // Cobre graph.facebook.com (a API) e business.facebook.com.
  { dominio: "facebook.com", nome: "a Meta (WhatsApp)", dica: "Use um aviso fictício assinado ou um fetch simulado." },
  // O SDK do Embedded Signup (M10.1b).
  { dominio: "facebook.net", nome: "a Meta (WhatsApp)", dica: "Use um aviso fictício assinado ou um fetch simulado." },
  // lookaside.fbsbx.com (mídia).
  { dominio: "fbsbx.com", nome: "a Meta (WhatsApp)", dica: "Use um aviso fictício assinado ou um fetch simulado." },
  { dominio: "whatsapp.com", nome: "a Meta (WhatsApp)", dica: "Use um aviso fictício assinado ou um fetch simulado." },
  { dominio: "whatsapp.net", nome: "a Meta (WhatsApp)", dica: "Use um aviso fictício assinado ou um fetch simulado." },
] as const;

export type ServicoBloqueado = (typeof BLOQUEADOS)[number];
const BEDS24: ServicoBloqueado = BLOQUEADOS[0];

/** O endereço como texto (texto, URL ou Request). */
function textoDaEntrada(entrada: unknown): string {
  if (typeof entrada === "string") return entrada;
  if (entrada instanceof URL) return entrada.href;
  if (typeof Request !== "undefined" && entrada instanceof Request) return entrada.url;
  return String(entrada);
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Para endereço que não dá para ler: menciona algum dos domínios? */
const MENCOES = BLOQUEADOS.map((s) => ({ servico: s, re: new RegExp(escapar(s.dominio), "i") }));

/**
 * O serviço bloqueado do endereço: host igual ao domínio ou terminado em "." + domínio, sem diferença de maiúsculas e
 * sem o ponto final; null = passa. Endereço que não dá para ler (relativo ou torto) conta como bloqueado se só menciona
 * um dos domínios.
 */
export function servicoBloqueado(entrada: unknown): ServicoBloqueado | null {
  const texto = textoDaEntrada(entrada);
  let host: string;
  try {
    host = new URL(texto).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return MENCOES.find((m) => m.re.test(texto))?.servico ?? null;
  }
  return BLOQUEADOS.find((s) => host === s.dominio || host.endsWith(`.${s.dominio}`)) ?? null;
}

/** É do Beds24? (`beds24.com` ou qualquer subdomínio, sem diferença de maiúsculas). URL que não dá para ler conta como sim. */
export const urlDoBeds24 = (entrada: unknown): boolean => servicoBloqueado(entrada)?.dominio === "beds24.com";

/** As tentativas recusadas nesta rodada (no `globalThis`: o setup e o teste enxergam a mesma lista). */
const CHAVE = Symbol.for("scl.barreiraDeRede.beds24");
type Tentativa = { host: string; servico: ServicoBloqueado };
type Registro = { tentativas: Tentativa[] };
function registro(): Registro {
  const g = globalThis as typeof globalThis & { [CHAVE]?: Registro };
  g[CHAVE] ??= { tentativas: [] };
  return g[CHAVE];
}

/** Os hosts recusados nesta rodada, em texto. */
export const tentativasBloqueadas = (): readonly string[] => registro().tentativas.map((t) => t.host);
/** Esvazia a lista (o `afterEach` do setup, e o teste da própria barreira depois de conferir). */
export const limparTentativasBloqueadas = () => {
  registro().tentativas.length = 0;
};

/** "Teste tentou acessar <serviço> pela rede (<hosts>). <dica>" */
const mensagem = (servico: ServicoBloqueado, hosts: readonly string[]) => `Teste tentou acessar ${servico.nome} pela rede (${hosts.join(", ")}). ${servico.dica}`;

/**
 * A verificação do `afterEach` do setup: esvazia a lista e, se houve tentativa nesta rodada (mesmo com o erro engolido pelo
 * código testado), lança, com uma frase por serviço. Exportada para o próprio teste da barreira conferir a mensagem e a
 * limpeza.
 */
export function verificarTentativasBloqueadas(): void {
  const tentativas = [...registro().tentativas];
  limparTentativasBloqueadas();
  if (!tentativas.length) return;
  const porServico = new Map<string, { servico: ServicoBloqueado; hosts: string[] }>();
  for (const t of tentativas) {
    const g = porServico.get(t.servico.nome) ?? { servico: t.servico, hosts: [] };
    g.hosts.push(t.host);
    porServico.set(t.servico.nome, g);
  }
  throw new Error([...porServico.values()].map((g) => mensagem(g.servico, g.hosts)).join(" "));
}

export class RedeBloqueadaNoTeste extends Error {
  readonly servico: ServicoBloqueado;
  constructor(url: string, servico: ServicoBloqueado = BEDS24) {
    super(mensagem(servico, [url]));
    this.name = "RedeBloqueadaNoTeste";
    this.servico = servico;
  }
}

const MARCA = Symbol.for("scl.barreiraDeRede.fetch");
/** O `fetch` já é o da barreira (o setup não embrulha duas vezes). */
export const temBarreira = (f: unknown): boolean => typeof f === "function" && (f as unknown as Record<symbol, unknown>)[MARCA] === true;

/** O `fetch` com a barreira: URL de um serviço bloqueado lança e fica registrada (só o host vai para a mensagem); o resto vai ao `original`. */
export function fetchComBarreira(original: typeof fetch): typeof fetch {
  const f = ((entrada: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const servico = servicoBloqueado(entrada);
    if (servico) {
      let host = `endereço ${servico.nome.replace(/^o /, "do ").replace(/^a /, "da ")}`;
      try {
        host = new URL(textoDaEntrada(entrada)).host;
      } catch {
        // fica o texto genérico
      }
      registro().tentativas.push({ host, servico });
      return Promise.reject(new RedeBloqueadaNoTeste(host, servico));
    }
    return original(entrada, init);
  }) as typeof fetch;
  Object.defineProperty(f, MARCA, { value: true });
  return f;
}
