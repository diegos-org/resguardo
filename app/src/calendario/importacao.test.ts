/**
 * Importação dos preços do Beds24 (M3.11a, desenho 3.3 e 3.4; teste 5 da seção 5 e a conferência da revisão): a proposta
 * pura (preço base pelo quartil, estadia máxima, noites a importar, avisos, sugestões, resumo por mês e assinatura) e a
 * revisão montada do banco (bloqueios e conferência pelo motor, sem gravar nada). PGlite, sem rede.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { gravarConfig } from "@/configuracoes/armazem";
import { beds24Calendario, beds24CalendarioCopias, beds24CalendarioEnviado, idsExternos, imoveis, imoveisDetalhes, organizacoes, precosImportados, reservas, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { somarDias } from "@/imoveis/regras-venda";
import { assinaturaDaLeitura, guardarCopia } from "./copias";
import { bloqueiosDaImportacao, type EntradaProposta, montarRevisao, type NoiteLida, proporImportacao, resumoDosImportados } from "./importacao";
import { REGRAS_CALENDARIO_PADRAO } from "./regras-config";

const HOJE = "2026-10-22";
const noite = (data: string, over: Partial<NoiteLida> = {}): NoiteLida => ({ data, roomId: "20", preco: 45000, minimoNoites: 2, maximoNoites: 27, livres: 1, bloqueio: "none", ...over });
/** `n` noites seguidas a partir de `de`, com os mesmos campos. */
const seguidas = (de: string, n: number, over: Partial<NoiteLida> = {}) => Array.from({ length: n }, (_, i) => noite(somarDias(de, i), over));
const propor = (noites: NoiteLida[], over: Partial<EntradaProposta> = {}) =>
  proporImportacao({ noites, roomId: "20", hoje: HOJE, cadastro: { precoBase: null, estadiaMinima: null, estadiaMaxima: null }, regras: REGRAS_CALENDARIO_PADRAO, ...over });
const precos = (de: string, valores: (number | null)[]) => valores.map((preco, i) => noite(somarDias(de, i), { preco }));

describe("proposta da importação (M3.11a, 3.3)", () => {
  it("preço base: o que mais aparece entre os 25% de noites mais baratas (não o mais comum de todas); empate, o menor; noite sem preço não conta", () => {
    // 12 noites com preço: o quarto mais barato são 3 (90, 100, 100) → 100. O mais comum de todas (150) não é a base.
    const p = propor(precos("2026-10-22", [150, 150, 300, 100, null, 150, 90, 150, 300, 100, 150, 300, null, 150].map((v) => (v === null ? null : v * 100))));
    expect(p.precoBase).toBe(10000);
    // Empate no quarto mais barato (90 e 100, uma vez cada): o menor.
    expect(propor(precos("2026-10-22", [150, 90, 150, 150, 100, 150, 150, 150].map((v) => v * 100))).precoBase).toBe(9000);
    // Uma noite só: ela mesma; nenhuma com preço: nenhuma base e o aviso.
    expect(propor(precos("2026-10-22", [52000])).precoBase).toBe(52000);
    const vazia = propor(precos("2026-10-22", [null, 0]));
    expect(vazia).toMatchObject({ precoBase: null, importar: [] });
    expect(vazia.avisos).toContain("Nenhuma noite com preço no Beds24: nada a importar.");
  });

  it("estadia máxima: a mais comum, com aviso se houver mais de uma; fora de 1 a 365 não entra; menor que a mínima do cadastro avisa", () => {
    const varias = propor([...seguidas("2026-10-22", 3), noite("2026-10-25", { maximoNoites: 30 }), noite("2026-10-26", { maximoNoites: 14 })]);
    expect(varias.estadiaMaxima).toBe(27);
    expect(varias.avisos).toContain("O Beds24 tem mais de uma estadia máxima (14, 27 e 30 noites). O SCL tem uma só: a proposta usa a mais comum, 27.");
    // Empate: a menor.
    expect(propor([noite("2026-10-22", { maximoNoites: 30 }), noite("2026-10-23", { maximoNoites: 20 })]).estadiaMaxima).toBe(20);
    // Uma só: sem aviso; a atual é a do cadastro, senão a de Configurações → Calendário e preços.
    const uma = propor(seguidas("2026-10-22", 3));
    expect(uma).toMatchObject({ estadiaMaxima: 27, estadiaMaximaAtual: 27, avisos: [] });
    expect(propor(seguidas("2026-10-22", 3), { cadastro: { precoBase: null, estadiaMinima: null, estadiaMaxima: 14 } }).estadiaMaximaAtual).toBe(14);
    const fora = propor([noite("2026-10-22", { maximoNoites: 0 }), noite("2026-10-23", { maximoNoites: 999 }), noite("2026-10-24", { maximoNoites: null })]);
    expect(fora.estadiaMaxima).toBeNull();
    expect(fora.avisos).toEqual(["Estadia máxima fora de 1 a 365 noites em 2 noite(s) do Beds24: não entra na proposta.", "Sem estadia máxima no Beds24: fica a que vale hoje no SCL."]);
    const curta = propor(seguidas("2026-10-22", 2, { maximoNoites: 3 }), { cadastro: { precoBase: null, estadiaMinima: 5, estadiaMaxima: null } });
    expect(curta.avisos).toContain("A estadia máxima proposta (3) é menor que a mínima do cadastro (5): confira antes de aprovar.");
  });

  it("noites a importar: toda noite com preço, com o mínimo do Beds24; sem preço, preço zero e mínimo fora de 1 a 365 viram aviso", () => {
    const p = propor([
      noite("2026-10-22", { preco: 50000, minimoNoites: 3 }), noite("2026-10-23", { preco: null }), noite("2026-10-24", { preco: 0 }),
      noite("2026-10-25", { preco: 51000, minimoNoites: null }), noite("2026-10-26", { preco: 52000, minimoNoites: 0 }), noite("2026-10-27", { preco: 53000, minimoNoites: 400 }),
    ]);
    expect(p.importar).toEqual([
      { data: "2026-10-22", preco: 50000, minimo: 3 }, { data: "2026-10-25", preco: 51000, minimo: null }, { data: "2026-10-26", preco: 52000, minimo: null }, { data: "2026-10-27", preco: 53000, minimo: null },
    ]);
    expect(p.avisosNoites).toEqual([
      { data: "2026-10-23", aviso: "Sem preço no Beds24: o SCL usaria o preço base." },
      { data: "2026-10-24", aviso: "Preço zero no Beds24: não entra; o SCL usaria o preço base." },
      { data: "2026-10-26", aviso: "Mínimo de 0 noite(s) no Beds24, fora de 1 a 365: a noite fica com o mínimo do SCL." },
      { data: "2026-10-27", aviso: "Mínimo de 400 noite(s) no Beds24, fora de 1 a 365: a noite fica com o mínimo do SCL." },
    ]);
    // A leitura usada (a que a cópia guarda) tem todas as noites, com e sem preço.
    expect(p.leitura).toHaveLength(6);
    expect([p.inicio, p.fim]).toEqual(["2026-10-22", "2026-10-27"]);
  });

  it("só o quarto vinculado e só de hoje em diante entram (na leitura, nas noites, no resumo e na assinatura); sem vínculo, nada", () => {
    const usadas = [noite("2026-10-22", { preco: 50000 }), noite("2026-10-24", { preco: 51000 })];
    const p = propor([noite("2026-10-21", { preco: 10000 }), noite("2026-10-20", { preco: 10000 }), usadas[1], noite("2026-10-23", { roomId: "21", preco: 99000 }), noite("2026-10-25", { roomId: null }), usadas[0]]);
    expect(p.importar.map((n) => n.data)).toEqual(["2026-10-22", "2026-10-24"]);
    expect(p.leitura.map((n) => n.data)).toEqual(["2026-10-22", "2026-10-24"]);
    expect(p.precoBase).toBe(50000);
    expect(p.meses).toEqual([{ mes: "2026-10", noites: 2, menorPreco: 50000, maiorPreco: 51000, minimos: [2] }]);
    expect(p.assinatura).toBe(propor(usadas).assinatura);
    const semVinculo = propor(usadas, { roomId: null });
    expect(semVinculo).toMatchObject({ leitura: [], importar: [], precoBase: null, estadiaMaxima: null, inicio: null, fim: null, avisos: [] });
  });

  it("sugestões: só num trecho de 14 noites seguidas com o mesmo preço acima da base, quando um multiplicador inteiro reproduz o preço exato", () => {
    // 10 noites na base (R$ 450) e o trecho de dezembro a R$ 720 (1,6× a base).
    const base = seguidas("2026-11-01", 10);
    const com = (trecho: NoiteLida[]) => propor([...base, ...trecho]).sugestoes;
    const sugestao = com(seguidas("2026-12-01", 14, { preco: 72000 }));
    expect(sugestao).toEqual([{
      inicio: "2026-12-01", fim: "2026-12-14", noites: 14, preco: 72000, multiplicador: 160,
      texto: "De 01/12/2026 a 14/12/2026, o preço é 1,6× a base: dá para criar um evento depois, em Configurações → Calendário e preços.",
    }]);
    // Com centésimos (R$ 450 × 1,37 = R$ 616,50).
    expect(com(seguidas("2026-12-01", 20, { preco: 61650 }))[0]).toMatchObject({ multiplicador: 137, noites: 20, texto: expect.stringContaining("1,37× a base") });
    // 13 noites, nenhum multiplicador exato (R$ 720,01), um buraco no meio, uma noite sem preço no meio, preço na base ou abaixo: nada.
    expect(com(seguidas("2026-12-01", 13, { preco: 72000 }))).toEqual([]);
    expect(com(seguidas("2026-12-01", 14, { preco: 72001 }))).toEqual([]);
    expect(com([...seguidas("2026-12-01", 7, { preco: 72000 }), ...seguidas("2026-12-09", 7, { preco: 72000 })])).toEqual([]);
    expect(com([...seguidas("2026-12-01", 7, { preco: 72000 }), noite("2026-12-08", { preco: null }), ...seguidas("2026-12-09", 7, { preco: 72000 })])).toEqual([]);
    expect(com(seguidas("2026-12-01", 14))).toEqual([]);
    expect(com(seguidas("2026-12-01", 14, { preco: 40000 }))).toEqual([]);
    // Dez vezes a base ainda sugere; acima disso, não (o evento vai até 10×).
    expect(com(seguidas("2026-12-01", 14, { preco: 450000 }))[0]).toMatchObject({ multiplicador: 1000 });
    expect(com(seguidas("2026-12-01", 14, { preco: 454500 }))).toEqual([]);
    // Dois trechos, duas sugestões, na ordem das datas.
    expect(com([...seguidas("2026-12-01", 14, { preco: 72000 }), ...seguidas("2026-12-15", 14, { preco: 90000 })]).map((s) => [s.inicio, s.multiplicador])).toEqual([["2026-12-01", 160], ["2026-12-15", 200]]);
  });

  it("resumo por mês: noites, menor e maior preço e os mínimos", () => {
    const p = propor([
      noite("2026-10-30", { preco: 50000, minimoNoites: 3 }), noite("2026-10-31", { preco: 61000, minimoNoites: 2 }),
      noite("2026-11-01", { preco: null, minimoNoites: null }), noite("2026-11-02", { preco: 45000, minimoNoites: 5 }), noite("2026-11-03", { preco: 45000, minimoNoites: 5 }),
      noite("2026-12-01", { preco: null }),
    ]);
    expect(p.meses).toEqual([
      { mes: "2026-10", noites: 2, menorPreco: 50000, maiorPreco: 61000, minimos: [2, 3] },
      { mes: "2026-11", noites: 3, menorPreco: 45000, maiorPreco: 45000, minimos: [5] },
      { mes: "2026-12", noites: 1, menorPreco: null, maiorPreco: null, minimos: [2] },
    ]);
  });

  it("assinatura: a mesma da cópia, estável (ordem de entrada) e sensível a cada campo; a entrada não muda", () => {
    const noites = [noite("2026-10-22", { preco: 50000 }), noite("2026-10-23", { bloqueio: null, livres: 0 })];
    const entrada = Object.freeze([...noites].reverse().map((n) => Object.freeze({ ...n })));
    const p = propor(entrada as NoiteLida[]);
    expect(p.assinatura).toBe(assinaturaDaLeitura("20", p.leitura));
    expect(p.assinatura).toBe(propor(noites).assinatura);
    expect(entrada.map((n) => n.data)).toEqual(["2026-10-23", "2026-10-22"]);
    const mudancas: Partial<NoiteLida>[] = [{ preco: 50001 }, { preco: null }, { minimoNoites: 3 }, { maximoNoites: 28 }, { livres: 2 }, { bloqueio: "blackout" }, { bloqueio: null }, { data: "2026-10-24" }];
    const assinaturas = mudancas.map((m) => propor([{ ...noites[0], ...m }, noites[1]]).assinatura);
    expect(new Set([p.assinatura, ...assinaturas]).size).toBe(mudancas.length + 1);
    // O quarto entra na assinatura (o mesmo dado lido de outro quarto é outra leitura).
    expect(propor(noites.map((n) => ({ ...n, roomId: "21" })), { roomId: "21" }).assinatura).not.toBe(p.assinatura);
  });

  it("bloqueios da aprovação: fonte, vínculo, leitura ausente ou vencida (com as horas da validade)", () => {
    const ok = { fontePrecos: "scl" as const, roomId: "20", noites: 30, vencida: false, validadeHoras: 36 };
    expect(bloqueiosDaImportacao(ok)).toEqual([]);
    expect(bloqueiosDaImportacao({ ...ok, fontePrecos: "beds24" }).map((b) => b.motivo)).toEqual(["fonte"]);
    expect(bloqueiosDaImportacao({ ...ok, fontePrecos: "manual", roomId: null, noites: 0 }).map((b) => b.motivo)).toEqual(["fonte", "vinculo"]);
    expect(bloqueiosDaImportacao({ ...ok, noites: 0 }).map((b) => b.motivo)).toEqual(["sem_leitura"]);
    expect(bloqueiosDaImportacao({ ...ok, vencida: true, validadeHoras: 12 })).toEqual([
      { motivo: "leitura_vencida", texto: "A leitura do Beds24 tem mais de 12 horas. Leia de novo em Configurações → Integrações → Importar agora, e volte aqui." },
    ]);
  });
});

describe("revisão da importação no banco (M3.11a, 3.4)", () => {
  let db: Db, close: () => Promise<void>, org: string, im: string;
  // 22/10/2026 (quinta), 12:00 em São Paulo; a leitura de uma hora antes.
  const agora = new Date("2026-10-22T15:00:00Z");
  const lidoEm = new Date("2026-10-22T14:00:00Z");
  /** 30 noites lidas do quarto 20: R$ 450 de domingo a quinta, R$ 520 na sexta e no sábado; mínimo 3; máximo 27. */
  const lerBeds24 = (over: (data: string) => Partial<typeof beds24Calendario.$inferInsert> = () => ({})) =>
    db.insert(beds24Calendario).values(Array.from({ length: 30 }, (_, i) => somarDias(HOJE, i)).map((data) => {
      const dia = new Date(`${data}T00:00:00Z`).getUTCDay();
      return { organizacaoId: org, imovelId: im, data, roomId: "20", livres: 1, preco: dia === 5 || dia === 6 ? 52000 : 45000, minimoNoites: 3, maximoNoites: 27, bloqueio: "none", observadoEm: lidoEm, ...over(data) };
    }));
  const retrato = async () => JSON.stringify([
    await db.select().from(imoveisDetalhes).where(eq(imoveisDetalhes.organizacaoId, org)), await db.select().from(precosImportados).where(eq(precosImportados.organizacaoId, org)),
    await db.select().from(beds24CalendarioCopias).where(eq(beds24CalendarioCopias.organizacaoId, org)), await db.select().from(beds24Calendario).where(eq(beds24Calendario.organizacaoId, org)),
    await db.select().from(beds24CalendarioEnviado).where(eq(beds24CalendarioEnviado.organizacaoId, org)),
  ]);

  beforeAll(async () => { ({ db, close } = await createTestDb()); });
  afterAll(() => close());
  beforeEach(async () => {
    [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
    [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Studio fictício" }).returning();
    await db.insert(imoveisDetalhes).values({ imovelId: im, organizacaoId: org });
    await db.insert(idsExternos).values({ organizacaoId: org, imovelId: im, canal: "beds24", idExterno: "10", detalhe: "20" });
  });

  it("numa leitura sem pisos, o SCL calcularia igual ao Beds24 em todas as noites depois de aprovar; nada é gravado", async () => {
    await lerBeds24();
    const antes = await retrato();
    const r = (await montarRevisao(db, org, im, agora))!;
    expect(r).toMatchObject({ imovel: { id: im, codigo: "403" }, hoje: HOJE, fontePrecos: "scl", roomId: "20", lidaEm: lidoEm, validadeHoras: 36, vencida: false, bloqueios: [] });
    expect(r.usar).toEqual({ precoBase: true, estadiaMaxima: true });
    expect(r.proposta).toMatchObject({ precoBase: 45000, estadiaMaxima: 27, inicio: HOJE, fim: somarDias(HOJE, 29) });
    expect(r.proposta.importar).toHaveLength(30);
    expect(r.conferencia).toMatchObject({ iguais: 30, total: 30 });
    expect(r.conferencia!.noites.every((n) => n.diferencas.length === 0 && n.motivo === "")).toBe(true);
    expect(r.conferencia!.noites[1]).toMatchObject({ data: "2026-10-23", precoBeds24: 52000, precoScl: 52000, minimoBeds24: 3, minimoScl: 3, maximoBeds24: 27, maximoScl: 27 });
    expect(await retrato()).toBe(antes);
  });

  it("a diferença aparece com o motivo do plano: o piso de última hora, o evento por cima e o mínimo de sobra", async () => {
    // 25/10 é D+3 (15%, piso R$ 350): R$ 393 no Beds24 → a referência sobe para R$ 411,77.
    await lerBeds24((data) => (data === "2026-10-25" ? { preco: 39300 } : {}));
    await db.update(imoveisDetalhes).set({ pisoUltimaHora1: 35000, pisoUltimaHora2: 30000 }).where(eq(imoveisDetalhes.imovelId, im));
    await db.transaction((tx) => gravarConfig(tx, org, "calendario_regras", { ...REGRAS_CALENDARIO_PADRAO, eventos: [{ id: im, nome: "Evento fictício", inicio: "2026-11-10", fim: "2026-11-10", multiplicador: 200, estadiaMinima: null, minimoNormalComReserva: true, todosImoveis: true, imoveis: [] }] }, null));
    // Uma reserva no SCL que entra em 3/11: 2/11 sobra sozinha (mínimo 1 em vez de 3).
    await db.insert(reservas).values({ organizacaoId: org, imovelId: im, codigo: "SCL-TESTE11A", origem: "airbnb", estado: "confirmada", checkin: "2026-11-03", checkout: "2026-11-05", hospedeNome: "Hóspede Fictício", fonte: "manual", idFonte: "" });
    const r = (await montarRevisao(db, org, im, agora))!;
    const porData = (d: string) => r.conferencia!.noites.find((n) => n.data === d)!;
    expect(porData("2026-10-25")).toMatchObject({ precoBeds24: 39300, precoScl: 41177, diferencas: ["preco"], motivo: expect.stringContaining("referência elevada para proteger o piso de R$ 350,00") });
    expect(porData("2026-10-25").motivo).toContain("Preço importado do Beds24 em 22/10/2026");
    expect(porData("2026-11-10")).toMatchObject({ precoBeds24: 45000, precoScl: 90000, diferencas: ["preco"], motivo: expect.stringContaining("Evento Evento fictício (2× a base)") });
    expect(porData("2026-11-02")).toMatchObject({ minimoBeds24: 3, minimoScl: 1, diferencas: ["minimo"], motivo: expect.stringContaining("sobra de 1 noite(s)") });
    expect(r.conferencia!.total).toBe(30);
    expect(r.conferencia!.iguais).toBe(30 - r.conferencia!.noites.filter((n) => n.diferencas.length).length);
    expect(r.conferencia!.iguais).toBeLessThan(30);
  });

  it("as caixas da tela: o preço base e a máxima do cadastro valem quando já existem, e a proposta só quando pedida", async () => {
    await lerBeds24((data) => (data === HOJE ? { preco: null } : {}));
    await db.update(imoveisDetalhes).set({ precoBase: 40000, estadiaMaxima: 20 }).where(eq(imoveisDetalhes.imovelId, im));
    const r = (await montarRevisao(db, org, im, agora))!;
    expect(r.usar).toEqual({ precoBase: false, estadiaMaxima: false });
    // Sem preço no Beds24 hoje, a noite não entra (nem o mínimo dela): o SCL usaria a base do cadastro (R$ 400) e a semana
    // normal (1); a máxima do cadastro (20) difere da do Beds24 (27) em todas as noites.
    expect(r.conferencia!.noites[0]).toMatchObject({ precoBeds24: null, precoScl: 40000, minimoBeds24: 3, minimoScl: 1, maximoScl: 20, diferencas: ["preco", "minimo", "maximo"] });
    expect(r.conferencia!.iguais).toBe(0);
    const pedida = (await montarRevisao(db, org, im, agora, { usar: { precoBase: true, estadiaMaxima: true } }))!;
    expect(pedida.usar).toEqual({ precoBase: true, estadiaMaxima: true });
    expect(pedida.conferencia!.noites[0]).toMatchObject({ precoScl: 45000, maximoScl: 27, diferencas: ["preco", "minimo"] });
    expect(pedida.conferencia!.iguais).toBe(29);
  });

  it("bloqueios: fonte diferente de scl (sem conferência), sem vínculo, sem leitura, leitura vencida; outra organização ou id inválido, nada", async () => {
    await lerBeds24();
    await db.update(imoveisDetalhes).set({ fontePrecos: "beds24" }).where(eq(imoveisDetalhes.imovelId, im));
    const fonte = (await montarRevisao(db, org, im, agora))!;
    expect(fonte.bloqueios.map((b) => b.motivo)).toEqual(["fonte"]);
    expect(fonte.conferencia).toBeNull();
    expect(fonte.proposta.importar).toHaveLength(30);
    await db.update(imoveisDetalhes).set({ fontePrecos: "scl" }).where(eq(imoveisDetalhes.imovelId, im));
    // A leitura de mais de 36 horas (a validade do site), mesmo numa noite só, vence a revisão.
    await db.update(beds24Calendario).set({ observadoEm: new Date("2026-10-21T02:59:00Z") }).where(and(eq(beds24Calendario.imovelId, im), eq(beds24Calendario.data, "2026-11-01")));
    const vencida = (await montarRevisao(db, org, im, agora))!;
    expect(vencida).toMatchObject({ vencida: true, lidaEm: lidoEm, bloqueios: [{ motivo: "leitura_vencida", texto: expect.stringContaining("mais de 36 horas") }] });
    await db.update(beds24Calendario).set({ observadoEm: new Date("2026-10-21T03:00:00Z") }).where(eq(beds24Calendario.imovelId, im));
    expect((await montarRevisao(db, org, im, agora))!.vencida).toBe(false);
    await db.delete(beds24Calendario).where(eq(beds24Calendario.imovelId, im));
    expect((await montarRevisao(db, org, im, agora))!).toMatchObject({ bloqueios: [{ motivo: "sem_leitura" }], conferencia: null, lidaEm: null });
    await db.delete(idsExternos).where(eq(idsExternos.imovelId, im));
    expect((await montarRevisao(db, org, im, agora))!).toMatchObject({ roomId: null, bloqueios: [{ motivo: "vinculo" }], conferencia: null });
    const [{ id: outra }] = await db.insert(organizacoes).values({ nome: "Outra organização" }).returning();
    expect(await montarRevisao(db, outra, im, agora)).toBeNull();
    expect(await montarRevisao(db, org, "nao-e-um-id", agora)).toBeNull();
  });

  it("noite de outro quarto (o vínculo anterior) não entra na revisão", async () => {
    await lerBeds24((data) => (data === "2026-10-30" ? { roomId: "21", preco: 99000 } : {}));
    const r = (await montarRevisao(db, org, im, agora))!;
    expect(r.proposta.leitura.map((n) => n.data)).not.toContain("2026-10-30");
    expect(r.conferencia!.total).toBe(29);
  });

  it("resumo do que já foi importado por imóvel: noites de hoje em diante, intervalo, a última importação e quem", async () => {
    const [{ id: autor }] = await db.insert(usuarios).values({ organizacaoId: org, email: "equipe.importa@example.com", nome: "Equipe Fictícia", papel: "admin" }).returning();
    const [{ id: outro }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "102", nome: "Outro fictício" }).returning();
    const copiaId = (await guardarCopia(db, org, im, { roomId: "20", noites: [{ data: HOJE, preco: 45000, minimo: 1, maximo: 27, livres: 1, bloqueio: "none" }], lidoEm }, "importacao", autor))!;
    await db.insert(precosImportados).values([
      { organizacaoId: org, imovelId: im, data: "2026-10-20", preco: 45000, copiaId, criadoEm: new Date("2026-10-19T12:00:00Z"), autorId: null },
      { organizacaoId: org, imovelId: im, data: "2026-10-22", preco: 45000, copiaId, criadoEm: new Date("2026-10-19T12:00:00Z"), autorId: null },
      { organizacaoId: org, imovelId: im, data: "2026-10-23", preco: 45000, copiaId, criadoEm: new Date("2026-10-21T12:00:00Z"), autorId: autor },
      { organizacaoId: org, imovelId: im, data: "2026-11-30", preco: 45000, copiaId, criadoEm: new Date("2026-10-21T12:00:00Z"), autorId: autor },
    ]);
    const resumo = await resumoDosImportados(db, org, HOJE);
    expect([...resumo.keys()]).toEqual([im]);
    expect(resumo.get(im)).toEqual({ noites: 3, inicio: "2026-10-22", fim: "2026-11-30", em: new Date("2026-10-21T12:00:00Z"), autorId: autor });
    expect(await resumoDosImportados(db, org, HOJE, [outro])).toEqual(new Map());
    expect(await resumoDosImportados(db, org, HOJE, [])).toEqual(new Map());
  });
});
