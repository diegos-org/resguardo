/**
 * M4.8 — a mesma reserva dá os mesmos totais no Início (dashboard), na aba Apartamentos,
 * no portal do proprietário e no relatório em PDF. Cenário com o que costuma desalinhar:
 * estada entre dois meses, reserva cancelada, reserva pendente, imóvel de outro dono,
 * despesa do proprietário e venda direta.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarContrato } from "@/contratos/repositorio";
import { imoveis, organizacoes, proprietarioImoveis, proprietarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { criarCategoria } from "@/despesas/categorias";
import { registrarDespesa } from "@/despesas/despesas";
import { listarImoveis } from "@/imoveis/repositorio";
import { reservasDoPortal } from "@/portal/reservas";
import { resumoDoProprietario } from "@/portal/resumo";
import { dadosDoRelatorio, textosDoRelatorio } from "@/relatorios/relatorio";
import type { DadosReserva } from "@/reservas/regras";
import { cancelarReserva, criarReserva, sincronizarReserva } from "@/reservas/repositorio";
import { formatBRL } from "@/lib/money";
import { carregarApartamentos } from "./apartamentos";
import { carregarDashboard } from "./dashboard";

let db: Db;
let close: () => Promise<void>;
let org: string;
let a: string;
let b: string;
let dona: string;

const OUTUBRO = { inicio: "2026-10-01", fim: "2026-11-01" };

const reserva = (imovelId: string, checkin: string, checkout: string, over: Partial<DadosReserva> = {}): DadosReserva => ({
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
  ...over,
});

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
  const [d1, d2] = await db
    .insert(proprietarios)
    .values([
      { organizacaoId: org, nome: "Dona Fictícia" },
      { organizacaoId: org, nome: "Outro Dono" },
    ])
    .returning();
  dona = d1.id;
  await db.insert(proprietarioImoveis).values([
    { proprietarioId: d1.id, imovelId: a },
    { proprietarioId: d2.id, imovelId: b },
  ]);
  await criarContrato(db, org, a, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
  await criarContrato(db, org, b, { tipo: "gestao_completa", comissao: "20", inicio: "2025-01-01" }, null);

  // 403: uma inteira em outubro, uma que passa para novembro (4 de 8 noites em outubro),
  // uma venda direta, uma cancelada e uma pendente.
  await criarReserva(db, org, reserva(a, "2026-10-05", "2026-10-10"), null);
  await criarReserva(db, org, reserva(a, "2026-10-28", "2026-11-05", { valorBruto: 200000, taxaCanal: 30000 }), null);
  await criarReserva(db, org, reserva(a, "2026-10-15", "2026-10-18", { origem: "direta", valorBruto: 60000, taxaCanal: 0 }), null);
  const cancelada = await criarReserva(db, org, reserva(a, "2026-10-20", "2026-10-22"), null);
  if (!cancelada.ok) throw new Error("reserva");
  await cancelarReserva(db, org, cancelada.reserva.id, null);
  await criarReserva(db, org, reserva(a, "2026-10-23", "2026-10-25", { estado: "pendente" }), null);
  // 102, de outro dono: nunca entra nos números da Dona.
  await criarReserva(db, org, reserva(b, "2026-10-05", "2026-10-09", { valorBruto: 999900, taxaCanal: 99900 }), null);
  // Despesa do proprietário no 403.
  const c = await criarCategoria(db, org, "Manutenção", null);
  if (!c.ok) throw new Error("categoria");
  await registrarDespesa(
    db,
    org,
    { categoriaId: c.categoria.id, proprietarioId: null, fornecedor: "", comprovante: "", paga: true, dataPagamento: "2026-10-12", data: "2026-10-12", responsavel: "proprietario", pagoPor: "empresa", descricao: "Reparo", valor: 12000, imovelId: a },
    null,
  );
});
afterEach(() => close());

describe("consistência entre telas (M4.8)", () => {
  it("mesma reserva, mesmos totais no Início, em Apartamentos, no portal e no PDF", async () => {
    const lista = await listarImoveis(db, org);
    const so403 = lista.filter((i) => i.codigo === "403");
    const inicio = await carregarDashboard(db, org, { imoveis: so403, todos: false, periodo: OUTUBRO, ano: 2026, hoje: "2026-11-10", verFinanceiro: true });
    const { linhas } = await carregarApartamentos(db, org, { imoveis: so403, todos: false, periodo: OUTUBRO });
    const apto = linhas.find((l) => l.codigo === "403")!;
    const portal = await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [a], semImovel: true, periodo: OUTUBRO });
    const listaPortal = await reservasDoPortal(db, org, { proprietarioIds: [dona], imovelIds: [a], periodo: OUTUBRO });
    const dados = await dadosDoRelatorio(db, org, {
      donos: [{ id: dona, nome: "Dona Fictícia" }],
      imoveis: [{ id: a, codigo: "403", nome: "Quatro" }],
      todosOsImoveis: true,
      ano: 2026,
      mes: 10,
      hoje: "2026-11-10",
    });
    const pdf = textosDoRelatorio(dados);
    const noPdf = (rotulo: string) => pdf.numeros.find((n) => n.rotulo.startsWith(rotulo))?.valor;

    // Bruto de outubro: 1.000 + metade de 2.000 (4 de 8 noites) + 600 da direta = 2.600.
    const bruto = 100000 + 100000 + 60000;
    // Taxas: 150 + metade de 300.
    const taxas = 15000 + 15000;
    // Comissão 15% sobre (bruto − taxa) de cada parte.
    const comissao = Math.round(0.15 * 85000) + Math.round(0.15 * 85000) + Math.round(0.15 * 60000);
    // Contam as confirmadas que tocam outubro (a cancelada e a pendente não).
    const nReservas = 3;

    expect(inicio.financeiro).toMatchObject({ receitaBruta: bruto, taxasCanais: taxas, comissoes: comissao });
    expect(inicio.reservasNoPeriodo).toBe(nReservas);

    expect(apto.financeiro).toMatchObject({ receitaBruta: bruto, taxasCanais: taxas, comissoes: comissao });
    expect(apto.reservas).toBe(nReservas);
    expect(apto.despesasProprietario).toBe(12000);

    expect(portal).toMatchObject({ reservas: nReservas, receitaBruta: bruto, taxasCanais: taxas, comissao, despesas: 12000 });
    expect(listaPortal).toHaveLength(nReservas);
    expect(listaPortal.reduce((t, r) => t + r.bruto, 0)).toBe(bruto);
    expect(listaPortal.reduce((t, r) => t + r.suaParte, 0)).toBe(portal.suaParte);
    expect(portal.suaParte).toBe(bruto - taxas - comissao);

    // Acerto do mês: o mesmo no portal e na aba Apartamentos.
    expect(portal.acerto).toBe(apto.acertoPeriodo);

    // O PDF mostra exatamente os números do portal.
    expect(dados.resumo).toEqual(portal);
    expect(noPdf("Reservas no mês")).toBe(String(nReservas));
    expect(noPdf("Valor bruto")).toBe(formatBRL(bruto));
    expect(noPdf("Taxas dos canais")).toBe(formatBRL(taxas));
    expect(noPdf("Comissão")).toBe(formatBRL(comissao));
    expect(noPdf("Sua parte")).toBe(formatBRL(portal.suaParte));
    expect(noPdf("Despesas atribuídas")).toBe(formatBRL(12000));
    expect(noPdf("Vendas diretas")).toBe(formatBRL(60000));
    expect(pdf.reservas).toHaveLength(nReservas);
  });

  it("todos os imóveis: o Início soma o mesmo que o total da aba Apartamentos", async () => {
    const lista = await listarImoveis(db, org);
    const inicio = await carregarDashboard(db, org, { imoveis: lista, todos: true, periodo: OUTUBRO, ano: 2026, hoje: "2026-11-10", verFinanceiro: true });
    const { total } = await carregarApartamentos(db, org, { imoveis: lista, todos: true, periodo: OUTUBRO });
    expect(total.financeiro).toEqual(inicio.financeiro);
    expect(total.reservas).toBe(inicio.reservasNoPeriodo);
  });

  it("reserva pendente entra em todas as telas ao mesmo tempo, quando é confirmada", async () => {
    const lista = await listarImoveis(db, org);
    const so403 = lista.filter((i) => i.codigo === "403");
    const totais = async () => {
      const inicio = await carregarDashboard(db, org, { imoveis: so403, todos: false, periodo: OUTUBRO, ano: 2026, hoje: "2026-11-10", verFinanceiro: true });
      const { linhas } = await carregarApartamentos(db, org, { imoveis: so403, todos: false, periodo: OUTUBRO });
      const portal = await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [a], semImovel: true, periodo: OUTUBRO });
      return [inicio.financeiro?.receitaBruta, inicio.reservasNoPeriodo, linhas[0].financeiro.receitaBruta, linhas[0].reservas, portal.receitaBruta, portal.reservas];
    };
    const antes = await totais();
    expect(antes).toEqual([260000, 3, 260000, 3, 260000, 3]);
    const pendente = reserva(a, "2026-10-01", "2026-10-03", { estado: "pendente", valorBruto: 50000, taxaCanal: 0 });
    await sincronizarReserva(db, org, "csv", "booking:P1", pendente, null);
    expect(await totais()).toEqual(antes);
    await sincronizarReserva(db, org, "csv", "booking:P1", { ...pendente, estado: "confirmada" }, null);
    expect(await totais()).toEqual([310000, 4, 310000, 4, 310000, 4]);
  });
});
