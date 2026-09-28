import { describe, expect, it, vi } from "vitest";
import { buscarBeds24 } from "./autenticacao";
import { diagnosticarFalhaBeds24 } from "./diagnostico";

const url = new URL("https://beds24.com/api/v2/authentication/token");

describe("diagnóstico de conexão Beds24 sem segredos", () => {
  it.each([
    ["ENOTFOUND", "DNS", "rede"],
    ["ECONNRESET", "interrompida", "rede"],
    ["UND_ERR_CONNECT_TIMEOUT", "tempo-limite", "tempo"],
    ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "certificado HTTPS", "rede"],
  ])("identifica %s na causa do fetch e mostra a etapa", async (code, texto, tipo) => {
    const causa = Object.assign(new Error("TOKEN-PRIVADO"), { code });
    const f = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("TOKEN-PRIVADO", { cause: causa }));
    const erro = await buscarBeds24(f, url, { refreshToken: "TOKEN-PRIVADO" }, 1000).catch(e => e);
    expect(erro).toMatchObject({ tipo, message: expect.stringContaining(texto) });
    expect(erro.message).toContain(code);
    expect(erro.message).toContain("renovação do token");
    expect(JSON.stringify(erro)).not.toContain("TOKEN-PRIVADO");
    expect(String(erro)).not.toContain("TOKEN-PRIVADO");
  });

  it("encontra código de erro em AggregateError e identifica a consulta", () => {
    const erro = new TypeError("privado", { cause: new AggregateError([
      Object.assign(new Error("privado"), { code: "ENETUNREACH" }),
    ]) });
    expect(diagnosticarFalhaBeds24(erro, false).message).toContain("ENETUNREACH. Etapa: consulta de dados.");
  });

  it("esconde códigos desconhecidos, mensagens, causas e ciclos", () => {
    const erro = { code: "TOKEN-PRIVADO", message: "TOKEN-PRIVADO", cause: {} };
    erro.cause = erro;
    const r = diagnosticarFalhaBeds24(erro, true);
    expect(r.message).toContain("sem causa técnica reconhecida");
    expect(String(r)).not.toContain("TOKEN-PRIVADO");
    expect(diagnosticarFalhaBeds24({ code: "toString" }, true).message).toContain("sem causa técnica reconhecida");
  });

  it("informa redirecionamento sem liberar o envio de cabeçalhos", async () => {
    const f = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed", { cause: new Error("unexpected redirect") }));
    await expect(buscarBeds24(f, url, { refreshToken: "ficticio" }, 1000)).rejects.toThrow("redirecionar");
    expect(f.mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store" });
  });

  it.each(["privado\nvalor", "privado\rvalor", "privado valor", "privado\tvalor", "privado\u200bvalor", "privado\u0000valor", ""])("recusa credencial malformada antes da rede (caso %#)", async (valor) => {
    const f = vi.fn<typeof fetch>();
    const erro = await buscarBeds24(f, url, { refreshToken: valor }, 1000).catch(e => e);
    expect(erro).toMatchObject({ tipo: "configuracao" });
    expect(erro.message).toContain("BEDS24_REFRESH_TOKEN");
    expect(String(erro)).not.toContain("privado");
    expect(f).not.toHaveBeenCalled();
  });

  it("mantém a classificação de timeout sem divulgar mensagens", () => {
    const erro = new DOMException("TOKEN-PRIVADO", "TimeoutError");
    expect(diagnosticarFalhaBeds24(erro, false)).toMatchObject({ tipo: "tempo", message: expect.stringContaining("consulta de dados") });
    expect(String(diagnosticarFalhaBeds24(erro, false))).not.toContain("TOKEN-PRIVADO");
  });
});
