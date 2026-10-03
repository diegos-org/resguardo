import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adicionarIdExterno } from "@/canais/ids-externos";
import { imoveis, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { sincronizarReserva } from "@/reservas/repositorio";
import { converterLote, paraDadosReserva } from "./converter";
import { Beds24Falso } from "./falso";
import { ClienteBeds24Http, escritaBeds24Ligada, escritorDoAmbiente, leitorDoAmbiente } from "./http";
import { canalDe, normalizarCalendario, normalizarQuartos, normalizarReserva, reaisParaCentavosApi } from "./normalizar";
import { ErroBeds24 } from "./tipos";

const booking = (over: Record<string, unknown> = {}) => ({
  id: 5550001,
  propertyId: 100,
  roomId: 200,
  status: "confirmed",
  arrival: "2026-10-10",
  departure: "2026-10-13",
  numAdult: 2,
  numChild: 1,
  firstName: "Hóspede",
  lastName: "Fictício",
  email: "Hospede@Example.com",
  phone: "+55 21 90000-0000",
  price: 1500.5,
  commission: 225,
  referer: "Airbnb",
  apiReference: "HMFAKE123",
  modifiedTime: "2026-09-20T10:00:00Z",
  ...over,
});

describe("normalização", () => {
  it("reserva válida vira o tipo interno (centavos, hóspedes, canal, código)", () => {
    const n = normalizarReserva(booking());
    expect(n).toEqual({
      ok: true,
      r: {
        idExterno: "5550001",
        propertyId: "100",
        roomId: "200",
        estado: "confirmada",
        checkin: "2026-10-10",
        checkout: "2026-10-13",
        hospedes: 3,
        nome: "Hóspede Fictício",
        email: "hospede@example.com",
        telefone: "+55 21 90000-0000",
        valorBruto: 150050,
        comissaoCanal: 22500,
        canal: "airbnb",
        codigoCanal: "HMFAKE123",
        modificadoEm: "2026-09-20T10:00:00Z",
        reservadaEm: null,
      },
    });
  });

  it("situações: new/confirmed, request/inquiry, cancelled, black (bloqueio)", () => {
    const estado = (status: string) => {
      const n = normalizarReserva(booking({ status }));
      return n.ok ? n.r.estado : n.d.motivo;
    };
    expect([estado("new"), estado("confirmed"), estado("request"), estado("inquiry"), estado("cancelled"), estado("black")]).toEqual([
      "confirmada",
      "confirmada",
      "pedido",
      "consulta",
      "cancelada",
      "bloqueio",
    ]);
    expect(estado("xyz")).toContain("desconhecida");
  });

  it("qualquer coisa fora do esperado vira divergência, nunca dado", () => {
    const motivo = (b: unknown) => {
      const n = normalizarReserva(b);
      return n.ok ? "ok" : n.d.motivo;
    };
    expect(motivo(null)).toContain("objeto");
    expect(motivo(booking({ id: undefined }))).toBe("sem id");
    expect(motivo(booking({ roomId: "" }))).toContain("roomId");
    expect(motivo(booking({ arrival: "2026-02-30" }))).toBe("datas inválidas");
    expect(motivo(booking({ departure: "2026-10-10" }))).toContain("saída");
    expect(motivo(booking({ price: "mil" }))).toBe("valor inválido");
    expect(motivo(booking({ price: -1 }))).toBe("valor negativo");
    expect(motivo(booking({ id: "<script>" }))).toBe("sem id");
    expect(motivo(booking({ numAdult: -1, numChild: 3 }))).toBe("número de hóspedes inválido");
    expect(motivo(booking({ numAdult: 1.5 }))).toBe("número de hóspedes inválido");
  });

  it("dinheiro e canal", () => {
    expect(reaisParaCentavosApi(10.005)).toBe(1001);
    expect(reaisParaCentavosApi("1.005")).toBe(101);
    expect(reaisParaCentavosApi(1.005)).toBe(101);
    expect(reaisParaCentavosApi(0.285)).toBe(29);
    expect(reaisParaCentavosApi("1.004")).toBe(100);
    expect(reaisParaCentavosApi(1500)).toBe(150000);
    expect(reaisParaCentavosApi("-2.5")).toBe(-250);
    expect(reaisParaCentavosApi(1e21)).toBeUndefined();
    expect(reaisParaCentavosApi(Number.NaN)).toBeUndefined();
    expect(reaisParaCentavosApi("99.9")).toBe(9990);
    expect(reaisParaCentavosApi(null)).toBeNull();
    expect(reaisParaCentavosApi("1,5")).toBeUndefined();
    expect(canalDe("Booking.com")).toBe("booking");
    expect(canalDe(undefined, "airbnb")).toBe("airbnb");
    expect(canalDe("direct")).toBe("direta");
    expect(canalDe("expedia")).toBe("outro");
    expect(canalDe()).toBe("outro");
  });

  it("calendário: faixas expandidas em dias, recortadas ao período; sem numAvail = desconhecido", () => {
    const { itens, divergencias } = normalizarCalendario(
      [
        { roomId: 200, calendar: [{ from: "2026-10-01", to: "2026-10-03", numAvail: 1, price1: 450, minStay: 2, maxStay: 27, override: "blackout" }, { from: "2026-10-04", price1: 500 }] },
        { roomId: 201, calendar: [{ from: "2026-10-05", to: "2026-10-01" }] },
        { roomId: 202, calendar: [{ from: "2026-10-02", price1: -100 }, { from: "2026-10-02", minStay: -1 }, { from: "2026-10-02", numAvail: -1 }, { from: "2026-10-02", maxStay: 1.5 }, { from: "2026-10-02", override: "voodoo" }] },
        { semRoom: true },
      ],
      "2026-10-02",
      "2026-10-05",
    );
    expect(itens).toEqual([
      { roomId: "200", data: "2026-10-02", livres: 1, preco: 45000, minimoNoites: 2, maximoNoites: 27, bloqueio: "blackout" },
      { roomId: "200", data: "2026-10-03", livres: 1, preco: 45000, minimoNoites: 2, maximoNoites: 27, bloqueio: "blackout" },
      { roomId: "200", data: "2026-10-04", livres: null, preco: 50000, minimoNoites: null, maximoNoites: null, bloqueio: null },
    ]);
    expect(divergencias).toHaveLength(7);
  });

  it("quartos por imóvel", () => {
    const { itens, divergencias } = normalizarQuartos([{ id: 100, name: "Studio", roomTypes: [{ id: 200, name: "Unidade" }, { name: "sem id" }] }, { id: 101 }]);
    expect(itens).toEqual([{ propertyId: "100", roomId: "200", nome: "Unidade" }]);
    expect(divergencias).toHaveLength(2);
  });
});

type Chamada = { url: URL; init: RequestInit };
function fetchFalso(respostas: (Response | Error)[]) {
  const chamadas: Chamada[] = [];
  const f = (async (url: URL, init: RequestInit) => {
    chamadas.push({ url, init });
    const r = respostas.shift();
    if (!r) throw new Error("sem resposta preparada");
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return { f, chamadas };
}
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

describe("cliente HTTP (rede simulada)", () => {
  it("só GET, com token no cabeçalho, filtros na URL e paginação até o fim", async () => {
    const { f, chamadas } = fetchFalso([
      json({ success: true, data: [booking()], pages: { nextPageExists: true } }),
      json({ success: true, data: [booking({ id: 5550002 }), { lixo: true }], pages: { nextPageExists: false } }),
    ]);
    const c = new ClienteBeds24Http({ token: "chave-falsa", fetchImpl: f, agora: () => new Date("2026-09-23T12:00:00Z") });
    const r = await c.reservas({ chegadaDe: "2026-10-01", chegadaAte: "2026-10-31", saidaDe: "2026-10-02", ids: ["5550001", "5550002"], propertyIds: ["100", "101"] });
    expect(r.itens.map((x) => x.idExterno)).toEqual(["5550001", "5550002"]);
    expect(r.divergencias).toHaveLength(1);
    expect(r.lidoEm).toBe("2026-09-23T12:00:00.000Z");
    expect(chamadas).toHaveLength(2);
    for (const ch of chamadas) {
      expect(ch.init.method).toBe("GET");
      expect((ch.init.headers as Record<string, string>).token).toBe("chave-falsa");
    }
    expect(chamadas[0].url.pathname).toBe("/api/v2/bookings");
    expect(chamadas[0].url.searchParams.get("arrivalFrom")).toBe("2026-10-01");
    expect(chamadas[0].url.searchParams.getAll("propertyId")).toEqual(["100", "101"]);
    expect(chamadas[0].url.searchParams.getAll("status")).toEqual(["confirmed", "new", "request", "inquiry", "black", "cancelled"]);
    expect(chamadas[0].url.searchParams.getAll("id")).toEqual(["5550001", "5550002"]);
    expect(chamadas[0].url.searchParams.get("departureFrom")).toBe("2026-10-02");
    expect(chamadas[1].url.searchParams.get("page")).toBe("2");
  });

  it("calendário e quartos usam os endpoints de leitura", async () => {
    const { f, chamadas } = fetchFalso([
      json({ success: true, data: [{ roomId: 200, calendar: [{ from: "2026-10-01", to: "2026-10-01", numAvail: 0, price1: 400 }] }] }),
      json({ success: true, data: [{ id: 100, roomTypes: [{ id: 200, name: "Studio" }] }] }),
    ]);
    const c = new ClienteBeds24Http({ token: "k", fetchImpl: f });
    expect((await c.calendario({ roomIds: ["200"], inicio: "2026-10-01", fim: "2026-10-02" })).itens).toEqual([
      { roomId: "200", data: "2026-10-01", livres: 0, preco: 40000, minimoNoites: null, maximoNoites: null, bloqueio: null },
    ]);
    expect((await c.quartos()).itens).toHaveLength(1);
    expect(chamadas.map((x) => x.url.pathname)).toEqual(["/api/v2/inventory/rooms/calendar", "/api/v2/properties"]);
    expect(chamadas[0].url.searchParams.get("includeNumAvail")).toBe("true");
    expect(chamadas[0].url.searchParams.get("includeMaxStay")).toBe("true");
    expect(chamadas[0].url.searchParams.get("includeOverride")).toBe("true");
    expect(chamadas.every((x) => x.init.method === "GET")).toBe(true);
    expect(await c.calendario({ roomIds: [], inicio: "2026-10-01", fim: "2026-10-02" })).toMatchObject({ itens: [] });
  });

  it("erros viram ErroBeds24 com tipo (nunca lista vazia fingindo sucesso)", async () => {
    const tipo = async (r: Response | Error) => {
      const { f } = fetchFalso([r]);
      try {
        await new ClienteBeds24Http({ token: "k", fetchImpl: f }).reservas({});
        return "sem erro";
      } catch (e) {
        return e instanceof ErroBeds24 ? e.tipo : "outro";
      }
    };
    expect(await tipo(json({}, 401))).toBe("http");
    expect(await tipo(new Response("<html>", { status: 200 }))).toBe("formato");
    expect(await tipo(json({ success: false, data: [] }))).toBe("http");
    expect(await tipo(json({ success: true }))).toBe("formato");
    expect(await tipo(json([1, 2]))).toBe("formato");
    expect(await tipo(new TypeError("fetch failed"))).toBe("rede");
    expect(await tipo(Object.assign(new Error("t"), { name: "TimeoutError" }))).toBe("tempo");
  });

  it("limite de páginas e chave obrigatória", async () => {
    const { f } = fetchFalso(Array.from({ length: 3 }, () => json({ success: true, data: [], pages: { nextPageExists: true } })));
    await expect(new ClienteBeds24Http({ token: "k", fetchImpl: f, maxPaginas: 2 }).reservas({})).rejects.toThrow("páginas");
    expect(() => new ClienteBeds24Http({ token: "" })).toThrow(ErroBeds24);
    expect(leitorDoAmbiente({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(leitorDoAmbiente({ BEDS24_API_KEY: "k" } as unknown as NodeJS.ProcessEnv)).toBeInstanceOf(ClienteBeds24Http);
  });

  it("a única escrita é o calendário por noite: POST com faixas, preço em reais e resposta por quarto", async () => {
    const { f, chamadas } = fetchFalso([json([{ success: true }, { success: false, errors: [{ action: "update", field: "price1", message: "Preço inválido" }] }], 201)]);
    const c = new ClienteBeds24Http({ token: "k", fetchImpl: f });
    const metodos = Object.getOwnPropertyNames(Object.getPrototypeOf(c)).filter((m) => !m.startsWith("constructor"));
    expect(metodos.sort()).toEqual(["calendario", "chamar", "escreverCalendario", "get", "quartos", "reservas", "todas"]);
    const r = await c.escreverCalendario([
      { roomId: "200", faixas: [{ from: "2026-10-01", to: "2026-10-03", preco: 45050, minimo: 2, maximo: 27 }, { from: "2026-10-04", to: "2026-10-04", bloqueio: "blackout" }] },
      { roomId: "201", faixas: [{ from: "2026-10-01", to: "2026-10-01", preco: 100 }] },
    ]);
    expect(r).toEqual([{ roomId: "200", ok: true, erro: "" }, { roomId: "201", ok: false, erro: "Preço inválido" }]);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].init.method).toBe("POST");
    expect(chamadas[0].url.pathname).toBe("/api/v2/inventory/rooms/calendar");
    expect((chamadas[0].init.headers as Record<string, string>).token).toBe("k");
    expect(JSON.parse(String(chamadas[0].init.body))).toEqual([
      { roomId: 200, calendar: [{ from: "2026-10-01", to: "2026-10-03", price1: 450.5, minStay: 2, maxStay: 27 }, { from: "2026-10-04", to: "2026-10-04", override: "blackout" }] },
      { roomId: 201, calendar: [{ from: "2026-10-01", to: "2026-10-01", price1: 1 }] },
    ]);
    expect(await c.escreverCalendario([])).toEqual([]);
  });

  it("escrita recusada, sem permissão ou com resposta estranha nunca passa por sucesso", async () => {
    const tentar = async (r: Response | Error) => {
      const c = new ClienteBeds24Http({ token: "k", fetchImpl: fetchFalso([r]).f });
      try {
        return await c.escreverCalendario([{ roomId: "200", faixas: [{ from: "2026-10-01", to: "2026-10-01", preco: 100 }] }]);
      } catch (e) {
        return e instanceof ErroBeds24 ? `${e.tipo}: ${e.message}` : "outro";
      }
    };
    expect(await tentar(json({ success: false }, 403))).toContain("http: Beds24 recusou a escrita (HTTP 403)");
    expect(await tentar(json([], 500))).toContain("http:");
    expect(await tentar(json({ success: true }, 201))).toEqual([{ roomId: "200", ok: false, erro: expect.stringContaining("inesperado") }]);
    expect(await tentar(json([{ success: false }], 201))).toEqual([{ roomId: "200", ok: false, erro: "Beds24 recusou a escrita deste quarto." }]);
    expect(await tentar(new TypeError("fetch failed"))).toContain("rede:");
  });

  it("o escritor só sai do ambiente com credencial e BEDS24_ESCRITA exatamente 'ligada'", () => {
    const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
    expect(escritorDoAmbiente(env({ BEDS24_API_KEY: "k" }))).toBeNull();
    expect(escritorDoAmbiente(env({ BEDS24_API_KEY: "k", BEDS24_ESCRITA: "true" }))).toBeNull();
    expect(escritorDoAmbiente(env({ BEDS24_API_KEY: "k", BEDS24_ESCRITA: "LIGADA" }))).toBeNull();
    expect(escritorDoAmbiente(env({ BEDS24_ESCRITA: "ligada" }))).toBeNull();
    expect(escritorDoAmbiente(env({ BEDS24_REFRESH_TOKEN: "r", BEDS24_ESCRITA: "ligada" }))).toBeInstanceOf(ClienteBeds24Http);
    expect(escritaBeds24Ligada(env({ BEDS24_ESCRITA: " ligada " }))).toBe(true);
    expect(escritaBeds24Ligada(env({}))).toBe(false);
  });
});

describe("Beds24 falso", () => {
  it("filtra como o real e simula falha", async () => {
    const b = new Beds24Falso();
    b.bookings = [booking(), booking({ id: 2, arrival: "2026-11-01", departure: "2026-11-03", propertyId: 101 })];
    expect((await b.reservas({ chegadaAte: "2026-10-31" })).itens).toHaveLength(1);
    expect((await b.reservas({ propertyIds: ["101"] })).itens.map((r) => r.idExterno)).toEqual(["2"]);
    b.falhar = new ErroBeds24("fora do ar", "rede");
    await expect(b.reservas({})).rejects.toThrow("fora do ar");
  });

  it("escrita falsa altera o calendário em memória, dia a dia, e a releitura reflete o gravado", async () => {
    const b = new Beds24Falso();
    b.calendarios = [{ roomId: 200, calendar: [{ from: "2026-10-01", to: "2026-10-05", numAvail: 1, price1: 400, minStay: 1 }] }];
    const r = await b.escreverCalendario([
      { roomId: "200", faixas: [{ from: "2026-10-02", to: "2026-10-03", preco: 45050, minimo: 2, maximo: 27 }, { from: "2026-10-04", to: "2026-10-04", bloqueio: "blackout" }] },
      { roomId: "300", faixas: [{ from: "2026-10-01", to: "2026-10-01", preco: 10000 }] },
    ]);
    expect(r).toEqual([{ roomId: "200", ok: true, erro: "" }, { roomId: "300", ok: true, erro: "" }]);
    const lido = (await b.calendario({ roomIds: ["200", "300"], inicio: "2026-10-01", fim: "2026-10-06" })).itens;
    expect(lido.find((d) => d.data === "2026-10-01")).toMatchObject({ preco: 40000, minimoNoites: 1, maximoNoites: null, bloqueio: null, livres: 1 });
    expect(lido.find((d) => d.data === "2026-10-02")).toMatchObject({ preco: 45050, minimoNoites: 2, maximoNoites: 27, livres: 1 });
    expect(lido.find((d) => d.data === "2026-10-04")).toMatchObject({ preco: 40000, bloqueio: "blackout", livres: 0 });
    expect(lido.find((d) => d.roomId === "300")).toMatchObject({ data: "2026-10-01", preco: 10000 });
    expect(b.escritas).toHaveLength(1);
    b.recusarQuartos = ["200"];
    expect((await b.escreverCalendario([{ roomId: "200", faixas: [] }]))[0].ok).toBe(false);
    b.falharEscrita = new ErroBeds24("sem permissão", "http");
    await expect(b.escreverCalendario([])).rejects.toThrow("sem permissão");
    expect((await b.calendario({ roomIds: ["200"], inicio: "2026-10-01", fim: "2026-10-02" })).itens).toHaveLength(1);
  });
});

describe("conversão para reserva SCL", () => {
  let db: Db;
  let close: () => Promise<void>;
  let org: string;
  let im: string;
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    [{ id: org }] = await db.insert(organizacoes).values({ nome: "A" }).returning();
    [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "102", nome: "Studio" }).returning();
    await adicionarIdExterno(db, org, im, { canal: "beds24", idExterno: "100", detalhe: "200" }, null);
  });
  afterEach(() => close());

  it("usa o mapeamento de IDs; sem mapeamento vira divergência; bloqueio fica separado", async () => {
    const b = new Beds24Falso();
    b.bookings = [booking(), booking({ id: 2, roomId: 999, propertyId: 555 }), booking({ id: 3, status: "black" })];
    const { itens } = await b.reservas({});
    const lote = await converterLote(db, org, itens);
    expect(lote.prontas).toHaveLength(1);
    expect(lote.prontas[0]).toMatchObject({ idFonte: "5550001", dados: { imovelId: im, origem: "airbnb", valorBruto: 150050, taxaCanal: 22500, codigoCanal: "HMFAKE123" } });
    expect(lote.divergencias[0].motivo).toContain("sem mapeamento");
    expect(lote.bloqueios.map((x) => x.idExterno)).toEqual(["3"]);
    // e os dados convertidos passam na validação/sincronização de reservas
    const r = await sincronizarReserva(db, org, "beds24", lote.prontas[0].idFonte, lote.prontas[0].dados);
    expect(r).toMatchObject({ ok: true, criada: true });
  });

  it("bloqueio não vira reserva", () => {
    const n = normalizarReserva(booking({ status: "black" }));
    expect(n.ok && paraDadosReserva(n.r, im)).toBeNull();
  });
});

