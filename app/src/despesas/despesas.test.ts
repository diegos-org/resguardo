import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { imoveis, organizacoes, proprietarioImoveis, proprietarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { listarLancamentos, saldoAcerto, totaisPorTipo } from "@/financeiro/ledger";
import { atualizarCategoria, criarCategoria, excluirCategoria, garantirCategoriasIniciais, listarCategorias } from "./categorias";
import { type DadosDespesa, estornarDespesa, listarDespesas, marcarDespesaPaga, obterDespesa, registrarDespesa, totaisDespesas } from "./despesas";

let db: Db;
let close: () => Promise<void>;
let org: string;
let outraOrg: string;
let im: string;
let dono: string;
let cat: string;

const despesa = (over: Partial<DadosDespesa> = {}): DadosDespesa => ({
  responsavel: "empresa",
  pagoPor: "empresa",
  categoriaId: cat,
  descricao: "Compra de mercado",
  valor: 25000,
  data: "2026-10-05",
  imovelId: null,
  proprietarioId: null,
  fornecedor: "Mercado X",
  comprovante: "",
  paga: false,
  dataPagamento: null,
  ...over,
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }, { id: outraOrg }] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "102", nome: "Studio" }).returning();
  [{ id: dono }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Dona" }).returning();
  await db.insert(proprietarioImoveis).values({ proprietarioId: dono, imovelId: im });
  const c = await criarCategoria(db, org, "Manutenção", null);
  cat = c.ok ? c.categoria.id : "";
});
afterEach(() => close());

describe("categorias", () => {
  it("cria, impede nome repetido (sem diferenciar maiúsculas), renomeia e arquiva", async () => {
    expect(await criarCategoria(db, org, "manutenção", null)).toMatchObject({ ok: false });
    expect(await criarCategoria(db, org, "  ", null)).toMatchObject({ ok: false });
    expect(await criarCategoria(db, outraOrg, "Manutenção", null)).toMatchObject({ ok: true }); // outra organização pode
    expect(await atualizarCategoria(db, org, cat, { nome: "Reparos" }, null)).toMatchObject({ ok: true, categoria: { nome: "Reparos" } });
    await atualizarCategoria(db, org, cat, { ativa: false }, null);
    expect(await listarCategorias(db, org)).toHaveLength(0);
    expect(await listarCategorias(db, org, true)).toHaveLength(1);
    expect((await historicoDe(db, org, "categoria_despesa", cat)).length).toBe(3);
  });

  it("categoria de outra organização não é alterável", async () => {
    expect(await atualizarCategoria(db, outraOrg, cat, { nome: "X" }, null)).toMatchObject({ ok: false });
    expect(await excluirCategoria(db, outraOrg, cat, null)).toMatchObject({ ok: false });
  });

  it("exclui só categoria nunca usada", async () => {
    await registrarDespesa(db, org, despesa(), null);
    expect(await excluirCategoria(db, org, cat, null)).toMatchObject({ ok: false });
    const nova = await criarCategoria(db, org, "Sem uso", null);
    expect(await excluirCategoria(db, org, nova.ok ? nova.categoria.id : "", null)).toEqual({ ok: true });
  });

  it("categorias iniciais só quando não há nenhuma", async () => {
    await garantirCategoriasIniciais(db, outraOrg);
    await garantirCategoriasIniciais(db, outraOrg);
    expect((await listarCategorias(db, outraOrg)).length).toBe(6);
    await garantirCategoriasIniciais(db, org);
    expect((await listarCategorias(db, org)).length).toBe(1);
  });

  it("apagar todas as categorias não faz as iniciais voltarem", async () => {
    await garantirCategoriasIniciais(db, outraOrg);
    for (const c of await listarCategorias(db, outraOrg)) expect(await excluirCategoria(db, outraOrg, c.id, null)).toEqual({ ok: true });
    await garantirCategoriasIniciais(db, outraOrg);
    expect(await listarCategorias(db, outraOrg, true)).toHaveLength(0);
  });
});

describe("despesas", () => {
  it("despesa da empresa reduz o resultado e não mexe no acerto", async () => {
    const r = await registrarDespesa(db, org, despesa(), null);
    expect(r).toMatchObject({ ok: true, lancamento: { tipo: "despesa_empresa", valor: -25000, montante: 25000, efeitoSaldo: 0, estado: "previsto" } });
    expect((await totaisPorTipo(db, org, {})).despesa_empresa).toBe(-25000);
    expect(await saldoAcerto(db, org, {})).toBe(0);
  });

  it("despesa do proprietário que a empresa ainda vai pagar: não é custo da empresa nem dívida ainda", async () => {
    const r = await registrarDespesa(db, org, despesa({ responsavel: "proprietario", imovelId: im, descricao: "Ar-condicionado", valor: 80000 }), null);
    expect(r).toMatchObject({ ok: true, lancamento: { tipo: "despesa_proprietario", valor: 0, montante: 80000, efeitoSaldo: 0, pagoPor: "empresa", proprietarioId: dono } });
    expect((await totaisPorTipo(db, org, {})).despesa_proprietario).toBe(0);
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(0);
    expect(totaisDespesas(await listarDespesas(db, org))).toMatchObject({ proprietarios: 80000, aCobrar: 0, aPagar: 80000 });
    // Quando a empresa paga, nasce o adiantamento e a dívida do proprietário (uma vez só).
    const id = r.ok ? r.lancamento.id : "";
    expect(await marcarDespesaPaga(db, org, id, "2026-10-10", null)).toBe(true);
    expect(await marcarDespesaPaga(db, org, id, "2026-10-10", null)).toBe(true);
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(-80000);
    const adiant = (await listarLancamentos(db, org, { proprietarioId: dono })).filter((l) => l.tipo === "adiantamento");
    expect(adiant).toHaveLength(1);
    expect(adiant[0]).toMatchObject({ valor: 0, efeitoSaldo: -80000, estado: "realizado", dataCaixa: "2026-10-10" });
    expect((await totaisPorTipo(db, org, {})).adiantamento).toBe(0); // não vira despesa dupla da empresa
    expect(totaisDespesas(await listarDespesas(db, org))).toMatchObject({ aCobrar: 80000, aPagar: 0 });
  });

  it("paga na hora pela empresa: dívida do proprietário imediata", async () => {
    await registrarDespesa(db, org, despesa({ responsavel: "proprietario", imovelId: im, valor: 80000, paga: true, dataPagamento: "2026-10-06" }), null);
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(-80000);
  });

  it("despesa do proprietário paga por ele mesmo: só registro, sem dívida", async () => {
    const r = await registrarDespesa(db, org, despesa({ responsavel: "proprietario", pagoPor: "proprietario", imovelId: im }), null);
    expect(r).toMatchObject({ ok: true, lancamento: { efeitoSaldo: 0, montante: 25000, pagoPor: "proprietario" } });
    await marcarDespesaPaga(db, org, r.ok ? r.lancamento.id : "", "2026-10-07", null);
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(0);
  });

  it("proprietário informado precisa ser o do imóvel", async () => {
    const [{ id: estranho }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Estranho" }).returning();
    expect(await registrarDespesa(db, org, despesa({ responsavel: "proprietario", imovelId: im, proprietarioId: estranho }), null)).toMatchObject({ ok: false });
    expect(await registrarDespesa(db, org, despesa({ responsavel: "proprietario", imovelId: im, proprietarioId: dono }), null)).toMatchObject({ ok: true, lancamento: { proprietarioId: dono } });
  });

  it("validações: valor, data, categoria arquivada ou de outra organização, imóvel de outra organização", async () => {
    expect(await registrarDespesa(db, org, despesa({ valor: 0 }), null)).toMatchObject({ ok: false, erros: { valor: expect.any(String) } });
    expect(await registrarDespesa(db, org, despesa({ data: "2026-02-30" }), null)).toMatchObject({ ok: false, erros: { data: expect.any(String) } });
    expect(await registrarDespesa(db, org, despesa({ paga: true }), null)).toMatchObject({ ok: false, erros: { dataPagamento: expect.any(String) } });
    expect(await registrarDespesa(db, org, despesa({ responsavel: "proprietario" }), null)).toMatchObject({ ok: false, erros: { imovelId: expect.any(String) } });
    const alheia = await criarCategoria(db, outraOrg, "Alheia", null);
    expect(await registrarDespesa(db, org, despesa({ categoriaId: alheia.ok ? alheia.categoria.id : "" }), null)).toMatchObject({ ok: false, erros: { categoriaId: expect.any(String) } });
    const [{ id: imAlheio }] = await db.insert(imoveis).values({ organizacaoId: outraOrg, codigo: "z", nome: "Z" }).returning();
    expect(await registrarDespesa(db, org, despesa({ imovelId: imAlheio }), null)).toMatchObject({ ok: false, erros: { imovelId: expect.any(String) } });
    await atualizarCategoria(db, org, cat, { ativa: false }, null);
    expect(await registrarDespesa(db, org, despesa(), null)).toMatchObject({ ok: false, erros: { categoriaId: expect.any(String) } });
  });

  it("paga na hora, marcar como paga depois e estornar (estorno leva junto o adiantamento)", async () => {
    const paga = await registrarDespesa(db, org, despesa({ paga: true, dataPagamento: "2026-10-06" }), null);
    expect(paga).toMatchObject({ ok: true, lancamento: { estado: "realizado", dataCaixa: "2026-10-06" } });
    const r = await registrarDespesa(db, org, despesa({ responsavel: "proprietario", imovelId: im, valor: 80000 }), null);
    const id = r.ok ? r.lancamento.id : "";
    expect(await marcarDespesaPaga(db, org, id, "2026-02-30", null)).toBe(false);
    await marcarDespesaPaga(db, org, id, "2026-10-10", null);
    expect(await obterDespesa(db, org, id)).toMatchObject({ estado: "realizado", dataCaixa: "2026-10-10", categoria: "Manutenção" });
    expect(await estornarDespesa(db, org, id, "  ", null)).toBe(false);
    expect(await estornarDespesa(db, org, id, "lançada em duplicidade", null)).toBe(true);
    expect(await estornarDespesa(db, org, id, "de novo", null)).toBe(false);
    expect(await marcarDespesaPaga(db, org, id, "2026-10-11", null)).toBe(false);
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(0);
    expect(await obterDespesa(db, org, id)).toMatchObject({ estornada: true });
    const lista = await listarDespesas(db, org, {});
    expect(lista).toHaveLength(1); // estornada some da lista padrão, espelho nunca aparece
    expect(await listarDespesas(db, org, { incluirEstornadas: true })).toHaveLength(2);
    expect(totaisDespesas(await listarDespesas(db, org, { incluirEstornadas: true }))).toEqual({ empresa: 25000, proprietarios: 0, aCobrar: 0, aPagar: 0 });
  });

  it("outra organização não marca nem estorna", async () => {
    const r = await registrarDespesa(db, org, despesa(), null);
    const id = r.ok ? r.lancamento.id : "";
    expect(await marcarDespesaPaga(db, outraOrg, id, "2026-10-10", null)).toBe(false);
    expect(await estornarDespesa(db, outraOrg, id, "x", null)).toBe(false);
  });

  it("filtra por período e imóvel; outra organização não vê", async () => {
    await registrarDespesa(db, org, despesa({ data: "2026-09-30" }), null);
    await registrarDespesa(db, org, despesa({ imovelId: im }), null);
    expect(await listarDespesas(db, org, { inicio: "2026-10-01", fim: "2026-11-01" })).toHaveLength(1);
    expect(await listarDespesas(db, org, { imovelIds: [im] })).toHaveLength(1);
    expect(await listarDespesas(db, outraOrg, {})).toHaveLength(0);
    expect(await obterDespesa(db, outraOrg, (await listarDespesas(db, org))[0].id)).toBeNull();
  });
});
