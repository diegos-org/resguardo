import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { imoveis, lancamentos, organizacoes, proprietarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { estornar, lancar, LancamentoInvalido, listarLancamentos, mudarEstado, saldoAcerto, totaisPorTipo } from "./ledger";

let db: Db;
let close: () => Promise<void>;
let org: string;
let outra: string;
let im: string;
let dono: string;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const [a, b] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
  org = a.id;
  outra = b.id;
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "t1", nome: "Um" }).returning();
  [{ id: dono }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Proprietária" }).returning();
});
afterEach(() => close());

describe("ledger", () => {
  it("adiantamento de R$ 4.000 e compensação: saldo só zera depois do reembolso", async () => {
    // Exemplo dos requisitos: empresa adianta reparo devido pelo proprietário.
    await lancar(
      db,
      org,
      [{ tipo: "adiantamento", descricao: "Reparo ar-condicionado", valor: 0, efeitoSaldo: -400000, competencia: "2026-10-05", imovelId: im, proprietarioId: dono }],
      null,
    );
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(-400000);
    // não vira receita nem dupla despesa da empresa
    expect((await totaisPorTipo(db, org, {})).adiantamento).toBe(0);

    await lancar(db, org, [{ tipo: "reembolso", descricao: "Compensado no repasse de outubro", valor: 0, efeitoSaldo: 400000, competencia: "2026-10-31", proprietarioId: dono }], null);
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(0);
  });

  it("estorno anula valores, não pode ser feito duas vezes nem sobre outro estorno", async () => {
    const [l] = await lancar(
      db,
      org,
      [{ tipo: "comissao", descricao: "Comissão reserva X", valor: 22500, efeitoSaldo: 0, competencia: "2026-10-10", imovelId: im }],
      null,
    );
    const espelho = await estornar(db, org, l.id, "valor lançado errado", null);
    expect(espelho).toMatchObject({ valor: -22500, estornoDe: l.id });
    expect((await totaisPorTipo(db, org, {})).comissao).toBe(0);
    await expect(estornar(db, org, l.id, "de novo", null)).rejects.toThrow("já foi estornado");
    await expect(estornar(db, org, espelho.id, "estorno do estorno", null)).rejects.toThrow("estorno");
    await expect(estornar(db, org, l.id, "", null)).rejects.toThrow("motivo");
  });

  it("estorno de lançamento já realizado leva data de caixa", async () => {
    const [l] = await lancar(db, org, [{ tipo: "recebimento", descricao: "Payout", valor: 1000, competencia: "2026-10-10", dataCaixa: "2026-10-12", estado: "realizado" }], null);
    expect((await estornar(db, org, l.id, "payout devolvido", null, "2026-10-20")).dataCaixa).toBe("2026-10-20");
    const [p] = await lancar(db, org, [{ tipo: "comissao", descricao: "Prevista", valor: 10, competencia: "2026-10-10" }], null);
    expect((await estornar(db, org, p.id, "x", null)).dataCaixa).toBeNull();
  });

  it("chave de origem torna o lançamento idempotente", async () => {
    const novo = { tipo: "receita_bruta" as const, descricao: "Reserva X", valor: 150000, competencia: "2026-10-10", imovelId: im, chaveOrigem: "reserva:x:bruto" };
    const [a] = await lancar(db, org, [novo], null);
    const [b] = await lancar(db, org, [novo], null);
    expect(b.id).toBe(a.id);
    expect(await db.select().from(lancamentos)).toHaveLength(1);
  });

  it("gravação em lote é tudo ou nada", async () => {
    await expect(
      lancar(
        db,
        org,
        [
          { tipo: "receita_bruta", descricao: "ok", valor: 100, competencia: "2026-10-01", imovelId: im },
          { tipo: "receita_bruta", descricao: "imóvel de fora", valor: 100, competencia: "2026-10-01", imovelId: "00000000-0000-4000-8000-000000000999" },
        ],
        null,
      ),
    ).rejects.toBeInstanceOf(LancamentoInvalido);
    expect(await db.select().from(lancamentos)).toEqual([]);
  });

  it("valida valores, datas e exige proprietário quando mexe no acerto", async () => {
    const base = { tipo: "ajuste" as const, descricao: "x", valor: 1, competencia: "2026-10-01" };
    await expect(lancar(db, org, [{ ...base, valor: 1.5 }], null)).rejects.toThrow("centavos");
    await expect(lancar(db, org, [{ ...base, competencia: "2026-02-30" }], null)).rejects.toThrow("Competência");
    await expect(lancar(db, org, [{ ...base, descricao: " " }], null)).rejects.toThrow("Descrição");
    await expect(lancar(db, org, [{ ...base, efeitoSaldo: 10 }], null)).rejects.toThrow("proprietário");
    await expect(lancar(db, org, [{ ...base, tipo: "toString" as never }], null)).rejects.toThrow("Tipo");
  });

  it("isolamento: não lança com proprietário de outra organização nem estorna de fora", async () => {
    await expect(
      lancar(db, outra, [{ tipo: "repasse", descricao: "x", valor: 0, efeitoSaldo: -1, competencia: "2026-10-01", proprietarioId: dono }], null),
    ).rejects.toThrow("outra organização");
    const [l] = await lancar(db, org, [{ tipo: "ajuste", descricao: "x", valor: 5, competencia: "2026-10-01" }], null);
    await expect(estornar(db, outra, l.id, "x", null)).rejects.toThrow("não encontrado");
    expect(await saldoAcerto(db, outra, {})).toBe(0);
  });

  it("estado muda com histórico; o resto do lançamento não muda", async () => {
    const [l] = await lancar(db, org, [{ tipo: "recebimento", descricao: "Payout Airbnb", valor: 127500, competencia: "2026-10-10", imovelId: im }], null);
    const d = await mudarEstado(db, org, l.id, "realizado", null, "2026-10-12");
    expect(d).toMatchObject({ estado: "realizado", dataCaixa: "2026-10-12", valor: 127500 });
    await mudarEstado(db, org, l.id, "conciliado", null);
    const h = await historicoDe(db, org, "lancamento", l.id);
    expect(h.map((x) => x.acao)).toEqual(["lancamento.estado", "lancamento.estado", "lancamento.criar"]);
    expect(await mudarEstado(db, outra, l.id, "pendente", null)).toBeNull();
    const [final] = await db.select().from(lancamentos).where(eq(lancamentos.id, l.id));
    expect(final.estado).toBe("conciliado");
  });

  it("lista e totaliza por período (competência, fim exclusivo) e imóvel", async () => {
    await lancar(
      db,
      org,
      [
        { tipo: "receita_bruta", descricao: "set", valor: 100, competencia: "2026-09-30", imovelId: im },
        { tipo: "receita_bruta", descricao: "out", valor: 200, competencia: "2026-10-01", imovelId: im },
        { tipo: "despesa_empresa", descricao: "lavanderia", valor: -50, competencia: "2026-10-15" },
      ],
      null,
    );
    const outubro = { inicio: "2026-10-01", fim: "2026-11-01" };
    expect((await listarLancamentos(db, org, outubro)).map((l) => l.descricao)).toEqual(["out", "lavanderia"]);
    expect(await totaisPorTipo(db, org, outubro)).toEqual({ receita_bruta: 200, despesa_empresa: -50 });
    expect(await totaisPorTipo(db, org, { ...outubro, imovelIds: [im] })).toEqual({ receita_bruta: 200 });
  });
});
