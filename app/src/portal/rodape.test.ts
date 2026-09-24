import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registrarAjuste } from "@/ajustes/ajustes";
import { criarContrato } from "@/contratos/repositorio";
import { imoveis, organizacoes, proprietarioImoveis, proprietarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { criarCategoria } from "@/despesas/categorias";
import { registrarDespesa } from "@/despesas/despesas";
import { fecharMes, marcarRepassePago } from "@/repasses/repasses";
import type { DadosReserva } from "@/reservas/regras";
import { criarReserva } from "@/reservas/repositorio";
import { rodapeDoPortal } from "./rodape";

let db: Db;
let close: () => Promise<void>;
let org: string;
let a: string;
let b: string;
let dona: string;
let outro: string;
let categoria: string;
const MES = "2026-10";
const PIX_EMPRESA = "financeiro@example.com";

const reserva = (imovelId: string): DadosReserva => ({
  imovelId,
  origem: "booking",
  estado: "confirmada",
  checkin: "2026-10-10",
  checkout: "2026-10-13",
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
  [{ id: dona }, { id: outro }] = await db
    .insert(proprietarios)
    .values([
      { organizacaoId: org, nome: "Dona", chavePix: "dona@example.com" },
      { organizacaoId: org, nome: "Outro", chavePix: "" },
    ])
    .returning();
  await db.insert(proprietarioImoveis).values([
    { proprietarioId: dona, imovelId: a },
    { proprietarioId: outro, imovelId: b },
  ]);
  await criarContrato(db, org, a, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
  const c = await criarCategoria(db, org, "Manutenção", null);
  if (!c.ok) throw new Error("categoria");
  categoria = c.categoria.id;
  // Booking: a empresa recebe e deve 722,50 à dona.
  await criarReserva(db, org, reserva(a), null);
  // O outro proprietário deve 300 (reparo pago pela empresa).
  await registrarDespesa(
    db,
    org,
    { responsavel: "proprietario", pagoPor: "empresa", categoriaId: categoria, descricao: "Reparo", valor: 30000, data: "2026-10-05", imovelId: b, proprietarioId: null, fornecedor: "", comprovante: "", paga: true, dataPagamento: "2026-10-06" },
    null,
  );
});
afterEach(() => close());

const rodape = (hoje: string, quem = { id: dona, nome: "Dona" }) => rodapeDoPortal(db, org, { proprietarios: [quem], mes: MES, hoje, pixEmpresa: PIX_EMPRESA }).then((r) => r[0]);

describe("rodapé do portal", () => {
  it("mês ainda não terminou: saldo parcial, sem credor nem Pix", async () => {
    expect(await rodape("2026-10-20")).toMatchObject({ situacao: "parcial", saldo: 72250, valor: 72250, aFavor: "proprietario", chavePix: "" });
    expect(await rodape("2026-10-20", { id: outro, nome: "Outro" })).toMatchObject({ situacao: "parcial", valor: 30000, aFavor: "empresa" });
  });

  it("mês terminado: a empresa deve (Pix do proprietário); o proprietário deve (Pix da empresa)", async () => {
    expect(await rodape("2026-11-02")).toMatchObject({ situacao: "empresa_deve", valor: 72250, chavePix: "dona@example.com" });
    expect(await rodape("2026-11-02", { id: outro, nome: "Outro" })).toMatchObject({ situacao: "proprietario_deve", valor: 30000, chavePix: PIX_EMPRESA });
  });

  it("com ajuste a esclarecer: em conferência, sem credor nem Pix", async () => {
    await registrarAjuste(
      db,
      org,
      { data: "2026-10-20", imovelId: a, reservaId: null, proprietarioId: null, motivo: "Vidro quebrado", origem: "desconhecida", origemComprovada: false, evidencia: "", comprovante: "", valor: null, direcao: "proprietario_debito" },
      null,
    );
    expect(await rodape("2026-11-02")).toMatchObject({ situacao: "em_conferencia", chavePix: "" });
  });

  it("só um ajuste sem valor a esclarecer: em conferência, não 'nada a pagar'", async () => {
    const [so] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Só ajuste" }).returning();
    const [c] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "777", nome: "Sete" }).returning();
    await db.insert(proprietarioImoveis).values({ proprietarioId: so.id, imovelId: c.id });
    await registrarAjuste(
      db,
      org,
      { data: "2026-10-20", imovelId: c.id, reservaId: null, proprietarioId: null, motivo: "Vidro quebrado", origem: "desconhecida", origemComprovada: false, evidencia: "", comprovante: "", valor: null, direcao: "proprietario_debito" },
      null,
    );
    expect(await rodape("2026-11-02", { id: so.id, nome: "Só ajuste" })).toMatchObject({ situacao: "em_conferencia", valor: 0, chavePix: "" });
  });

  it("mês fechado e depois pago", async () => {
    const f = await fecharMes(db, org, dona, MES, "2026-11-02", null);
    if (!f.ok) throw new Error(f.erro);
    expect(await rodape("2026-11-02")).toMatchObject({ situacao: "fechado", valor: 72250, chavePix: "dona@example.com" });
    expect((await marcarRepassePago(db, org, f.id, "2026-11-03", "2026-11-03", null)).ok).toBe(true);
    expect(await rodape("2026-11-04")).toMatchObject({ situacao: "pago", valor: 72250, dataPagamento: "2026-11-03" });
  });

  it("mudança depois do fechamento: o mês continua fechado e mostra a diferença que vai para o próximo repasse", async () => {
    const f = await fecharMes(db, org, dona, MES, "2026-11-02", null);
    if (!f.ok) throw new Error(f.erro);
    await registrarDespesa(
      db,
      org,
      { responsavel: "proprietario", pagoPor: "empresa", categoriaId: categoria, descricao: "Chave nova", valor: 5000, data: "2026-10-28", imovelId: a, proprietarioId: null, fornecedor: "", comprovante: "", paga: true, dataPagamento: "2026-10-28" },
      null,
    );
    expect(await rodape("2026-11-03")).toMatchObject({ situacao: "fechado", valor: 72250, diferenca: -5000, emConferencia: false });
    // Novembro fechado depois: ele já levou a diferença de outubro — não aparece mais.
    await criarReserva(db, org, { ...reserva(a), checkin: "2026-11-10", checkout: "2026-11-13" }, null);
    const g = await fecharMes(db, org, dona, "2026-11", "2026-12-02", null);
    if (!g.ok) throw new Error(g.erro);
    expect(await rodape("2026-12-02")).toMatchObject({ situacao: "fechado", valor: 72250, diferenca: 0 });
    // Lançamento com data de outubro depois do repasse de novembro: volta a aparecer.
    await registrarDespesa(
      db,
      org,
      { responsavel: "proprietario", pagoPor: "empresa", categoriaId: categoria, descricao: "Tranca", valor: 2000, data: "2026-10-29", imovelId: a, proprietarioId: null, fornecedor: "", comprovante: "", paga: true, dataPagamento: "2026-10-29" },
      null,
    );
    expect(await rodape("2026-12-03")).toMatchObject({ situacao: "fechado", diferenca: -2000 });
  });

  it("mês sem repasse cujo saldo entrou num repasse posterior: não fica 'em conferência'", async () => {
    await criarContrato(db, org, b, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
    await criarReserva(db, org, { ...reserva(b), checkin: "2026-11-10", checkout: "2026-11-13" }, null);
    const f = await fecharMes(db, org, outro, "2026-11", "2026-12-02", null);
    if (!f.ok) throw new Error(f.erro);
    expect(await rodape("2026-12-02", { id: outro, nome: "Outro" })).toMatchObject({ situacao: "no_repasse_posterior", repassePosterior: "2026-11", valor: 0, diferenca: 0 });
    // Com mais de um repasse depois, aponta o primeiro (o que levou o saldo deste mês).
    await criarReserva(db, org, { ...reserva(b), checkin: "2026-12-10", checkout: "2026-12-13" }, null);
    const g = await fecharMes(db, org, outro, "2026-12", "2027-01-02", null);
    if (!g.ok) throw new Error(g.erro);
    expect(await rodape("2027-01-02", { id: outro, nome: "Outro" })).toMatchObject({ situacao: "no_repasse_posterior", repassePosterior: "2026-11" });
    // Lançamento retroativo em outubro depois dos repasses: não foi levado; aparece à parte.
    const [vinculo] = await db.select().from(proprietarioImoveis).where(eq(proprietarioImoveis.proprietarioId, outro));
    await registrarDespesa(
      db,
      org,
      { responsavel: "proprietario", pagoPor: "empresa", categoriaId: categoria, descricao: "Conserto", valor: 3000, data: "2026-10-25", imovelId: vinculo.imovelId, proprietarioId: null, fornecedor: "", comprovante: "", paga: true, dataPagamento: "2026-10-25" },
      null,
    );
    expect(await rodape("2027-01-03", { id: outro, nome: "Outro" })).toMatchObject({ situacao: "no_repasse_posterior", repassePosterior: "2026-11", diferenca: -3000 });
  });

  it("mês vazio antes de um repasse posterior continua 'nada a pagar' (não 'entrou no repasse de…')", async () => {
    await criarContrato(db, org, b, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
    await criarReserva(db, org, { ...reserva(b), checkin: "2026-11-10", checkout: "2026-11-13" }, null);
    const f = await fecharMes(db, org, outro, "2026-11", "2026-12-02", null);
    if (!f.ok) throw new Error(f.erro);
    // Setembro: o Outro não tinha nada até ali.
    expect((await rodapeDoPortal(db, org, { proprietarios: [{ id: outro, nome: "Outro" }], mes: "2026-09", hoje: "2026-12-02", pixEmpresa: PIX_EMPRESA }))[0]).toMatchObject({ situacao: "zerado", repassePosterior: null });
  });

  it("sem movimento: zerado; mês inválido ou sem proprietário: nada", async () => {
    const [sem] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Sem movimento" }).returning();
    expect(await rodape("2026-11-02", { id: sem.id, nome: "Sem movimento" })).toMatchObject({ situacao: "zerado", valor: 0 });
    expect(await rodapeDoPortal(db, org, { proprietarios: [], mes: MES, hoje: "2026-11-02", pixEmpresa: "" })).toEqual([]);
    expect(await rodapeDoPortal(db, org, { proprietarios: [{ id: dona, nome: "Dona" }], mes: "2026-13", hoje: "2026-11-02", pixEmpresa: "" })).toEqual([]);
  });
});
