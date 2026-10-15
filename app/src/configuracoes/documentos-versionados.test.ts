import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { auditoria, configuracoes, organizacoes, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { and, eq } from "drizzle-orm";
import { gravarConfig } from "./armazem";
import {
  type DefinicaoDocumento,
  lerVersoes,
  mensagemVersaoMudou,
  normalizarSecoes,
  publicarVersao,
  secoesIguais,
  validarSecoes,
  versaoAtual,
  versaoDeOrigem,
  versaoEmVigor,
  versoesComOrigem,
  versoesDe,
} from "./documentos-versionados";

// Documento de mentira numa chave livre: duas seções e um campo próprio gravado em cada versão.
type Extra = { selo: string };
const DOC: DefinicaoDocumento<"a" | "b", Extra> = {
  chave: "termos_uso",
  acaoAuditoria: "configuracao.documento_teste",
  secoes: [
    { chave: "a", titulo: "A", dica: "", limite: 10 },
    { chave: "b", titulo: "B", dica: "", limite: 20 },
  ],
  lerExtra: (x) => ({ selo: typeof x.selo === "string" ? x.selo : "" }),
  mudancasDoExtra: (antes, depois): Record<string, [unknown, unknown]> => ((antes?.selo ?? null) !== depois.selo ? { selo: [antes?.selo ?? null, depois.selo] } : {}),
};
const com = (selo: string) => async () => ({ ok: true as const, extra: { selo } });

let db: Db, close: () => Promise<void>, org: string, outra: string, admin: string;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }, { id: outra }] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
  [{ id: admin }] = await db.insert(usuarios).values({ organizacaoId: org, email: "admin@example.com", nome: "Admin", papel: "admin" }).returning();
});
afterEach(() => close());

describe("documento versionado genérico (M7.4, motor do M5.6)", () => {
  it("funções puras: seções normalizadas, versões gravadas tolerantes e ordenadas, validação com limite e exigência", () => {
    expect(normalizarSecoes(DOC, { a: "  x\r\ny ", b: 3, c: "lixo" })).toEqual({ a: "x\ny", b: "" });
    expect(normalizarSecoes(DOC, { a: "x".repeat(15) }).a).toBe("x".repeat(10));
    expect(normalizarSecoes(DOC, null)).toEqual({ a: "", b: "" });

    expect(versoesDe(DOC, null)).toEqual([]);
    const v = versoesDe(DOC, { versoes: [{ numero: 2, data: "2026-10-05", secoes: { a: "2" }, selo: "s2" }, { numero: 1, data: "2026-10-04", autorId: "u", secoes: { b: "1" } }, { numero: 0, data: "2026-10-04" }, { numero: 1.5, data: "2026-10-04" }, { numero: 3, data: "2026-02-30" }, "x", null] });
    expect(v).toEqual([
      { numero: 1, data: "2026-10-04", autorId: "u", secoes: { a: "", b: "1" }, selo: "" },
      { numero: 2, data: "2026-10-05", autorId: null, secoes: { a: "2", b: "" }, selo: "s2" },
    ]);
    expect(versaoAtual(v)?.numero).toBe(2);
    expect(versaoAtual([])).toBeNull();
    expect(secoesIguais(DOC, { a: "1", b: "2" }, { a: "1", b: "2" })).toBe(true);
    expect(secoesIguais(DOC, { a: "1", b: "2" }, { a: "1", b: "3" })).toBe(false);

    expect(validarSecoes(DOC, {})).toEqual({ ok: false, erros: {}, mensagem: "Escreva pelo menos uma seção antes de publicar." });
    expect(validarSecoes(DOC, { a: "x".repeat(11) })).toEqual({ ok: false, erros: { a: "Máximo de 10 caracteres." }, mensagem: "Confira os campos destacados." });
    expect(validarSecoes(DOC, { a: " ok " })).toEqual({ ok: true, secoes: { a: "ok", b: "" } });
    expect(validarSecoes(DOC, { a: "ok" }, { exigirTodas: true })).toEqual({ ok: false, erros: { b: "Escreva esta parte antes de publicar." }, mensagem: "Confira os campos destacados." });
    expect(validarSecoes(DOC, { a: "ok", b: "também" }, { exigirTodas: true })).toEqual({ ok: true, secoes: { a: "ok", b: "também" } });
    expect(mensagemVersaoMudou(null)).toBe("Enquanto você editava, a versão 0 foi publicada por outra pessoa. Recarregue a página, confira o texto atual e publique de novo.");
    expect(mensagemVersaoMudou({ numero: 3, data: "2026-10-07" })).toContain("a versão 3 foi publicada por outra pessoa em 07/10/2026.");
  });

  it("publicar: v1; igual não cria versão; mudança cria v2 com o histórico do que mudou; a v1 continua idêntica", async () => {
    expect(await lerVersoes(db, DOC, org)).toEqual([]);
    const v1 = await publicarVersao(db, DOC, org, { a: "um", b: "dois" }, admin, "2026-10-04", 0, com("s1"));
    expect(v1).toEqual({ ok: true, mudou: true, versao: { numero: 1, data: "2026-10-04", autorId: admin, secoes: { a: "um", b: "dois" }, selo: "s1" } });
    const gravadaV1 = structuredClone((await lerVersoes(db, DOC, org))[0]);
    // Mesmo texto e mesmo campo próprio: nada muda (nem a data).
    expect(await publicarVersao(db, DOC, org, { a: "um", b: "dois" }, admin, "2026-10-05", 1, com("s1"))).toMatchObject({ ok: true, mudou: false, versao: { numero: 1, data: "2026-10-04" } });
    // Só o campo próprio mudou: é versão nova.
    expect(await publicarVersao(db, DOC, org, { a: "um", b: "dois" }, admin, "2026-10-06", 1, com("s2"))).toMatchObject({ ok: true, mudou: true, versao: { numero: 2, selo: "s2" } });
    expect(await publicarVersao(db, DOC, org, { a: "um", b: "três" }, null, "2026-10-07", 2, com("s2"))).toMatchObject({ ok: true, mudou: true, versao: { numero: 3, autorId: null } });
    const versoes = await lerVersoes(db, DOC, org);
    expect(versoes.map((v) => [v.numero, v.data])).toEqual([[1, "2026-10-04"], [2, "2026-10-06"], [3, "2026-10-07"]]);
    // Só inclusão: a v1 gravada é a mesma de antes.
    expect(versoes[0]).toEqual(gravadaV1);
    const historico = (await historicoDe(db, org, "configuracao", org)).filter((h) => h.acao === "configuracao.documento_teste").map((h) => h.mudancas);
    expect(historico).toHaveLength(3);
    expect(historico).toContainEqual({ versao: [null, 1], selo: [null, "s1"], "secao.a": [null, "um"], "secao.b": [null, "dois"] });
    expect(historico).toContainEqual({ versao: [1, 2], selo: ["s1", "s2"] });
    expect(historico).toContainEqual({ versao: [2, 3], "secao.b": ["dois", "três"] });
  });

  it("publicar: as versões já publicadas voltam ao banco exatamente como estavam gravadas (a leitura tolerante, que completa e descarta campos, não as reescreve)", async () => {
    // Gravada por um código mais antigo: sem o campo próprio de hoje e com uma chave que a leitura descarta.
    const antiga = { numero: 1, data: "2026-10-04", autorId: null, secoes: { a: "um" }, legado: "x" };
    await gravarConfig(db, org, DOC.chave, { versoes: [antiga] }, null, false);
    expect((await lerVersoes(db, DOC, org))[0]).toEqual({ numero: 1, data: "2026-10-04", autorId: null, secoes: { a: "um", b: "" }, selo: "" });
    expect(await publicarVersao(db, DOC, org, { a: "dois", b: "" }, admin, "2026-10-05", 1, com("s2"))).toMatchObject({ ok: true, mudou: true, versao: { numero: 2 } });
    const [linha] = await db.select().from(configuracoes).where(and(eq(configuracoes.organizacaoId, org), eq(configuracoes.chave, DOC.chave)));
    expect((linha.valor as { versoes: unknown[] }).versoes).toEqual([antiga, { numero: 2, data: "2026-10-05", autorId: admin, secoes: { a: "dois", b: "" }, selo: "s2" }]);
    expect((await lerVersoes(db, DOC, org)).map((v) => [v.numero, v.selo])).toEqual([[1, ""], [2, "s2"]]);
  });

  it("publicar: base velha é recusada; o campo próprio pode recusar sem gravar nada; data inválida é erro; cada organização tem as suas", async () => {
    // Recusa de quem lê os campos próprios: nem configuração nem histórico.
    expect(await publicarVersao(db, DOC, org, { a: "um", b: "" }, admin, "2026-10-04", 0, async () => ({ ok: false, erro: "Falta o selo.", erros: { a: "x" } }))).toEqual({ ok: false, erro: "Falta o selo.", erros: { a: "x" }, atual: null });
    expect(await db.select().from(configuracoes).where(eq(configuracoes.organizacaoId, org))).toEqual([]);
    expect(await db.select().from(auditoria).where(eq(auditoria.organizacaoId, org))).toEqual([]);
    await expect(publicarVersao(db, DOC, org, { a: "um", b: "" }, admin, "2026-13-01", 0, com("s"))).rejects.toThrow("Data inválida.");

    await publicarVersao(db, DOC, org, { a: "um", b: "" }, admin, "2026-10-04", 0, com("s"));
    await publicarVersao(db, DOC, org, { a: "dois", b: "" }, admin, "2026-10-05", 1, com("s"));
    // Formulário aberto na v1 enquanto a v2 saiu: recusado, sem ler o campo próprio nem gravar.
    let lido = false;
    const velho = await publicarVersao(db, DOC, org, { a: "velho", b: "" }, admin, "2026-10-06", 1, async () => ((lido = true), { ok: true as const, extra: { selo: "s" } }));
    expect(velho).toMatchObject({ ok: false, erro: mensagemVersaoMudou({ numero: 2, data: "2026-10-05" }), atual: { numero: 2 } });
    expect(lido).toBe(false);
    expect((await lerVersoes(db, DOC, org)).length).toBe(2);
    // Sem base declarada (uso interno), publica por cima da atual.
    expect(await publicarVersao(db, DOC, org, { a: "três", b: "" }, admin, "2026-10-06", undefined, com("s"))).toMatchObject({ ok: true, versao: { numero: 3 } });

    // A outra organização não vê nada e numera do zero.
    expect(await lerVersoes(db, DOC, outra)).toEqual([]);
    expect(await publicarVersao(db, DOC, outra, { a: "dela", b: "" }, null, "2026-10-06", 0, com("s"))).toMatchObject({ ok: true, versao: { numero: 1 } });
    expect((await lerVersoes(db, DOC, org)).map((v) => v.numero)).toEqual([1, 2, 3]);
  });

  it("versão de origem (M7.15): vale sem nada publicado, sem data; o mesmo texto não cria versão; a primeira publicada é a seguinte a ela", async () => {
    const COM_ORIGEM: DefinicaoDocumento<"a" | "b", Extra> = { ...DOC, chave: "politica_privacidade", origem: { numero: 1, secoes: { a: "um", b: "" }, selo: "s" } };
    const origem = { numero: 1, data: "", autorId: null, secoes: { a: "um", b: "" }, selo: "s" };
    expect(versaoDeOrigem(DOC)).toBeNull();
    expect(versaoEmVigor(DOC, [])).toBeNull();
    expect(versaoDeOrigem(COM_ORIGEM)).toEqual(origem);
    expect(versaoEmVigor(COM_ORIGEM, [])).toEqual(origem);
    expect(versoesComOrigem(DOC, [])).toEqual([]);
    expect(versoesComOrigem(COM_ORIGEM, [])).toEqual([origem]);
    // Mensagem de recusa sem data quando a versão em vigor é a de origem.
    expect(mensagemVersaoMudou(origem)).toBe("Enquanto você editava, a versão 1 foi publicada por outra pessoa. Recarregue a página, confira o texto atual e publique de novo.");

    // O mesmo texto da origem: nada é gravado (nem configuração nem histórico), e o resultado é a própria origem.
    expect(await publicarVersao(db, COM_ORIGEM, org, { a: "um", b: "" }, admin, "2026-10-15", 1, com("s"))).toEqual({ ok: true, mudou: false, versao: origem });
    expect(await db.select().from(configuracoes).where(eq(configuracoes.organizacaoId, org))).toEqual([]);
    expect(await db.select().from(auditoria).where(eq(auditoria.organizacaoId, org))).toEqual([]);
    // O formulário que diz "nada em vigor" (base 0) é recusado: a versão em vigor é a 1, a de origem.
    expect(await publicarVersao(db, COM_ORIGEM, org, { a: "outro", b: "" }, admin, "2026-10-15", 0, com("s"))).toMatchObject({ ok: false, atual: origem });
    // Texto diferente sobre a origem: a versão 2, datada; só ela vai para o banco.
    expect(await publicarVersao(db, COM_ORIGEM, org, { a: "dois", b: "" }, admin, "2026-10-15", 1, com("s"))).toEqual({
      ok: true,
      mudou: true,
      versao: { numero: 2, data: "2026-10-15", autorId: admin, secoes: { a: "dois", b: "" }, selo: "s" },
    });
    const [linha] = await db.select().from(configuracoes).where(and(eq(configuracoes.organizacaoId, org), eq(configuracoes.chave, COM_ORIGEM.chave)));
    expect((linha.valor as { versoes: unknown[] }).versoes).toEqual([{ numero: 2, data: "2026-10-15", autorId: admin, secoes: { a: "dois", b: "" }, selo: "s" }]);
    const publicadas = await lerVersoes(db, COM_ORIGEM, org);
    expect(versoesComOrigem(COM_ORIGEM, publicadas).map((v) => [v.numero, v.data])).toEqual([[1, ""], [2, "2026-10-15"]]);
    expect(versaoEmVigor(COM_ORIGEM, publicadas)?.numero).toBe(2);
    // O histórico registra a mudança a partir do texto da origem.
    expect((await historicoDe(db, org, "configuracao", org)).map((h) => h.mudancas)).toEqual([{ versao: [1, 2], "secao.a": ["um", "dois"] }]);
    // Voltar ao texto da origem é versão nova (a 3), com o mesmo texto da 1: o número conta a história, não o texto.
    expect(await publicarVersao(db, COM_ORIGEM, org, { a: "um", b: "" }, admin, "2026-10-16", 2, com("s"))).toMatchObject({ ok: true, mudou: true, versao: { numero: 3 } });
    // Sem origem, o mesmo documento numera do 1, como sempre.
    expect(await publicarVersao(db, DOC, org, { a: "um", b: "" }, admin, "2026-10-15", 0, com("s"))).toMatchObject({ ok: true, versao: { numero: 1 } });
  });
});
