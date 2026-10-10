import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditoria, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { gravarConfig } from "./armazem";
import {
  camposDoMercado,
  lerMercado,
  lerTextosProprietarios,
  mercadoDeJson,
  mercadoParaMostrar,
  mesPorExtenso,
  salvarMercado,
  salvarTextosProprietarios,
  TEXTOS_PROPRIETARIOS_INICIAIS,
  validarMercado,
  validarTextosProprietarios,
} from "./pagina-proprietarios";

let db: Db;
let close: () => Promise<void>;
let org: string;
let outraOrg: string;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }, { id: outraOrg }] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
});
afterEach(() => close());

describe("textos da página para proprietários (M7.7)", () => {
  it("nunca salvo: texto-base; salvo: o que foi salvo, só na própria organização, com histórico", async () => {
    expect(await lerTextosProprietarios(db, org)).toEqual(TEXTOS_PROPRIETARIOS_INICIAIS);
    const v = validarTextosProprietarios({ ...TEXTOS_PROPRIETARIOS_INICIAIS, titulo: "  Seu imóvel, *nosso cuidado*.  ", como: "" });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(await salvarTextosProprietarios(db, org, v.textos, null)).toBe(true);
    expect(await salvarTextosProprietarios(db, org, v.textos, null)).toBe(false);
    const lidos = await lerTextosProprietarios(db, org);
    expect(lidos.titulo).toBe("Seu imóvel, *nosso cuidado*.");
    // "Como gerimos" vazio fica vazio (a seção some), não volta ao texto-base.
    expect(lidos.como).toBe("");
    expect(await lerTextosProprietarios(db, outraOrg)).toEqual(TEXTOS_PROPRIETARIOS_INICIAIS);
    expect((await db.select().from(auditoria)).some((a) => a.entidade === "configuracao")).toBe(true);
  });

  it("títulos obrigatórios e limites", () => {
    expect(validarTextosProprietarios({ ...TEXTOS_PROPRIETARIOS_INICIAIS, titulo: " ", contatoTitulo: "" })).toEqual({
      ok: false,
      erros: { titulo: "Este título não pode ficar vazio.", contatoTitulo: "Este título não pode ficar vazio." },
    });
    expect(validarTextosProprietarios({ ...TEXTOS_PROPRIETARIOS_INICIAIS, olho: "x".repeat(61) })).toMatchObject({ ok: false, erros: { olho: "Máximo de 60 caracteres." } });
    // Opcionais podem ficar vazios.
    expect(validarTextosProprietarios({ ...TEXTOS_PROPRIETARIOS_INICIAIS, portfolioTitulo: "", subtitulo: "", mercadoTitulo: "" }).ok).toBe(true);
  });
});

describe("faixa de mercado (M7.7)", () => {
  const linha = (i: number, tipo: string, diaria: string, ocupacao: string, liquido = "") => ({ [`tipo_${i}`]: tipo, [`diaria_${i}`]: diaria, [`ocupacao_${i}`]: ocupacao, [`liquido_${i}`]: liquido });

  it("linhas preenchidas viram números em centavos e pontos-base; linhas vazias são ignoradas", () => {
    const v = validarMercado({ referencia: "2026-09", fonte: "Reservas dos imóveis que administramos", ...linha(0, "Studio", "450", "72,5", "6.800"), ...linha(2, "2 quartos", "1.250,50", "65%") });
    expect(v).toEqual({
      ok: true,
      mercado: {
        referencia: "2026-09",
        fonte: "Reservas dos imóveis que administramos",
        linhas: [
          { tipo: "Studio", diaria: 45000, ocupacao: 7250, liquido: 680000 },
          { tipo: "2 quartos", diaria: 125050, ocupacao: 6500, liquido: null },
        ],
      },
    });
  });

  it("linha começada precisa de tipo, diária e ocupação; com números, o mês e a fonte são obrigatórios", () => {
    const v = validarMercado({ referencia: "", fonte: "", ...linha(0, "", "abc", "0", "x") });
    expect(v).toEqual({
      ok: false,
      erros: {
        tipo_0: "Informe o tipo de imóvel (ex.: Studio, 2 quartos).",
        diaria_0: "Valor em reais, maior que zero (ex.: 650 ou 650,00).",
        ocupacao_0: "Percentual de 1 a 100 (ex.: 72 ou 72,5).",
        liquido_0: "Valor em reais (ex.: 6.800 ou 6800,00), ou deixe vazio.",
        referencia: "Informe o mês a que os números se referem.",
        fonte: "Diga de onde vêm os números (ex.: reservas dos imóveis que administramos).",
      },
    });
    expect(validarMercado({ referencia: "2026-09", fonte: "x", ...linha(1, "Studio", "", "") })).toMatchObject({
      ok: false,
      erros: { diaria_1: "Informe a diária média.", ocupacao_1: "Informe a ocupação média." },
    });
    expect(validarMercado({ referencia: "setembro", fonte: "x", ...linha(0, "Studio", "450", "70") })).toMatchObject({ ok: false, erros: { referencia: "Escolha o mês (AAAA-MM)." } });
    expect(validarMercado({ referencia: "2026-09", fonte: "x", ...linha(0, "Studio", "450", "101") })).toMatchObject({ ok: false, erros: { ocupacao_0: "Percentual de 1 a 100 (ex.: 72 ou 72,5)." } });
    // Tudo vazio é válido: a seção some da página.
    expect(validarMercado({})).toEqual({ ok: true, mercado: { referencia: "", fonte: "", linhas: [] } });
  });

  it("gravado e lido de volta; o formulário do painel recomeça dos números salvos; só aparece com linhas, mês e fonte", async () => {
    expect(mercadoParaMostrar(await lerMercado(db, org))).toBeNull();
    const v = validarMercado({ referencia: "2026-09", fonte: "Reservas dos imóveis que administramos", ...linha(0, "Studio", "450", "72,5", "6.800") });
    if (!v.ok) throw new Error("esperado válido");
    expect(await salvarMercado(db, org, v.mercado, null)).toBe(true);
    const lido = await lerMercado(db, org);
    expect(lido).toEqual(v.mercado);
    expect(mercadoParaMostrar(lido)).toEqual(lido);
    expect(await lerMercado(db, outraOrg)).toEqual({ referencia: "", fonte: "", linhas: [] });
    const campos = camposDoMercado(lido);
    expect(campos).toMatchObject({ referencia: "2026-09", tipo_0: "Studio", diaria_0: "450", ocupacao_0: "72,5", liquido_0: "6.800", tipo_5: "" });
    expect(validarMercado(campos)).toEqual({ ok: true, mercado: lido });
    expect(mesPorExtenso("2026-09")).toBe("setembro de 2026");
    expect(mesPorExtenso("")).toBe("");
  });

  it("leitura tolerante: linha estranha gravada fora do formulário fica de fora, nunca vira número errado", async () => {
    await gravarConfig(db, org, "mercado_proprietarios", {
      referencia: "2026-13",
      fonte: "  Fonte ",
      linhas: [{ tipo: "Studio", diaria: 45000, ocupacao: 7000, liquido: -5 }, { tipo: "", diaria: 1, ocupacao: 1 }, { tipo: "Casa", diaria: "450", ocupacao: 7000 }, "lixo"],
    }, null);
    expect(await lerMercado(db, org)).toEqual({ referencia: "", fonte: "Fonte", linhas: [{ tipo: "Studio", diaria: 45000, ocupacao: 7000, liquido: null }] });
    expect(mercadoDeJson(null)).toEqual({ referencia: "", fonte: "", linhas: [] });
    // Sem o mês válido, a seção não aparece.
    expect(mercadoParaMostrar(await lerMercado(db, org))).toBeNull();
  });
});
