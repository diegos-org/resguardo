import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { imoveis, lancamentos, manutencoes, organizacoes, proprietarioImoveis, proprietarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { criarCategoria } from "@/despesas/categorias";
import { estornarDespesa } from "@/despesas/despesas";
import {
  aprovarManutencao,
  cancelarManutencao,
  criarManutencao,
  type DadosCusto,
  lancarCusto,
  listarManutencoes,
  realizarManutencao,
  recusarManutencao,
  registrarOrcamento,
} from "./manutencao";

let db: Db;
let close: () => Promise<void>;
let org: string;
let outraOrg: string;
let a: string;
let b: string;
let dona: string;
let categoria: string;
const HOJE = "2026-10-10";

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }, { id: outraOrg }] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
  [{ id: a }, { id: b }] = await db
    .insert(imoveis)
    .values([
      { organizacaoId: org, codigo: "403", nome: "Quatro" },
      { organizacaoId: org, codigo: "102", nome: "Um" },
    ])
    .returning();
  [{ id: dona }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Dona Fictícia" }).returning();
  await db.insert(proprietarioImoveis).values({ proprietarioId: dona, imovelId: a });
  const c = await criarCategoria(db, org, "Manutenção", null);
  if (!c.ok) throw new Error("categoria");
  categoria = c.categoria.id;
});
afterEach(() => close());

async function nova(imovelId = a, titulo = "Trocar chuveiro") {
  const r = await criarManutencao(db, org, { imovelId, titulo, descricao: "Não esquenta" }, null);
  if (!r.ok || !r.id) throw new Error("criar");
  return r.id;
}
const custo = (over: Partial<DadosCusto> = {}): DadosCusto => ({ categoriaId: categoria, valor: 45000, paga: true, dataPagamento: "2026-10-09", pagoPor: "empresa", comprovante: "", ...over });
const lista = () => listarManutencoes(db, org);
/** Aprova e fixa a data da aprovação em 05/10 (o "hoje" dos testes é 10/10). */
async function aprovar(id: string, responsavel: string, autor: string | null) {
  const r = await aprovarManutencao(db, org, id, responsavel, autor);
  if (r.ok) await db.update(manutencoes).set({ aprovadaEm: new Date("2026-10-05T15:00:00Z") }).where(eq(manutencoes.id, id));
  return r;
}

describe("fluxo da manutenção", () => {
  it("pedido → orçamento → aprovação (proprietário paga) → feita → custo vira despesa do proprietário com adiantamento", async () => {
    const id = await nova();
    expect((await lista())[0]).toMatchObject({ estado: "pedida", imovelCodigo: "403", responsavel: null });
    expect(await registrarOrcamento(db, org, id, { fornecedor: "Eletricista Fictício", valor: 45000 }, null)).toMatchObject({ ok: true });
    expect((await lista())[0].avisos).toEqual(["Orçamento aguardando aprovação do Diego: não execute antes."]);
    expect(await aprovar(id, "proprietario", null)).toMatchObject({ ok: true });
    expect(await realizarManutencao(db, org, id, "2026-10-08", HOJE, null)).toMatchObject({ ok: true });
    expect((await lista())[0]).toMatchObject({ estado: "realizada", custo: null, avisos: ["Custo ainda não lançado."] });
    // Feita sem custo continua pedindo ação; com o custo lançado, sai da lista "em aberto".
    expect((await listarManutencoes(db, org, { emAberto: true })).map((x) => x.id)).toEqual([id]);

    expect(await lancarCusto(db, org, id, custo(), null)).toMatchObject({ ok: true });
    const [m] = await lista();
    expect(m).toMatchObject({ estado: "realizada", custo: 45000, avisos: [] });
    const doLivro = await db.select().from(lancamentos).where(eq(lancamentos.organizacaoId, org));
    expect(doLivro.map((l) => [l.tipo, l.montante, l.imovelId, l.proprietarioId, l.competencia, l.fornecedor]).sort()).toEqual([
      ["adiantamento", 45000, a, dona, "2026-10-08", "Eletricista Fictício"],
      ["despesa_proprietario", 45000, a, dona, "2026-10-08", "Eletricista Fictício"],
    ].sort());
    // Uma despesa ativa por manutenção.
    expect(await lancarCusto(db, org, id, custo(), null)).toMatchObject({ ok: false, erro: expect.stringContaining("já foi lançado") });
    expect((await historicoDe(db, org, "manutencao", id)).length).toBeGreaterThanOrEqual(5);
    expect(await listarManutencoes(db, org, { emAberto: true })).toEqual([]);
  });

  it("empresa paga: despesa da empresa, sem acerto com o proprietário", async () => {
    const id = await nova(b);
    await registrarOrcamento(db, org, id, { fornecedor: "Encanador", valor: 20000 }, null);
    // Imóvel sem proprietário: só a empresa pode pagar.
    expect(await aprovar(id, "proprietario", null)).toMatchObject({ ok: false, erro: expect.stringContaining("não tem proprietário") });
    expect(await aprovar(id, "empresa", null)).toMatchObject({ ok: true });
    await realizarManutencao(db, org, id, HOJE, HOJE, null);
    expect(await lancarCusto(db, org, id, custo({ valor: 20000, paga: false, dataPagamento: null }), null)).toMatchObject({ ok: true });
    const doLivro = await db.select().from(lancamentos).where(eq(lancamentos.organizacaoId, org));
    expect(doLivro.map((l) => [l.tipo, l.valor, l.efeitoSaldo, l.estado])).toEqual([["despesa_empresa", -20000, 0, "previsto"]]);
  });

  it("orçamento não autoriza: não realiza sem aprovação; orçamento novo depois de aprovada exige aprovar de novo", async () => {
    const id = await nova();
    expect(await aprovar(id, "empresa", null)).toMatchObject({ ok: false });
    expect(await realizarManutencao(db, org, id, HOJE, HOJE, null)).toMatchObject({ ok: false });
    await registrarOrcamento(db, org, id, { fornecedor: "Eletricista", valor: 45000 }, null);
    expect(await realizarManutencao(db, org, id, HOJE, HOJE, null)).toMatchObject({ ok: false });
    await aprovar(id, "empresa", null);
    await registrarOrcamento(db, org, id, { fornecedor: "Outro eletricista", valor: 60000 }, null);
    expect((await lista())[0]).toMatchObject({ estado: "orcada", orcamento: 60000, responsavel: null, aprovadaEm: null });
    expect(await realizarManutencao(db, org, id, HOJE, HOJE, null)).toMatchObject({ ok: false });
  });

  it("validações: data futura, valores, motivo para recusar/cancelar", async () => {
    const id = await nova();
    expect(await registrarOrcamento(db, org, id, { fornecedor: "", valor: 100 }, null)).toMatchObject({ ok: false });
    expect(await registrarOrcamento(db, org, id, { fornecedor: "X", valor: 0 }, null)).toMatchObject({ ok: false });
    expect(await registrarOrcamento(db, org, id, { fornecedor: "X", valor: 100_000_001 }, null)).toMatchObject({ ok: false });
    await registrarOrcamento(db, org, id, { fornecedor: "X", valor: 100 }, null);
    expect(await aprovar(id, "a_definir", null)).toMatchObject({ ok: false });
    await aprovar(id, "empresa", null);
    expect(await realizarManutencao(db, org, id, "2026-10-11", HOJE, null)).toMatchObject({ ok: false, erro: expect.stringContaining("futuro") });
    expect(await realizarManutencao(db, org, id, "2026-10-04", HOJE, null)).toMatchObject({ ok: false, erro: expect.stringContaining("antes da aprovação (05/10/2026)") });
    expect(await realizarManutencao(db, org, id, "2026-10-05", HOJE, null)).toMatchObject({ ok: true });
    expect(await cancelarManutencao(db, org, id, "x", null)).toMatchObject({ ok: false });
    const id3 = await nova(a, "Trocar lâmpada");
    await registrarOrcamento(db, org, id3, { fornecedor: "X", valor: 100 }, null);
    await aprovar(id3, "empresa", null);
    expect(await cancelarManutencao(db, org, id3, " ", null)).toMatchObject({ ok: false });
    expect(await cancelarManutencao(db, org, id3, "Proprietário resolveu", null)).toMatchObject({ ok: true });
    expect((await lista()).find((m) => m.id === id3)).toMatchObject({ estado: "cancelada", observacao: "Cancelada: Proprietário resolveu" });

    const id2 = await nova(b, "Pintura");
    expect(await recusarManutencao(db, org, id2, "", null)).toMatchObject({ ok: false });
    expect(await recusarManutencao(db, org, id2, "Não é necessário agora", null)).toMatchObject({ ok: true });
    expect(await registrarOrcamento(db, org, id2, { fornecedor: "X", valor: 100 }, null)).toMatchObject({ ok: false });
  });

  it("despesa estornada em Despesas: aviso e dá para lançar de novo; custo acima do orçamento avisa", async () => {
    const id = await nova();
    await registrarOrcamento(db, org, id, { fornecedor: "Eletricista", valor: 40000 }, null);
    await aprovar(id, "empresa", null);
    await realizarManutencao(db, org, id, HOJE, HOJE, null);
    await lancarCusto(db, org, id, custo({ valor: 45000, paga: false, dataPagamento: null }), null);
    let [m] = await lista();
    expect(m.avisos).toEqual(["Custo acima do orçamento aprovado (R$ 400,00): confira."]);
    expect(await estornarDespesa(db, org, m.despesaId!, "valor errado", null)).toBe(true);
    [m] = await lista();
    expect(m).toMatchObject({ custo: null, despesaEstornada: true, avisos: ["A despesa desta manutenção foi estornada: lance o custo de novo, se for o caso."] });
    expect(await listarManutencoes(db, org, { emAberto: true })).toHaveLength(1);
    expect(await lancarCusto(db, org, id, custo({ valor: 40000, paga: false, dataPagamento: null }), null)).toMatchObject({ ok: true });
    [m] = await lista();
    expect(m).toMatchObject({ custo: 40000, despesaEstornada: false, avisos: [] });
  });

  it("criar é atômico: imóvel de outra organização não deixa pedido nem histórico", async () => {
    expect(await criarManutencao(db, org, { imovelId: "00000000-0000-4000-8000-000000000000", titulo: "X", descricao: "" }, null)).toMatchObject({ ok: false });
    expect(await db.select().from(manutencoes)).toEqual([]);
    const id = await nova();
    expect(await historicoDe(db, org, "manutencao", id)).toHaveLength(1);
  });

  it("outra organização não vê nem mexe; imóvel de outra organização é recusado", async () => {
    const id = await nova();
    expect(await registrarOrcamento(db, outraOrg, id, { fornecedor: "X", valor: 100 }, null)).toMatchObject({ ok: false, erro: "Manutenção não encontrada." });
    expect(await listarManutencoes(db, outraOrg)).toEqual([]);
    expect(await criarManutencao(db, outraOrg, { imovelId: a, titulo: "X", descricao: "" }, null)).toMatchObject({ ok: false });
    expect(await listarManutencoes(db, org, { imovelIds: [b] })).toEqual([]);
    expect(await listarManutencoes(db, org, { imovelIds: [] })).toEqual([]);
    expect((await db.select().from(lancamentos).where(and(eq(lancamentos.organizacaoId, org)))).length).toBe(0);
  });
});
