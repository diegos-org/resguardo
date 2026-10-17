/**
 * Quem vê as conversas do WhatsApp (M10.1a; a parte pura do teste obrigatório pedido por Diego em 17/10: operação com
 * o padrão só o admin não vê): a matriz de papéis × "Quem vê as conversas" sem banco, e a leitura da configuração da
 * organização da sessão com PGlite.
 * O padrão é "só o admin": a operação, que tem `mensagem:ler` na política, só vê com a configuração liberada.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AcessoNegado, type Sessao } from "@/acesso/politica";
import { gravarConfig } from "@/configuracoes/armazem";
import type { Papel } from "@/db/schema";
import { organizacoes, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { exigirVerConversas, podeVerConversas, podeVerConversasCom } from "./acesso";
import { salvarQuemVeConversas } from "./configuracao";

const ORG = crypto.randomUUID();
const USUARIO = crypto.randomUUID();
const sessaoDe = (papel: Papel, o: Partial<Sessao> = {}): Sessao => ({ usuarioId: USUARIO, organizacaoId: ORG, papel, imovelIds: [], ...o });

/** Valores de "Quem vê as conversas": os dois da lista e os tortos (que valem "só o admin"). */
const PADRAO = "so_admin";
const LIBERADA = "admin_e_operacao";
const TORTOS: unknown[] = [undefined, null, "", "todos", "ADMIN_E_OPERACAO", "admin_e_operacao ", ["admin_e_operacao"], { quem: "admin_e_operacao" }, 1, true];

/** Um banco que não pode ser consultado: qualquer uso derruba o teste. */
const semConsulta = new Proxy({}, { get: (_, p) => { throw new Error(`consultou o banco (${String(p)})`); } }) as unknown as Db;

describe("podeVerConversasCom: matriz sem banco (M10.1a)", () => {
  it("operação com o padrão só o admin não vê as conversas; com 'admin e operação' vê", () => {
    expect(podeVerConversasCom(sessaoDe("operacao"), PADRAO)).toBe(false);
    expect(podeVerConversasCom(sessaoDe("operacao"), LIBERADA)).toBe(true);
  });

  it("operação com valor torto (ausente, desconhecido, maiúsculo, com espaço, lista, objeto) não vê: vale o padrão só o admin", () => {
    for (const v of TORTOS) expect(podeVerConversasCom(sessaoDe("operacao"), v)).toBe(false);
  });

  it("admin vê sempre: com os dois valores e com valor torto", () => {
    for (const v of [PADRAO, LIBERADA, ...TORTOS]) expect(podeVerConversasCom(sessaoDe("admin"), v)).toBe(true);
  });

  it.each(["proprietario", "limpeza", "hospede"] as const)("%s nunca vê, qualquer que seja a configuração", (papel) => {
    const s = sessaoDe(papel, papel === "proprietario" ? { imovelIds: [crypto.randomUUID()] } : papel === "limpeza" ? { profissionalId: crypto.randomUUID() } : {});
    for (const v of [PADRAO, LIBERADA, ...TORTOS]) expect(podeVerConversasCom(s, v)).toBe(false);
  });

  it("sessão nula, sem usuário, sem organização, papel desconhecido ou que não é texto → não vê", () => {
    for (const v of [PADRAO, LIBERADA]) {
      expect(podeVerConversasCom(null, v)).toBe(false);
      expect(podeVerConversasCom(undefined, v)).toBe(false);
      expect(podeVerConversasCom(sessaoDe("admin", { usuarioId: "" }), v)).toBe(false);
      expect(podeVerConversasCom(sessaoDe("admin", { organizacaoId: "" }), v)).toBe(false);
      expect(podeVerConversasCom(sessaoDe("admin", { usuarioId: undefined as unknown as string }), v)).toBe(false);
      expect(podeVerConversasCom(sessaoDe("gerente" as Papel), v)).toBe(false);
      expect(podeVerConversasCom(sessaoDe(["admin"] as unknown as Papel), v)).toBe(false);
      expect(podeVerConversasCom(sessaoDe("constructor" as Papel), v)).toBe(false);
    }
  });
});

describe("podeVerConversas e exigirVerConversas (M10.1a)", () => {
  it("admin vê sem consultar o banco; proprietário, limpeza, hóspede e sessão inválida são negados sem consultar", async () => {
    expect(await podeVerConversas(semConsulta, sessaoDe("admin"))).toBe(true);
    await expect(exigirVerConversas(semConsulta, sessaoDe("admin"))).resolves.toBeUndefined();
    for (const s of [sessaoDe("proprietario"), sessaoDe("limpeza"), sessaoDe("hospede"), sessaoDe("admin", { organizacaoId: "" }), sessaoDe("gerente" as Papel)]) {
      expect(await podeVerConversas(semConsulta, s)).toBe(false);
      await expect(exigirVerConversas(semConsulta, s)).rejects.toEqual(new AcessoNegado("ACAO_NAO_PERMITIDA"));
    }
  });

  describe("com PGlite", () => {
    let db: Db, close: () => Promise<void>, org: string, outra: string, admin: Sessao, adminOutra: Sessao, operacao: Sessao;
    beforeAll(async () => { ({ db, close } = await createTestDb()); });
    afterAll(() => close());
    const usuario = async (organizacaoId: string, papel: Papel): Promise<Sessao> => {
      const [u] = await db.insert(usuarios).values({ organizacaoId, email: `${papel}.${crypto.randomUUID().slice(0, 8)}@example.com`, nome: `${papel} fictício`, papel }).returning();
      return { usuarioId: u.id, organizacaoId, papel, imovelIds: [] };
    };
    beforeEach(async () => {
      [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
      [{ id: outra }] = await db.insert(organizacoes).values({ nome: "Outra Empresa Exemplo" }).returning();
      admin = await usuario(org, "admin");
      adminOutra = await usuario(outra, "admin");
      operacao = await usuario(org, "operacao");
    });

    it("operação com o padrão só o admin (sem configuração gravada): não vê, e exigirVerConversas lança AcessoNegado('ACAO_NAO_PERMITIDA')", async () => {
      expect(await podeVerConversas(db, operacao)).toBe(false);
      const erro = await exigirVerConversas(db, operacao).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(AcessoNegado);
      expect((erro as AcessoNegado).motivo).toBe("ACAO_NAO_PERMITIDA");
      expect(await podeVerConversas(db, admin)).toBe(true);
    });

    it("lê a configuração da organização da sessão: a liberação de outra organização não vale", async () => {
      expect(await salvarQuemVeConversas(db, adminOutra, "admin_e_operacao")).toBe("salvo");
      expect(await podeVerConversas(db, operacao)).toBe(false);
      await expect(exigirVerConversas(db, operacao)).rejects.toBeInstanceOf(AcessoNegado);

      expect(await salvarQuemVeConversas(db, admin, "admin_e_operacao")).toBe("salvo");
      expect(await podeVerConversas(db, operacao)).toBe(true);
      await expect(exigirVerConversas(db, operacao)).resolves.toBeUndefined();

      // Voltar para "só o admin" nega de novo na hora.
      expect(await salvarQuemVeConversas(db, admin, "so_admin")).toBe("salvo");
      expect(await podeVerConversas(db, operacao)).toBe(false);
    });

    it("operação com 'quem vê' gravado torto não vê (vale o padrão só o admin)", async () => {
      await gravarConfig(db, org, "whatsapp", { quemVeConversas: "todos" }, null);
      expect(await podeVerConversas(db, operacao)).toBe(false);
      await gravarConfig(db, org, "whatsapp", { quemVeConversas: ["admin_e_operacao"] }, null);
      expect(await podeVerConversas(db, operacao)).toBe(false);
      expect(await podeVerConversas(db, admin)).toBe(true);
    });
  });
});
