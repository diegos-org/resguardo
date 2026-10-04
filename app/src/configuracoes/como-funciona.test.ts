import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { organizacoes, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { lerComoFunciona, normalizarSecoes, paragrafos, preencherEmpresa, publicarComoFunciona, RASCUNHO_COMO_FUNCIONA, SECOES_COMO_FUNCIONA, secoesParaMostrar, validarSecoes, versaoAtual, versoesComoFuncionaDe } from "./como-funciona";

let db: Db, close: () => Promise<void>, org: string, admin: string;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "A" }).returning();
  [{ id: admin }] = await db.insert(usuarios).values({ organizacaoId: org, email: "admin@example.com", nome: "Admin", papel: "admin" }).returning();
});
afterEach(() => close());

describe("documento 'Como funciona' para o proprietário (M5.6)", () => {
  it("validação: limite por seção, pelo menos uma seção escrita, quebras de linha normalizadas", () => {
    expect(validarSecoes({})).toMatchObject({ ok: false, mensagem: expect.stringContaining("pelo menos uma seção") });
    expect(validarSecoes({ oQueFazemos: "  Olá\r\n\r\nMundo  " })).toMatchObject({ ok: true, secoes: expect.objectContaining({ oQueFazemos: "Olá\n\nMundo", marketplace: "", contestacoes: "" }) });
    expect(validarSecoes({ duvidas: "x".repeat(1001) })).toMatchObject({ ok: false, erros: { duvidas: "Máximo de 1000 caracteres." }, mensagem: "Confira os campos destacados." });
    expect(SECOES_COMO_FUNCIONA.map((s) => s.chave)).toEqual(["oQueFazemos", "marketplace", "comissaoETaxas", "quandoRecebe", "relatorios", "cancelamentos", "contestacoes", "duvidas"]);
    // O rascunho sugerido cabe nos limites e deixa "contestações" para a decisão de Diego.
    expect(validarSecoes(RASCUNHO_COMO_FUNCIONA)).toMatchObject({ ok: true });
    expect(RASCUNHO_COMO_FUNCIONA.contestacoes).toBe("");
  });

  it("versões gravadas: entradas inválidas são ignoradas; a atual é a de maior número", () => {
    expect(versoesComoFuncionaDe(null)).toEqual([]);
    const v = versoesComoFuncionaDe({
      versoes: [{ numero: 2, data: "2026-10-05", secoes: { duvidas: "b" } }, { numero: 1, data: "2026-10-04", autorId: "x", secoes: { duvidas: "a", lixo: 1 } }, { numero: 0, data: "2026-10-04" }, { numero: 3, data: "2026-13-01" }, "nada", null],
    });
    expect(v.map((x) => x.numero)).toEqual([1, 2]);
    expect(v[0]).toMatchObject({ autorId: "x", secoes: expect.objectContaining({ duvidas: "a", oQueFazemos: "" }) });
    expect(v[1].autorId).toBeNull();
    expect(versaoAtual(v)?.numero).toBe(2);
    expect(versaoAtual([])).toBeNull();
    expect(normalizarSecoes(null).duvidas).toBe("");
  });

  it("publicar cria a versão 1 datada; texto igual não cria versão; mudança cria a 2 e o histórico guarda o que mudou", async () => {
    expect(await lerComoFunciona(db, org)).toEqual([]);
    expect(await publicarComoFunciona(db, org, RASCUNHO_COMO_FUNCIONA, admin, "2026-10-04")).toMatchObject({ mudou: true, versao: { numero: 1, data: "2026-10-04", autorId: admin } });
    expect(await publicarComoFunciona(db, org, { ...RASCUNHO_COMO_FUNCIONA }, admin, "2026-10-05")).toMatchObject({ mudou: false, versao: { numero: 1, data: "2026-10-04" } });
    expect(await publicarComoFunciona(db, org, { ...RASCUNHO_COMO_FUNCIONA, contestacoes: "A SCL arca." }, admin, "2026-10-06")).toMatchObject({ mudou: true, versao: { numero: 2, data: "2026-10-06" } });
    const versoes = await lerComoFunciona(db, org);
    expect(versoes.map((v) => [v.numero, v.data])).toEqual([[1, "2026-10-04"], [2, "2026-10-06"]]);
    expect(versaoAtual(versoes)?.secoes.contestacoes).toBe("A SCL arca.");
    const historico = (await historicoDe(db, org, "configuracao", org)).filter((h) => h.acao === "configuracao.como_funciona");
    expect(historico).toHaveLength(2);
    expect(historico.map((h) => h.mudancas).find((m) => JSON.stringify(m.versao) === "[1,2]")).toEqual({ versao: [1, 2], "secao.contestacoes": ["", "A SCL arca."] });
    await expect(publicarComoFunciona(db, org, RASCUNHO_COMO_FUNCIONA, admin, "2026-13-01")).rejects.toThrow("Data inválida.");
    // Formulário aberto na versão velha: publicar por cima é recusado; com a versão certa, passa.
    const velho = await publicarComoFunciona(db, org, { ...RASCUNHO_COMO_FUNCIONA, duvidas: "Texto de quem não recarregou." }, admin, "2026-10-07", 1);
    expect(velho).toMatchObject({ ok: false, erro: expect.stringContaining("a versão 2 foi publicada por outra pessoa em 06/10/2026"), atual: { numero: 2 } });
    expect((await lerComoFunciona(db, org)).length).toBe(2);
    expect(await publicarComoFunciona(db, org, { ...RASCUNHO_COMO_FUNCIONA, duvidas: "Texto novo." }, admin, "2026-10-07", 2)).toMatchObject({ ok: true, mudou: true, versao: { numero: 3 } });
    // Sem versão publicada, a base é 0.
    const [{ id: outraOrg }] = await db.insert(organizacoes).values({ nome: "C" }).returning();
    expect(await publicarComoFunciona(db, outraOrg, RASCUNHO_COMO_FUNCIONA, admin, "2026-10-07", 1)).toMatchObject({ ok: false, erro: expect.stringContaining("a versão 0 foi publicada"), atual: null });
    expect(await publicarComoFunciona(db, outraOrg, RASCUNHO_COMO_FUNCIONA, admin, "2026-10-07", 0)).toMatchObject({ ok: true, mudou: true, versao: { numero: 1 } });
    // Outra organização não vê nada.
    const [{ id: outra }] = await db.insert(organizacoes).values({ nome: "B" }).returning();
    expect(await lerComoFunciona(db, outra)).toEqual([]);
  });

  it("texto para mostrar: {empresa} vira o nome, parágrafos por linha em branco, seção vazia não aparece", () => {
    expect(preencherEmpresa("A {empresa} cuida; {empresa}.", " SCL ")).toBe("A SCL cuida; SCL.");
    expect(preencherEmpresa("{empresa}", "")).toBe("empresa");
    expect(paragrafos("a\n\n  b  \n\n\n")).toEqual(["a", "b"]);
    const v = { numero: 1, data: "2026-10-04", autorId: null, secoes: { ...normalizarSecoes(null), duvidas: "Fale com a {empresa}.", oQueFazemos: "Um.\n\nDois." } };
    expect(secoesParaMostrar(v, "SCL")).toEqual([
      { chave: "oQueFazemos", titulo: "O que a empresa faz por você", paragrafos: ["Um.", "Dois."] },
      { chave: "duvidas", titulo: "Dúvidas", paragrafos: ["Fale com a SCL."] },
    ]);
  });
});
