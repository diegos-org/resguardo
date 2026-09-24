/**
 * Cliente HTTP do Beds24 API v2 — SOMENTE LEITURA (só existe `GET` aqui).
 * Autenticação: cabeçalho `token` com a chave de longa duração em BEDS24_API_KEY
 * (configurada na Vercel/ambiente, nunca no Git).
 *
 * Endpoints e parâmetros seguem a documentação pública da API v2 (Swagger em
 * beds24.com/api/v2). Antes da sincronização real (M3.3), conferir com a conta do Diego:
 * nomes de campos, filtro de canceladas e paginação.
 */
import { normalizarCalendario, normalizarQuartos, normalizarReserva } from "./normalizar";
import { type DiaCalendario, ErroBeds24, type FiltroCalendario, type FiltroReservas, type LeitorBeds24, type Lido, type QuartoBeds24, type ReservaBeds24 } from "./tipos";

type Parametros = Record<string, string | string[] | undefined>;
type Opcoes = { token: string; fetchImpl?: typeof fetch; baseUrl?: string; timeoutMs?: number; maxPaginas?: number; agora?: () => Date };

export class ClienteBeds24Http implements LeitorBeds24 {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxPaginas: number;
  private readonly agora: () => Date;

  constructor(private readonly o: Opcoes) {
    if (!o.token) throw new ErroBeds24("Chave do Beds24 não configurada.", "configuracao");
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.baseUrl = (o.baseUrl ?? "https://beds24.com/api/v2").replace(/\/$/, "");
    this.timeoutMs = o.timeoutMs ?? 15_000;
    this.maxPaginas = o.maxPaginas ?? 50;
    this.agora = o.agora ?? (() => new Date());
  }

  /** Única forma de falar com o Beds24: GET, com tempo-limite. */
  private async get(caminho: string, params: Parametros): Promise<Record<string, unknown>> {
    const url = new URL(this.baseUrl + caminho);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, item);
    }
    let resposta: Response;
    try {
      resposta = await this.fetchImpl(url, { method: "GET", headers: { token: this.o.token, accept: "application/json" }, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      const tempo = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new ErroBeds24(tempo ? "Beds24 não respondeu a tempo." : "Falha de rede ao falar com o Beds24.", tempo ? "tempo" : "rede");
    }
    if (!resposta.ok) throw new ErroBeds24(`Beds24 respondeu HTTP ${resposta.status}.`, "http");
    let corpo: unknown;
    try {
      corpo = await resposta.json();
    } catch {
      throw new ErroBeds24("Resposta do Beds24 não é JSON.", "formato");
    }
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
    });
    return { ...normalizarCalendario(brutos, f.inicio, f.fim), lidoEm };
  }

  async quartos(): Promise<Lido<QuartoBeds24>> {
    const lidoEm = this.agora().toISOString();
    const brutos = await this.todas("/properties", { includeAllRooms: "true" });
    return { ...normalizarQuartos(brutos), lidoEm };
  }
}

/** Cliente do ambiente, ou null enquanto a chave não existir (M3.3 fica bloqueado). */
export function leitorDoAmbiente(env: NodeJS.ProcessEnv = process.env): LeitorBeds24 | null {
  return env.BEDS24_API_KEY ? new ClienteBeds24Http({ token: env.BEDS24_API_KEY }) : null;
}
