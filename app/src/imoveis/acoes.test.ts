/**
 * Ação "Salvar" da ficha do imóvel: o caminho real do formulário até o banco, para a frase de abertura (M7.17). A ficha
 * aberta antes de a frase existir não manda o campo: a frase gravada fica como estava; mandada vazia, é apagada. Sessão,
 * `revalidatePath` e `redirect` falsos; o banco é o PGlite de teste, com dados fictícios.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sessao } from "@/acesso/politica";
import { organizacoes, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { criarImovel, obterImovel } from "./repositorio";

const m = vi.hoisted(() => ({ db: null as unknown as Db, sessao: null as unknown as Sessao }));
vi.mock("@/db/client", () => ({ getDb: () => m.db }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: async () => m.sessao }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Como no Next, o redirect interrompe a ação depois de salvar.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const { salvarImovel } = await import("./acoes");

/** A ficha como o formulário manda (sem a frase, a ficha de antes do M7.17). */
const ficha = (id: string, extra: Record<string, string> = {}) => {
  const f = new FormData();
  const campos = { id, codigo: "t1", nome: "Casa Fictícia", bairro: "Leblon", cidade: "Rio de Janeiro", endereco: "", fuso: "America/Sao_Paulo", capacidade: "2", quartos: "1", banheiros: "1", descricao: "Descrição fictícia.", publico: "on", ativo: "on", ...extra };
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};

let close: () => Promise<void>, org: string, id: string, n = 0;
beforeAll(async () => {
  ({ db: m.db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
  [{ id: org }] = await m.db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  const [u] = await m.db.insert(usuarios).values({ organizacaoId: org, email: `equipe-imovel${++n}@example.com`, nome: "Equipe Fictícia", papel: "admin" }).returning();
  m.sessao = { usuarioId: u.id, organizacaoId: org, papel: "admin", imovelIds: [] };
  ({ id } = await criarImovel(
    m.db,
    org,
    { codigo: "t1", nome: "Casa Fictícia", publico: true, ativo: true, bairro: "Leblon", cidade: "Rio de Janeiro", endereco: "", fuso: "America/Sao_Paulo", capacidade: 2, quartos: 1, banheiros: 1, descricao: "Descrição fictícia.", frase: "Frase fictícia da casa." },
    u.id,
  ));
});

describe("salvar a ficha do imóvel com a frase de abertura", () => {
  it("ficha aberta antes do M7.17 (sem o campo frase): a frase gravada fica, e o resto é salvo", async () => {
    await expect(salvarImovel({}, ficha(id, { nome: "Casa Fictícia Renomeada" }))).rejects.toThrow("redirect:/painel/imoveis?salvo=1");
    expect(await obterImovel(m.db, org, id)).toMatchObject({ nome: "Casa Fictícia Renomeada", frase: "Frase fictícia da casa." });
  });

  it("frase mandada vazia: é apagada", async () => {
    await expect(salvarImovel({}, ficha(id, { frase: "" }))).rejects.toThrow("redirect:");
    expect((await obterImovel(m.db, org, id))?.frase).toBe("");
  });

  it("frase mandada: é gravada", async () => {
    await expect(salvarImovel({}, ficha(id, { frase: "Outra frase fictícia." }))).rejects.toThrow("redirect:");
    expect((await obterImovel(m.db, org, id))?.frase).toBe("Outra frase fictícia.");
  });
});
