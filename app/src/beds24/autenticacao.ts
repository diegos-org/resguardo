import { ErroBeds24 } from "./tipos";
import { diagnosticarFalhaBeds24 } from "./diagnostico";

/** GET sem cache persistente nem redirecionamento de cabeçalhos com segredos. */
export async function buscarBeds24(fetchImpl: typeof fetch, url: URL, headers: Record<string, string>, timeoutMs: number): Promise<Response> {
  const renovacao = Object.hasOwn(headers, "refreshToken");
  const credencial = renovacao ? headers.refreshToken : headers.token;
  // Falhas de construção do cabeçalho não são falhas de rede. Não alterar o
  // conteúdo silenciosamente nem devolver o valor que não passou na validação.
  if (!credencial || !/^[\x21-\x7E]+$/.test(credencial)) {
    const nome = renovacao ? "BEDS24_REFRESH_TOKEN" : "token de acesso";
    throw new ErroBeds24(`O ${nome} está vazio ou contém espaços, quebras de linha ou caracteres inválidos. Confira o valor salvo; cole somente o token em uma linha.`, "configuracao");
  }
  try {
    return await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json", ...headers },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
      redirect: "error",
    });
  } catch (e) {
    throw diagnosticarFalhaBeds24(e, renovacao);
  }
}

type Token = { valor: string; renovarEm: number };

/** Cache apenas em memória, por cliente/processo. Renovação compartilhada entre chamadas. */
export class AutenticacaoBeds24 {
  private token: Token | null = null;
  private renovando: Promise<string> | null = null;

  constructor(private readonly o: {
    refreshToken?: string;
    token?: string;
    fetchImpl: typeof fetch;
    baseUrl: string;
    timeoutMs: number;
    agora: () => Date;
  }) {
    if (!o.refreshToken && !o.token) {
      throw new ErroBeds24("Configure BEDS24_REFRESH_TOKEN (ou BEDS24_API_KEY para um token de acesso direto).", "configuracao");
    }
  }

  async obter(recusado?: string): Promise<string> {
    if (!this.o.refreshToken) return this.o.token!;
    // Um 401 atrasado não invalida um token que outra chamada já renovou.
    if (recusado && this.token?.valor === recusado) this.token = null;
    if (this.token && this.o.agora().getTime() < this.token.renovarEm) return this.token.valor;
    if (!this.renovando) {
      this.renovando = this.renovar().finally(() => { this.renovando = null; });
    }
    return this.renovando;
  }

  private async renovar(): Promise<string> {
    this.token = null;
    const inicio = this.o.agora().getTime();
    const resposta = await buscarBeds24(this.o.fetchImpl, new URL(this.o.baseUrl + "/authentication/token"), {
      refreshToken: this.o.refreshToken!,
    }, this.o.timeoutMs);
    if (!resposta.ok) {
      throw new ErroBeds24(`Beds24 recusou a renovação (HTTP ${resposta.status}). Confira o refresh token, sua validade e as restrições de acesso.`, "http");
    }
    let corpo: unknown;
    try { corpo = await resposta.json(); } catch {
      throw new ErroBeds24("Resposta de autenticação do Beds24 não é JSON.", "formato");
    }
    const c = corpo as { token?: unknown; expiresIn?: unknown; success?: unknown } | null;
    if (!c || Array.isArray(c) || typeof c !== "object" || c.success === false ||
      typeof c.token !== "string" || !c.token || /\s/.test(c.token) ||
      typeof c.expiresIn !== "number" || !Number.isSafeInteger(c.expiresIn) || c.expiresIn <= 0) {
      throw new ErroBeds24("Resposta de autenticação do Beds24 sem token ou validade válidos.", "formato");
    }
    // Usa expiresIn da resposta, não presume 24 horas. Antecipação de até 60 segundos.
    const duracao = c.expiresIn * 1000;
    const renovarEm = inicio + duracao - Math.min(60_000, duracao / 10);
    if (!Number.isSafeInteger(inicio + duracao) || renovarEm <= this.o.agora().getTime()) {
      throw new ErroBeds24("Token do Beds24 sem prazo útil de validade.", "formato");
    }
    this.token = { valor: c.token, renovarEm };
    return c.token;
  }
}
