import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { lancamentos } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { partesDoProprietario } from "@/repasses/extrato";
import { dinheiroComAEmpresa, recebidoPorReserva } from "@/repasses/recebimentos";
import { conferirTentativa } from "./conferencia";
import { chaveRecebimento } from "./liberacao";
import { AGORA, type Cenario, minutos, montarCenario, TOTAL } from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => { c = await montarCenario(db); });

// Valores fictícios: o teste compara prazos, não tabelas comerciais de taxas.
const LIQUIDO = TOTAL - 7000;
const PLANOS = [
  { plano: "imediata", prevista: minutos(5), dia: "2026-10-01" },
  { plano: "14 dias", prevista: new Date("2026-10-15T15:00:00Z"), dia: "2026-10-15" },
  { plano: "30 dias", prevista: new Date("2026-10-31T15:00:00Z"), dia: "2026-10-31" },
];

describe("comparação dos prazos de liberação do cartão (M8.2b)", () => {
  it.each(PLANOS)("$plano: previsão não vira caixa; sinal e check-in são necessários, sem recebimento duplicado", async ({ prevista, dia }) => {
    const s = await c.segurar();
    const p = await c.cartao(s.cotacaoId);
    expect(p.resultado).toMatchObject({ ok: true, situacao: "aprovado" });
    const pagamentoId = p.pagamentoId!, idProvedor = p.idProvedor!;
    const conferir = (quando: Date) => conferirTentativa(db, c.org, pagamentoId, c.provedor, quando, { origem: "rotina", forcar: true });
    const recebimentos = () => db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, s.reservaId), eq(lancamentos.tipo, "recebimento")));
    const recebido = async () => (await recebidoPorReserva(db, c.org, [s.reservaId])).get(s.reservaId)!;
    const partes = (quando: Date) => partesDoProprietario(db, c.org, c.dono, quando, { reservaIds: [s.reservaId] });

    // Nem um sinal contraditório antes da data futura faz o dinheiro entrar.
    c.provedor.atualizarFinanceiro(idProvedor, { liquido: LIQUIDO, liberacaoPrevista: prevista, liberado: true });
    await conferir(minutos(1, AGORA));
    expect(await recebimentos()).toEqual([]);
    expect(dinheiroComAEmpresa(await recebido())).toBe(false);
    expect(await c.reserva(s.reservaId)).toMatchObject({ estado: "confirmada", taxaCanal: 7000, valorLiquido: LIQUIDO });

    // Chegar à data prevista sem confirmação explícita também não basta.
    for (const liberado of [false, null]) {
      c.provedor.atualizarFinanceiro(idProvedor, { liberado });
      await conferir(minutos(1, prevista));
      expect(await recebimentos()).toEqual([]);
      expect(dinheiroComAEmpresa(await recebido())).toBe(false);
      expect((await partes(minutos(1, prevista))).map((parte) => parte.situacao)).toEqual(["a_liberar"]);
    }

    // O provedor confirmou: duas leituras geram um único recebimento, no dia do sinal.
    c.provedor.atualizarFinanceiro(idProvedor, { liberado: true });
    await conferir(minutos(2, prevista));
    await conferir(minutos(3, prevista));
    expect(await recebimentos()).toMatchObject([{ estado: "conciliado", origem: "sincronizacao", valor: 0, montante: LIQUIDO, dataCaixa: dia, chaveOrigem: chaveRecebimento(pagamentoId) }]);
    expect(await recebimentos()).toHaveLength(1);
    expect(await recebido()).toMatchObject({ recebido: LIQUIDO, devido: LIQUIDO, dataCompleto: dia });
    expect(dinheiroComAEmpresa(await recebido())).toBe(true);

    // Na liberação imediata ainda falta o check-in de 12/10. Nos outros planos ele já passou.
    expect((await partes(minutos(3, prevista))).map((parte) => parte.situacao)).toEqual([dia === "2026-10-01" ? "a_liberar" : "disponivel"]);
    const depoisDosDois = new Date(Math.max(minutos(3, prevista).getTime(), Date.parse("2026-10-13T15:00:00Z")));
    expect((await partes(depoisDosDois)).map((parte) => parte.situacao)).toEqual(["disponivel"]);
  });
});
