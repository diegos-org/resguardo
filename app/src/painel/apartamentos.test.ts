import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarContrato } from "@/contratos/repositorio";
import { imoveis, organizacoes, proprietarioImoveis, proprietarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { criarCategoria } from "@/despesas/categorias";
import { registrarDespesa } from "@/despesas/despesas";
import { listarImoveis } from "@/imoveis/repositorio";
import type { DadosReserva } from "@/reservas/regras";
import { criarReserva } from "@/reservas/repositorio";
import { carregarApartamentos, lerColunas, lerIntervalo } from "./apartamentos";
import { carregarDashboard } from "./dashboard";

describe("como ver (URL)", () => {
  it("colunas: padrão, escolhidas e inválidas ignoradas", () => {
    expect(lerColunas({})).toEqual(["reservas", "ocupacao", "comissoes", "despesas", "resultado", "saldo", "aCobrar"]);
    expect(lerColunas({ col: ["resultado", "xyz", "receita"] })).toEqual(["receita", "resultado"]);
    expect(lerColunas({ col: "xyz" })).toContain("resultado");
  });

  it("intervalo de meses: válido, dezembro, invertido, longo e incompleto", () => {
    expect(lerIntervalo({})).toEqual({});
    expect(lerIntervalo({ de: "2026-03", ate: "2026-05" }).periodo).toEqual({ inicio: "2026-03-01", fim: "2026-06-01" });
    expect(lerIntervalo({ de: "2026-11", ate: "2026-12" }).periodo).toEqual({ inicio: "2026-11-01", fim: "2027-01-01" });
    expect(lerIntervalo({ de: "2026-05", ate: "2026-03" })).toMatchObject({ aviso: expect.stringContaining("antes") });
    expect(lerIntervalo({ de: "2020-01", ate: "2026-01" })).toMatchObject({ aviso: expect.stringContaining("36") });
    expect(lerIntervalo({ de: "2026-03" })).toMatchObject({ aviso: expect.stringContaining("incompleto") });
    expect(lerIntervalo({ de: "2026-13", ate: "2026-14" }).periodo).toBeUndefined();
    expect(lerIntervalo({ de: "0000-01", ate: "0000-02" })).toMatchObject({ aviso: expect.stringContaining("faixa") });
    expect(lerIntervalo({ de: "2100-11", ate: "2101-01" }).periodo).toBeUndefined();
  });
});

let db: Db;
let close: () => Promise<void>;
let org: string;
let a: string;
let b: string;
let categoria: string;
const periodo = { inicio: "2026-10-01", fim: "2026-11-01" };

const reserva = (imovelId: string, checkin: string, checkout: string): DadosReserva => ({
  imovelId,
  origem: "booking",
  estado: "confirmada",
  checkin,
  checkout,
  hospedes: 2,
  hospedeNome: "Hóspede Fictício",
  hospedeEmail: "",
  hospedeTelefone: "",
  hospedeOrigem: "",
  moeda: "BRL",
  valorBruto: 100000,
  taxaCanal: 15000,
  valorLiquido: null,
  codigoCanal: "",
  observacoes: "",
});

const despesa = (o: { responsavel: "empresa" | "proprietario"; valor: number; imovelId: string | null; descricao: string }) =>
  registrarDespesa(
    db,
    org,
    { ...o, pagoPor: "empresa", categoriaId: categoria, proprietarioId: null, fornecedor: "", comprovante: "", paga: true, dataPagamento: "2026-10-05", data: "2026-10-05" },
    null,
  );

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "A" }).returning();
  [{ id: a }, { id: b }] = await db
    .insert(imoveis)
    .values([
      { organizacaoId: org, codigo: "403", nome: "Quatro" },
      { organizacaoId: org, codigo: "102", nome: "Um" },
    ])
    .returning();
  const [dono] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Dona" }).returning();
  await db.insert(proprietarioImoveis).values({ proprietarioId: dono.id, imovelId: a });
  await criarContrato(db, org, a, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
  const c = await criarCategoria(db, org, "Manutenção", null);
  if (!c.ok) throw new Error("categoria");
  categoria = c.categoria.id;
});
afterEach(() => close());

const carregar = async (so?: string) => {
  const todos = await listarImoveis(db, org, { incluirInativos: true });
  const sel = so ? todos.filter((i) => i.codigo === so) : todos;
  return carregarApartamentos(db, org, { imoveis: sel, todos: !so, periodo });
};

describe("aba Apartamentos", () => {
  it("uma linha por imóvel, geral da empresa à parte, e o total bate com o Início", async () => {
    await criarReserva(db, org, reserva(a, "2026-10-10", "2026-10-13"), null);
    await criarReserva(db, org, reserva(a, "2026-10-20", "2026-10-22"), null);
    await despesa({ responsavel: "empresa", valor: 5000, imovelId: b, descricao: "Lâmpada" });
    await despesa({ responsavel: "empresa", valor: 30000, imovelId: null, descricao: "Contador" });
    await despesa({ responsavel: "proprietario", valor: 40000, imovelId: a, descricao: "Reparo" });

    const { linhas, total } = await carregar();
    expect(linhas.map((l) => l.codigo)).toEqual(["102", "403", "—"]);
    const l403 = linhas.find((l) => l.codigo === "403")!;
    // 2 reservas: bruto 2 × 1.000; comissão 15% sobre 850 cada.
    expect(l403).toMatchObject({ reservas: 2, noitesVendidas: 5, despesasProprietario: 40000, aCobrar: 40000, contestados: 0 });
    expect(l403.financeiro).toMatchObject({ receitaBruta: 200000, comissoes: 25500, despesasEmpresa: 0, resultadoEmpresa: 25500 });
    // Sem movimento antes de outubro, o saldo acumulado é o próprio movimento do período.
    expect(l403.saldo).toBe(l403.acertoPeriodo);
    expect(linhas.find((l) => l.codigo === "102")!.financeiro).toMatchObject({ despesasEmpresa: 5000, resultadoEmpresa: -5000 });
    expect(linhas.find((l) => l.codigo === "—")!.financeiro).toMatchObject({ despesasEmpresa: 30000, resultadoEmpresa: -30000 });
    expect(total.financeiro.resultadoEmpresa).toBe(25500 - 5000 - 30000);
    expect(total.reservas).toBe(2);

    const lista = await listarImoveis(db, org);
    const d = await carregarDashboard(db, org, { imoveis: lista, todos: true, periodo, ano: 2026, hoje: "2026-10-09", verFinanceiro: true });
    expect(total.financeiro).toEqual(d.financeiro);
    expect(total.noitesVendidas).toBe(d.ocupacaoTotal.vendidas);
  });

  it("saldo do acerto é o acumulado até o fim do período (inclui meses anteriores)", async () => {
    await despesa({ responsavel: "proprietario", valor: 40000, imovelId: a, descricao: "Reparo" });
    const r = await carregarApartamentos(db, org, { imoveis: await listarImoveis(db, org), todos: true, periodo: { inicio: "2026-11-01", fim: "2026-12-01" } });
    const l = r.linhas.find((x) => x.codigo === "403")!;
    expect(l.acertoPeriodo).toBe(0);
    expect(l.saldo).toBe(-40000);
  });

  it("filtro de um imóvel: só ele, sem a linha geral; arquivado sem movimento some", async () => {
    await despesa({ responsavel: "empresa", valor: 30000, imovelId: null, descricao: "Contador" });
    const so = await carregar("102");
    expect(so.linhas.map((l) => l.codigo)).toEqual(["102"]);
    expect(so.total.financeiro.despesasEmpresa).toBe(0);

    await db.update(imoveis).set({ ativo: false }).where(eq(imoveis.id, b));
    expect((await carregar()).linhas.map((l) => l.codigo)).toEqual(["403", "—"]);
    await despesa({ responsavel: "empresa", valor: 5000, imovelId: b, descricao: "Lâmpada" });
    const comArquivado = await carregar();
    expect(comArquivado.linhas.map((l) => [l.codigo, l.ativo])).toEqual([
      ["102", false],
      ["403", true],
      ["—", true],
    ]);
  });

  it("imóvel que trocou de dono: o saldo da linha é do dono atual; o do anterior aparece à parte", async () => {
    await despesa({ responsavel: "proprietario", valor: 40000, imovelId: a, descricao: "Reparo" }); // dívida da Dona
    const [novo] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Novo dono" }).returning();
    await db.delete(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, a));
    await db.insert(proprietarioImoveis).values({ proprietarioId: novo.id, imovelId: a });
    let l = (await carregar()).linhas.find((x) => x.codigo === "403")!;
    expect(l).toMatchObject({ saldo: 0, acertoPeriodo: 0, saldoOutrosDonos: -40000, aCobrar: 0 });
    await despesa({ responsavel: "proprietario", valor: 10000, imovelId: a, descricao: "Chave" }); // já do novo dono
    l = (await carregar()).linhas.find((x) => x.codigo === "403")!;
    expect(l).toMatchObject({ saldo: -10000, acertoPeriodo: -10000, saldoOutrosDonos: -40000, aCobrar: 10000 });
  });

  it("filtro sem imóvel nenhum não soma a organização inteira", async () => {
    await despesa({ responsavel: "empresa", valor: 30000, imovelId: null, descricao: "Contador" });
    const r = await carregarApartamentos(db, org, { imoveis: [], todos: false, periodo });
    expect(r.linhas).toEqual([]);
    expect(r.total.financeiro.despesasEmpresa).toBe(0);
  });
});
