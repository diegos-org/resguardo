import { afterEach, describe, expect, it } from "vitest";
import { ambienteMercadoPago, contaDeTesteConfirmada, esquecerProvedorDoAmbiente, estadoPagamentoDoAmbiente, provedorDoAmbiente, VALIDADE_CONFERENCIA_MS } from "./ambiente";
import { ProvedorFalso } from "./falso";
import { ClienteMercadoPagoHttp } from "./mercadopago";
import type { ProvedorPagamento } from "./provedor";

// Valores fictícios.
const TOKEN = "APP_USR-1111111111111111-111111-ficticio1111111111111111111111-111111111";
const PUBLICA = "APP_USR-ficticia-0000-0000-0000-000000000000";
const SEGREDO = "segredo-ficticio-webhook";
const env = (over: Record<string, string | undefined> = {}) => ({ MERCADOPAGO_ACCESS_TOKEN: TOKEN, MERCADOPAGO_PUBLIC_KEY: PUBLICA, ...over }) as unknown as NodeJS.ProcessEnv;

afterEach(() => esquecerProvedorDoAmbiente());

describe("MERCADOPAGO_AMBIENTE", () => {
  it.each([
    [undefined, "teste"], ["", "teste"], ["  ", "teste"], ["teste", "teste"], [" teste ", "teste"],
    ["producao", "producao"], [" producao ", "producao"],
    // Só o valor exato: qualquer variação desliga (deny-by-default).
    ["TESTE", null], ["Produção", null], ["produção", null], ["PRODUCAO", null],
    ["prod", null], ["test", null], ["sandbox", null], ["production", null], [TOKEN, null],
  ])("%j → %s", (valor, esperado) => {
    expect(ambienteMercadoPago(valor)).toBe(esperado);
  });
});

describe("estadoPagamentoDoAmbiente", () => {
  it("teste com as duas chaves (aparadas) e o segredo do webhook", () => {
    expect(estadoPagamentoDoAmbiente(env({ MERCADOPAGO_PUBLIC_KEY: `  ${PUBLICA}\n`, MERCADOPAGO_WEBHOOK_SECRET: ` ${SEGREDO} ` }))).toEqual({ situacao: "teste", chavePublica: PUBLICA, segredoWebhook: SEGREDO });
    expect(estadoPagamentoDoAmbiente(env({ MERCADOPAGO_AMBIENTE: "teste" }))).toEqual({ situacao: "teste", chavePublica: PUBLICA, segredoWebhook: null });
    expect(estadoPagamentoDoAmbiente(env({ MERCADOPAGO_WEBHOOK_SECRET: "  " }))).toMatchObject({ segredoWebhook: null });
  });

  it("sem chaves → desligado, dizendo qual falta", () => {
    expect(estadoPagamentoDoAmbiente({} as unknown as NodeJS.ProcessEnv)).toEqual({ situacao: "desligado", motivo: "Falta configurar MERCADOPAGO_ACCESS_TOKEN e MERCADOPAGO_PUBLIC_KEY." });
    expect(estadoPagamentoDoAmbiente(env({ MERCADOPAGO_ACCESS_TOKEN: " " }))).toEqual({ situacao: "desligado", motivo: "Falta configurar MERCADOPAGO_ACCESS_TOKEN." });
    expect(estadoPagamentoDoAmbiente(env({ MERCADOPAGO_PUBLIC_KEY: undefined }))).toEqual({ situacao: "desligado", motivo: "Falta configurar MERCADOPAGO_PUBLIC_KEY." });
  });

  it("chave com espaço ou quebra no meio → desligado, sem repetir a chave", () => {
    const e = estadoPagamentoDoAmbiente(env({ MERCADOPAGO_ACCESS_TOKEN: `${TOKEN}\nAPP_USR-outra` }));
    expect(e).toMatchObject({ situacao: "desligado" });
    expect(JSON.stringify(e)).not.toContain(TOKEN);
    expect(estadoPagamentoDoAmbiente(env({ MERCADOPAGO_PUBLIC_KEY: "a b" }))).toMatchObject({ situacao: "desligado" });
  });

  it("ambiente inesperado → desligado, sem ecoar o valor", () => {
    const e = estadoPagamentoDoAmbiente(env({ MERCADOPAGO_AMBIENTE: TOKEN }));
    expect(e).toMatchObject({ situacao: "desligado" });
    expect(JSON.stringify(e)).not.toContain(TOKEN);
  });

  it("produção trava (a parte a nunca cobra em produção)", () => {
    expect(estadoPagamentoDoAmbiente(env({ MERCADOPAGO_AMBIENTE: "producao", MERCADOPAGO_WEBHOOK_SECRET: SEGREDO }))).toEqual({ situacao: "producao_travada" });
    expect(estadoPagamentoDoAmbiente(env({ MERCADOPAGO_AMBIENTE: "produção" }))).toMatchObject({ situacao: "desligado" });
    // Sem chaves continua desligado (o motivo mais útil para quem configura).
    expect(estadoPagamentoDoAmbiente({ MERCADOPAGO_AMBIENTE: "producao" } as unknown as NodeJS.ProcessEnv)).toMatchObject({ situacao: "desligado" });
  });

  it("no deploy de produção da Vercel o teste não roda (o banco ali é o real)", () => {
    expect(estadoPagamentoDoAmbiente(env({ VERCEL_ENV: "production" }))).toEqual({ situacao: "so_nas_previas" });
    expect(estadoPagamentoDoAmbiente(env({ VERCEL_ENV: "preview" }))).toMatchObject({ situacao: "teste" });
    expect(provedorDoAmbiente(env({ VERCEL_ENV: "production" }))).toBeNull();
    // Produção travada continua travada (e diz isso), em qualquer deploy.
    expect(estadoPagamentoDoAmbiente(env({ VERCEL_ENV: "production", MERCADOPAGO_AMBIENTE: "producao" }))).toEqual({ situacao: "producao_travada" });
  });

  it("nada no estado carrega o access token", () => {
    for (const e of [env(), env({ MERCADOPAGO_AMBIENTE: "producao" }), env({ MERCADOPAGO_PUBLIC_KEY: "" })]) {
      expect(JSON.stringify(estadoPagamentoDoAmbiente(e))).not.toContain(TOKEN);
    }
  });
});

describe("provedorDoAmbiente", () => {
  it("só existe em teste; reaproveitado enquanto a chave não muda", () => {
    const a = provedorDoAmbiente(env());
    expect(a).toBeInstanceOf(ClienteMercadoPagoHttp);
    expect(a?.nome).toBe("mercadopago");
    expect(provedorDoAmbiente(env())).toBe(a);
    expect(provedorDoAmbiente(env({ MERCADOPAGO_ACCESS_TOKEN: `${TOKEN}2` }))).not.toBe(a);
    expect(provedorDoAmbiente(env({ MERCADOPAGO_AMBIENTE: "producao" }))).toBeNull();
    expect(provedorDoAmbiente({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(provedorDoAmbiente(env({ MERCADOPAGO_AMBIENTE: "xyz" }))).toBeNull();
  });

  it("fetch próprio cria outro cliente e é usado nas chamadas", async () => {
    const urls: string[] = [];
    const f = (async (u: string | URL | Request) => {
      urls.push(String(u));
      return new Response(JSON.stringify({ tags: ["test_user"] }), { status: 200 });
    }) as typeof fetch;
    const p = provedorDoAmbiente(env(), f)!;
    expect(p).not.toBe(provedorDoAmbiente(env()));
    expect(await p.conferirContaDeTeste()).toBe(true);
    expect(urls).toEqual(["https://api.mercadopago.com/users/me"]);
  });

  it("esquecer recria o cliente", () => {
    const a = provedorDoAmbiente(env());
    esquecerProvedorDoAmbiente();
    expect(provedorDoAmbiente(env())).not.toBe(a);
  });
});

describe("contaDeTesteConfirmada", () => {
  const relogio = (inicio = new Date("2026-10-08T15:00:00Z")) => {
    let t = inicio.getTime();
    return { agora: () => new Date(t), andar: (ms: number) => { t += ms; } };
  };
  const contar = (p: ProvedorFalso) => p.chamadas.filter((c) => c.metodo === "conferirContaDeTeste").length;

  it("true é lembrado por 10 minutos", async () => {
    const r = relogio();
    const p = new ProvedorFalso(r.agora);
    expect(await contaDeTesteConfirmada(p, r.agora)).toBe(true);
    p.contaDeTeste = false;
    r.andar(VALIDADE_CONFERENCIA_MS.confirmada - 1);
    expect(await contaDeTesteConfirmada(p, r.agora)).toBe(true);
    expect(contar(p)).toBe(1);
    r.andar(1);
    expect(await contaDeTesteConfirmada(p, r.agora)).toBe(false);
    expect(contar(p)).toBe(2);
  });

  it("false e null são lembrados só por 1 minuto", async () => {
    const r = relogio();
    const p = new ProvedorFalso(r.agora);
    p.contaDeTeste = false;
    expect(await contaDeTesteConfirmada(p, r.agora)).toBe(false);
    r.andar(VALIDADE_CONFERENCIA_MS.outra - 1);
    expect(await contaDeTesteConfirmada(p, r.agora)).toBe(false);
    expect(contar(p)).toBe(1);
    p.contaDeTeste = null;
    r.andar(1);
    expect(await contaDeTesteConfirmada(p, r.agora)).toBeNull();
    expect(contar(p)).toBe(2);
    p.contaDeTeste = true;
    r.andar(VALIDADE_CONFERENCIA_MS.outra);
    expect(await contaDeTesteConfirmada(p, r.agora)).toBe(true);
    expect(contar(p)).toBe(3);
  });

  it("sem provedor, provedor que lança ou resposta estranha → null (não cobrar)", async () => {
    expect(await contaDeTesteConfirmada(null)).toBeNull();
    const com = (conferir: ProvedorPagamento["conferirContaDeTeste"]) => Object.assign(new ProvedorFalso(), { conferirContaDeTeste: conferir });
    expect(await contaDeTesteConfirmada(com(() => { throw new Error("x"); }))).toBeNull();
    expect(await contaDeTesteConfirmada(com(() => Promise.reject(new Error("x"))))).toBeNull();
    expect(await contaDeTesteConfirmada(com(async () => "sim" as never))).toBeNull();
  });

  it("chamadas simultâneas esperam a mesma conferência; provedores diferentes não se misturam", async () => {
    const r = relogio();
    const p = new ProvedorFalso(r.agora);
    const outro = new ProvedorFalso(r.agora);
    outro.contaDeTeste = false;
    const respostas = await Promise.all([contaDeTesteConfirmada(p, r.agora), contaDeTesteConfirmada(p, r.agora), contaDeTesteConfirmada(outro, r.agora)]);
    expect(respostas).toEqual([true, true, false]);
    expect(contar(p)).toBe(1);
    expect(contar(outro)).toBe(1);
  });

  it("pelo cliente HTTP do ambiente: true, false e null conforme /users/me", async () => {
    const resposta = (corpo: unknown, status = 200) => (async () => new Response(JSON.stringify(corpo), { status })) as typeof fetch;
    expect(await contaDeTesteConfirmada(provedorDoAmbiente(env(), resposta({ tags: ["normal", "test_user"] })))).toBe(true);
    esquecerProvedorDoAmbiente();
    expect(await contaDeTesteConfirmada(provedorDoAmbiente(env(), resposta({ tags: ["normal"] })))).toBe(false);
    esquecerProvedorDoAmbiente();
    expect(await contaDeTesteConfirmada(provedorDoAmbiente(env(), resposta({}, 500)))).toBeNull();
    esquecerProvedorDoAmbiente();
    expect(await contaDeTesteConfirmada(provedorDoAmbiente(env({ MERCADOPAGO_AMBIENTE: "producao" }), resposta({ tags: ["test_user"] })))).toBeNull();
  });

  it("esquecer apaga as conferências lembradas", async () => {
    const r = relogio();
    const p = new ProvedorFalso(r.agora);
    await contaDeTesteConfirmada(p, r.agora);
    esquecerProvedorDoAmbiente();
    p.contaDeTeste = false;
    expect(await contaDeTesteConfirmada(p, r.agora)).toBe(false);
  });
});
