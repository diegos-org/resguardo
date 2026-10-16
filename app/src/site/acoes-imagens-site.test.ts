/**
 * Envio da foto da capa do site pela ação de Configurações → Site (M7.13): o caminho real do formulário, com a versão
 * pequena (`pequena`) para a prévia dos links. Sessão e `revalidatePath` falsos; o banco é o PGlite de teste, com dados
 * fictícios.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sessao } from "@/acesso/politica";
import { arquivos, organizacoes, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { LIMITE_MINIATURA } from "@/imoveis/fotos-regras";
import { ERRO_CAPA_PEQUENA, lerImagensSite } from "./imagens-site";

const m = vi.hoisted(() => ({ db: null as unknown as Db, sessao: null as unknown as Sessao, revalidar: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => m.db }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: async () => m.sessao }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidar }));

const { enviarImagemSiteAcao } = await import("./acoes-imagens-site");

// Imagens fictícias: só os primeiros bytes contam para o tipo (JPG).
const jpg = (tamanho = 32, n = 1) => Uint8Array.from({ length: tamanho }, (_, i) => [0xff, 0xd8, 0xff, 0xe0][i] ?? n);
const arquivo = (nome: string, tamanho = 32, n = 1) => new File([jpg(tamanho, n)], nome, { type: "image/jpeg" });
const formulario = (campos: Record<string, string | File>) => {
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
  const [u] = await m.db.insert(usuarios).values({ organizacaoId: org, email: `equipe${++n}@example.com`, nome: "Equipe Fictícia", papel: "admin" }).returning();
  m.sessao = { usuarioId: u.id, organizacaoId: org, papel: "admin", imovelIds: [] };
  m.revalidar.mockReset();
});
const arquivosDaOrg = () => m.db.select({ id: arquivos.id, nome: arquivos.nome, tamanho: arquivos.tamanho }).from(arquivos).where(eq(arquivos.organizacaoId, org));

describe("envio da foto da capa com a versão pequena (M7.13)", () => {
  it("capa com a versão pequena: as duas gravadas, a pequena como `capaPequena` da configuração", async () => {
    expect(await enviarImagemSiteAcao(formulario({ qual: "capa", arquivo: arquivo("capa.jpg", 64, 1), pequena: arquivo("capa-pequena.jpg", 32, 2) }))).toEqual({ ok: true });
    const imagens = await lerImagensSite(m.db, org);
    expect(imagens.capa).toBeTruthy();
    expect(imagens.capaPequena).toBeTruthy();
    const gravados = await arquivosDaOrg();
    expect(gravados.find((a) => a.id === imagens.capaPequena)).toMatchObject({ nome: "capa-pequena.jpg", tamanho: 32 });
    expect(gravados.find((a) => a.id === imagens.capa)).toMatchObject({ nome: "capa.jpg", tamanho: 64 });
    expect(m.revalidar).toHaveBeenCalledWith("/painel/configuracoes/site");
  });

  it("versão pequena acima de 512 KB: recusada antes de ler o arquivo, e nada fica gravado (nem a grande)", async () => {
    const grande = arquivo("capa.jpg");
    const pequena = arquivo("capa-pequena.jpg", LIMITE_MINIATURA + 1);
    const lerGrande = vi.spyOn(grande, "arrayBuffer");
    const lerPequena = vi.spyOn(pequena, "arrayBuffer");
    // O FormData guarda o próprio objeto File: o tamanho é conferido sem chamar `arrayBuffer`.
    const f = formulario({ qual: "capa" });
    f.set("arquivo", grande);
    f.set("pequena", pequena);
    expect(f.get("pequena")).toBe(pequena);
    expect(await enviarImagemSiteAcao(f)).toEqual({ ok: false, erro: ERRO_CAPA_PEQUENA });
    expect(lerGrande).not.toHaveBeenCalled();
    expect(lerPequena).not.toHaveBeenCalled();
    expect(await lerImagensSite(m.db, org)).toEqual({ capa: null, marca: null, capaPequena: null });
    expect(await arquivosDaOrg()).toEqual([]);
    expect(m.revalidar).not.toHaveBeenCalled();
  });

  it("versão pequena com exatamente 512 KB: aceita", async () => {
    expect(await enviarImagemSiteAcao(formulario({ qual: "capa", arquivo: arquivo("capa.jpg"), pequena: arquivo("capa-pequena.jpg", LIMITE_MINIATURA) }))).toEqual({ ok: true });
    expect((await lerImagensSite(m.db, org)).capaPequena).toBeTruthy();
  });

  it("capa sem a versão pequena (um navegador antigo): só a grande, e a configuração sem `capaPequena` (a tela pede para enviar de novo)", async () => {
    expect(await enviarImagemSiteAcao(formulario({ qual: "capa", arquivo: arquivo("capa.jpg") }))).toEqual({ ok: true });
    const imagens = await lerImagensSite(m.db, org);
    expect(imagens.capa).toBeTruthy();
    expect(imagens.capaPequena).toBeNull();
    expect(await arquivosDaOrg()).toHaveLength(1);
  });

  it("marca com uma versão pequena junto: a pequena é ignorada (só a capa tem prévia)", async () => {
    expect(await enviarImagemSiteAcao(formulario({ qual: "marca", arquivo: arquivo("marca.jpg"), pequena: arquivo("marca-pequena.jpg", LIMITE_MINIATURA + 1) }))).toEqual({ ok: true });
    const imagens = await lerImagensSite(m.db, org);
    expect(imagens.marca).toBeTruthy();
    expect(imagens.capaPequena).toBeNull();
    expect((await arquivosDaOrg()).map((a) => a.nome)).toEqual(["marca.jpg"]);
  });

  it("quem não edita as configurações não envia nada", async () => {
    m.sessao = { ...m.sessao, papel: "proprietario" };
    await expect(enviarImagemSiteAcao(formulario({ qual: "capa", arquivo: arquivo("capa.jpg"), pequena: arquivo("capa-pequena.jpg") }))).rejects.toThrow();
    expect(await arquivosDaOrg()).toEqual([]);
  });
});
