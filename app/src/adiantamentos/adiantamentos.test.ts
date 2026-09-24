import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { destinoPainel } from "@/acesso/painel";
import { autorizar } from "@/acesso/politica";
import { historicoDe } from "@/auditoria/auditoria";
import { isNull } from "drizzle-orm";
import { contestacoesAdiantamento, imoveis, organizacoes, proprietarioImoveis, proprietarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { criarCategoria } from "@/despesas/categorias";
import { estornarDespesa, marcarDespesaPaga, registrarDespesa } from "@/despesas/despesas";
import { saldoAcerto, totaisPorTipo } from "@/financeiro/ledger";
import { contestar, desfazerQuitacao, listarAdiantamentos, obterAdiantamento, quitar, resolverContestacao, resumoPorProprietario, situacaoDe, totalACobrar } from "./adiantamentos";

let db: Db;
let close: () => Promise<void>;
let org: string;
let outraOrg: string;
let im: string;
let dono: string;
let despesaId: string;
let adiantamentoId: string;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }, { id: outraOrg }] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Quatro" }).returning();
  [{ id: dono }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Dona Exemplo" }).returning();
  await db.insert(proprietarioImoveis).values({ proprietarioId: dono, imovelId: im });
  const c = await criarCategoria(db, org, "Manutenção", null);
  if (!c.ok) throw new Error("categoria");
  // Reparo de R$ 4.000 do proprietário, pago pela empresa → adiantamento.
  const d = await registrarDespesa(
    db,
    org,
    {
      responsavel: "proprietario",
      pagoPor: "empresa",
      categoriaId: c.categoria.id,
      descricao: "Reparo do ar-condicionado",
      valor: 400000,
      data: "2026-10-05",
      imovelId: im,
      proprietarioId: null,
      fornecedor: "Refrigeração Exemplo",
      comprovante: "",
      paga: true,
      dataPagamento: "2026-10-06",
    },
    null,
  );
  if (!d.ok) throw new Error("despesa");
  despesaId = d.lancamento.id;
  [{ id: adiantamentoId }] = await listarAdiantamentos(db, org);
});
afterEach(() => close());

const saldo = () => saldoAcerto(db, org, { proprietarioId: dono });

describe("situação", () => {
  it("regra pura", () => {
    expect(situacaoDe(100, 0, false)).toBe("a_cobrar");
    expect(situacaoDe(100, 40, false)).toBe("parcial");
    expect(situacaoDe(100, 100, true)).toBe("quitado");
    expect(situacaoDe(100, 40, true)).toBe("contestado");
  });

  it("adiantamento nasce a cobrar, ligado à despesa, e o proprietário deve o valor", async () => {
    const a = await obterAdiantamento(db, org, adiantamentoId);
    expect(a).toMatchObject({ valor: 400000, aberto: 400000, situacao: "a_cobrar", despesaId, proprietario: "Dona Exemplo", imovel: "403", dataPagamento: "2026-10-06" });
    expect(await saldo()).toBe(-400000);
  });
});

describe("quitação sem dupla cobrança", () => {
  it("reembolso parcial + total zera a dívida; mais que o aberto é recusado", async () => {
    expect(await quitar(db, org, adiantamentoId, { forma: "reembolso", valor: 150000, data: "2026-10-20" }, null)).toEqual({ ok: true });
    expect(await saldo()).toBe(-250000);
    expect((await obterAdiantamento(db, org, adiantamentoId))?.situacao).toBe("parcial");
    expect(totalACobrar(await listarAdiantamentos(db, org))).toBe(250000);
    expect(await quitar(db, org, adiantamentoId, { forma: "reembolso", valor: 250001, data: "2026-10-21" }, null)).toMatchObject({ ok: false, erro: expect.stringContaining("em aberto") });
    expect(await quitar(db, org, adiantamentoId, { forma: "compensacao", valor: 250000, data: "2026-11-01" }, null)).toEqual({ ok: true });
    const a = await obterAdiantamento(db, org, adiantamentoId);
    expect(a).toMatchObject({ situacao: "quitado", aberto: 0, quitado: 400000 });
    // Compensação não gera lançamento próprio (o repasse do M4.9 paga o líquido).
    expect(await saldo()).toBe(-250000);
    expect(await quitar(db, org, adiantamentoId, { forma: "reembolso", valor: 1, data: "2026-11-02" }, null)).toMatchObject({ ok: false });
    // Compensação (repasse) não se desfaz por aqui: só estornando o repasse.
    const comp = (await obterAdiantamento(db, org, adiantamentoId))!.quitacoes.find((x) => x.forma === "compensacao")!;
    expect(await desfazerQuitacao(db, org, comp.id, "teste", null)).toMatchObject({ ok: false, erro: expect.stringContaining("repasse") });
  });

  it("duas quitações simultâneas não passam do valor", async () => {
    const r = await Promise.all([
      quitar(db, org, adiantamentoId, { forma: "reembolso", valor: 300000, data: "2026-10-20" }, null),
      quitar(db, org, adiantamentoId, { forma: "reembolso", valor: 300000, data: "2026-10-20" }, null),
    ]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    expect((await obterAdiantamento(db, org, adiantamentoId))?.quitado).toBe(300000);
  });

  it("desfazer quitação estorna o reembolso e reabre o valor", async () => {
    await quitar(db, org, adiantamentoId, { forma: "reembolso", valor: 400000, data: "2026-10-20" }, null);
    expect(await saldo()).toBe(0);
    const [q] = (await obterAdiantamento(db, org, adiantamentoId))!.quitacoes;
    expect(await desfazerQuitacao(db, org, q.id, "", null)).toMatchObject({ ok: false });
    expect(await desfazerQuitacao(db, org, q.id, "Pix devolvido pelo banco", null)).toEqual({ ok: true });
    expect(await desfazerQuitacao(db, org, q.id, "de novo", null)).toMatchObject({ ok: false });
    expect(await saldo()).toBe(-400000);
    expect((await obterAdiantamento(db, org, adiantamentoId))?.situacao).toBe("a_cobrar");
  });

  it("despesa com adiantamento já quitado não pode ser estornada (evita crédito indevido)", async () => {
    await quitar(db, org, adiantamentoId, { forma: "reembolso", valor: 100000, data: "2026-10-20" }, null);
    expect(await estornarDespesa(db, org, despesaId, "Lançada errado", null)).toBe("quitado");
    expect(await saldo()).toBe(-300000);
    const [q] = (await obterAdiantamento(db, org, adiantamentoId))!.quitacoes;
    await desfazerQuitacao(db, org, q.id, "Desfazendo para estornar", null);
    expect(await estornarDespesa(db, org, despesaId, "Lançada errado", null)).toBe(true);
    expect(await saldo()).toBe(0);
    expect(await listarAdiantamentos(db, org)).toEqual([]);
  });

  it("filtro por imóveis (proprietário vê só os dele) e painel fechado para proprietário", async () => {
    const [outro] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "102", nome: "Outro" }).returning();
    expect(await listarAdiantamentos(db, org, { imovelIds: [outro.id] })).toEqual([]);
    expect(await listarAdiantamentos(db, org, { imovelIds: [] })).toEqual([]);
    expect(await listarAdiantamentos(db, org, { imovelIds: [im] })).toHaveLength(1);
    const sessaoDono = { usuarioId: "u", organizacaoId: org, papel: "proprietario" as const, imovelIds: [outro.id] };
    expect(destinoPainel(sessaoDono)).toEqual({ ok: false, redirecionar: "/portal" });
    expect(autorizar(sessaoDono, "financeiro:ler", { organizacaoId: org, imovelId: im }).permitido).toBe(false);
  });

  it("outra organização não quita nem vê", async () => {
    expect(await quitar(db, outraOrg, adiantamentoId, { forma: "reembolso", valor: 1, data: "2026-10-20" }, null)).toMatchObject({ ok: false });
    expect(await listarAdiantamentos(db, outraOrg)).toEqual([]);
    expect(await quitar(db, org, "nao-uuid", { forma: "reembolso", valor: 1, data: "2026-10-20" }, null)).toMatchObject({ ok: false });
  });
});

describe("estorno com contestação aberta", () => {
  it("descontado num repasse: o estorno aponta o caminho do repasse", async () => {
    await quitar(db, org, adiantamentoId, { forma: "compensacao", valor: 1000, data: "2026-11-01" }, null);
    expect(await estornarDespesa(db, org, despesaId, "Lançada errado", null)).toBe("compensacao");
  });

  it("estornar a despesa encerra a contestação aberta do adiantamento", async () => {
    await contestar(db, org, adiantamentoId, "Não reconheço", null);
    expect(await estornarDespesa(db, org, despesaId, "Lançada errado", null)).toBe(true);
    const abertas = await db.select().from(contestacoesAdiantamento).where(isNull(contestacoesAdiantamento.resolvidaEm));
    expect(abertas).toEqual([]);
    expect(await saldo()).toBe(0);
  });
});

describe("corrida entre pagar e estornar", () => {
  it("marcar paga e estornar ao mesmo tempo nunca deixa adiantamento ativo de despesa estornada", async () => {
    const c = await criarCategoria(db, org, "Reparos", null);
    if (!c.ok) throw new Error("categoria");
    const d = await registrarDespesa(
      db,
      org,
      { responsavel: "proprietario", pagoPor: "empresa", categoriaId: c.categoria.id, descricao: "Conserto", valor: 50000, data: "2026-10-05", imovelId: im, proprietarioId: null, fornecedor: "", comprovante: "", paga: false, dataPagamento: null },
      null,
    );
    if (!d.ok) throw new Error("despesa");
    await Promise.allSettled([marcarDespesaPaga(db, org, d.lancamento.id, "2026-10-07", null), estornarDespesa(db, org, d.lancamento.id, "Lançada errado", null)]);
    const ativos = (await listarAdiantamentos(db, org)).filter((a) => a.despesaId === d.lancamento.id);
    expect(ativos).toEqual([]); // o estorno sempre leva o adiantamento junto
    expect(await saldo()).toBe(-400000); // só o adiantamento do beforeEach
  });
});

describe("contestação", () => {
  it("contestado não é cobrado; mantida volta a cobrar", async () => {
    expect(await contestar(db, org, adiantamentoId, "O ar já estava com defeito na entrega", null)).toEqual({ ok: true });
    expect(await contestar(db, org, adiantamentoId, "de novo", null)).toMatchObject({ ok: false });
    expect(await quitar(db, org, adiantamentoId, { forma: "compensacao", valor: 1000, data: "2026-11-01" }, null)).toMatchObject({ ok: false, erro: expect.stringContaining("contest") });
    expect(await quitar(db, org, adiantamentoId, { forma: "empresa_assume", valor: 1000, data: "2026-11-01" }, null)).toMatchObject({ ok: false, erro: expect.stringContaining("contest") });
    expect(resumoPorProprietario(await listarAdiantamentos(db, org))).toEqual([{ proprietarioId: dono, proprietario: "Dona Exemplo", aCobrar: 0, contestado: 400000, quantidade: 1 }]);
    expect(await resolverContestacao(db, org, adiantamentoId, { resolucao: "mantida", nota: "Nota fiscal mostra defeito novo", data: "2026-10-25" }, null)).toEqual({ ok: true });
    expect((await obterAdiantamento(db, org, adiantamentoId))?.situacao).toBe("a_cobrar");
  });

  it("empresa assume: dívida zerada e o valor vira custo da empresa", async () => {
    await quitar(db, org, adiantamentoId, { forma: "reembolso", valor: 100000, data: "2026-10-20" }, null);
    await contestar(db, org, adiantamentoId, "Discorda do restante", null);
    expect(await resolverContestacao(db, org, adiantamentoId, { resolucao: "empresa_assume", nota: "Acordo", data: "2026-10-25" }, null)).toEqual({ ok: true });
    expect(await obterAdiantamento(db, org, adiantamentoId)).toMatchObject({ situacao: "quitado", aberto: 0 });
    expect(await saldo()).toBe(0);
    expect((await totaisPorTipo(db, org, {})).ajuste).toBe(-300000);
    expect((await historicoDe(db, org, "adiantamento", adiantamentoId)).length).toBe(4);
    // Desfazer o "empresa assume" reabre a contestação: nada fica cobrado enquanto isso.
    const q = (await obterAdiantamento(db, org, adiantamentoId))!.quitacoes.find((x) => x.forma === "empresa_assume")!;
    expect(await desfazerQuitacao(db, org, q.id, "Acordo desfeito", null)).toEqual({ ok: true });
    expect(await obterAdiantamento(db, org, adiantamentoId)).toMatchObject({ situacao: "contestado", aberto: 300000, contestacao: { resolvidaEm: null } });
    expect(totalACobrar(await listarAdiantamentos(db, org))).toBe(0);
  });

  it("dois 'empresa assume' de contestações diferentes: desfazer o primeiro reabre a contestação dele", async () => {
    await quitar(db, org, adiantamentoId, { forma: "reembolso", valor: 100000, data: "2026-10-20" }, null);
    await contestar(db, org, adiantamentoId, "Primeira", null);
    await resolverContestacao(db, org, adiantamentoId, { resolucao: "empresa_assume", nota: "", data: "2026-10-25" }, null);
    const reembolso = (await obterAdiantamento(db, org, adiantamentoId))!.quitacoes.find((x) => x.forma === "reembolso")!;
    await desfazerQuitacao(db, org, reembolso.id, "Pix estornado", null);
    await contestar(db, org, adiantamentoId, "Segunda", null);
    await resolverContestacao(db, org, adiantamentoId, { resolucao: "empresa_assume", nota: "", data: "2026-10-26" }, null);
    const primeiro = (await obterAdiantamento(db, org, adiantamentoId))!.quitacoes.find((x) => x.forma === "empresa_assume" && x.valor === 300000)!;
    await desfazerQuitacao(db, org, primeiro.id, "Revisto", null);
    const a = (await obterAdiantamento(db, org, adiantamentoId))!;
    expect(a).toMatchObject({ situacao: "contestado", aberto: 300000 });
    expect(a.contestacao?.motivo).toBe("Primeira");
  });

  it("desfazer 'empresa assume' com outra contestação aberta é recusado", async () => {
    await quitar(db, org, adiantamentoId, { forma: "reembolso", valor: 100000, data: "2026-10-20" }, null);
    await contestar(db, org, adiantamentoId, "A", null);
    await resolverContestacao(db, org, adiantamentoId, { resolucao: "empresa_assume", nota: "", data: "2026-10-25" }, null);
    const reembolso = (await obterAdiantamento(db, org, adiantamentoId))!.quitacoes.find((x) => x.forma === "reembolso")!;
    await desfazerQuitacao(db, org, reembolso.id, "Pix estornado", null);
    await contestar(db, org, adiantamentoId, "B", null);
    const assumida = (await obterAdiantamento(db, org, adiantamentoId))!.quitacoes.find((x) => x.forma === "empresa_assume")!;
    expect(await desfazerQuitacao(db, org, assumida.id, "Revisto", null)).toMatchObject({ ok: false, erro: expect.stringContaining("outra contestação") });
    expect(await saldo()).toBe(-100000); // nada mudou: só o reembolso desfeito está em aberto
  });
});
