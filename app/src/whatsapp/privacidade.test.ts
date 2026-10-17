/**
 * Privacidade do recebimento do WhatsApp (M10.1a, desenho 7.1; 8-E): nenhum dado do aviso sai do banco. A rota roda de
 * verdade, com o banco de teste (PGlite), o pacote do Sentry de verdade com um transporte falso (só guarda o que seria
 * enviado: nada vai para a rede) e espiões em todo o console. Em cada cenário (falha de banco na gravação com o
 * telefone na mensagem e na causa, falha no e-mail depois da resposta, assinatura inválida, corpo ilegível), nada do que
 * foi capturado contém um canário, o wamid, o corpo, o cabeçalho da assinatura ou o segredo de teste.
 */
import * as Sentry from "@sentry/nextjs";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { lerEmpresa, salvarEmpresa } from "@/configuracoes/empresa";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { CorreioMemoria } from "@/email/correio";
import { opcoesDoSentry } from "@/observabilidade/sentry";
import { ENDERECO_WEBHOOK_WHATSAPP } from "./integracao";
import { assinar, avisoDeConta, avisoDeMensagens, CANARIOS, contatoDoAviso, organizacaoComWhatsapp, SEGREDO_TESTE } from "./testes";

const m = vi.hoisted(() => ({ db: null as unknown as Db, depois: [] as (() => unknown)[], correio: null as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => m.db }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (f: () => unknown) => m.depois.push(f) }));
vi.mock("@/email/correio", async (original) => ({ ...(await original<typeof import("@/email/correio")>()), correioDoAmbiente: () => m.correio }));
import { POST } from "@/app/api/whatsapp/route";

const enviados: string[] = [];
beforeAll(() => {
  const transport = (opcoes: Parameters<typeof Sentry.createTransport>[0]) =>
    Sentry.createTransport(opcoes, async (pedido) => {
      enviados.push(typeof pedido.body === "string" ? pedido.body : new TextDecoder().decode(pedido.body));
      return { statusCode: 200 };
    });
  Sentry.init({ ...opcoesDoSentry({ NEXT_PUBLIC_SENTRY_DSN: "https://chavepublicaficticia@o0.ingest.exemplo.io/0", VERCEL_ENV: "preview" })!, transport });
});
afterAll(() => Sentry.close());

const CONSOLES = ["log", "info", "warn", "error", "debug"] as const;
let banco: Db, close: () => Promise<void>, org: string;
beforeEach(async () => {
  enviados.length = 0;
  m.depois.length = 0;
  m.correio = null;
  ({ db: banco, close } = await createTestDb());
  m.db = banco;
  org = await organizacaoComWhatsapp(banco);
  for (const c of CONSOLES) vi.spyOn(console, c).mockImplementation(() => undefined);
  vi.stubEnv("WHATSAPP_RECEBIMENTO", "ligada");
  vi.stubEnv("WHATSAPP_APP_SECRET", SEGREDO_TESTE);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await close();
});

/** Um aviso com todos os canários (telefone com e sem o nono dígito, BSUID, wamid, texto e nome do perfil). */
const CORPO = JSON.stringify(avisoDeMensagens({ contatos: [contatoDoAviso({ bsuid: CANARIOS.bsuid })] }));
const ASSINATURA = assinar(CORPO);
const pedido = (corpo = CORPO, assinatura = ASSINATURA) =>
  new Request(ENDERECO_WEBHOOK_WHATSAPP, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": assinatura }, body: corpo });

/** Tudo o que saiu: os envios ao Sentry (sem o código-fonte em volta da pilha, que é deste teste) e os argumentos do console. */
function capturado(): string {
  const eventos = enviados.map((e) =>
    e
      .split("\n")
      .filter(Boolean)
      .map((linha) => {
        const item = JSON.parse(linha);
        for (const ex of item.exception?.values ?? []) for (const q of ex.stacktrace?.frames ?? []) for (const k of ["pre_context", "context_line", "post_context"]) delete q[k];
        return item;
      }),
  );
  const consoles = CONSOLES.flatMap((c) => (console[c] as unknown as { mock: { calls: unknown[][] } }).mock.calls);
  return JSON.stringify({ eventos, consoles: consoles.map((args) => args.map((a) => (a instanceof Error ? [a.name, a.message, a.stack] : a))) });
}
/** Nada do aviso nem das credenciais no que saiu. */
function nadaVazou(texto = capturado()) {
  for (const v of [...Object.values(CANARIOS), CORPO, ASSINATURA, ASSINATURA.slice("sha256=".length), SEGREDO_TESTE]) expect(texto, v.slice(0, 40)).not.toContain(v);
}
const rodarDepois = async () => {
  for (const f of m.depois.splice(0)) await f();
};

describe("o recebimento do WhatsApp não manda dado pessoal para o Sentry nem para o console (M10.1a)", () => {
  it("falha de banco na gravação, com o telefone na mensagem e na causa do erro: 500 e só o tipo e o código saem", async () => {
    // A consulta falha de verdade (PGlite) com o telefone como parâmetro: o Drizzle o põe na mensagem, e o Postgres na causa.
    m.db = new Proxy(banco, {
      get(alvo, prop) {
        if (prop === "transaction") return async () => alvo.execute(sql`select ${CANARIOS.waIdBr}::uuid`);
        const v = Reflect.get(alvo, prop) as unknown;
        return typeof v === "function" ? v.bind(alvo) : v;
      },
    });
    expect((await POST(pedido())).status).toBe(500);
    await Sentry.flush(2000);
    expect(enviados).toHaveLength(1);
    const texto = capturado();
    expect(texto).toContain("mensagem omitida (pode ter dados pessoais)");
    expect(texto).toContain("aviso-whatsapp");
    nadaVazou(texto);
  });

  it("falha no e-mail da conta, depois da resposta (after), com o telefone na mensagem: só o tipo sai", async () => {
    await salvarEmpresa(banco, org, { ...(await lerEmpresa(banco, org)), email: "equipe@example.com" }, null);
    m.correio = new CorreioMemoria();
    const falha = { ligada: false };
    m.db = new Proxy(banco, {
      get(alvo, prop) {
        if (falha.ligada) throw new Error(`Failed query: select ... params: ${CANARIOS.waIdBr},${CANARIOS.bsuid}`);
        const v = Reflect.get(alvo, prop) as unknown;
        return typeof v === "function" ? v.bind(alvo) : v;
      },
    });
    const corpo = JSON.stringify(avisoDeConta({ evento: "PARTNER_REMOVED", wabaInfo: null, telefone: CANARIOS.waIdBr }));
    const r = await POST(pedido(corpo, assinar(corpo)));
    expect(r.status).toBe(200);
    falha.ligada = true;
    await rodarDepois();
    await Sentry.flush(2000);
    expect(enviados).toHaveLength(1);
    nadaVazou();
  });

  it("assinatura inválida e corpo ilegível: nada vai ao Sentry nem ao console", async () => {
    expect((await POST(pedido(CORPO, assinar(CORPO, "outro-segredo")))).status).toBe(401);
    const ilegivel = `${CORPO.slice(0, -10)}`;
    expect((await POST(pedido(ilegivel, assinar(ilegivel)))).status).toBe(200);
    // Válido também não escreve nada fora do banco.
    expect((await POST(pedido())).status).toBe(200);
    await Sentry.flush(2000);
    expect(enviados).toEqual([]);
    nadaVazou();
    for (const c of CONSOLES) expect(console[c], c).not.toHaveBeenCalled();
  });
});
