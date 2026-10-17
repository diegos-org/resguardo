/**
 * Reserva paga do site no Beds24 (M8.3c) — o cliente de escrita (desenho 3.7 e 3.8; seção 10, teste 19), a separação das
 * duas escritas e as fábricas, que só criam o cliente no deploy e no processo de produção. Rede SIMULADA: o `fetch` é
 * injetado; nenhum teste chega ao Beds24 (a barreira do setup derrubaria). O `env` é sempre um objeto explícito, nunca o
 * `process.env`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ClienteBeds24Http,
  ClienteReservasBeds24Http,
  clienteDeReservasDoAmbiente,
  escritorDoAmbiente,
  leitorDeReservasDoAmbiente,
  TEMPO_GRAVACAO_RESERVA_MS,
} from "./http";
import { corpoDaGravacaoReserva } from "./normalizar";
import { ErroBeds24, type ItemGravacaoReserva, TEXTOS_DE_ERRO_BEDS24 } from "./tipos";

const env = (o: Record<string, string | undefined>) => o as unknown as NodeJS.ProcessEnv;
/** As quatro condições juntas: deploy de produção, NODE_ENV de produção, a chave e o refresh token (fictício). */
const PRONTO = { VERCEL_ENV: "production", NODE_ENV: "production", BEDS24_ESCRITA_RESERVAS: "ligada", BEDS24_REFRESH_TOKEN: "refresh-ficticio" };

const json = (corpo: unknown, status = 200, cabecalhos: Record<string, string> = {}) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json", ...cabecalhos } });
const acesso = (token = "acesso-ficticio") => json({ token, expiresIn: 3600 });
const tempoEsgotado = () => Object.assign(new Error("t"), { name: "TimeoutError" });

type Chamada = { url: URL; init: RequestInit };
/** O cliente de reservas com a rede simulada: a primeira chamada é a troca do refresh token pelo token de acesso. */
function preparar(respostas: (Response | Error)[]) {
  const chamadas: Chamada[] = [];
  const fetchImpl = (async (url: URL | string, init: RequestInit) => {
    chamadas.push({ url: new URL(String(url)), init });
    const r = respostas.shift();
    if (!r) throw new Error("sem resposta preparada");
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  const cliente = new ClienteReservasBeds24Http({ refreshToken: "refresh-ficticio", fetchImpl });
  const posts = () => chamadas.filter((c) => c.url.pathname === "/api/v2/bookings");
  return { cliente, chamadas, posts };
}
const gravar = (item: ItemGravacaoReserva, respostas: (Response | Error)[]) => {
  const p = preparar([acesso(), ...respostas]);
  return { ...p, resultado: p.cliente.gravarReservas(item) };
};

const CRIAR: ItemGravacaoReserva = { tipo: "criar", quarto: "123456", chegada: "2026-12-20", saida: "2026-12-27", hospedes: 4, marca: { tipo: "reserva", codigo: "SCL-7K2QXM" } };
const ATUALIZAR: ItemGravacaoReserva = { tipo: "atualizar", id: "98765", chegada: "2026-12-21", saida: "2026-12-28", hospedes: 3 };
const CANCELAR: ItemGravacaoReserva = { tipo: "cancelar", id: "98765" };
const OP_ENSAIO = "0f8fad5b-d9cb-469f-a165-70867728950e";
/** Campos que nunca vão ao Beds24 (D1 e D2). */
const PROIBIDOS = ["firstName", "lastName", "email", "phone", "mobile", "address", "country", "notes", "comments", "price", "deposit", "invoiceItems", "commission", "refererEditable"];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("cliente de escrita de reservas (desenho 3.7 e 3.8; teste 19)", () => {
  it("o corpo exato de criar, atualizar, cancelar e do ensaio: POST /bookings com um item, sem dado pessoal nem valor, as notificações desligadas", async () => {
    const criar = gravar(CRIAR, [json([{ success: true, new: { id: 555 } }], 201)]);
    expect(await criar.resultado).toEqual({ resposta: "criada", beds24Id: "555", http: 201, erro: "", creditoRestante: null, observado: { chaveDoId: "id", chavesEmNew: ["id"], cabecalhosDeCredito: [] } });
    expect(criar.posts()).toHaveLength(1);
    const post = criar.posts()[0];
    expect(post.init.method).toBe("POST");
    expect(post.init.headers).toMatchObject({ token: "acesso-ficticio", "content-type": "application/json" });
    expect([...post.url.searchParams.keys()]).toEqual([]);
    expect(JSON.parse(String(post.init.body))).toEqual([{
      roomId: 123456, arrival: "2026-12-20", departure: "2026-12-27", status: "confirmed", numAdult: 4, numChild: 0,
      infoItems: [{ code: "SCL", text: "SCL-7K2QXM" }], actions: { checkAvailability: true, notifyGuest: false, notifyHost: false },
    }]);

    const atualizar = gravar(ATUALIZAR, [json([{ success: true, modified: { id: 98765 } }])]);
    expect(await atualizar.resultado).toMatchObject({ resposta: "modificada", beds24Id: "98765", http: 200, erro: "" });
    // Nunca troca o quarto: só as datas e as pessoas.
    expect(JSON.parse(String(atualizar.posts()[0].init.body))).toEqual([{ id: 98765, arrival: "2026-12-21", departure: "2026-12-28", numAdult: 3 }]);

    const cancelar = gravar(CANCELAR, [json([{ success: true, modified: { id: 98765 } }])]);
    expect(await cancelar.resultado).toMatchObject({ resposta: "modificada", beds24Id: "98765" });
    expect(JSON.parse(String(cancelar.posts()[0].init.body))).toEqual([{ id: 98765, status: "cancelled" }]);

    const ensaio = gravar({ ...CRIAR, hospedes: 1, marca: { tipo: "ensaio", operacaoId: OP_ENSAIO } }, [json([{ success: true, new: { id: 556 } }], 201)]);
    expect(await ensaio.resultado).toMatchObject({ resposta: "criada", beds24Id: "556" });
    expect(JSON.parse(String(ensaio.posts()[0].init.body))[0]).toMatchObject({ infoItems: [{ code: "SCL-ENSAIO", text: OP_ENSAIO }], numAdult: 1, actions: { notifyGuest: false, notifyHost: false } });

    for (const p of [criar, atualizar, cancelar, ensaio]) {
      for (const item of JSON.parse(String(p.posts()[0].init.body)) as Record<string, unknown>[]) for (const k of PROIBIDOS) expect(Object.keys(item)).not.toContain(k);
      // Nenhuma chamada usa outro método que não GET (o token) e POST (a gravação); nenhuma é DELETE.
      expect(p.chamadas.map((c) => c.init.method ?? "GET").every((m) => m === "GET" || m === "POST")).toBe(true);
      expect(p.chamadas.filter((c) => c.init.method === "POST").every((c) => c.url.pathname === "/api/v2/bookings")).toBe(true);
    }
  });

  it("o POST tem o tempo-limite de 30 s; as leituras do mesmo cliente seguem com o do cliente (15 s)", async () => {
    const espiao = vi.spyOn(AbortSignal, "timeout");
    const { cliente } = preparar([acesso(), json([{ success: true, new: { id: 1 } }], 201), json({ success: true, data: [] })]);
    await cliente.gravarReservas(CRIAR);
    await cliente.reservas({ ids: ["1"] });
    // A troca do token, o POST e a leitura.
    expect(espiao.mock.calls.map(([ms]) => ms)).toEqual([15_000, TEMPO_GRAVACAO_RESERVA_MS, 15_000]);
    expect(TEMPO_GRAVACAO_RESERVA_MS).toBe(30_000);
  });

  it("item fora do formato não sai: `nao_enviado`, sem nenhuma chamada (nem a do token)", async () => {
    const invalidos: ItemGravacaoReserva[] = [
      { ...CRIAR, marca: { tipo: "reserva", codigo: "SCL-7K2QX0" } },
      { ...CRIAR, marca: { tipo: "reserva", codigo: "Hóspede Fictício" } },
      { ...CRIAR, marca: { tipo: "ensaio", operacaoId: "nao-e-uuid" } },
      { ...CRIAR, quarto: "abc" },
      { ...CRIAR, quarto: "0" },
      { ...CRIAR, chegada: "2026-12-27", saida: "2026-12-20" },
      { ...CRIAR, chegada: "2026-02-30" },
      { ...CRIAR, hospedes: 0 },
      { ...CRIAR, hospedes: 1.5 },
      { ...ATUALIZAR, id: "98765; DROP" },
      { ...CANCELAR, id: "" },
      { tipo: "apagar", id: "98765" } as unknown as ItemGravacaoReserva,
    ];
    for (const item of invalidos) {
      expect(() => corpoDaGravacaoReserva(item)).toThrow(ErroBeds24);
      const { cliente, chamadas } = preparar([]);
      expect(await cliente.gravarReservas(item)).toEqual({ resposta: "nao_enviado", beds24Id: null, http: null, erro: TEXTOS_DE_ERRO_BEDS24.nao_enviado, creditoRestante: null });
      expect(chamadas).toHaveLength(0);
    }
  });

  it("tempo esgotado no POST: uma chamada só e `tempo` (nunca repete); a rede caída: `rede`", async () => {
    const tempo = gravar(CRIAR, [tempoEsgotado()]);
    expect(await tempo.resultado).toEqual({ resposta: "tempo", beds24Id: null, http: null, erro: TEXTOS_DE_ERRO_BEDS24.tempo, creditoRestante: null });
    expect(tempo.posts()).toHaveLength(1);
    const rede = gravar(CRIAR, [new TypeError("fetch failed")]);
    expect(await rede.resultado).toMatchObject({ resposta: "rede", http: null });
    expect(rede.posts()).toHaveLength(1);
  });

  it("401 renova o token e repete uma vez; o 401 repetido é `http_401` (sem terceira tentativa)", async () => {
    const renova = preparar([acesso("antigo"), json({}, 401), acesso("novo"), json([{ success: true, new: { id: 7 } }], 201)]);
    expect(await renova.cliente.gravarReservas(CRIAR)).toMatchObject({ resposta: "criada", beds24Id: "7" });
    expect(renova.posts().map((p) => (p.init.headers as Record<string, string>).token)).toEqual(["antigo", "novo"]);
    // O mesmo corpo nas duas tentativas.
    expect(renova.posts()[0].init.body).toBe(renova.posts()[1].init.body);

    const repetido = preparar([acesso(), json({}, 401), acesso("novo"), json({}, 401)]);
    expect(await repetido.cliente.gravarReservas(CRIAR)).toMatchObject({ resposta: "http_401", http: 401, beds24Id: null, erro: TEXTOS_DE_ERRO_BEDS24.http_401 });
    expect(repetido.chamadas).toHaveLength(4);
  });

  it("a renovação depois do primeiro 401: recusada com HTTP 4xx = `http_401`; o 429 = `limite`; caída por rede, tempo ou 5xx = `nao_enviado` (o 401 não foi processado)", async () => {
    const recusada = preparar([acesso(), json({}, 401), json({ error: "refresh-ficticio NAO MOSTRAR" }, 400)]);
    const r1 = await recusada.cliente.gravarReservas(CRIAR);
    expect(r1).toMatchObject({ resposta: "http_401", http: 400 });
    expect(JSON.stringify(r1)).not.toContain("ficticio");
    expect(recusada.posts()).toHaveLength(1);
    for (const falha of [new TypeError("fetch failed"), tempoEsgotado()]) {
      const caiu = preparar([acesso(), json({}, 401), falha]);
      expect(await caiu.cliente.gravarReservas(CRIAR)).toMatchObject({ resposta: "nao_enviado", http: null });
      expect(caiu.posts()).toHaveLength(1);
    }
    // O 429 do token é o limite de uso (pedir token também gasta crédito), e o 5xx é passageiro: nenhum dos dois é a
    // credencial recusada, e nada foi processado.
    const limite = preparar([acesso(), json({}, 401), json({ error: "x" }, 429)]);
    expect(await limite.cliente.gravarReservas(CRIAR)).toMatchObject({ resposta: "limite", http: 429, erro: TEXTOS_DE_ERRO_BEDS24.limite });
    expect(limite.posts()).toHaveLength(1);
    for (const status of [500, 503]) {
      const servidor = preparar([acesso(), json({ error: "x" }, 401), json({ error: "x" }, status)]);
      expect(await servidor.cliente.gravarReservas(CRIAR), String(status)).toMatchObject({ resposta: "nao_enviado", http: status });
      expect(servidor.posts()).toHaveLength(1);
    }
  });

  it("403: `http_403`, com a mensagem de reservas; a do inventário continua só no POST do calendário", async () => {
    const r = await gravar(CRIAR, [json({ success: false }, 403)]).resultado;
    expect(r).toMatchObject({ resposta: "http_403", http: 403 });
    expect(r.erro).toContain("não tem permissão de escrever reservas");
    expect(r.erro).not.toContain("inventário");
    const calendario = new ClienteBeds24Http({ token: "k", fetchImpl: (async () => json({ success: false }, 403)) as unknown as typeof fetch });
    await expect(calendario.escreverCalendario([{ roomId: "200", faixas: [{ from: "2026-10-01", to: "2026-10-01", preco: 100 }] }])).rejects.toThrow("permissão de inventário");
  });

  it("429: sem a lista de itens = `limite`; com a lista, pelo item — o sucesso fica duvidoso (`sem_id`), a recusa é recusa", async () => {
    expect(await gravar(CRIAR, [json({ error: "Credit limit exceeded" }, 429)]).resultado).toMatchObject({ resposta: "limite", http: 429, erro: TEXTOS_DE_ERRO_BEDS24.limite });
    expect(await gravar(CRIAR, [new Response("Too Many Requests", { status: 429 })]).resultado).toMatchObject({ resposta: "limite" });
    expect(await gravar(CRIAR, [json([], 429)]).resultado).toMatchObject({ resposta: "limite" });
    expect(await gravar(CRIAR, [json([{ success: true, new: { id: 9 } }], 429)]).resultado).toMatchObject({ resposta: "sem_id", beds24Id: null, http: 429 });
    expect(await gravar(ATUALIZAR, [json([{ success: true, modified: { id: 98765 } }], 429)]).resultado).toMatchObject({ resposta: "sem_id", beds24Id: null });
    expect(await gravar(CRIAR, [json([{ success: false, errors: [{ message: "Not available" }] }], 429)]).resultado).toMatchObject({ resposta: "recusada_disponibilidade" });
  });

  it("outro 4xx = `http_4xx`; 5xx = `http_5xx`; resposta que não é JSON nem a lista de itens = `formato`", async () => {
    for (const status of [400, 404, 409, 422]) expect(await gravar(CRIAR, [json({ error: "x" }, status)]).resultado, String(status)).toMatchObject({ resposta: "http_4xx", http: status });
    for (const status of [500, 502, 503]) expect(await gravar(CRIAR, [json({ error: "x" }, status)]).resultado, String(status)).toMatchObject({ resposta: "http_5xx", http: status });
    for (const r of [new Response("<html>", { status: 201 }), json({ success: true }, 201), json([], 201), json([null], 201), json([{}], 201), json([{ success: "true" }], 201)]) {
      expect(await gravar(CRIAR, [r]).resultado).toMatchObject({ resposta: "formato", beds24Id: null });
    }
  });

  it("o item com `success: false` ou `errors` é recusa; a de disponibilidade fica separada; o texto do Beds24 nunca vai para o `erro`", async () => {
    const nomeFicticio = "Hóspede Fictício";
    const recusa = await gravar(CRIAR, [json([{ success: false, errors: [{ action: "new", message: `Not available: overlaps booking of ${nomeFicticio}` }] }], 201)]).resultado;
    expect(recusa).toMatchObject({ resposta: "recusada_disponibilidade", beds24Id: null, erro: TEXTOS_DE_ERRO_BEDS24.recusada_disponibilidade });
    expect(JSON.stringify(recusa)).not.toContain(nomeFicticio);
    expect(await gravar(CRIAR, [json([{ success: false, errors: [{ message: "Sem disponibilidade" }] }], 201)]).resultado).toMatchObject({ resposta: "recusada_disponibilidade" });
    expect(await gravar(CRIAR, [json([{ success: false }], 201)]).resultado).toMatchObject({ resposta: "recusada", erro: TEXTOS_DE_ERRO_BEDS24.recusada });
    expect(await gravar(CRIAR, [json([{ success: false, errors: [{ message: `Daily limit reached for ${nomeFicticio}` }] }], 201)]).resultado).toMatchObject({ resposta: "recusada" });
    // `errors` junto com `success: true` também é recusa (a busca decide depois).
    expect(await gravar(CRIAR, [json([{ success: true, new: { id: 1 }, errors: [{ message: "x" }] }], 201)]).resultado).toMatchObject({ resposta: "recusada", beds24Id: null });
    expect(await gravar(CANCELAR, [json([{ success: false, errors: [{ message: "Booking not found" }] }])]).resultado).toMatchObject({ resposta: "recusada" });
  });

  it("a criação sem id legível em `new` é `sem_id`; o id vem de `id`, `bookId`, `bookingId` ou do próprio `new`; o observado guarda só nomes de chave", async () => {
    expect(await gravar(CRIAR, [json([{ success: true, new: {} }], 201)]).resultado).toMatchObject({ resposta: "sem_id", beds24Id: null, observado: { chaveDoId: null, chavesEmNew: [] } });
    expect(await gravar(CRIAR, [json([{ success: true }], 201)]).resultado).toMatchObject({ resposta: "sem_id" });
    expect(await gravar(CRIAR, [json([{ success: true, new: { bookId: "777" } }], 201)]).resultado).toMatchObject({ resposta: "criada", beds24Id: "777", observado: { chaveDoId: "bookId" } });
    expect(await gravar(CRIAR, [json([{ success: true, new: { bookingId: 778 } }], 201)]).resultado).toMatchObject({ resposta: "criada", beds24Id: "778", observado: { chaveDoId: "bookingId" } });
    expect(await gravar(CRIAR, [json([{ success: true, new: 779 }], 201)]).resultado).toMatchObject({ resposta: "criada", beds24Id: "779", observado: { chaveDoId: "new" } });
    // Zeros à esquerda: o mesmo id que a leitura devolve.
    expect(await gravar(CRIAR, [json([{ success: true, new: { id: "000780" } }], 201)]).resultado).toMatchObject({ beds24Id: "780" });
    for (const id of [0, "0", "12a", 1.5, -3, "1e21", null, { x: 1 }]) {
      expect(await gravar(CRIAR, [json([{ success: true, new: { id } }], 201)]).resultado, JSON.stringify(id)).toMatchObject({ resposta: "sem_id", beds24Id: null });
    }
    const estranho = await gravar(CRIAR, [json([{ success: true, new: { ref: 1, "nome do hóspede": "Hóspede Fictício" } }], 201)]).resultado;
    expect(estranho).toMatchObject({ resposta: "sem_id", observado: { chavesEmNew: ["ref"] } });
    expect(JSON.stringify(estranho)).not.toContain("Fictício");
  });

  it("o crédito restante sai dos dois nomes de cabeçalho (com os dois, o menor); sem nenhum legível, desconhecido; o observado guarda só os nomes", async () => {
    const ok = (cabecalhos: Record<string, string>) => json([{ success: true, new: { id: 1 } }], 201, cabecalhos);
    expect(await gravar(CRIAR, [ok({ "x-five-min-limit-remaining": "55" })]).resultado).toMatchObject({ creditoRestante: 55, observado: { cabecalhosDeCredito: ["x-five-min-limit-remaining"] } });
    expect(await gravar(CRIAR, [ok({ "X-FiveMinCreditLimit-Remaining": "12" })]).resultado).toMatchObject({ creditoRestante: 12, observado: { cabecalhosDeCredito: ["x-fivemincreditlimit-remaining"] } });
    expect(await gravar(CRIAR, [ok({ "x-five-min-limit-remaining": "55", "X-FiveMinCreditLimit-Remaining": "12" })]).resultado).toMatchObject({ creditoRestante: 12 });
    expect(await gravar(CRIAR, [ok({ "x-five-min-limit-remaining": "muito" })]).resultado).toMatchObject({ creditoRestante: null });
    expect(await gravar(CRIAR, [ok({})]).resultado).toMatchObject({ creditoRestante: null, observado: { cabecalhosDeCredito: [] } });
    // Também no 429 e numa recusa: a rotina para com o crédito baixo, qualquer que seja o desfecho.
    expect(await gravar(CRIAR, [json({ error: "x" }, 429, { "x-five-min-limit-remaining": "0" })]).resultado).toMatchObject({ resposta: "limite", creditoRestante: 0 });
  });

  it("o token: `prepararToken` obtém antes do POST e lança a falha (nenhum POST sai); dentro de `gravarReservas`, o token que não vem nunca vira POST", async () => {
    const caiu = preparar([new TypeError("fetch failed")]);
    await expect(caiu.cliente.prepararToken()).rejects.toMatchObject({ tipo: "rede" });
    expect(caiu.posts()).toHaveLength(0);
    const recusado = preparar([json({}, 401)]);
    await expect(recusado.cliente.prepararToken()).rejects.toMatchObject({ tipo: "http", status: 401 });
    // Com o token preparado, a gravação não pede outro.
    const pronto = preparar([acesso(), json([{ success: true, new: { id: 1 } }], 201)]);
    await pronto.cliente.prepararToken();
    expect(await pronto.cliente.gravarReservas(CRIAR)).toMatchObject({ resposta: "criada" });
    expect(pronto.chamadas.map((c) => c.url.pathname)).toEqual(["/api/v2/authentication/token", "/api/v2/bookings"]);
    // Sem o token preparado, nada sai: o token caído por rede, tempo ou 5xx = `nao_enviado`; recusado com HTTP 4xx =
    // `http_401`; o 429 = `limite`.
    const semToken = preparar([tempoEsgotado()]);
    expect(await semToken.cliente.gravarReservas(CRIAR)).toMatchObject({ resposta: "nao_enviado" });
    expect(semToken.posts()).toHaveLength(0);
    const tokenRecusado = preparar([json({}, 400)]);
    expect(await tokenRecusado.cliente.gravarReservas(CRIAR)).toMatchObject({ resposta: "http_401", http: 400 });
    expect(tokenRecusado.posts()).toHaveLength(0);
    const tokenNoLimite = preparar([json({}, 429)]);
    expect(await tokenNoLimite.cliente.gravarReservas(CRIAR)).toMatchObject({ resposta: "limite", http: 429 });
    expect(tokenNoLimite.posts()).toHaveLength(0);
    const tokenServidor = preparar([json({}, 503)]);
    expect(await tokenServidor.cliente.gravarReservas(CRIAR)).toMatchObject({ resposta: "nao_enviado", http: 503 });
    expect(tokenServidor.posts()).toHaveLength(0);
  });

  it("o token de acesso com caractere inválido: o pedido nem sai (`nao_enviado`)", async () => {
    const p = preparar([acesso("acesso\u0001ficticio")]);
    expect(await p.cliente.gravarReservas(CRIAR)).toMatchObject({ resposta: "nao_enviado" });
    expect(p.posts()).toHaveLength(0);
  });
});

describe("as duas escritas separadas (desenho 2.2)", () => {
  it("o escritor do calendário não grava reservas, nem por cast; o cliente de reservas não escreve o calendário", async () => {
    const calendario = escritorDoAmbiente(env({ BEDS24_REFRESH_TOKEN: "refresh-ficticio", BEDS24_ESCRITA: "ligada" }));
    expect(calendario).toBeInstanceOf(ClienteBeds24Http);
    expect(calendario).not.toBeInstanceOf(ClienteReservasBeds24Http);
    expect("gravarReservas" in calendario!).toBe(false);
    expect("prepararToken" in calendario!).toBe(false);
    expect(Object.getOwnPropertyNames(ClienteReservasBeds24Http.prototype).filter((m) => m !== "constructor").sort()).toEqual(["escreverCalendario", "gravarReservas", "prepararToken"]);
    const { cliente, chamadas } = preparar([]);
    await expect(cliente.escreverCalendario([{ roomId: "200", faixas: [{ from: "2026-10-01", to: "2026-10-01", bloqueio: "blackout" }] }])).rejects.toMatchObject({ tipo: "configuracao" });
    expect(chamadas).toHaveLength(0);
  });

  it("só a chave do calendário (BEDS24_ESCRITA=ligada) nunca cria o cliente das reservas (o leitor não depende de chave e nunca grava)", () => {
    const soCalendario = env({ ...PRONTO, BEDS24_ESCRITA_RESERVAS: undefined, BEDS24_ESCRITA: "ligada" });
    expect(clienteDeReservasDoAmbiente(soCalendario)).toBeNull();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VITEST", "");
    expect(clienteDeReservasDoAmbiente(soCalendario)).toBeNull();
    const leitor = leitorDeReservasDoAmbiente(soCalendario);
    expect(leitor).toBeInstanceOf(ClienteBeds24Http);
    expect(leitor).not.toBeInstanceOf(ClienteReservasBeds24Http);
    expect("gravarReservas" in leitor!).toBe(false);
  });
});

describe("as fábricas das reservas (M8.3c): só no deploy de produção e no processo de produção", () => {
  it("dentro do Vitest, nem o PRONTO inteiro cria o cliente ou o leitor (a barreira do processo real)", () => {
    // O PRONTO tem NODE_ENV: "production"; dentro do Vitest, a fábrica não cria o cliente HTTP real.
    expect(clienteDeReservasDoAmbiente(env(PRONTO))).toBeNull();
    expect(leitorDeReservasDoAmbiente(env(PRONTO))).toBeNull();
  });

  it("com o processo de produção simulado, o `env` decide: null fora do deploy de produção ou sem NODE_ENV de produção no `env`", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VITEST", "");
    // O leitor não depende da chave nem do refresh token: a base dele é a leitura com o token direto.
    const LEITURA = { VERCEL_ENV: "production", NODE_ENV: "production", BEDS24_API_KEY: "token-direto-ficticio" };
    // Os controles: com o `env` inteiro, as duas fábricas criam (sem rede).
    expect(clienteDeReservasDoAmbiente(env(PRONTO))).toBeInstanceOf(ClienteReservasBeds24Http);
    expect(leitorDeReservasDoAmbiente(env(LEITURA))).toBeInstanceOf(ClienteBeds24Http);
    for (const troca of [{ NODE_ENV: "test" }, { NODE_ENV: "development" }, { NODE_ENV: undefined }, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }, { VERCEL_ENV: undefined }]) {
      const nome = JSON.stringify(troca);
      expect(clienteDeReservasDoAmbiente(env({ ...PRONTO, ...troca })), nome).toBeNull();
      expect(leitorDeReservasDoAmbiente(env({ ...LEITURA, ...troca })), nome).toBeNull();
    }
  });

  it("com o processo de produção simulado: o cliente só com a escrita pronta e o refresh token; o leitor só lê; criar nenhum faz chamada", async () => {
    const espiao = vi.spyOn(globalThis, "fetch");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VITEST", "");
    expect(clienteDeReservasDoAmbiente(env(PRONTO))).toBeInstanceOf(ClienteReservasBeds24Http);
    // O token direto só lê: nunca habilita a escrita de reservas.
    expect(clienteDeReservasDoAmbiente(env({ ...PRONTO, BEDS24_REFRESH_TOKEN: undefined, BEDS24_API_KEY: "token-direto-ficticio" }))).toBeNull();
    expect(clienteDeReservasDoAmbiente(env({ ...PRONTO, BEDS24_ESCRITA_RESERVAS: "Ligada" }))).toBeNull();
    expect(clienteDeReservasDoAmbiente(env({ ...PRONTO, VERCEL_ENV: "preview" }))).toBeNull();
    // O leitor vale com a chave desligada (o passo 0 e "Conferir agora"), mas só no deploy de produção e com credencial.
    const leitor = leitorDeReservasDoAmbiente(env({ VERCEL_ENV: "production", NODE_ENV: "production", BEDS24_API_KEY: "token-direto-ficticio" }));
    expect(leitor).toBeInstanceOf(ClienteBeds24Http);
    expect(leitor).not.toBeInstanceOf(ClienteReservasBeds24Http);
    expect("gravarReservas" in leitor!).toBe(false);
    expect(leitorDeReservasDoAmbiente(env({ VERCEL_ENV: "production", NODE_ENV: "production" }))).toBeNull();
    expect(leitorDeReservasDoAmbiente(env({ VERCEL_ENV: "preview", NODE_ENV: "production", BEDS24_API_KEY: "token-direto-ficticio" }))).toBeNull();
    expect(espiao).not.toHaveBeenCalled();
  });

  it("o cliente da fábrica usa só o refresh token e leva o prazo da operação ao `fetch`; com o prazo já acabado, a chamada nem sai (sem rede: o `fetch` é simulado)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VITEST", "");
    const vistos: { headers: Record<string, string>; sinal: AbortSignal | null | undefined }[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (_url, init) => {
      vistos.push({ headers: init?.headers as Record<string, string>, sinal: init?.signal });
      return acesso();
    }));
    const prazo = new AbortController();
    const cliente = clienteDeReservasDoAmbiente(env({ ...PRONTO, BEDS24_API_KEY: "token-direto-ficticio" }), { prazo: () => prazo.signal })!;
    await cliente.prepararToken();
    expect(vistos.map((v) => v.headers)).toEqual([{ accept: "application/json", refreshToken: "refresh-ficticio" }]);
    // O prazo chega ao `fetch`: acabar o prazo aborta a chamada em curso.
    expect(vistos[0].sinal?.aborted).toBe(false);
    prazo.abort();
    expect(vistos[0].sinal?.aborted).toBe(true);
    // Com o prazo já acabado (e o token já obtido), o POST nem sai: `nao_enviado`, nunca `tempo` — a operação não fica
    // incerta, gastando a nova tentativa automática, sem ter havido POST.
    expect(await cliente.gravarReservas(CRIAR)).toMatchObject({ resposta: "nao_enviado", http: null });
    // Sem o token: o pedido do token também não sai; `prepararToken` lança a falha (antes do POST).
    const outro = clienteDeReservasDoAmbiente(env(PRONTO), { prazo: () => prazo.signal })!;
    await expect(outro.prepararToken()).rejects.toMatchObject({ tipo: "configuracao" });
    expect(await outro.gravarReservas(CRIAR)).toMatchObject({ resposta: "nao_enviado", http: null });
    expect(vistos).toHaveLength(1);
  });
});
