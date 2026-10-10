import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pagamentos } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { DESISTIR_SEM_ORDER_CARTAO_MS } from "./andamento";
import { conferirTentativa, DESISTIR_SEM_ORDER_MS, INTERVALO_ANALISE_MS, INTERVALO_CONSULTA_MS } from "./conferencia";
import { gerarPix } from "./pix";
import { ErroProvedor } from "./provedor";
import { AGORA, type Cenario, minutos, montarCenario } from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => { c = await montarCenario(db); });

const pagina = (id: string, quando: Date) => conferirTentativa(db, c.org, id, c.provedor, quando, { origem: "pagina" });
const consultas = () => c.provedor.chamadas.filter((x) => x.metodo === "consultar").length;

describe("conferência com o cartão (M8.2b)", () => {
  it("criação sem order achada: o Pix é dado por não feito em 15 min; o cartão só em 24 h e com a Payments API também vazia", async () => {
    expect(DESISTIR_SEM_ORDER_MS).toBe(15 * 60_000);
    expect(DESISTIR_SEM_ORDER_CARTAO_MS).toBe(24 * 3_600_000);
    const a = await c.segurar();
    c.provedor.falhas.criarPix = new ErroProvedor("incerto", "tempo");
    await gerarPix(db, c.org, a.cotacaoId, AGORA, c.provedor);
    c.provedor.falhas.criarPix = null;
    const [pix] = await db.select().from(pagamentos).where(eq(pagamentos.cotacaoId, a.cotacaoId));
    expect(await pagina(pix.id, minutos(15))).toMatchObject({ ok: true, situacao: "cancelado" });

    const b = await c.segurar({ entrada: "2026-11-02", saida: "2026-11-05", email: "b@example.com" });
    c.provedor.falhas.criarCartao = new ErroProvedor("incerto", "tempo");
    const r = await c.cartao(b.cotacaoId);
    c.provedor.falhas.criarCartao = null;
    expect(await pagina(r.pagamentoId!, minutos(15))).toMatchObject({ ok: true, situacao: "incerta" });
    expect(await pagina(r.pagamentoId!, minutos(60 * 23))).toMatchObject({ ok: true, situacao: "incerta" });
    expect(c.provedor.chamadas.filter((x) => x.metodo === "existePagamentoPorReferencia")).toHaveLength(0);
    expect(await pagina(r.pagamentoId!, minutos(60 * 24))).toMatchObject({ ok: true, situacao: "cancelado" });
    expect(c.provedor.chamadas.filter((x) => x.metodo === "existePagamentoPorReferencia")).toHaveLength(1);
  });

  it("cartão em análise ou processando: a página lê no máximo uma vez por minuto (a análise pode levar dias); no desafio, a cada 15 s", async () => {
    expect(INTERVALO_ANALISE_MS).toBe(60_000);
    for (const [n, resposta] of [[0, "em_analise"], [1, "processando"]] as const) {
      const s = await c.segurar({ entrada: `2026-11-${String(2 + n * 4).padStart(2, "0")}`, saida: `2026-11-${String(5 + n * 4).padStart(2, "0")}`, email: `a${n}@example.com` });
      c.provedor.respostaCartao = resposta;
      const r = await c.cartao(s.cotacaoId);
      const antes = consultas();
      expect(await pagina(r.pagamentoId!, minutos(1))).toMatchObject({ ok: true, consultou: true });
      expect(await pagina(r.pagamentoId!, new Date(minutos(1).getTime() + INTERVALO_CONSULTA_MS))).toMatchObject({ ok: true, consultou: false });
      expect(await pagina(r.pagamentoId!, new Date(minutos(1).getTime() + INTERVALO_ANALISE_MS - 1_000))).toMatchObject({ consultou: false });
      expect(await pagina(r.pagamentoId!, new Date(minutos(1).getTime() + INTERVALO_ANALISE_MS))).toMatchObject({ consultou: true });
      expect(consultas() - antes).toBe(2);
      // O "Conferir agora" (forçado) não espera.
      expect(await conferirTentativa(db, c.org, r.pagamentoId!, c.provedor, new Date(minutos(1).getTime() + INTERVALO_ANALISE_MS + 1_000), { origem: "painel", forcar: true })).toMatchObject({ consultou: true });
    }
    const d = await c.segurar({ entrada: "2026-11-10", saida: "2026-11-13", email: "d@example.com" });
    c.provedor.respostaCartao = "desafio";
    const r = await c.cartao(d.cotacaoId);
    expect(await pagina(r.pagamentoId!, minutos(1))).toMatchObject({ consultou: true });
    expect(await pagina(r.pagamentoId!, new Date(minutos(1).getTime() + INTERVALO_CONSULTA_MS))).toMatchObject({ consultou: true });
  });
});
