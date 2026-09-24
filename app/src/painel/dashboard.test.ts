import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarContrato } from "@/contratos/repositorio";
import { bloqueios, imoveis, organizacoes, proprietarioImoveis, proprietarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import { registrarAjuste } from "@/ajustes/ajustes";
import { criarCategoria } from "@/despesas/categorias";
import { registrarDespesa } from "@/despesas/despesas";
import type { Db } from "@/db/types";
import { listarImoveis } from "@/imoveis/repositorio";
import type { DadosReserva } from "@/reservas/regras";
import { criarReserva, listarReservas } from "@/reservas/repositorio";
import { criarRotina } from "@/rotinas/rotinas";
import { carregarDashboard } from "./dashboard";

let db: Db;
let close: () => Promise<void>;
let org: string;
let a: string;
let b: string;

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
  const [dono] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Dona" }).returning();
  await db.insert(proprietarioImoveis).values({ proprietarioId: dono.id, imovelId: a });
  await criarContrato(db, org, a, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
});
afterEach(() => close());

const carregar = async (verFinanceiro = true, so?: string) => {
  const lista = await listarImoveis(db, org);
  const sel = so ? lista.filter((i) => i.codigo === so) : lista;
  return carregarDashboard(db, org, { imoveis: sel, todos: !so, periodo: { inicio: "2026-10-01", fim: "2026-11-01" }, ano: 2026, hoje: "2026-10-09", verFinanceiro });
};

describe("painel inicial", () => {
  it("ocupação, próximas entradas/saídas, financeiro e alertas", async () => {
    await criarReserva(db, org, reserva(a, "2026-10-01", "2026-10-09"), null); // sai hoje
    await criarReserva(db, org, reserva(a, "2026-10-12", "2026-10-15"), null); // entra em 3 dias
    await criarReserva(db, org, reserva(b, "2026-10-20", "2026-10-22", { valorBruto: null }), null); // sem valor, sem contrato
    await db.insert(bloqueios).values({ organizacaoId: org, imovelId: b, inicio: "2026-10-01", fim: "2026-10-11" });

    const d = await carregar();
    expect(d.ocupacao.map((x) => [x.codigo, x.vendidas, x.disponiveis])).toEqual([
      ["102", 2, 21],
      ["403", 11, 31],
    ]);
    expect(d.ocupacaoTotal).toEqual({ vendidas: 13, disponiveis: 52, taxa: 13 / 52 });
    expect(d.proximasEntradas.map((r) => r.checkin)).toEqual(["2026-10-12"]);
    expect(d.proximasSaidas.map((r) => r.checkout)).toEqual(["2026-10-09", "2026-10-15"]);
    // 2 reservas do 403 com valor: bruto 2 × 1.000; comissão 15% sobre 850 cada.
    expect(d.financeiro).toMatchObject({ receitaBruta: 200000, taxasCanais: 30000, comissoes: 25500, resultadoEmpresa: 25500 });
    expect(d.porMes?.[9]).toEqual({ mes: 10, receitaBruta: 200000, comissoes: 25500 });
    const textos = d.alertas.map((x) => x.texto).join(" | ");
    expect(textos).toContain("Sem contrato vigente: 102");
    expect(textos).toContain("Sem proprietário: 102");
    expect(textos).toContain("1 reserva(s) do período sem valor");
  });

  it("sem permissão financeira: só operação (ocupação e movimento), sem valores", async () => {
    await criarReserva(db, org, reserva(a, "2026-10-12", "2026-10-15"), null);
    const d = await carregar(false);
    expect(d.financeiro).toBeNull();
    expect(d.porMes).toBeNull();
    expect(d.alertas.some((x) => x.texto.includes("contrato"))).toBe(false);
    expect(d.proximasEntradas).toHaveLength(1);
  });

  it("todos os imóveis inclui despesas gerais da empresa (sem imóvel); filtro por imóvel não", async () => {
    const c = await criarCategoria(db, org, "Escritório", null);
    if (!c.ok) throw new Error("categoria");
    const base = { responsavel: "empresa" as const, pagoPor: "empresa" as const, categoriaId: c.categoria.id, proprietarioId: null, fornecedor: "", comprovante: "", paga: true, dataPagamento: "2026-10-05" };
    await registrarDespesa(db, org, { ...base, descricao: "Contador", valor: 30000, data: "2026-10-05", imovelId: null }, null);
    await registrarDespesa(db, org, { ...base, descricao: "Lâmpada", valor: 5000, data: "2026-10-05", imovelId: a }, null);
    expect((await carregar(true)).financeiro?.despesasEmpresa).toBe(35000);
    expect((await carregar(true, "403")).financeiro?.despesasEmpresa).toBe(5000);
  });

  it("todos os imóveis: gráfico do mês bate com os cartões mesmo com imóvel inativo", async () => {
    await criarReserva(db, org, reserva(a, "2026-10-12", "2026-10-15"), null);
    await db.update(imoveis).set({ ativo: false }).where(eq(imoveis.id, a));
    const d = await carregar();
    expect(d.financeiro).toMatchObject({ receitaBruta: 100000, comissoes: 12750 });
    expect(d.porMes?.[9]).toEqual({ mes: 10, receitaBruta: 100000, comissoes: 12750 });
  });

  it("todos os imóveis: adiantamento de imóvel arquivado continua no alerta; sem imóvel ativo o financeiro aparece", async () => {
    const c = await criarCategoria(db, org, "Manutenção", null);
    if (!c.ok) throw new Error("categoria");
    const base = { categoriaId: c.categoria.id, proprietarioId: null, fornecedor: "", comprovante: "", paga: true, dataPagamento: "2026-10-05", data: "2026-10-05" };
    await registrarDespesa(db, org, { ...base, responsavel: "proprietario", pagoPor: "empresa", descricao: "Reparo", valor: 40000, imovelId: a }, null);
    await registrarDespesa(db, org, { ...base, responsavel: "empresa", pagoPor: "empresa", descricao: "Contador", valor: 30000, imovelId: null }, null);
    await db.update(imoveis).set({ ativo: false }); // todos arquivados
    const d = await carregar();
    expect(d.alertas.map((x) => x.texto).join(" | ")).toContain("Adiantamentos a cobrar dos proprietários");
    expect(d.financeiro?.despesasEmpresa).toBe(30000);
  });

  it("ajuste pendente aparece uma vez só nos alertas (não como acerto pendente)", async () => {
    const r = await registrarAjuste(
      db,
      org,
      { data: "2026-10-15", imovelId: a, reservaId: null, proprietarioId: null, motivo: "", origem: "desconhecida", origemComprovada: false, evidencia: "Extrato", comprovante: "", valor: 5000, direcao: "empresa_saida" },
      null,
    );
    expect(r.ok).toBe(true);
    const textos = (await carregar()).alertas.map((x) => x.texto);
    expect(textos).toContain("1 ajuste(s) pendente(s) de esclarecimento.");
    expect(textos.some((t) => t.includes("acerto pendente"))).toBe(false);
  });

  it("ajuste pendente de imóvel arquivado continua no alerta de 'todos'", async () => {
    await registrarAjuste(
      db,
      org,
      { data: "2026-10-15", imovelId: b, reservaId: null, proprietarioId: null, motivo: "", origem: "desconhecida", origemComprovada: false, evidencia: "Extrato", comprovante: "", valor: 5000, direcao: "empresa_saida" },
      null,
    );
    await db.update(imoveis).set({ ativo: false }).where(eq(imoveis.id, b));
    expect((await carregar()).alertas.map((x) => x.texto)).toContain("1 ajuste(s) pendente(s) de esclarecimento.");
  });

  it("reserva sem contrato na data da entrada avisa mesmo com contrato vigente hoje", async () => {
    await criarReserva(db, org, reserva(b, "2026-10-12", "2026-10-15"), null); // 102 sem contrato: nada calculado
    await criarContrato(db, org, b, { tipo: "gestao_completa", comissao: "15", inicio: "2026-10-20" }, null);
    const d = await carregarDashboard(db, org, {
      imoveis: await listarImoveis(db, org),
      todos: true,
      periodo: { inicio: "2026-10-01", fim: "2026-11-01" },
      ano: 2026,
      hoje: "2026-10-30",
      verFinanceiro: true,
    });
    const textos = d.alertas.map((x) => x.texto).join(" | ");
    expect(textos).not.toContain("Sem contrato vigente");
    expect(d.alertas.find((x) => x.texto.includes("sem cálculo no financeiro"))).toMatchObject({ texto: expect.stringContaining("1 reserva(s)"), link: "/painel/reservas" });
    // Um ajuste ligado à reserva não conta como cálculo: o aviso continua.
    const r = (await listarReservas(db, org, { inicio: "2026-10-01", fim: "2026-11-01", imovelIds: [b] }))[0];
    await registrarAjuste(
      db,
      org,
      { data: "2026-10-15", imovelId: null, reservaId: r.id, proprietarioId: null, motivo: "Diferença", origem: "desconhecida", origemComprovada: false, evidencia: "Extrato", comprovante: "", valor: 5000, direcao: "empresa_entrada" },
      null,
    );
    const d2 = await carregarDashboard(db, org, { imoveis: await listarImoveis(db, org), todos: true, periodo: { inicio: "2026-10-01", fim: "2026-11-01" }, ano: 2026, hoje: "2026-10-30", verFinanceiro: true });
    expect(d2.alertas.some((x) => x.texto.includes("1 reserva(s) do período com valor mas sem cálculo"))).toBe(true);
  });

  it("em 'todos', imóvel arquivado com reserva entra na ocupação; sem reserva, some", async () => {
    await criarReserva(db, org, reserva(a, "2026-10-12", "2026-10-15"), null);
    await db.update(imoveis).set({ ativo: false }).where(eq(imoveis.id, a));
    const todos = await listarImoveis(db, org, { incluirInativos: true });
    const periodo = { inicio: "2026-10-01", fim: "2026-11-01" };
    const d = await carregarDashboard(db, org, { imoveis: todos, todos: true, periodo, ano: 2026, hoje: "2026-10-09", verFinanceiro: true });
    expect(d.ocupacao.map((x) => x.codigo)).toEqual(["102", "403"]);
    expect(d.reservasNoPeriodo).toBe(1);
    expect(d.financeiro?.receitaBruta).toBe(100000);
    await db.update(imoveis).set({ ativo: false }).where(eq(imoveis.id, b));
    const d2 = await carregarDashboard(db, org, { imoveis: todos.map((i) => ({ ...i, ativo: false })), todos: true, periodo, ano: 2026, hoje: "2026-10-09", verFinanceiro: true });
    expect(d2.ocupacao.map((x) => x.codigo)).toEqual(["403"]);
  });

  it("em 'todos', reserva sem cálculo de imóvel arquivado também avisa", async () => {
    await criarReserva(db, org, reserva(b, "2026-10-12", "2026-10-15"), null); // 102 sem contrato
    await db.update(imoveis).set({ ativo: false }).where(eq(imoveis.id, b));
    // A página passa também os arquivados em "todos"; o alerta diz qual é e como chegar lá.
    const todos = await listarImoveis(db, org, { incluirInativos: true });
    const d = await carregarDashboard(db, org, { imoveis: todos, todos: true, periodo: { inicio: "2026-10-01", fim: "2026-11-01" }, ano: 2026, hoje: "2026-10-09", verFinanceiro: true });
    const alerta = d.alertas.find((x) => x.texto.includes("1 reserva(s) do período com valor mas sem cálculo"));
    expect(alerta?.texto).toContain("Inclui imóvel arquivado (102): reative-o em Imóveis");
  });

  it("em 'todos', reserva sem valor de imóvel arquivado também avisa", async () => {
    await criarReserva(db, org, { ...reserva(b, "2026-10-12", "2026-10-15"), valorBruto: null }, null);
    await db.update(imoveis).set({ ativo: false }).where(eq(imoveis.id, b));
    const todos = await listarImoveis(db, org, { incluirInativos: true });
    const d = await carregarDashboard(db, org, { imoveis: todos.filter((i) => i.ativo), todos: true, periodo: { inicio: "2026-10-01", fim: "2026-11-01" }, ano: 2026, hoje: "2026-10-09", verFinanceiro: true });
    expect(d.alertas.map((x) => x.texto).join(" | ")).toContain("1 reserva(s) do período sem valor");
  });

  it("despesa a pagar entra no alerta do período dela (o mesmo recorte da tela Despesas)", async () => {
    const c = await criarCategoria(db, org, "Escritório", null);
    if (!c.ok) throw new Error("categoria");
    await registrarDespesa(
      db,
      org,
      { responsavel: "empresa", pagoPor: "empresa", categoriaId: c.categoria.id, descricao: "Contador", valor: 30000, data: "2026-09-10", imovelId: null, proprietarioId: null, fornecedor: "", comprovante: "", paga: false, dataPagamento: "" },
      null,
    );
    expect((await carregar()).alertas.some((x) => x.texto.includes("ainda a pagar"))).toBe(false);
    const setembro = await carregarDashboard(db, org, { imoveis: await listarImoveis(db, org), todos: true, periodo: { inicio: "2026-09-01", fim: "2026-10-01" }, ano: 2026, hoje: "2026-10-09", verFinanceiro: true });
    expect(setembro.alertas.find((x) => x.texto.includes("ainda a pagar"))?.texto).toContain("300,00");
  });

  it("acerto pendente (imóvel sem proprietário) diz onde está e leva às regras", async () => {
    await criarContrato(db, org, b, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
    await criarReserva(db, org, reserva(b, "2026-10-12", "2026-10-15"), null);
    const alerta = (await carregar()).alertas.find((x) => x.texto.includes("acerto pendente"));
    expect(alerta).toMatchObject({ texto: expect.stringContaining("(102)"), link: "/painel/sistema" });
  });

  it("filtro de imóvel: números só do imóvel escolhido; sobreposição vira alerta", async () => {
    await criarReserva(db, org, reserva(a, "2026-10-12", "2026-10-15"), null);
    await criarReserva(db, org, reserva(a, "2026-10-14", "2026-10-16"), null);
    await criarReserva(db, org, reserva(b, "2026-10-12", "2026-10-15"), null);
    const d = await carregar(true, "403");
    expect(d.ocupacao.map((x) => x.codigo)).toEqual(["403"]);
    expect(d.reservasNoPeriodo).toBe(2);
    expect(d.alertas[0]).toMatchObject({ nivel: "atencao", texto: expect.stringContaining("sobreposta") });
    expect(d.alertas.some((x) => x.texto.includes("102"))).toBe(false);
  });

  it("rotinas atrasadas ou para hoje viram alerta com link, só para quem vê rotinas", async () => {
    await criarRotina(db, org, { titulo: "Conferir faxinas", descricao: "", frequencia: "semanal", proximaData: "2026-10-08" }, null);
    await criarRotina(db, org, { titulo: "Caixinhas", descricao: "", frequencia: "anual", proximaData: "2026-12-01" }, null);
    const lista = await listarImoveis(db, org);
    const base = { imoveis: lista, todos: true, periodo: { inicio: "2026-10-01", fim: "2026-11-01" }, ano: 2026, hoje: "2026-10-09", verFinanceiro: true };
    expect((await carregarDashboard(db, org, { ...base, verRotinas: true })).alertas).toContainEqual({ nivel: "atencao", texto: "1 rotina(s) atrasada(s) ou para hoje.", link: "/painel/rotinas" });
    expect((await carregarDashboard(db, org, base)).alertas.some((x) => x.link === "/painel/rotinas")).toBe(false);
  });
});
