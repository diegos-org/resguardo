/**
 * Configuração das reservas do site no Beds24 (M8.3a, desenho 2.3; seção 10, teste 5): a pausa geral, os imóveis
 * ligados (D6) e o registro do último ensaio conferido. Ligar um imóvel exige um ensaio conferido com a credencial
 * atual; tudo exige `configuracao:editar` e fica na auditoria. M8.3c (desenho 6.1): a hora da retomada (`retomado`), para a
 * carência. PGlite, sem rede.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AcessoNegado, type Sessao } from "@/acesso/politica";
import { gravarConfig } from "@/configuracoes/armazem";
import { auditoria, beds24ReservasOperacoes, configuracoes, imoveis, organizacoes, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { impressaoCredencialBeds24 } from "./http";
import {
  CONFIG_RESERVAS_BEDS24_PADRAO,
  configReservasBeds24,
  desligarImovelReservasBeds24,
  ensaioValeParaCredencial,
  ERRO_LIGAR_IMOVEL_INATIVO,
  ERRO_LIGAR_SEM_CREDENCIAL,
  ERRO_LIGAR_SEM_ENSAIO,
  ligacaoDoImovel,
  ligarImovelReservasBeds24,
  lerConfigReservasBeds24,
  pausarReservasBeds24,
  registrarEnsaioReservasBeds24,
  retomarReservasBeds24,
} from "./reservas-site-config";
import { chaveEnsaioBeds24 } from "./reservas-site-regras";

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
const CREDENCIAL = env({ BEDS24_REFRESH_TOKEN: "refresh-ficticio-1" });
const OUTRA_CREDENCIAL = env({ BEDS24_REFRESH_TOKEN: "refresh-ficticio-2" });
const AGORA = new Date("2026-10-16T12:00:00.000Z");

let db: Db, close: () => Promise<void>, org: string, im: string, admin: Sessao, operacao: Sessao;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "T1", nome: "Imóvel fictício" }).returning();
  const [a] = await db.insert(usuarios).values({ organizacaoId: org, email: `admin.${crypto.randomUUID().slice(0, 8)}@example.com`, nome: "Admin Fictício", papel: "admin" }).returning();
  const [o] = await db.insert(usuarios).values({ organizacaoId: org, email: `op.${crypto.randomUUID().slice(0, 8)}@example.com`, nome: "Operação Fictícia", papel: "operacao" }).returning();
  admin = { usuarioId: a.id, organizacaoId: org, papel: "admin", imovelIds: [] };
  operacao = { usuarioId: o.id, organizacaoId: org, papel: "operacao", imovelIds: [] };
});

/** Um ensaio conferido com a credencial dada (o ensaio em si é do M8.3c; aqui só a linha que ele deixa). */
async function ensaioConferido(credencial: NodeJS.ProcessEnv, o: { situacao?: "conferida" | "falhou"; modo?: "real" | "simulacao"; organizacaoId?: string } = {}) {
  const id = crypto.randomUUID();
  await db.insert(beds24ReservasOperacoes).values({
    id, organizacaoId: o.organizacaoId ?? org, tipo: "ensaio", chave: chaveEnsaioBeds24(id), modo: o.modo ?? "real", situacao: o.situacao ?? "conferida",
    credencial: impressaoCredencialBeds24(credencial), terminadoEm: new Date("2026-10-16T11:00:00Z"),
  });
  return id;
}
const auditorias = () => db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, org), eq(auditoria.acao, "configuracao.reservas_beds24")));

describe("configuração reservas_beds24 (M8.3a, teste 5)", () => {
  it("começa sem pausa, sem imóvel ligado (D6) e sem ensaio", async () => {
    expect(await lerConfigReservasBeds24(db, org)).toEqual(CONFIG_RESERVAS_BEDS24_PADRAO);
    // M8.3c: a configuração ganhou `retomado` (a hora do "Retomar", desenho 6.1), que nasce vazio como a pausa.
    expect(CONFIG_RESERVAS_BEDS24_PADRAO).toEqual({ pausado: null, retomado: null, imoveis: [], ensaio: null });
  });

  it("ligar um imóvel exige ensaio conferido com a credencial atual; trocar o token exige ensaio novo", async () => {
    expect(await ligarImovelReservasBeds24(db, admin, im, env({}), AGORA)).toEqual({ ok: false, erro: ERRO_LIGAR_SEM_CREDENCIAL });
    expect(await ligarImovelReservasBeds24(db, admin, im, CREDENCIAL, AGORA)).toEqual({ ok: false, erro: ERRO_LIGAR_SEM_ENSAIO });
    // Ensaio que não terminou conferido, ou só simulado, não vale.
    expect(await registrarEnsaioReservasBeds24(db, admin, await ensaioConferido(CREDENCIAL, { situacao: "falhou" }))).toMatchObject({ ok: false });
    expect(await registrarEnsaioReservasBeds24(db, admin, await ensaioConferido(CREDENCIAL, { modo: "simulacao" }))).toMatchObject({ ok: false });
    expect((await lerConfigReservasBeds24(db, org)).ensaio).toBeNull();

    const ensaio = await ensaioConferido(CREDENCIAL);
    expect(await registrarEnsaioReservasBeds24(db, admin, ensaio)).toEqual({ ok: true });
    expect((await lerConfigReservasBeds24(db, org)).ensaio).toEqual({ credencial: impressaoCredencialBeds24(CREDENCIAL), em: "2026-10-16T11:00:00.000Z", operacaoId: ensaio });
    // Com outra credencial (token trocado), o ensaio não vale.
    expect(await ligarImovelReservasBeds24(db, admin, im, OUTRA_CREDENCIAL, AGORA)).toEqual({ ok: false, erro: ERRO_LIGAR_SEM_ENSAIO });
    expect(await ligarImovelReservasBeds24(db, admin, im, CREDENCIAL, AGORA)).toEqual({ ok: true });
    const c = await lerConfigReservasBeds24(db, org);
    expect(ligacaoDoImovel(c, im)).toEqual({ imovelId: im, ligadoEm: AGORA.toISOString(), ligadoPor: admin.usuarioId });
    expect(ensaioValeParaCredencial(c, impressaoCredencialBeds24(OUTRA_CREDENCIAL))).toBe(false);
    expect(ensaioValeParaCredencial(c, "")).toBe(false);
    // Ligar de novo não muda a data da ligação (as reservas de antes continuam de antes).
    expect(await ligarImovelReservasBeds24(db, admin, im, CREDENCIAL, new Date("2026-10-20T00:00:00Z"))).toEqual({ ok: true });
    expect(ligacaoDoImovel(await lerConfigReservasBeds24(db, org), im)?.ligadoEm).toBe(AGORA.toISOString());
  });

  it("só imóvel e ensaio da própria organização", async () => {
    const [{ id: outraOrg }] = await db.insert(organizacoes).values({ nome: "Outra" }).returning();
    const [{ id: imOutro }] = await db.insert(imoveis).values({ organizacaoId: outraOrg, codigo: "X1", nome: "De outra" }).returning();
    expect(await registrarEnsaioReservasBeds24(db, admin, await ensaioConferido(CREDENCIAL, { organizacaoId: outraOrg }))).toMatchObject({ ok: false });
    expect(await registrarEnsaioReservasBeds24(db, admin, await ensaioConferido(CREDENCIAL))).toEqual({ ok: true });
    expect(await ligarImovelReservasBeds24(db, admin, imOutro, CREDENCIAL, AGORA)).toMatchObject({ ok: false });
    expect(await ligarImovelReservasBeds24(db, admin, "nao-e-uuid", CREDENCIAL, AGORA)).toMatchObject({ ok: false });
    expect((await lerConfigReservasBeds24(db, org)).imoveis).toEqual([]);
  });

  it("imóvel inativo: ligar é recusado (nada gravado); o que já estava ligado e foi desativado ainda desliga, com auditoria", async () => {
    await registrarEnsaioReservasBeds24(db, admin, await ensaioConferido(CREDENCIAL));
    await db.update(imoveis).set({ ativo: false }).where(eq(imoveis.id, im));
    const antes = (await auditorias()).length;
    expect(await ligarImovelReservasBeds24(db, admin, im, CREDENCIAL, AGORA)).toEqual({ ok: false, erro: ERRO_LIGAR_IMOVEL_INATIVO });
    expect((await lerConfigReservasBeds24(db, org)).imoveis).toEqual([]);
    expect((await auditorias()).length).toBe(antes);
    await db.update(imoveis).set({ ativo: true }).where(eq(imoveis.id, im));
    expect(await ligarImovelReservasBeds24(db, admin, im, CREDENCIAL, AGORA)).toEqual({ ok: true });
    await db.update(imoveis).set({ ativo: false }).where(eq(imoveis.id, im));
    expect(await desligarImovelReservasBeds24(db, admin, im)).toEqual({ ok: true });
    expect((await lerConfigReservasBeds24(db, org)).imoveis).toEqual([]);
    expect((await auditorias()).length).toBe(antes + 2);
  });

  it("desligar tira o imóvel da lista; desligar o que não está ligado avisa", async () => {
    await registrarEnsaioReservasBeds24(db, admin, await ensaioConferido(CREDENCIAL));
    await ligarImovelReservasBeds24(db, admin, im, CREDENCIAL, AGORA);
    expect(await desligarImovelReservasBeds24(db, admin, im)).toEqual({ ok: true });
    expect((await lerConfigReservasBeds24(db, org)).imoveis).toEqual([]);
    expect(await desligarImovelReservasBeds24(db, admin, im)).toMatchObject({ ok: false });
  });

  it("pausa geral: grava quem e quando, vale até retomar; pausar de novo não muda a data", async () => {
    expect(await pausarReservasBeds24(db, admin, AGORA)).toEqual({ ok: true });
    expect((await lerConfigReservasBeds24(db, org)).pausado).toEqual({ em: AGORA.toISOString(), por: admin.usuarioId });
    await pausarReservasBeds24(db, admin, new Date("2026-10-17T00:00:00Z"));
    expect((await lerConfigReservasBeds24(db, org)).pausado?.em).toBe(AGORA.toISOString());
    expect(await retomarReservasBeds24(db, admin)).toEqual({ ok: true });
    expect((await lerConfigReservasBeds24(db, org)).pausado).toBeNull();
  });

  it("retomar guarda quem retomou e quando (a carência de 6.1 conta também daí); sem pausa, retomar não muda nada", async () => {
    const depois = new Date("2026-10-16T14:00:00.000Z");
    expect(await retomarReservasBeds24(db, admin, AGORA)).toEqual({ ok: true });
    expect((await lerConfigReservasBeds24(db, org)).retomado).toBeNull();
    await pausarReservasBeds24(db, admin, AGORA);
    expect(await retomarReservasBeds24(db, admin, depois)).toEqual({ ok: true });
    expect(await lerConfigReservasBeds24(db, org)).toMatchObject({ pausado: null, retomado: { em: depois.toISOString(), por: admin.usuarioId } });
    // Retomar de novo, já sem pausa, não troca a hora da retomada.
    await retomarReservasBeds24(db, admin, new Date("2026-10-16T15:00:00.000Z"));
    expect((await lerConfigReservasBeds24(db, org)).retomado?.em).toBe(depois.toISOString());
    // Pausar outra vez mantém a última retomada (a carência só conta dela depois do próximo "Retomar").
    await pausarReservasBeds24(db, admin, new Date("2026-10-16T16:00:00.000Z"));
    expect((await lerConfigReservasBeds24(db, org)).retomado?.em).toBe(depois.toISOString());
  });

  it("cada mudança fica na auditoria, com quem fez", async () => {
    await pausarReservasBeds24(db, admin, AGORA);
    await registrarEnsaioReservasBeds24(db, admin, await ensaioConferido(CREDENCIAL));
    await ligarImovelReservasBeds24(db, admin, im, CREDENCIAL, AGORA);
    await retomarReservasBeds24(db, admin);
    const a = await auditorias();
    expect(a).toHaveLength(4);
    expect(a.every((x) => x.usuarioId === admin.usuarioId)).toBe(true);
    // A primeira gravação (a pausa) cria a linha: registra também a lista de imóveis, que nasce vazia.
    const chaves = a.map((x) => Object.keys(x.mudancas as object).sort().join(","));
    // M8.3c: o retomar grava também `retomado` (quem e quando, para a carência de 6.1); antes, só `pausado`.
    expect(chaves.sort()).toEqual(["ensaio", "imoveis", "imoveis,pausado", "pausado,retomado"]);
  });

  it("exige configuracao:editar: o papel operação (e outra organização) é recusado e nada é gravado", async () => {
    await expect(pausarReservasBeds24(db, operacao, AGORA)).rejects.toBeInstanceOf(AcessoNegado);
    await expect(retomarReservasBeds24(db, operacao)).rejects.toBeInstanceOf(AcessoNegado);
    await expect(ligarImovelReservasBeds24(db, operacao, im, CREDENCIAL, AGORA)).rejects.toBeInstanceOf(AcessoNegado);
    await expect(desligarImovelReservasBeds24(db, operacao, im)).rejects.toBeInstanceOf(AcessoNegado);
    await expect(registrarEnsaioReservasBeds24(db, operacao, await ensaioConferido(CREDENCIAL))).rejects.toBeInstanceOf(AcessoNegado);
    await expect(pausarReservasBeds24(db, { ...admin, organizacaoId: "" }, AGORA)).rejects.toBeInstanceOf(AcessoNegado);
    expect(await db.select().from(configuracoes).where(and(eq(configuracoes.organizacaoId, org), eq(configuracoes.chave, "reservas_beds24")))).toEqual([]);
    expect(await auditorias()).toEqual([]);
  });

  it("valor gravado torto fica do lado seguro: imóvel desligado, sem ensaio; pausa torta conta como pausada", async () => {
    // M8.3c: `retomado: null` na comparação exata (o campo novo; torto ou ausente, nada).
    expect(configReservasBeds24({ pausado: true, imoveis: [{ imovelId: "x", ligadoEm: "ontem" }, { imovelId: im, ligadoEm: "sem data" }, "lixo"], ensaio: { credencial: "", em: "2026-10-16", operacaoId: "x" } })).toEqual({ pausado: { em: null, por: null }, retomado: null, imoveis: [], ensaio: null });
    // A retomada sem data legível não conta (a carência não é estendida por um palpite); com a data, quem retomou só se for um id válido.
    expect(configReservasBeds24({ retomado: { em: "ontem", por: admin.usuarioId } }).retomado).toBeNull();
    expect(configReservasBeds24({ retomado: true }).retomado).toBeNull();
    expect(configReservasBeds24({ retomado: { em: "2026-10-16T12:00:00Z", por: "x" } }).retomado).toEqual({ em: "2026-10-16T12:00:00.000Z", por: null });
    expect(configReservasBeds24({ imoveis: [{ imovelId: im, ligadoEm: "2026-10-16T12:00:00Z" }, { imovelId: im, ligadoEm: "2026-10-18T12:00:00Z" }] }).imoveis).toEqual([{ imovelId: im, ligadoEm: "2026-10-16T12:00:00.000Z", ligadoPor: null }]);
    await db.transaction((tx) => gravarConfig(tx, org, "reservas_beds24", { pausado: "sim" }, null));
    expect((await lerConfigReservasBeds24(db, org)).pausado).toEqual({ em: null, por: null });
  });
});
