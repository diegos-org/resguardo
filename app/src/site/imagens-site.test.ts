import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Sessao } from "@/acesso/politica";
import { gravarConfig } from "@/configuracoes/armazem";
import { arquivos, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { CACHE_FOTO_PUBLICA } from "@/imoveis/fotos-entrega";
import { LIMITE_FOTO } from "@/imoveis/fotos-regras";
import { historicoDe } from "@/auditoria/auditoria";
import { apagarImagemSite, definirImagemSite, entregarImagemSite, guardarImagemSite, imagensEmUso, LIMITE_IMAGEM, lerImagensSite, tirarImagemSite } from "./imagens-site";

// Imagens fictícias: só os primeiros bytes contam para o tipo.
const jpg = (n = 1, tamanho = 32) => Uint8Array.from({ length: tamanho }, (_, i) => [0xff, 0xd8, 0xff, 0xe0][i] ?? n);

let db: Db, close: () => Promise<void>, org: string, outraOrg: string;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }, { id: outraOrg }] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
});
afterEach(() => close());

const guardar = async (o: string, n = 1) => {
  const r = await guardarImagemSite(db, o, { nome: `Capa ${n}.jpg`, conteudo: jpg(n) }, null);
  if (!r.ok) throw new Error(r.erro);
  return r.id;
};
const sessao = (papel: Sessao["papel"], organizacaoId = org): Sessao => ({ usuarioId: "u-1", organizacaoId, papel, imovelIds: [] });
const pedir = async (id: string, s: Sessao | null, site: string | null = org) => {
  const r = await entregarImagemSite(db, id, { organizacaoDoSite: site, sessao: async () => s });
  return { status: r.status, cache: r.headers.get("Cache-Control"), tipo: r.headers.get("Content-Type") };
};

describe("imagens do site (M7.6)", () => {
  it("guarda só JPG ou PNG até 2 MB, com nome limpo", async () => {
    expect(await guardarImagemSite(db, org, { nome: "x.gif", conteudo: Uint8Array.from([0x47, 0x49, 0x46, 0x38]) }, null)).toEqual({ ok: false, erro: expect.stringContaining("JPG") });
    expect(await guardarImagemSite(db, org, { nome: "x.jpg", conteudo: jpg(1, LIMITE_FOTO + 1) }, null)).toMatchObject({ ok: false });
    const id = await guardar(org);
    const [a] = await db.select().from(arquivos).where(eq(arquivos.id, id));
    expect(a).toMatchObject({ organizacaoId: org, nome: "Capa-1.jpg", tipo: "image/jpeg", tamanho: 32 });
  });

  it("sai para todos só a imagem que a configuração do site usa (capa, marca, fotos do bairro); o resto, nunca", async () => {
    const capa = await guardar(org, 1);
    const marca = await guardar(org, 2);
    const lugar = await guardar(org, 3);
    const solta = await guardar(org, 4);
    // Um comprovante qualquer em `arquivos`: não é imagem do site.
    const [comprovante] = await db.insert(arquivos).values({ organizacaoId: org, nome: "pix.jpg", tipo: "image/jpeg", tamanho: 4, conteudo: Buffer.from(jpg(9, 4)) }).returning();
    await gravarConfig(db, org, "site_imagens", { capa, marca: "lixo" }, null);
    await gravarConfig(db, org, "site_bairro", { lugares: [{ id: "l1", nome: "Praia", fotoId: lugar }] }, null);
    expect(await lerImagensSite(db, org)).toEqual({ capa, marca: null });
    expect(await imagensEmUso(db, org)).toEqual(new Set([capa, lugar]));
    expect(await pedir(capa, null)).toEqual({ status: 200, cache: CACHE_FOTO_PUBLICA, tipo: "image/jpeg" });
    expect(await pedir(lugar, null)).toMatchObject({ status: 200 });
    for (const id of [marca, solta, comprovante.id, "nao-e-id"]) expect((await pedir(id, sessao("admin"))).status).toBe(404);
    // Outra organização não é o site: nada sai, nem com o id certo.
    expect((await pedir(capa, null, outraOrg)).status).toBe(404);
  });

  it("prévia no painel: quem edita o site vê as imagens em uso da organização dele, sem cache; quem não edita, não", async () => {
    const capa = await guardar(outraOrg, 1);
    await gravarConfig(db, outraOrg, "site_imagens", { capa }, null);
    expect(await pedir(capa, sessao("admin", outraOrg))).toEqual({ status: 200, cache: "private, no-store", tipo: "image/jpeg" });
    expect((await pedir(capa, sessao("limpeza", outraOrg))).status).toBe(404);
    expect((await pedir(capa, sessao("admin", org))).status).toBe(404);
    expect((await pedir(capa, null)).status).toBe(404);
  });

  it("apagar remove o arquivo só da própria organização", async () => {
    const id = await guardar(org);
    await apagarImagemSite(db, outraOrg, id);
    expect(await db.select({ id: arquivos.id }).from(arquivos).where(eq(arquivos.id, id))).toHaveLength(1);
    await apagarImagemSite(db, org, id);
    expect(await db.select({ id: arquivos.id }).from(arquivos).where(eq(arquivos.id, id))).toHaveLength(0);
  });

  it("trocar a capa ou a marca grava a nova e apaga a anterior; tirar volta ao padrão; o histórico registra", async () => {
    expect(await definirImagemSite(db, org, "capa", { nome: "praia.jpg", conteudo: jpg(1) }, null)).toEqual({ ok: true });
    const primeira = (await lerImagensSite(db, org)).capa!;
    expect(await definirImagemSite(db, org, "capa", { nome: "praia-2.jpg", conteudo: jpg(2) }, null)).toEqual({ ok: true });
    const segunda = (await lerImagensSite(db, org)).capa!;
    expect(segunda).not.toBe(primeira);
    expect(await db.select({ id: arquivos.id }).from(arquivos).where(eq(arquivos.id, primeira))).toHaveLength(0);
    // A marca tem limite menor (sobe sem redução) e não mexe na capa.
    expect(await definirImagemSite(db, org, "marca", { nome: "marca.png", conteudo: jpg(3, LIMITE_IMAGEM.marca + 1) }, null)).toMatchObject({ ok: false });
    expect(await definirImagemSite(db, org, "marca", { nome: "marca.png", conteudo: jpg(3) }, null)).toEqual({ ok: true });
    const imagens = await lerImagensSite(db, org);
    expect(imagens.capa).toBe(segunda);
    expect(imagens.marca).not.toBeNull();
    expect(await tirarImagemSite(db, org, "capa", null)).toEqual({ ok: true });
    expect(await tirarImagemSite(db, org, "capa", null)).toMatchObject({ ok: false });
    expect(await lerImagensSite(db, org)).toEqual({ capa: null, marca: imagens.marca });
    expect(await db.select({ id: arquivos.id }).from(arquivos).where(eq(arquivos.id, segunda))).toHaveLength(0);
    expect((await historicoDe(db, org, "configuracao", org)).filter((h) => h.acao === "configuracao.site_imagens")).toHaveLength(4);
  });
});
