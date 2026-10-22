/**
 * Aprovar e desfazer a importação dos preços do Beds24 e "Guardar uma cópia agora" (M3.11a, desenho 3.5, 3.6 e 3.1;
 * testes 7, 8 e 9 da seção 5): a releitura com o imóvel travado (fonte, vínculo, leitura vencida, assinatura), o envio em
 * curso, a cópia, o cadastro pelo caminho dele (com a validação), a camada de hoje em diante, a auditoria, a repetição e a
 * conferência igual ao Beds24 depois de aprovar. PGlite, sem rede; dados fictícios.
 */
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { MENSAGEM_ENVIO_EM_ANDAMENTO } from "@/beds24/trava";
import { auditoria, beds24Calendario, beds24CalendarioCopias, beds24Envios, idsExternos, imoveis, imoveisDetalhes, organizacoes, precosImportados, reservas, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { lerDetalhes } from "@/imoveis/detalhes";
import { somarDias } from "@/imoveis/regras-venda";
import { semDadosPessoais } from "@/pagamentos/testes";
import { aprovarImportacao, desfazerImportacao, guardarCopiaAgora, MENSAGEM_LEITURA_MUDOU, MENSAGEM_NADA_A_DESFAZER } from "./aprovacao";
import { planejarImovel } from "./envio";
import { montarRevisao } from "./importacao";
import { lerRegrasCalendario } from "./regras-config";

// A trava da importação do Beds24 vista de fora: no PGlite (uma conexão só) ela nunca está ocupada por outra sessão.
const trava = vi.hoisted(() => ({ ocupada: false }));
vi.mock("@/beds24/trava", async (orig) => {
  const real = await orig<typeof import("@/beds24/trava")>();
  return { ...real, tentarTravaBeds24: async (tx: Db, org: string) => !trava.ocupada && real.tentarTravaBeds24(tx, org) };
});

const HOJE = "2026-10-22";
// 22/10/2026 (quinta), 12:00 em São Paulo; a leitura de uma hora antes.
const agora = new Date("2026-10-22T15:00:00Z");
const lidoEm = new Date("2026-10-22T14:00:00Z");
const NOME_HOSPEDE = "Hóspede Fictício da Importação";

let db: Db, close: () => Promise<void>, org: string, im: string, autor: string;
/** 30 noites lidas do quarto 20: R$ 450 de domingo a quinta, R$ 520 na sexta e no sábado; mínimo 3; máximo 27. */
const lerBeds24 = (over: (data: string) => Partial<typeof beds24Calendario.$inferInsert> = () => ({})) =>
  db.insert(beds24Calendario).values(Array.from({ length: 30 }, (_, i) => somarDias(HOJE, i)).map((data) => {
    const dia = new Date(`${data}T00:00:00Z`).getUTCDay();
    return { organizacaoId: org, imovelId: im, data, roomId: "20", livres: 1, preco: dia === 5 || dia === 6 ? 52000 : 45000, minimoNoites: 3, maximoNoites: 27, bloqueio: "none", observadoEm: lidoEm, ...over(data) };
  }));
const revisar = async (o: Parameters<typeof montarRevisao>[4] = {}) => (await montarRevisao(db, org, im, agora, o))!;
/** Aprova o que a revisão mostra (a assinatura e as caixas dela), como a tela. */
const aprovar = async (o: { usar?: { precoBase: boolean; estadiaMaxima: boolean }; assinatura?: string; imovel?: string; organizacao?: string; quando?: Date } = {}) => {
  const r = await revisar();
  return aprovarImportacao(db, o.organizacao ?? org, o.imovel ?? im, { assinatura: o.assinatura ?? r.proposta.assinatura, usar: o.usar ?? r.usar }, autor, o.quando ?? agora);
};
const camada = () => db.select().from(precosImportados).where(eq(precosImportados.organizacaoId, org)).orderBy(asc(precosImportados.data));
const copias = () => db.select().from(beds24CalendarioCopias).where(eq(beds24CalendarioCopias.organizacaoId, org)).orderBy(asc(beds24CalendarioCopias.ordem));
const auditorias = (acao: string) => db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, org), eq(auditoria.acao, acao)));
const retrato = async () => JSON.stringify([
  await db.select().from(imoveisDetalhes).where(eq(imoveisDetalhes.organizacaoId, org)), await camada(), await copias(),
  await db.select().from(auditoria).where(eq(auditoria.organizacaoId, org)),
]);

beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  trava.ocupada = false;
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Studio fictício" }).returning();
  [{ id: autor }] = await db.insert(usuarios).values({ organizacaoId: org, email: `equipe.importa.${org.slice(0, 8)}@example.com`, nome: "Equipe Fictícia", papel: "admin" }).returning();
  await db.insert(idsExternos).values({ organizacaoId: org, imovelId: im, canal: "beds24", idExterno: "10", detalhe: "20" });
});

describe("aprovar a importação (M3.11a, 3.5)", () => {
  it("grava a cópia, o cadastro marcado (criando os detalhes), a camada de hoje em diante e a auditoria; nada de hóspede", async () => {
    await lerBeds24();
    await db.insert(reservas).values({ organizacaoId: org, imovelId: im, codigo: "SCL-TESTE11B", origem: "airbnb", estado: "confirmada", checkin: "2026-12-03", checkout: "2026-12-05", hospedeNome: NOME_HOSPEDE, fonte: "manual", idFonte: "" });
    // Sem `imoveis_detalhes`: a aprovação cria pelo caminho do cadastro.
    expect(await db.select().from(imoveisDetalhes).where(eq(imoveisDetalhes.imovelId, im))).toEqual([]);
    const r = await aprovar();
    expect(r).toEqual({ ok: true, mensagem: "Preços importados: 30 noite(s), de 22/10/2026 a 20/11/2026. No cadastro: preço base e estadia máxima. Nada foi enviado ao Beds24." });

    const [c] = await copias();
    expect(c).toMatchObject({ imovelId: im, roomId: "20", motivo: "importacao", autorId: autor, noites: 30, lidoEm, assinatura: (await revisar()).proposta.assinatura });
    expect(await lerDetalhes(db, org, im)).toMatchObject({ precoBase: 45000, estadiaMaxima: 27, fontePrecos: "scl" });
    const linhas = await camada();
    expect(linhas).toHaveLength(30);
    expect(linhas[0]).toMatchObject({ imovelId: im, data: HOJE, preco: 45000, minimoNoites: 3, copiaId: c.id, autorId: autor, criadoEm: agora });
    expect(linhas[1]).toMatchObject({ data: "2026-10-23", preco: 52000 });

    // A auditoria: o cadastro pelo histórico dele, e a importação em noites e intervalo, com a cópia.
    const h = await historicoDe(db, org, "imovel", im);
    expect(h.map((x) => x.acao).sort()).toEqual(["imovel.detalhes", "imovel.precos.importar"]);
    expect(h.find((x) => x.acao === "imovel.detalhes")!.mudancas).toMatchObject({ precoBase: [null, 45000], estadiaMaxima: [null, 27] });
    expect(h.find((x) => x.acao === "imovel.precos.importar")!.mudancas).toEqual({ "preços importados do Beds24": [null, "30 noite(s), de 2026-10-22 a 2026-11-20"], "cópia da leitura": [null, c.id] });
    expect(await semDadosPessoais(db, [], { nomes: [NOME_HOSPEDE] })).toEqual([]);
  });

  it("sem as caixas marcadas, o cadastro fica como está; os importados de antes de hoje ficam; repetir dá o mesmo", async () => {
    await lerBeds24();
    await db.insert(imoveisDetalhes).values({ imovelId: im, organizacaoId: org, precoBase: 40000, estadiaMaxima: 20 });
    // Uma importação antiga: a noite de ontem (antes de hoje) e uma de hoje em diante, que a nova substitui.
    const antiga = (await db.insert(beds24CalendarioCopias).values({ organizacaoId: org, imovelId: im, roomId: "20", motivo: "importacao", lidoEm, noites: 1, assinatura: "antiga", dados: [{ data: "2026-10-21", preco: 41000, minimo: null, maximo: 27, livres: 1, bloqueio: "none" }] }).returning())[0].id;
    await db.insert(precosImportados).values([
      { organizacaoId: org, imovelId: im, data: "2026-10-21", preco: 41000, copiaId: antiga, criadoEm: new Date("2026-10-15T12:00:00Z") },
      { organizacaoId: org, imovelId: im, data: "2026-12-31", preco: 99000, copiaId: antiga, criadoEm: new Date("2026-10-15T12:00:00Z") },
    ]);
    expect(await aprovar({ usar: { precoBase: false, estadiaMaxima: false } })).toMatchObject({ ok: true, mensagem: "Preços importados: 30 noite(s), de 22/10/2026 a 20/11/2026. Nada foi enviado ao Beds24." });
    expect(await lerDetalhes(db, org, im)).toMatchObject({ precoBase: 40000, estadiaMaxima: 20 });
    const linhas = await camada();
    expect(linhas.map((l) => l.data)).toEqual(["2026-10-21", ...Array.from({ length: 30 }, (_, i) => somarDias(HOJE, i))]);
    expect(linhas[0]).toMatchObject({ preco: 41000, copiaId: antiga });
    const [importou] = await auditorias("imovel.precos.importar");
    expect(importou.mudancas).toMatchObject({ "preços importados do Beds24": ["1 noite(s), de 2026-12-31 a 2026-12-31", "30 noite(s), de 2026-10-22 a 2026-11-20"] });
    expect(await auditorias("imovel.detalhes")).toEqual([]);

    // A mesma leitura de novo (mais tarde, no mesmo dia): nada muda, nem a auditoria.
    const antes = await retrato();
    expect(await aprovar({ usar: { precoBase: false, estadiaMaxima: false }, quando: new Date("2026-10-22T18:00:00Z") })).toEqual({ ok: true, mensagem: "Nada mudou: o SCL já tem estes preços importados (30 noite(s), de 22/10/2026 a 20/11/2026)." });
    expect(await retrato()).toBe(antes);
  });

  it("depois de aprovar, o SCL calcula igual ao Beds24 em todas as noites (numa leitura sem pisos), pelo motor de verdade", async () => {
    await lerBeds24();
    expect((await aprovar()).ok).toBe(true);
    const plano = await planejarImovel(db, org, await lerRegrasCalendario(db, org), { id: im, fuso: "America/Sao_Paulo" }, agora, { inicio: HOJE, fim: somarDias(HOJE, 29) }, { paraOBeds24: true });
    const lidas = new Map((await db.select().from(beds24Calendario).where(eq(beds24Calendario.imovelId, im))).map((l) => [l.data, l]));
    expect(plano.linhas).toHaveLength(30);
    for (const l of plano.linhas) expect([l.data, l.fontePreco, l.precoEnviar, l.minimoEnviar, l.maximoEnviar]).toEqual([l.data, "importado", lidas.get(l.data)!.preco, 3, 27]);
    expect(plano.linhas.every((l) => l.acao === "igual")).toBe(true);
    expect(plano.linhas[0].motivoPreco).toBe("Preço importado do Beds24 em 22/10/2026");
    // A revisão aberta de novo: igual em todas, e as caixas já desmarcadas (o cadastro tem os valores).
    expect(await revisar()).toMatchObject({ usar: { precoBase: false, estadiaMaxima: false }, conferencia: { iguais: 30, total: 30 } });
  });

  it("recusas com o imóvel travado: fonte diferente de scl, sem vínculo, leitura vencida, assinatura diferente; nada é gravado", async () => {
    await lerBeds24();
    await db.insert(imoveisDetalhes).values({ imovelId: im, organizacaoId: org, fontePrecos: "beds24" });
    const r = await revisar();
    const pedido = { assinatura: r.proposta.assinatura, usar: { precoBase: true, estadiaMaxima: true } };
    const antes = await retrato();
    expect(await aprovarImportacao(db, org, im, pedido, autor, agora)).toEqual({ ok: false, erro: "A importação vale para preços automáticos do SCL. Mude a fonte na ficha do imóvel." });
    expect(await retrato()).toBe(antes);
    await db.update(imoveisDetalhes).set({ fontePrecos: "manual" }).where(eq(imoveisDetalhes.imovelId, im));
    expect(await aprovarImportacao(db, org, im, pedido, autor, agora)).toMatchObject({ ok: false, erro: expect.stringContaining("preços automáticos do SCL") });
    await db.update(imoveisDetalhes).set({ fontePrecos: "scl" }).where(eq(imoveisDetalhes.imovelId, im));
    const antesScl = await retrato();
    // A leitura de uma noite com mais de 36 horas (a validade do site) vence a aprovação.
    await db.update(beds24Calendario).set({ observadoEm: new Date("2026-10-21T02:00:00Z") }).where(and(eq(beds24Calendario.imovelId, im), eq(beds24Calendario.data, "2026-11-01")));
    expect(await aprovarImportacao(db, org, im, pedido, autor, agora)).toEqual({ ok: false, erro: "A leitura do Beds24 tem mais de 36 horas. Leia de novo em Configurações → Integrações → Importar agora, e volte aqui." });
    await db.update(beds24Calendario).set({ observadoEm: lidoEm }).where(eq(beds24Calendario.imovelId, im));
    // A leitura mudou numa noite depois de a revisão abrir: a assinatura revisada não vale mais.
    await db.update(beds24Calendario).set({ preco: 47000 }).where(and(eq(beds24Calendario.imovelId, im), eq(beds24Calendario.data, "2026-11-02")));
    expect(await aprovarImportacao(db, org, im, pedido, autor, agora)).toEqual({ ok: false, erro: MENSAGEM_LEITURA_MUDOU });
    await db.update(beds24Calendario).set({ preco: 45000 }).where(and(eq(beds24Calendario.imovelId, im), eq(beds24Calendario.data, "2026-11-02")));
    await db.delete(idsExternos).where(eq(idsExternos.imovelId, im));
    expect(await aprovarImportacao(db, org, im, pedido, autor, agora)).toMatchObject({ ok: false, erro: expect.stringContaining("não tem um vínculo ativo e único") });
    expect(await retrato()).toBe(antesScl);
    expect(await camada()).toEqual([]);
    expect(await copias()).toEqual([]);
  });

  it("imóvel de outra organização ou id inválido: não encontrado", async () => {
    await lerBeds24();
    const [{ id: outra }] = await db.insert(organizacoes).values({ nome: "Outra organização" }).returning();
    expect(await aprovar({ organizacao: outra })).toEqual({ ok: false, erro: "Imóvel não encontrado." });
    expect(await aprovarImportacao(db, org, "nao-e-um-id", { assinatura: "x", usar: { precoBase: true, estadiaMaxima: true } }, autor, agora)).toEqual({ ok: false, erro: "Imóvel não encontrado." });
    expect(await camada()).toEqual([]);
  });

  it("envio em curso ao Beds24: recusa como a troca da fonte de preços; com o envio terminado, aprova", async () => {
    await lerBeds24();
    const [envio] = await db.insert(beds24Envios).values({ organizacaoId: org, iniciadoEm: agora, modo: "envio", situacao: "executando" }).returning({ id: beds24Envios.id });
    expect(await aprovar()).toEqual({ ok: false, erro: MENSAGEM_ENVIO_EM_ANDAMENTO });
    expect(await desfazerImportacao(db, org, im, autor, agora)).toEqual({ ok: false, erro: MENSAGEM_ENVIO_EM_ANDAMENTO });
    expect(await camada()).toEqual([]);
    await db.update(beds24Envios).set({ situacao: "ok", terminadoEm: agora }).where(eq(beds24Envios.id, envio.id));
    expect((await aprovar()).ok).toBe(true);
  });

  it("a validação do cadastro recusa a aprovação inteira: máxima proposta menor que a mínima do cadastro", async () => {
    await lerBeds24();
    await db.insert(imoveisDetalhes).values({ imovelId: im, organizacaoId: org, estadiaMinima: 30 });
    const antes = await retrato();
    expect(await aprovar({ usar: { precoBase: true, estadiaMaxima: true } })).toEqual({ ok: false, erro: "O cadastro do imóvel recusou: A máxima não pode ser menor que a mínima. Confira a ficha do imóvel e volte aqui." });
    expect(await retrato()).toBe(antes);
    // Sem a máxima marcada, passa.
    expect((await aprovar({ usar: { precoBase: true, estadiaMaxima: false } })).ok).toBe(true);
  });

  it("leitura só com noites sem preço: nada a importar, nada gravado", async () => {
    await lerBeds24(() => ({ preco: null }));
    expect(await aprovar()).toEqual({ ok: false, erro: "Nenhuma noite com preço no Beds24: nada a importar." });
    expect([await camada(), await copias()]).toEqual([[], []]);
  });
});

describe("desfazer a importação (M3.11a, 3.6)", () => {
  it("apaga só de hoje em diante, mantém as cópias e audita; sem nada de hoje em diante, recusa; outra organização, não encontrado", async () => {
    await lerBeds24();
    expect((await aprovar()).ok).toBe(true);
    const [c] = await copias();
    await db.insert(precosImportados).values({ organizacaoId: org, imovelId: im, data: "2026-10-21", preco: 41000, copiaId: c.id });
    const [{ id: outra }] = await db.insert(organizacoes).values({ nome: "Outra organização" }).returning();
    expect(await desfazerImportacao(db, outra, im, autor, agora)).toEqual({ ok: false, erro: "Imóvel não encontrado." });
    expect(await camada()).toHaveLength(31);

    expect(await desfazerImportacao(db, org, im, autor, agora)).toEqual({ ok: true, mensagem: "Importação desfeita: 30 noite(s), de 22/10/2026 a 20/11/2026 voltam ao preço base e às regras. Nada foi enviado ao Beds24." });
    expect((await camada()).map((l) => l.data)).toEqual(["2026-10-21"]);
    expect(await copias()).toHaveLength(1);
    const [desfez] = await auditorias("imovel.precos.desfazer_importacao");
    expect(desfez).toMatchObject({ usuarioId: autor, entidade: "imovel", entidadeId: im, mudancas: { "preços importados do Beds24": ["30 noite(s), de 2026-10-22 a 2026-11-20", null] } });
    // O motor volta ao preço base (o que a aprovação gravou no cadastro).
    const plano = await planejarImovel(db, org, await lerRegrasCalendario(db, org), { id: im, fuso: "America/Sao_Paulo" }, agora, { inicio: HOJE, fim: "2026-10-23" });
    expect(plano.linhas.map((l) => [l.fontePreco, l.precoReferencia])).toEqual([["base", 45000], ["base", 45000]]);

    expect(await desfazerImportacao(db, org, im, autor, agora)).toEqual({ ok: false, erro: MENSAGEM_NADA_A_DESFAZER });
    expect(await desfazerImportacao(db, org, "nao-e-um-id", autor, agora)).toEqual({ ok: false, erro: "Imóvel não encontrado." });
  });
});

describe("guardar uma cópia agora (M3.11a, 3.1)", () => {
  it("guarda a leitura (motivo manual); de novo sem mudança, diz a data da última; sem leitura, recusa; trava ocupada, recusa", async () => {
    expect(await guardarCopiaAgora(db, org, im, autor)).toEqual({ ok: false, erro: "Não há leitura do Beds24 deste imóvel para copiar." });
    await lerBeds24();
    expect(await guardarCopiaAgora(db, org, im, autor)).toEqual({ ok: true, mensagem: "Cópia guardada." });
    const [c] = await copias();
    expect(c).toMatchObject({ motivo: "manual", autorId: autor, noites: 30 });
    const r = await guardarCopiaAgora(db, org, im, autor);
    expect(r).toMatchObject({ ok: true, mensagem: expect.stringMatching(/^Nada mudou desde a última cópia, de \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}: nenhuma cópia nova\.$/) });
    expect(await copias()).toHaveLength(1);
    trava.ocupada = true;
    expect(await guardarCopiaAgora(db, org, im, autor)).toEqual({ ok: false, erro: "Há uma importação ou um envio do Beds24 em andamento. Aguarde e tente de novo." });
    trava.ocupada = false;
    const [{ id: outra }] = await db.insert(organizacoes).values({ nome: "Outra organização" }).returning();
    expect(await guardarCopiaAgora(db, outra, im, autor)).toEqual({ ok: false, erro: "Imóvel não encontrado." });
    expect(await copias()).toHaveLength(1);
  });
});
