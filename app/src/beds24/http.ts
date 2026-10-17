/**
 * Cliente HTTP do Beds24 API v2. Leitura: GET. Duas escritas, cada uma atrás da sua chave e
 * independentes nos dois sentidos:
 * - o calendário (`escreverCalendario`, POST /inventory/rooms/calendar — preço, mínimo/máximo e
 *   bloqueio por noite, M3.7), que só sai do ambiente quando `BEDS24_ESCRITA=ligada`
 *   (`escritorDoAmbiente`);
 * - as reservas pagas pelo site (`gravarReservas`, POST /bookings com um item por chamada:
 *   criar, atualizar e cancelar, nunca DELETE; M8.3c), que só existe na classe
 *   `ClienteReservasBeds24Http` e só sai do ambiente com a escrita de reservas pronta e o processo
 *   de produção (`clienteDeReservasDoAmbiente`). O cliente de reservas nunca escreve o calendário.
 *
 * BEDS24_REFRESH_TOKEN gera e renova o token de acesso. BEDS24_API_KEY continua
 * aceitando token direto (long life somente leitura), nunca convite/refresh token.
 *
 * Endpoints e parâmetros seguem a documentação pública da API v2 (Swagger em
 * beds24.com/api/v2). Antes da sincronização real (M3.3), conferir com a conta do Diego:
 * nomes de campos, filtro de canceladas e paginação.
 */
import { createHash } from "node:crypto";
import { deployDeProducao } from "@/sistema/ambiente";
import { AutenticacaoBeds24, buscarBeds24, type CorpoBeds24 } from "./autenticacao";
import { classificarGravacaoReserva, corpoDaGravacaoReserva, normalizarCalendario, normalizarCredencial, normalizarQuartos, normalizarReserva, respostaDaGravacao } from "./normalizar";
import {
  type CredencialBeds24, type DiaCalendario, type EnvioCalendario, ErroBeds24, type EscritorBeds24, type EscritorReservasBeds24, type FiltroCalendario, type FiltroReservas,
  type ItemGravacaoReserva, type LeitorBeds24, type LeitorCredencialBeds24, type Lido, type QuartoBeds24, type RespostaGravacaoReserva, type ReservaBeds24, type ResultadoEscrita,
} from "./tipos";

type Parametros = Record<string, string | string[] | undefined>;
type Opcoes = { token?: string; refreshToken?: string; fetchImpl?: typeof fetch; baseUrl?: string; timeoutMs?: number; maxPaginas?: number; agora?: () => Date };
/**
 * Uma chamada autenticada: a resposta (de qualquer status), ou a falha sem resposta — com a etapa, porque a falha do token
 * (o inicial, ou a renovação depois de um 401 que o Beds24 não processou) quer dizer que nada foi processado.
 */
type Requisicao = { ok: true; resposta: Response } | { ok: false; etapa: "token" | "pedido"; erro: unknown };

/** Tempo-limite do POST de reservas (M8.3c, desenho 9); as leituras ficam no tempo do cliente (15 s). */
export const TEMPO_GRAVACAO_RESERVA_MS = 30_000;

/** Centavos → reais com duas casas, como a API espera (nunca aritmética binária solta no JSON). */
export const centavosParaReaisApi = (c: number) => Number((c / 100).toFixed(2));

export class ClienteBeds24Http implements LeitorBeds24, LeitorCredencialBeds24, EscritorBeds24 {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxPaginas: number;
  private readonly agora: () => Date;
  /** `protected` (M8.3c): o cliente de reservas obtém o token antes de gravar `enviado_em` (`prepararToken`). */
  protected readonly autenticacao: AutenticacaoBeds24;

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

  /**
   * Chamada autenticada com tempo-limite; um 401 renova o token e repete uma única vez. Não lança: devolve a resposta de
   * qualquer status (quem chama classifica) ou a falha sem resposta, com a etapa. O tempo-limite é por chamada (M8.3c: 30 s
   * no POST de reservas e o do cliente nas leituras, com um cliente só por volta).
   */
  protected async requisitar(caminho: string, params: Parametros, corpo?: CorpoBeds24, timeoutMs = this.timeoutMs): Promise<Requisicao> {
    const url = new URL(this.baseUrl + caminho);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, item);
    }
    let token: string;
    try {
      token = await this.autenticacao.obter();
    } catch (erro) {
      return { ok: false, etapa: "token", erro };
    }
    try {
      let resposta = await buscarBeds24(this.fetchImpl, url, { token }, timeoutMs, corpo);
      if (resposta.status === 401 && this.o.refreshToken) {
        await resposta.body?.cancel();
        let renovado: string;
        try {
          renovado = await this.autenticacao.obter(token);
        } catch (erro) {
          return { ok: false, etapa: "token", erro };
        }
        // 403/429/5xx não provocam renovação.
        resposta = await buscarBeds24(this.fetchImpl, url, { token: renovado }, timeoutMs, corpo);
      }
      return { ok: true, resposta };
    } catch (erro) {
      return { ok: false, etapa: "pedido", erro };
    }
  }

  /** Chamada das leituras e da escrita do calendário: lança por HTTP e por falha, e devolve o corpo em JSON. */
  protected async chamar(caminho: string, params: Parametros, corpo?: CorpoBeds24): Promise<unknown> {
    const r = await this.requisitar(caminho, params, corpo);
    if (!r.ok) throw r.erro;
    const resposta = r.resposta;
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
      // Chegada exata (M8.3): os dois limites explícitos, porque sem filtro de chegada só vêm as reservas futuras.
      arrivalFrom: f.chegadaExata ?? f.chegadaDe,
      arrivalTo: f.chegadaExata ?? f.chegadaAte,
      departureFrom: f.saidaDe,
      id: f.ids,
      status: ["confirmed", "new", "request", "inquiry", "black", "cancelled"],
      modifiedFrom: f.modificadasDesde,
      propertyId: f.propertyIds,
      roomId: f.quarto,
      searchString: f.pesquisa,
      includeInfoItems: f.incluirInfo ? "true" : undefined,
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
   * GET /authentication/details (M8.3, prontidão): só leitura. O corpo não é uma lista (`data`), por isso não passa por
   * `get`; formato torto ou desconhecido sai como "não deu para ler" (`escopos` null), nunca como erro mudo.
   */
  async credencial(): Promise<CredencialBeds24> {
    const lidoEm = this.agora().toISOString();
    return { ...normalizarCredencial(await this.chamar("/authentication/details", {})), lidoEm };
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

/**
 * Cliente das reservas pagas pelo site (M8.3c): lê como o cliente de leitura e grava reservas. Só esta classe tem
 * `gravarReservas`: o escritor do calendário (`escritorDoAmbiente`) nunca grava reservas, nem por cast. E ela nunca escreve
 * o calendário: a chave das reservas não liga o calendário (desenho 2.2, as chaves independentes nos dois sentidos).
 */
export class ClienteReservasBeds24Http extends ClienteBeds24Http implements EscritorReservasBeds24 {
  /**
   * Obtém ou renova o token ANTES de o trabalhador gravar `enviado_em` (desenho 3.6): a renovação que cai aqui é falha antes
   * do POST (nada foi enviado), e não um tempo esgotado do POST que deixaria a operação incerta. Lança a falha.
   */
  async prepararToken(): Promise<void> {
    await this.autenticacao.obter();
  }

  /**
   * POST /bookings com um item (desenho 3.6 e 3.7) e a resposta classificada (3.8). Nunca lança: todo desfecho volta
   * classificado, com o `erro` fixo do código. O item é conferido antes de qualquer rede (`nao_enviado` se não passar). Um
   * 401 renova o token e repete uma vez (o primeiro não foi processado). Com o pedido do token (o inicial ou a renovação)
   * em falha, nada foi processado: recusado com HTTP 4xx (fora o 429) é `http_401`; o 429 é `limite`; o que cai por rede,
   * tempo ou 5xx, `nao_enviado`. Tempo esgotado no POST nunca repete: `tempo`, e a busca decide depois.
   */
  async gravarReservas(item: ItemGravacaoReserva): Promise<RespostaGravacaoReserva> {
    let corpo: string;
    try {
      corpo = JSON.stringify(corpoDaGravacaoReserva(item));
    } catch {
      return respostaDaGravacao("nao_enviado");
    }
    const r = await this.requisitar("/bookings", {}, { method: "POST", body: corpo }, TEMPO_GRAVACAO_RESERVA_MS);
    if (!r.ok) {
      const tipo = r.erro instanceof ErroBeds24 ? r.erro.tipo : null;
      if (r.etapa === "token") {
        const status = r.erro instanceof ErroBeds24 ? r.erro.status : undefined;
        // Só a recusa da credencial (4xx fora o 429) é `http_401`. O 429 do token é o limite de uso (pedir token também gasta
        // crédito, desenho 3.8), e o 5xx é falha passageira: nos dois, nada foi processado.
        if (status === 429) return respostaDaGravacao("limite", { http: status });
        if (status !== undefined && status >= 400 && status < 500) return respostaDaGravacao("http_401", { http: status });
        return respostaDaGravacao("nao_enviado", { http: status ?? null });
      }
      // O cabeçalho inválido (`buscarBeds24`) e o prazo da operação já acabado (`fetchComPrazo`) são recusados antes de o
      // pedido sair.
      return respostaDaGravacao(tipo === "configuracao" ? "nao_enviado" : tipo === "tempo" ? "tempo" : "rede");
    }
    let json: { valor: unknown } | null;
    try {
      json = { valor: await r.resposta.json() };
    } catch {
      json = null;
    }
    return classificarGravacaoReserva(item, { status: r.resposta.status, json, cabecalhos: r.resposta.headers });
  }

  /** Nunca escreve o calendário: a escrita do calendário tem a chave e o escritor próprios (`escritorDoAmbiente`). */
  override async escreverCalendario(itens: EnvioCalendario[]): Promise<ResultadoEscrita[]> {
    throw new ErroBeds24(`O cliente das reservas não escreve o calendário (${itens.length} quarto(s), nada enviado): a escrita do calendário tem a chave própria (BEDS24_ESCRITA).`, "configuracao");
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

/**
 * Chave da escrita de RESERVAS no Beds24 (M8.3): só o valor exato "ligada", e independente da chave do calendário
 * (`BEDS24_ESCRITA`) nos dois sentidos. O `env` vem sempre de quem chama (sem `process.env` como padrão).
 */
export const escritaReservasBeds24Ligada = (env: NodeJS.ProcessEnv): boolean => env.BEDS24_ESCRITA_RESERVAS?.trim() === "ligada";

/**
 * A escrita de reservas realmente pode sair (M8.3, desenho 2.2) — a trava de ambiente, uma função só, que nunca
 * reaproveita `escritaBeds24Ligada`/`escritaBeds24Pronta`. As quatro condições juntas:
 * 1. o deploy de produção da Vercel (`deployDeProducao`: exatamente VERCEL_ENV=production);
 * 2. NODE_ENV=production (o `next dev` e o Vitest ficam fora mesmo com VERCEL_ENV simulado);
 * 3. a chave `BEDS24_ESCRITA_RESERVAS=ligada`;
 * 4. o refresh token (`BEDS24_REFRESH_TOKEN`): o token direto (`BEDS24_API_KEY`) só lê e nunca habilita.
 * Depois dela vêm as condições do painel (pausa, prontidão e imóvel ligado), em `reservas-site-config.ts`.
 */
export const escritaReservasBeds24Pronta = (env: NodeJS.ProcessEnv): boolean =>
  ambienteDeEscritaDeReservas(env) && escritaReservasBeds24Ligada(env) && Boolean(env.BEDS24_REFRESH_TOKEN?.trim());

/**
 * O único lugar onde a escrita de reservas pode sair (condições 1 e 2 da trava): o deploy de produção da Vercel rodando
 * como produção. Prévia, `vercel dev`, computador e testes ficam fora, mesmo com VERCEL_ENV simulado.
 */
export const ambienteDeEscritaDeReservas = (env: NodeJS.ProcessEnv): boolean => deployDeProducao(env) && env.NODE_ENV === "production";

/**
 * Credencial que pode escrever (o refresh token) num lugar onde a escrita de reservas nunca sai (prévia, `vercel dev`,
 * computador, testes): Sistema e Integrações avisam, porque o token novo deve ficar só em Production (desenho 7).
 */
export const credencialDeEscritaForaDaProducao = (env: NodeJS.ProcessEnv): boolean =>
  Boolean(env.BEDS24_REFRESH_TOKEN?.trim()) && !ambienteDeEscritaDeReservas(env);

/**
 * O botão "Simular" da ficha (desenho 2.4 e 8): só fora do deploy de produção ou com a chave das reservas desligada. Lá,
 * com a chave ligada, quem decide é a rotina (M8.3c); a simulação nunca usa a rede, em lugar nenhum.
 */
export const simulacaoReservasBeds24Permitida = (env: NodeJS.ProcessEnv): boolean => !ambienteDeEscritaDeReservas(env) || !escritaReservasBeds24Ligada(env);

/**
 * Leitor dos escopos da credencial (prontidão, GET /authentication/details), só leitura e só com a escrita de reservas
 * pronta (`escritaReservasBeds24Pronta`: o deploy de produção, a chave e o refresh token). Nas prévias, no computador e
 * nos testes devolve null: a prontidão diz que não leu, e nenhuma chamada sai.
 */
export function leitorDeCredencialDoAmbiente(env: NodeJS.ProcessEnv): LeitorCredencialBeds24 | null {
  if (!escritaReservasBeds24Pronta(env)) return null;
  return new ClienteBeds24Http({ refreshToken: env.BEDS24_REFRESH_TOKEN!.trim(), maxPaginas: 1, timeoutMs: 15_000 });
}

/**
 * O PROCESSO é o de produção de verdade (M8.3c): `NODE_ENV=production` no próprio processo e fora do Vitest. Barreira a
 * mais das duas fábricas das reservas, além do `env` que recebem: o `env` de um teste pode simular a produção inteira (o
 * `PRONTO` dos testes tem `NODE_ENV: "production"`), e uma fábrica chamada com ele criaria o cliente HTTP real.
 */
const processoDeProducao = () => process.env.NODE_ENV === "production" && !process.env.VITEST;

/**
 * O prazo da operação em curso (desenho 3.6: 120 s na fase 2), dado por quem chama e lido a cada chamada: entra no `fetch`
 * embrulhado, junto com o tempo-limite de cada chamada, como em `leitorParaSincronizacao` (`buscarBeds24` fixa o próprio
 * sinal; uma opção de sinal no cliente não chegaria ao `fetch`). Com o prazo já acabado, a chamada nem sai.
 */
export type OpcoesDoClienteDeReservas = { prazo?: () => AbortSignal | null };

const fetchComPrazo = (prazo?: () => AbortSignal | null): typeof fetch | undefined =>
  prazo
    ? (url, init) => {
        const p = prazo();
        // O `fetch` com o sinal já abortado rejeitaria sem mandar nada, e a falha seria lida como tempo esgotado: no POST de
        // reservas, a operação ficaria incerta (e gastaria a nova tentativa automática) sem POST nenhum.
        if (p?.aborted) return Promise.reject(new ErroBeds24("O prazo da operação acabou antes de a chamada sair: nada foi enviado.", "configuracao"));
        const sinais = [p, init?.signal].filter((s): s is AbortSignal => !!s);
        return fetch(url, { ...init, ...(sinais.length ? { signal: AbortSignal.any(sinais) } : {}) });
      }
    : undefined;

/**
 * Cliente das reservas do site (M8.3c), um por volta (o token é renovado uma vez só): lê, confere os escopos e grava.
 * null sem a escrita de reservas pronta (`escritaReservasBeds24Pronta`: o deploy de produção, NODE_ENV, a chave e o
 * refresh token) ou fora do processo de produção. Usa SÓ o `BEDS24_REFRESH_TOKEN`, nunca a `BEDS24_API_KEY`. Só a rota da
 * rotina e as ações chamam esta fábrica: o domínio recebe o cliente injetado, como parâmetro obrigatório.
 */
export function clienteDeReservasDoAmbiente(env: NodeJS.ProcessEnv, o: OpcoesDoClienteDeReservas = {}): ClienteReservasBeds24Http | null {
  if (!escritaReservasBeds24Pronta(env) || !processoDeProducao()) return null;
  return new ClienteReservasBeds24Http({ refreshToken: env.BEDS24_REFRESH_TOKEN!.trim(), maxPaginas: 10, timeoutMs: 15_000, fetchImpl: fetchComPrazo(o.prazo) });
}

/**
 * Leitor das reservas do site (M8.3c) para quando a escrita não está pronta: o passo 0 da rotina (a chave desligada só
 * resolve com leitura o que está em curso) e "Conferir agora". Só leitura; null fora do deploy de produção
 * (`ambienteDeEscritaDeReservas`), fora do processo de produção ou sem credencial. Nas prévias, nunca lê o Beds24.
 */
export function leitorDeReservasDoAmbiente(env: NodeJS.ProcessEnv, o: OpcoesDoClienteDeReservas = {}): LeitorBeds24 | null {
  if (!ambienteDeEscritaDeReservas(env) || !processoDeProducao()) return null;
  const { refreshToken, token } = credenciais(env);
  if (!refreshToken && !token) return null;
  return new ClienteBeds24Http({ refreshToken, token, maxPaginas: 10, timeoutMs: 15_000, fetchImpl: fetchComPrazo(o.prazo) });
}

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
