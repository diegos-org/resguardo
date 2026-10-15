import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Sessao } from "@/acesso/politica";
import { gravarConfig } from "@/configuracoes/armazem";
import { arquivos, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { CACHE_FOTO_PUBLICA } from "@/imoveis/fotos-entrega";
import { LIMITE_FOTO, LIMITE_MINIATURA } from "@/imoveis/fotos-regras";
import { historicoDe } from "@/auditoria/auditoria";
import { cabecalhoPng } from "./icone.testing";
import { apagarImagemSite, definirImagemSite, entregarImagemSite, ERRO_CAPA_PEQUENA, guardarImagemSite, iconeDaMarcaEnviada, imagensEmUso, LIMITE_IMAGEM, lerImagensSite, tirarImagemSite } from "./imagens-site";

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
    expect(await lerImagensSite(db, org)).toEqual({ capa, marca: null, capaPequena: null });
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
    expect(await lerImagensSite(db, org)).toEqual({ capa: null, marca: imagens.marca, capaPequena: null });
    expect(await db.select({ id: arquivos.id }).from(arquivos).where(eq(arquivos.id, segunda))).toHaveLength(0);
    expect((await historicoDe(db, org, "configuracao", org)).filter((h) => h.acao === "configuracao.site_imagens")).toHaveLength(4);
  });
});

describe("versão pequena da capa, para a prévia dos links (M7.13)", () => {
  const existe = async (id: string | null) => !!id && (await db.select({ id: arquivos.id }).from(arquivos).where(eq(arquivos.id, id))).length === 1;

  it("a capa sobe com a versão pequena: as duas ficam em uso e saem para todos; trocar a capa apaga as duas anteriores", async () => {
    expect(await definirImagemSite(db, org, "capa", { nome: "praia.jpg", conteudo: jpg(1) }, null, { nome: "praia-pequena.jpg", conteudo: jpg(2) })).toEqual({ ok: true });
    const primeira = await lerImagensSite(db, org);
    expect(primeira.capaPequena).not.toBeNull();
    expect(primeira.capaPequena).not.toBe(primeira.capa);
    expect(await imagensEmUso(db, org)).toEqual(new Set([primeira.capa, primeira.capaPequena]));
    expect(await pedir(primeira.capaPequena!, null)).toEqual({ status: 200, cache: CACHE_FOTO_PUBLICA, tipo: "image/jpeg" });
    expect(await definirImagemSite(db, org, "capa", { nome: "praia-2.jpg", conteudo: jpg(3) }, null, { nome: "praia-2-pequena.jpg", conteudo: jpg(4) })).toEqual({ ok: true });
    const segunda = await lerImagensSite(db, org);
    expect(await existe(primeira.capa)).toBe(false);
    expect(await existe(primeira.capaPequena)).toBe(false);
    expect(await existe(segunda.capaPequena)).toBe(true);
    // A pequena antiga deixa de sair, mesmo com o id certo.
    expect((await pedir(primeira.capaPequena!, null)).status).toBe(404);
  });

  it("capa sem a versão pequena (como as enviadas antes): fica sem ela, e a anterior pequena sai junto", async () => {
    await definirImagemSite(db, org, "capa", { nome: "praia.jpg", conteudo: jpg(1) }, null, { nome: "p.jpg", conteudo: jpg(2) });
    const antes = await lerImagensSite(db, org);
    expect(await definirImagemSite(db, org, "capa", { nome: "praia-2.jpg", conteudo: jpg(3) }, null)).toEqual({ ok: true });
    expect((await lerImagensSite(db, org)).capaPequena).toBeNull();
    expect(await existe(antes.capaPequena)).toBe(false);
  });

  it("versão pequena grande demais ou que não é JPG/PNG: nada é gravado (nem a grande)", async () => {
    const antes = (await db.select({ id: arquivos.id }).from(arquivos)).length;
    expect(await definirImagemSite(db, org, "capa", { nome: "praia.jpg", conteudo: jpg(1) }, null, { nome: "p.jpg", conteudo: jpg(2, LIMITE_MINIATURA + 1) })).toEqual({ ok: false, erro: ERRO_CAPA_PEQUENA });
    expect(await definirImagemSite(db, org, "capa", { nome: "praia.jpg", conteudo: jpg(1) }, null, { nome: "p.gif", conteudo: Uint8Array.from([0x47, 0x49, 0x46, 0x38]) })).toEqual({ ok: false, erro: ERRO_CAPA_PEQUENA });
    expect((await db.select({ id: arquivos.id }).from(arquivos)).length).toBe(antes);
    expect(await lerImagensSite(db, org)).toEqual({ capa: null, marca: null, capaPequena: null });
  });

  it("trocar a marca não mexe na capa nem na versão pequena; tirar a capa apaga as duas", async () => {
    await definirImagemSite(db, org, "capa", { nome: "praia.jpg", conteudo: jpg(1) }, null, { nome: "p.jpg", conteudo: jpg(2) });
    const capa = await lerImagensSite(db, org);
    // A marca ignora uma versão pequena que viesse junto.
    expect(await definirImagemSite(db, org, "marca", { nome: "marca.png", conteudo: jpg(3) }, null, { nome: "x.jpg", conteudo: jpg(4) })).toEqual({ ok: true });
    const depois = await lerImagensSite(db, org);
    expect(depois).toMatchObject({ capa: capa.capa, capaPequena: capa.capaPequena });
    expect(await tirarImagemSite(db, org, "capa", null)).toEqual({ ok: true });
    expect(await lerImagensSite(db, org)).toEqual({ capa: null, marca: depois.marca, capaPequena: null });
    expect(await existe(capa.capa)).toBe(false);
    expect(await existe(capa.capaPequena)).toBe(false);
    expect(await existe(depois.marca)).toBe(true);
  });
});

describe("a marca enviada como ícone da aba (M7.18)", () => {
  const marcaAtual = async () => (await lerImagensSite(db, org)).marca;

  it("sem marca enviada, nada a conferir; PNG quadrado serve, com o lado do arquivo", async () => {
    expect(await iconeDaMarcaEnviada(db, org, null)).toBeNull();
    // Um PNG fictício bem maior que o cabeçalho: só o começo dele importa.
    const png = new Uint8Array(4096);
    png.set(cabecalhoPng(300, 300));
    expect(await definirImagemSite(db, org, "marca", { nome: "marca.png", conteudo: png }, null)).toEqual({ ok: true });
    expect(await iconeDaMarcaEnviada(db, org, await marcaAtual())).toEqual({ serve: true, lado: 300 });
  });

  it("JPG ou PNG retangular: não serve, com o motivo (o painel avisa; o site usa a marca do estudo)", async () => {
    await definirImagemSite(db, org, "marca", { nome: "marca.jpg", conteudo: jpg(3) }, null);
    expect(await iconeDaMarcaEnviada(db, org, await marcaAtual())).toEqual({ serve: false, motivo: "formato" });
    await definirImagemSite(db, org, "marca", { nome: "marca.png", conteudo: cabecalhoPng(400, 200) }, null);
    expect(await iconeDaMarcaEnviada(db, org, await marcaAtual())).toEqual({ serve: false, motivo: "quadrada", largura: 400, altura: 200 });
  });

  it("só o arquivo da própria organização: o id de outra (ou um arquivo que sumiu) não tem medidas conferíveis", async () => {
    await definirImagemSite(db, outraOrg, "marca", { nome: "marca.png", conteudo: cabecalhoPng(300, 300) }, null);
    const daOutra = (await lerImagensSite(db, outraOrg)).marca;
    expect(await iconeDaMarcaEnviada(db, outraOrg, daOutra)).toEqual({ serve: true, lado: 300 });
    expect(await iconeDaMarcaEnviada(db, org, daOutra)).toEqual({ serve: false, motivo: "medidas" });
  });
});
