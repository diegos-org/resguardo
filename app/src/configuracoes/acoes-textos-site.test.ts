/**
 * Ação "Salvar" de Configurações → Textos do site: o caminho real do formulário até o banco. O campo que o formulário não
 * manda (tela aberta antes de o campo existir, como os títulos e frases do M7.16) fica como estava; o campo mandado vazio
 * é gravado vazio. Sessão e `revalidatePath` falsos; o banco é o PGlite de teste, com dados fictícios.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AcessoNegado, type Sessao } from "@/acesso/politica";
import { organizacoes, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { CAMPOS_TEXTOS_SITE, lerTextosSite, TEXTOS_SITE_INICIAIS } from "./textos-site";

const m = vi.hoisted(() => ({
  db: null as unknown as Db,
  sessao: null as unknown as Sessao,
  revalidar: vi.fn(),
  /** Roda logo depois da próxima leitura de uma configuração (uma vez só): abre a janela entre ler e gravar. */
  depoisDeLer: null as null | (() => Promise<void>),
}));
vi.mock("./armazem", async (original) => {
  const real = await original<typeof import("./armazem")>();
  return {
    ...real,
    lerConfig: async (...args: Parameters<typeof real.lerConfig>) => {
      const valor = await real.lerConfig(...args);
      const depois = m.depoisDeLer;
      m.depoisDeLer = null;
      if (depois) await depois();
      return valor;
    },
  };
});
vi.mock("@/db/client", () => ({ getDb: () => m.db }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: async () => m.sessao }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidar, refresh: vi.fn() }));

const { salvarTextosAcao } = await import("./acoes");

/** Os campos que existiam antes do M7.16 (a tela aberta antes da publicação manda só estes). */
const NOVOS_M7_16 = ["comoReservarOlho", "comoReservarTitulo", "catalogoTitulo", "catalogoTexto", "planejarOlho", "planejarTitulo", "planejarTexto", "resumoOlho", "resumoTitulo", "resumoTexto", "contatoOlho", "contatoTitulo"] as const;

const formulario = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};
const telaAntiga = (mudar: Record<string, string> = {}) =>
  formulario({ ...Object.fromEntries(CAMPOS_TEXTOS_SITE.map((c) => c.chave).filter((k) => !(NOVOS_M7_16 as readonly string[]).includes(k)).map((k) => [k, TEXTOS_SITE_INICIAIS[k]])), ...mudar });

let close: () => Promise<void>, org: string, n = 0;
beforeAll(async () => {
  ({ db: m.db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
  [{ id: org }] = await m.db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  const [u] = await m.db.insert(usuarios).values({ organizacaoId: org, email: `equipe-textos${++n}@example.com`, nome: "Equipe Fictícia", papel: "admin" }).returning();
  m.sessao = { usuarioId: u.id, organizacaoId: org, papel: "admin", imovelIds: [] };
  m.revalidar.mockReset();
});

describe("salvar os textos do site pela ação do painel", () => {
  it("tela aberta antes do M7.16 (sem os campos novos): os títulos e frases novos ficam com o texto de hoje, e o que veio é gravado", async () => {
    expect(NOVOS_M7_16.every((k) => CAMPOS_TEXTOS_SITE.some((c) => c.chave === k))).toBe(true);
    const r = await salvarTextosAcao({}, telaAntiga({ chamada: "Chamada fictícia." }));
    expect(r).toMatchObject({ ok: true });
    const lidos = await lerTextosSite(m.db, org);
    expect(lidos.chamada).toBe("Chamada fictícia.");
    for (const k of NOVOS_M7_16) expect(lidos[k]).toBe(TEXTOS_SITE_INICIAIS[k]);
  });

  it("campo novo já editado e ausente do formulário: fica o editado (não volta ao inicial nem some)", async () => {
    await salvarTextosAcao({}, formulario({ ...TEXTOS_SITE_INICIAIS, comoReservarOlho: "Olho fictício", catalogoTexto: "Frase fictícia de Nossas casas." }));
    await salvarTextosAcao({}, telaAntiga({ chamada: "Chamada fictícia." }));
    const lidos = await lerTextosSite(m.db, org);
    expect(lidos).toMatchObject({ comoReservarOlho: "Olho fictício", catalogoTexto: "Frase fictícia de Nossas casas.", chamada: "Chamada fictícia." });
  });

  it("tela antiga salva ao mesmo tempo que outra pessoa muda um campo novo: a mudança da outra pessoa não é desfeita", async () => {
    // A outra pessoa salva logo depois de a tela antiga ler o que estava gravado. Lida dentro da trava da gravação, a
    // tela antiga só termina antes ou depois da outra, nunca no meio (a espera de 300 ms evita travar o teste).
    let outra: Promise<unknown> | null = null;
    m.depoisDeLer = async () => {
      outra = salvarTextosAcao({}, formulario({ ...TEXTOS_SITE_INICIAIS, comoReservarOlho: "Olho fictício da outra pessoa" }));
      await Promise.race([outra, new Promise((r) => setTimeout(r, 300))]);
    };
    expect(await salvarTextosAcao({}, telaAntiga({ chamada: "Chamada fictícia." }))).toMatchObject({ ok: true });
    expect(await outra).toMatchObject({ ok: true });
    expect((await lerTextosSite(m.db, org)).comoReservarOlho).toBe("Olho fictício da outra pessoa");
  });

  it("campo mandado vazio continua sendo gravado vazio (a linha some do site)", async () => {
    await salvarTextosAcao({}, formulario({ ...TEXTOS_SITE_INICIAIS, comoReservarOlho: "" }));
    expect((await lerTextosSite(m.db, org)).comoReservarOlho).toBe("");
  });

  it("quem não edita as configurações: recusado no servidor, nada é gravado", async () => {
    m.sessao = { ...m.sessao, papel: "operacao" };
    await expect(salvarTextosAcao({}, telaAntiga({ chamada: "Chamada forjada." }))).rejects.toThrow(AcessoNegado);
    expect((await lerTextosSite(m.db, org)).chamada).toBe(TEXTOS_SITE_INICIAIS.chamada);
    expect(m.revalidar).not.toHaveBeenCalled();
  });
});
