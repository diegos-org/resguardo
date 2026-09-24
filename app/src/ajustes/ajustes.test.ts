import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { imoveis, organizacoes, proprietarioImoveis, proprietarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { listarLancamentos, saldoAcerto, totaisPorTipo } from "@/financeiro/ledger";
import { criarReserva } from "@/reservas/repositorio";
import { complementarAjuste, type DadosAjuste, descricaoAjuste, direcaoDe, esclarecerAjuste, lerFormAjuste, listarAjustes, obterAjuste, registrarAjuste } from "./ajustes";

let db: Db;
let close: () => Promise<void>;
let org: string;
let outraOrg: string;
let im: string;
let dono: string;
let reservaId: string;
let reservaCodigo: string;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }, { id: outraOrg }] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Quatro" }).returning();
  [{ id: dono }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Dona" }).returning();
  await db.insert(proprietarioImoveis).values({ proprietarioId: dono, imovelId: im });
  const r = await criarReserva(
    db,
    org,
    { imovelId: im, origem: "airbnb", estado: "confirmada", checkin: "2026-10-10", checkout: "2026-10-12", hospedes: 2, hospedeNome: "", hospedeEmail: "", hospedeTelefone: "", hospedeOrigem: "", moeda: "BRL", valorBruto: null, taxaCanal: null, valorLiquido: null, codigoCanal: "", observacoes: "" },
    null,
  );
  if (!r.ok) throw new Error("reserva");
  reservaId = r.reserva.id;
  reservaCodigo = r.reserva.codigo;
});
afterEach(() => close());

const dados = (over: Partial<DadosAjuste> = {}): DadosAjuste => ({
  data: "2026-10-15",
  imovelId: null,
  reservaId,
  proprietarioId: null,
  motivo: "",
  origem: "desconhecida",
  origemComprovada: false,
  evidencia: "Extrato do Airbnb de outubro",
  comprovante: "",
  valor: 15000,
  direcao: "empresa_saida",
  ...over,
});

describe("descrição verdadeira", () => {
  it("sem motivo: genérica; origem só aparece se comprovada", () => {
    expect(descricaoAjuste({ motivo: "", origem: "airbnb", origemComprovada: false, reservaCodigo: "SCL-AB12" })).toBe("Ajuste de reserva — motivo não identificado (SCL-AB12)");
    expect(descricaoAjuste({ motivo: "", origem: "desconhecida", origemComprovada: false })).toBe("Ajuste — motivo não identificado");
    expect(descricaoAjuste({ motivo: "Reembolso parcial ao hóspede", origem: "airbnb", origemComprovada: true, reservaCodigo: "SCL-AB12" })).toBe(
      "Ajuste da reserva SCL-AB12: Reembolso parcial ao hóspede — feito por Airbnb",
    );
  });

  it("formulário: valor em branco = desconhecido; evidência obrigatória; origem desconhecida não comprovada", () => {
    const base = { data: "2026-10-15", direcao: "empresa_saida", evidencia: "Extrato", valor: "" };
    expect(lerFormAjuste(base)).toMatchObject({ ok: true, dados: { valor: null, origem: "desconhecida" } });
    expect(lerFormAjuste({ ...base, evidencia: "" })).toMatchObject({ ok: false, erros: { evidencia: expect.any(String) } });
    expect(lerFormAjuste({ ...base, origemComprovada: "on" })).toMatchObject({ ok: false, erros: { origemComprovada: expect.any(String) } });
    expect(lerFormAjuste({ ...base, valor: "0" })).toMatchObject({ ok: false, erros: { valor: expect.any(String) } });
    expect(lerFormAjuste({ ...base, direcao: "x" })).toMatchObject({ ok: false });
  });
});

describe("registro e esclarecimento", () => {
  it("valor desconhecido: nada vai para o livro, e não dá para esclarecer", async () => {
    const r = await registrarAjuste(db, org, dados({ valor: null }), null);
    if (!r.ok) throw new Error(JSON.stringify(r.erros));
    expect(await listarLancamentos(db, org, {})).toEqual([]);
    expect(await esclarecerAjuste(db, org, r.id, null)).toMatchObject({ ok: false });
    const a = await obterAjuste(db, org, r.id);
    expect(a).toMatchObject({ valor: null, reservaCodigo, imovelCodigo: "403", imovelId: im });
  });

  it("com valor e sem motivo: lançamento pendente com texto genérico; sem motivo não esclarece", async () => {
    const r = await registrarAjuste(db, org, dados(), null);
    if (!r.ok) throw new Error("x");
    const [l] = await listarLancamentos(db, org, {});
    expect(l).toMatchObject({ tipo: "ajuste", valor: -15000, estado: "pendente", descricao: `Ajuste de reserva — motivo não identificado (${reservaCodigo})`, reservaId });
    expect(await esclarecerAjuste(db, org, r.id, null)).toMatchObject({ ok: false, erro: expect.stringContaining("genérico") });
  });

  it("complementar depois: motivo e origem comprovada relançam; esclarecer tira de pendente e trava", async () => {
    const r = await registrarAjuste(db, org, dados(), null);
    if (!r.ok) throw new Error("x");
    expect(await complementarAjuste(db, org, r.id, dados({ motivo: "Reembolso ao hóspede por ar quebrado", origem: "airbnb", origemComprovada: true }), null)).toMatchObject({ ok: true });
    const todos = await listarLancamentos(db, org, {});
    expect(todos).toHaveLength(3); // original + estorno + novo
    expect((await totaisPorTipo(db, org, {})).ajuste).toBe(-15000);
    expect(await esclarecerAjuste(db, org, r.id, null)).toEqual({ ok: true });
    const a = await obterAjuste(db, org, r.id);
    const novo = todos.find((l) => l.id === a!.lancamentoId)!;
    expect(novo.descricao).toContain("feito por Airbnb");
    expect((await listarLancamentos(db, org, {})).find((l) => l.id === a!.lancamentoId)?.estado).toBe("realizado");
    expect(await complementarAjuste(db, org, r.id, dados({ motivo: "outro" }), null)).toMatchObject({ ok: false });
    expect(await listarAjustes(db, org, { pendentes: true })).toEqual([]);
    expect(await historicoDe(db, org, "ajuste", r.id)).toHaveLength(3);
  });

  it("complementar sem mudar o que vai para o livro não relança", async () => {
    const r = await registrarAjuste(db, org, dados(), null);
    if (!r.ok) throw new Error("x");
    await complementarAjuste(db, org, r.id, dados({ evidencia: "Extrato + painel do Airbnb" }), null);
    expect(await listarLancamentos(db, org, {})).toHaveLength(1);
  });

  it("ajuste com o proprietário mexe no acerto (dono deduzido do imóvel)", async () => {
    const r = await registrarAjuste(db, org, dados({ direcao: "proprietario_debito", motivo: "Dano causado pelo próprio dono" }), null);
    if (!r.ok) throw new Error("x");
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(-15000);
    expect((await obterAjuste(db, org, r.id))?.proprietarioId).toBe(dono);
    expect(direcaoDe({ afeta: "proprietario", valor: -15000 })).toBe("proprietario_debito");
  });

  it("isolamento: reserva/imóvel de outra organização recusados", async () => {
    expect(await registrarAjuste(db, outraOrg, dados(), null)).toMatchObject({ ok: false, erros: { reservaId: expect.any(String) } });
    expect(await listarAjustes(db, outraOrg)).toEqual([]);
    expect(await registrarAjuste(db, org, dados({ reservaId: null, direcao: "proprietario_credito" }), null)).toMatchObject({ ok: false, erros: { imovelId: expect.any(String) } });
  });
});
