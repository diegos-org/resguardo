/**
 * O pagamento do site não depende do Beds24 (M8.3c, desenho 3.6 e riscos; plano, teste 35): nenhum arquivo do pagamento
 * importa o Beds24 (só o `beds24/` chama as marcas das OTAs do pagamento, nunca o contrário), e uma volta da rotina com o
 * Beds24 fora do ar não muda a reserva paga nem o financeiro: a falha fica só no registro da rotina. PGlite e o Beds24 falso;
 * nada vai à rede.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { executarCronReservasBeds24 } from "@/beds24/cron-reservas";
import { Beds24Falso, ESCOPOS_ESPERADOS_FALSO } from "@/beds24/falso";
import { impressaoCredencialBeds24 } from "@/beds24/http";
import { gravarEscoposLidos } from "@/beds24/reservas-site-rotina";
import { ErroBeds24 } from "@/beds24/tipos";
import { gravarConfig } from "@/configuracoes/armazem";
import { lancamentos, pagamentos } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { CorreioMemoria } from "@/email/correio";
import { ultimasExecucoes } from "@/sistema/automacoes";
import { type Cenario, env, minutos, montarCenario, pagarEConfirmar } from "./testes";

/** Todo `.ts`/`.tsx` de `pagamentos/` (e das subpastas), fora os testes. */
function arquivosDoPagamento(dir = __dirname): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivosDoPagamento(caminho);
    return /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

describe("teste 35: o pagamento não importa o Beds24", () => {
  it("nenhum arquivo de pagamentos/ (fora dos testes) importa @/beds24/ ou ../beds24/, estático ou dinâmico", () => {
    const arquivos = arquivosDoPagamento();
    expect(arquivos.length).toBeGreaterThan(10);
    const importaBeds24 = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'](?:@\/beds24|(?:\.\.\/)+beds24)(?:\/[^"']*)?["']/;
    expect(arquivos.filter((a) => importaBeds24.test(readFileSync(a, "utf8"))).map((a) => a.slice(__dirname.length + 1))).toEqual([]);
    // O próprio padrão pega os jeitos de importar (a conferência do teste).
    for (const linha of ['import { x } from "@/beds24/http";', "const m = await import('../beds24/trava');", 'export { y } from "../../beds24/tipos";']) expect(importaBeds24.test(linha), linha).toBe(true);
  });
});

describe("teste 35: o Beds24 fora do ar não muda a reserva paga", () => {
  let db: Db, close: () => Promise<void>, c: Cenario;
  beforeAll(async () => { ({ db, close } = await createTestDb()); });
  afterAll(() => close());
  beforeEach(async () => { c = await montarCenario(db); });

  it("a volta com o Beds24 falhando: a reserva continua confirmada, o pagamento e os lançamentos iguais, e a rotina registra a falha", async () => {
    const PRONTO = env({ VERCEL_ENV: "production", NODE_ENV: "production", BEDS24_ESCRITA_RESERVAS: "ligada", BEDS24_REFRESH_TOKEN: "refresh-ficticio", BEDS24_ORGANIZACAO_ID: c.org });
    const credencial = impressaoCredencialBeds24(PRONTO);
    await gravarConfig(db, c.org, "reservas_beds24", { pausado: null, retomado: null, imoveis: [{ imovelId: c.imovel, ligadoEm: "2026-09-01T00:00:00.000Z", ligadoPor: null }], ensaio: { credencial, em: "2026-09-01T00:00:00.000Z", operacaoId: "6f1c2a7e-3b4d-4c5e-8f90-123456789abc" } }, null);
    await gravarEscoposLidos(db, c.org, credencial, { escopos: [...ESCOPOS_ESPERADOS_FALSO], ilegiveis: [] }, minutos(0));
    const x = await pagarEConfirmar(c);
    const livro = () => db.select().from(lancamentos).where(eq(lancamentos.organizacaoId, c.org)).orderBy(asc(lancamentos.id));
    const pagos = () => db.select().from(pagamentos).where(eq(pagamentos.organizacaoId, c.org)).orderBy(asc(pagamentos.id));
    const antes = { reserva: await c.reserva(x.reservaId), livro: await livro(), pagos: await pagos() };

    const falso = new Beds24Falso(() => minutos(10));
    falso.falhar = new ErroBeds24("A conexão com o Beds24 foi interrompida.", "rede");
    await expect(executarCronReservasBeds24(db, PRONTO, { cliente: falso, leitor: falso, correio: new CorreioMemoria(), relogio: { agora: () => minutos(10), restanteMs: () => 240_000 } })).rejects.toMatchObject({ name: "ErroDeRotina" });

    expect(falso.escritasReservas).toEqual([]);
    expect(await c.reserva(x.reservaId)).toEqual(antes.reserva);
    expect((await c.reserva(x.reservaId)).estado).toBe("confirmada");
    expect(await livro()).toEqual(antes.livro);
    expect(await pagos()).toEqual(antes.pagos);
    expect((await ultimasExecucoes(db)).get("reservas-beds24")).toMatchObject({ ok: false, resumo: expect.stringMatching(/^Falhou: /) });
  });
});
