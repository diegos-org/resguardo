/**
 * Ações da importação dos preços do Beds24 (M3.11a, desenho 3.5 e 3.6; teste 7 e 8 da seção 5): negadas por padrão — a
 * operação não aprova, não desfaz nem guarda cópia; sem `imovel:editar` não aprova nem desfaz; o imóvel de outra
 * organização não é encontrado — e o caminho do formulário até o banco para o admin. Sessão e `revalidatePath` falsos; o
 * banco é o PGlite de teste, com dados fictícios.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sessao } from "@/acesso/politica";
import { beds24Calendario, beds24CalendarioCopias, idsExternos, imoveis, organizacoes, precosImportados, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { somarDias } from "@/imoveis/regras-venda";
import { hojeISO } from "@/lib/datas";

const m = vi.hoisted(() => ({ db: null as unknown as Db, sessao: null as unknown as Sessao, semEditarImovel: false, revalidar: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => m.db }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: async () => m.sessao }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidar }));
// Um papel com `configuracao:editar` e sem `imovel:editar` não existe hoje: a política é trocada só nesse caso.
vi.mock("@/acesso/politica", async (orig) => {
  const real = await orig<typeof import("@/acesso/politica")>();
  return {
    ...real,
    exigir: (s: Sessao, acao: Parameters<typeof real.exigir>[1], r: Parameters<typeof real.exigir>[2]) => {
      if (m.semEditarImovel && acao === "imovel:editar") throw new real.AcessoNegado("ACAO_NAO_PERMITIDA");
      return real.exigir(s, acao, r);
    },
  };
});

const { aprovarImportacaoAcao, desfazerImportacaoAcao, guardarCopiaAcao } = await import("./acoes-importacao");
const { montarRevisao } = await import("./importacao");

let close: () => Promise<void>, org: string, im: string, admin: Sessao, operacao: Sessao, n = 0;
const form = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};
const pedido = async () => {
  const r = (await montarRevisao(m.db, org, im))!;
  return form({ imovelId: im, assinatura: r.proposta.assinatura, usarPrecoBase: r.usar.precoBase ? "sim" : "nao", usarEstadiaMaxima: r.usar.estadiaMaxima ? "sim" : "nao" });
};
const camada = () => m.db.select().from(precosImportados).where(eq(precosImportados.organizacaoId, org));
const copias = () => m.db.select().from(beds24CalendarioCopias).where(eq(beds24CalendarioCopias.organizacaoId, org));
const sessao = async (organizacaoId: string, papel: "admin" | "operacao"): Promise<Sessao> => {
  const [u] = await m.db.insert(usuarios).values({ organizacaoId, email: `equipe.acoes${++n}@example.com`, nome: "Equipe Fictícia", papel }).returning();
  return { usuarioId: u.id, organizacaoId, papel, imovelIds: [] };
};

beforeAll(async () => { ({ db: m.db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  m.semEditarImovel = false;
  m.revalidar.mockClear();
  [{ id: org }] = await m.db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  [{ id: im }] = await m.db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Studio fictício" }).returning();
  await m.db.insert(idsExternos).values({ organizacaoId: org, imovelId: im, canal: "beds24", idExterno: "10", detalhe: "20" });
  // A leitura de agora, das próximas 10 noites (a ação usa a hora real).
  const hoje = hojeISO();
  await m.db.insert(beds24Calendario).values(Array.from({ length: 10 }, (_, i) => ({ organizacaoId: org, imovelId: im, data: somarDias(hoje, i), roomId: "20", livres: 1, preco: 45000 + i * 100, minimoNoites: 2, maximoNoites: 27, bloqueio: "none", observadoEm: new Date() })));
  admin = await sessao(org, "admin");
  operacao = await sessao(org, "operacao");
});

describe("ações da importação de preços (M3.11a)", () => {
  it("operação não aprova, não desfaz nem guarda cópia (nada é gravado)", async () => {
    m.sessao = operacao;
    const f = await pedido();
    await expect(aprovarImportacaoAcao({}, f)).rejects.toThrow("ACAO_NAO_PERMITIDA");
    await expect(desfazerImportacaoAcao({}, form({ imovelId: im }))).rejects.toThrow("ACAO_NAO_PERMITIDA");
    await expect(guardarCopiaAcao({}, form({ imovelId: im }))).rejects.toThrow("ACAO_NAO_PERMITIDA");
    expect([await camada(), await copias()]).toEqual([[], []]);
    expect(m.revalidar).not.toHaveBeenCalled();
  });

  it("sem imovel:editar, não aprova nem desfaz; guardar a cópia só pede configuracao:editar", async () => {
    m.sessao = admin;
    m.semEditarImovel = true;
    await expect(aprovarImportacaoAcao({}, await pedido())).rejects.toThrow("ACAO_NAO_PERMITIDA");
    await expect(desfazerImportacaoAcao({}, form({ imovelId: im }))).rejects.toThrow("ACAO_NAO_PERMITIDA");
    expect(await camada()).toEqual([]);
    expect(await guardarCopiaAcao({}, form({ imovelId: im }))).toEqual({ ok: true, mensagem: "Cópia guardada." });
  });

  it("imóvel de outra organização: não encontrado, nada gravado", async () => {
    const [{ id: outra }] = await m.db.insert(organizacoes).values({ nome: "Outra organização" }).returning();
    m.sessao = await sessao(outra, "admin");
    expect(await aprovarImportacaoAcao({}, await pedido())).toEqual({ erro: "Imóvel não encontrado." });
    expect(await desfazerImportacaoAcao({}, form({ imovelId: im }))).toEqual({ erro: "Imóvel não encontrado." });
    expect(await guardarCopiaAcao({}, form({ imovelId: im }))).toEqual({ erro: "Imóvel não encontrado." });
    expect([await camada(), await copias()]).toEqual([[], []]);
  });

  it("admin aprova pela revisão aberta, desfaz e guarda cópia; as telas da importação, a ficha e a prévia são revalidadas", async () => {
    m.sessao = admin;
    const aprovou = await aprovarImportacaoAcao({}, await pedido());
    expect(aprovou).toMatchObject({ ok: true, mensagem: expect.stringContaining("Preços importados: 10 noite(s)") });
    expect(await camada()).toHaveLength(10);
    expect(m.revalidar.mock.calls.map((c) => c[0])).toEqual(["/painel/configuracoes/calendario/importar", `/painel/configuracoes/calendario/importar/${im}`, `/painel/imoveis/${im}`, "/painel/calendario/previa"]);
    // A assinatura de outra leitura: recusa com o texto da revisão.
    expect(await aprovarImportacaoAcao({}, form({ imovelId: im, assinatura: "outra", usarPrecoBase: "nao", usarEstadiaMaxima: "nao" }))).toEqual({ erro: "A leitura mudou desde que você abriu a revisão. Confira de novo." });
    expect(await guardarCopiaAcao({}, form({ imovelId: im }))).toMatchObject({ ok: true, mensagem: expect.stringContaining("Nada mudou desde a última cópia") });
    expect(await desfazerImportacaoAcao({}, form({ imovelId: im }))).toMatchObject({ ok: true, mensagem: expect.stringContaining("Importação desfeita: 10 noite(s)") });
    expect(await camada()).toEqual([]);
    expect(await copias()).toHaveLength(1);
  });
});
