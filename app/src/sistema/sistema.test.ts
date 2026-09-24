import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarContrato } from "@/contratos/repositorio";
import { imoveis, organizacoes, proprietarioImoveis, proprietarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { salvarRecebimento } from "@/imoveis/recebimento";
import { AUTOMACOES, registrarExecucao, ultimasExecucoes } from "./automacoes";
import { regrasEmVigor } from "./regras";
import { situacaoServicos } from "./servicos";

describe("serviços", () => {
  it("mostra a situação sem nunca expor chaves", () => {
    const env = {
      DATABASE_URL: "postgres://u:senha-secreta@ep-x.neon.tech/db",
      AUTH_SECRET: "s3gr3do",
      AUTH_GOOGLE_ID: "id-google",
      AUTH_GOOGLE_SECRET: "segredo-google",
      BEDS24_API_KEY: "chave-beds24",
    } as unknown as NodeJS.ProcessEnv;
    const s = situacaoServicos(env, true);
    const texto = JSON.stringify(s);
    for (const segredo of ["senha-secreta", "s3gr3do", "segredo-google", "chave-beds24", "id-google"]) expect(texto).not.toContain(segredo);
    const por = Object.fromEntries(s.map((x) => [x.nome, x]));
    expect(por["Banco de dados (Neon)"].situacao).toBe("ok");
    expect(por["Login com Google"].situacao).toBe("ok");
    expect(por["E-mail do sistema (Resend)"].situacao).toBe("nao_configurado");
    expect(por["Beds24"].detalhe).toContain("desligado");
    expect(por["WhatsApp (Meta)"].situacao).toBe("planejado");
  });

  it("banco fora do ar e escrita no Beds24 ligada aparecem", () => {
    const s = situacaoServicos({ DATABASE_URL: "postgres://x@h.neon.tech/d", BEDS24_API_KEY: "k", BEDS24_ESCRITA: "ligada" } as unknown as NodeJS.ProcessEnv, false);
    expect(s[0].situacao).toBe("falha");
    expect(s.find((x) => x.nome === "Beds24")?.detalhe).toContain("LIGADO");
    expect(situacaoServicos({} as NodeJS.ProcessEnv, null)[0].situacao).toBe("nao_configurado");
  });
});

describe("automações e regras (com banco)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let org: string;
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    [{ id: org }] = await db.insert(organizacoes).values({ nome: "A" }).returning();
  });
  afterEach(() => close());

  it("registra execuções com sucesso e com falha; mostra a última de cada uma", async () => {
    let t = Date.parse("2026-09-24T10:00:00Z");
    const agora = () => new Date((t += 1000));
    expect(await registrarExecucao(db, "recalculo-deploy", async () => "3 reservas", agora)).toBe("3 reservas");
    await expect(registrarExecucao(db, "recalculo-deploy", async () => Promise.reject(new Error("banco caiu")), agora)).rejects.toThrow("banco caiu");
    const u = await ultimasExecucoes(db);
    expect(u.get("recalculo-deploy")).toMatchObject({ ok: false, resumo: "Falhou: banco caiu" });
    expect(AUTOMACOES.find((a) => a.id === "recalculo-deploy")?.situacao).toBe("ativa");
  });

  it("regras em vigor: contrato de hoje, próximo contrato, dono e quem recebe (imóvel × padrão)", async () => {
    const [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "102", nome: "Studio" }).returning();
    const [{ id: sem }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "103", nome: "Outro" }).returning();
    const [{ id: dono }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Dona Fictícia", email: "d@example.com" }).returning();
    await db.insert(proprietarioImoveis).values({ proprietarioId: dono, imovelId: im });
    await criarContrato(db, org, im, { tipo: "gestao_completa", comissao: "20", inicio: "2025-01-01", fim: "2026-12-31" }, null);
    await criarContrato(db, org, im, { tipo: "gestao_completa", comissao: "15", inicio: "2027-01-01" }, null);
    await salvarRecebimento(db, org, im, { booking: "split" }, null);
    const r = await regrasEmVigor(db, org, "2026-09-24");
    const a = r.find((x) => x.imovelId === im)!;
    expect(a).toMatchObject({ proprietario: "Dona Fictícia", contrato: "Gestão completa · 20%" });
    expect(a.proximoContrato).toContain("15% a partir de 01/01/2027");
    expect(a.recebimento.find((x) => x.origem === "booking")).toEqual({ origem: "booking", valor: "split", fonte: "imovel" });
    expect(a.recebimento.find((x) => x.origem === "airbnb")).toEqual({ origem: "airbnb", valor: "split", fonte: "padrao" });
    expect(r.find((x) => x.imovelId === sem)).toMatchObject({ proprietario: null, contrato: null });
  });
});
