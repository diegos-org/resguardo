/**
 * Cópia datada da leitura do Beds24 (M3.11a, desenho 3.1; testes 6 e 11 da seção 5): a deduplicação pela assinatura, uma
 * cópia por quarto, imóvel sem noites sem cópia, a última cópia por imóvel, nenhum caminho do código que altera ou apaga
 * cópia e a varredura de dados pessoais nas duas tabelas novas. Os ganchos da importação (M3.3) e do envio (M3.7) estão
 * nos testes deles. PGlite, sem rede.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { beds24Calendario, beds24CalendarioCopias, imoveis, organizacoes, precosImportados, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { semDadosPessoais } from "@/pagamentos/testes";
import { assinaturaDaLeitura, contarCopias, copiarLeitura, guardarCopia, paraNoiteCopiada, ultimasCopias } from "./copias";

let db: Db, close: () => Promise<void>, org: string, im: string;
const lidoEm = new Date("2026-10-07T09:00:00Z");
const ler = (datas: string[], over: Partial<typeof beds24Calendario.$inferInsert> = {}) =>
  db.insert(beds24Calendario).values(datas.map((data) => ({ organizacaoId: org, imovelId: im, data, roomId: "20", livres: 1, preco: 45000, minimoNoites: 2, maximoNoites: 27, bloqueio: "none", observadoEm: lidoEm, ...over })));
const copias = () => db.select().from(beds24CalendarioCopias).where(eq(beds24CalendarioCopias.organizacaoId, org)).orderBy(asc(beds24CalendarioCopias.ordem));

beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Studio fictício" }).returning();
});

describe("cópia da leitura (M3.11a)", () => {
  it("copia a leitura atual do imóvel com a assinatura, o quarto, o motivo, quem e a hora da leitura mais nova", async () => {
    const [{ id: autor }] = await db.insert(usuarios).values({ organizacaoId: org, email: "equipe.copia@example.com", nome: "Equipe Fictícia", papel: "admin" }).returning();
    await ler(["2026-10-08", "2026-10-07"]);
    await db.update(beds24Calendario).set({ observadoEm: new Date("2026-10-07T10:30:00Z"), preco: 52000 }).where(eq(beds24Calendario.data, "2026-10-08"));
    const id = await copiarLeitura(db, org, im, "manual", { autorId: autor });
    const [c] = await copias();
    expect(c).toMatchObject({ id, imovelId: im, roomId: "20", motivo: "manual", autorId: autor, noites: 2, lidoEm: new Date("2026-10-07T10:30:00Z") });
    // As noites em ordem de data, só os campos da leitura.
    expect(c.dados).toEqual([
      { data: "2026-10-07", preco: 45000, minimo: 2, maximo: 27, livres: 1, bloqueio: "none" },
      { data: "2026-10-08", preco: 52000, minimo: 2, maximo: 27, livres: 1, bloqueio: "none" },
    ]);
    expect(c.assinatura).toBe(assinaturaDaLeitura("20", c.dados));
    expect(c.assinatura).toMatch(/^[0-9a-f]{64}$/);
  });

  it("deduplica pela última cópia do imóvel: a mesma leitura (lida de novo, outra hora) devolve a última; a leitura que muda, e a que volta, gravam", async () => {
    await ler(["2026-10-07", "2026-10-08"]);
    const primeira = await copiarLeitura(db, org, im, "antes_da_leitura");
    await db.update(beds24Calendario).set({ observadoEm: new Date("2026-10-08T09:00:00Z") });
    expect(await copiarLeitura(db, org, im, "antes_do_envio")).toBe(primeira);
    expect(await contarCopias(db, org, im)).toBe(1);
    await db.update(beds24Calendario).set({ preco: 46000 }).where(eq(beds24Calendario.data, "2026-10-08"));
    const segunda = await copiarLeitura(db, org, im, "antes_do_envio");
    expect(segunda).not.toBe(primeira);
    // Voltou ao que era: a última cópia é a outra, então grava de novo (a cópia registra a volta).
    await db.update(beds24Calendario).set({ preco: 45000 }).where(eq(beds24Calendario.data, "2026-10-08"));
    const terceira = await copiarLeitura(db, org, im, "manual");
    expect(new Set([primeira, segunda, terceira]).size).toBe(3);
    expect((await copias()).map((c) => c.motivo)).toEqual(["antes_da_leitura", "antes_do_envio", "manual"]);
    // Duas cópias na mesma transação (mesmo `criado_em`): a última é a de maior ordem, e a dedup a acha.
    await db.transaction(async (tx) => {
      await tx.update(beds24Calendario).set({ livres: 0 }).where(eq(beds24Calendario.data, "2026-10-07"));
      const a = await copiarLeitura(tx, org, im, "manual");
      expect(await copiarLeitura(tx, org, im, "manual")).toBe(a);
    });
    expect(await contarCopias(db, org)).toBe(4);
  });

  it("imóvel sem noites lidas não gera cópia; guardarCopia sem noites também não", async () => {
    expect(await copiarLeitura(db, org, im, "antes_da_leitura")).toBeNull();
    expect(await guardarCopia(db, org, im, { roomId: "20", noites: [], lidoEm }, "importacao", null)).toBeNull();
    expect(await contarCopias(db, org)).toBe(0);
    expect(await ultimasCopias(db, org)).toEqual(new Map());
  });

  it("uma cópia por quarto (a sobra de um vínculo anterior ou sem quarto não se perde), cada uma deduplicada no seu quarto", async () => {
    await ler(["2026-10-07"], { roomId: "21", observadoEm: new Date("2026-10-01T09:00:00Z") });
    await ler(["2026-10-08"], { roomId: null, observadoEm: new Date("2026-09-01T09:00:00Z") });
    await ler(["2026-10-09", "2026-10-10"]);
    const id = await copiarLeitura(db, org, im, "antes_da_leitura");
    const lista = await copias();
    expect(lista.map((c) => [c.roomId, c.noites])).toEqual([[null, 1], ["21", 1], ["20", 2]]);
    // Volta a cópia do quarto com a leitura mais nova.
    expect(id).toBe(lista.find((c) => c.roomId === "20")!.id);
    expect(lista.find((c) => c.roomId === null)!.assinatura).toBe(assinaturaDaLeitura(null, [{ data: "2026-10-08", preco: 45000, minimo: 2, maximo: 27, livres: 1, bloqueio: "none" }]));
    // De novo, nada muda em quarto nenhum: nada é gravado.
    expect(await copiarLeitura(db, org, im, "antes_da_leitura")).toBe(id);
    expect(await copias()).toHaveLength(3);
  });

  it("guardarCopia grava as noites dadas em ordem e a aprovação da importação acha a mesma assinatura da proposta", async () => {
    const noites = [
      { data: "2026-10-09", preco: 50000, minimo: 3, maximo: 27, livres: 1, bloqueio: "none" },
      { data: "2026-10-08", preco: 45000, minimo: 2, maximo: 27, livres: 1, bloqueio: null },
    ];
    const id = await guardarCopia(db, org, im, { roomId: "20", noites, lidoEm }, "importacao", null);
    const [c] = await copias();
    expect(c).toMatchObject({ id, motivo: "importacao", noites: 2, assinatura: assinaturaDaLeitura("20", noites) });
    expect(c.dados.map((n) => n.data)).toEqual(["2026-10-08", "2026-10-09"]);
    expect(await guardarCopia(db, org, im, { roomId: "20", noites: [...noites].reverse(), lidoEm: new Date() }, "importacao", null)).toBe(id);
  });

  it("a última cópia por imóvel (sem as noites) e a contagem, só da organização", async () => {
    const [{ id: outro }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "102", nome: "Outro fictício" }).returning();
    const [{ id: outraOrg }] = await db.insert(organizacoes).values({ nome: "Outra organização" }).returning();
    const [{ id: deFora }] = await db.insert(imoveis).values({ organizacaoId: outraOrg, codigo: "403", nome: "De fora" }).returning();
    await ler(["2026-10-07"]);
    await copiarLeitura(db, org, im, "antes_da_leitura");
    await db.update(beds24Calendario).set({ preco: 47000 });
    const ultimaDoIm = await copiarLeitura(db, org, im, "manual");
    await db.insert(beds24Calendario).values({ organizacaoId: org, imovelId: outro, data: "2026-10-07", roomId: "30", livres: 1, preco: 30000, minimoNoites: 1, maximoNoites: 27, bloqueio: "none", observadoEm: lidoEm });
    const doOutro = await copiarLeitura(db, org, outro, "antes_da_leitura");
    await db.insert(beds24Calendario).values({ organizacaoId: outraOrg, imovelId: deFora, data: "2026-10-07", roomId: "40", livres: 1, preco: 30000, minimoNoites: 1, maximoNoites: 27, bloqueio: "none", observadoEm: lidoEm });
    await copiarLeitura(db, outraOrg, deFora, "manual");

    const ultimas = await ultimasCopias(db, org);
    expect([...ultimas.keys()].sort()).toEqual([im, outro].sort());
    expect(ultimas.get(im)).toMatchObject({ id: ultimaDoIm, motivo: "manual", roomId: "20", noites: 1 });
    expect(ultimas.get(im)).not.toHaveProperty("dados");
    expect(ultimas.get(outro)?.id).toBe(doOutro);
    expect([...(await ultimasCopias(db, org, [outro])).keys()]).toEqual([outro]);
    expect(await ultimasCopias(db, org, [])).toEqual(new Map());
    expect(await contarCopias(db, org)).toBe(3);
    expect(await contarCopias(db, org, im)).toBe(2);
    expect(await contarCopias(db, outraOrg)).toBe(1);
  });

  it("assinatura: estável (ordem de entrada e hora da leitura não contam) e sensível a cada campo e ao quarto", () => {
    const a = { data: "2026-10-07", preco: 45000, minimo: 2, maximo: 27, livres: 1, bloqueio: "none" };
    const b = { data: "2026-10-08", preco: 50000, minimo: 3, maximo: 27, livres: 0, bloqueio: null };
    const base = assinaturaDaLeitura("20", [a, b]);
    expect(assinaturaDaLeitura("20", [b, a])).toBe(base);
    expect(assinaturaDaLeitura("20", [paraNoiteCopiada({ data: a.data, preco: a.preco, minimoNoites: a.minimo, maximoNoites: a.maximo, livres: a.livres, bloqueio: a.bloqueio }), b])).toBe(base);
    const mudancas = [
      { ...a, data: "2026-10-06" }, { ...a, preco: 45001 }, { ...a, preco: null }, { ...a, minimo: 1 }, { ...a, minimo: null }, { ...a, maximo: 28 },
      { ...a, livres: 2 }, { ...a, livres: null }, { ...a, bloqueio: "blackout" }, { ...a, bloqueio: null },
    ];
    const assinaturas = mudancas.map((m) => assinaturaDaLeitura("20", [m, b]));
    expect(new Set([base, ...assinaturas]).size).toBe(mudancas.length + 1);
    expect(assinaturaDaLeitura("21", [a, b])).not.toBe(base);
    expect(assinaturaDaLeitura(null, [a, b])).not.toBe(base);
    expect(assinaturaDaLeitura("20", [a])).not.toBe(base);
  });
});

/** Todo `.ts`/`.tsx` de `src/` (e das subpastas), fora os testes. */
function arquivosDoCodigo(dir = join(__dirname, "..")): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivosDoCodigo(caminho);
    return /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

describe("só inclusão (M3.11a)", () => {
  it("nenhum caminho do código altera ou apaga uma cópia (pelo Drizzle ou por SQL escrito à mão)", () => {
    const arquivos = arquivosDoCodigo();
    expect(arquivos.length).toBeGreaterThan(100);
    const mexe = /\.(?:update|delete)\(\s*beds24CalendarioCopias\b|\b(?:update|delete\s+from|truncate(?:\s+table)?)\s+"?beds24_calendario_copias\b/i;
    expect(arquivos.filter((a) => mexe.test(readFileSync(a, "utf8"))).map((a) => a.slice(join(__dirname, "..").length + 1))).toEqual([]);
    // O próprio padrão pega os jeitos de mexer (a conferência do teste); a inclusão e a leitura não contam.
    for (const linha of ["await tx.update(beds24CalendarioCopias).set({ noites: 1 })", "db.delete( beds24CalendarioCopias )", 'sql`delete from "beds24_calendario_copias"`', "truncate table beds24_calendario_copias", "UPDATE beds24_calendario_copias SET"]) expect(mexe.test(linha), linha).toBe(true);
    for (const linha of ["db.insert(beds24CalendarioCopias)", "db.select().from(beds24CalendarioCopias)"]) expect(mexe.test(linha), linha).toBe(false);
  });
});

describe("privacidade (M3.11a, teste 11)", () => {
  it("semDadosPessoais cobre as cópias e os preços importados (o canário aparece; sem ele, nada)", async () => {
    await ler(["2026-10-07"]);
    const copiaId = (await copiarLeitura(db, org, im, "manual"))!;
    await db.insert(precosImportados).values({ organizacaoId: org, imovelId: im, data: "2026-10-07", preco: 45000, minimoNoites: 2, copiaId });
    // Os canários: um texto nas noites da cópia e um valor que só existe na camada importada.
    const canarios = ["canario.copia@example.com", "987654321"];
    expect(await semDadosPessoais(db, canarios)).toEqual([]);
    await db.insert(beds24CalendarioCopias).values({ organizacaoId: org, imovelId: im, roomId: "20", motivo: "manual", lidoEm, noites: 1, assinatura: "x", dados: [{ data: "2026-10-08", preco: 1, minimo: null, maximo: null, livres: null, bloqueio: "canario.copia@example.com" }] });
    await db.update(precosImportados).set({ preco: 987654321 }).where(and(eq(precosImportados.organizacaoId, org), eq(precosImportados.data, "2026-10-07")));
    expect(await semDadosPessoais(db, canarios)).toEqual(canarios);
  });
});
