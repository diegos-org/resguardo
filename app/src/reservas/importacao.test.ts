import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { historicoDe } from "@/auditoria/auditoria";
import { imoveis, organizacoes, reservas } from "@/db/schema";
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
    expect(await importarCsv(db, org, MODELO_CSV, null)).toEqual({ criadas: 2, atualizadas: 0, iguais: 0, comErro: 0 });
    expect(await importarCsv(db, org, MODELO_CSV, null)).toEqual({ criadas: 0, atualizadas: 0, iguais: 2, comErro: 0 });
    const alterado = MODELO_CSV.replace("2.400,00", "2.500,00");
    const a = await analisarCsv(db, org, alterado);
    expect(a.linhas.map((l) => l.situacao)).toEqual(["atualiza", "igual"]);
    expect(a.linhas[0].avisos[0]).toContain("valorBruto");
    expect(await importarCsv(db, org, alterado, null)).toEqual({ criadas: 0, atualizadas: 1, iguais: 1, comErro: 0 });
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
