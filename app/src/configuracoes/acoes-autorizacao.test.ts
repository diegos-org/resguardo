import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcessoNegado } from "@/acesso/politica";
import { organizacoes, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { ERROS_TEXTO_AUTORIZACAO, TEXTOS_ORIGEM_AUTORIZACAO } from "@/proprietarios/autorizacao";
import { publicarAutorizacaoAcao } from "./acoes";
import { lerVersoesAutorizacao } from "./autorizacao-proprietarios";

const m = vi.hoisted(() => ({ sessao: vi.fn(), db: { atual: null as unknown }, revalidar: vi.fn() }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => m.db.atual }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidar }));
vi.mock("@/lib/datas", async (orig) => ({ ...(await orig<typeof import("@/lib/datas")>()), hojeISO: () => "2026-10-15" }));

let db: Db, close: () => Promise<void>, org: string, admin: string;
beforeEach(async () => {
  vi.clearAllMocks();
  ({ db, close } = await createTestDb());
  m.db.atual = db;
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Casa Exemplo" }).returning();
  [{ id: admin }] = await db.insert(usuarios).values({ organizacaoId: org, email: "admin@example.com", nome: "Admin", papel: "admin" }).returning();
  m.sessao.mockResolvedValue({ papel: "admin", usuarioId: admin, organizacaoId: org, imovelIds: [] });
});
afterEach(() => close());

const formulario = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};
const NOVO = "Autorizo a {empresa} a usar estes dados para analisar o cadastro (texto fictício).";
const cadastro = (o: Record<string, string> = {}) => formulario({ formulario: "cadastro", versaoBase: "1", texto: NOVO, ...o });

describe("publicar o texto de uma caixa de autorização pelo painel (M7.15)", () => {
  it("publica a versão 2 datada de hoje e revalida o painel e as páginas de Anuncie seu imóvel; de novo, igual, não cria versão", async () => {
    expect(await publicarAutorizacaoAcao({}, cadastro())).toEqual({
      ok: true,
      aviso: "Versão 2 publicada em 15/10/2026. A caixa do cadastro do marketplace já mostra o texto novo; os pedidos já recebidos continuam com o texto que guardam.",
    });
    expect(m.revalidar.mock.calls).toEqual([["/painel/configuracoes/autorizacao-proprietarios"], ["/anunciar", "layout"]]);
    expect(await lerVersoesAutorizacao(db, org, "cadastro")).toEqual([{ numero: 2, data: "2026-10-15", autorId: admin, secoes: { texto: NOVO } }]);
    expect(await publicarAutorizacaoAcao({}, cadastro({ versaoBase: "2" }))).toEqual({ ok: true, aviso: "Nada mudou no texto: a versão 2 continua valendo." });
    expect(await lerVersoesAutorizacao(db, org, "cadastro")).toHaveLength(1);
  });

  it("o texto da versão 1 sem mudança: nada é publicado", async () => {
    expect(await publicarAutorizacaoAcao({}, formulario({ formulario: "contato", versaoBase: "1", texto: TEXTOS_ORIGEM_AUTORIZACAO.contato }))).toEqual({
      ok: true,
      aviso: "Nada mudou no texto: a versão 1 continua valendo.",
    });
    expect(await lerVersoesAutorizacao(db, org, "contato")).toEqual([]);
  });

  it("texto vazio é recusado no campo, com o que foi digitado; formulário desconhecido e base malformada também; nada é gravado", async () => {
    expect(await publicarAutorizacaoAcao({}, cadastro({ texto: "   " }))).toEqual({
      mensagem: ERROS_TEXTO_AUTORIZACAO.vazio,
      erros: { texto: ERROS_TEXTO_AUTORIZACAO.vazio },
      valores: { formulario: "cadastro", versaoBase: "1", texto: "   " },
    });
    expect(await publicarAutorizacaoAcao({}, cadastro({ formulario: "termos" }))).toEqual({ mensagem: "Formulário desconhecido. Recarregue a página." });
    expect(await publicarAutorizacaoAcao({}, cadastro({ versaoBase: "x" }))).toMatchObject({ mensagem: "Recarregue a página e tente de novo." });
    // Outra pessoa publicou no meio: recusado, com a base que o formulário mostrava.
    await publicarAutorizacaoAcao({}, cadastro());
    m.revalidar.mockClear();
    const velha = await publicarAutorizacaoAcao({}, cadastro({ texto: "Outro texto fictício." }));
    expect(velha.mensagem).toBe("Enquanto você editava, a versão 2 foi publicada por outra pessoa em 15/10/2026. Recarregue a página, confira o texto atual e publique de novo.");
    expect(velha.valores).toMatchObject({ versaoBase: "1", texto: "Outro texto fictício." });
    expect(m.revalidar).not.toHaveBeenCalled();
    expect(await lerVersoesAutorizacao(db, org, "cadastro")).toHaveLength(1);
    expect(await lerVersoesAutorizacao(db, org, "contato")).toEqual([]);
  });

  it.each(["operacao", "proprietario", "limpeza"])("%s: sem configuracao:editar, a ação é negada no servidor e nada é gravado", async (papel) => {
    m.sessao.mockResolvedValue({ papel, usuarioId: admin, organizacaoId: org, imovelIds: [] });
    await expect(publicarAutorizacaoAcao({}, cadastro())).rejects.toThrow(AcessoNegado);
    expect(await lerVersoesAutorizacao(db, org, "cadastro")).toEqual([]);
    expect(m.revalidar).not.toHaveBeenCalled();
  });
});
