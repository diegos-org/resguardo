import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { atualizarImovel, CodigoDuplicado, criarImovel, listarImoveis, obterImovel, opcoesDeFiltro } from "./repositorio";
import { type DadosImovel } from "./validacao";

let db: Db;
let close: () => Promise<void>;
let org: string;
let outraOrg: string;

const dados = (over: Partial<DadosImovel> = {}): DadosImovel => ({
  codigo: "t1",
  nome: "Teste 1",
  publico: true,
  ativo: true,
  bairro: "Bairro",
  cidade: "Rio de Janeiro",
  endereco: "",
  fuso: "America/Sao_Paulo",
  capacidade: 2,
  quartos: 1,
  banheiros: 1,
  descricao: "",
  ...over,
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const [a, b] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
  org = a.id;
  outraOrg = b.id;
});
afterEach(() => close());

describe("repositório de imóveis", () => {
  it("cria, lista em ordem de código e esconde inativos por padrão", async () => {
    await criarImovel(db, org, dados({ codigo: "t2", nome: "Dois" }));
    await criarImovel(db, org, dados({ codigo: "t1", nome: "Um" }));
    await criarImovel(db, org, dados({ codigo: "t3", nome: "Três", ativo: false }));
    expect((await listarImoveis(db, org)).map((i) => i.codigo)).toEqual(["t1", "t2"]);
    expect((await listarImoveis(db, org, { incluirInativos: true })).map((i) => i.codigo)).toEqual(["t1", "t2", "t3"]);
    expect(await opcoesDeFiltro(db, org)).toEqual([
      { codigo: "t1", nome: "Um" },
      { codigo: "t2", nome: "Dois" },
    ]);
  });

  it("não deixa repetir código na mesma organização, mas permite em outra", async () => {
    await criarImovel(db, org, dados());
    await expect(criarImovel(db, org, dados())).rejects.toBeInstanceOf(CodigoDuplicado);
    await expect(criarImovel(db, outraOrg, dados())).resolves.toBeTruthy();
  });

  it("atualiza e protege contra código duplicado", async () => {
    const a = await criarImovel(db, org, dados({ codigo: "t1" }));
    await criarImovel(db, org, dados({ codigo: "t2" }));
    const salvo = await atualizarImovel(db, org, a.id, dados({ codigo: "t1", nome: "Novo nome" }));
    expect(salvo?.nome).toBe("Novo nome");
    expect(salvo!.atualizadoEm.getTime()).toBeGreaterThanOrEqual(a.atualizadoEm.getTime());
    await expect(atualizarImovel(db, org, a.id, dados({ codigo: "t2" }))).rejects.toBeInstanceOf(CodigoDuplicado);
  });

  it("não enxerga nem altera imóvel de outra organização", async () => {
    const a = await criarImovel(db, org, dados());
    expect(await obterImovel(db, outraOrg, a.id)).toBeNull();
    expect(await atualizarImovel(db, outraOrg, a.id, dados({ nome: "Invasão" }))).toBeNull();
    expect((await obterImovel(db, org, a.id))?.nome).toBe("Teste 1");
    expect(await obterImovel(db, org, "não-é-uuid")).toBeNull();
  });
});
