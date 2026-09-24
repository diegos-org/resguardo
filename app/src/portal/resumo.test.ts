import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarContrato } from "@/contratos/repositorio";
import { imoveis, organizacoes, proprietarioImoveis, proprietarios, proprietarioUsuarios, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { criarCategoria } from "@/despesas/categorias";
import { registrarDespesa } from "@/despesas/despesas";
import type { DadosReserva } from "@/reservas/regras";
import { criarReserva } from "@/reservas/repositorio";
import { proprietariosDoUsuario, resumoDoProprietario } from "./resumo";

let db: Db;
let close: () => Promise<void>;
let org: string;
let a: string;
let b: string;
let dona: string;
let outro: string;
let categoria: string;
const periodo = { inicio: "2026-10-01", fim: "2026-11-01" };

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
      { organizacaoId: org, nome: "Outro" },
    ])
    .returning();
  await db.insert(proprietarioImoveis).values([
    { proprietarioId: dona, imovelId: a },
    { proprietarioId: outro, imovelId: b },
  ]);
  for (const i of [a, b]) await criarContrato(db, org, i, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
  const c = await criarCategoria(db, org, "Manutenção", null);
  if (!c.ok) throw new Error("categoria");
  categoria = c.categoria.id;
  await criarReserva(db, org, reserva(a), null);
  await criarReserva(db, org, reserva(b), null);
  await registrarDespesa(
    db,
    org,
    { responsavel: "proprietario", pagoPor: "empresa", categoriaId: categoria, descricao: "Reparo", valor: 20000, data: "2026-10-05", imovelId: a, proprietarioId: null, fornecedor: "", comprovante: "", paga: true, dataPagamento: "2026-10-06" },
    null,
  );
});
afterEach(() => close());

describe("resumo do portal", () => {
  it("só os números da própria dona: reservas, bruto, taxa, comissão, parte dela, despesas e acerto", async () => {
    const r = await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [a], periodo });
    // Bruto 1.000; taxa 150; comissão 15% de 850 = 127,50; parte dela 722,50; reparo 200 pago pela empresa.
    expect(r).toEqual({ reservas: 1, receitaBruta: 100000, taxasCanais: 15000, comissao: 12750, suaParte: 72250, despesas: 20000, acerto: 72250 - 20000 });
  });

  it("não vê imóvel de outro dono, nem 'todos' quando a lista vem vazia", async () => {
    expect(await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [b], periodo })).toMatchObject({ reservas: 0, receitaBruta: 0, suaParte: 0 });
    expect(await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [], periodo })).toMatchObject({ reservas: 0, receitaBruta: 0 });
    expect(await resumoDoProprietario(db, org, { proprietarioIds: [], imovelIds: [a], periodo })).toMatchObject({ reservas: 0 });
  });

  it("imóvel que passou para outro dono: o novo não vê o histórico do anterior", async () => {
    await db.delete(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, a));
    await db.insert(proprietarioImoveis).values({ proprietarioId: outro, imovelId: a });
    expect(await resumoDoProprietario(db, org, { proprietarioIds: [outro], imovelIds: [a], periodo })).toMatchObject({ reservas: 0, receitaBruta: 0, suaParte: 0, despesas: 0, acerto: 0 });
  });

  it("proprietários do usuário: só os ativos ligados a ele", async () => {
    const [u] = await db.insert(usuarios).values({ organizacaoId: org, email: "dona@example.com", nome: "Dona", papel: "proprietario" }).returning();
    await db.insert(proprietarioUsuarios).values({ proprietarioId: dona, usuarioId: u.id });
    expect(await proprietariosDoUsuario(db, org, u.id)).toEqual([{ id: dona, nome: "Dona", chavePix: "dona@example.com" }]);
    await db.update(proprietarios).set({ ativo: false }).where(eq(proprietarios.id, dona));
    expect(await proprietariosDoUsuario(db, org, u.id)).toEqual([]);
  });
});
