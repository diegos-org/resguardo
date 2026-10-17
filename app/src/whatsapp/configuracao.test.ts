/**
 * Configuração do WhatsApp (M10.1a): o padrão "só o admin" sem linha gravada, o valor torto do lado seguro, a WABA que
 * já é de outra empresa recusada (também em paralelo), as duas gravações lendo o atual debaixo da trava, a auditoria
 * com o autor e a organização dona da conta só quando é exatamente uma. PGlite, sem rede; só os ids fictícios das
 * páginas da Meta.
 */
import type { PGlite } from "@electric-sql/pglite";
import { and, eq, is, sql } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AcessoNegado, type Sessao } from "@/acesso/politica";
import { lerConfig, travarConfig } from "@/configuracoes/armazem";
import * as schema from "@/db/schema";
import { auditoria, configuracoes, organizacoes, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import {
  configWhatsapp,
  lerConfigWhatsapp,
  organizacaoDaConta,
  organizacaoDoNumero,
  QUEM_VE_PADRAO,
  salvarIdsWhatsapp,
  salvarQuemVeConversas,
} from "./configuracao";

// A trava e a leitura da chave são espiadas para conferir que as gravações leem o atual depois de travar, dentro da
// transação. Chamadas internas do armazém (as do `gravarConfig`) não passam pelo espião: só as de `configuracao.ts`.
vi.mock("@/configuracoes/armazem", async (orig) => {
  const m = await orig<typeof import("@/configuracoes/armazem")>();
  return { ...m, travarConfig: vi.fn(m.travarConfig), lerConfig: vi.fn(m.lerConfig) };
});

// Ids fictícios: os das páginas da Meta (WABA e número) e dois exemplos públicos copiados das mesmas páginas.
const WABA = "200000000000002";
const NUMERO = "100000000000001";
const OUTRA_WABA = "102290129340398";
const OUTRO_NUMERO = "106540352242922";

let db: Db, close: () => Promise<void>;
let org: string, outra: string, admin: Sessao, operacao: Sessao, proprietario: Sessao, limpeza: Sessao, adminOutra: Sessao;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());

async function usuario(organizacaoId: string, papel: Sessao["papel"]): Promise<Sessao> {
  const [u] = await db.insert(usuarios).values({ organizacaoId, email: `${papel}.${crypto.randomUUID().slice(0, 8)}@example.com`, nome: `${papel} fictício`, papel }).returning();
  return { usuarioId: u.id, organizacaoId, papel, imovelIds: [], ...(papel === "limpeza" ? { profissionalId: null } : {}) };
}
beforeEach(async () => {
  // A WABA é única entre as organizações: cada teste começa sem nenhuma configuração do WhatsApp gravada.
  await db.delete(configuracoes).where(eq(configuracoes.chave, "whatsapp"));
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  [{ id: outra }] = await db.insert(organizacoes).values({ nome: "Outra Empresa Exemplo" }).returning();
  admin = await usuario(org, "admin");
  operacao = await usuario(org, "operacao");
  proprietario = await usuario(org, "proprietario");
  limpeza = await usuario(org, "limpeza");
  adminOutra = await usuario(outra, "admin");
});

/** Grava o valor cru, sem validar (o "forçado por insert direto" do desenho). */
const gravarCru = (organizacaoId: string, valor: Record<string, unknown>) =>
  db.insert(configuracoes).values({ organizacaoId, chave: "whatsapp", valor }).onConflictDoUpdate({ target: [configuracoes.organizacaoId, configuracoes.chave], set: { valor } });
const valorGravado = async (organizacaoId: string) =>
  (await db.select({ valor: configuracoes.valor }).from(configuracoes).where(and(eq(configuracoes.organizacaoId, organizacaoId), eq(configuracoes.chave, "whatsapp"))))[0]?.valor ?? null;
const auditorias = (organizacaoId: string) => db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, organizacaoId), eq(auditoria.acao, "configuracao.whatsapp")));

describe("configuração do WhatsApp: leitura (M10.1a)", () => {
  it("sem linha gravada: ids nulos e 'só o admin' (o padrão da decisão de Diego em 17/10)", async () => {
    expect(QUEM_VE_PADRAO).toBe("so_admin");
    expect(await lerConfigWhatsapp(db, org)).toEqual({ wabaId: null, numeroId: null, quemVeConversas: "so_admin" });
    expect(configWhatsapp(null)).toEqual({ wabaId: null, numeroId: null, quemVeConversas: "so_admin" });
  });

  it("valor torto fica do lado seguro: id com letra, com 26 dígitos, número no lugar de texto ou objeto viram null; 'quem vê' desconhecido vira 'só o admin'", async () => {
    const vinteESeis = "1".repeat(26);
    expect(configWhatsapp({ wabaId: `${WABA.slice(0, -1)}A`, numeroId: vinteESeis, quemVeConversas: "todos" })).toEqual({ wabaId: null, numeroId: null, quemVeConversas: "so_admin" });
    expect(configWhatsapp({ wabaId: Number(WABA), numeroId: { id: NUMERO }, quemVeConversas: { valor: "admin_e_operacao" } })).toEqual({ wabaId: null, numeroId: null, quemVeConversas: "so_admin" });
    expect(configWhatsapp({ wabaId: ` ${WABA}`, numeroId: "", quemVeConversas: ["admin_e_operacao"] })).toEqual({ wabaId: null, numeroId: null, quemVeConversas: "so_admin" });
    for (const v of [undefined, "texto", 42, [WABA], true]) expect(configWhatsapp(v)).toEqual({ wabaId: null, numeroId: null, quemVeConversas: "so_admin" });
    // O id com 25 dígitos ainda é aceito (o limite de ID_META); chave desconhecida é descartada.
    expect(configWhatsapp({ wabaId: "2".repeat(25), numeroId: NUMERO, quemVeConversas: "admin_e_operacao", appId: "123", qualquer: true })).toEqual({
      wabaId: "2".repeat(25), numeroId: NUMERO, quemVeConversas: "admin_e_operacao",
    });
    // O mesmo pela leitura do banco.
    await gravarCru(org, { wabaId: "abc", numeroId: Number(NUMERO), quemVeConversas: "admin_e_operacao " });
    expect(await lerConfigWhatsapp(db, org)).toEqual({ wabaId: null, numeroId: null, quemVeConversas: "so_admin" });
  });
});

describe("configuração do WhatsApp: gravação dos ids (M10.1a)", () => {
  it("salvarIdsWhatsapp grava, devolve sem_mudanca na segunda vez, mantém 'quem vê' e fica na auditoria com o autor", async () => {
    expect(await salvarQuemVeConversas(db, admin, "admin_e_operacao")).toBe("salvo");
    expect(await salvarIdsWhatsapp(db, admin, { wabaId: WABA, numeroId: NUMERO })).toBe("salvo");
    expect(await lerConfigWhatsapp(db, org)).toEqual({ wabaId: WABA, numeroId: NUMERO, quemVeConversas: "admin_e_operacao" });
    expect(await salvarIdsWhatsapp(db, admin, { wabaId: WABA, numeroId: NUMERO })).toBe("sem_mudanca");
    // Espaços em volta são aparados (é o mesmo id).
    expect(await salvarIdsWhatsapp(db, admin, { wabaId: ` ${WABA} `, numeroId: `${NUMERO}\n` })).toBe("sem_mudanca");
    // O valor gravado não leva appId nem nada além dos três campos (M10.1b acrescenta o appId).
    expect(await valorGravado(org)).toEqual({ wabaId: WABA, numeroId: NUMERO, quemVeConversas: "admin_e_operacao" });

    const linhas = await auditorias(org);
    expect(linhas).toHaveLength(2);
    expect(linhas.every((l) => l.usuarioId === admin.usuarioId && l.entidade === "configuracao" && l.entidadeId === org)).toBe(true);
    expect(linhas.map((l) => l.mudancas)).toContainEqual({ wabaId: [null, WABA], numeroId: [null, NUMERO] });

    // Trocar o número e apagar (vazio) também são gravações auditadas.
    expect(await salvarIdsWhatsapp(db, admin, { wabaId: WABA, numeroId: OUTRO_NUMERO })).toBe("salvo");
    expect(await salvarIdsWhatsapp(db, admin, { wabaId: "", numeroId: null })).toBe("salvo");
    expect(await lerConfigWhatsapp(db, org)).toEqual({ wabaId: null, numeroId: null, quemVeConversas: "admin_e_operacao" });
    expect((await auditorias(org)).map((l) => l.mudancas)).toContainEqual({ wabaId: [WABA, null], numeroId: [OUTRO_NUMERO, null] });
  });

  it("salvar ids vazios sem configuração gravada não muda nada", async () => {
    expect(await salvarIdsWhatsapp(db, admin, { wabaId: null, numeroId: "  " })).toBe("sem_mudanca");
    expect(await valorGravado(org)).toBeNull();
    expect(await auditorias(org)).toEqual([]);
  });

  it("id que não é número da Meta (letra, sinal, 26 dígitos) ou valor que não é texto → id_invalido, sem gravar e sem apagar o que já estava", async () => {
    expect(await salvarIdsWhatsapp(db, admin, { wabaId: WABA, numeroId: NUMERO })).toBe("salvo");
    for (const ids of [
      { wabaId: `${WABA.slice(0, -1)}A`, numeroId: NUMERO },
      { wabaId: WABA, numeroId: `+${NUMERO}` },
      { wabaId: WABA, numeroId: "1".repeat(26) },
      { wabaId: "2000 0000 0000 0002", numeroId: NUMERO },
      // O tipo só protege em tempo de compilação: um valor torto vindo da ação (campo ausente, número, arquivo do
      // FormData, objeto) é recusado, nunca vira "apagar".
      { wabaId: undefined as never, numeroId: NUMERO },
      { wabaId: 123 as never, numeroId: NUMERO },
      { wabaId: Number(WABA) as never, numeroId: NUMERO },
      { wabaId: new File([WABA], "waba.txt") as never, numeroId: NUMERO },
      { wabaId: WABA, numeroId: { id: NUMERO } as never },
    ]) expect(await salvarIdsWhatsapp(db, admin, ids)).toBe("id_invalido");
    expect(await lerConfigWhatsapp(db, org)).toEqual({ wabaId: WABA, numeroId: NUMERO, quemVeConversas: "so_admin" });
    expect(await auditorias(org)).toHaveLength(1);
  });

  it("a WABA que já é de outra organização → waba_de_outra_empresa, sem gravar nada", async () => {
    expect(await salvarIdsWhatsapp(db, adminOutra, { wabaId: WABA, numeroId: NUMERO })).toBe("salvo");
    expect(await salvarIdsWhatsapp(db, admin, { wabaId: WABA, numeroId: OUTRO_NUMERO })).toBe("waba_de_outra_empresa");
    expect(await valorGravado(org)).toBeNull();
    expect(await auditorias(org)).toEqual([]);
    // Outra WABA passa; e a primeira continua só da outra organização.
    expect(await salvarIdsWhatsapp(db, admin, { wabaId: OUTRA_WABA, numeroId: OUTRO_NUMERO })).toBe("salvo");
    expect(await lerConfigWhatsapp(db, outra)).toEqual({ wabaId: WABA, numeroId: NUMERO, quemVeConversas: "so_admin" });
    // Uma WABA gravada torta (número no lugar de texto) na outra organização não identifica conta nenhuma: não trava.
    await gravarCru(outra, { wabaId: Number(WABA) });
    expect(await salvarIdsWhatsapp(db, admin, { wabaId: WABA, numeroId: NUMERO })).toBe("salvo");
  });

  it("duas organizações salvando a mesma WABA em paralelo → só uma grava", async () => {
    // O PGlite roda as transações em fila: aqui se confere a regra (a segunda vê a primeira). No Neon, quem garante que
    // as duas não passam juntas pela conferência é a trava global da WABA (conferida no teste seguinte).
    const r = await Promise.all([salvarIdsWhatsapp(db, admin, { wabaId: WABA, numeroId: NUMERO }), salvarIdsWhatsapp(db, adminOutra, { wabaId: WABA, numeroId: NUMERO })]);
    expect([...r].sort()).toEqual(["salvo", "waba_de_outra_empresa"]);
    const donas = (await db.select().from(configuracoes).where(eq(configuracoes.chave, "whatsapp"))).filter((l) => configWhatsapp(l.valor).wabaId === WABA);
    expect(donas).toHaveLength(1);
  });

  it("a trava global da WABA vem antes da trava da chave, presa na mesma transação, e o atual e a conferência de outra empresa vêm depois das duas", async () => {
    const consultas: { sql: string; params: unknown[] }[] = [];
    const registrado = drizzle((db as unknown as { $client: PGlite }).$client, { schema, logger: { logQuery: (q, params) => void consultas.push({ sql: q, params }) } }) as unknown as Db;
    const trava = vi.mocked(travarConfig);
    const leitura = vi.mocked(lerConfig);
    trava.mockClear();
    leitura.mockClear();
    // Na hora da trava da chave, a trava global já está presa nesta mesma transação (tomada fora dela, soltaria no fim
    // do próprio comando e não protegeria a conferência de "outra empresa" no Neon). O PGlite tem uma sessão só: a
    // contagem é a desta transação.
    const { travarConfig: travarDeVerdade } = await vi.importActual<typeof import("@/configuracoes/armazem")>("@/configuracoes/armazem");
    const travasPresas: number[] = [];
    trava.mockImplementationOnce(async (tx, o, c) => {
      const r = (await tx.execute(sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and granted`)) as unknown as { rows: { n: number }[] };
      travasPresas.push(r.rows[0].n);
      await travarDeVerdade(tx, o, c);
    });
    expect(await salvarIdsWhatsapp(registrado, admin, { wabaId: WABA, numeroId: NUMERO })).toBe("salvo");
    expect(travasPresas).toEqual([1]);

    const global = consultas.findIndex((c) => c.params.includes("whatsapp:waba"));
    const daChave = consultas.findIndex((c) => c.params.includes(`config:${org}:whatsapp`));
    const lido = consultas.findIndex((c) => /^select "valor" from "configuracoes"/.test(c.sql));
    expect(global).toBeGreaterThanOrEqual(0);
    expect(global).toBeLessThan(daChave);
    expect(daChave).toBeLessThan(lido);
    // A conferência de "outra empresa" (a única consulta com jsonb_typeof) vem depois das duas travas.
    const conferencia = consultas.findIndex((c) => c.sql.includes("jsonb_typeof"));
    expect(conferencia).toBeGreaterThan(daChave);

    expect(trava).toHaveBeenCalledTimes(1);
    expect(trava.mock.calls[0].slice(1)).toEqual([org, "whatsapp"]);
    const tx = trava.mock.calls[0][0];
    expect(tx).not.toBe(registrado);
    expect(is(tx, PgTransaction)).toBe(true);
    expect(leitura).toHaveBeenCalledTimes(1);
    expect(leitura.mock.calls[0][0]).toBe(tx);
    expect(trava.mock.invocationCallOrder[0]).toBeLessThan(leitura.mock.invocationCallOrder[0]);
  });
});

describe("configuração do WhatsApp: quem vê as conversas (M10.1a)", () => {
  it("salvarQuemVeConversas mantém os ids e lê o atual depois de travar, dentro da transação", async () => {
    expect(await salvarIdsWhatsapp(db, admin, { wabaId: WABA, numeroId: NUMERO })).toBe("salvo");
    const trava = vi.mocked(travarConfig);
    const leitura = vi.mocked(lerConfig);
    trava.mockClear();
    leitura.mockClear();
    expect(await salvarQuemVeConversas(db, admin, "admin_e_operacao")).toBe("salvo");
    expect(trava).toHaveBeenCalledTimes(1);
    const tx = trava.mock.calls[0][0];
    expect(tx).not.toBe(db);
    expect(is(tx, PgTransaction)).toBe(true);
    expect(leitura.mock.calls.map((c) => c[0])).toEqual([tx]);
    expect(trava.mock.invocationCallOrder[0]).toBeLessThan(leitura.mock.invocationCallOrder[0]);

    expect(await lerConfigWhatsapp(db, org)).toEqual({ wabaId: WABA, numeroId: NUMERO, quemVeConversas: "admin_e_operacao" });
    expect(await salvarQuemVeConversas(db, admin, "admin_e_operacao")).toBe("sem_mudanca");
    expect(await salvarQuemVeConversas(db, admin, "so_admin")).toBe("salvo");
    expect((await auditorias(org)).map((l) => l.mudancas)).toContainEqual({ quemVeConversas: ["admin_e_operacao", "so_admin"] });
    // Valor fora da lista nunca grava.
    await expect(salvarQuemVeConversas(db, admin, "todos" as never)).rejects.toThrow(TypeError);
    expect((await lerConfigWhatsapp(db, org)).quemVeConversas).toBe("so_admin");
  });

  it("as duas gravações em série não perdem uma a outra (ids e depois quem vê, e o contrário)", async () => {
    expect(await salvarIdsWhatsapp(db, admin, { wabaId: WABA, numeroId: NUMERO })).toBe("salvo");
    expect(await salvarQuemVeConversas(db, admin, "admin_e_operacao")).toBe("salvo");
    expect(await lerConfigWhatsapp(db, org)).toEqual({ wabaId: WABA, numeroId: NUMERO, quemVeConversas: "admin_e_operacao" });
    expect(await salvarQuemVeConversas(db, admin, "so_admin")).toBe("salvo");
    expect(await salvarIdsWhatsapp(db, admin, { wabaId: WABA, numeroId: OUTRO_NUMERO })).toBe("salvo");
    expect(await lerConfigWhatsapp(db, org)).toEqual({ wabaId: WABA, numeroId: OUTRO_NUMERO, quemVeConversas: "so_admin" });
    // As duas ao mesmo tempo também não se apagam.
    await Promise.all([salvarIdsWhatsapp(db, admin, { wabaId: OUTRA_WABA, numeroId: NUMERO }), salvarQuemVeConversas(db, admin, "admin_e_operacao")]);
    expect(await lerConfigWhatsapp(db, org)).toEqual({ wabaId: OUTRA_WABA, numeroId: NUMERO, quemVeConversas: "admin_e_operacao" });
  });
});

describe("configuração do WhatsApp: quem pode mudar (M10.1a)", () => {
  it("operação, proprietário, limpeza e sessão inválida → AcessoNegado, sem gravar", async () => {
    for (const s of [operacao, proprietario, limpeza, { ...admin, organizacaoId: "" }, { ...admin, usuarioId: "" }]) {
      await expect(salvarIdsWhatsapp(db, s, { wabaId: WABA, numeroId: NUMERO })).rejects.toBeInstanceOf(AcessoNegado);
      await expect(salvarQuemVeConversas(db, s, "admin_e_operacao")).rejects.toBeInstanceOf(AcessoNegado);
    }
    expect(await valorGravado(org)).toBeNull();
    expect(await auditorias(org)).toEqual([]);
  });

  it("o admin de outra organização só mexe na configuração da própria", async () => {
    expect(await salvarIdsWhatsapp(db, adminOutra, { wabaId: WABA, numeroId: NUMERO })).toBe("salvo");
    expect(await salvarQuemVeConversas(db, adminOutra, "admin_e_operacao")).toBe("salvo");
    expect(await valorGravado(org)).toBeNull();
    expect(await lerConfigWhatsapp(db, org)).toEqual({ wabaId: null, numeroId: null, quemVeConversas: "so_admin" });
    expect(await auditorias(org)).toEqual([]);
  });
});

describe("organização dona da conta (M10.1a: exatamente uma)", () => {
  it("organizacaoDaConta: uma organização com a WABA → ela e a configuração; nenhuma → null", async () => {
    expect(await organizacaoDaConta(db, [WABA])).toBeNull();
    await salvarIdsWhatsapp(db, admin, { wabaId: WABA, numeroId: NUMERO });
    expect(await organizacaoDaConta(db, [WABA])).toEqual({ organizacaoId: org, config: { wabaId: WABA, numeroId: NUMERO, quemVeConversas: "so_admin" } });
    // O account_update traz o id do parceiro em entry.id e a WABA em waba_info: basta uma das duas casar.
    expect(await organizacaoDaConta(db, [OUTRA_WABA, WABA])).toMatchObject({ organizacaoId: org });
    expect(await organizacaoDaConta(db, [OUTRA_WABA])).toBeNull();
    // Lista vazia ou ids que não são da Meta: null, sem palpite.
    expect(await organizacaoDaConta(db, [])).toBeNull();
    expect(await organizacaoDaConta(db, [`${WABA} `, "abc", ""])).toBeNull();
  });

  it("organizacaoDaConta: duas organizações com a mesma WABA (forçadas por insert direto) → null", async () => {
    await salvarIdsWhatsapp(db, admin, { wabaId: WABA, numeroId: NUMERO });
    await gravarCru(outra, { wabaId: WABA, numeroId: OUTRO_NUMERO, quemVeConversas: "so_admin" });
    expect(await organizacaoDaConta(db, [WABA])).toBeNull();
    // As WABAs de um mesmo bloco que levam a duas organizações também não decidem.
    await gravarCru(outra, { wabaId: OUTRA_WABA });
    expect(await organizacaoDaConta(db, [WABA])).toMatchObject({ organizacaoId: org });
    expect(await organizacaoDaConta(db, [WABA, OUTRA_WABA])).toBeNull();
  });

  it("organizacaoDaConta: WABA gravada torta (número no lugar de texto) não identifica a conta", async () => {
    await gravarCru(org, { wabaId: Number(WABA), numeroId: NUMERO });
    expect(await organizacaoDaConta(db, [WABA])).toBeNull();
  });

  it("organizacaoDoNumero: uma organização com o número → ela; nenhuma ou duas → null", async () => {
    expect(await organizacaoDoNumero(db, NUMERO)).toBeNull();
    await salvarIdsWhatsapp(db, admin, { wabaId: WABA, numeroId: NUMERO });
    expect(await organizacaoDoNumero(db, NUMERO)).toEqual({ organizacaoId: org, config: { wabaId: WABA, numeroId: NUMERO, quemVeConversas: "so_admin" } });
    expect(await organizacaoDoNumero(db, OUTRO_NUMERO)).toBeNull();
    expect(await organizacaoDoNumero(db, "")).toBeNull();
    expect(await organizacaoDoNumero(db, `+${NUMERO}`)).toBeNull();
    // Outra organização com o mesmo número (outra WABA): ambíguo, null.
    await salvarIdsWhatsapp(db, adminOutra, { wabaId: OUTRA_WABA, numeroId: NUMERO });
    expect(await organizacaoDoNumero(db, NUMERO)).toBeNull();
    // Número gravado torto não conta.
    await gravarCru(outra, { wabaId: OUTRA_WABA, numeroId: Number(NUMERO) });
    expect(await organizacaoDoNumero(db, NUMERO)).toMatchObject({ organizacaoId: org });
  });
});
