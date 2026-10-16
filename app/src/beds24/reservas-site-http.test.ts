/**
 * Reserva paga do site no Beds24 (M8.3a) — a trava de ambiente (desenho 2.2; seção 10, testes 1 e 2) e a leitura nova do
 * cliente HTTP: filtros (quarto, chegada exata, busca, info items) e GET /authentication/details. Rede SIMULADA: o
 * `fetch` é injetado; nenhum teste chega ao Beds24 (a barreira do setup derrubaria).
 */
import { describe, expect, it } from "vitest";
import { ClienteBeds24Http, credencialDeEscritaForaDaProducao, escritaBeds24Ligada, escritaBeds24Pronta, escritaReservasBeds24Ligada, escritaReservasBeds24Pronta, escritorDoAmbiente } from "./http";
import { normalizarCredencial } from "./normalizar";

const env = (o: Record<string, string | undefined>) => o as unknown as NodeJS.ProcessEnv;
/** As quatro condições juntas: deploy de produção, NODE_ENV de produção, a chave e o refresh token. */
const PRONTO = { VERCEL_ENV: "production", NODE_ENV: "production", BEDS24_ESCRITA_RESERVAS: "ligada", BEDS24_REFRESH_TOKEN: "refresh-ficticio" };

describe("trava de ambiente da escrita de reservas (desenho 2.2; testes 1 e 2)", () => {
  it("só com as quatro condições juntas (e espaços em volta da chave não atrapalham)", () => {
    expect(escritaReservasBeds24Pronta(env(PRONTO))).toBe(true);
    expect(escritaReservasBeds24Pronta(env({ ...PRONTO, BEDS24_ESCRITA_RESERVAS: " ligada " }))).toBe(true);
  });

  it.each([
    ["VERCEL_ENV preview", { VERCEL_ENV: "preview" }],
    ["VERCEL_ENV development", { VERCEL_ENV: "development" }],
    ["sem VERCEL_ENV", { VERCEL_ENV: undefined }],
    ["VERCEL_ENV estranho", { VERCEL_ENV: "producao" }],
    ["NODE_ENV test, mesmo com VERCEL_ENV=production", { NODE_ENV: "test" }],
    ["NODE_ENV development, mesmo com VERCEL_ENV=production", { NODE_ENV: "development" }],
    ["sem NODE_ENV", { NODE_ENV: undefined }],
    ["chave ausente", { BEDS24_ESCRITA_RESERVAS: undefined }],
    ["chave \"Ligada\"", { BEDS24_ESCRITA_RESERVAS: "Ligada" }],
    ["chave com outro valor", { BEDS24_ESCRITA_RESERVAS: "sim" }],
    ["sem refresh token", { BEDS24_REFRESH_TOKEN: undefined }],
    ["refresh token em branco", { BEDS24_REFRESH_TOKEN: "   " }],
    ["só a BEDS24_API_KEY (o token direto só lê)", { BEDS24_REFRESH_TOKEN: undefined, BEDS24_API_KEY: "token-direto-ficticio" }],
  ])("falsa: %s", (_nome, troca) => {
    expect(escritaReservasBeds24Pronta(env({ ...PRONTO, ...troca }))).toBe(false);
  });

  it("as chaves são independentes: a do calendário não liga reservas, e a de reservas não liga o calendário", () => {
    const soCalendario = env({ ...PRONTO, BEDS24_ESCRITA_RESERVAS: undefined, BEDS24_ESCRITA: "ligada" });
    expect(escritaBeds24Pronta(soCalendario)).toBe(true);
    expect(escritaReservasBeds24Ligada(soCalendario)).toBe(false);
    expect(escritaReservasBeds24Pronta(soCalendario)).toBe(false);
    const soReservas = env(PRONTO);
    expect(escritaReservasBeds24Pronta(soReservas)).toBe(true);
    expect(escritaBeds24Ligada(soReservas)).toBe(false);
    expect(escritaBeds24Pronta(soReservas)).toBe(false);
    expect(escritorDoAmbiente(soReservas)).toBeNull();
  });

  it("credencial de escrita fora da produção: o refresh token em qualquer lugar que não seja o deploy de produção", () => {
    expect(credencialDeEscritaForaDaProducao(env(PRONTO))).toBe(false);
    expect(credencialDeEscritaForaDaProducao(env({ ...PRONTO, VERCEL_ENV: "preview" }))).toBe(true);
    expect(credencialDeEscritaForaDaProducao(env({ ...PRONTO, NODE_ENV: "development" }))).toBe(true);
    expect(credencialDeEscritaForaDaProducao(env({ VERCEL_ENV: "preview", BEDS24_API_KEY: "token-direto-ficticio" }))).toBe(false);
    expect(credencialDeEscritaForaDaProducao(env({ VERCEL_ENV: "preview" }))).toBe(false);
  });
});

type Chamada = { url: URL; init: RequestInit };
function rede(respostas: Response[]) {
  const chamadas: Chamada[] = [];
  const f = (async (url: URL, init: RequestInit) => {
    chamadas.push({ url, init });
    const r = respostas.shift();
    if (!r) throw new Error("sem resposta preparada");
    return r;
  }) as unknown as typeof fetch;
  return { f, chamadas };
}
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

describe("leitura nova do cliente HTTP (M8.3a)", () => {
  it("procura pela marca: quarto, chegada exata nos dois limites, todas as situações, busca por texto e info items", async () => {
    const { f, chamadas } = rede([json({ success: true, data: [{ id: 1, propertyId: 10, roomId: 20, status: "confirmed", arrival: "2026-12-20", departure: "2026-12-27", infoItems: [{ code: "SCL", text: "SCL-7K2QXM" }] }] })]);
    const c = new ClienteBeds24Http({ token: "k", fetchImpl: f });
    const r = await c.reservas({ quarto: "20", chegadaExata: "2026-12-20", chegadaDe: "2026-01-01", pesquisa: "SCL-7K2QXM", incluirInfo: true });
    expect(r.itens.map((x) => x.referenciaScl)).toEqual(["SCL-7K2QXM"]);
    const p = chamadas[0].url.searchParams;
    expect(chamadas[0].init.method).toBe("GET");
    expect(p.get("roomId")).toBe("20");
    // A chegada exata vale no lugar de chegadaDe/chegadaAte, sempre explícita nos dois limites.
    expect(p.getAll("arrivalFrom")).toEqual(["2026-12-20"]);
    expect(p.getAll("arrivalTo")).toEqual(["2026-12-20"]);
    expect(p.get("searchString")).toBe("SCL-7K2QXM");
    expect(p.get("includeInfoItems")).toBe("true");
    expect(p.getAll("status")).toEqual(["confirmed", "new", "request", "inquiry", "black", "cancelled"]);
  });

  it("sem pedir, nada muda na leitura de antes (sem roomId, searchString nem includeInfoItems)", async () => {
    const { f, chamadas } = rede([json({ success: true, data: [] })]);
    await new ClienteBeds24Http({ token: "k", fetchImpl: f }).reservas({ chegadaDe: "2026-10-01" });
    const p = chamadas[0].url.searchParams;
    for (const k of ["roomId", "searchString", "includeInfoItems", "arrivalTo"]) expect(p.has(k)).toBe(false);
    expect(p.get("arrivalFrom")).toBe("2026-10-01");
  });

  it("GET /authentication/details: só leitura, lê os escopos e não confunde formato desconhecido com em ordem", async () => {
    const { f, chamadas } = rede([json({ validToken: true, token: { scopes: ["write:bookings", "READ:properties", "bookings.write"] } })]);
    const c = new ClienteBeds24Http({ token: "k", fetchImpl: f, agora: () => new Date("2026-10-16T12:00:00Z") });
    expect(await c.credencial()).toEqual({ escopos: ["write:bookings", "read:properties"], ilegiveis: ["bookings.write"], lidoEm: "2026-10-16T12:00:00.000Z" });
    expect(chamadas[0].url.pathname).toBe("/api/v2/authentication/details");
    expect(chamadas[0].init.method).toBe("GET");
    expect(chamadas[0].init.body).toBeUndefined();
  });

  it("resposta de escopos torta ou ausente: null (não deu para ler), nunca lista vazia", () => {
    for (const corpo of [null, [], "x", {}, { validToken: false, token: { scopes: ["write:bookings"] } }, { token: {} }, { token: { scopes: "write:bookings" } }, { scopes: { a: 1 } }]) {
      expect(normalizarCredencial(corpo)).toEqual({ escopos: null, ilegiveis: [] });
    }
    expect(normalizarCredencial({ scopes: ["read:bookings"] })).toEqual({ escopos: ["read:bookings"], ilegiveis: [] });
    expect(normalizarCredencial({ token: { scopes: [1, "", " write:bookings ", "write:bookings", "x".repeat(100)] } })).toEqual({ escopos: ["write:bookings"], ilegiveis: ["(não é texto)", "(vazio)", "x".repeat(60)] });
  });
});
