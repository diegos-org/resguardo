import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { organizacoes, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { atualizarImovel, criarImovel } from "@/imoveis/repositorio";
import type { DadosImovel } from "@/imoveis/validacao";
import { calcularMudancas, historicoDe, ocultarCampos } from "./auditoria";

describe("calcularMudancas", () => {
  it("criação lista todos os campos, exceto os técnicos", () => {
    expect(calcularMudancas(null, { id: "x", nome: "A", capacidade: 2, atualizadoEm: new Date() })).toEqual({
      nome: [null, "A"],
      capacidade: [null, 2],
    });
  });

  it("edição lista só o que mudou", () => {
    expect(calcularMudancas({ nome: "A", bairro: "Leblon", capacidade: null }, { nome: "B", bairro: "Leblon", capacidade: 3 })).toEqual({
      nome: ["A", "B"],
      capacidade: [null, 3],
    });
    expect(calcularMudancas({ nome: "A" }, { nome: "A" })).toEqual({});
  });
});

describe("histórico de imóveis", () => {
  let db: Db;
  let close: () => Promise<void>;
  let org: string;
  let outraOrg: string;
  let autor: string;

  const dados: DadosImovel = {
    codigo: "t1",
    nome: "Teste",
    publico: false,
    ativo: true,
    bairro: "",
    cidade: "Rio de Janeiro",
    endereco: "",
    fuso: "America/Sao_Paulo",
    capacidade: 2,
    quartos: null,
    banheiros: null,
    descricao: "",
    frase: "",
  };

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    const [a, b] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
    org = a.id;
    outraOrg = b.id;
    const [u] = await db.insert(usuarios).values({ organizacaoId: org, email: "autor@example.com", nome: "Autora", papel: "admin" }).returning();
    autor = u.id;
  });
  afterEach(() => close());

  it("registra criação e edição com autor, do mais recente para o mais antigo", async () => {
    const im = await criarImovel(db, org, dados, autor);
    await atualizarImovel(db, org, im.id, { ...dados, nome: "Novo", publico: true }, autor);
    await atualizarImovel(db, org, im.id, { ...dados, nome: "Novo", publico: true }, autor); // sem mudança: não registra

    const h = await historicoDe(db, org, "imovel", im.id);
    expect(h.map((l) => l.acao)).toEqual(["imovel.editar", "imovel.criar"]);
    expect(h[0].mudancas).toEqual({ nome: ["Teste", "Novo"], publico: [false, true] });
    expect(h[0].autor).toBe("Autora");
    expect(h[1].mudancas.codigo).toEqual([null, "t1"]);
  });

  it("histórico é isolado por organização", async () => {
    const im = await criarImovel(db, org, dados, null);
    expect(await historicoDe(db, outraOrg, "imovel", im.id)).toEqual([]);
    expect((await historicoDe(db, org, "imovel", im.id))[0].autor).toBeNull();
  });
});

describe("ocultarCampos", () => {
  it("tira os campos escondidos e some com edições que só mexiam neles", () => {
    const base = { id: "1", criadoEm: new Date(), autor: null };
    const linhas = [
      { ...base, id: "a", acao: "reserva.sincronizar", mudancas: { valorBruto: [1, 2], checkout: ["x", "y"] } },
      { ...base, id: "b", acao: "reserva.sincronizar", mudancas: { valorLiquido: [1, 2] } },
      { ...base, id: "c", acao: "reserva.importar", mudancas: { valorBruto: [null, 5] } },
    ] as Parameters<typeof ocultarCampos>[0];
    const r = ocultarCampos(linhas, ["valorBruto", "valorLiquido"]);
    expect(r.map((l) => [l.id, Object.keys(l.mudancas)])).toEqual([
      ["a", ["checkout"]],
      ["c", []],
    ]);
  });
});
