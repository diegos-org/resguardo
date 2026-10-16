import { createHmac } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventosPagamento, pagamentosAvisosDia } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { MENSAGEM_OMITIDA } from "@/observabilidade/erro-de-rotina";
import { ErroProvedor } from "@/pagamentos/provedor";
import { type Cenario, montarCenario } from "@/pagamentos/testes";

const m = vi.hoisted(() => ({ getDb: vi.fn(), gate: vi.fn(), depois: [] as (() => Promise<void>)[], captureException: vi.fn(), flush: vi.fn(async () => true) }));
vi.mock("@/db/client", () => ({ getDb: m.getDb }));
// M0.9: o pacote do Sentry falso (nada sai); as falhas que a rota pega são avisadas por ele.
vi.mock("@sentry/nextjs", () => ({ captureException: m.captureException, flush: m.flush }));
vi.mock("@/pagamentos/oferta", async (original) => ({ ...(await original<typeof import("@/pagamentos/oferta")>()), provedorDeConferencia: m.gate }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (f: () => Promise<void>) => m.depois.push(f) }));
import { POST } from "./route";

const SEGREDO = "segredo-ficticio-do-webhook";
const REQUEST_ID = "bb56a2f1-6aae-46ac-982e-9dcd3581d08e";
const TS = "1759330800";
const assinar = (dataId: string, o: { requestId?: string; ts?: string; segredo?: string } = {}) => {
  const manifesto = `id:${dataId};request-id:${o.requestId ?? REQUEST_ID};ts:${o.ts ?? TS};`;
  return `ts=${o.ts ?? TS},v1=${createHmac("sha256", o.segredo ?? SEGREDO).update(manifesto).digest("hex")}`;
};
const pedido = (dataId: string, o: { assinatura?: string | null; corpo?: BodyInit; cabecalhos?: Record<string, string>; requestId?: string; ts?: string } = {}) => {
  const headers: Record<string, string> = { "content-type": "application/json", "x-request-id": o.requestId ?? REQUEST_ID, ...(o.cabecalhos ?? {}) };
  const assinatura = o.assinatura === undefined ? assinar(dataId, { requestId: o.requestId, ts: o.ts }) : o.assinatura;
  if (assinatura !== null) headers["x-signature"] = assinatura;
  const corpo = o.corpo ?? JSON.stringify({ action: "order.processed", type: "order", live_mode: false, data: { id: "ORDOUTRO" } });
  return new Request(`https://scl-reconstrucao.vercel.app/api/pagamentos/mercadopago?data.id=${encodeURIComponent(dataId)}&type=order`, { method: "POST", headers, body: corpo, duplex: "half" } as RequestInit);
};
const rodarDepois = async () => {
  const fila = m.depois.splice(0);
  for (const f of fila) await f();
};

let db: Db, close: () => Promise<void>, c: Cenario;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  c = await montarCenario(db);
  vi.clearAllMocks();
  m.depois.length = 0;
  m.getDb.mockReturnValue(db);
  m.gate.mockResolvedValue({ ok: true, provedor: c.provedor, ambiente: "teste" });
  vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", SEGREDO);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await close();
});

const eventos = () => db.select().from(eventosPagamento);
const contaDoDia = async () => (await db.select().from(pagamentosAvisosDia))[0] ?? null;

describe("POST /api/pagamentos/mercadopago", () => {
  it("sem x-signature ou sem segredo configurado: 401 sem ler o corpo nem tocar no banco", async () => {
    const sem = pedido("ORDTESTE1", { assinatura: null });
    expect((await POST(sem)).status).toBe(401);
    expect(sem.bodyUsed).toBe(false);
    vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "   ");
    const semSegredo = pedido("ORDTESTE1");
    expect((await POST(semSegredo)).status).toBe(401);
    expect(semSegredo.bodyUsed).toBe(false);
    expect(m.getDb).not.toHaveBeenCalled();
    expect(await contaDoDia()).toBeNull();
  });

  it("corpo acima de 64 KB: 413 (pelo Content-Length, antes de ler, ou pela leitura, que para no limite)", async () => {
    const declarado = pedido("ORDTESTE1", { cabecalhos: { "content-length": String(64 * 1024 + 1) } });
    expect((await POST(declarado)).status).toBe(413);
    expect(declarado.bodyUsed).toBe(false);
    const grande = new ReadableStream<Uint8Array>({
      start(ctl) {
        for (let i = 0; i < 70; i++) ctl.enqueue(new Uint8Array(1024).fill(32));
        ctl.close();
      },
    });
    expect((await POST(pedido("ORDTESTE1", { corpo: grande }))).status).toBe(413);
    expect(m.getDb).not.toHaveBeenCalled();
    expect(await eventos()).toEqual([]);
  });

  it("assinatura inválida (outro segredo, id trocado ou cabeçalho malformado): 401 e só a conta do dia", async () => {
    expect((await POST(pedido("ORDTESTE1", { assinatura: assinar("ORDTESTE1", { segredo: "outro-segredo" }) }))).status).toBe(401);
    // Assinado para outra order: o data.id da URL é o que vale.
    expect((await POST(pedido("ORDTESTE2", { assinatura: assinar("ORDTESTE1") }))).status).toBe(401);
    expect((await POST(pedido("ORDTESTE1", { assinatura: "lixo" }))).status).toBe(401);
    expect(await eventos()).toEqual([]);
    expect(await contaDoDia()).toMatchObject({ assinaturasRecusadas: 3, ultimoValidoEm: null });
    expect(m.depois).toEqual([]);
  });

  it("aceita o data.id assinado em minúsculas (documentação e SDK divergem)", async () => {
    const dataId = "ORDTESTEMAIUSCULO";
    const manifesto = `id:${dataId.toLowerCase()};request-id:${REQUEST_ID};ts:${TS};`;
    const assinatura = `ts=${TS},v1=${createHmac("sha256", SEGREDO).update(manifesto).digest("hex")}`;
    expect((await POST(pedido(dataId, { assinatura }))).status).toBe(200);
    expect(await eventos()).toHaveLength(1);
  });

  it("id que não é de order (pagamento, contestação): evento registrado como ignorado, 200, nada processado", async () => {
    const r = await POST(pedido("123456789"));
    expect(r.status).toBe(200);
    expect(await eventos()).toEqual([expect.objectContaining({ dataId: "123456789", resultado: "ignorado", tipo: "order", acao: "order.processed", requestId: REQUEST_ID, ts: TS, aoVivo: false })]);
    expect(m.depois).toEqual([]);
    expect(m.gate).not.toHaveBeenCalled();
    expect((await contaDoDia())?.ultimoValidoEm).toBeInstanceOf(Date);
  });

  it("order válida: 200 já, processada depois da resposta (aplica o Pix e confirma a reserva); repetição não processa", async () => {
    const s = await c.segurar();
    const p = await c.pix(s.cotacaoId);
    c.provedor.aprovar(p.idProvedor);
    const r = await POST(pedido(p.idProvedor));
    expect(r.status).toBe(200);
    // Nada aplicado antes da resposta.
    expect((await c.reserva(s.reservaId)).estado).toBe("pedido");
    expect(m.depois).toHaveLength(1);
    await rodarDepois();
    expect((await c.reserva(s.reservaId)).estado).toBe("confirmada");
    const [ev] = await eventos();
    expect(ev).toMatchObject({ dataId: p.idProvedor, resultado: "aplicado", organizacaoId: c.org });
    // O mesmo aviso de novo (mesmo request-id, ts e id): 200, sem processar.
    expect((await POST(pedido(p.idProvedor))).status).toBe(200);
    expect(m.depois).toEqual([]);
    expect(await eventos()).toHaveLength(1);
  });

  it("nada é decidido pelo corpo: corpo que não é JSON, com outro id e live_mode=true ainda vale pela URL (live_mode só vira alarme)", async () => {
    const s = await c.segurar();
    const p = await c.pix(s.cotacaoId);
    c.provedor.aprovar(p.idProvedor);
    expect((await POST(pedido(p.idProvedor, { corpo: "isto não é json" }))).status).toBe(200);
    await rodarDepois();
    expect((await c.reserva(s.reservaId)).estado).toBe("confirmada");
    expect((await POST(pedido(p.idProvedor, { requestId: "outro-request", corpo: JSON.stringify({ action: "order.refunded", live_mode: true, data: { id: "ORDDOCORPO" } }) }))).status).toBe(200);
    const vivo = (await eventos()).find((e) => e.requestId === "outro-request");
    expect(vivo).toMatchObject({ dataId: p.idProvedor, acao: "order.refunded", aoVivo: true });
  });

  it("order que este banco não conhece: 200 e o evento fica desconhecido", async () => {
    expect((await POST(pedido("ORDDEOUTRAAPLICACAO"))).status).toBe(200);
    await rodarDepois();
    expect((await eventos())[0]).toMatchObject({ resultado: "desconhecido", organizacaoId: null });
  });

  it("sem provedor de conferência (deploy de produção): o aviso só fica registrado, como ignorado", async () => {
    m.gate.mockResolvedValue({ ok: false, motivo: "so_nas_previas", texto: "nas prévias" });
    const s = await c.segurar();
    const p = await c.pix(s.cotacaoId);
    c.provedor.aprovar(p.idProvedor);
    expect((await POST(pedido(p.idProvedor))).status).toBe(200);
    await rodarDepois();
    expect((await eventos())[0].resultado).toBe("ignorado");
    expect((await c.reserva(s.reservaId)).estado).toBe("pedido");
  });

  it("falha do provedor depois da resposta: o evento fica com erro (a rotina confere depois) e nada sobe", async () => {
    const s = await c.segurar();
    const p = await c.pix(s.cotacaoId);
    c.provedor.falhas.consultar = new ErroProvedor("incerto", "tempo");
    expect((await POST(pedido(p.idProvedor))).status).toBe(200);
    await expect(rodarDepois()).resolves.toBeUndefined();
    const [ev] = await db.select().from(eventosPagamento).where(eq(eventosPagamento.dataId, p.idProvedor));
    expect(ev.resultado).toBe("erro");
    // M0.9: e o Sentry recebe o erro, com o nome da rotina: o tipo e a pilha, sem a mensagem, o corpo e os cabeçalhos.
    expect(m.captureException).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: "ErroProvedor", message: MENSAGEM_OMITIDA }), { tags: { rotina: "aviso-mercadopago" } });
    expect(m.flush).toHaveBeenCalledWith(2000);
  });

  it("o banco fora do ar ao gravar o evento: 500 (o provedor tenta de novo), sem expor nada", async () => {
    m.getDb.mockReturnValue({
      insert: () => {
        throw new Error("SEGREDO-DO-BANCO");
      },
    });
    const r = await POST(pedido("ORDTESTE1"));
    expect(r.status).toBe(500);
    expect(await r.text()).toBe("");
    expect(m.captureException).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: MENSAGEM_OMITIDA }), { tags: { rotina: "aviso-mercadopago" } });
    expect(JSON.stringify(m.captureException.mock.calls)).not.toContain("SEGREDO");
  });

  it("erro do banco ao gravar o evento com um valor repetido na causa (revisão do Codex): o Sentry recebe o tipo e o código, sem o valor", async () => {
    // Um erro de verdade do Postgres (PGlite): o valor do parâmetro volta na mensagem da causa.
    const NOME = "Maria Fictícia Teste";
    const real = await db.execute(sql`select ${NOME}::uuid`).then(
      () => null,
      (e: unknown) => e,
    );
    expect(String((real as Error).cause)).toContain(NOME);
    m.getDb.mockReturnValue({
      transaction: async () => {
        throw real;
      },
    });
    expect((await POST(pedido("ORDTESTE1"))).status).toBe(500);
    expect(m.captureException).toHaveBeenCalledOnce();
    const [erro] = m.captureException.mock.calls[0] as unknown as [Error];
    const cadeia = (e: unknown): Error[] => (e instanceof Error ? [e, ...cadeia(e.cause)] : []);
    expect(cadeia(erro).map((e) => e.message)).toEqual([MENSAGEM_OMITIDA, `${MENSAGEM_OMITIDA}; código 22P02`]);
    expect(JSON.stringify(cadeia(erro).map((e) => [e.name, e.message, e.stack]))).not.toContain(NOME);
  });
});
