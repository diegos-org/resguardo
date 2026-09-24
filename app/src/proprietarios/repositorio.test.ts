import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { imoveis, organizacoes, proprietarioImoveis } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import {
  adicionarRepresentante,
  atualizarProprietario,
  criarProprietario,
  definirImoveis,
  imoveisDeOutroDono,
  listarProprietarios,
  obterProprietario,
  removerRepresentante,
} from "./repositorio";
import type { DadosProprietario } from "./validacao";

let db: Db;
let close: () => Promise<void>;
let org: string;
let outra: string;
let im: { a: string; b: string; deOutra: string };

const dados = (over: Partial<DadosProprietario> = {}): DadosProprietario => ({
  nome: "Proprietária Teste",
  tipo: "fisica",
  documento: "52998224725",
  email: "p@example.com",
  telefone: "",
  endereco: "",
  chavePix: "chave-teste",
  observacoes: "",
  ativo: true,
  ...over,
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const [a, b] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
  org = a.id;
  outra = b.id;
  const [i1, i2, i3] = await db
    .insert(imoveis)
    .values([
      { organizacaoId: org, codigo: "t1", nome: "Um" },
      { organizacaoId: org, codigo: "t2", nome: "Dois" },
      { organizacaoId: outra, codigo: "x1", nome: "Outra" },
    ])
    .returning();
  im = { a: i1.id, b: i2.id, deOutra: i3.id };
});
afterEach(() => close());

describe("proprietários", () => {
  it("cadastra, vincula imóveis (ignorando os de outra organização) e lista", async () => {
    const p = await criarProprietario(db, org, dados(), null);
    await definirImoveis(db, org, p.id, [im.b, im.a, im.deOutra, "lixo"], null);
    const [linha] = await listarProprietarios(db, org);
    expect(linha.imoveis.map((i) => i.codigo)).toEqual(["t1", "t2"]);
    expect((await obterProprietario(db, org, p.id))?.imovelIds).toEqual([im.a, im.b].sort());
    expect(await listarProprietarios(db, outra)).toEqual([]);
  });

  it("cada imóvel tem um proprietário só", async () => {
    const p1 = await criarProprietario(db, org, dados(), null);
    const p2 = await criarProprietario(db, org, dados({ nome: "Outra Fictícia" }), null);
    expect(await definirImoveis(db, org, p1.id, [im.a], null)).toBe(true);
    const r = await definirImoveis(db, org, p2.id, [im.a, im.b], null);
    expect(r).toContain("t1 já é de");
    expect((await obterProprietario(db, org, p2.id))?.imovelIds).toEqual([]);
    expect(await imoveisDeOutroDono(db, org, [im.a, im.b], p2.id)).toHaveLength(1);
    expect(await imoveisDeOutroDono(db, org, [im.a], p1.id)).toHaveLength(0);
    // passar o imóvel: tira do primeiro e dá ao segundo
    expect(await definirImoveis(db, org, p1.id, [], null)).toBe(true);
    expect(await definirImoveis(db, org, p2.id, [im.a], null)).toBe(true);
  });

  it("editar os imóveis mantém a data de início dos vínculos que continuam", async () => {
    const p = await criarProprietario(db, org, dados(), null);
    await definirImoveis(db, org, p.id, [im.a], null);
    await db.update(proprietarioImoveis).set({ criadoEm: new Date("2025-01-01T12:00:00Z") }).where(eq(proprietarioImoveis.imovelId, im.a));
    await definirImoveis(db, org, p.id, [im.a, im.b], null);
    const vinculos = await db.select().from(proprietarioImoveis).where(eq(proprietarioImoveis.proprietarioId, p.id));
    expect(vinculos.find((v) => v.imovelId === im.a)?.criadoEm.toISOString()).toBe("2025-01-01T12:00:00.000Z");
    expect(vinculos).toHaveLength(2);
    await definirImoveis(db, org, p.id, [im.b], null);
    expect((await db.select().from(proprietarioImoveis).where(eq(proprietarioImoveis.proprietarioId, p.id))).map((v) => v.imovelId)).toEqual([im.b]);
  });

  it("não expõe nem altera proprietário de outra organização", async () => {
    const p = await criarProprietario(db, org, dados(), null);
    expect(await obterProprietario(db, outra, p.id)).toBeNull();
    expect(await atualizarProprietario(db, outra, p.id, dados({ nome: "Invasão" }), null)).toBeNull();
    expect(await definirImoveis(db, outra, p.id, [im.deOutra], null)).toBe(false);
    expect(await adicionarRepresentante(db, outra, p.id, { nome: "X", relacao: "", email: "", telefone: "", recebeRelatorios: false }, null)).toBeNull();
  });

  it("representantes: adiciona e remove, com histórico", async () => {
    const p = await criarProprietario(db, org, dados(), null);
    const rep = await adicionarRepresentante(db, org, p.id, { nome: "Ana", relacao: "cônjuge", email: "", telefone: "", recebeRelatorios: true }, null);
    expect((await obterProprietario(db, org, p.id))?.representantes.map((r) => r.nome)).toEqual(["Ana"]);
    expect(await removerRepresentante(db, outra, p.id, rep!.id, null)).toBe(false);
    expect(await removerRepresentante(db, org, p.id, rep!.id, null)).toBe(true);
    expect((await obterProprietario(db, org, p.id))?.representantes).toEqual([]);
    const acoes = (await historicoDe(db, org, "proprietario", p.id)).map((h) => h.acao);
    expect(acoes).toEqual(["proprietario.representante.remover", "proprietario.representante.adicionar", "proprietario.criar"]);
  });

  it("auditoria nunca grava CPF nem Pix por extenso", async () => {
    const p = await criarProprietario(db, org, dados(), null);
    await atualizarProprietario(db, org, p.id, dados({ documento: "11144477735", chavePix: "nova-chave" }), null);
    const texto = JSON.stringify(await historicoDe(db, org, "proprietario", p.id));
    expect(texto).not.toContain("52998224725");
    expect(texto).not.toContain("11144477735");
    expect(texto).not.toContain("chave-teste");
    expect(texto).not.toContain("nova-chave");
  });
});
