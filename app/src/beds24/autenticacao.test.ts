import { afterEach, describe, expect, it, vi } from "vitest";
import { ClienteBeds24Http, leitorDoAmbiente } from "./http";

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });
const vazio = () => json({ success: true, data: [] });
const acesso = (token = "acesso-ficticio", expiresIn = 3600) => json({ token, expiresIn });
const env = (valores: Record<string, string>) => valores as NodeJS.ProcessEnv;
function preparar(respostas: (Response | Error)[], opcoes: { agora?: () => Date; token?: string; refreshToken?: string } = {}) {
  const fetchImpl = vi.fn<typeof fetch>(async () => {
    const r = respostas.shift();
    if (!r) throw new Error("Resposta simulada esgotada");
    if (r instanceof Error) throw r;
    return r;
  });
  const cliente = new ClienteBeds24Http({ refreshToken: "refresh-ficticio", fetchImpl, ...opcoes });
  const caminhos = () => fetchImpl.mock.calls.map(([url]) => new URL(String(url)).pathname);
  return { cliente, fetchImpl, caminhos };
}
afterEach(() => { vi.unstubAllGlobals(); leitorDoAmbiente(env({})); });

describe("autenticação Beds24 com refresh token (sem rede)", () => {
  it("troca o refresh e usa apenas o token de acesso nas consultas/paginação", async () => {
    const { cliente, fetchImpl, caminhos } = preparar([
      acesso(), json({ success: true, data: [], pages: { nextPageExists: true } }), vazio(), vazio(),
    ], { token: "legado-nao-usar" });
    await cliente.reservas({});
    await cliente.quartos();
    expect(caminhos()).toEqual(["/api/v2/authentication/token", "/api/v2/bookings", "/api/v2/bookings", "/api/v2/properties"]);
    expect(fetchImpl.mock.calls[0][1]?.headers).toEqual({ accept: "application/json", refreshToken: "refresh-ficticio" });
    for (const [url, init] of fetchImpl.mock.calls) {
      expect(init).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
      expect(String(url)).not.toContain("ficticio");
    }
    for (const [, init] of fetchImpl.mock.calls.slice(1)) {
      expect(init?.headers).toEqual({ accept: "application/json", token: "acesso-ficticio" });
    }
  });

  it("respeita expiresIn e renova antes de vencer (não presume 24h)", async () => {
    let tempo = 0;
    const { cliente, caminhos, fetchImpl } = preparar([acesso("primeiro", 120), vazio(), vazio(), acesso("segundo", 120), vazio()], { agora: () => new Date(tempo) });
    await cliente.quartos();
    tempo = 107_000;
    await cliente.quartos();
    tempo = 108_000; // 120 segundos, com margem de 10%.
    await cliente.quartos();
    expect(caminhos().filter((p) => p.endsWith("/token"))).toHaveLength(2);
    expect(fetchImpl.mock.calls.at(-1)?.[1]?.headers).toMatchObject({ token: "segundo" });
  });

  it("compartilha uma renovação entre consultas simultâneas", async () => {
    let liberar!: (r: Response) => void;
    const pendente = new Promise<Response>((resolve) => { liberar = resolve; });
    const f = vi.fn<typeof fetch>(async (url) => String(url).endsWith("/token") ? pendente : vazio());
    const c = new ClienteBeds24Http({ refreshToken: "refresh", fetchImpl: f });
    const consultas = Promise.all([c.quartos(), c.reservas({}), c.quartos()]);
    expect(f).toHaveBeenCalledTimes(1);
    liberar(acesso());
    await consultas;
    expect(f.mock.calls.filter(([u]) => String(u).endsWith("/token"))).toHaveLength(1);
  });

  it("401 renova e repete a consulta uma vez", async () => {
    const { cliente, caminhos, fetchImpl } = preparar([acesso("antigo"), json({}, 401), acesso("novo"), vazio()]);
    await cliente.quartos();
    expect(caminhos()).toEqual(["/api/v2/authentication/token", "/api/v2/properties", "/api/v2/authentication/token", "/api/v2/properties"]);
    expect(fetchImpl.mock.calls[3][1]?.headers).toMatchObject({ token: "novo" });
  });

  it("um 401 atrasado reutiliza o token que outra consulta já renovou", async () => {
    let liberar401!: (r: Response) => void;
    const atraso = new Promise<Response>((resolve) => { liberar401 = resolve; });
    let trocas = 0;
    let antigas = 0;
    const f = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith("/token")) return acesso(++trocas === 1 ? "antigo" : "novo");
      if ((init?.headers as Record<string, string>).token === "antigo") {
        return ++antigas === 1 ? atraso : json({}, 401);
      }
      return vazio();
    });
    const c = new ClienteBeds24Http({ refreshToken: "refresh", fetchImpl: f });
    const primeira = c.quartos();
    await c.reservas({});
    liberar401(json({}, 401));
    await primeira;
    expect(trocas).toBe(2);
  });

  it("para no segundo 401, sem loop de renovação", async () => {
    const { cliente, fetchImpl } = preparar([acesso(), json({}, 401), acesso("novo"), json({}, 401)]);
    // O status vai no erro (M8.3c): o 429, o 401 e o 403 de uma leitura param a volta do envio de reservas.
    await expect(cliente.quartos()).rejects.toMatchObject({ tipo: "http", message: "Beds24 respondeu HTTP 401.", status: 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it.each([403, 429, 500])("HTTP %s não dispara renovação/repetição", async (status) => {
    const { cliente, fetchImpl } = preparar([acesso(), json({}, status)]);
    await expect(cliente.quartos()).rejects.toMatchObject({ tipo: "http", status });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    null, [], {}, { token: "", expiresIn: 3600 }, { token: "a\nb", expiresIn: 3600 },
    { token: "x" }, { token: "x", expiresIn: "3600" }, { token: "x", expiresIn: 0 },
    { token: "x", expiresIn: -1 }, { token: "x", expiresIn: 1.5 },
    { token: "x", expiresIn: Number.MAX_SAFE_INTEGER }, { success: false, token: "x", expiresIn: 3600 },
  ])("rejeita resposta inválida sem consultar reservas: %j", async (corpo) => {
    const { cliente, fetchImpl } = preparar([json(corpo)]);
    await expect(cliente.reservas({})).rejects.toMatchObject({ tipo: "formato" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("recupera depois de falha na renovação, sem vazar corpo/segredos", async () => {
    const { cliente, caminhos } = preparar([json({ error: "refresh-ficticio NAO MOSTRAR" }, 401), acesso(), vazio()]);
    await expect(cliente.quartos()).rejects.toMatchObject({
      tipo: "http", message: "Beds24 recusou a renovação (HTTP 401). Confira o refresh token, sua validade e as restrições de acesso.",
    });
    await cliente.quartos();
    expect(caminhos()).toEqual(["/api/v2/authentication/token", "/api/v2/authentication/token", "/api/v2/properties"]);
  });

  it.each([
    [new TypeError("refresh-ficticio"), "rede"],
    [Object.assign(new Error("refresh-ficticio"), { name: "TimeoutError" }), "tempo"],
    [new Response("refresh-ficticio nao-json"), "formato"],
  ])("falhas na autenticação são classificadas sem expor segredos", async (falha, tipo) => {
    const { cliente } = preparar([falha as Response | Error]);
    const erro = await cliente.quartos().catch((e: unknown) => e);
    expect(erro).toMatchObject({ tipo });
    expect(String(erro)).not.toContain("refresh-ficticio");
  });

  it("mantém token direto compatível e não tenta renová-lo em 401", async () => {
    const { cliente, fetchImpl, caminhos } = preparar([vazio(), json({}, 401)], { refreshToken: undefined, token: "long-life" });
    await cliente.quartos();
    await expect(cliente.quartos()).rejects.toMatchObject({ tipo: "http" });
    expect(caminhos()).toEqual(["/api/v2/properties", "/api/v2/properties"]);
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ token: "long-life" });
  });

  it("usa BEDS24_REFRESH_TOKEN, reaproveita cliente e troca ao mudar a credencial", async () => {
    const { fetchImpl } = preparar([acesso(), vazio(), vazio(), acesso("outro"), vazio()]);
    vi.stubGlobal("fetch", fetchImpl);
    const primeiro = leitorDoAmbiente(env({ BEDS24_REFRESH_TOKEN: " refresh-1 ", BEDS24_API_KEY: "ignorado" }))!;
    await primeiro.quartos();
    const segundo = leitorDoAmbiente(env({ BEDS24_REFRESH_TOKEN: "refresh-1" }))!;
    expect(segundo).toBe(primeiro);
    await segundo.quartos();
    const terceiro = leitorDoAmbiente(env({ BEDS24_REFRESH_TOKEN: "refresh-2" }))!;
    expect(terceiro).not.toBe(primeiro);
    await terceiro.quartos();
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ refreshToken: "refresh-1" });
    expect(fetchImpl.mock.calls[3][1]?.headers).toMatchObject({ refreshToken: "refresh-2" });
    expect(leitorDoAmbiente(env({ BEDS24_REFRESH_TOKEN: "  " }))).toBeNull();
  });
});
