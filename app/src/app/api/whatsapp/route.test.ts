/**
 * A rota do aviso do WhatsApp (M10.1a, desenho 2.3 e 2.4; 8-E), no esqueleto da rota do Mercado Pago: o banco é o de
 * teste (PGlite), o Sentry é falso (nada sai), `after()` vai para uma fila que o teste roda, e o ambiente vem de
 * `vi.stubEnv` com valores fictícios (nunca o da sessão). Os avisos são fictícios, assinados com o segredo de teste.
 * Nada aqui chama a Meta.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lerEmpresa, salvarEmpresa } from "@/configuracoes/empresa";
import { whatsappAvisosDia, whatsappContatos, whatsappEventos, whatsappMensagens } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { CorreioMemoria } from "@/email/correio";
import { MENSAGEM_OMITIDA } from "@/observabilidade/erro-de-rotina";
import { ENDERECO_WEBHOOK_WHATSAPP } from "@/whatsapp/integracao";
import { assinar, avisoDeConta, avisoDeMensagens, CANARIOS, FICTICIOS, organizacaoComWhatsapp, SEGREDO_TESTE, semDadosPessoaisWhatsapp } from "@/whatsapp/testes";

const m = vi.hoisted(() => ({
  getDb: vi.fn(),
  depois: [] as (() => unknown)[],
  captureException: vi.fn(),
  flush: vi.fn(async () => true),
  lerAviso: vi.fn(),
  correio: null as unknown,
}));
vi.mock("@/db/client", () => ({ getDb: m.getDb }));
// M0.9: o pacote do Sentry falso (nada sai); as falhas que a rota pega são avisadas por ele.
vi.mock("@sentry/nextjs", () => ({ captureException: m.captureException, flush: m.flush }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (f: () => unknown) => m.depois.push(f) }));
// A leitura do aviso de verdade, espiada (um caso a faz lançar).
vi.mock("@/whatsapp/aviso", async (original) => {
  const o = await original<typeof import("@/whatsapp/aviso")>();
  m.lerAviso.mockImplementation(o.lerAviso);
  return { ...o, lerAviso: m.lerAviso };
});
vi.mock("@/email/correio", async (original) => ({ ...(await original<typeof import("@/email/correio")>()), correioDoAmbiente: () => m.correio }));
import { GET, POST } from "./route";

const TOKEN = "senha-de-verificacao-ficticia-com-mais-de-32";
const LIMITE = 4 * 1024 * 1024;

type Corpo = string | Uint8Array | ReadableStream<Uint8Array>;
/** Um POST como o da Meta. Padrão: assinado com o segredo de teste sobre os bytes exatos do corpo. */
function pedido(corpo: Corpo, o: { assinatura?: string | null; cabecalhos?: Record<string, string> } = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json", ...o.cabecalhos };
  const assinatura = o.assinatura === undefined ? assinar(typeof corpo === "string" ? corpo : Buffer.from(corpo as Uint8Array)) : o.assinatura;
  if (assinatura !== null) headers["x-hub-signature-256"] = assinatura;
  return new Request(ENDERECO_WEBHOOK_WHATSAPP, { method: "POST", headers, body: corpo as BodyInit, duplex: "half" } as RequestInit);
}
const json = (o: unknown) => JSON.stringify(o);
const verificacao = (q: Record<string, string>) => new Request(`${ENDERECO_WEBHOOK_WHATSAPP}?${new URLSearchParams(q)}`);
const emPartes = (partes: number, tamanho: number) =>
  new ReadableStream<Uint8Array>({
    start(ctl) {
      for (let i = 0; i < partes; i++) ctl.enqueue(new Uint8Array(tamanho).fill(32));
      ctl.close();
    },
  });
/** O erro e as causas encadeadas: tudo o que o Sentry lê. */
const cadeia = (e: unknown): Error[] => (e instanceof Error ? [e, ...cadeia(e.cause)] : []);
const textoDoAviso = () => JSON.stringify(m.captureException.mock.calls.map(([e, c]) => [cadeia(e).map((x) => [x.name, x.message, x.stack]), c]));
const rodarDepois = async () => {
  const fila = m.depois.splice(0);
  for (const f of fila) await f();
};
/** Um banco que falha em qualquer uso, com o erro dado. */
const bancoQueFalha = (erro: unknown) =>
  new Proxy({}, {
    get() {
      throw erro;
    },
  }) as Db;

let db: Db, close: () => Promise<void>, org: string;
const consoles = ["log", "info", "warn", "error", "debug"] as const;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  org = await organizacaoComWhatsapp(db);
  vi.clearAllMocks();
  for (const c of consoles) vi.spyOn(console, c);
  m.depois.length = 0;
  m.correio = null;
  m.getDb.mockReturnValue(db);
  vi.stubEnv("WHATSAPP_RECEBIMENTO", "ligada");
  vi.stubEnv("WHATSAPP_APP_SECRET", SEGREDO_TESTE);
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", TOKEN);
});
afterEach(async () => {
  // Nenhum caso escreve no console.
  for (const c of consoles) expect(console[c], c).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await close();
});

const contaDoDia = async () => (await db.select().from(whatsappAvisosDia))[0] ?? null;
const mensagens = () => db.select().from(whatsappMensagens);

describe("GET /api/whatsapp (verificação do endereço)", () => {
  it("senha certa (32 caracteres ou mais): 200 com o challenge, em texto, sem cache; nunca toca o banco", async () => {
    const r = await GET(verificacao({ "hub.mode": "subscribe", "hub.verify_token": TOKEN, "hub.challenge": "desafio_ficticio-123" }));
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("desafio_ficticio-123");
    expect(r.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(m.getDb).not.toHaveBeenCalled();
  });

  it("não depende de WHATSAPP_RECEBIMENTO (a Meta verifica antes de o recebimento ser ligado)", async () => {
    vi.stubEnv("WHATSAPP_RECEBIMENTO", "");
    expect((await GET(verificacao({ "hub.mode": "subscribe", "hub.verify_token": TOKEN, "hub.challenge": "abc_DEF-123" }))).status).toBe(200);
  });

  it("senha errada, modo errado, senha ausente na consulta ou não configurada: 403 com corpo vazio", async () => {
    const casos: Record<string, string>[] = [
      { "hub.mode": "subscribe", "hub.verify_token": `${TOKEN}x`, "hub.challenge": "abc" },
      { "hub.mode": "unsubscribe", "hub.verify_token": TOKEN, "hub.challenge": "abc" },
      { "hub.mode": "subscribe", "hub.challenge": "abc" },
    ];
    for (const q of casos) {
      const r = await GET(verificacao(q));
      expect(r.status, JSON.stringify(q)).toBe(403);
      expect(await r.text()).toBe("");
    }
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "");
    expect((await GET(verificacao({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "abc" }))).status).toBe(403);
    expect(m.getDb).not.toHaveBeenCalled();
  });

  it("senha configurada com 31 caracteres: 403 mesmo enviada igual (a Meta a manda na URL, que a Vercel registra)", async () => {
    const curta = "x".repeat(31);
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", curta);
    expect((await GET(verificacao({ "hub.mode": "subscribe", "hub.verify_token": curta, "hub.challenge": "abc" }))).status).toBe(403);
  });

  it("challenge fora do formato (com <, vazio, ausente ou com 129 caracteres): 400", async () => {
    for (const challenge of ["<script>", "", "a".repeat(129), null]) {
      const q: Record<string, string> = { "hub.mode": "subscribe", "hub.verify_token": TOKEN };
      if (challenge !== null) q["hub.challenge"] = challenge;
      const r = await GET(verificacao(q));
      expect(r.status, String(challenge)).toBe(400);
      expect(await r.text()).toBe("");
    }
    expect((await GET(verificacao({ "hub.mode": "subscribe", "hub.verify_token": TOKEN, "hub.challenge": "a".repeat(128) }))).status).toBe(200);
  });
});

describe("POST /api/whatsapp (avisos)", () => {
  it("chave desligada: 503 sem ler o corpo e sem banco (a Meta reenvia por até 7 dias)", async () => {
    for (const valor of ["", "desligada", "LIGADA"]) {
      vi.stubEnv("WHATSAPP_RECEBIMENTO", valor);
      const p = pedido(json(avisoDeMensagens()));
      const r = await POST(p);
      expect(r.status).toBe(503);
      expect(await r.text()).toBe("");
      expect(p.bodyUsed).toBe(false);
    }
    expect(m.getDb).not.toHaveBeenCalled();
  });

  it("sem cabeçalho, cabeçalho malformado ou sem segredo: 401 sem ler o corpo, sem banco e sem contar", async () => {
    const corpo = json(avisoDeMensagens());
    const casos = [pedido(corpo, { assinatura: null }), pedido(corpo, { assinatura: "sha256=abc" }), pedido(corpo, { assinatura: `sha1=${"a".repeat(40)}` })];
    for (const p of casos) {
      expect((await POST(p)).status).toBe(401);
      expect(p.bodyUsed).toBe(false);
    }
    vi.stubEnv("WHATSAPP_APP_SECRET", "   ");
    const semSegredo = pedido(corpo);
    expect((await POST(semSegredo)).status).toBe(401);
    expect(semSegredo.bodyUsed).toBe(false);
    expect(m.getDb).not.toHaveBeenCalled();
    expect(await contaDoDia()).toBeNull();
  });

  it("corpo acima de 4 MB: 413 sem banco e sem contar, pelo Content-Length (sem ler) ou pela leitura em partes", async () => {
    const declarado = pedido(json(avisoDeMensagens()), { cabecalhos: { "content-length": String(LIMITE + 1) } });
    expect((await POST(declarado)).status).toBe(413);
    expect(declarado.bodyUsed).toBe(false);
    const grande = pedido(emPartes(65, 64 * 1024), { assinatura: assinar("qualquer") });
    expect((await POST(grande)).status).toBe(413);
    expect(m.getDb).not.toHaveBeenCalled();
    expect(await contaDoDia()).toBeNull();
  });

  it("leitura do corpo que lança: 400, sem banco", async () => {
    const quebrado = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("conexão caiu");
      },
    });
    expect((await POST(pedido(quebrado, { assinatura: assinar("x") }))).status).toBe(400);
    expect(m.getDb).not.toHaveBeenCalled();
  });

  it("assinatura que não confere (outro segredo, corpo reformatado): 401 e só a conta do dia", async () => {
    const aviso = avisoDeMensagens();
    expect((await POST(pedido(json(aviso), { assinatura: assinar(json(aviso), "outro-segredo") }))).status).toBe(401);
    // O mesmo JSON com outro espaçamento: a assinatura é sobre os bytes crus.
    expect((await POST(pedido(JSON.stringify(aviso, null, 2), { assinatura: assinar(json(aviso)) }))).status).toBe(401);
    expect(await contaDoDia()).toMatchObject({ assinaturasRecusadas: 2, ilegiveis: 0, ultimoValidoEm: null });
    expect(await mensagens()).toEqual([]);
  });

  it("assinatura certa com JSON quebrado ou UTF-8 inválido: 200 e a conta \"ilegíveis\" (com o último aviso válido)", async () => {
    expect((await POST(pedido('{"object": "whatsapp_business_account", '))).status).toBe(200);
    // Um byte que não é UTF-8 no meio do texto de um aviso válido: a decodificação é estrita, então o corpo é ilegível
    // e nada é gravado (um decodificador frouxo leria o aviso e gravaria U+FFFD no texto da conversa).
    const valido = json(avisoDeMensagens());
    const i = valido.indexOf(CANARIOS.texto);
    const invalido = Buffer.concat([Buffer.from(valido.slice(0, i)), Buffer.from([0xff]), Buffer.from(valido.slice(i))]);
    expect((await POST(pedido(new Uint8Array(invalido)))).status).toBe(200);
    expect(await mensagens()).toEqual([]);
    // Bytes que não são UTF-8 fora de um envelope também.
    expect((await POST(pedido(new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0xfe, 0x22, 0x7d])))).status).toBe(200);
    // Corpo vazio e forma fora do esperado (outro `object`) também.
    expect((await POST(pedido(""))).status).toBe(200);
    expect((await POST(pedido(json({ object: "page", entry: [] })))).status).toBe(200);
    expect(await contaDoDia()).toMatchObject({ ilegiveis: 5, assinaturasRecusadas: 0, ultimoValidoEm: expect.any(Date) });
    expect(await mensagens()).toEqual([]);
    expect(m.depois).toEqual([]);
  });

  it("o corpo assinado da fixture (bytes exatos, vetor conferido) é gravado e responde 200", async () => {
    const bytes = readFileSync(fileURLToPath(new URL("../../../whatsapp/fixtures/corpo-assinado.json", import.meta.url)));
    const r = await POST(pedido(new Uint8Array(bytes), { assinatura: "sha256=b3af869c6474ba4be7a413495d0a0f8f1b9e0f110b62895bd78951ff6ab0df24" }));
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("");
    expect(await mensagens()).toEqual([expect.objectContaining({ organizacaoId: org, wamid: "wamid.FICTICIO0001", direcao: "recebida", origem: "tempo_real", tipo: "texto" })]);
  });

  it("aviso válido: grava antes do 200 (a conversa e a mensagem), com o último aviso válido; repetido não duplica", async () => {
    const corpo = json(avisoDeMensagens());
    expect((await POST(pedido(corpo))).status).toBe(200);
    expect((await POST(pedido(corpo))).status).toBe(200);
    expect(await mensagens()).toHaveLength(1);
    expect(await db.select().from(whatsappContatos)).toHaveLength(1);
    expect((await contaDoDia())?.ultimoValidoEm).toBeInstanceOf(Date);
    expect(await semDadosPessoaisWhatsapp(db)).toEqual([]);
  });

  it("WABA ou número de outra conta: 200, nada gravado, \"de outra conta\" +1", async () => {
    expect((await POST(pedido(json(avisoDeMensagens({ waba: FICTICIOS.outraWaba }))))).status).toBe(200);
    expect((await POST(pedido(json(avisoDeMensagens({ numero: FICTICIOS.outroNumero }))))).status).toBe(200);
    expect(await mensagens()).toEqual([]);
    expect(await contaDoDia()).toMatchObject({ outraConta: 2 });
  });

  it("falha do banco na gravação: 500 (a Meta reenvia), o Sentry recebe o texto fixo com a rotina, e o telefone não sai", async () => {
    m.getDb.mockReturnValue(bancoQueFalha(new Error(`Failed query: select ... params: ${CANARIOS.waIdBr}`)));
    const r = await POST(pedido(json(avisoDeMensagens())));
    expect(r.status).toBe(500);
    expect(await r.text()).toBe("");
    expect(m.captureException).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: MENSAGEM_OMITIDA }), { tags: { rotina: "aviso-whatsapp" } });
    expect(m.flush).toHaveBeenCalledWith(2000);
    expect(textoDoAviso()).not.toContain(CANARIOS.waIdBr);
  });

  it("erro de verdade do Postgres (PGlite) com o canário na causa: o Sentry recebe o tipo e o código, sem o valor", async () => {
    const real = await db.execute(sql`select ${CANARIOS.waIdBr}::uuid`).then(
      () => null,
      (e: unknown) => e,
    );
    expect(String((real as Error).cause)).toContain(CANARIOS.waIdBr);
    m.getDb.mockReturnValue(bancoQueFalha(real));
    expect((await POST(pedido(json(avisoDeMensagens())))).status).toBe(500);
    const [erro] = m.captureException.mock.calls[0] as unknown as [Error];
    expect(cadeia(erro).map((e) => e.message)).toEqual([MENSAGEM_OMITIDA, `${MENSAGEM_OMITIDA}; código 22P02`]);
    expect(textoDoAviso()).not.toContain(CANARIOS.waIdBr);
  });

  it("a leitura do aviso que lança (com um telefone na mensagem) fica no mesmo try: 500, sem console e sem o canário", async () => {
    m.lerAviso.mockImplementationOnce(() => {
      throw new Error(CANARIOS.waIdBr);
    });
    expect((await POST(pedido(json(avisoDeMensagens())))).status).toBe(500);
    expect(m.captureException).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: MENSAGEM_OMITIDA }), { tags: { rotina: "aviso-whatsapp" } });
    expect(textoDoAviso()).not.toContain(CANARIOS.waIdBr);
    expect(await mensagens()).toEqual([]);
  });

  it("a conta do ilegível que falha: 500 pelo mesmo caminho", async () => {
    m.getDb.mockReturnValue(bancoQueFalha(new Error("banco fora do ar")));
    expect((await POST(pedido("{quebrado"))).status).toBe(500);
    expect(m.captureException).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: MENSAGEM_OMITIDA }), { tags: { rotina: "aviso-whatsapp" } });
  });

  it("a conta da assinatura recusada que falha não muda a resposta (401) nem vai ao Sentry", async () => {
    m.getDb.mockReturnValue(bancoQueFalha(new Error("banco fora do ar")));
    expect((await POST(pedido(json(avisoDeMensagens()), { assinatura: assinar("outro corpo") }))).status).toBe(401);
    expect(m.captureException).not.toHaveBeenCalled();
  });

  it("desconexão da conta: o e-mail sai depois da resposta (after) e só ao rodar a fila; o aviso repetido não agenda outro", async () => {
    await salvarEmpresa(db, org, { ...(await lerEmpresa(db, org)), email: "equipe@example.com" }, null);
    const correio = new CorreioMemoria();
    m.correio = correio;
    const corpo = json(avisoDeConta({ evento: "PARTNER_REMOVED", motivo: "PRIMARY_INACTIVITY" }));
    expect((await POST(pedido(corpo))).status).toBe(200);
    expect(correio.enviadas).toEqual([]);
    expect(m.depois).toHaveLength(1);
    await rodarDepois();
    expect(correio.enviadas).toHaveLength(1);
    expect(correio.enviadas[0]).toMatchObject({ para: "equipe@example.com", assunto: "WhatsApp desconectado do sistema" });
    expect((await POST(pedido(corpo))).status).toBe(200);
    expect(m.depois).toEqual([]);
    const [ev] = await db.select().from(whatsappEventos);
    expect(ev).toMatchObject({ tipo: "PARTNER_REMOVED", avisarPorEmail: true, emailResultado: "enviado" });
  });

  it("a falha do e-mail depois da resposta vai ao Sentry com a rotina, sem o telefone e sem mudar o 200 já respondido", async () => {
    // O banco da resposta passa a falhar só depois dela: o after() usa o mesmo banco.
    const falha = { ligada: false };
    m.getDb.mockReturnValue(
      new Proxy(db, {
        get(alvo, prop) {
          if (falha.ligada) throw new Error(`Failed query: update ... params: ${CANARIOS.waIdBr}`);
          const v = Reflect.get(alvo, prop) as unknown;
          return typeof v === "function" ? v.bind(alvo) : v;
        },
      }),
    );
    expect((await POST(pedido(json(avisoDeConta({ evento: "ACCOUNT_OFFBOARDED" }))))).status).toBe(200);
    expect(m.captureException).not.toHaveBeenCalled();
    falha.ligada = true;
    await expect(rodarDepois()).resolves.toBeUndefined();
    expect(m.captureException).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: MENSAGEM_OMITIDA }), { tags: { rotina: "aviso-whatsapp" } });
    expect(textoDoAviso()).not.toContain(CANARIOS.waIdBr);
  });
});
