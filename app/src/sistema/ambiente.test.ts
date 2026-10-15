import { afterEach, describe, expect, it, vi } from "vitest";
import { ambienteDeTeste, ambienteDoSistema, deployDeProducao, motivoDaProducao } from "./ambiente";

const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;

describe("onde o sistema roda (M7.12): uma regra só para a faixa e o pagamento", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("na Vercel vale o VERCEL_ENV: prévia e `vercel dev` são teste; produção e qualquer outro valor contam como produção", () => {
    expect(ambienteDoSistema(env({ VERCEL_ENV: "preview" }))).toBe("previa");
    expect(ambienteDoSistema(env({ VERCEL_ENV: " preview " }))).toBe("previa");
    expect(ambienteDoSistema(env({ VERCEL_ENV: "development" }))).toBe("desenvolvimento");
    expect(ambienteDoSistema(env({ VERCEL_ENV: "production" }))).toBe("producao");
    // Deny-by-default: valor inesperado ou só com outra grafia não vira teste.
    for (const v of ["staging", "Preview", "prod", "test"]) expect(ambienteDoSistema(env({ VERCEL_ENV: v })), v).toBe("producao");
    // O build da prévia roda com NODE_ENV=production: o VERCEL_ENV manda.
    expect(ambienteDoSistema(env({ VERCEL_ENV: "preview", NODE_ENV: "production" }))).toBe("previa");
    expect(ambienteDoSistema(env({ VERCEL_ENV: "production", NODE_ENV: "development" }))).toBe("producao");
  });

  it("sem VERCEL_ENV (ou vazio): o computador de desenvolvimento e os testes são teste; NODE_ENV=production conta como produção", () => {
    expect(ambienteDoSistema(env({}))).toBe("desenvolvimento");
    expect(ambienteDoSistema(env({ NODE_ENV: "development" }))).toBe("desenvolvimento");
    expect(ambienteDoSistema(env({ NODE_ENV: "test" }))).toBe("desenvolvimento");
    expect(ambienteDoSistema(env({ VERCEL_ENV: "  ", NODE_ENV: "development" }))).toBe("desenvolvimento");
    expect(ambienteDoSistema(env({ NODE_ENV: "production" }))).toBe("producao");
  });

  it("ambienteDeTeste: tudo menos a produção", () => {
    const casos = (lista: Record<string, string>[]) => lista.map((v) => ambienteDeTeste(env(v)));
    expect(casos([{ VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }, {}, { NODE_ENV: "development" }])).toEqual([true, true, true, true]);
    expect(casos([{ VERCEL_ENV: "production" }, { VERCEL_ENV: "staging" }, { NODE_ENV: "production" }])).toEqual([false, false, false]);
  });

  it("por que conta como produção (revisão do M7.12): o deploy de verdade ou só pela regra, sem chamar de deploy o que não é", () => {
    expect(motivoDaProducao(env({ VERCEL_ENV: "production" }))).toBe("deploy");
    expect(motivoDaProducao(env({ VERCEL_ENV: " production ", NODE_ENV: "development" }))).toBe("deploy");
    for (const v of ["staging", "Preview", "prod"]) expect(motivoDaProducao(env({ VERCEL_ENV: v })), v).toBe("vercel_inesperado");
    expect(motivoDaProducao(env({ NODE_ENV: "production" }))).toBe("node_env_producao");
    expect(motivoDaProducao(env({ VERCEL_ENV: "  ", NODE_ENV: "production" }))).toBe("node_env_producao");
    // Fora da produção, nenhum motivo.
    const foraDaProducao: Record<string, string>[] = [{ VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }, {}, { NODE_ENV: "development" }];
    for (const v of foraDaProducao) expect(motivoDaProducao(env(v))).toBeNull();
    // deployDeProducao: só o deploy de verdade.
    const casos: Record<string, string>[] = [{ VERCEL_ENV: "production" }, { VERCEL_ENV: "staging" }, { NODE_ENV: "production" }, { VERCEL_ENV: "preview" }, {}];
    expect(casos.map((v) => deployDeProducao(env(v)))).toEqual([true, false, false, false, false]);
  });

  it("sem argumento, lê o process.env de agora", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(ambienteDeTeste()).toBe(true);
    vi.stubEnv("VERCEL_ENV", "production");
    expect(ambienteDeTeste()).toBe(false);
    expect(ambienteDoSistema()).toBe("producao");
    expect(deployDeProducao()).toBe(true);
    expect(motivoDaProducao()).toBe("deploy");
  });
});
