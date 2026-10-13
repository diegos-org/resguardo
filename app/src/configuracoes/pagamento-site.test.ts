import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { criarCategoria } from "@/despesas/categorias";
import { auditoria, categoriasDespesa, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { TEXTOS_BASE_CAUSAS_CONTESTACAO } from "@/pagamentos/contestacao-regras";
import {
  categoriaDaPerdaPorDisputa, categoriaDaTaxaPerdida, CATEGORIA_PERDA_CONTESTACAO, CATEGORIA_TAXA_PERDIDA, ERRO_CATEGORIA_CONTESTACAO_ARQUIVADA, ERRO_CATEGORIA_TAXA_ARQUIVADA,
  ERRO_CATEGORIA_TAXA_PADRAO_ARQUIVADA, ERRO_DIAS_AVISO_DOCUMENTACAO, ERRO_NAO_COMPARECIMENTO_HORAS, ERRO_PARCELAS_MAXIMAS, CONFIG_PAGAMENTO_SITE_PADRAO, configDeJson,
  lerConfigPagamentoSite, LIMITE_FRASE_CAUSA, LIMITE_NOME_CAUSA, LIMITE_NOME_FATURA, nomeNaFatura, salvarConfigPagamentoSite, TEXTOS_TRES_DS, validarConfigPagamentoSite,
} from "./pagamento-site";

/** Os campos do cartão (M8.2b) no padrão, para os casos que não falam deles. */
const SEM_CARTAO = { cartao: false, parcelasMaximas: null, tresDS: "on_fraud_risk" } as const;
/** Os campos do cancelamento (M8.2c) no padrão gravado e num formulário enviado sem a caixa marcada. */
const CANCELAMENTO_PADRAO = { pedidoCancelamentoNoPortal: true, naoComparecimentoHoras: 21 } as const;
const CANCELAMENTO_SEM_CAIXA = { pedidoCancelamentoNoPortal: false, naoComparecimentoHoras: 21 } as const;
/** Os campos da disputa do pagamento (M8.2e) no padrão: sem categoria escolhida, 5 dias e o texto-base das causas. */
const CONTESTACAO_PADRAO = { categoriaDaContestacao: null, diasAvisoDocumentacao: 5, causasContestacao: TEXTOS_BASE_CAUSAS_CONTESTACAO };

let db: Db, close: () => Promise<void>, org: string;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => { [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning(); });

describe("Configurações → Pagamento no site (M8.2a)", () => {
  it("padrão: oferecer DESLIGADO (deny-by-default), nome na fatura = nome da empresa, sem categoria; valor gravado estranho volta ao padrão", async () => {
    expect(CONFIG_PAGAMENTO_SITE_PADRAO.oferecer).toBe(false);
    expect(await lerConfigPagamentoSite(db, org)).toEqual(CONFIG_PAGAMENTO_SITE_PADRAO);
    expect(await nomeNaFatura(db, org)).toBe("Sua Casa Exemplo");
    expect(configDeJson({ oferecer: "sim", nomeFatura: 3, categoriaTaxaId: "x" })).toEqual(CONFIG_PAGAMENTO_SITE_PADRAO);
  });

  it("valida e grava (auditado), só com categoria ativa desta organização", async () => {
    expect(validarConfigPagamentoSite({ oferecer: "on", nomeFatura: "  SCL   Leblon ", categoriaTaxaId: "" })).toEqual({ ok: true, config: { oferecer: true, nomeFatura: "SCL Leblon", categoriaTaxaId: null, ...SEM_CARTAO, ...CANCELAMENTO_SEM_CAIXA, ...CONTESTACAO_PADRAO } });
    expect(validarConfigPagamentoSite({ nomeFatura: "x".repeat(LIMITE_NOME_FATURA + 1) })).toMatchObject({ ok: false, erros: { nomeFatura: expect.any(String) } });
    expect(validarConfigPagamentoSite({ nomeFatura: "SCL <script>" })).toMatchObject({ ok: false });
    expect(validarConfigPagamentoSite({ categoriaTaxaId: "abc" })).toMatchObject({ ok: false, erros: { categoriaTaxaId: expect.any(String) } });
    expect(validarConfigPagamentoSite({})).toEqual({ ok: true, config: { oferecer: false, nomeFatura: null, categoriaTaxaId: null, ...SEM_CARTAO, ...CANCELAMENTO_SEM_CAIXA, ...CONTESTACAO_PADRAO } });
    expect(await salvarConfigPagamentoSite(db, org, { ...SEM_CARTAO, ...CANCELAMENTO_PADRAO, ...CONTESTACAO_PADRAO, oferecer: false, nomeFatura: "SCL Leblon", categoriaTaxaId: "00000000-0000-4000-8000-000000000000" }, null)).toMatchObject({ ok: false });
    const cat = await criarCategoria(db, org, "Taxas", null);
    if (!cat.ok) throw new Error(cat.erro);
    expect(await salvarConfigPagamentoSite(db, org, { ...SEM_CARTAO, ...CANCELAMENTO_PADRAO, ...CONTESTACAO_PADRAO, oferecer: false, nomeFatura: "SCL Leblon", categoriaTaxaId: cat.categoria.id }, null)).toEqual({ ok: true, mudou: true });
    expect(await salvarConfigPagamentoSite(db, org, { ...SEM_CARTAO, ...CANCELAMENTO_PADRAO, ...CONTESTACAO_PADRAO, oferecer: false, nomeFatura: "SCL Leblon", categoriaTaxaId: cat.categoria.id }, null)).toEqual({ ok: true, mudou: false });
    expect(await nomeNaFatura(db, org)).toBe("SCL Leblon");
    expect(await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, org), eq(auditoria.acao, "configuracao.pagamento_site")))).toHaveLength(1);
    expect(await categoriaDaTaxaPerdida(db, org, null)).toEqual({ ok: true, id: cat.categoria.id });
  });

  it("cartão (M8.2b): começa desligado, parcelas no máximo do Mercado Pago e verificação do banco quando houver risco; gravado estranho volta ao padrão", async () => {
    expect(CONFIG_PAGAMENTO_SITE_PADRAO).toMatchObject({ cartao: false, parcelasMaximas: null, tresDS: "on_fraud_risk" });
    expect(configDeJson({ oferecer: true, cartao: true, parcelasMaximas: 6, tresDS: "never" })).toMatchObject({ oferecer: true, cartao: true, parcelasMaximas: 6, tresDS: "never" });
    for (const estranho of [{ cartao: "sim", parcelasMaximas: 0, tresDS: "always" }, { cartao: 1, parcelasMaximas: 37, tresDS: "" }, { parcelasMaximas: 2.5, tresDS: null }, { parcelasMaximas: "6" }]) {
      expect(configDeJson(estranho)).toMatchObject(SEM_CARTAO);
    }
    // Configuração gravada antes do cartão (só os campos do Pix): o cartão fica desligado.
    expect(configDeJson({ oferecer: true, nomeFatura: "SCL", categoriaTaxaId: null })).toEqual({ oferecer: true, nomeFatura: "SCL", categoriaTaxaId: null, ...SEM_CARTAO, ...CANCELAMENTO_PADRAO, ...CONTESTACAO_PADRAO });
    expect(TEXTOS_TRES_DS.on_fraud_risk).toMatch(/^Quando houver risco \(recomendado\)/);
    expect(TEXTOS_TRES_DS.never).toMatch(/^Nunca: nenhuma verificação/);
  });

  it("cartão (M8.2b): formulário — caixa, parcelas de 1 a 36 (vazio = máximo do Mercado Pago) e uma das opções da verificação", async () => {
    const ok = (bruto: Record<string, unknown>) => {
      const v = validarConfigPagamentoSite(bruto);
      if (!v.ok) throw new Error(JSON.stringify(v.erros));
      return v.config;
    };
    expect(ok({ oferecer: "on", cartao: "on", parcelasMaximas: " 12 ", tresDS: "never" })).toMatchObject({ oferecer: true, cartao: true, parcelasMaximas: 12, tresDS: "never" });
    expect(ok({ cartao: "on", parcelasMaximas: "", tresDS: "on_fraud_risk" })).toMatchObject({ cartao: true, parcelasMaximas: null, tresDS: "on_fraud_risk" });
    expect(ok({ parcelasMaximas: "1" }).parcelasMaximas).toBe(1);
    expect(ok({ parcelasMaximas: "36" }).parcelasMaximas).toBe(36);
    // Sem a caixa e sem o campo da verificação (formulário de antes do cartão): desligado e a opção recomendada.
    expect(ok({ oferecer: "on" })).toMatchObject(SEM_CARTAO);
    for (const ruim of ["0", "37", "2,5", "1.0", "-3", "dez", "100"]) {
      expect(validarConfigPagamentoSite({ parcelasMaximas: ruim })).toEqual({ ok: false, erros: { parcelasMaximas: ERRO_PARCELAS_MAXIMAS } });
    }
    expect(ERRO_PARCELAS_MAXIMAS).toBe("Use um número de 1 a 36 (vazio = o máximo que o Mercado Pago permitir).");
    expect(validarConfigPagamentoSite({ tresDS: "always" })).toMatchObject({ ok: false, erros: { tresDS: expect.any(String) } });
    // Grava auditado e relê igual.
    const config = { ...CONFIG_PAGAMENTO_SITE_PADRAO, oferecer: true, cartao: true, parcelasMaximas: 6, tresDS: "never" as const };
    expect(await salvarConfigPagamentoSite(db, org, config, null)).toEqual({ ok: true, mudou: true });
    expect(await lerConfigPagamentoSite(db, org)).toEqual(config);
    const [audit] = await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, org), eq(auditoria.acao, "configuracao.pagamento_site")));
    expect(JSON.stringify(audit.mudancas)).toContain("parcelasMaximas");
  });

  it("cancelamento (M8.2c): pedido em Minha reserva LIGADO e não comparecimento 21 horas depois da entrada; gravado estranho volta ao padrão", async () => {
    expect(CONFIG_PAGAMENTO_SITE_PADRAO).toMatchObject({ pedidoCancelamentoNoPortal: true, naoComparecimentoHoras: 21 });
    expect(await lerConfigPagamentoSite(db, org)).toMatchObject(CANCELAMENTO_PADRAO);
    // Configuração gravada antes do M8.2c: o padrão.
    expect(configDeJson({ oferecer: true, cartao: true })).toMatchObject(CANCELAMENTO_PADRAO);
    expect(configDeJson({ pedidoCancelamentoNoPortal: false, naoComparecimentoHoras: 0 })).toMatchObject({ pedidoCancelamentoNoPortal: false, naoComparecimentoHoras: 0 });
    expect(configDeJson({ naoComparecimentoHoras: 72 }).naoComparecimentoHoras).toBe(72);
    for (const estranho of [{ pedidoCancelamentoNoPortal: "nao", naoComparecimentoHoras: 73 }, { pedidoCancelamentoNoPortal: 0, naoComparecimentoHoras: -1 }, { naoComparecimentoHoras: 1.5 }, { naoComparecimentoHoras: "12" }]) {
      expect(configDeJson(estranho)).toMatchObject(CANCELAMENTO_PADRAO);
    }
  });

  it("cancelamento (M8.2c): formulário — caixa do pedido (desmarcada = desligado) e horas de 0 a 72 (vazio = 21); grava auditado", async () => {
    const ok = (bruto: Record<string, unknown>) => {
      const v = validarConfigPagamentoSite(bruto);
      if (!v.ok) throw new Error(JSON.stringify(v.erros));
      return v.config;
    };
    expect(ok({ pedidoCancelamentoNoPortal: "on", naoComparecimentoHoras: " 12 " })).toMatchObject({ pedidoCancelamentoNoPortal: true, naoComparecimentoHoras: 12 });
    expect(ok({ pedidoCancelamentoNoPortal: "on", naoComparecimentoHoras: "" })).toMatchObject({ pedidoCancelamentoNoPortal: true, naoComparecimentoHoras: 21 });
    expect(ok({ naoComparecimentoHoras: "0" })).toMatchObject({ pedidoCancelamentoNoPortal: false, naoComparecimentoHoras: 0 });
    expect(ok({ naoComparecimentoHoras: "72" }).naoComparecimentoHoras).toBe(72);
    for (const ruim of ["73", "-1", "2,5", "1.0", "doze", "100"]) {
      expect(validarConfigPagamentoSite({ naoComparecimentoHoras: ruim })).toEqual({ ok: false, erros: { naoComparecimentoHoras: ERRO_NAO_COMPARECIMENTO_HORAS } });
    }
    expect(ERRO_NAO_COMPARECIMENTO_HORAS).toBe("Use um número inteiro de horas de 0 a 72 (vazio = 21).");
    const config = { ...CONFIG_PAGAMENTO_SITE_PADRAO, pedidoCancelamentoNoPortal: false, naoComparecimentoHoras: 30 };
    expect(await salvarConfigPagamentoSite(db, org, config, null)).toEqual({ ok: true, mudou: true });
    expect(await lerConfigPagamentoSite(db, org)).toEqual(config);
    const [audit] = await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, org), eq(auditoria.acao, "configuracao.pagamento_site")));
    expect(JSON.stringify(audit.mudancas)).toContain("naoComparecimentoHoras");
  });

  it("disputa do pagamento (M8.2e): sem categoria, 5 dias de aviso e o texto-base das causas; gravado estranho volta ao padrão, campo a campo", async () => {
    expect(CONFIG_PAGAMENTO_SITE_PADRAO).toMatchObject(CONTESTACAO_PADRAO);
    expect(await lerConfigPagamentoSite(db, org)).toMatchObject(CONTESTACAO_PADRAO);
    // Configuração gravada antes do M8.2e: o padrão.
    expect(configDeJson({ oferecer: true, cartao: true, naoComparecimentoHoras: 10 })).toMatchObject(CONTESTACAO_PADRAO);
    expect(TEXTOS_BASE_CAUSAS_CONTESTACAO.imovel).toEqual({ nome: "Problema do imóvel (estrutura, equipamento ou obra do proprietário)", frase: "pela regra de 7/10, o proprietário" });
    expect(TEXTOS_BASE_CAUSAS_CONTESTACAO.fraude.fraseComVerificacao).toContain("espere o resultado antes de decidir");
    const cat = "00000000-0000-4000-8000-000000000001";
    expect(configDeJson({ categoriaDaContestacao: cat, diasAvisoDocumentacao: 15 })).toMatchObject({ categoriaDaContestacao: cat, diasAvisoDocumentacao: 15 });
    expect(configDeJson({ diasAvisoDocumentacao: 1 }).diasAvisoDocumentacao).toBe(1);
    for (const estranho of [{ categoriaDaContestacao: "x", diasAvisoDocumentacao: 0 }, { diasAvisoDocumentacao: 16 }, { diasAvisoDocumentacao: 2.5 }, { diasAvisoDocumentacao: "5" }, { causasContestacao: "nada" }]) {
      expect(configDeJson(estranho)).toMatchObject(CONTESTACAO_PADRAO);
    }
    // Uma causa editada fica; o resto (campo vazio, longo demais, com quebra de linha ou de outro tipo) volta ao texto-base.
    const causas = configDeJson({
      causasContestacao: {
        imovel: { nome: "Problema do imóvel", frase: "" },
        scl: { nome: "x".repeat(LIMITE_NOME_CAUSA + 1), frase: "pela regra, a SCL" },
        cobranca: { nome: "linha\nquebrada" },
        fraude: { frasePix: "Pix: decida", fraseComVerificacao: 3 },
        inventada: { nome: "?" },
      },
    }).causasContestacao;
    expect(causas).toEqual({
      ...TEXTOS_BASE_CAUSAS_CONTESTACAO,
      imovel: { nome: "Problema do imóvel", frase: TEXTOS_BASE_CAUSAS_CONTESTACAO.imovel.frase },
      scl: { nome: TEXTOS_BASE_CAUSAS_CONTESTACAO.scl.nome, frase: "pela regra, a SCL" },
      fraude: { ...TEXTOS_BASE_CAUSAS_CONTESTACAO.fraude, frasePix: "Pix: decida" },
    });
  });

  it("disputa do pagamento (M8.2e): formulário — categoria, dias de 1 a 15 (vazio = 5) e as causas (vazio = texto-base); sem os campos, fica o atual; grava auditado", async () => {
    const ok = (bruto: Record<string, unknown>, atual = CONFIG_PAGAMENTO_SITE_PADRAO) => {
      const v = validarConfigPagamentoSite(bruto, atual);
      if (!v.ok) throw new Error(JSON.stringify(v.erros));
      return v.config;
    };
    expect(ok({ diasAvisoDocumentacao: " 7 " }).diasAvisoDocumentacao).toBe(7);
    expect(ok({ diasAvisoDocumentacao: "" }).diasAvisoDocumentacao).toBe(5);
    expect(ok({ diasAvisoDocumentacao: "15" }).diasAvisoDocumentacao).toBe(15);
    for (const ruim of ["0", "16", "2,5", "1.0", "dez", "100"]) {
      expect(validarConfigPagamentoSite({ diasAvisoDocumentacao: ruim })).toEqual({ ok: false, erros: { diasAvisoDocumentacao: ERRO_DIAS_AVISO_DOCUMENTACAO } });
    }
    expect(ERRO_DIAS_AVISO_DOCUMENTACAO).toBe("Use um número inteiro de dias de 1 a 15 (vazio = 5).");
    expect(validarConfigPagamentoSite({ categoriaDaContestacao: "abc" })).toMatchObject({ ok: false, erros: { categoriaDaContestacao: expect.any(String) } });
    expect(ok({ categoriaDaContestacao: "" }).categoriaDaContestacao).toBeNull();
    const causas = ok({ causa_imovel_nome: "  Problema   do imóvel ", causa_fraude_frasePix: "", causa_outro_frase: "decida  com calma" }).causasContestacao;
    expect(causas.imovel.nome).toBe("Problema do imóvel");
    expect(causas.fraude.frasePix).toBe(TEXTOS_BASE_CAUSAS_CONTESTACAO.fraude.frasePix);
    expect(causas.outro.frase).toBe("decida com calma");
    expect(validarConfigPagamentoSite({ causa_scl_frase: "x".repeat(LIMITE_FRASE_CAUSA + 1) })).toEqual({ ok: false, erros: { causa_scl_frase: `Máximo de ${LIMITE_FRASE_CAUSA} caracteres.` } });
    expect(validarConfigPagamentoSite({ causa_scl_nome: "a\u0007b" })).toMatchObject({ ok: false, erros: { causa_scl_nome: expect.any(String) } });
    // O formulário de antes do M8.2e (sem os campos da disputa) não muda o que estava gravado.
    const atual = { ...CONFIG_PAGAMENTO_SITE_PADRAO, diasAvisoDocumentacao: 9, causasContestacao: { ...TEXTOS_BASE_CAUSAS_CONTESTACAO, outro: { nome: "Outra causa", frase: "decida" } } };
    expect(ok({ oferecer: "on" }, atual)).toMatchObject({ oferecer: true, diasAvisoDocumentacao: 9, causasContestacao: atual.causasContestacao, categoriaDaContestacao: null });
    // Grava auditado (a categoria precisa ser desta organização e estar ativa) e relê igual.
    expect(await salvarConfigPagamentoSite(db, org, { ...atual, categoriaDaContestacao: "00000000-0000-4000-8000-000000000000" }, null)).toEqual({ ok: false, erros: { categoriaDaContestacao: expect.any(String) } });
    const cat = await criarCategoria(db, org, "Disputas", null);
    if (!cat.ok) throw new Error(cat.erro);
    const config = { ...atual, categoriaDaContestacao: cat.categoria.id };
    expect(await salvarConfigPagamentoSite(db, org, config, null)).toEqual({ ok: true, mudou: true });
    expect(await lerConfigPagamentoSite(db, org)).toEqual(config);
    const [audit] = await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, org), eq(auditoria.acao, "configuracao.pagamento_site")));
    expect(Object.keys(audit.mudancas as object)).toEqual(expect.arrayContaining(["diasAvisoDocumentacao", "causasContestacao", "categoriaDaContestacao"]));
    expect(await categoriaDaPerdaPorDisputa(db, org, null)).toEqual({ ok: true, id: cat.categoria.id });
  });

  it("categoria da perda por disputa (M8.2e): criada no primeiro uso, separada da taxa perdida; arquivada avisa e não lança", async () => {
    const r = await categoriaDaPerdaPorDisputa(db, org, null);
    if (!r.ok) throw new Error(r.erro);
    const [c] = await db.select().from(categoriasDespesa).where(eq(categoriasDespesa.id, r.id));
    expect(c.nome).toBe(CATEGORIA_PERDA_CONTESTACAO);
    expect(await lerConfigPagamentoSite(db, org)).toMatchObject({ categoriaDaContestacao: r.id, categoriaTaxaId: null });
    const t = await categoriaDaTaxaPerdida(db, org, null);
    if (!t.ok) throw new Error(t.erro);
    expect(t.id).not.toBe(r.id);
    expect(await lerConfigPagamentoSite(db, org)).toMatchObject({ categoriaDaContestacao: r.id, categoriaTaxaId: t.id });
    expect(await categoriaDaPerdaPorDisputa(db, org, null)).toEqual({ ok: true, id: r.id });
    await db.update(categoriasDespesa).set({ ativa: false }).where(eq(categoriasDespesa.id, r.id));
    expect(await categoriaDaPerdaPorDisputa(db, org, null)).toEqual({ ok: false, erro: ERRO_CATEGORIA_CONTESTACAO_ARQUIVADA });
  });

  it("categoria da taxa perdida: criada no primeiro uso, guardada e reaproveitada", async () => {
    const r = await categoriaDaTaxaPerdida(db, org, null);
    if (!r.ok) throw new Error(r.erro);
    const id = r.id;
    const [c] = await db.select().from(categoriasDespesa).where(eq(categoriasDespesa.id, id));
    expect(c.nome).toBe(CATEGORIA_TAXA_PERDIDA);
    expect((await lerConfigPagamentoSite(db, org)).categoriaTaxaId).toBe(id);
    expect(await categoriaDaTaxaPerdida(db, org, null)).toEqual({ ok: true, id });
    expect(await db.select().from(categoriasDespesa).where(eq(categoriasDespesa.organizacaoId, org))).toHaveLength(1);
  });

  it("categoria arquivada nunca recebe a taxa perdida: avisa (a escolhida ou a de nome padrão) e não lança", async () => {
    const r = await categoriaDaTaxaPerdida(db, org, null);
    if (!r.ok) throw new Error(r.erro);
    // A escolhida (aqui, a padrão criada no primeiro uso) foi arquivada depois.
    await db.update(categoriasDespesa).set({ ativa: false }).where(eq(categoriasDespesa.id, r.id));
    expect(await categoriaDaTaxaPerdida(db, org, null)).toEqual({ ok: false, erro: ERRO_CATEGORIA_TAXA_ARQUIVADA });
    // Sem escolha no painel, a de nome padrão arquivada também não é usada (nem uma nova com o mesmo nome).
    const config = await lerConfigPagamentoSite(db, org);
    expect(await salvarConfigPagamentoSite(db, org, { ...config, categoriaTaxaId: null }, null)).toMatchObject({ ok: true });
    expect(await categoriaDaTaxaPerdida(db, org, null)).toEqual({ ok: false, erro: ERRO_CATEGORIA_TAXA_PADRAO_ARQUIVADA });
    expect(await db.select().from(categoriasDespesa).where(eq(categoriasDespesa.organizacaoId, org))).toHaveLength(1);
    // Reativada: volta a valer.
    await db.update(categoriasDespesa).set({ ativa: true }).where(eq(categoriasDespesa.id, r.id));
    expect(await categoriaDaTaxaPerdida(db, org, null)).toEqual({ ok: true, id: r.id });
  });
});
