/**
 * M4.8 — a mesma reserva dá os mesmos totais no Início (dashboard), na aba Apartamentos,
 * no portal do proprietário e no relatório em PDF. Cenário com o que costuma desalinhar:
 * estada entre dois meses, reserva cancelada, reserva pendente, imóvel de outro dono,
 * despesa do proprietário e venda direta.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { criarContrato } from "@/contratos/repositorio";
import { conferirMovimentadas, recalcularPendentes, recalcularReservas } from "@/financeiro/aplicar";
import { preverRepasses } from "@/repasses/repasses";
import { contratos, lancamentos, imoveis, organizacoes, proprietarioImoveis, proprietarios, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { criarCategoria } from "@/despesas/categorias";
import { registrarDespesa } from "@/despesas/despesas";
import { listarImoveis } from "@/imoveis/repositorio";
import { reservasDoPortal } from "@/portal/reservas";
import { resumoDoProprietario } from "@/portal/resumo";
import { dadosDoRelatorio, textosDoRelatorio } from "@/relatorios/relatorio";
import type { DadosReserva } from "@/reservas/regras";
import { cancelarReserva, confirmarReserva, criarReserva, resolverConferencia, sincronizarReserva } from "@/reservas/repositorio";
import { formatBRL } from "@/lib/money";
import * as datas from "@/lib/datas";
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
afterEach(async () => {
  vi.restoreAllMocks();
  await close();
});

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
    // Pendente sem lançamento é o esperado: o Início não acusa "sem cálculo".
    const inicio = await carregarDashboard(db, org, { imoveis: so403, todos: false, periodo: OUTUBRO, ano: 2026, hoje: "2026-11-10", verFinanceiro: true });
    expect(inicio.alertas.map((x) => x.texto).join(" | ")).not.toContain("sem cálculo");
    await sincronizarReserva(db, org, "csv", "booking:P1", { ...pendente, estado: "confirmada" }, null);
    expect(await totais()).toEqual([310000, 4, 310000, 4, 310000, 4]);
  });

  const tresTelas = async () => {
    const so403 = (await listarImoveis(db, org)).filter((i) => i.codigo === "403");
    const inicio = await carregarDashboard(db, org, { imoveis: so403, todos: false, periodo: OUTUBRO, ano: 2026, hoje: "2026-11-10", verFinanceiro: true });
    const { linhas } = await carregarApartamentos(db, org, { imoveis: so403, todos: false, periodo: OUTUBRO });
    const portal = await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [a], semImovel: true, periodo: OUTUBRO });
    // O portal separa o que está em conferência (acertoPendente); o painel mostra o movimento todo.
    return {
      inicio,
      contagens: [inicio.reservasNoPeriodo, linhas[0].reservas, portal.reservas],
      brutos: [inicio.financeiro?.receitaBruta, linhas[0].financeiro.receitaBruta, portal.receitaBruta],
      acertos: [linhas[0].acertoPeriodo, portal.acerto + portal.acertoPendente] };
  };

  it("pendente calculada por versão antiga: o ajuste do deploy tira os lançamentos dela de todas as telas", async () => {
    const r = await criarReserva(db, org, reserva(a, "2026-10-01", "2026-10-03", { valorBruto: 50000, taxaCanal: 0 }), null);
    if (!r.ok) throw new Error("reserva");
    // Como no banco de antes: pendente, mas com os lançamentos que o motor antigo criava.
    await db.update(reservas).set({ estado: "pendente" }).where(eq(reservas.id, r.reserva.id));
    const antes = await tresTelas();
    expect(new Set(antes.brutos).size).toBe(1);
    expect(await recalcularPendentes(db, org)).toMatchObject({ reservas: 1, protegidas: 0 });
    const depois = await tresTelas();
    expect(depois.brutos).toEqual([260000, 260000, 260000]);
    expect(depois.acertos[0]).toBe(depois.acertos[1]);
    // Idempotente: nada mais a fazer.
    expect(await recalcularPendentes(db, org)).toMatchObject({ reservas: 0 });
  });

  it("confirmada que já movimentou dinheiro e volta a pendente: os valores ficam em todas as telas e o Início avisa", async () => {
    const dados = reserva(a, "2026-10-01", "2026-10-03", { valorBruto: 50000, taxaCanal: 0 });
    const r = await sincronizarReserva(db, org, "csv", "booking:R1", dados, null);
    if (!r.ok) throw new Error("reserva");
    await db.update(lancamentos).set({ estado: "realizado" }).where(and(eq(lancamentos.reservaId, r.reserva.id), eq(lancamentos.tipo, "receita_bruta")));
    await sincronizarReserva(db, org, "csv", "booking:R1", { ...dados, estado: "pendente" }, null);
    const t = await tresTelas();
    expect(t.brutos).toEqual([310000, 310000, 310000]);
    expect(t.acertos[0]).toBe(t.acertos[1]);
    expect(t.inicio.alertas.map((x) => x.texto).join(" | ")).toContain("com dinheiro já movimentado");
    // O portal e o PDF mostram de onde vem o valor: a reserva aparece na tabela, "em conferência".
    const lista = await reservasDoPortal(db, org, { proprietarioIds: [dona], imovelIds: [a], periodo: OUTUBRO });
    const portal = await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [a], semImovel: true, periodo: OUTUBRO });
    expect(lista.reduce((x, y) => x + y.bruto, 0)).toBe(portal.receitaBruta);
    expect(lista.find((x) => x.id === r.reserva.id)?.situacao).toBe("em_conferencia");
    // Em conferência de verdade: o resumo avisa e o fechamento do mês não passa até alguém decidir.
    expect(portal.emConferencia).toBe(true);
    const [previsao] = await preverRepasses(db, org, "2026-10", "2026-11-10", [dona]);
    expect(previsao.bloqueios.join(" ")).toContain("acerto pendente");
  });

  it("não confirmada que já movimentou dinheiro e mudou de mês: a tabela do mês dos valores continua mostrando a reserva", async () => {
    const dados = reserva(a, "2026-10-01", "2026-10-03", { valorBruto: 50000, taxaCanal: 0 });
    const r = await sincronizarReserva(db, org, "csv", "booking:R2", dados, null);
    if (!r.ok) throw new Error("reserva");
    await db.update(lancamentos).set({ estado: "realizado" }).where(and(eq(lancamentos.reservaId, r.reserva.id), eq(lancamentos.tipo, "receita_bruta")));
    await sincronizarReserva(db, org, "csv", "booking:R2", { ...dados, estado: "cancelada", checkin: "2026-12-01", checkout: "2026-12-03" }, null);
    const lista = await reservasDoPortal(db, org, { proprietarioIds: [dona], imovelIds: [a], periodo: OUTUBRO });
    const portal = await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [a], semImovel: true, periodo: OUTUBRO });
    expect(lista.reduce((x, y) => x + y.bruto, 0)).toBe(portal.receitaBruta);
    expect(lista.some((x) => x.id === r.reserva.id)).toBe(true);
  });

  it("reserva reconfirmada sai da conferência sozinha (o fechamento volta a passar)", async () => {
    const dados = reserva(a, "2026-10-01", "2026-10-03", { valorBruto: 50000, taxaCanal: 0 });
    const r = await sincronizarReserva(db, org, "csv", "booking:R3", dados, null);
    if (!r.ok) throw new Error("reserva");
    await db.update(lancamentos).set({ estado: "realizado" }).where(and(eq(lancamentos.reservaId, r.reserva.id), eq(lancamentos.tipo, "receita_bruta")));
    await sincronizarReserva(db, org, "csv", "booking:R3", { ...dados, estado: "pendente" }, null);
    const bloqueios = async () => (await preverRepasses(db, org, "2026-10", "2026-11-10", [dona]))[0].bloqueios.join(" ");
    expect(await bloqueios()).toContain("acerto pendente");
    await sincronizarReserva(db, org, "csv", "booking:R3", dados, null);
    expect(await bloqueios()).not.toContain("acerto pendente");
    const portal = await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [a], semImovel: true, periodo: OUTUBRO });
    expect(portal.emConferencia).toBe(false);
  });

  it("não confirmada com dinheiro movimentado que mudou de imóvel: a tabela do dono antigo explica o total dele", async () => {
    const dados = reserva(a, "2026-10-01", "2026-10-03", { valorBruto: 50000, taxaCanal: 0 });
    const r = await sincronizarReserva(db, org, "csv", "booking:R4", dados, null);
    if (!r.ok) throw new Error("reserva");
    await db.update(lancamentos).set({ estado: "realizado" }).where(and(eq(lancamentos.reservaId, r.reserva.id), eq(lancamentos.tipo, "receita_bruta")));
    await sincronizarReserva(db, org, "csv", "booking:R4", { ...dados, estado: "cancelada", imovelId: b }, null);
    const lista = await reservasDoPortal(db, org, { proprietarioIds: [dona], imovelIds: [a], periodo: OUTUBRO });
    const portal = await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [a], semImovel: true, periodo: OUTUBRO });
    expect(lista.some((x) => x.id === r.reserva.id)).toBe(true);
    expect(lista.reduce((x, y) => x + y.bruto, 0)).toBe(portal.receitaBruta);
    // A linha mostra o imóvel do livro (o dela), não o novo imóvel de outro dono.
    expect(lista.find((x) => x.id === r.reserva.id)).toMatchObject({ imovelId: a, imovelCodigo: "403" });
  });

  it("conferência dada por resolvida no painel libera o fechamento; mudar a situação reabre", async () => {
    const dados = reserva(a, "2026-10-01", "2026-10-03", { valorBruto: 50000, taxaCanal: 0 });
    const r = await sincronizarReserva(db, org, "csv", "booking:R5", dados, null);
    if (!r.ok) throw new Error("reserva");
    await db.update(lancamentos).set({ estado: "realizado" }).where(and(eq(lancamentos.reservaId, r.reserva.id), eq(lancamentos.tipo, "receita_bruta")));
    await sincronizarReserva(db, org, "csv", "booking:R5", { ...dados, estado: "pendente" }, null);
    const bloqueios = async () => (await preverRepasses(db, org, "2026-10", "2026-11-10", [dona]))[0].bloqueios.join(" ");
    expect(await bloqueios()).toContain("acerto pendente");
    expect(await resolverConferencia(db, org, r.reserva.id, null)).toBe(true);
    expect(await bloqueios()).not.toContain("acerto pendente");
    const t = await tresTelas();
    expect(t.inicio.alertas.map((x) => x.texto).join(" | ")).not.toContain("com dinheiro já movimentado");
    const lista = await reservasDoPortal(db, org, { proprietarioIds: [dona], imovelIds: [a], periodo: OUTUBRO });
    expect(lista.find((x) => x.id === r.reserva.id)?.situacao).toBe("definido");
    // Só o nome do hóspede mudou: nada no financeiro, a conferência continua resolvida.
    await sincronizarReserva(db, org, "csv", "booking:R5", { ...dados, estado: "pendente", hospedeNome: "Outro Nome Fictício" }, null);
    expect(await bloqueios()).not.toContain("acerto pendente");
    // Mudou o valor (mesma situação): a decisão foi sobre os dados de antes, a conferência volta.
    await sincronizarReserva(db, org, "csv", "booking:R5", { ...dados, estado: "pendente", valorBruto: 55000 }, null);
    expect(await bloqueios()).toContain("acerto pendente");
    expect(await resolverConferencia(db, org, r.reserva.id, null)).toBe(true);
    // Cancelada depois: a situação mudou, a conferência volta.
    await sincronizarReserva(db, org, "csv", "booking:R5", { ...dados, estado: "cancelada" }, null);
    expect(await bloqueios()).toContain("acerto pendente");
    // Confirmada não tem o que resolver.
    await sincronizarReserva(db, org, "csv", "booking:R5", dados, null);
    expect(await resolverConferencia(db, org, r.reserva.id, null)).toBe(false);
  });

  it("resolvida vale também para a parte que já nasceu pendente (quem recebe a confirmar)", async () => {
    const dados = reserva(a, "2026-10-01", "2026-10-03", { valorBruto: 50000, taxaCanal: 0 });
    const r = await sincronizarReserva(db, org, "csv", "booking:R6", dados, null);
    if (!r.ok) throw new Error("reserva");
    await db.update(lancamentos).set({ estado: "realizado" }).where(and(eq(lancamentos.reservaId, r.reserva.id), eq(lancamentos.tipo, "receita_bruta")));
    // Como o motor faz com "quem recebe a confirmar": a parte dela nasceu pendente.
    await db.update(lancamentos).set({ estado: "pendente" }).where(and(eq(lancamentos.reservaId, r.reserva.id), eq(lancamentos.tipo, "direito_proprietario")));
    await sincronizarReserva(db, org, "csv", "booking:R6", { ...dados, estado: "cancelada" }, null);
    const bloqueios = async () => (await preverRepasses(db, org, "2026-10", "2026-11-10", [dona]))[0].bloqueios.join(" ");
    expect(await bloqueios()).toContain("acerto pendente");
    expect(await resolverConferencia(db, org, r.reserva.id, null)).toBe(true);
    expect(await bloqueios()).not.toContain("acerto pendente");
    const lista = await reservasDoPortal(db, org, { proprietarioIds: [dona], imovelIds: [a], periodo: OUTUBRO });
    expect(lista.find((x) => x.id === r.reserva.id)?.situacao).toBe("definido");
    // O Início também para de acusar "acerto pendente" dessa reserva.
    const t = await tresTelas();
    expect(t.inicio.alertas.map((x) => x.texto).join(" | ")).not.toContain("acerto pendente");
  });

  it("reserva pendente feita no painel é confirmada pelo botão e entra em todas as telas", async () => {
    const r = await criarReserva(db, org, reserva(a, "2026-10-01", "2026-10-03", { estado: "pendente", origem: "direta", valorBruto: 50000, taxaCanal: 0 }), null);
    if (!r.ok) throw new Error("reserva");
    expect((await tresTelas()).brutos).toEqual([260000, 260000, 260000]);
    expect(await confirmarReserva(db, org, r.reserva.id, null)).toEqual({ ok: true });
    expect((await tresTelas()).brutos).toEqual([310000, 310000, 310000]);
    // Já confirmada: nada a fazer.
    expect(await confirmarReserva(db, org, r.reserva.id, null)).toEqual({ ok: false });
  });

  it("confirmar não esconde divergência de reserva que já movimentou dinheiro: recusa e continua em conferência", async () => {
    const dados = reserva(a, "2026-10-01", "2026-10-03", { valorBruto: 50000, taxaCanal: 0 });
    const r = await sincronizarReserva(db, org, "csv", "booking:R7", dados, null);
    if (!r.ok) throw new Error("reserva");
    await db.update(lancamentos).set({ estado: "realizado" }).where(and(eq(lancamentos.reservaId, r.reserva.id), eq(lancamentos.tipo, "receita_bruta")));
    // Volta a pendente com outro valor; confirmar recalcularia diferente do que está no livro.
    await sincronizarReserva(db, org, "csv", "booking:R7", { ...dados, estado: "pendente", valorBruto: 70000 }, null);
    const res = await confirmarReserva(db, org, r.reserva.id, null);
    expect(res.ok).toBe(false);
    expect(res.aviso).toContain("não batem");
    const [depois] = await db.select().from(reservas).where(eq(reservas.id, r.reserva.id));
    expect(depois.estado).toBe("pendente");
    expect((await preverRepasses(db, org, "2026-10", "2026-11-10", [dona]))[0].bloqueios.join(" ")).toContain("acerto pendente");
  });

  it("sincronização que confirma de volta com valor diferente do dinheiro já movimentado fica em conferência", async () => {
    const dados = reserva(a, "2026-10-01", "2026-10-03", { valorBruto: 50000, taxaCanal: 0 });
    const r = await sincronizarReserva(db, org, "csv", "booking:R8", dados, null);
    if (!r.ok) throw new Error("reserva");
    await db.update(lancamentos).set({ estado: "realizado" }).where(and(eq(lancamentos.reservaId, r.reserva.id), eq(lancamentos.tipo, "receita_bruta")));
    await sincronizarReserva(db, org, "csv", "booking:R8", { ...dados, estado: "pendente" }, null);
    // Volta confirmada, mas com outro valor: o motor não mexe no que já movimentou dinheiro.
    await sincronizarReserva(db, org, "csv", "booking:R8", { ...dados, valorBruto: 70000 }, null);
    const bloqueios = async () => (await preverRepasses(db, org, "2026-10", "2026-11-10", [dona]))[0].bloqueios.join(" ");
    expect(await bloqueios()).toContain("acerto pendente");
    const t = await tresTelas();
    expect(t.inicio.alertas.map((x) => x.texto).join(" | ")).toContain("com dinheiro já movimentado");
    // Resolvida no painel (depois do ajuste): libera.
    expect(await resolverConferencia(db, org, r.reserva.id, null)).toBe(true);
    expect(await bloqueios()).not.toContain("acerto pendente");
    // Voltou a bater com o livro: acabou a divergência.
    await sincronizarReserva(db, org, "csv", "booking:R8", dados, null);
    const [depois] = await db.select().from(reservas).where(eq(reservas.id, r.reserva.id));
    expect(depois.divergenciaEm).toBeNull();
  });
  it("conferência resolvida reabre quando o contrato muda e o cálculo novo diverge de outro jeito", async () => {
    // O cenário exige uma entrada futura; o recálculo real nunca alcança o passado.
    vi.spyOn(datas, "hojeISO").mockReturnValue("2026-09-24");
    const dados = reserva(a, "2026-10-01", "2026-10-03", { valorBruto: 50000, taxaCanal: 0 });
    const r = await sincronizarReserva(db, org, "csv", "booking:R9", dados, null);
    if (!r.ok) throw new Error("reserva");
    await db.update(lancamentos).set({ estado: "realizado" }).where(and(eq(lancamentos.reservaId, r.reserva.id), eq(lancamentos.tipo, "receita_bruta")));
    await sincronizarReserva(db, org, "csv", "booking:R9", { ...dados, valorBruto: 70000 }, null);
    const bloqueios = async () => (await preverRepasses(db, org, "2026-10", "2026-11-10", [dona]))[0].bloqueios.join(" ");
    expect(await resolverConferencia(db, org, r.reserva.id, null)).toBe(true);
    // O recálculo do deploy com as mesmas regras não reabre (é a mesma divergência já resolvida).
    await recalcularReservas(db, org, { aPartirDe: "2026-09-24" });
    expect(await bloqueios()).not.toContain("acerto pendente");
    // O contrato muda: o cálculo novo é outro, a decisão anterior não vale para ele.
    await db.update(contratos).set({ comissaoBp: 2500 }).where(eq(contratos.imovelId, a));
    await recalcularReservas(db, org, { imovelId: a, aPartirDe: "2026-09-24" });
    expect(await bloqueios()).toContain("acerto pendente");
  });

  it("confirmada com divergência que mudou de mês: a tabela do mês dos valores mostra a reserva", async () => {
    const dados = reserva(a, "2026-10-01", "2026-10-03", { valorBruto: 50000, taxaCanal: 0 });
    const r = await sincronizarReserva(db, org, "csv", "booking:R10", dados, null);
    if (!r.ok) throw new Error("reserva");
    await db.update(lancamentos).set({ estado: "realizado" }).where(and(eq(lancamentos.reservaId, r.reserva.id), eq(lancamentos.tipo, "receita_bruta")));
    // Continua confirmada, mas a estada foi para dezembro: os valores protegidos ficam em outubro.
    await sincronizarReserva(db, org, "csv", "booking:R10", { ...dados, checkin: "2026-12-01", checkout: "2026-12-03" }, null);
    const lista = await reservasDoPortal(db, org, { proprietarioIds: [dona], imovelIds: [a], periodo: OUTUBRO });
    const portal = await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [a], semImovel: true, periodo: OUTUBRO });
    expect(lista.find((x) => x.id === r.reserva.id)?.situacao).toBe("em_conferencia");
    expect(lista.reduce((x, y) => x + y.bruto, 0)).toBe(portal.receitaBruta);
    // Em dezembro não há valores dela no livro: não aparece uma linha sem valores.
    const dezembro = await reservasDoPortal(db, org, { proprietarioIds: [dona], imovelIds: [a], periodo: { inicio: "2026-12-01", fim: "2027-01-01" } });
    expect(dezembro.some((x) => x.id === r.reserva.id)).toBe(false);
  });
  it("deploy confere confirmadas antigas que já movimentaram dinheiro: marca a divergência sem recalcular o passado", async () => {
    const pago = await criarReserva(db, org, reserva(a, "2026-08-01", "2026-08-03", { valorBruto: 50000, taxaCanal: 0 }), null);
    const livre = await criarReserva(db, org, reserva(a, "2026-08-10", "2026-08-12", { valorBruto: 50000, taxaCanal: 0 }), null);
    if (!pago.ok || !livre.ok) throw new Error("reserva");
    await db.update(lancamentos).set({ estado: "realizado" }).where(and(eq(lancamentos.reservaId, pago.reserva.id), eq(lancamentos.tipo, "receita_bruta")));
    // Versão antiga do motor: o cálculo de hoje é outro (aqui, a comissão mudou sem recálculo do passado).
    await db.update(contratos).set({ comissaoBp: 2500 }).where(eq(contratos.imovelId, a));
    const doLivro = async () => (await db.select({ id: lancamentos.id }).from(lancamentos)).length;
    const antes = await doLivro();
    const bloqueios = async () => (await preverRepasses(db, org, "2026-08", "2026-09-10", [dona]))[0].bloqueios.join(" ");
    expect(await bloqueios()).not.toContain("acerto pendente");
    expect(await conferirMovimentadas(db, org)).toEqual({ reservas: 1, divergentes: 1 });
    expect(await bloqueios()).toContain("acerto pendente");
    // Nada foi recalculado: nem a que movimentou dinheiro nem a que não movimentou.
    expect(await doLivro()).toBe(antes);
    // Rodar de novo não muda nada.
    expect(await conferirMovimentadas(db, org)).toEqual({ reservas: 1, divergentes: 1 });
    expect(await doLivro()).toBe(antes);
  });
  it("confirmada com divergência que mudou de imóvel: conta para o imóvel e o dono do livro, igual em todas as telas", async () => {
    const antes = (await tresTelas()).contagens;
    const dados = reserva(a, "2026-10-01", "2026-10-03", { valorBruto: 50000, taxaCanal: 0 });
    const r = await sincronizarReserva(db, org, "csv", "booking:R11", dados, null);
    if (!r.ok) throw new Error("reserva");
    await db.update(lancamentos).set({ estado: "realizado" }).where(and(eq(lancamentos.reservaId, r.reserva.id), eq(lancamentos.tipo, "receita_bruta")));
    // Continua confirmada, mas foi para o 102 (de outro dono): os valores protegidos ficam no 403.
    await sincronizarReserva(db, org, "csv", "booking:R11", { ...dados, imovelId: b }, null);
    const depois = (await tresTelas()).contagens;
    expect(depois).toEqual(antes.map((n) => n + 1));
    // No 102 ela não conta (não há valor dela lá).
    const so102 = (await listarImoveis(db, org)).filter((i) => i.codigo === "102");
    const inicio102 = await carregarDashboard(db, org, { imoveis: so102, todos: false, periodo: OUTUBRO, ano: 2026, hoje: "2026-11-10", verFinanceiro: true });
    expect(inicio102.reservasNoPeriodo).toBe(1);
  });
});
