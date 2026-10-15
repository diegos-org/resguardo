import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gravarConfig, lerConfig } from "@/configuracoes/armazem";
import { arquivos, auditoria, imoveis, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import {
  adicionarLugar,
  bairrosDoSite,
  configDoBairro,
  editarLugar,
  idsDasFotosDoBairro,
  LIMITES_BAIRRO,
  lerBairro,
  lugaresDoSite,
  mesmoBairro,
  moverLugar,
  removerLugar,
  salvarTextosBairro,
  TEXTOS_BAIRRO_INICIAIS,
  tirarFotoLugar,
  trocarFotoLugar,
  validarLugar,
} from "./bairro";
import { guardarImagemSite, imagensEmUso } from "./imagens-site";

// Lugares e fotos fictícios: só os primeiros bytes contam para o tipo da imagem.
const jpg = (n = 1) => Uint8Array.from({ length: 32 }, (_, i) => [0xff, 0xd8, 0xff, 0xe0][i] ?? n);
const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const FOTO = "33333333-3333-4333-8333-333333333333";

let db: Db, close: () => Promise<void>, org: string, outraOrg: string;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }, { id: outraOrg }] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
});
afterEach(() => close());

const lugar = (nome: string, extra: Record<string, string> = {}) => ({ nome, distancia: "", frase: "", bairro: "", ...extra });
const adicionar = async (nome: string, extra: Record<string, string> = {}, o = org) => {
  const r = await adicionarLugar(db, o, lugar(nome, extra), null);
  if (!r.ok || !r.id) throw new Error(r.ok ? "sem id" : r.erro);
  return r.id;
};
const nomes = async (o = org) => (await lerBairro(db, o)).lugares.map((l) => l.nome);
const existe = async (id: string) => (await db.select({ id: arquivos.id }).from(arquivos).where(eq(arquivos.id, id))).length === 1;
const fotoDe = async (id: string) => (await lerBairro(db, org)).lugares.find((l) => l.id === id)?.fotoId ?? null;

describe("O bairro à sua porta (M7.6): leitura", () => {
  it("sem nada gravado: os textos do estudo e nenhum lugar (a seção não aparece no site)", async () => {
    expect(await lerBairro(db, org)).toEqual({ ...TEXTOS_BAIRRO_INICIAIS, lugares: [] });
    expect(await lugaresDoSite(db, org, "Leblon")).toEqual({ ...TEXTOS_BAIRRO_INICIAIS, lugares: [] });
  });

  it("tolera dado estragado: lugar sem id válido, repetido ou sem nome fica de fora; texto longo é cortado; no máximo 12", () => {
    const longo = "x".repeat(300);
    const c = configDoBairro({
      titulo: "   ",
      subtitulo: "",
      lugares: [
        { id: ID_A, nome: "  Praia   Fictícia ", distancia: 5, frase: longo, bairro: null, fotoId: "lixo" },
        { id: ID_A, nome: "Repetido" },
        { id: "nao-e-id", nome: "Sem id" },
        { id: ID_B, nome: "" },
        "texto solto",
        null,
      ],
    });
    expect(c.titulo).toBe(TEXTOS_BAIRRO_INICIAIS.titulo);
    expect(c.subtitulo).toBe("");
    // Olho nunca gravado (antes do M7.16): o de sempre; gravado em branco, continua em branco; longo, cortado.
    expect(c.olho).toBe("O bairro à sua porta");
    expect(configDoBairro({ olho: "" }).olho).toBe("");
    expect(configDoBairro({ olho: "  Perto   de casa " }).olho).toBe("Perto de casa");
    expect(configDoBairro({ olho: longo }).olho).toBe("x".repeat(LIMITES_BAIRRO.olho));
    expect(configDoBairro({ olho: 7 }).olho).toBe(TEXTOS_BAIRRO_INICIAIS.olho);
    expect(c.lugares).toEqual([{ id: ID_A, nome: "Praia Fictícia", distancia: "", frase: "x".repeat(LIMITES_BAIRRO.frase), bairro: "", fotoId: null }]);
    expect(configDoBairro({ lugares: "nada" }).lugares).toEqual([]);
    const muitos = Array.from({ length: 15 }, (_, i) => ({ id: `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`, nome: `Lugar ${i}` }));
    expect(configDoBairro({ lugares: muitos }).lugares).toHaveLength(LIMITES_BAIRRO.lugares);
  });

  it("ids das fotos para a entrega das imagens: só ids válidos", () => {
    expect(idsDasFotosDoBairro(null)).toEqual([]);
    expect(idsDasFotosDoBairro({ lugares: [{ id: ID_A, nome: "A", fotoId: FOTO }, { fotoId: "lixo" }, { fotoId: 7 }, null] })).toEqual([FOTO]);
  });
});

describe("O bairro à sua porta (M7.6): edição no painel", () => {
  it("valida com mensagens claras: nome obrigatório e limites por campo; espaços sobrando saem", () => {
    expect(validarLugar({ nome: "  ", distancia: "d".repeat(41), frase: "f".repeat(141), bairro: "b".repeat(61) })).toEqual({
      ok: false,
      erros: { nome: expect.stringContaining("nome do lugar"), distancia: "Máximo de 40 caracteres.", frase: "Máximo de 140 caracteres.", bairro: "Máximo de 60 caracteres." },
    });
    expect(validarLugar({ nome: " Café\n Fictício ", distancia: "5 min a pé", frase: 3 })).toEqual({ ok: true, dados: { nome: "Café Fictício", distancia: "5 min a pé", frase: "", bairro: "" } });
  });

  it("adiciona no fim, edita, muda a ordem e remove; tudo com histórico", async () => {
    const a = await adicionar("Praia Fictícia", { distancia: "5 min a pé", frase: "Mar aberto.", bairro: "Leblon" });
    const b = await adicionar("Café Inventado");
    const c = await adicionar("Livraria de Teste");
    expect(await nomes()).toEqual(["Praia Fictícia", "Café Inventado", "Livraria de Teste"]);
    expect((await lerBairro(db, org)).lugares[0]).toEqual({ id: a, nome: "Praia Fictícia", distancia: "5 min a pé", frase: "Mar aberto.", bairro: "Leblon", fotoId: null });

    expect(await editarLugar(db, org, b, lugar("Café Inventado", { frase: "Uma pausa." }), null)).toEqual({ ok: true, mudou: true });
    expect(await editarLugar(db, org, b, lugar("Café Inventado", { frase: "Uma pausa." }), null)).toEqual({ ok: true, mudou: false });
    expect(await editarLugar(db, org, b, lugar(""), null)).toMatchObject({ ok: false, erros: { nome: expect.any(String) } });
    expect((await lerBairro(db, org)).lugares[1].frase).toBe("Uma pausa.");

    await moverLugar(db, org, c, -1, null);
    expect(await nomes()).toEqual(["Praia Fictícia", "Livraria de Teste", "Café Inventado"]);
    await moverLugar(db, org, a, 1, null);
    expect(await nomes()).toEqual(["Livraria de Teste", "Praia Fictícia", "Café Inventado"]);
    // Na ponta, nada muda.
    expect(await moverLugar(db, org, c, -1, null)).toEqual({ ok: true, mudou: false });

    expect(await removerLugar(db, org, a, null)).toEqual({ ok: true, mudou: true });
    expect(await nomes()).toEqual(["Livraria de Teste", "Café Inventado"]);

    const historico = await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, org), eq(auditoria.acao, "configuracao.site_bairro")));
    expect(historico.length).toBeGreaterThanOrEqual(7);
  });

  it("lugar que não existe (ou é de outra organização) não é mexido", async () => {
    const deOutra = await adicionar("Lugar de Outra", {}, outraOrg);
    for (const r of [
      await editarLugar(db, org, deOutra, lugar("Invadido"), null),
      await moverLugar(db, org, deOutra, -1, null),
      await removerLugar(db, org, deOutra, null),
      await tirarFotoLugar(db, org, ID_A, null),
      await trocarFotoLugar(db, org, deOutra, { nome: "x.jpg", conteudo: jpg() }, null),
    ])
      expect(r).toEqual({ ok: false, erro: expect.stringContaining("não encontrado") });
    expect(await nomes(outraOrg)).toEqual(["Lugar de Outra"]);
    expect(await nomes()).toEqual([]);
    // A foto recusada não deixou arquivo para trás.
    expect(await db.select({ id: arquivos.id }).from(arquivos)).toHaveLength(0);
  });

  it("no máximo 12 lugares", async () => {
    for (let i = 0; i < LIMITES_BAIRRO.lugares; i++) await adicionar(`Lugar ${i + 1}`);
    expect(await adicionarLugar(db, org, lugar("Mais um"), null)).toEqual({ ok: false, erro: expect.stringContaining("No máximo 12 lugares") });
    expect(await nomes()).toHaveLength(12);
  });

  it("foto: pôr, trocar (a antiga é apagada), tirar e remover o lugar apagam o arquivo; tipo errado é recusado sem gravar nada", async () => {
    const a = await adicionar("Praia Fictícia");
    const b = await adicionar("Café Inventado");
    expect(await trocarFotoLugar(db, org, a, { nome: "praia.gif", conteudo: Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0, 0, 0, 0, 0]) }, null)).toEqual({
      ok: false,
      erro: expect.stringContaining("JPG ou PNG"),
    });
    expect(await db.select({ id: arquivos.id }).from(arquivos)).toHaveLength(0);

    expect(await trocarFotoLugar(db, org, a, { nome: "praia 1.jpg", conteudo: jpg(1) }, null)).toEqual({ ok: true, mudou: true });
    const primeira = (await fotoDe(a))!;
    expect(await existe(primeira)).toBe(true);
    expect(await imagensEmUso(db, org)).toEqual(new Set([primeira]));

    await trocarFotoLugar(db, org, a, { nome: "praia 2.jpg", conteudo: jpg(2) }, null);
    const segunda = (await fotoDe(a))!;
    expect(segunda).not.toBe(primeira);
    expect(await existe(primeira)).toBe(false);
    expect(await existe(segunda)).toBe(true);

    await trocarFotoLugar(db, org, b, { nome: "cafe.jpg", conteudo: jpg(3) }, null);
    const doCafe = (await fotoDe(b))!;
    expect(await tirarFotoLugar(db, org, b, null)).toEqual({ ok: true, mudou: true });
    expect(await fotoDe(b)).toBeNull();
    expect(await existe(doCafe)).toBe(false);

    // Editar o texto não mexe na foto.
    await editarLugar(db, org, a, lugar("Praia Renomeada"), null);
    expect(await fotoDe(a)).toBe(segunda);
    await removerLugar(db, org, a, null);
    expect(await existe(segunda)).toBe(false);
    expect(await db.select({ id: arquivos.id }).from(arquivos)).toHaveLength(0);
  });

  it("a foto que sai da seção só é apagada se nenhuma outra parte do site a usa", async () => {
    const a = await adicionar("Praia Fictícia");
    await trocarFotoLugar(db, org, a, { nome: "praia.jpg", conteudo: jpg() }, null);
    const foto = (await fotoDe(a))!;
    await gravarConfig(db, org, "site_imagens", { capa: foto }, null);
    await removerLugar(db, org, a, null);
    expect(await existe(foto)).toBe(true);
  });

  it("textos da seção: título obrigatório, olho e subtítulo podem ficar em branco; salvar não mexe nos lugares", async () => {
    await adicionar("Praia Fictícia");
    expect(await salvarTextosBairro(db, org, { olho: "o".repeat(61), titulo: " ", subtitulo: "s".repeat(201) }, null)).toEqual({
      ok: false,
      erro: "Confira os campos destacados.",
      erros: { olho: "Máximo de 60 caracteres.", titulo: "Escreva o título da seção.", subtitulo: "Máximo de 200 caracteres." },
    });
    expect(await lerBairro(db, org)).toMatchObject({ olho: TEXTOS_BAIRRO_INICIAIS.olho });
    expect(await salvarTextosBairro(db, org, { olho: "", titulo: "Perto de tudo.", subtitulo: "" }, null)).toEqual({ ok: true, mudou: true });
    expect(await lerBairro(db, org)).toMatchObject({ olho: "", titulo: "Perto de tudo.", subtitulo: "", lugares: [{ nome: "Praia Fictícia" }] });
    expect(await salvarTextosBairro(db, org, { olho: " Perto de casa ", titulo: "Perto de tudo.", subtitulo: "" }, null)).toEqual({ ok: true, mudou: true });
    expect((await lerBairro(db, org)).olho).toBe("Perto de casa");
  });

  it("o que fica gravado é só o formato limpo", async () => {
    await gravarConfig(db, org, "site_bairro", { lugares: [{ id: "lixo", nome: "Estragado" }], extra: 1 }, null);
    await adicionar("Praia Fictícia");
    const gravado = await lerConfig(db, org, "site_bairro");
    expect(Object.keys(gravado ?? {}).sort()).toEqual(["lugares", "olho", "subtitulo", "titulo"]);
    expect((gravado?.lugares as unknown[]).length).toBe(1);
  });
});

describe("O bairro à sua porta (M7.6): no site", () => {
  it("a ficha mostra os lugares sem bairro e os do bairro do imóvel (sem diferença de maiúscula ou acento), na ordem do painel", async () => {
    await adicionar("Praia Fictícia", { distancia: "5 min a pé", frase: "Mar aberto.", bairro: "leblon" });
    await adicionar("Mirante Inventado", { bairro: "São Conrado" });
    const geral = await adicionar("Café Inventado", { frase: "Uma pausa." });
    await trocarFotoLugar(db, org, geral, { nome: "cafe.jpg", conteudo: jpg() }, null);
    await salvarTextosBairro(db, org, { olho: "Perto de casa", titulo: "Perto de tudo.", subtitulo: "Sub fictício." }, null);
    const foto = `/imagens-site/${await fotoDe(geral)}`;

    expect(await lugaresDoSite(db, org, "Leblon")).toEqual({
      olho: "Perto de casa",
      titulo: "Perto de tudo.",
      subtitulo: "Sub fictício.",
      lugares: [
        { nome: "Praia Fictícia", distancia: "5 min a pé", frase: "Mar aberto.", foto: null },
        { nome: "Café Inventado", distancia: "", frase: "Uma pausa.", foto },
      ],
    });
    expect((await lugaresDoSite(db, org, " sao  conrado ")).lugares.map((l) => l.nome)).toEqual(["Mirante Inventado", "Café Inventado"]);
    // Imóvel sem bairro no cadastro: só os lugares gerais.
    expect((await lugaresDoSite(db, org, "")).lugares.map((l) => l.nome)).toEqual(["Café Inventado"]);
    // Outra organização não vê nada desta.
    expect((await lugaresDoSite(db, outraOrg, "Leblon")).lugares).toEqual([]);
    expect(mesmoBairro("Botafogo", "BOTAFOGO")).toBe(true);
    expect(mesmoBairro("Leblon", "Ipanema")).toBe(false);
  });

  it("bairros dos imóveis do site, sem repetir, para sugerir no painel", async () => {
    await db.insert(imoveis).values([
      { organizacaoId: org, codigo: "101", nome: "Fictício 1", publico: true, bairro: "Leblon" },
      { organizacaoId: org, codigo: "102", nome: "Fictício 2", publico: true, bairro: "leblon" },
      { organizacaoId: org, codigo: "103", nome: "Fictício 3", publico: true, bairro: "Ipanema" },
      { organizacaoId: org, codigo: "104", nome: "Fora do site", publico: false, bairro: "Gávea" },
      { organizacaoId: org, codigo: "105", nome: "Inativo", publico: true, ativo: false, bairro: "Lagoa" },
      { organizacaoId: org, codigo: "106", nome: "Sem bairro", publico: true },
      { organizacaoId: outraOrg, codigo: "101", nome: "De outra", publico: true, bairro: "Botafogo" },
    ]);
    expect(await bairrosDoSite(db, org)).toEqual(["Ipanema", "Leblon"]);
  });

  it("guardar uma imagem do site não a põe na seção: só a foto ligada a um lugar é usada", async () => {
    const r = await guardarImagemSite(db, org, { nome: "solta.jpg", conteudo: jpg() }, null);
    expect(r.ok).toBe(true);
    expect(await imagensEmUso(db, org)).toEqual(new Set());
  });
});
