/**
 * Ação "Salvar textos" de "O bairro à sua porta" (Configurações → Textos do site, quadro do bairro): o caminho real do
 * formulário até o banco, com o olho (M7.16), o título e o subtítulo da seção. Sessão e `revalidatePath` falsos; o banco é
 * o PGlite de teste, com dados fictícios.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AcessoNegado, type Sessao } from "@/acesso/politica";
import { organizacoes, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { lerBairro, TEXTOS_BAIRRO_INICIAIS } from "./bairro";

const m = vi.hoisted(() => ({ db: null as unknown as Db, sessao: null as unknown as Sessao, revalidar: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => m.db }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: async () => m.sessao }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidar }));

const { salvarTextosBairroAcao } = await import("./acoes-bairro");

const formulario = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};

let close: () => Promise<void>, org: string, n = 0;
beforeAll(async () => {
  ({ db: m.db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
  [{ id: org }] = await m.db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  const [u] = await m.db.insert(usuarios).values({ organizacaoId: org, email: `equipe-bairro${++n}@example.com`, nome: "Equipe Fictícia", papel: "admin" }).returning();
  m.sessao = { usuarioId: u.id, organizacaoId: org, papel: "admin", imovelIds: [] };
  m.revalidar.mockReset();
});

describe("salvar os textos de O bairro à sua porta pela ação do painel", () => {
  it("grava o olho, o título e o subtítulo que o formulário manda, cada um no seu campo", async () => {
    const r = await salvarTextosBairroAcao(formulario({ olho: "Perto de casa fictício", titulo: "Título fictício do bairro.", subtitulo: "Subtítulo fictício do bairro." }));
    expect(r).toEqual({ ok: true, mudou: true });
    expect(await lerBairro(m.db, org)).toMatchObject({ olho: "Perto de casa fictício", titulo: "Título fictício do bairro.", subtitulo: "Subtítulo fictício do bairro." });
    expect(m.revalidar).toHaveBeenCalledWith("/painel/configuracoes/site");
  });

  it("olho em branco vai em branco (a linha some do site); o título e o subtítulo continuam os mandados", async () => {
    await salvarTextosBairroAcao(formulario({ olho: "Perto de casa fictício", titulo: "Título fictício do bairro.", subtitulo: "Subtítulo fictício do bairro." }));
    expect(await salvarTextosBairroAcao(formulario({ olho: "  ", titulo: "Título fictício do bairro.", subtitulo: "Subtítulo fictício do bairro." }))).toEqual({ ok: true, mudou: true });
    const lido = await lerBairro(m.db, org);
    expect(lido.olho).toBe("");
    expect(lido).toMatchObject({ titulo: "Título fictício do bairro.", subtitulo: "Subtítulo fictício do bairro." });
  });

  it("nunca salvo: vale o olho de antes do M7.16 (\"O bairro à sua porta\")", async () => {
    expect((await lerBairro(m.db, org)).olho).toBe(TEXTOS_BAIRRO_INICIAIS.olho);
    expect(TEXTOS_BAIRRO_INICIAIS.olho).toBe("O bairro à sua porta");
  });

  it("olho acima do limite: recusado com o erro no campo, e nada muda", async () => {
    const r = await salvarTextosBairroAcao(formulario({ olho: "o".repeat(61), titulo: "Título fictício do bairro.", subtitulo: "" }));
    expect(r).toMatchObject({ ok: false, erros: { olho: "Máximo de 60 caracteres." } });
    expect(await lerBairro(m.db, org)).toMatchObject({ olho: TEXTOS_BAIRRO_INICIAIS.olho, titulo: TEXTOS_BAIRRO_INICIAIS.titulo });
  });

  it("tela aberta antes do M7.16 (o formulário não manda o olho): o olho fica como estava, e o título e o subtítulo são gravados", async () => {
    await salvarTextosBairroAcao(formulario({ olho: "Perto de casa fictício", titulo: "Título fictício do bairro.", subtitulo: "" }));
    expect(await salvarTextosBairroAcao(formulario({ titulo: "Outro título fictício.", subtitulo: "Outro subtítulo fictício." }))).toEqual({ ok: true, mudou: true });
    expect(await lerBairro(m.db, org)).toMatchObject({ olho: "Perto de casa fictício", titulo: "Outro título fictício.", subtitulo: "Outro subtítulo fictício." });
  });

  it("olho nunca salvo e ausente do formulário: continua o de antes do M7.16", async () => {
    await salvarTextosBairroAcao(formulario({ titulo: "Título fictício do bairro.", subtitulo: "" }));
    expect((await lerBairro(m.db, org)).olho).toBe(TEXTOS_BAIRRO_INICIAIS.olho);
  });

  it("quem não edita as configurações: recusado no servidor, nada é gravado", async () => {
    m.sessao = { ...m.sessao, papel: "operacao" };
    await expect(salvarTextosBairroAcao(formulario({ olho: "Olho forjado", titulo: "Título forjado.", subtitulo: "" }))).rejects.toThrow(AcessoNegado);
    expect(await lerBairro(m.db, org)).toMatchObject({ olho: TEXTOS_BAIRRO_INICIAIS.olho, titulo: TEXTOS_BAIRRO_INICIAIS.titulo });
    expect(m.revalidar).not.toHaveBeenCalled();
  });
});
