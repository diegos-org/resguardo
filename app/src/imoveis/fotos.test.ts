import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Sessao } from "@/acesso/politica";
import { historicoDe } from "@/auditoria/auditoria";
import { arquivos, fotosImoveis, imoveis, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { CACHE_FOTO_PUBLICA, entregarFoto } from "./fotos-entrega";
import { capaDoRelatorio, conteudoDaFoto, fotosParaOSite, guardarFoto, legendarFoto, listarFotos, moverFoto, removerFoto, usarComoCapa } from "./fotos";
import { BYTES_DAS_MEDIDAS, LIMITE_FOTO, LIMITE_MINIATURA, MAXIMO_FOTOS, medidasDaImagem, medidasReduzidas, tipoDaImagem } from "./fotos-regras";
import { blocoExif, blocoJpg, jpgComMedidas, pngComMedidas } from "./fotos-testing";

// Imagens fictícias: só os primeiros bytes contam para o tipo (um número no fim para diferenciar uma da outra).
const jpg = (n = 1, tamanho = 32) => Uint8Array.from({ length: tamanho }, (_, i) => [0xff, 0xd8, 0xff, 0xe0][i] ?? n);
const png = (n = 1) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n, n, n]);

let db: Db, close: () => Promise<void>, org: string, outraOrg: string, a: string, b: string, deOutra: string;

const subir = (imovelId: string, n = 1, extra: { legenda?: string; miniatura?: Uint8Array | null; conteudo?: Uint8Array } = {}) =>
  guardarFoto(db, org, { imovelId, legenda: extra.legenda, arquivo: { nome: `IMG_${n}.HEIC.jpg`, conteudo: extra.conteudo ?? jpg(n) }, miniatura: extra.miniatura === undefined ? jpg(100 + n, 16) : extra.miniatura }, null);
const ids = async (imovelId: string) => (await listarFotos(db, org, imovelId)).map((f) => f.id);

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }, { id: outraOrg }] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
  [{ id: a }, { id: b }, { id: deOutra }] = await db
    .insert(imoveis)
    .values([
      { organizacaoId: org, codigo: "403", nome: "Quatro", publico: true },
      { organizacaoId: org, codigo: "102", nome: "Um", publico: false },
      { organizacaoId: outraOrg, codigo: "900", nome: "De outra", publico: true },
    ])
    .returning();
});
afterEach(() => close());

describe("regras das fotos (M7.3)", () => {
  it("o tipo vem dos primeiros bytes: JPG e PNG; o resto (e PNG pela metade) é recusado", () => {
    expect(tipoDaImagem(jpg())).toBe("image/jpeg");
    expect(tipoDaImagem(png())).toBe("image/png");
    expect(tipoDaImagem(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]))).toBeNull();
    expect(tipoDaImagem(new TextEncoder().encode("%PDF-1.7 ..."))).toBeNull();
    expect(tipoDaImagem(new Uint8Array())).toBeNull();
  });

  it("a redução mantém a proporção, limita o maior lado e não aumenta foto pequena", () => {
    expect(medidasReduzidas(4032, 3024, 2000)).toEqual({ largura: 2000, altura: 1500 });
    expect(medidasReduzidas(3024, 4032, 800)).toEqual({ largura: 600, altura: 800 });
    expect(medidasReduzidas(640, 480, 2000)).toEqual({ largura: 640, altura: 480 });
    expect(medidasReduzidas(0, 480, 2000)).toEqual({ largura: 0, altura: 0 });
  });
});

describe("medidas das fotos pelos primeiros bytes (M7.19)", () => {
  it("JPG comum e progressivo, PNG: largura e altura do próprio arquivo (a foto em pé tem 600 de largura, não 800)", () => {
    expect(medidasDaImagem(jpgComMedidas(2000, 1500))).toEqual({ largura: 2000, altura: 1500 });
    expect(medidasDaImagem(jpgComMedidas(600, 800, { quadro: 0xc2 }))).toEqual({ largura: 600, altura: 800 });
    expect(medidasDaImagem(pngComMedidas(1200, 800))).toEqual({ largura: 1200, altura: 800 });
  });

  it("acha as medidas depois de um perfil de cor grande e de bytes de preenchimento; a tabela de Huffman (C4) não é o quadro", () => {
    const perfil = blocoJpg(0xe2, Array.from({ length: 3200 }, (_, i) => i & 0xff));
    const huffman = blocoJpg(0xc4, [0, 1, 2, 3]);
    expect(medidasDaImagem(jpgComMedidas(800, 533, { antes: [perfil, [0xff, 0xff], huffman] }))).toEqual({ largura: 800, altura: 533 });
  });

  it("orientação da câmera de 5 a 8 troca largura e altura, nas duas ordens de bytes; um bloco XMP depois do Exif não desfaz", () => {
    expect(medidasDaImagem(jpgComMedidas(2000, 1500, { antes: [blocoExif(6)] }))).toEqual({ largura: 1500, altura: 2000 });
    expect(medidasDaImagem(jpgComMedidas(2000, 1500, { antes: [blocoExif(8, true)] }))).toEqual({ largura: 1500, altura: 2000 });
    expect(medidasDaImagem(jpgComMedidas(2000, 1500, { antes: [blocoExif(3)] }))).toEqual({ largura: 2000, altura: 1500 });
    expect(medidasDaImagem(jpgComMedidas(2000, 1500, { antes: [blocoExif(1, true)] }))).toEqual({ largura: 2000, altura: 1500 });
    const xmp = blocoJpg(0xe1, [...new TextEncoder().encode("http://ns.adobe.com/xap/1.0/"), 0, 1, 2]);
    expect(medidasDaImagem(jpgComMedidas(2000, 1500, { antes: [blocoExif(6), xmp] }))).toEqual({ largura: 1500, altura: 2000 });
  });

  it("sem as medidas no trecho lido, nada (nunca um palpite): cortado antes do quadro, dados antes do quadro, medida zero, não é imagem", () => {
    const longo = jpgComMedidas(2000, 1500, { antes: [blocoJpg(0xe2, Array.from({ length: BYTES_DAS_MEDIDAS }, () => 7))] });
    expect(medidasDaImagem(longo.subarray(0, BYTES_DAS_MEDIDAS))).toBeNull();
    expect(medidasDaImagem(longo)).toEqual({ largura: 2000, altura: 1500 });
    const semQuadro = Uint8Array.from([0xff, 0xd8, ...blocoJpg(0xe0, [0, 0]), ...blocoJpg(0xda, [1, 2, 3]), ...blocoJpg(0xc0, [8, 0, 10, 0, 10, 1])]);
    expect(medidasDaImagem(semQuadro)).toBeNull();
    expect(medidasDaImagem(jpgComMedidas(0, 1500))).toBeNull();
    expect(medidasDaImagem(jpg())).toBeNull();
    expect(medidasDaImagem(pngComMedidas(1200, 800).subarray(0, 20))).toBeNull();
    expect(medidasDaImagem(new TextEncoder().encode("GIF89a..."))).toBeNull();
    expect(medidasDaImagem(new Uint8Array())).toBeNull();
  });

  it("fotos do site com as medidas das duas versões só quando pedidas (a página da casa), lidas do começo de cada arquivo", async () => {
    // Deitada, em pé (a pequena com 600 de largura), sem versão pequena e com o começo ilegível.
    const deitada = await subir(a, 1, { conteudo: jpgComMedidas(2000, 1500), miniatura: jpgComMedidas(800, 600) });
    const emPe = await subir(a, 2, { conteudo: jpgComMedidas(1500, 2000), miniatura: jpgComMedidas(600, 800) });
    const semPequena = await subir(a, 3, { conteudo: jpgComMedidas(2000, 1500), miniatura: null });
    const ilegivel = await subir(a, 4, { conteudo: jpgComMedidas(2000, 1500), miniatura: jpg(9, 64) });
    if (!deitada.ok || !emPe.ok || !semPequena.ok || !ilegivel.ok) throw new Error("foto");
    const comMedidas = (await fotosParaOSite(db, org, [a], { medidas: true })).get(a) ?? [];
    expect(comMedidas.map((f) => f.medidas ?? null)).toEqual([
      { grande: { largura: 2000, altura: 1500 }, pequena: { largura: 800, altura: 600 } },
      { grande: { largura: 1500, altura: 2000 }, pequena: { largura: 600, altura: 800 } },
      null,
      null,
    ]);
    expect(comMedidas[0]).toMatchObject({ grande: `/fotos/${deitada.id}`, pequena: `/fotos/${deitada.id}/pequena` });
    // De novo: as medidas já lidas ficam guardadas na memória, sem ler o banco outra vez. Para conferir, o começo dos
    // arquivos no banco vira bytes ilegíveis (o sistema nunca troca o conteúdo de um arquivo; aqui, à mão), e as medidas
    // continuam as mesmas.
    await db.update(arquivos).set({ conteudo: Buffer.from(jpg(7, 64)) }).where(eq(arquivos.organizacaoId, org));
    expect((await fotosParaOSite(db, org, [a], { medidas: true })).get(a)).toEqual(comMedidas);
    // Sem pedir (as listas de casas), nenhuma foto traz medidas.
    expect(((await fotosParaOSite(db, org, [a])).get(a) ?? []).some((f) => "medidas" in f)).toBe(false);
    // Outra organização não vê estas fotos.
    expect(await fotosParaOSite(db, outraOrg, [a], { medidas: true })).toEqual(new Map());
  });

  it("outra organização não lê as medidas dos arquivos desta: nem pelo banco, nem pelo que esta já leu", async () => {
    // Uma foto da outra organização apontando para arquivos desta: o sistema nunca grava assim; aqui, à mão.
    const arquivo = async (conteudo: Uint8Array) =>
      (await db.insert(arquivos).values({ organizacaoId: org, nome: "f.jpg", tipo: "image/jpeg", tamanho: conteudo.length, conteudo: Buffer.from(conteudo) }).returning())[0].id;
    const daOutra = async (arquivoId: string, miniaturaId: string) => {
      await db.delete(fotosImoveis).where(eq(fotosImoveis.imovelId, deOutra));
      await db.insert(fotosImoveis).values({ organizacaoId: outraOrg, imovelId: deOutra, arquivoId, miniaturaId, ordem: 0 });
      return ((await fotosParaOSite(db, outraOrg, [deOutra], { medidas: true })).get(deOutra) ?? []).map((f) => f.medidas ?? null);
    };
    // Arquivos que ninguém leu ainda: o banco só entrega o começo dos arquivos da própria organização.
    expect(await daOutra(await arquivo(jpgComMedidas(2000, 1500)), await arquivo(jpgComMedidas(800, 600)))).toEqual([null]);
    // Arquivos que esta organização já leu (as medidas ficam na memória): o que ela leu não vale para a outra.
    const f = await subir(a, 1, { conteudo: jpgComMedidas(2000, 1500), miniatura: jpgComMedidas(800, 600) });
    if (!f.ok) throw new Error("foto");
    expect((await fotosParaOSite(db, org, [a], { medidas: true })).get(a)?.[0]?.medidas).toEqual({ grande: { largura: 2000, altura: 1500 }, pequena: { largura: 800, altura: 600 } });
    const [lida] = await db.select().from(fotosImoveis).where(eq(fotosImoveis.id, f.id));
    await db.delete(fotosImoveis).where(eq(fotosImoveis.id, f.id));
    expect(await daOutra(lida.arquivoId, lida.miniaturaId ?? "")).toEqual([null]);
  });
});

describe("fotos dos imóveis guardadas no banco (M7.3)", () => {
  it("guarda na ordem de chegada (a primeira é a capa), com a versão pequena, e registra no histórico", async () => {
    const r1 = await subir(a, 1, { legenda: "  Sala   com vista \n para o mar " });
    const r2 = await subir(a, 2);
    expect(r1).toMatchObject({ ok: true });
    expect(r2).toMatchObject({ ok: true });
    const lista = await listarFotos(db, org, a);
    expect(lista.map((f) => [f.ordem, f.legenda, f.temMiniatura])).toEqual([
      [0, "Sala com vista para o mar", true],
      [1, "", true],
    ]);
    // Quatro arquivos: grande e pequena de cada uma, com o tipo conferido pelos bytes e o nome limpo.
    const guardados = await db.select({ nome: arquivos.nome, tipo: arquivos.tipo }).from(arquivos);
    expect(guardados).toHaveLength(4);
    expect(guardados.map((g) => g.nome).sort()).toEqual(["IMG_1-HEIC-pequena.jpg", "IMG_1-HEIC.jpg", "IMG_2-HEIC-pequena.jpg", "IMG_2-HEIC.jpg"]);
    expect(new Set(guardados.map((g) => g.tipo))).toEqual(new Set(["image/jpeg"]));
    const historico = (await historicoDe(db, org, "imovel", a)).filter((h) => h.acao === "foto_imovel.guardar");
    expect(historico).toHaveLength(2);
    // Outro imóvel tem a galeria dele.
    expect(await subir(b, 3)).toMatchObject({ ok: true });
    expect((await listarFotos(db, org, b)).map((f) => f.ordem)).toEqual([0]);
  });

  it("recusa o que não é JPG/PNG, o que passa do tamanho, versão pequena errada, imóvel de outra organização e foto além do máximo", async () => {
    expect(await subir(a, 1, { conteudo: new Uint8Array() })).toEqual({ ok: false, erro: "Escolha a foto." });
    expect(await subir(a, 1, { conteudo: new TextEncoder().encode("GIF89a...") })).toEqual({ ok: false, erro: "A foto precisa ser JPG ou PNG." });
    expect(await subir(a, 1, { conteudo: jpg(1, LIMITE_FOTO + 1) })).toMatchObject({ ok: false, erro: expect.stringContaining("2 MB") });
    expect(await subir(a, 1, { miniatura: new TextEncoder().encode("nada") })).toMatchObject({ ok: false, erro: expect.stringContaining("versão pequena") });
    expect(await subir(a, 1, { miniatura: jpg(1, LIMITE_MINIATURA + 1) })).toMatchObject({ ok: false, erro: expect.stringContaining("versão pequena") });
    expect(await subir(deOutra, 1)).toEqual({ ok: false, erro: "Imóvel não encontrado." });
    expect(await subir("nao-e-id", 1)).toEqual({ ok: false, erro: "Imóvel não encontrado." });
    expect(await db.select().from(arquivos)).toEqual([]);
    // Sem versão pequena (o navegador não conseguiu reduzir): a grande vale para tudo. PNG também serve.
    expect(await subir(a, 1, { miniatura: null, conteudo: png(1) })).toMatchObject({ ok: true });
    expect((await listarFotos(db, org, a))[0]).toMatchObject({ temMiniatura: false });
    for (let n = 2; n <= MAXIMO_FOTOS; n++) expect(await subir(a, n, { miniatura: null })).toMatchObject({ ok: true });
    expect(await subir(a, 99)).toMatchObject({ ok: false, erro: expect.stringContaining(`${MAXIMO_FOTOS} fotos`) });
  });

  it("muda de lugar, vira capa, troca a legenda e remove (com os arquivos), sempre com a ordem sem buracos", async () => {
    for (const n of [1, 2, 3, 4]) await subir(a, n, { legenda: `foto ${n}` });
    const [f1, f2, f3, f4] = await ids(a);
    expect(await moverFoto(db, org, f3, -1, null)).toEqual({ ok: true });
    expect(await ids(a)).toEqual([f1, f3, f2, f4]);
    // Nas pontas, não sai da galeria.
    expect(await moverFoto(db, org, f1, -1, null)).toEqual({ ok: true });
    expect(await moverFoto(db, org, f4, 1, null)).toEqual({ ok: true });
    expect(await ids(a)).toEqual([f1, f3, f2, f4]);
    expect(await usarComoCapa(db, org, f4, null)).toEqual({ ok: true });
    expect(await ids(a)).toEqual([f4, f1, f3, f2]);
    expect(await legendarFoto(db, org, f4, "  Varanda ao pôr do sol  ", null)).toEqual({ ok: true });
    expect((await listarFotos(db, org, a))[0].legenda).toBe("Varanda ao pôr do sol");
    // Remover a capa: a seguinte vira a capa; os dois arquivos dela saem do banco.
    const antes = (await db.select({ id: arquivos.id }).from(arquivos)).length;
    expect(await removerFoto(db, org, f4, null)).toEqual({ ok: true });
    expect(await ids(a)).toEqual([f1, f3, f2]);
    expect((await listarFotos(db, org, a)).map((f) => f.ordem)).toEqual([0, 1, 2]);
    expect((await db.select({ id: arquivos.id }).from(arquivos)).length).toBe(antes - 2);
    const acoes = (await historicoDe(db, org, "imovel", a)).map((h) => h.acao);
    for (const acao of ["foto_imovel.ordem", "foto_imovel.capa", "foto_imovel.legenda", "foto_imovel.remover"]) expect(acoes).toContain(acao);
    // De outra organização ou inexistente: não encontrada, nada muda.
    for (const fn of [() => moverFoto(db, outraOrg, f1, 1, null), () => usarComoCapa(db, outraOrg, f2, null), () => legendarFoto(db, outraOrg, f1, "x", null), () => removerFoto(db, outraOrg, f1, null), () => removerFoto(db, org, "x", null)])
      expect(await fn()).toEqual({ ok: false, erro: "Foto não encontrada." });
    expect(await ids(a)).toEqual([f1, f3, f2]);
  });

  it("o site recebe só endereço e legenda, na ordem; a rota entrega a grande ou a pequena e diz se o imóvel está no site", async () => {
    await subir(a, 1, { legenda: "Sala" });
    await subir(a, 2, { miniatura: null });
    await subir(b, 3);
    const [fa1, fa2] = await ids(a);
    const [fb] = await ids(b);
    const site = await fotosParaOSite(db, org, [a, b, deOutra]);
    expect(site.get(a)).toEqual([
      { grande: `/fotos/${fa1}`, pequena: `/fotos/${fa1}/pequena`, legenda: "Sala" },
      // Sem versão pequena, o cartão usa a grande.
      { grande: `/fotos/${fa2}`, pequena: `/fotos/${fa2}`, legenda: "" },
    ]);
    expect(site.has(deOutra)).toBe(false);
    const grande = await conteudoDaFoto(db, org, fa1, "grande");
    const pequena = await conteudoDaFoto(db, org, fa1, "pequena");
    expect(grande).toMatchObject({ tipo: "image/jpeg", imovelId: a, publica: true });
    expect(new Uint8Array(grande!.conteudo)).toEqual(jpg(1));
    expect(new Uint8Array(pequena!.conteudo)).toEqual(jpg(101, 16));
    expect(new Uint8Array((await conteudoDaFoto(db, org, fa2, "pequena"))!.conteudo)).toEqual(jpg(2));
    // Imóvel fora do site (não público, ou desativado): a foto existe, mas não é pública.
    expect(await conteudoDaFoto(db, org, fb, "grande")).toMatchObject({ publica: false, imovelId: b });
    await db.update(imoveis).set({ ativo: false }).where(eq(imoveis.id, a));
    expect(await conteudoDaFoto(db, org, fa1, "grande")).toMatchObject({ publica: false });
    // De outra organização ou endereço inválido: nada.
    expect(await conteudoDaFoto(db, outraOrg, fa1, "grande")).toBeNull();
    expect(await conteudoDaFoto(db, org, "../etc", "grande")).toBeNull();
  });

  it("a capa do relatório é a versão pequena da capa do primeiro imóvel (na ordem dada) que tem foto", async () => {
    expect(await capaDoRelatorio(db, org, [a, b])).toBeNull();
    await subir(b, 1);
    await subir(b, 2);
    expect(await capaDoRelatorio(db, org, [a, b])).toEqual(jpg(101, 16));
    await subir(a, 3, { miniatura: null });
    expect(await capaDoRelatorio(db, org, [a, b])).toEqual(jpg(3));
    const [, segunda] = await ids(b);
    await usarComoCapa(db, org, segunda, null);
    expect(await capaDoRelatorio(db, org, [b, a])).toEqual(jpg(102, 16));
    expect(await capaDoRelatorio(db, outraOrg, [a, b])).toBeNull();
  });
});

describe("quem recebe a foto (rota /fotos)", () => {
  const sessao = (papel: Sessao["papel"], organizacaoId = org, imovelIds: string[] = []): Sessao => ({ usuarioId: "u-1", organizacaoId, papel, imovelIds });
  const pedir = async (id: string, s: Sessao | null, site: string | null = org, tamanho: "grande" | "pequena" = "grande") => {
    let perguntouSessao = false;
    const r = await entregarFoto(db, id, tamanho, {
      organizacaoDoSite: site,
      sessao: async () => {
        perguntouSessao = true;
        return s;
      },
    });
    return { status: r.status, cache: r.headers.get("Cache-Control"), tipo: r.headers.get("Content-Type"), corpo: new Uint8Array(await r.arrayBuffer()), perguntouSessao };
  };

  it("foto de imóvel do site vai para qualquer um, com cache e sem olhar a sessão; a pequena também", async () => {
    await subir(a, 1);
    const [f] = await ids(a);
    const r = await pedir(f, null);
    expect(r).toMatchObject({ status: 200, cache: CACHE_FOTO_PUBLICA, tipo: "image/jpeg", perguntouSessao: false });
    expect(r.corpo).toEqual(jpg(1));
    expect((await pedir(f, null, org, "pequena")).corpo).toEqual(jpg(101, 16));
  });

  it("foto de imóvel fora do site: só a equipe e o dono do imóvel, sem cache; os outros recebem 404", async () => {
    await subir(b, 1);
    const [f] = await ids(b);
    expect(await pedir(f, null)).toMatchObject({ status: 404 });
    expect(await pedir(f, sessao("admin"))).toMatchObject({ status: 200, cache: "private, no-store" });
    expect(await pedir(f, sessao("operacao"))).toMatchObject({ status: 200 });
    expect(await pedir(f, sessao("proprietario", org, [b]))).toMatchObject({ status: 200 });
    expect(await pedir(f, sessao("proprietario", org, [a]))).toMatchObject({ status: 404 });
    expect(await pedir(f, sessao("limpeza"))).toMatchObject({ status: 404 });
    expect(await pedir(f, sessao("hospede"))).toMatchObject({ status: 404 });
    expect(await pedir(f, sessao("admin", outraOrg))).toMatchObject({ status: 404 });
    // Sem site configurado, a equipe continua vendo no painel.
    expect(await pedir(f, sessao("admin"), null)).toMatchObject({ status: 200 });
    expect(await pedir("nao-existe", sessao("admin"))).toMatchObject({ status: 404 });
  });

  it("o site de uma organização não entrega foto de outra", async () => {
    const r = await guardarFoto(db, outraOrg, { imovelId: deOutra, arquivo: { nome: "x.jpg", conteudo: jpg(7) } }, null);
    expect(r.ok).toBe(true);
    expect(await pedir(r.ok ? r.id : "", null, org)).toMatchObject({ status: 404 });
    expect(await pedir(r.ok ? r.id : "", null, outraOrg)).toMatchObject({ status: 200 });
  });
});
