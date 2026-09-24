import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { historicoDe } from "@/auditoria/auditoria";
import { criarContrato } from "@/contratos/repositorio";
import { imoveis, organizacoes, reservas, usuarios } from "@/db/schema";
import { listarLancamentos, mudarEstado } from "@/financeiro/ledger";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { MODELO_CSV } from "./csv";
import { analisarCsv, FONTE_CSV, importarCsv } from "./importacao";
import { criarReserva } from "./repositorio";

let db: Db;
let close: () => Promise<void>;
let org: string;
let outraOrg: string;
let im403: string;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }, { id: outraOrg }] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
  [{ id: im403 }] = await db
    .insert(imoveis)
    .values([
      { organizacaoId: org, codigo: "403", nome: "Quatro" },
      { organizacaoId: org, codigo: "102", nome: "Um" },
    ])
    .returning();
  await db.insert(imoveis).values({ organizacaoId: outraOrg, codigo: "999", nome: "De outra" });
});
afterEach(() => close());

describe("conferir o arquivo", () => {
  it("modelo: duas reservas novas, sem gravar nada", async () => {
    const a = await analisarCsv(db, org, MODELO_CSV);
    expect(a.erroGeral).toBeUndefined();
    expect(a.linhas.map((l) => l.situacao)).toEqual(["nova", "nova"]);
    expect(await db.select().from(reservas)).toEqual([]);
  });

  it("erros gerais: vazio, colunas faltando", async () => {
    expect((await analisarCsv(db, org, "imovel;origem")).erroGeral).toMatch(/cabeçalho e pelo menos uma/);
    expect((await analisarCsv(db, org, "imovel;entrada\n403;10/10/2026")).erroGeral).toMatch(/Faltam colunas obrigatórias: origem, codigo_canal, saida/);
  });

  it("imóvel de outra organização ou inexistente e reserva repetida no arquivo viram erro da linha", async () => {
    const csv = ["imovel;origem;codigo_canal;entrada;saida", "999;airbnb;A1;10/10/2026;12/10/2026", "403;airbnb;A2;10/10/2026;12/10/2026", "403;airbnb;A2;20/10/2026;22/10/2026"].join("\n");
    const a = await analisarCsv(db, org, csv);
    expect(a.linhas.map((l) => l.situacao)).toEqual(["erro", "nova", "erro"]);
    expect(a.linhas[0].erros[0]).toContain('"999" não cadastrado');
    expect(a.linhas[2].erros[0]).toContain("linha 3");
  });

  it("avisa quando cruza com reserva existente ou com outra linha", async () => {
    await criarReserva(
      db,
      org,
      { imovelId: im403, origem: "direta", estado: "confirmada", checkin: "2026-10-12", checkout: "2026-10-15", hospedes: 2, hospedeNome: "", hospedeEmail: "", hospedeTelefone: "", hospedeOrigem: "", moeda: "BRL", valorBruto: null, taxaCanal: null, valorLiquido: null, codigoCanal: "", observacoes: "" },
      null,
    );
    const a = await analisarCsv(db, org, MODELO_CSV);
    expect(a.linhas[0].avisos.join(" ")).toMatch(/Cruza com a reserva SCL-/);
    expect(a.linhas[1].avisos).toEqual([]);
  });
});

describe("importar", () => {
  it("importa, e reimportar o mesmo arquivo não duplica; linha alterada é atualizada", async () => {
    expect(await importarCsv(db, org, MODELO_CSV, null)).toEqual({ criadas: 2, atualizadas: 0, iguais: 0, comErro: 0, semRecalculo: [], avisosFinanceiro: expect.any(Array) });
    expect(await importarCsv(db, org, MODELO_CSV, null)).toEqual({ criadas: 0, atualizadas: 0, iguais: 2, comErro: 0, semRecalculo: [], avisosFinanceiro: expect.any(Array) });
    const alterado = MODELO_CSV.replace("2.400,00", "2.500,00");
    const a = await analisarCsv(db, org, alterado);
    expect(a.linhas.map((l) => l.situacao)).toEqual(["atualiza", "igual"]);
    expect(a.linhas[0].avisos[0]).toContain("valorBruto");
    expect(await importarCsv(db, org, alterado, null)).toEqual({ criadas: 0, atualizadas: 1, iguais: 1, comErro: 0, semRecalculo: [], avisosFinanceiro: expect.any(Array) });
    const [r] = await db
      .select()
      .from(reservas)
      .where(and(eq(reservas.fonte, FONTE_CSV), eq(reservas.idFonte, "airbnb:HMEXEMPLO1")));
    expect(r.valorBruto).toBe(250000);
    expect(await db.select().from(reservas)).toHaveLength(2);
    expect(await historicoDe(db, org, "importacao", org)).toHaveLength(3);
  });

  it("linhas com erro ficam de fora e são contadas", async () => {
    const csv = MODELO_CSV + "\n999;airbnb;X;10/10/2026;12/10/2026";
    expect(await importarCsv(db, org, csv, null)).toMatchObject({ criadas: 2, comErro: 1 });
  });
});

describe("autor e dinheiro já movimentado", () => {
  it("o histórico da reserva mostra quem importou", async () => {
    const [u] = await db.insert(usuarios).values({ organizacaoId: org, email: "admin@example.com", nome: "Admin", papel: "admin" }).returning();
    await importarCsv(db, org, MODELO_CSV, u.id);
    const [r] = await db.select().from(reservas).where(eq(reservas.idFonte, "airbnb:HMEXEMPLO1"));
    const h = await historicoDe(db, org, "reserva", r.id);
    expect(h[0].autor).toBe("Admin");
  });

  it("reimportação que mudaria reserva com dinheiro já movimentado avisa a linha e não mexe no financeiro", async () => {
    await criarContrato(db, org, im403, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
    await importarCsv(db, org, MODELO_CSV, null);
    const [r] = await db.select().from(reservas).where(eq(reservas.idFonte, "airbnb:HMEXEMPLO1"));
    const antes = await listarLancamentos(db, org, { reservaId: r.id });
    expect(antes.length).toBeGreaterThan(0);
    await mudarEstado(db, org, antes[0].id, "realizado", null);
    const res = await importarCsv(db, org, MODELO_CSV.replace("2.400,00", "2.600,00"), null);
    expect(res).toMatchObject({ atualizadas: 1, semRecalculo: [2] });
    expect(await listarLancamentos(db, org, { reservaId: r.id })).toHaveLength(antes.length);
  });
});

describe("avisos e arquivo quebrado", () => {
  it("linha sem valor ou sem contrato entra, mas com o aviso do financeiro", async () => {
    const r = await importarCsv(db, org, "imovel;origem;codigo_canal;entrada;saida\n403;airbnb;SEMVALOR;10/10/2026;12/10/2026", null);
    expect(r.criadas).toBe(1);
    expect(r.avisosFinanceiro).toEqual([{ linha: 2, avisos: ["Valor bruto não informado: cálculo pendente."] }]);
  });

  it("aspas abertas sem fechar: recusa o arquivo em vez de engolir linhas", async () => {
    const csv = 'imovel;origem;codigo_canal;entrada;saida;observacoes\n403;airbnb;A1;10/10/2026;12/10/2026;"sem fechar\n102;airbnb;A2;10/10/2026;12/10/2026;ok';
    expect((await analisarCsv(db, org, csv)).erroGeral).toContain("aspas");
    expect(await importarCsv(db, org, csv, null)).toMatchObject({ erroGeral: expect.stringContaining("aspas"), criadas: 0 });
  });
});

describe("imóvel inativo e valores enormes", () => {
  it("recusa imóvel inativo e valor acima do limite do banco na conferência (nada é importado pela metade)", async () => {
    await db.update(imoveis).set({ ativo: false }).where(eq(imoveis.codigo, "102"));
    const csv = ["imovel;origem;codigo_canal;entrada;saida;valor_bruto", "403;airbnb;OK1;10/10/2026;12/10/2026;1.000,00", "102;airbnb;INATIVO;10/10/2026;12/10/2026;", "403;airbnb;GRANDE;20/10/2026;22/10/2026;21474836,48"].join("\n");
    const a = await analisarCsv(db, org, csv);
    expect(a.linhas.map((l) => l.situacao)).toEqual(["nova", "erro", "erro"]);
    expect(a.linhas[1].erros[0]).toContain("inativo");
    expect(a.linhas[2].erros[0]).toContain("R$ 21 milhões");
    expect(await importarCsv(db, org, csv, null)).toMatchObject({ criadas: 1, comErro: 2 });
  });
});
