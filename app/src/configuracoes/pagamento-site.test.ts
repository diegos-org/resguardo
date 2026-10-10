import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { criarCategoria } from "@/despesas/categorias";
import { auditoria, categoriasDespesa, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import {
  categoriaDaTaxaPerdida, CATEGORIA_TAXA_PERDIDA, ERRO_CATEGORIA_TAXA_ARQUIVADA, ERRO_CATEGORIA_TAXA_PADRAO_ARQUIVADA, ERRO_PARCELAS_MAXIMAS, CONFIG_PAGAMENTO_SITE_PADRAO, configDeJson,
  lerConfigPagamentoSite, LIMITE_NOME_FATURA, nomeNaFatura, salvarConfigPagamentoSite, TEXTOS_TRES_DS, validarConfigPagamentoSite,
} from "./pagamento-site";

/** Os campos do cartão (M8.2b) no padrão, para os casos que não falam deles. */
const SEM_CARTAO = { cartao: false, parcelasMaximas: null, tresDS: "on_fraud_risk" } as const;

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
    expect(validarConfigPagamentoSite({ oferecer: "on", nomeFatura: "  SCL   Leblon ", categoriaTaxaId: "" })).toEqual({ ok: true, config: { oferecer: true, nomeFatura: "SCL Leblon", categoriaTaxaId: null, ...SEM_CARTAO } });
    expect(validarConfigPagamentoSite({ nomeFatura: "x".repeat(LIMITE_NOME_FATURA + 1) })).toMatchObject({ ok: false, erros: { nomeFatura: expect.any(String) } });
    expect(validarConfigPagamentoSite({ nomeFatura: "SCL <script>" })).toMatchObject({ ok: false });
    expect(validarConfigPagamentoSite({ categoriaTaxaId: "abc" })).toMatchObject({ ok: false, erros: { categoriaTaxaId: expect.any(String) } });
    expect(validarConfigPagamentoSite({})).toEqual({ ok: true, config: { oferecer: false, nomeFatura: null, categoriaTaxaId: null, ...SEM_CARTAO } });
    expect(await salvarConfigPagamentoSite(db, org, { ...SEM_CARTAO, oferecer: false, nomeFatura: "SCL Leblon", categoriaTaxaId: "00000000-0000-4000-8000-000000000000" }, null)).toMatchObject({ ok: false });
    const cat = await criarCategoria(db, org, "Taxas", null);
    if (!cat.ok) throw new Error(cat.erro);
    expect(await salvarConfigPagamentoSite(db, org, { ...SEM_CARTAO, oferecer: false, nomeFatura: "SCL Leblon", categoriaTaxaId: cat.categoria.id }, null)).toEqual({ ok: true, mudou: true });
    expect(await salvarConfigPagamentoSite(db, org, { ...SEM_CARTAO, oferecer: false, nomeFatura: "SCL Leblon", categoriaTaxaId: cat.categoria.id }, null)).toEqual({ ok: true, mudou: false });
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
    expect(configDeJson({ oferecer: true, nomeFatura: "SCL", categoriaTaxaId: null })).toEqual({ oferecer: true, nomeFatura: "SCL", categoriaTaxaId: null, ...SEM_CARTAO });
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
