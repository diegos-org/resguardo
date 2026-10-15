import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as auditoria from "@/auditoria/auditoria";
import { imoveis, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { atualizarImovel, CodigoDuplicado, criarImovel, obterImovel } from "./repositorio";
import type { DadosImovel } from "./validacao";

let db: Db;
let close: () => Promise<void>;
let org: string;

const dados: DadosImovel = {
  codigo: "t1",
  nome: "Um",
  publico: false,
  ativo: true,
  bairro: "",
  cidade: "Rio de Janeiro",
  endereco: "",
  fuso: "America/Sao_Paulo",
  capacidade: null,
  quartos: null,
  banheiros: null,
  descricao: "",
  frase: "",
};

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "A" }).returning();
});
afterEach(() => {
  vi.restoreAllMocks();
  return close();
});

describe("gravação atômica com auditoria", () => {
  it("se o histórico falhar, o imóvel não é criado", async () => {
    vi.spyOn(auditoria, "registrarAuditoria").mockRejectedValueOnce(new Error("falha de rede"));
    await expect(criarImovel(db, org, dados, null)).rejects.toThrow("falha de rede");
    expect(await db.select().from(imoveis)).toEqual([]);
  });

  it("se o histórico falhar, a edição é desfeita", async () => {
    const im = await criarImovel(db, org, dados, null);
    vi.spyOn(auditoria, "registrarAuditoria").mockRejectedValueOnce(new Error("falha de rede"));
    await expect(atualizarImovel(db, org, im.id, { ...dados, nome: "Outro" }, null)).rejects.toThrow("falha de rede");
    expect((await obterImovel(db, org, im.id))?.nome).toBe("Um");
  });

  it("código duplicado detectado pelo índice vira CodigoDuplicado", async () => {
    await db.insert(imoveis).values({ organizacaoId: org, codigo: "t1", nome: "Já existe" });
    // Simula a corrida: a checagem prévia não vê o outro cadastro.
    vi.spyOn(db, "select").mockImplementationOnce(
      () => ({ from: () => ({ where: async () => [] }) }) as unknown as ReturnType<Db["select"]>,
    );
    await expect(criarImovel(db, org, dados, null)).rejects.toBeInstanceOf(CodigoDuplicado);
  });
});

describe("uuidValido", () => {
  it("aceita só UUID completo", () => {
    expect(uuidValido("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    for (const ruim of ["------------------------------------", "abc", "123e4567e89b12d3a456426614174000", null]) {
      expect(uuidValido(ruim)).toBe(false);
    }
  });

  it("id malformado de 36 caracteres não quebra a consulta", async () => {
    expect(await obterImovel(db, org, "------------------------------------")).toBeNull();
    expect(await atualizarImovel(db, org, "------------------------------------", dados, null)).toBeNull();
  });
});
