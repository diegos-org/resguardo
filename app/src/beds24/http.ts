/**
 * Cliente HTTP do Beds24 API v2. Leitura: GET. A única escrita é `escreverCalendario`
 * (POST /inventory/rooms/calendar — preço, mínimo/máximo e bloqueio por noite, M3.7), e só
 * sai do ambiente quando `BEDS24_ESCRITA=ligada` (`escritorDoAmbiente`). Reservas nunca
 * são criadas ou alteradas aqui (M8.3, com autorização explícita).
 *
 * BEDS24_REFRESH_TOKEN gera e renova o token de acesso. BEDS24_API_KEY continua
 * aceitando token direto (long life somente leitura), nunca convite/refresh token.
 *
 * Endpoints e parâmetros seguem a documentação pública da API v2 (Swagger em
 * beds24.com/api/v2). Antes da sincronização real (M3.3), conferir com a conta do Diego:
 * nomes de campos, filtro de canceladas e paginação.
 */
import { createHash } from "node:crypto";
import { AutenticacaoBeds24, buscarBeds24, type CorpoBeds24 } from "./autenticacao";
import { normalizarCalendario, normalizarQuartos, normalizarReserva } from "./normalizar";
import { type DiaCalendario, type EnvioCalendario, ErroBeds24, type EscritorBeds24, type FiltroCalendario, type FiltroReservas, type LeitorBeds24, type Lido, type QuartoBeds24, type ReservaBeds24, type ResultadoEscrita } from "./tipos";

type Parametros = Record<string, string | string[] | undefined>;
type Opcoes = { token?: string; refreshToken?: string; fetchImpl?: typeof fetch; baseUrl?: string; timeoutMs?: number; maxPaginas?: number; agora?: () => Date };

/** Centavos → reais com duas casas, como a API espera (nunca aritmética binária solta no JSON). */
export const centavosParaReaisApi = (c: number) => Number((c / 100).toFixed(2));

export class ClienteBeds24Http implements LeitorBeds24, EscritorBeds24 {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxPaginas: number;
  private readonly agora: () => Date;
  private readonly autenticacao: AutenticacaoBeds24;

  constructor(private readonly o: Opcoes) {
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.baseUrl = (o.baseUrl ?? "https://beds24.com/api/v2").replace(/\/$/, "");
    this.timeoutMs = o.timeoutMs ?? 15_000;
    this.maxPaginas = o.maxPaginas ?? 50;
    this.agora = o.agora ?? (() => new Date());
    this.autenticacao = new AutenticacaoBeds24({
      token: o.token, refreshToken: o.refreshToken,
      fetchImpl: this.fetchImpl, baseUrl: this.baseUrl, timeoutMs: this.timeoutMs, agora: this.agora,
    });
  }

  /** Chamada autenticada com tempo-limite; um 401 renova o token e repete uma única vez. */
  private async chamar(caminho: string, params: Parametros, corpo?: CorpoBeds24): Promise<unknown> {
    const url = new URL(this.baseUrl + caminho);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, item);
    }
    const token = await this.autenticacao.obter();
    let resposta = await buscarBeds24(this.fetchImpl, url, { token }, this.timeoutMs, corpo);
    if (resposta.status === 401 && this.o.refreshToken) {
      await resposta.body?.cancel();
      const renovado = await this.autenticacao.obter(token);
      // 403/429/5xx não provocam renovação.
      resposta = await buscarBeds24(this.fetchImpl, url, { token: renovado }, this.timeoutMs, corpo);
    }
    if (resposta.status === 403 && corpo) throw new ErroBeds24("Beds24 recusou a escrita (HTTP 403): a credencial não tem permissão de inventário. Gere um novo convite com escrita de inventário.", "http");
    if (!resposta.ok) throw new ErroBeds24(`Beds24 respondeu HTTP ${resposta.status}.`, "http");
    try {
      return await resposta.json();
    } catch {
      throw new ErroBeds24("Resposta do Beds24 não é JSON.", "formato");
    }
  }

  /** Leitura: objeto com `data` em lista. */
  private async get(caminho: string, params: Parametros): Promise<Record<string, unknown>> {
    const corpo = await this.chamar(caminho, params);
    if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) throw new ErroBeds24("Resposta do Beds24 em formato inesperado.", "formato");
    const c = corpo as Record<string, unknown>;
    if (c.success === false) throw new ErroBeds24("Beds24 recusou a consulta.", "http");
    if (!Array.isArray(c.data)) throw new ErroBeds24("Resposta do Beds24 sem lista de dados.", "formato");
    return c;
  }

  /** Segue a paginação (`pages.nextPageExists`) até o fim, com limite de páginas. */
  private async todas(caminho: string, params: Parametros): Promise<unknown[]> {
    const dados: unknown[] = [];
    for (let pagina = 1; ; pagina++) {
      if (pagina > this.maxPaginas) throw new ErroBeds24(`Mais de ${this.maxPaginas} páginas: consulta grande demais.`, "formato");
      const c = await this.get(caminho, { ...params, page: String(pagina) });
      dados.push(...(c.data as unknown[]));
      const pages = c.pages as { nextPageExists?: unknown } | undefined;
      if (pages?.nextPageExists !== true) return dados;
    }
  }

  async reservas(f: FiltroReservas): Promise<Lido<ReservaBeds24>> {
    const lidoEm = this.agora().toISOString();
    const brutos = await this.todas("/bookings", {
      arrivalFrom: f.chegadaDe,
      arrivalTo: f.chegadaAte,
      departureFrom: f.saidaDe,
      id: f.ids,
      status: ["confirmed", "new", "request", "inquiry", "black", "cancelled"],
      modifiedFrom: f.modificadasDesde,
      propertyId: f.propertyIds,
    });
    const itens: ReservaBeds24[] = [];
    const divergencias = [];
    for (const b of brutos) {
      const n = normalizarReserva(b);
      if (n.ok) itens.push(n.r);
      else divergencias.push(n.d);
    }
    return { itens, divergencias, lidoEm };
  }

  async calendario(f: FiltroCalendario): Promise<Lido<DiaCalendario>> {
    const lidoEm = this.agora().toISOString();
    if (!f.roomIds.length) return { itens: [], divergencias: [], lidoEm };
    const brutos = await this.todas("/inventory/rooms/calendar", {
      roomId: f.roomIds,
      startDate: f.inicio,
      endDate: f.fim,
      includePrices: "true",
      includeNumAvail: "true",
      includeMinStay: "true",
      includeMaxStay: "true",
      includeOverride: "true",
    });
    return { ...normalizarCalendario(brutos, f.inicio, f.fim), lidoEm };
  }

  async quartos(): Promise<Lido<QuartoBeds24>> {
    const lidoEm = this.agora().toISOString();
    const brutos = await this.todas("/properties", { includeAllRooms: "true" });
    return { ...normalizarQuartos(brutos), lidoEm };
  }

  /**
   * POST /inventory/rooms/calendar: um item por quarto, faixas inclusivas. A resposta é uma
   * lista na ordem enviada ({ success, errors }); qualquer formato diferente vira falha do
   * quarto — e a releitura (feita por quem chama) decide o que de fato ficou gravado.
   */
  async escreverCalendario(itens: EnvioCalendario[]): Promise<ResultadoEscrita[]> {
    if (!itens.length) return [];
    const corpo = itens.map(i => ({
      roomId: Number(i.roomId),
      calendar: i.faixas.map(f => ({
        from: f.from, to: f.to,
        ...(f.preco !== undefined ? { price1: centavosParaReaisApi(f.preco) } : {}),
        ...(f.minimo !== undefined ? { minStay: f.minimo } : {}),
        ...(f.maximo !== undefined ? { maxStay: f.maximo } : {}),
        ...(f.bloqueio !== undefined ? { override: f.bloqueio } : {}),
      })),
    }));
    const resposta = await this.chamar("/inventory/rooms/calendar", {}, { method: "POST", body: JSON.stringify(corpo) });
    const lista = Array.isArray(resposta) ? resposta : null;
    return itens.map((i, n) => {
      const r = lista?.[n];
      if (!r || typeof r !== "object" || Array.isArray(r)) return { roomId: i.roomId, ok: false, erro: "Resposta do Beds24 em formato inesperado; conferir pela releitura." };
      const o = r as { success?: unknown; errors?: unknown };
      if (o.success === true) return { roomId: i.roomId, ok: true, erro: "" };
      const erros = Array.isArray(o.errors) ? o.errors.map(e => (e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string" ? (e as { message: string }).message : "")).filter(Boolean) : [];
      return { roomId: i.roomId, ok: false, erro: (erros.join(" ") || "Beds24 recusou a escrita deste quarto.").slice(0, 300) };
    });
  }
}

let clienteDoProcesso: { refreshToken?: string; token?: string; cliente: ClienteBeds24Http } | null = null;

function credenciais(env: NodeJS.ProcessEnv) {
  const refreshToken = env.BEDS24_REFRESH_TOKEN?.trim() || undefined;
  const token = refreshToken ? undefined : env.BEDS24_API_KEY?.trim() || undefined;
  return { refreshToken, token };
}

/** Reutiliza o cliente/cache no processo; muda o cliente quando as credenciais mudam. */
export function leitorDoAmbiente(env: NodeJS.ProcessEnv = process.env): LeitorBeds24 | null {
  const { refreshToken, token } = credenciais(env);
  if (!refreshToken && !token) {
    clienteDoProcesso = null;
    return null;
  }
  if (!clienteDoProcesso || clienteDoProcesso.refreshToken !== refreshToken || clienteDoProcesso.token !== token) {
    clienteDoProcesso = { refreshToken, token, cliente: new ClienteBeds24Http({ refreshToken, token }) };
  }
  return clienteDoProcesso.cliente;
}

/** Limite total de rede por execução, além do timeout individual e da paginação. */
export function leitorParaSincronizacao(env: NodeJS.ProcessEnv = process.env): LeitorBeds24 | null {
  const { refreshToken, token } = credenciais(env);
  if (!refreshToken && !token) return null;
  const limite = AbortSignal.timeout(180_000);
  return new ClienteBeds24Http({ refreshToken, token, maxPaginas: 10, fetchImpl: (url, init) =>
    fetch(url, { ...init, signal: AbortSignal.any([limite, ...(init?.signal ? [init.signal] : [])]) }) });
}

/** O sinal de escrita só vale com o valor exato "ligada" — quem liga é o Diego, na Vercel. */
export const escritaBeds24Ligada = (env: NodeJS.ProcessEnv = process.env) => env.BEDS24_ESCRITA?.trim() === "ligada";

/** Há credencial para falar com o Beds24 (refresh token ou token direto). */
export const credencialBeds24Presente = (env: NodeJS.ProcessEnv = process.env) => {
  const { refreshToken, token } = credenciais(env);
  return Boolean(refreshToken || token);
};

/**
 * Impressão da credencial Beds24 do ambiente: o tipo (refresh token ou token direto) e um hash truncado do valor — identifica
 * "qual credencial" sem guardar a credencial (não dá para recuperá-la daqui). Vazia sem credencial. Cada envio grava a sua
 * na execução, e o portal só aceita o veredito de um envio feito com a credencial atual: trocar a credencial (outra conta
 * Beds24, por exemplo) invalida o veredito, porque o quarto acessível àquela pode não ser acessível a esta.
 */
export const impressaoCredencialBeds24 = (env: NodeJS.ProcessEnv = process.env): string => {
  const { refreshToken, token } = credenciais(env);
  const valor = refreshToken ?? token;
  if (!valor) return "";
  return `${refreshToken ? "refresh" : "token"}:${createHash("sha256").update(valor).digest("hex").slice(0, 16)}`;
};

/** A escrita realmente sai: sinal "ligada" E credencial — a régua única de `escritorDoAmbiente`, que o portal também lê. */
export const escritaBeds24Pronta = (env: NodeJS.ProcessEnv = process.env) => escritaBeds24Ligada(env) && credencialBeds24Presente(env);

/**
 * Escritor do calendário (M3.7): null sem credencial ou com `BEDS24_ESCRITA` diferente de
 * "ligada". Com o sinal desligado, nenhum caminho do sistema consegue escrever no Beds24.
 */
export function escritorDoAmbiente(env: NodeJS.ProcessEnv = process.env): EscritorBeds24 | null {
  if (!escritaBeds24Pronta(env)) return null;
  const { refreshToken, token } = credenciais(env);
  return new ClienteBeds24Http({ refreshToken, token, maxPaginas: 10, timeoutMs: 30_000 });
}
