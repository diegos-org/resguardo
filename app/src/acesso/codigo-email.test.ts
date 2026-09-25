import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codigosLogin, organizacoes, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { chaveIdempotencia, type Correio, CorreioMemoria, CorreioResend, correioDoAmbiente } from "@/email/correio";
import { MAX_CODIGOS_GERAL_POR_HORA, MAX_CODIGOS_POR_HORA, pedirCodigo, verificarCodigo } from "./codigo-email";

let db: Db;
let close: () => Promise<void>;
let correio: CorreioMemoria;
const segredo = "segredo-de-teste";
const t0 = new Date("2026-10-01T12:00:00Z");
const mais = (min: number) => new Date(t0.getTime() + min * 60_000);
const opcoes = (over: object = {}) => ({ segredo, adminEmails: ["chefe@example.com"], agora: t0, gerar: () => "123456", ...over });

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const [org] = await db.insert(organizacoes).values({ nome: "A" }).returning();
  await db.insert(usuarios).values([
    { organizacaoId: org.id, email: "Equipe@Example.com", nome: "Equipe", papel: "operacao" },
    { organizacaoId: org.id, email: "saiu@example.com", nome: "Saiu", papel: "operacao", ativo: false },
  ]);
  correio = new CorreioMemoria();
});
afterEach(() => close());

describe("pedir código", () => {
  it("envia para usuário cadastrado (e-mail sem diferenciar maiúsculas) e guarda só o HMAC", async () => {
    expect(await pedirCodigo(db, correio, " equipe@EXAMPLE.com ", opcoes())).toBe("enviado");
    expect(correio.enviadas).toHaveLength(1);
    expect(correio.enviadas[0]).toMatchObject({ para: "equipe@example.com" });
    expect(correio.enviadas[0].texto).toContain("123456");
    const [linha] = await db.select().from(codigosLogin);
    expect(linha.codigoHash).not.toContain("123456");
    expect(linha.codigoHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("não envia para desconhecido nem para inativo, e não grava nada no banco", async () => {
    expect(await pedirCodigo(db, correio, "estranho@example.com", opcoes())).toBe("sem-acesso");
    expect(await pedirCodigo(db, correio, "saiu@example.com", opcoes())).toBe("sem-acesso");
    expect(await pedirCodigo(db, correio, "nao-e-email", opcoes())).toBe("invalido");
    expect(correio.enviadas).toHaveLength(0);
    expect(await db.select().from(codigosLogin)).toHaveLength(0);
    expect(await verificarCodigo(db, "estranho@example.com", "123456", opcoes())).toMatchObject({ ok: false });
  });

  it("falha no envio: nada muda — o código anterior continua valendo e não conta no limite", async () => {
    await pedirCodigo(db, correio, "equipe@example.com", opcoes());
    const quebrado: Correio = { nome: "quebrado", enviar: async () => Promise.reject(new Error("provedor fora")) };
    for (let i = 0; i < MAX_CODIGOS_POR_HORA + 2; i++) {
      await expect(pedirCodigo(db, quebrado, "equipe@example.com", opcoes({ gerar: () => "999999", agora: mais(1) }))).rejects.toThrow("provedor fora");
    }
    expect(await db.select().from(codigosLogin)).toHaveLength(1);
    expect(await verificarCodigo(db, "equipe@example.com", "123456", opcoes({ agora: mais(2) }))).toMatchObject({ ok: true });
  });

  it("apaga códigos com mais de 1 dia", async () => {
    await pedirCodigo(db, correio, "equipe@example.com", opcoes());
    await pedirCodigo(db, correio, "chefe@example.com", opcoes({ agora: mais(60 * 25) }));
    const linhas = await db.select().from(codigosLogin);
    expect(linhas.map((l) => l.email)).toEqual(["chefe@example.com"]);
  });

  it("admin do primeiro acesso (ADMIN_EMAILS) recebe código", async () => {
    await pedirCodigo(db, correio, "chefe@example.com", opcoes());
    expect(correio.enviadas).toHaveLength(1);
  });

  it("limite de pedidos por hora por e-mail e teto geral", async () => {
    for (let i = 0; i < MAX_CODIGOS_POR_HORA; i++) expect(await pedirCodigo(db, correio, "equipe@example.com", opcoes({ agora: mais(i) }))).toBe("enviado");
    expect(await pedirCodigo(db, correio, "equipe@example.com", opcoes({ agora: mais(10) }))).toBe("limite");
    expect(correio.enviadas).toHaveLength(MAX_CODIGOS_POR_HORA);
    expect(await pedirCodigo(db, correio, "equipe@example.com", opcoes({ agora: mais(61) }))).toBe("enviado");
    // teto geral: simula muitos códigos recentes de outros e-mails
    await db.insert(codigosLogin).values(
      Array.from({ length: MAX_CODIGOS_GERAL_POR_HORA }, (_, i) => ({ email: `outro${i}@example.com`, codigoHash: "x", expiraEm: mais(80), criadoEm: mais(62) })),
    );
    expect(await pedirCodigo(db, correio, "chefe@example.com", opcoes({ agora: mais(63) }))).toBe("limite");
  });
});

describe("verificar código", () => {
  it("certo: entra uma vez só (uso único)", async () => {
    await pedirCodigo(db, correio, "equipe@example.com", opcoes());
    expect(await verificarCodigo(db, "EQUIPE@example.com", "123 456", opcoes({ agora: mais(5) }))).toEqual({ ok: true, email: "equipe@example.com" });
    expect(await verificarCodigo(db, "equipe@example.com", "123456", opcoes({ agora: mais(6) }))).toMatchObject({ ok: false });
  });

  it("vencido depois de 10 minutos", async () => {
    await pedirCodigo(db, correio, "equipe@example.com", opcoes());
    expect(await verificarCodigo(db, "equipe@example.com", "123456", opcoes({ agora: mais(10) }))).toEqual({ ok: false, motivo: "expirado" });
  });

  it("5 erros bloqueiam o código, mesmo que depois acerte", async () => {
    await pedirCodigo(db, correio, "equipe@example.com", opcoes());
    for (let i = 0; i < 4; i++) expect(await verificarCodigo(db, "equipe@example.com", "000000", opcoes())).toEqual({ ok: false, motivo: "invalido" });
    expect(await verificarCodigo(db, "equipe@example.com", "000000", opcoes())).toEqual({ ok: false, motivo: "bloqueado" });
    expect(await verificarCodigo(db, "equipe@example.com", "123456", opcoes())).toMatchObject({ ok: false });
  });

  it("pedir de novo invalida o código anterior", async () => {
    await pedirCodigo(db, correio, "equipe@example.com", opcoes());
    await pedirCodigo(db, correio, "equipe@example.com", opcoes({ gerar: () => "654321", agora: mais(1) }));
    expect(await verificarCodigo(db, "equipe@example.com", "123456", opcoes({ agora: mais(2) }))).toMatchObject({ ok: false });
    expect(await verificarCodigo(db, "equipe@example.com", "654321", opcoes({ agora: mais(2) }))).toMatchObject({ ok: true });
  });

  it("código de um e-mail não serve para outro; segredo diferente não confere", async () => {
    await pedirCodigo(db, correio, "equipe@example.com", opcoes());
    await pedirCodigo(db, correio, "chefe@example.com", opcoes({ gerar: () => "999999" }));
    expect(await verificarCodigo(db, "chefe@example.com", "123456", opcoes())).toMatchObject({ ok: false });
    expect(await verificarCodigo(db, "equipe@example.com", "123456", { segredo: "outro", agora: t0 })).toMatchObject({ ok: false });
  });

  it("formato inválido conta como erro", async () => {
    await pedirCodigo(db, correio, "equipe@example.com", opcoes());
    expect(await verificarCodigo(db, "equipe@example.com", "abc", opcoes())).toEqual({ ok: false, motivo: "invalido" });
  });
});

describe("correio", () => {
  it("escolhe o adaptador pelo ambiente", () => {
    expect(correioDoAmbiente({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBeNull();
    expect(correioDoAmbiente({ NODE_ENV: "development" } as NodeJS.ProcessEnv)?.nome).toBe("memoria");
    expect(correioDoAmbiente({ NODE_ENV: "production", RESEND_API_KEY: "k", EMAIL_REMETENTE: "SCL <a@b.com>" } as NodeJS.ProcessEnv)?.nome).toBe("resend");
  });

  it("Resend: monta a chamada sem rede real e falha alto em erro", async () => {
    const chamadas: [string, RequestInit][] = [];
    const falso = (async (url: string, init: RequestInit) => {
      chamadas.push([url, init]);
      return new Response("{}", { status: chamadas.length === 1 ? 200 : 500 });
    }) as unknown as typeof fetch;
    const c = new CorreioResend("chave-falsa", "SCL <no-reply@example.com>", falso);
    await c.enviar({ para: "a@example.com", assunto: "Oi", texto: "t" });
    expect(chamadas[0][0]).toBe("https://api.resend.com/emails");
    expect(JSON.parse(String(chamadas[0][1].body))).toMatchObject({ to: ["a@example.com"], subject: "Oi" });
    expect(JSON.parse(String(chamadas[0][1].body)).attachments).toBeUndefined();
    await expect(c.enviar({ para: "a@example.com", assunto: "Oi", texto: "t", chave: "agenda:1" })).rejects.toThrow("HTTP 500");
    // Sem chave, sem cabeçalho; com chave, o provedor recebe a chave de idempotência.
    expect(new Headers(chamadas[0][1].headers).get("Idempotency-Key")).toBeNull();
    expect(new Headers(chamadas[1][1].headers).get("Idempotency-Key")).toBe(chaveIdempotencia("agenda:1"));
    // Hash da chave inteira, tamanho fixo: e-mails longos com o mesmo começo não se confundem.
    const longo = "a".repeat(190);
    expect(chaveIdempotencia(`agenda:${longo}1@example.com`)).not.toBe(chaveIdempotencia(`agenda:${longo}2@example.com`));
    expect(chaveIdempotencia(`agenda:${longo}1@example.com`)).toHaveLength(64);
  });

  it("Resend: cópias em cc e anexo em base64 com o nome do arquivo", async () => {
    let corpo: Record<string, unknown> = {};
    const falso = (async (_url: string, init: RequestInit) => {
      corpo = JSON.parse(String(init.body));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await new CorreioResend("chave-falsa", "SCL <no-reply@example.com>", falso).enviar({
      para: "a@example.com",
      assunto: "Fechamento",
      texto: "t",
      copias: ["rep@example.com"],
      anexos: [{ nome: "relatorio.pdf", conteudo: new TextEncoder().encode("%PDF-teste") }],
    });
    expect(corpo.cc).toEqual(["rep@example.com"]);
    expect(corpo.attachments).toEqual([{ filename: "relatorio.pdf", content: Buffer.from("%PDF-teste").toString("base64") }]);
  });
});
